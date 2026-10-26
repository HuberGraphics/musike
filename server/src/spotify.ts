import { config } from "./config.js";
import { msg } from "./i18n.js";
import { HttpError } from "./types.js";

/**
 * Spotify playlists, albums and songs, read from Spotify's public embed page (the player sites put in an <iframe>).
 * No account and no API key: the page carries the track list as JSON. Playlists stop at their first 100 tracks
 * there; the app's optional Spotify login reads longer ones (web/src/lib/spotify.ts).
 */

export type SpotifyKind = "playlist" | "album" | "track";

export const SPOTIFY_KINDS: readonly SpotifyKind[] = ["playlist", "album", "track"];
export const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

export interface SpotifyTrack {
  title: string;
  artists: string[];
  /** Seconds. */
  duration: number;
}

export interface SpotifyList {
  kind: SpotifyKind;
  id: string;
  name: string;
  image: string;
  tracks: SpotifyTrack[];
  /** The embed page showed only part of the list (playlists over 100 tracks). */
  truncated: boolean;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EMBED_LIMIT = 100;

interface EmbedEntity {
  type?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  artists?: { name?: string }[];
  coverArt?: { sources?: { url?: string }[] };
  visualIdentity?: { image?: { url?: string }[] };
  trackList?: { title?: string; subtitle?: string; duration?: number; entityType?: string }[];
}

/** "KAROL G, Judeline" → ["KAROL G", "Judeline"]: the embed joins artists with a comma and a no-break space. */
const splitArtists = (s = "") =>
  s
    .split(/, /)
    .map((a) => a.trim())
    .filter(Boolean);

export async function spotifyList(kind: SpotifyKind, id: string): Promise<SpotifyList> {
  if (!SPOTIFY_KINDS.includes(kind) || !SPOTIFY_ID.test(id)) throw new HttpError(400, msg("invalidSpotifyLink"));

  let html: string;
  try {
    const res = await (config.fetch ?? fetch)(`https://open.spotify.com/embed/${kind}/${id}`, {
      headers: { "user-agent": UA, "accept-language": "en" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) throw new HttpError(404, msg("spotifyNotFound"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, msg("spotifyUnavailable"));
  }

  const json = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  let entity: EmbedEntity | undefined;
  try {
    entity = json ? JSON.parse(json)?.props?.pageProps?.state?.data?.entity : undefined;
  } catch {
    entity = undefined;
  }
  // An unknown ID still gets a page, just without an entity.
  if (!entity || entity.type !== kind) throw new HttpError(404, msg("spotifyNotFound"));

  const name = entity.name || entity.title || "Spotify";
  const image = entity.coverArt?.sources?.[0]?.url ?? entity.visualIdentity?.image?.at(-1)?.url ?? "";

  if (kind === "track") {
    const artists = (entity.artists ?? []).map((a) => a.name ?? "").filter(Boolean);
    const tracks = [{ title: name, artists, duration: Math.round((entity.duration ?? 0) / 1000) }];
    return { kind, id, name, image, tracks, truncated: false };
  }

  const tracks = (entity.trackList ?? [])
    .filter((t) => t.title && (t.entityType ?? "track") === "track")
    .map((t) => ({ title: t.title!, artists: splitArtists(t.subtitle), duration: Math.round((t.duration ?? 0) / 1000) }));
  return { kind, id, name, image, tracks, truncated: kind === "playlist" && tracks.length >= EMBED_LIMIT };
}
