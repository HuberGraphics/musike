import { Fragment, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useT } from "../i18n";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import type { Track, TrackArtist } from "../lib/types";
import { toast } from "../stores/ui";

/**
 * Artist and album names that open their pages, wherever a track is shown (like YouTube Music and Spotify).
 * Tracks found since 1.6 carry the pages' IDs; older ones, Spotify imports and plain videos only have names,
 * so those are looked up on YouTube Music on click (and remembered for the session).
 */

/** The track's artists one by one: its own list, or the display line split at its commas. */
export function trackArtists(track: Track): TrackArtist[] {
  if (track.artists?.length) return track.artists;
  return track.artist
    .split(/,\s+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

const artistIds = new Map<string, string>();
const albumIds = new Map<string, string>();

/** Opens artist and album pages, looking up the ones a track doesn't know. */
export function useGoTo() {
  const navigate = useNavigate();
  const t = useT();

  const resolve = async (cache: Map<string, string>, key: string, find: () => Promise<string>) => {
    const known = cache.get(key);
    if (known) return known;
    const id = await find();
    cache.set(key, id);
    return id;
  };

  return {
    artist: async (a: TrackArtist) => {
      try {
        const id = a.id ?? (await resolve(artistIds, a.name.toLowerCase(), () => api.findArtist(a.name)));
        navigate(paths.artist(id), { state: { name: a.name } });
      } catch {
        toast(t.links.artistNotFound(a.name), "error");
      }
    },
    album: async (track: Track) => {
      if (!track.album) return;
      try {
        const id =
          track.albumId ??
          (await resolve(albumIds, `${track.album}\n${track.artist}`.toLowerCase(), () =>
            api.findAlbum(track.album!, trackArtists(track)[0]?.name ?? ""),
          ));
        navigate(paths.album(id), { state: { name: track.album } });
      } catch {
        toast(t.links.albumNotFound(track.album), "error");
      }
    },
  };
}

// Inside rows that play on click, a link must stay clickable and not also start the track.
const linkClass = "pointer-events-auto relative z-10 cursor-pointer rounded-sm hover:text-fg hover:underline focus-visible:underline";

const stop = (e: MouseEvent, then: () => void) => {
  e.preventDefault();
  e.stopPropagation();
  then();
};

/** "Artist A, Artist B", each opening its page. Falls back to `fallback` for tracks without an artist. */
export function ArtistLinks({ track, fallback, className }: { track: Track; fallback?: ReactNode; className?: string }) {
  const go = useGoTo();
  const t = useT();
  const artists = trackArtists(track);
  if (!artists.length) return <>{fallback ?? null}</>;
  return (
    <span className={className}>
      {artists.map((a, i) => (
        <Fragment key={`${a.name}-${i}`}>
          {i > 0 && ", "}
          <a
            href={a.id ? paths.artist(a.id) : undefined}
            role="link"
            tabIndex={0}
            title={t.links.goToArtist(a.name)}
            onClick={(e) => stop(e, () => void go.artist(a))}
            onKeyDown={(e) => e.key === "Enter" && stop(e as unknown as MouseEvent, () => void go.artist(a))}
            className={linkClass}
          >
            {a.name}
          </a>
        </Fragment>
      ))}
    </span>
  );
}

/** The album's name, opening its page. Nothing for tracks without an album. */
export function AlbumLink({ track, className }: { track: Track; className?: string }) {
  const go = useGoTo();
  const t = useT();
  if (!track.album) return null;
  return (
    <a
      href={track.albumId ? paths.album(track.albumId) : undefined}
      role="link"
      tabIndex={0}
      title={t.links.goToAlbum(track.album)}
      onClick={(e) => stop(e, () => void go.album(track))}
      onKeyDown={(e) => e.key === "Enter" && stop(e as unknown as MouseEvent, () => void go.album(track))}
      className={cn(linkClass, className)}
    >
      {track.album}
    </a>
  );
}
