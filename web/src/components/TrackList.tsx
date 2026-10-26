import { ClockIcon, DotsSixVerticalIcon, DotsThreeIcon, HeartIcon, VideoCameraIcon } from "@phosphor-icons/react";
import { Reorder, useDragControls, type DragControls } from "motion/react";
import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import type { Track } from "../lib/types";
import { selectCurrent, usePlayer } from "../player/player";
import { useAppearance } from "../stores/appearance";
import { useLibrary } from "../stores/library";
import { useUi } from "../stores/ui";
import { Artwork } from "./Artwork";
import { Equalizer } from "./Brand";
import { AlbumLink, ArtistLinks } from "./MusicLinks";

/** What a row needs to be dragged into a new place (playlists in their own order). */
interface Reorderable {
  /** Saves the order the drag left. */
  onDrop: () => void;
  /** Moves the row one place up (-1) or down (1), for keyboards. */
  onMove: (track: Track, by: -1 | 1) => void;
}

interface RowProps {
  track: Track;
  position: number;
  onPlay: () => void;
  playlistId?: string;
  showAlbum: boolean;
  reorder?: Reorderable;
}

/** A plain list item, or one that can be dragged when the list is being reordered. */
function RowRoot({ track, reorder, controls, ...props }: { track: Track; reorder?: Reorderable; controls: DragControls; className: string; onContextMenu: (e: MouseEvent) => void; children: ReactNode }) {
  if (!reorder) return <li {...props} />;
  return (
    <Reorder.Item
      as="li"
      value={track}
      dragListener={false}
      dragControls={controls}
      onDragEnd={reorder.onDrop}
      whileDrag={{ scale: 1.01, boxShadow: "0 12px 32px rgb(0 0 0 / 0.35)", zIndex: 20 }}
      style={{ position: "relative" }}
      {...props}
    />
  );
}

const TrackRow = memo(function TrackRow({ track, position, onPlay, playlistId, showAlbum, reorder }: RowProps) {
  const isCurrent = usePlayer((s) => selectCurrent(s)?.id === track.id);
  const isPlaying = usePlayer((s) => s.status === "playing" || s.status === "loading");
  const isFavorite = useLibrary((s) => s.favorites.some((t) => t.id === track.id));
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const openMenu = useUi((s) => s.openMenu);
  const controls = useDragControls();
  const t = useT();

  const grab = (e: PointerEvent) => {
    e.preventDefault();
    controls.start(e);
  };
  const nudge = (e: KeyboardEvent) => {
    if (!reorder || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    e.stopPropagation();
    reorder.onMove(track, e.key === "ArrowUp" ? -1 : 1);
  };
  // The grip: on its own on phones, in place of the number on larger screens.
  const handleProps = reorder && {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": t.trackList.moveX(track.title),
    title: t.trackList.dragToMove,
    onPointerDown: grab,
    onKeyDown: nudge,
    "data-track-handle": track.id,
  };

  const menuAt = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fromButton = e.type === "click";
    openMenu({ track, playlistId, x: fromButton ? r.right - 256 : e.clientX, y: fromButton ? r.bottom + 6 : e.clientY });
  };

  return (
    <RowRoot
      track={track}
      reorder={reorder}
      controls={controls}
      onContextMenu={menuAt}
      className={cn(
        "group relative grid items-center gap-3 rounded-xl px-2 py-1.5 transition-colors duration-150 hover:bg-surface-2 md:px-3",
        // Opaque while it can be dragged, so the rows it passes over don't show through.
        reorder ? "grid-cols-[24px_auto_1fr_auto] bg-bg" : "grid-cols-[auto_1fr_auto]",
        showAlbum
          ? "md:grid-cols-[28px_auto_1fr_auto_auto] lg:grid-cols-[28px_auto_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]"
          : "md:grid-cols-[28px_auto_1fr_auto_auto]",
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={t.common.playX(track.title)}
        className="absolute inset-0 rounded-xl focus-visible:outline-offset-[-2px]"
      />

      {handleProps && (
        <span {...handleProps} className="relative z-10 -ml-1 grid h-11 cursor-grab touch-none place-items-center text-fg-3 md:hidden">
          <DotsSixVerticalIcon size={20} weight="bold" />
        </span>
      )}

      {handleProps ? (
        <span
          {...handleProps}
          className="relative z-10 hidden h-9 cursor-grab touch-none items-center justify-center rounded-md font-mono text-[13px] text-fg-3 tabular-nums hover:text-fg active:cursor-grabbing md:flex"
        >
          <span className="group-hover:hidden group-focus-within:hidden">{isCurrent ? <Equalizer live={isPlaying} /> : position + 1}</span>
          <DotsSixVerticalIcon size={18} weight="bold" className="hidden group-hover:block group-focus-within:block" />
        </span>
      ) : (
        <span className="pointer-events-none hidden justify-center font-mono text-[13px] text-fg-3 tabular-nums md:flex">
          {isCurrent ? <Equalizer live={isPlaying} /> : position + 1}
        </span>
      )}

      <div className="pointer-events-none relative">
        <Artwork src={track.thumb} className="size-11 rounded-[10px]" />
        {isCurrent && (
          <span className="absolute inset-0 grid place-items-center rounded-[10px] bg-black/45 md:hidden">
            <Equalizer live={isPlaying} />
          </span>
        )}
      </div>

      <div className="pointer-events-none min-w-0">
        <p className={cn("truncate text-[15px] leading-tight font-medium", isCurrent ? "text-accent-text" : "text-fg")}>
          {track.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-fg-2">
          {track.kind === "video" && <VideoCameraIcon size={13} className="shrink-0 text-fg-3" aria-label={t.common.video} />}
          <ArtistLinks track={track} fallback={t.common.youtube} className="truncate" />
        </p>
      </div>

      {showAlbum && (
        <p className="pointer-events-none hidden truncate text-sm text-fg-2 lg:block">
          <AlbumLink track={track} />
        </p>
      )}

      <div className="relative z-10 hidden items-center gap-1 md:flex">
        <button
          type="button"
          onClick={() => void toggleFavorite(track)}
          aria-label={isFavorite ? t.common.removeFromFavorites : t.common.addToFavorites}
          title={isFavorite ? t.common.removeFromFavorites : t.common.addToFavorites}
          className={cn(
            "grid size-8 place-items-center rounded-full transition-[opacity,transform] active:scale-90",
            isFavorite ? "text-accent-text" : "text-fg-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-fg",
          )}
        >
          <HeartIcon size={17} weight={isFavorite ? "fill" : "regular"} />
        </button>
        <span className="pointer-events-none w-11 text-right font-mono text-[13px] text-fg-3 tabular-nums">
          {track.duration ? formatTime(track.duration) : ""}
        </span>
      </div>

      <button
        type="button"
        onClick={menuAt}
        aria-label={t.trackList.moreFor(track.title)}
        title={t.trackList.more}
        className="relative z-10 grid size-9 place-items-center rounded-full text-fg-2 transition-[opacity,background-color] hover:bg-surface-3 hover:text-fg md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
      >
        <DotsThreeIcon size={22} weight="bold" />
      </button>
    </RowRoot>
  );
});

interface ListProps {
  tracks: Track[];
  /** Full list to queue when a row is played, if `tracks` is only a preview of it. */
  context?: Track[];
  playlistId?: string;
  showAlbum?: boolean;
  header?: boolean;
  /** Lets the rows be dragged (or moved with the arrow keys) into a new order, saved through this. */
  onReorder?: (tracks: Track[]) => void;
}

export function TrackList({ tracks, context, playlistId, showAlbum: albumWanted = true, header = true, onReorder }: ListProps) {
  const playList = usePlayer((s) => s.playList);
  const t = useT();
  // Pages ask for the album column where it makes sense; Settings can turn it off everywhere.
  const showAlbum = useAppearance((s) => s.albumColumn) && albumWanted;

  // While dragging, the order lives here; it's saved once the row is dropped.
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const [order, setOrder] = useState(tracks);
  const orderRef = useRef(tracks);
  const saveRef = useRef(onReorder);
  saveRef.current = onReorder;
  useEffect(() => {
    orderRef.current = tracks;
    setOrder(tracks);
  }, [tracks]);
  const [reorder] = useState<Reorderable>(() => ({
    onDrop: () => {
      const next = orderRef.current;
      if (next.some((x, i) => x !== tracksRef.current[i])) saveRef.current?.(next);
    },
    onMove: (track, by) => {
      const list = [...orderRef.current];
      const from = list.indexOf(track);
      const to = from + by;
      if (from < 0 || to < 0 || to >= list.length) return;
      list.splice(to, 0, ...list.splice(from, 1));
      orderRef.current = list;
      setOrder(list);
      saveRef.current?.(list);
      // Keep the keyboard on the row that moved.
      requestAnimationFrame(() =>
        [...document.querySelectorAll<HTMLElement>(`[data-track-handle="${track.id}"]`)].find((h) => h.offsetParent)?.focus(),
      );
    },
  }));
  const shown = onReorder ? order : tracks;
  const rows = shown.map((t, i) => (
    <TrackRow
      key={onReorder ? t.id : `${t.id}-${i}`}
      track={t}
      position={i}
      playlistId={playlistId}
      showAlbum={showAlbum}
      reorder={onReorder ? reorder : undefined}
      onPlay={() => playList(context ?? shown, i)}
    />
  ));
  return (
    <div>
      {header && (
        <div
          className={cn(
            "mb-1 hidden items-center gap-3 border-b border-line px-3 pb-2 text-xs font-medium tracking-wide text-fg-3 md:grid",
            showAlbum
              ? "md:grid-cols-[28px_44px_1fr_auto_auto] lg:grid-cols-[28px_44px_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]"
              : "md:grid-cols-[28px_44px_1fr_auto_auto]",
          )}
        >
          <span className="text-center font-mono">#</span>
          <span />
          <span>{t.trackList.title}</span>
          {showAlbum && <span className="hidden lg:block">{t.trackList.album}</span>}
          <span className="flex w-[84px] justify-end pr-0.5">
            <ClockIcon size={15} aria-label={t.trackList.duration} />
          </span>
          <span className="w-9" />
        </div>
      )}
      {onReorder ? (
        <Reorder.Group
          as="ul"
          axis="y"
          values={order}
          onReorder={(next: Track[]) => {
            orderRef.current = next;
            setOrder(next);
          }}
          className="flex flex-col"
        >
          {rows}
        </Reorder.Group>
      ) : (
        <ul className="flex flex-col">{rows}</ul>
      )}
    </div>
  );
}

export function TrackListSkeleton({ rows = 8 }: { rows?: number }) {
  const t = useT();
  return (
    <ul aria-label={t.common.loading} className="flex flex-col gap-1">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-1.5 md:px-3">
          <span className="hidden w-7 md:block" />
          <span className="skeleton size-11 rounded-[10px]" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="skeleton h-3.5 rounded-full" style={{ width: `${46 + ((i * 17) % 38)}%` }} />
            <span className="skeleton h-3 rounded-full" style={{ width: `${22 + ((i * 11) % 20)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
