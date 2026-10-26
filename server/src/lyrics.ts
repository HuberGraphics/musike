import { config } from "./config.js";
import { msg } from "./i18n.js";
import { HttpError } from "./types.js";

/**
 * Song lyrics from LRCLIB (lrclib.net): a free, open database with no key, most of it time-synced (LRC).
 * Shared by the server and the phone apps, like search.
 */

export interface LyricLine {
  /** Seconds from the start of the song; 0 for every line of unsynced lyrics. */
  time: number;
  text: string;
}

export interface Lyrics {
  /** Whether each line has its own time, so the app can follow along. */
  synced: boolean;
  instrumental: boolean;
  lines: LyricLine[];
}

interface LrclibRecord {
  trackName: string;
  artistName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

const API = "https://lrclib.net/api";
// LRCLIB asks apps to say who they are.
const HEADERS = { "user-agent": "Musike (https://github.com/Ernani1234/musike)" };

/** "Song (Official Video) [HD]", "Song (feat. X)", "Song - Remastered 2011" → "Song". */
function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([][^)\]]*(official|video|audio|lyric|visuali[sz]er|clipe|hd|4k|remaster|feat\.?|ft\.?)[^)\]]*[)\]]/gi, "")
    .replace(/\s+-\s+.*(remaster|version|mix|edit|live|mono|stereo).*$/i, "")
    .replace(/\s+(feat\.?|ft\.?)\s.*$/i, "")
    .trim();
}

/** Video titles carry the artist ("Artist - Song (Official Video)"); YouTube Music songs don't. */
function splitTitle(title: string, artist: string, kind: "song" | "video"): { title: string; artist: string } {
  const mainArtist = artist.split(",")[0]?.trim() ?? "";
  if (kind === "video") {
    const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (m) return { artist: m[1]!.trim(), title: cleanTitle(m[2]!) };
  }
  return { title: cleanTitle(title), artist: mainArtist.replace(/\s*(VEVO|- Topic)$/i, "") };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");

/** "[01:23.45]text", with several stamps on one line when it repeats. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.slice(stamps.at(-1)!.index! + stamps.at(-1)![0].length).trim();
    for (const s of stamps) lines.push({ time: Number(s[1]) * 60 + Number(s[2]!.replace(":", ".")), text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

function toLyrics(r: LrclibRecord): Lyrics | null {
  if (r.syncedLyrics?.trim()) {
    const lines = parseLrc(r.syncedLyrics);
    if (lines.length) return { synced: true, instrumental: false, lines };
  }
  if (r.plainLyrics?.trim()) {
    return { synced: false, instrumental: false, lines: r.plainLyrics.split(/\r?\n/).map((text) => ({ time: 0, text: text.trim() })) };
  }
  return r.instrumental ? { synced: false, instrumental: true, lines: [] } : null;
}

async function lrclib<T>(path: string, params: Record<string, string>): Promise<T | null> {
  let res: Response;
  try {
    res = await (config.fetch ?? fetch)(`${API}/${path}?${new URLSearchParams(params)}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, msg("lyricsUnavailable"));
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, msg("lyricsUnavailable"));
  return (await res.json()) as T;
}

/** The search result for this song: same title and artist, closest length, synced lyrics first. */
function pick(results: LrclibRecord[], title: string, artist: string, duration: number): LrclibRecord | null {
  const wantTitle = norm(title);
  const wantArtist = norm(artist);
  let best: { r: LrclibRecord; score: number } | null = null;
  for (const r of results) {
    if (!toLyrics(r)) continue;
    const t = norm(r.trackName);
    if (!t.includes(wantTitle) && !wantTitle.includes(t)) continue;
    const a = norm(r.artistName);
    if (wantArtist && !a.includes(wantArtist) && !wantArtist.includes(a)) continue;
    let score = t === wantTitle ? 2 : 0;
    if (r.syncedLyrics) score += 3;
    if (duration && r.duration) {
      const diff = Math.abs(r.duration - duration);
      // Synced lyrics for a different cut of the song (radio edit, live) drift out of time.
      if (diff > 15) continue;
      score += diff <= 3 ? 3 : 1;
    }
    if (!best || score > best.score) best = { r, score };
  }
  return best?.r ?? null;
}

const cache = new Map<string, Lyrics | null>();
const CACHE_MAX = 300;

/** Lyrics for a track, or null when LRCLIB has none. */
export async function lyricsFor(id: string, rawTitle: string, rawArtist: string, duration: number, kind: "song" | "video"): Promise<Lyrics | null> {
  if (cache.has(id)) return cache.get(id)!;
  const { title, artist } = splitTitle(rawTitle, rawArtist, kind);

  // The exact match first: LRCLIB's own lookup by title, artist and length (within a couple of seconds).
  // It sometimes answers 503 for songs its search finds fine, so a failure here just moves on to the search.
  let found: Lyrics | null = null;
  if (duration) {
    const exact = await lrclib<LrclibRecord>("get", { track_name: title, artist_name: artist, duration: String(Math.round(duration)) }).catch(
      () => null,
    );
    found = exact ? toLyrics(exact) : null;
  }
  if (!found?.synced) {
    const results = (await lrclib<LrclibRecord[]>("search", { track_name: title, artist_name: artist })) ?? [];
    const best = pick(results, title, artist, duration);
    if (best && (!found || best.syncedLyrics)) found = toLyrics(best);
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(id, found);
  return found;
}
