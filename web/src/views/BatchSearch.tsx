import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CheckIcon,
  ListBulletsIcon,
  PlaylistIcon,
  SpotifyLogoIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { create } from "zustand";
import { Artwork } from "../components/Artwork";
import { EmptyState, PageHeader } from "../components/Page";
import { SelectableRow, SelectedCount, SelectionBar } from "../components/Selection";
import { api } from "../lib/api";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import { spotifyQuery } from "../lib/spotify";
import type { SpotifyList, Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";

const MAX_TERMS = 50;
/** Results kept per term, so a wrong first match can be swapped for the right one. */
const OPTIONS = 5;
const CONCURRENCY = 3;
/** The server takes this many tracks per request. */
const CHUNK = 500;

/** "a, b\nc, a" → ["a", "b", "c"]. Commas or line breaks separate songs; repeats are dropped. */
export function parseList(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter((s) => {
      const key = s.toLocaleLowerCase("pt-BR");
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_TERMS);
}

interface Entry {
  query: string;
  /** Seconds, when the list came with it (Spotify): picks the result of the same length. */
  duration?: number;
  /** The original's artists, when the list came with them: picks a result by the same artist. */
  artists?: string[];
  status: "loading" | "ok" | "empty" | "error";
  options: Track[];
  pick: number;
  selected: boolean;
}

/** Where an imported list came from, to save it under its own name. */
interface Source {
  name: string;
  image: string;
  truncated: boolean;
  /** The Musike playlist it was saved as. */
  saved?: string;
}

interface Term {
  query: string;
  duration?: number;
  artists?: string[];
}

interface BatchState {
  text: string;
  entries: Entry[];
  source: Source | null;
  setText: (text: string) => void;
  run: (terms: Term[], source?: Source) => Promise<void>;
  setSaved: (id: string) => void;
  retry: (i: number) => void;
  update: (i: number, patch: Partial<Entry>) => void;
  selectAll: (on: boolean) => void;
}

// Bumped on every new run, so slow answers from an older list never land in the new one.
let runId = 0;

// Module-level store: the list survives leaving the page to play or check a playlist and coming back.
const useBatch = create<BatchState>((set, get) => {
  const lookup = async (id: number, i: number) => {
    const entry = get().entries[i];
    if (!entry) return;
    get().update(i, { status: "loading" });
    try {
      const options = (await api.search(entry.query, "song")).slice(0, OPTIONS);
      if (id !== runId) return;
      const { pick, sure } = pickBest(options, entry);
      get().update(i, options.length ? { status: "ok", options, pick, selected: sure } : { status: "empty", options, selected: false });
    } catch {
      if (id === runId) get().update(i, { status: "error", selected: false });
    }
  };

  return {
    text: "",
    entries: [],
    source: null,
    setText: (text) => set({ text }),
    setSaved: (saved) => set((s) => ({ source: s.source && { ...s.source, saved } })),
    update: (i, patch) => set((s) => ({ entries: s.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) })),
    selectAll: (on) => set((s) => ({ entries: s.entries.map((e) => (e.status === "ok" ? { ...e, selected: on } : e)) })),
    retry: (i) => void lookup(runId, i),
    run: async (terms, source) => {
      const id = ++runId;
      set({
        source: source ?? null,
        entries: terms.map((term): Entry => ({ ...term, status: "loading", options: [], pick: 0, selected: false })),
      });
      // A few at a time: fast enough, without hammering YouTube with 50 searches at once.
      let next = 0;
      const worker = async () => {
        while (id === runId && next < terms.length) await lookup(id, next++);
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, terms.length) }, worker));
    },
  };
});

/** Starts matching an imported Spotify list. The page shows it once opened (paths.searchList). */
export function importSpotify(list: SpotifyList) {
  useBatch.getState().setText("");
  void useBatch.getState().run(
    list.tracks.map((t) => ({ query: spotifyQuery(t), duration: t.duration || undefined, artists: t.artists })),
    { name: list.name, image: list.image, truncated: list.truncated },
  );
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/**
 * For lists that say what they expect (imports): the first result by the same artist and as long as the original
 * (±4 s), else the best of the two. The top hit is usually right, but a live or extended version, or a cover when
 * YouTube Music lacks the song, sometimes ranks first. A result by another artist is kept but left unselected, so
 * it isn't saved without a look. Typed lists take the first result, selected.
 */
function pickBest(options: Track[], { duration, artists }: Entry): { pick: number; sure: boolean } {
  if (!duration && !artists?.length) return { pick: 0, sure: true };
  const names = (artists ?? []).map(fold).filter(Boolean);
  const score = (o: Track) => {
    const artist = fold(o.artist);
    const byArtist = names.some((n) => artist.includes(n) || (artist && n.includes(artist)));
    const sameLength = !!duration && !!o.duration && Math.abs(o.duration - duration) <= 4;
    return (byArtist ? 2 : 0) + (sameLength ? 1 : 0);
  };
  let pick = 0;
  options.forEach((o, i) => {
    if (score(o) > score(options[pick]!)) pick = i;
  });
  // Same length alone isn't enough when the artist is known: covers and karaoke versions are timed to the original.
  const best = options.length ? score(options[pick]!) : 0;
  return { pick, sure: names.length ? best >= 2 : best > 0 };
}

/** The chosen track of each found (or only each selected) entry, without repeats: two names can find the same song. */
function pickedTracks(entries: Entry[], onlySelected: boolean): Track[] {
  const seen = new Set<string>();
  return entries
    .filter((e) => e.status === "ok" && (e.selected || !onlySelected))
    .map((e) => e.options[e.pick])
    .filter((t): t is Track => !!t && !seen.has(t.id) && !!seen.add(t.id));
}

export default function BatchSearch() {
  const { text, entries, source, setText, run, selectAll } = useBatch();
  const location = useLocation();
  const navigate = useNavigate();
  const input = useRef<HTMLTextAreaElement>(null);
  const t = useT();

  const terms = parseList(text);
  const chosen = pickedTracks(entries, true);
  const found = pickedTracks(entries, false);
  const pending = entries.some((e) => e.status === "loading");
  const allSelected = found.length > 0 && entries.every((e) => e.status !== "ok" || e.selected);

  const submit = () => {
    if (!terms.length) return;
    input.current?.blur();
    void run(terms.map((query) => ({ query })));
  };

  // Arriving from the regular search with a comma-separated query: search it right away.
  useEffect(() => {
    const incoming = (location.state as { text?: string } | null)?.text;
    if (!incoming) return;
    setText(incoming);
    void run(parseList(incoming).map((query) => ({ query })));
    navigate(".", { replace: true, state: null });
  }, []);

  return (
    <div className="pb-8">
      <PageHeader
        title={t.batch.title}
        actions={
          <Link
            to={paths.search}
            className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-fg-2 hover:bg-surface-3 hover:text-fg"
          >
            <ArrowLeftIcon size={16} /> {t.batch.simple}
          </Link>
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3 px-4 pt-1 md:px-6"
      >
        <label htmlFor="batch-input" className="text-sm text-fg-2">
          {t.batch.label}
        </label>
        <textarea
          id="batch-input"
          ref={input}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter searches; Shift+Enter keeps the line break for one-per-line lists.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t.batch.placeholder}
          className="scroll-area min-h-24 w-full resize-y rounded-[20px] border border-line-strong bg-surface-2 px-5 py-3.5 text-[16px] placeholder:text-fg-3 focus:border-accent focus:bg-surface-1 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-fg-3">
            {terms.length === MAX_TERMS ? t.batch.max(MAX_TERMS) : terms.length ? t.common.songs(terms.length) : ""}
          </span>
          <button
            type="submit"
            disabled={!terms.length}
            className="h-11 rounded-full bg-accent px-6 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-40"
          >
            {terms.length > 1 ? t.batch.searchN(terms.length) : t.batch.search}
          </button>
        </div>
      </form>

      {source && <SourceBanner source={source} tracks={found} pending={pending} />}

      {entries.length > 0 && (
        <>
          <SelectionBar
            className="mt-4"
            chosen={chosen}
            all={found}
            allSelected={allSelected}
            onToggleAll={() => selectAll(!allSelected)}
            label={pending ? t.batch.searching(found.length, entries.length) : <SelectedCount n={chosen.length} total={entries.length} />}
          />

          <ul className="mt-2 flex flex-col px-2 md:px-3">
            {entries.map((e, i) => (
              <EntryRow key={`${i}-${e.query}`} entry={e} index={i} />
            ))}
          </ul>
        </>
      )}

      {entries.length === 0 && (
        <EmptyState
          icon={<ListBulletsIcon size={28} />}
          title={t.batch.emptyTitle}
          body={t.batch.emptyBody}
        />
      )}
    </div>
  );
}

/** "Imported from Spotify: <name>", with saving every found song as a playlist of the same name. */
function SourceBanner({ source, tracks, pending }: { source: Source; tracks: Track[]; pending: boolean }) {
  const createPlaylist = useLibrary((s) => s.createPlaylist);
  const addToPlaylist = useLibrary((s) => s.addToPlaylist);
  const setSaved = useBatch((s) => s.setSaved);
  const [saving, setSaving] = useState(false);
  const t = useT();

  const save = async () => {
    setSaving(true);
    const p = await createPlaylist(source.name, tracks.slice(0, CHUNK));
    for (let i = CHUNK; p && i < tracks.length; i += CHUNK) await addToPlaylist(p.id, tracks.slice(i, i + CHUNK));
    setSaving(false);
    if (p) setSaved(p.id);
  };

  return (
    <div className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-[16px] bg-surface-2 p-3 ring-1 ring-line md:mx-6">
      {source.image ? (
        <Artwork src={source.image} className="size-12 rounded-[10px]" />
      ) : (
        <span className="grid size-12 place-items-center rounded-[10px] bg-surface-3 text-accent-text">
          <SpotifyLogoIcon size={24} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] text-fg-2">
          <SpotifyLogoIcon size={14} /> {t.spotify.fromSpotify}
        </span>
        <span className="block truncate font-medium">{source.name}</span>
        {source.truncated && <span className="block text-[13px] text-fg-3">{t.spotify.truncated}</span>}
      </span>
      {source.saved ? (
        <Link
          to={paths.playlist(source.saved)}
          className="flex h-10 items-center gap-2 rounded-full bg-accent-soft px-4 text-sm font-medium text-accent-text"
        >
          {t.album.openPlaylist} <ArrowRightIcon size={16} />
        </Link>
      ) : (
        <button
          type="button"
          disabled={saving || pending || !tracks.length}
          onClick={() => void save()}
          title={pending ? t.spotify.waitForMatches : undefined}
          className="flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-50"
        >
          <PlaylistIcon size={18} /> {t.spotify.saveAs(tracks.length)}
        </button>
      )}
    </div>
  );
}

function EntryRow({ entry, index }: { entry: Entry; index: number }) {
  const update = useBatch((s) => s.update);
  const retry = useBatch((s) => s.retry);
  const playTrack = usePlayer((s) => s.playTrack);
  const [open, setOpen] = useState(false);
  const track = entry.options[entry.pick];
  const t = useT();

  if (entry.status === "loading") {
    return (
      <li className="flex items-center gap-3 px-2 py-1.5 md:px-3">
        <span className="size-6 shrink-0" />
        <span className="skeleton size-11 shrink-0 rounded-[10px]" />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-[15px] text-fg-3">{entry.query}</span>
          <span className="skeleton h-3 w-1/4 rounded-full" />
        </span>
      </li>
    );
  }

  if (!track) {
    return (
      <li className="flex items-center gap-3 px-2 py-1.5 md:px-3">
        <span className="size-6 shrink-0" />
        <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-fg-3">
          <WarningCircleIcon size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{entry.query}</span>
          <span className="block text-[13px] text-fg-2">{entry.status === "empty" ? t.batch.notFound : t.batch.failed}</span>
        </span>
        <button
          type="button"
          onClick={() => retry(index)}
          className="h-9 rounded-full bg-surface-3 px-4 text-sm font-medium hover:bg-surface-4"
        >
          {t.common.retry}
        </button>
      </li>
    );
  }

  return (
    <li className="flex flex-col">
      <SelectableRow
        track={track}
        selected={entry.selected}
        onToggle={() => update(index, { selected: !entry.selected })}
        onPlay={() => playTrack(track)}
        note={<span className="text-fg-3">{t.batch.searched(entry.query)}</span>}
        trailing={
          entry.options.length > 1 && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              title={t.batch.swap}
              className="flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm text-fg-2 hover:bg-surface-3 hover:text-fg"
            >
              <ArrowsClockwiseIcon size={16} />
              <span className="hidden sm:inline">{t.batch.swapShort}</span>
              <CaretDownIcon size={12} className={cn("transition-transform", open && "rotate-180")} />
            </button>
          )
        }
      />

      {open && (
        <ul className="mb-2 ml-11 flex flex-col border-l border-line pl-2 md:ml-12">
          {entry.options.map((opt, j) => (
            <li key={opt.id}>
              <button
                type="button"
                onClick={() => {
                  update(index, { pick: j, selected: true });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-surface-2"
              >
                <Artwork src={opt.thumb} className="size-9 rounded-[8px]" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm font-medium", j === entry.pick && "text-accent-text")}>{opt.title}</span>
                  <span className="block truncate text-[13px] text-fg-2">
                    {[opt.artist, opt.album].filter(Boolean).join(" · ") || t.common.youtube}
                  </span>
                </span>
                {j === entry.pick && <CheckIcon size={16} className="text-accent-text" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
