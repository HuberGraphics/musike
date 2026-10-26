import { create } from "zustand";
import { api, capabilities } from "./api";
import type { SpotifyKind, SpotifyList, SpotifyTrack } from "./types";

/**
 * Importing from Spotify. Without an account, public playlists, albums and songs come from the Musike backend
 * (Spotify's embed page, then the web player's API, up to IMPORT_LIMIT tracks). Logging in adds private playlists,
 * private ones and Liked Songs straight from the Web API, in the browser: Authorization Code with PKCE needs
 * no secret, so nothing goes through the Musike server. Each person registers their own Spotify app (free) and
 * pastes its Client ID: since 2026, an app in development mode serves at most 5 accounts.
 */

/** The most tracks one import brings in: matching each on YouTube Music takes a moment. */
export const IMPORT_LIMIT = 1000;

const CLIENT_KEY = "musike:spotify-client-id";
const TOKEN_KEY = "musike:spotify-token";
const PENDING_KEY = "musike:spotify-login";
const SCOPES = "playlist-read-private playlist-read-collaborative user-library-read";
const API = "https://api.spotify.com/v1";

export const CALLBACK_PATH = "/spotify-callback";

/** "https://open.spotify.com/intl-de/playlist/ID?si=…" or "spotify:playlist:ID" → { kind, id }. */
export function parseSpotifyLink(text: string): { kind: SpotifyKind; id: string } | null {
  const s = text.trim();
  const uri = s.match(/^spotify:(playlist|album|track):([A-Za-z0-9]{22})$/);
  if (uri) return { kind: uri[1] as SpotifyKind, id: uri[2]! };
  try {
    const url = new URL(s);
    if (url.hostname !== "open.spotify.com" && url.hostname !== "play.spotify.com") return null;
    const m = url.pathname.match(/\/(playlist|album|track)\/([A-Za-z0-9]{22})(?:\/|$)/);
    return m ? { kind: m[1] as SpotifyKind, id: m[2]! } : null;
  } catch {
    return null;
  }
}

/** What YouTube Music is searched for: title and lead artist, without "- Remastered 2011" and "(feat. …)". */
export function spotifyQuery(t: SpotifyTrack): string {
  const title = t.title
    .replace(/\s+-\s+.*\b(remaster(ed)?|version|mono|stereo|edit|mix|featured|from|soundtrack|bonus)\b.*$/i, "")
    .replace(/\s*[([](feat\.?|ft\.?|with)\s[^)\]]*[)\]]/gi, "")
    .trim();
  return [title || t.title, t.artists[0]].filter(Boolean).join(" ");
}

// Login

interface Token {
  access: string;
  refresh: string;
  /** ms since epoch. */
  expires: number;
}

const read = <T>(key: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
};

/** Where Spotify sends the browser back. It must be listed, exactly, in the Spotify app's Redirect URIs. */
export const redirectUri = () => `${location.origin}${CALLBACK_PATH}`;

/**
 * Why logging in can't work from this address, or null. Spotify only accepts https addresses and loopback IPs
 * (127.0.0.1, not "localhost"), and the Android app's address is neither.
 */
export function loginBlocker(): "native" | "localhost" | "insecure" | null {
  if (!capabilities.spotifyLogin) return "native";
  if (location.hostname === "localhost") return "localhost";
  if (location.protocol !== "https:" && location.hostname !== "127.0.0.1" && location.hostname !== "[::1]") return "insecure";
  return null;
}

interface SpotifyAuth {
  clientId: string;
  token: Token | null;
  setClientId: (id: string) => void;
  logout: () => void;
}

export const useSpotify = create<SpotifyAuth>((set) => ({
  clientId: read<string>(CLIENT_KEY) ?? "",
  token: read<Token>(TOKEN_KEY),
  setClientId: (clientId) => {
    write(CLIENT_KEY, clientId.trim() || null);
    set({ clientId: clientId.trim() });
  },
  logout: () => {
    write(TOKEN_KEY, null);
    set({ token: null });
  },
}));

const saveToken = (token: Token | null) => {
  write(TOKEN_KEY, token);
  useSpotify.setState({ token });
};

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const randomString = (n: number) => base64url(crypto.getRandomValues(new Uint8Array(n)));

/** Sends the browser to Spotify's login; it comes back to CALLBACK_PATH, then to `returnTo`. */
export async function login(returnTo: string) {
  const clientId = useSpotify.getState().clientId;
  if (!clientId) return;
  const verifier = randomString(48);
  const state = randomString(16);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  write(PENDING_KEY, { verifier, state, returnTo });
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}

async function tokenRequest(body: Record<string, string>): Promise<Token> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: useSpotify.getState().clientId, ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  return {
    access: data.access_token,
    refresh: data.refresh_token ?? body.refresh_token ?? "",
    expires: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
}

/** Finishes the login on CALLBACK_PATH. Returns where to go next. */
export async function finishLogin(search: string): Promise<string> {
  const params = new URLSearchParams(search);
  const pending = read<{ verifier: string; state: string; returnTo: string }>(PENDING_KEY);
  write(PENDING_KEY, null);
  if (!pending || params.get("state") !== pending.state) throw new Error("state");
  const error = params.get("error");
  if (error) throw new Error(error);
  const code = params.get("code");
  if (!code) throw new Error("code");
  saveToken(
    await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: pending.verifier }),
  );
  return pending.returnTo;
}

async function accessToken(): Promise<string> {
  const token = useSpotify.getState().token;
  if (!token) throw new SpotifyLoggedOut();
  if (Date.now() < token.expires) return token.access;
  try {
    const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: token.refresh });
    saveToken(fresh);
    return fresh.access;
  } catch {
    saveToken(null);
    throw new SpotifyLoggedOut();
  }
}

export class SpotifyLoggedOut extends Error {
  constructor() {
    super("Logged out of Spotify");
  }
}

/** A Web API GET. Null when Spotify refuses this item (not the user's playlist, region, removed). */
async function get<T>(path: string): Promise<T | null> {
  const url = path.startsWith("https://") ? path : `${API}${path}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` } });
  if (res.status === 401) {
    saveToken(null);
    throw new SpotifyLoggedOut();
  }
  if (res.status === 403 || res.status === 404) return null;
  if (res.status === 429) {
    // Rate limited: wait as asked (capped), then once more.
    const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 10);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return get(path);
  }
  if (!res.ok) throw new Error(`Spotify HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface Page<T> {
  items: T[];
  next: string | null;
  total: number;
}

/** Every page of a paged list, up to `max` items. */
async function all<T>(first: string, max: number): Promise<{ items: T[]; total: number } | null> {
  const items: T[] = [];
  let next: string | null = first;
  let total = 0;
  while (next && items.length < max) {
    const page: Page<T> | null = await get<Page<T>>(next);
    if (!page) return items.length ? { items, total } : null;
    total = page.total;
    items.push(...page.items);
    next = page.next;
  }
  return { items: items.slice(0, max), total };
}

interface ApiTrack {
  type?: string;
  name?: string;
  duration_ms?: number;
  artists?: { name?: string }[];
}

const toTrack = (t: ApiTrack | null | undefined): SpotifyTrack | null =>
  t && t.name && (t.type ?? "track") === "track"
    ? { title: t.name, artists: (t.artists ?? []).map((a) => a.name ?? "").filter(Boolean), duration: Math.round((t.duration_ms ?? 0) / 1000) }
    : null;

export interface MyPlaylist {
  /** "liked" for Liked Songs. */
  id: string;
  name: string;
  image: string;
  total: number | null;
}

export async function myPlaylists(): Promise<MyPlaylist[]> {
  const list = await all<{
    id: string;
    name: string;
    images?: { url?: string }[] | null;
    items?: { total?: number };
    tracks?: { total?: number };
  } | null>("/me/playlists?limit=50", 500);
  const liked = await get<Page<unknown>>("/me/tracks?limit=1");
  return [
    { id: "liked", name: "", image: "", total: liked?.total ?? null },
    ...(list?.items ?? [])
      .filter((p): p is NonNullable<typeof p> => !!p?.id)
      .map((p) => ({
        id: p.id,
        name: p.name,
        image: p.images?.[0]?.url ?? "",
        total: p.items?.total ?? p.tracks?.total ?? null,
      })),
  ];
}

/** Liked Songs, newest first. */
async function likedSongs(name: string): Promise<SpotifyList> {
  const page = await all<{ track?: ApiTrack }>("/me/tracks?limit=50", IMPORT_LIMIT);
  const tracks = (page?.items ?? []).map((e) => toTrack(e.track)).filter((t): t is SpotifyTrack => !!t);
  return { kind: "playlist", id: "liked", name, image: "", tracks, truncated: (page?.total ?? 0) > IMPORT_LIMIT };
}

/** A playlist through the Web API, or null when Spotify only gives its details (someone else's playlist). */
async function playlistViaApi(id: string): Promise<SpotifyList | null> {
  const meta = await get<{ name?: string; images?: { url?: string }[] | null }>(`/playlists/${id}?fields=name,images`);
  if (!meta) return null;
  const page = await all<{ item?: ApiTrack; track?: ApiTrack }>(`/playlists/${id}/items?limit=50`, IMPORT_LIMIT);
  if (!page) return null;
  const tracks = page.items.map((e) => toTrack(e.item ?? e.track)).filter((t): t is SpotifyTrack => !!t);
  return { kind: "playlist", id, name: meta.name ?? "Spotify", image: meta.images?.[0]?.url ?? "", tracks, truncated: page.total > IMPORT_LIMIT };
}

/**
 * The tracks behind a Spotify link or one of the user's playlists. Logged in, playlists come in full from the
 * Web API when Spotify allows it; everything else (and everyone not logged in) goes through the public embed.
 */
export async function loadSpotify(kind: SpotifyKind | "liked", id: string, likedName: string, signal?: AbortSignal): Promise<SpotifyList> {
  const loggedIn = !!useSpotify.getState().token;
  if (kind === "liked") return likedSongs(likedName);
  if (kind === "playlist" && loggedIn) {
    try {
      const full = await playlistViaApi(id);
      if (full) return full;
    } catch (e) {
      if (!(e instanceof SpotifyLoggedOut)) console.warn("Spotify API failed, using the public page", e);
    }
  }
  return api.spotify(kind, id, signal);
}
