import { config } from "./config.js";
import { msg } from "./i18n.js";
import { HttpError } from "./types.js";

/**
 * Spotify playlists, albums and songs, read from Spotify's public embed page (the player sites put in an <iframe>).
 * No account and no API key: the page carries the track list as JSON, plus an anonymous token. Playlists stop at
 * their first 100 tracks there; the rest comes 100 at a time from the web player's own API with that token.
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
/** The most tracks one import reads (the app's matching takes a moment per song). */
export const IMPORT_LIMIT = 1000;
const PAGE = 100;
// The web player's "fetchPlaylist" query. Undocumented: if Spotify changes it, imports stop at 100 tracks again.
const PATHFINDER = "https://api-partner.spotify.com/pathfinder/v2/query";
const FETCH_PLAYLIST = "bb67e0af06e8d6f52b531f97468ee4acd44cd0f82b988e15c2ea47b1148efc77";

interface EmbedSession {
  accessToken?: string;
}

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

interface PathfinderItem {
  itemV2?: {
    data?: {
      __typename?: string;
      name?: string;
      artists?: { items?: { profile?: { name?: string } }[] };
      trackDuration?: { totalMilliseconds?: number };
    };
  };
}

/** One page of a playlist through the web player's API, or null when it refuses. */
async function playlistPage(id: string, token: string, offset: number): Promise<{ tracks: SpotifyTrack[]; total: number } | null> {
  try {
    const res = await (config.fetch ?? fetch)(PATHFINDER, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "app-platform": "WebPlayer", "user-agent": UA },
      body: JSON.stringify({
        operationName: "fetchPlaylist",
        variables: { uri: `spotify:playlist:${id}`, offset, limit: PAGE, enableWatchFeedEntrypoint: false },
        extensions: { persistedQuery: { version: 1, sha256Hash: FETCH_PLAYLIST } },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const content = (await res.json())?.data?.playlistV2?.content as { items?: PathfinderItem[]; totalCount?: number } | undefined;
    if (!content?.items) return null;
    const tracks = content.items.flatMap((i): SpotifyTrack[] => {
      const t = i.itemV2?.data;
      if (t?.__typename !== "Track" || !t.name) return [];
      const artists = (t.artists?.items ?? []).map((a) => a.profile?.name ?? "").filter(Boolean);
      return [{ title: t.name, artists, duration: Math.round((t.trackDuration?.totalMilliseconds ?? 0) / 1000) }];
    });
    return { tracks, total: content.totalCount ?? 0 };
  } catch {
    return null;
  }
}

/** The tracks after the embed's first 100, page by page. Stops early (keeping what came) if Spotify refuses one. */
async function restOfPlaylist(id: string, token: string, have: number): Promise<{ tracks: SpotifyTrack[]; complete: boolean }> {
  const tracks: SpotifyTrack[] = [];
  for (let offset = have; offset < IMPORT_LIMIT; offset += PAGE) {
    const page = await playlistPage(id, token, offset);
    if (!page) return { tracks, complete: false };
    tracks.push(...page.tracks);
    if (offset + PAGE >= page.total || !page.tracks.length) return { tracks, complete: true };
  }
  return { tracks, complete: false };
}

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
  let session: EmbedSession | undefined;
  try {
    const state = json ? JSON.parse(json)?.props?.pageProps?.state : undefined;
    entity = state?.data?.entity;
    session = state?.settings?.session;
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
  if (kind !== "playlist" || tracks.length < EMBED_LIMIT) return { kind, id, name, image, tracks, truncated: false };

  // A full first page: there may be more.
  const rest = session?.accessToken ? await restOfPlaylist(id, session.accessToken, tracks.length) : { tracks: [], complete: false };
  return { kind, id, name, image, tracks: [...tracks, ...rest.tracks].slice(0, IMPORT_LIMIT), truncated: !rest.complete };
}
