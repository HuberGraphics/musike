import { desktop } from "../lib/desktop";
import { cn } from "../lib/format";
import { selectCurrent, usePlayer } from "../player/player";
import { Equalizer } from "./Brand";

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
      {/* As wide as the sidebar below, so the playing track lines up with the page content, like T3's breadcrumb. */}
      <span aria-hidden="true" className={cn("shrink-0 md:w-[68px] wide:w-[248px]", desktop?.platform === "darwin" && "min-w-[84px]")} />
      {track && (
        <span className="flex min-w-0 items-center gap-2 px-4 text-xs text-fg-2 md:px-6">
          <Equalizer live={live} className="h-3 shrink-0" />
          <span className="truncate">
            <span className="text-fg">{track.title}</span>
            {track.artist && <span className="text-fg-3"> / {track.artist}</span>}
          </span>
        </span>
      )}
    </div>
  );
}
