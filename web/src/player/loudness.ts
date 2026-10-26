import { api, capabilities } from "../lib/api";

/**
 * Volume normalization: every song and video plays at the same perceived loudness, -14 LUFS (where YouTube and
 * Spotify normalize to). YouTube measures each upload; the gain is the difference, applied through Web Audio so
 * quiet tracks can be raised too (by at most MAX_BOOST, with a limiter so nothing clips), not just lowered.
 *
 * Only for streams served by the Musike server: Web Audio silences cross-origin media, which is how the phone
 * apps play (capabilities.normalize).
 */

const MAX_BOOST = 6;
const MAX_CUT = -20;

let ctx: AudioContext | null = null;
let limiter: DynamicsCompressorNode | null = null;
const gains = new Map<HTMLMediaElement, GainNode>();
const known = new Map<string, Promise<number | null>>();

function graph(): AudioContext | null {
  if (!capabilities.normalize || typeof AudioContext === "undefined") return null;
  if (!ctx) {
    ctx = new AudioContext();
    // A brick-wall-ish limiter just under full scale: only boosted peaks ever reach it.
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    limiter.connect(ctx.destination);
  }
  return ctx;
}

/** The element's gain stage, created on first use (an element can only be routed into Web Audio once). */
function gainFor(media: HTMLMediaElement): GainNode | null {
  if (!(media instanceof HTMLMediaElement)) return null; // iOS's native player stand-in
  const context = graph();
  if (!context || !limiter) return null;
  let gain = gains.get(media);
  if (!gain) {
    gain = context.createGain();
    context.createMediaElementSource(media).connect(gain);
    gain.connect(limiter);
    gains.set(media, gain);
  }
  return gain;
}

/** Web Audio starts suspended until the page has been interacted with: call on every play. */
export function resumeAudio() {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

/** The gain in dB that brings a video to the reference loudness, or 0 when unknown. */
export function gainDbFor(id: string): Promise<number> {
  let lookup = known.get(id);
  if (!lookup) {
    lookup = api.loudness(id).catch(() => {
      known.delete(id); // offline for a moment: ask again next time
      return null;
    });
    known.set(id, lookup);
  }
  return lookup.then((db) => (db === null ? 0 : Math.max(MAX_CUT, Math.min(MAX_BOOST, -db))));
}

/**
 * Sets `media`'s normalization for the video `id` (or none when `on` is false). The element plays at unity gain
 * until the measurement arrives, usually before its first sound; then it glides to the new level.
 */
export function normalize(media: HTMLMediaElement, id: string, on: boolean): Promise<void> {
  const gain = gainFor(media);
  if (!gain || !ctx) return Promise.resolve();
  resumeAudio();
  if (!on) {
    gain.gain.setTargetAtTime(1, ctx.currentTime, 0.05);
    return Promise.resolve();
  }
  return gainDbFor(id).then((db) => {
    if (!ctx) return;
    gain.gain.setTargetAtTime(10 ** (db / 20), ctx.currentTime, 0.05);
  });
}

/** Whether normalization can work in this build (for showing the setting). */
export const canNormalize = () => capabilities.normalize && typeof AudioContext !== "undefined";
