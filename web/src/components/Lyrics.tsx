import { ArrowsClockwiseIcon, CrosshairIcon } from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { getT, useT } from "../i18n";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/format";
import type { Lyrics, Track } from "../lib/types";
import { usePlayer } from "../player/player";

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "done"; lyrics: Lyrics | null };

// Switching tabs or reopening the sheet shouldn't ask again.
const cache = new Map<string, Lyrics | null>();

function useLyrics(track: Track): [Loaded, () => void] {
  const [loaded, setLoaded] = useState<Loaded>(() =>
    cache.has(track.id) ? { state: "done", lyrics: cache.get(track.id)! } : { state: "loading" },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cache.has(track.id)) return setLoaded({ state: "done", lyrics: cache.get(track.id)! });
    setLoaded({ state: "loading" });
    const ctrl = new AbortController();
    api.lyrics(track, ctrl.signal).then(
      (lyrics) => {
        cache.set(track.id, lyrics);
        setLoaded({ state: "done", lyrics });
      },
      (e: Error) => {
        if (e.name !== "AbortError") setLoaded({ state: "error", message: e instanceof ApiError ? e.message : getT().player.serverDown });
      },
    );
    return () => ctrl.abort();
    // The track's ID is what matters; the object changes identity when the queue is saved.
  }, [track.id, attempt]);

  return [loaded, () => setAttempt((n) => n + 1)];
}

// The stored position trails the media element by up to a fifth of a second: light each line up slightly early.
const LEAD = 0.25;
/** After scrolling by hand, the view stays put this long before following the song again. */
const FOLLOW_PAUSE_MS = 5000;

/** The line being sung: the last one that has started. */
function activeLine(lines: Lyrics["lines"], position: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.time <= position + LEAD) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function SyncedLines({ lyrics, big }: { lyrics: Lyrics; big: boolean }) {
  const t = useT();
  const position = usePlayer((s) => s.position);
  const seek = usePlayer((s) => s.seek);
  const reduce = useReducedMotion();
  const current = activeLine(lyrics.lines, position);
  const root = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const resume = useRef<ReturnType<typeof setTimeout>>(undefined);

  const pauseFollowing = () => {
    setFollowing(false);
    clearTimeout(resume.current);
    resume.current = setTimeout(() => setFollowing(true), FOLLOW_PAUSE_MS);
  };
  useEffect(() => () => clearTimeout(resume.current), []);

  // Keep the current line in the middle of whatever scrolls (the panel, the drawer or the phone sheet).
  useEffect(() => {
    if (!following) return;
    const el = root.current;
    const line = el?.querySelector<HTMLElement>(`[data-line="${Math.max(0, current)}"]`);
    const box = el?.closest<HTMLElement>(".scroll-area");
    if (!line || !box) return;
    const lineRect = line.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const top = box.scrollTop + lineRect.top - boxRect.top - boxRect.height / 2 + lineRect.height / 2;
    box.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  }, [current, following, reduce]);

  return (
    <div ref={root} onWheel={pauseFollowing} onTouchMove={pauseFollowing} className="relative">
      {/* Room above and below, so the first and last lines can sit in the middle too. */}
      <div className="h-[28vh]" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        {lyrics.lines.map((line, i) => (
          <button
            key={i}
            type="button"
            data-line={i}
            aria-current={i === current ? "true" : undefined}
            aria-label={line.text ? t.lyrics.seekTo(line.text) : undefined}
            onClick={() => {
              seek(line.time);
              setFollowing(true);
              clearTimeout(resume.current);
            }}
            className={cn(
              "rounded-lg px-2 py-1.5 text-left font-semibold tracking-tight transition-[color,opacity] duration-300 hover:bg-surface-1",
              big ? "text-[26px] leading-[1.25]" : "text-[22px] leading-[1.3]",
              i === current ? "text-fg" : i < current ? "text-fg-3" : "text-fg-2 opacity-70",
            )}
          >
            {line.text || "♪"}
          </button>
        ))}
      </div>
      <p className="px-2 pt-8 text-xs text-fg-3">{t.lyrics.source}</p>
      <div className="h-[28vh]" aria-hidden="true" />
      {!following && (
        <div className="pointer-events-none sticky bottom-3 flex justify-center">
          <button
            type="button"
            onClick={() => {
              clearTimeout(resume.current);
              setFollowing(true);
            }}
            className="pointer-events-auto flex h-9 items-center gap-2 rounded-full bg-surface-4 px-4 text-sm font-medium shadow-lg ring-1 ring-line"
          >
            <CrosshairIcon size={16} /> {t.lyrics.follow}
          </button>
        </div>
      )}
    </div>
  );
}

/** The current track's lyrics: following the song line by line when they're synced, as plain text when not. */
export function LyricsView({ track, big = false }: { track: Track; big?: boolean }) {
  const t = useT();
  const [loaded, retry] = useLyrics(track);

  if (loaded.state === "loading") {
    return <p className="px-2 py-16 text-center text-sm text-fg-2">{t.lyrics.loading}</p>;
  }
  if (loaded.state === "error") {
    return (
      <div className="flex flex-col items-center gap-3 px-2 py-16 text-center">
        <p className="text-sm text-fg-2">{loaded.message}</p>
        <button
          type="button"
          onClick={retry}
          className="flex h-9 items-center gap-2 rounded-lg bg-surface-1 px-4 text-sm font-medium ring-1 ring-line hover:bg-surface-3"
        >
          <ArrowsClockwiseIcon size={16} /> {t.lyrics.retry}
        </button>
      </div>
    );
  }
  const { lyrics } = loaded;
  if (!lyrics || (!lyrics.instrumental && !lyrics.lines.length)) {
    return <p className="px-2 py-16 text-center text-sm text-fg-2">{t.lyrics.none}</p>;
  }
  if (lyrics.instrumental) {
    return <p className="px-2 py-16 text-center text-sm text-fg-2">{t.lyrics.instrumental}</p>;
  }
  if (lyrics.synced) return <SyncedLines key={track.id} lyrics={lyrics} big={big} />;
  return (
    <div className="px-2 py-4">
      <p className="pb-4 text-xs text-fg-3">{t.lyrics.unsynced}</p>
      <div className={cn("font-medium whitespace-pre-line text-fg-2", big ? "text-lg leading-relaxed" : "text-base leading-relaxed")}>
        {lyrics.lines.map((l) => l.text).join("\n")}
      </div>
      <p className="pt-8 text-xs text-fg-3">{t.lyrics.source}</p>
    </div>
  );
}
