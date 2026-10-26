import type { AlbumCard, AlbumPage, ArtistPage, Genre, GenreArtist, GenrePage, Library, Playlist, SpotifyKind, SpotifyList, Track } from "./types";

/**
 * What the app needs from a backend. The web app and the desktop app talk to the Musike server over HTTP
 * (lib/api.ts); the Android app does the same work on the phone (native/api.ts). The build picks one.
 */

export type ErrorCode = "tool_missing" | "maybe_outdated" | "bot_check";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: ErrorCode) {
    super(message);
  }
}

export type Channel = "stable" | "nightly";

export interface ImportResult {
  playlistsAdded: number;
  playlistsMerged: number;
  tracksAdded: number;
  favoritesAdded: number;
}

export interface SystemJob {
  kind: "update" | "install";
  channel: Channel;
  status: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  from: string | null;
  to: string | null;
  message: string;
  log: string[];
}

export interface SystemInfo {
  ytdlp: {
    path: string | null;
    version: string | null;
    channel: Channel;
    latest: Record<Channel, string | null>;
    updateAvailable: boolean;
  };
  deno: string | null;
  ffmpeg: string | null;
  canInstall: boolean;
  job: SystemJob | null;
}

export interface Prepared {
  id: string;
  title: string;
  duration: number;
  hasSdVideo: boolean;
}

/**
 * The operating system's media controls (notification, lock screen, headphone buttons) when the browser's
 * Media Session can't reach them: the Android app. Absent elsewhere.
 */
export interface SystemMedia {
  setTrack(track: { title: string; artist: string; album: string; artwork: string }): void;
  setState(state: { playing: boolean; position: number; duration: number }): void;
  onAction(handler: (action: "play" | "pause" | "next" | "previous" | "seek", position?: number) => void): void;
}

export interface MusikeApi {
  search(q: string, type: "song" | "video", signal?: AbortSignal): Promise<Track[]>;
  suggest(q: string, signal?: AbortSignal): Promise<string[]>;
  radio(id: string): Promise<Track[]>;
  genres(): Promise<Genre[]>;
  genre(id: string, signal?: AbortSignal): Promise<GenrePage>;
  genreArtists(id: string, offset: number): Promise<{ artists: GenreArtist[]; hasMore: boolean }>;
  artist(id: string, signal?: AbortSignal): Promise<ArtistPage>;
  album(id: string, signal?: AbortSignal): Promise<AlbumPage>;
  searchAlbums(q: string, signal?: AbortSignal): Promise<AlbumCard[]>;
  /** The artist page ID for a name (tracks that don't carry it). */
  findArtist(name: string): Promise<string>;
  /** The album page ID for a title and artist (tracks that don't carry it). */
  findAlbum(title: string, artist: string): Promise<string>;
  /** The music video matching a song, or null when YouTube has none. */
  videoFor(t: Track): Promise<Track | null>;
  prepare(id: string, signal?: AbortSignal): Promise<Prepared>;
  /** dB above the -14 LUFS reference (YouTube's own measurement), or null when unknown. */
  loudness(id: string): Promise<number | null>;
  /** A public Spotify playlist, album or song, read without an account (up to 1000 tracks). */
  spotify(kind: SpotifyKind, id: string, signal?: AbortSignal): Promise<SpotifyList>;

  library(): Promise<Library>;
  addFavorite(t: Track): Promise<{ favorites: Track[] }>;
  addFavorites(tracks: Track[]): Promise<{ favorites: Track[] }>;
  removeFavorite(id: string): Promise<{ favorites: Track[] }>;
  pushHistory(t: Track): Promise<{ history: Track[] }>;
  createPlaylist(name: string, tracks?: Track[]): Promise<Playlist>;
  renamePlaylist(id: string, name: string): Promise<Playlist>;
  deletePlaylist(id: string): Promise<void>;
  addToPlaylist(id: string, t: Track | Track[]): Promise<Playlist>;
  removeFromPlaylist(id: string, trackId: string): Promise<Playlist>;
  /** Saves a new track order (track IDs). */
  reorderPlaylist(id: string, ids: string[]): Promise<Playlist>;
  importLibrary(backup: unknown, mode: "merge" | "replace"): Promise<ImportResult>;

  system(): Promise<SystemInfo>;
  updateYtdlp(channel: Channel): Promise<SystemJob>;
}
