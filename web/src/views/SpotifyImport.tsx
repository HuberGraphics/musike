import { CopyIcon, HeartIcon, SignOutIcon, SpotifyLogoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Artwork } from "../components/Artwork";
import { BackButton, PageHeader } from "../components/Page";
import { useT } from "../i18n";
import { paths } from "../lib/routes";
import {
  finishLogin,
  loadSpotify,
  login,
  loginBlocker,
  myPlaylists,
  parseSpotifyLink,
  redirectUri,
  SpotifyLoggedOut,
  useSpotify,
  type MyPlaylist,
} from "../lib/spotify";
import type { SpotifyKind } from "../lib/types";
import { toast } from "../stores/ui";
import { importSpotify } from "./BatchSearch";

/**
 * Import from Spotify: paste a link (no account), or log in and pick one of your playlists or Liked Songs.
 * The tracks then go to "Search a list", which matches each on YouTube Music and saves them as a playlist.
 */
export default function SpotifyImport() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const open = async (kind: SpotifyKind | "liked", id: string) => {
    setBusy(id);
    setError("");
    try {
      const list = await loadSpotify(kind, id, t.spotify.likedSongs);
      if (!list.tracks.length) {
        setError(t.spotify.noTracks);
        return;
      }
      importSpotify(list);
      navigate(paths.searchList);
    } catch (e) {
      setError(e instanceof SpotifyLoggedOut ? t.spotify.loggedOut : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const submit = (text = link) => {
    const parsed = parseSpotifyLink(text);
    if (!parsed) {
      setError(/spotify\.link|spoti\.fi/.test(text) ? t.spotify.shortLink : t.spotify.badLink);
      return;
    }
    input.current?.blur();
    void open(parsed.kind, parsed.id);
  };

  // Arriving from the search box with a pasted Spotify link: import it right away.
  useEffect(() => {
    const incoming = (location.state as { link?: string } | null)?.link;
    if (!incoming) return;
    setLink(incoming);
    submit(incoming);
    navigate(".", { replace: true, state: null });
  }, []);

  return (
    <div className="pb-8">
      <PageHeader title={t.spotify.title} actions={<BackButton fallback={paths.search} />} />

      <div className="flex flex-col gap-6 px-4 pt-1 md:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3"
        >
          <label htmlFor="spotify-link" className="text-sm text-fg-2">
            {t.spotify.linkLabel}
          </label>
          <div className="flex gap-2">
            <input
              id="spotify-link"
              ref={input}
              type="url"
              inputMode="url"
              autoComplete="off"
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setError("");
              }}
              placeholder="https://open.spotify.com/playlist/…"
              className="h-12 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-2 px-5 text-[16px] placeholder:text-fg-3 focus:border-accent focus:bg-surface-1 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!link.trim() || !!busy}
              className="h-12 shrink-0 rounded-lg bg-accent px-6 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-40"
            >
              {busy && busy === parseSpotifyLink(link)?.id ? t.common.loading : t.spotify.import}
            </button>
          </div>
          <p className="text-[13px] text-fg-3">{t.spotify.linkHint}</p>
          {error && (
            <p role="alert" className="flex items-center gap-2 text-sm text-danger">
              <WarningCircleIcon size={16} className="shrink-0" /> {error}
            </p>
          )}
        </form>

        <Account busy={busy} onOpen={(kind, id) => void open(kind, id)} />
      </div>
    </div>
  );
}

function Account({ busy, onOpen }: { busy: string | null; onOpen: (kind: SpotifyKind | "liked", id: string) => void }) {
  const t = useT();
  const { clientId, token, setClientId, logout } = useSpotify();
  const [draft, setDraft] = useState(clientId);
  const [playlists, setPlaylists] = useState<MyPlaylist[] | "loading" | "error">("loading");
  const blocker = loginBlocker();

  useEffect(() => {
    if (!token) return;
    let live = true;
    setPlaylists("loading");
    myPlaylists()
      .then((list) => live && setPlaylists(list))
      .catch(() => live && setPlaylists("error"));
    return () => {
      live = false;
    };
  }, [!!token]);

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-surface-2 p-4 ring-1 ring-line md:p-5">
      <div className="flex items-center gap-3">
        <SpotifyLogoIcon size={24} className="shrink-0 text-accent-text" />
        <h2 className="flex-1 font-semibold">{t.spotify.accountTitle}</h2>
        {token && (
          <button
            type="button"
            onClick={logout}
            className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fg-2 hover:bg-surface-3 hover:text-fg"
          >
            <SignOutIcon size={16} /> {t.spotify.logout}
          </button>
        )}
      </div>

      {blocker ? (
        <p className="text-sm text-fg-2">{t.spotify.blocked[blocker]}</p>
      ) : !token ? (
        <>
          <p className="text-sm text-fg-2">{t.spotify.accountBody}</p>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-fg-2">
            <li>
              {t.spotify.step1}{" "}
              <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" className="text-accent-text underline">
                developer.spotify.com/dashboard
              </a>
            </li>
            <li>
              {t.spotify.step2}
              <span className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-1 px-3 py-2 font-mono text-[13px] text-fg ring-1 ring-line">
                  {redirectUri()}
                </code>
                <button
                  type="button"
                  aria-label={t.spotify.copy}
                  title={t.spotify.copy}
                  onClick={() => void navigator.clipboard?.writeText(redirectUri()).then(() => toast(t.spotify.copied))}
                  className="grid size-9 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-surface-3 hover:text-fg"
                >
                  <CopyIcon size={16} />
                </button>
              </span>
            </li>
            <li>{t.spotify.step3}</li>
          </ol>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setClientId(draft);
              if (draft.trim()) void login(paths.spotify);
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <label htmlFor="spotify-client" className="sr-only">
              Client ID
            </label>
            <input
              id="spotify-client"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Client ID"
              autoComplete="off"
              spellCheck={false}
              className="h-11 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-1 px-4 font-mono text-[14px] placeholder:font-sans placeholder:text-fg-3 focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={!/^[0-9a-f]{32}$/i.test(draft.trim())}
              className="h-11 shrink-0 rounded-lg bg-accent px-5 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-40"
            >
              {t.spotify.login}
            </button>
          </form>
          <p className="text-[13px] text-fg-3">{t.spotify.premiumNote}</p>
        </>
      ) : playlists === "loading" ? (
        <ul className="flex flex-col gap-1">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 px-2 py-1.5">
              <span className="skeleton size-11 rounded-[10px]" />
              <span className="skeleton h-3 w-1/3 rounded-full" />
            </li>
          ))}
        </ul>
      ) : playlists === "error" ? (
        <p className="text-sm text-danger">{t.spotify.playlistsFailed}</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {playlists.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => onOpen(p.id === "liked" ? "liked" : "playlist", p.id)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-surface-3 disabled:opacity-60"
              >
                {p.id === "liked" ? (
                  <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-accent text-accent-ink">
                    <HeartIcon size={20} weight="fill" />
                  </span>
                ) : (
                  <Artwork src={p.image} className="size-11 rounded-[10px]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{p.id === "liked" ? t.spotify.likedSongs : p.name}</span>
                  <span className="block truncate text-[13px] text-fg-2">
                    {busy === p.id
                      ? t.common.loading
                      : p.total !== null && t.common.songs(p.total)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Spotify sends the browser back here after logging in. */
export function SpotifyCallback() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    // Once: the code can only be exchanged one time (StrictMode runs effects twice in development).
    if (started.current) return;
    started.current = true;
    finishLogin(location.search)
      .then((to) => navigate(to || paths.spotify, { replace: true }))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="pb-8">
      <PageHeader title={t.spotify.title} actions={<BackButton fallback={paths.spotify} />} />
      <p className="px-4 text-sm text-fg-2 md:px-6">{error ? t.spotify.loginFailed(error) : t.spotify.loggingIn}</p>
    </div>
  );
}
