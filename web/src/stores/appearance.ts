import { create } from "zustand";
import { accentCss, DEFAULT_ACCENT, isHex, VOLT } from "../lib/accent";

/** How the app looks and what it shows, per device. The Now Playing panel lives in the UI store (it has a button too). */
export interface Appearance {
  accent: string;
  sidebarPlaylists: boolean;
  compactSidebar: boolean;
  albumColumn: boolean;
  texture: boolean;
  homeShortcuts: boolean;
  homeRecent: boolean;
  homeFavorites: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  accent: DEFAULT_ACCENT,
  sidebarPlaylists: true,
  compactSidebar: false,
  albumColumn: true,
  texture: true,
  homeShortcuts: true,
  homeRecent: true,
  homeFavorites: true,
};

/** Ready-made accents. "mono" is the default; "volt" is upstream Musike's own. */
export const ACCENTS = [
  { id: "mono", color: DEFAULT_ACCENT },
  { id: "volt", color: VOLT },
  { id: "mint", color: "#34d399" },
  { id: "aqua", color: "#22d3ee" },
  { id: "sky", color: "#60a5fa" },
  { id: "violet", color: "#a78bfa" },
  { id: "pink", color: "#f472b6" },
  { id: "coral", color: "#fb7c5c" },
  { id: "amber", color: "#fbbf24" },
] as const;

const KEY = "musike:appearance";
// The accent CSS itself, so index.html can apply it before the app loads (no flash of the default colour).
const CSS_KEY = "musike:accent-css";

/** Keeps only known keys with the right types: the value may come from an old version or a backup file. */
export function cleanAppearance(input: unknown): Appearance {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Appearance = { ...DEFAULT_APPEARANCE };
  if (isHex(v.accent)) out.accent = v.accent.toLowerCase();
  for (const k of Object.keys(DEFAULT_APPEARANCE) as (keyof Appearance)[]) {
    if (k !== "accent" && typeof v[k] === "boolean") (out[k] as boolean) = v[k];
  }
  return out;
}

const T3_LOOK_KEY = "musike:t3-look";

function read(): Appearance {
  try {
    const saved = cleanAppearance(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
    // Once: settings saved before the T3 look hold upstream's default lime only because it was the default.
    if (!localStorage.getItem(T3_LOOK_KEY)) {
      localStorage.setItem(T3_LOOK_KEY, "1");
      if (saved.accent === VOLT) saved.accent = DEFAULT_ACCENT;
    }
    return saved;
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/** Applies what CSS needs: the accent colours and two switches read by stylesheets (compact rail, texture). */
function apply(a: Appearance) {
  const root = document.documentElement;
  const custom = a.accent !== DEFAULT_ACCENT;
  let style = document.getElementById("musike-accent");
  if (custom) {
    style ??= Object.assign(document.createElement("style"), { id: "musike-accent" });
    style.textContent = accentCss(a.accent);
    document.head.appendChild(style);
  } else {
    style?.remove();
  }
  if (a.compactSidebar) root.dataset.rail = "compact";
  else delete root.dataset.rail;
  if (a.texture) delete root.dataset.texture;
  else root.dataset.texture = "off";
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
    if (custom) localStorage.setItem(CSS_KEY, accentCss(a.accent));
    else localStorage.removeItem(CSS_KEY);
  } catch {
    /* private mode */
  }
}

interface AppearanceState extends Appearance {
  set: (patch: Partial<Appearance>) => void;
  reset: () => void;
}

const initial = read();
apply(initial);

export const useAppearance = create<AppearanceState>((set, get) => ({
  ...initial,
  set: (patch) => {
    const { set: _s, reset: _r, ...current } = get();
    const next = cleanAppearance({ ...current, ...patch });
    apply(next);
    set(next);
  },
  reset: () => {
    apply(DEFAULT_APPEARANCE);
    set({ ...DEFAULT_APPEARANCE });
  },
}));

/** The current preferences without the store's functions (for backups). */
export function currentAppearance(): Appearance {
  const { set: _s, reset: _r, ...a } = useAppearance.getState();
  return a;
}
