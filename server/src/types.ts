/** One of a track's artists, with its YouTube Music page when known. */
export interface TrackArtist {
  name: string;
  id?: string;
}

export interface Track {
  id: string;
  title: string;
  /** Display line: every artist, comma-separated. */
  artist: string;
  /** The same artists one by one, with their pages when known (tracks saved before 1.6 have none). */
  artists?: TrackArtist[];
  album?: string;
  albumId?: string;
  duration: number;
  thumb: string;
  art: string;
  kind: "song" | "video";
}

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  tracks: Track[];
  /** When each track was added, by track ID (playlists from before 1.6 have none, or only for newer tracks). */
  added?: Record<string, number>;
}

export interface Library {
  favorites: Track[];
  playlists: Playlist[];
  history: Track[];
}

import { tr, type Text } from "./i18n.js";

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const ALBUM_ID = /^MPRE[\w-]{6,60}$/;
export const ARTIST_ID = /^UC[\w-]{22}$/;

/** Machine-readable reason so the web app can offer the right fix (e.g. "update yt-dlp"). */
export type ErrorCode = "tool_missing" | "maybe_outdated" | "bot_check";

/** An error for the person using the app: its text is translated into each request's language when sent. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public text: Text,
    public code?: ErrorCode,
  ) {
    super(tr("en", text));
  }
}
