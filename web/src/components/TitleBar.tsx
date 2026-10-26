import { desktop } from "../lib/desktop";
import { selectCurrent, usePlayer } from "../player/player";
import { Equalizer } from "./Brand";
import { ArtistLinks } from "./MusicLinks";

/**
 * Title bar for the desktop app. The window is frameless; Windows and Linux draw their native buttons over the
 * right end (the "titlebar area" env variables tell us how much room they take), macOS its traffic lights
 * over the left end.
 */
export function TitleBar() {
  const track = usePlayer(selectCurrent);
  const live = usePlayer((s) => s.status === "playing");

  return (
    <div
      className="app-drag flex shrink-0 items-center select-none"
      style={{
        height: "env(titlebar-area-height, 40px)",
        paddingRight: "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 12px)",
      }}
    >
      {/* Phones and narrow windows have no sidebar: make room for macOS's traffic lights there. */}
      {desktop?.platform === "darwin" && <span aria-hidden="true" className="w-[84px] shrink-0 md:hidden" />}
      {track && (
        <span className="flex min-w-0 items-center gap-2 px-4 text-xs text-fg-2 md:px-6">
          <Equalizer live={live} className="h-3 shrink-0" />
          <span className="truncate">
            <span className="text-fg">{track.title}</span>
            {track.artist && (
              <span className="app-no-drag text-fg-3">
                {" / "}
                <ArtistLinks track={track} />
              </span>
            )}
          </span>
        </span>
      )}
    </div>
  );
}
