// SPDX-License-Identifier: GPL-3.0-only
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useT } from "../i18n";
import type { PlayableMedia } from "../services/player";
import { formatTime } from "../services/time";
import AudioOrb from "./AudioOrb";
import Icon from "./Icons";

const SPEEDS = [1, 1.25, 1.5, 2, 0.5, 0.75];
const VOLUME_KEY = "cleangrab.volume";

function readVolume(): number {
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    const value = stored === null ? NaN : Number(stored);
    if (Number.isFinite(value)) return Math.min(1, Math.max(0, value));
  } catch {
    // Storage can be unavailable.
  }
  return 0.8;
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
const clock = (seconds: number) => formatTime(Math.max(0, Math.floor(seconds)));

/** A range slider that shows how far it is filled. */
const fillOf = (value: number, max: number) => ({ "--fill": `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }) as CSSProperties;

/** A box in window pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Room kept around the small player, and its size: a video gets a little screen, a song a slim bar. */
const MINI_MARGIN = 16;
const MINI_VIDEO = { width: 300, height: 169 + 52 };
const MINI_AUDIO = { width: 340, height: 64 };

/** How much room the small player takes at the bottom of the window (the pages leave it free). */
export const miniDock = (kind: PlayableMedia["kind"]) => (kind === "video" ? MINI_VIDEO : MINI_AUDIO).height + MINI_MARGIN * 2;

/** The window's size, kept up to date. */
function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

interface MediaPlayerProps {
  media: PlayableMedia;
  /** What is shown as the name of the file. */
  title: string;
  /**
   * "full": laid over `slot`, the room the Player page keeps for it. "mini": a small player in the
   * corner of the window, for when another page is showing. "pending": not shown yet (the page is
   * still working out where it goes).
   */
  mode: "full" | "mini" | "pending";
  /** Where the full player goes, in window pixels. */
  slot: Box | null;
  /** Whether to start playing by itself. */
  autoPlay: boolean;
  /** Goes back to the Player page. */
  onExpand: () => void;
  /** Stops and lets go of the file. */
  onClose: () => void;
}

/**
 * Plays one audio or video file, with the app's own controls: play and pause, seek, volume, speed,
 * loop and full screen. Sound goes through an analyser so that music can move the spectrum (see
 * AudioOrb). It stays alive while the pages change: only its box and its controls do, so the music
 * or the video carries on in a small player when the person leaves the Player page.
 */
export default function MediaPlayer({ media, title, mode, slot, autoPlay, onExpand, onClose }: MediaPlayerProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const elementRef = useRef<HTMLVideoElement>(null);
  const graph = useRef<{ context: AudioContext; gain: GainNode } | null>(null);
  const connecting = useRef(false);
  const graphFailed = useRef(false);
  const wakeTimer = useRef<ReturnType<typeof setTimeout>>();

  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(media.seconds ?? 0);
  const [volume, setVolume] = useState(readVolume);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [awake, setAwake] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [withoutCors, setWithoutCors] = useState(false);
  // Moving between the two boxes glides, but not the very first time it is put down.
  const [settled, setSettled] = useState(false);
  const viewport = useWindowSize();

  const isVideo = media.kind === "video";
  const mini = mode === "mini";
  const showControls = !fullscreen || !playing || awake;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // ---- sound goes through an analyser (only once playback has begun, which is when the browser allows it)
  const connectGraph = useCallback(async () => {
    const element = elementRef.current;
    if (!element || graph.current || connecting.current || graphFailed.current || withoutCors) return;
    connecting.current = true;
    try {
      const context = new AudioContext();
      if (context.state === "suspended") await context.resume().catch(() => {});
      if (context.state !== "running" || graph.current) {
        void context.close(); // not allowed to make sound yet: the sound plays as it is, and this is tried again
        return;
      }
      const source = context.createMediaElementSource(element);
      const node = context.createAnalyser();
      node.fftSize = 1024;
      node.smoothingTimeConstant = 0.55;
      // A wide range of loudness, so a quiet passage barely moves the spectrum and a loud one moves it a lot
      // (the default range is full as soon as the music is moderately loud).
      node.minDecibels = -80;
      node.maxDecibels = -5;
      const gain = context.createGain();
      source.connect(node); // what the spectrum listens to, whatever the volume is set to
      source.connect(gain);
      gain.connect(context.destination);
      element.volume = 1;
      element.muted = false;
      graph.current = { context, gain };
      setAnalyser(node);
    } catch {
      graphFailed.current = true; // the sound still plays; the spectrum just stays still
    } finally {
      connecting.current = false;
    }
  }, [withoutCors]);

  // ---- volume: on the sound graph once there is one, on the element until then
  useEffect(() => {
    const level = muted ? 0 : volume;
    if (graph.current) graph.current.gain.gain.setTargetAtTime(level, graph.current.context.currentTime, 0.015);
    else if (elementRef.current) elementRef.current.volume = level;
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      // Storage can be unavailable.
    }
  }, [volume, muted, analyser]);

  useEffect(() => {
    if (elementRef.current) elementRef.current.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    if (elementRef.current) elementRef.current.loop = loop;
  }, [loop]);

  // ---- a file the browser cannot read with CORS is played without the analyser
  useEffect(() => {
    if (withoutCors) elementRef.current?.load();
  }, [withoutCors]);

  // ---- current time, smoothly, while playing
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let lastUpdate = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastUpdate < 90) return;
      lastUpdate = now;
      if (elementRef.current) setTime(elementRef.current.currentTime);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // ---- closing: stop, let go of the file (Windows keeps a playing file locked), close the sound graph
  useEffect(() => {
    const element = elementRef.current;
    // The cleanup below empties the element; when React sets the effect up again on the same element it is put back.
    if (element && !element.getAttribute("src")) element.src = media.url;
    return () => {
      clearTimeout(wakeTimer.current);
      element?.pause();
      element?.removeAttribute("src");
      element?.load();
      void graph.current?.context.close();
      graph.current = null;
    };
  }, [media.url]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ---- actions
  const toggle = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    if (element.paused || element.ended) void element.play().catch(() => {});
    else element.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const element = elementRef.current;
    if (!element) return;
    const end = Number.isFinite(element.duration) ? element.duration : Infinity;
    element.currentTime = Math.min(end, Math.max(0, seconds));
    setTime(element.currentTime);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void containerRef.current?.requestFullscreen().catch(() => {});
  }, []);

  const wake = () => {
    setAwake(true);
    clearTimeout(wakeTimer.current);
    wakeTimer.current = setTimeout(() => setAwake(false), 2500);
  };

  // ---- keyboard: Space/K, arrows, M, F, L. Only while the Player page is showing it: on the other pages
  // the keys belong to the page.
  const keyboard = mode === "full";
  useEffect(() => {
    if (!keyboard) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const onRange = target instanceof HTMLInputElement && target.type === "range";
      if (target instanceof HTMLInputElement && !onRange) return;
      if (target instanceof HTMLButtonElement && (event.key === " " || event.key === "Enter")) return; // the button acts
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const element = elementRef.current;
      switch (event.key) {
        case " ":
        case "k":
        case "K":
          event.preventDefault();
          toggle();
          break;
        case "ArrowLeft":
        case "ArrowRight":
          if (onRange || !element) return; // a slider moves itself
          event.preventDefault();
          seek(element.currentTime + (event.key === "ArrowRight" ? 5 : -5) * (event.shiftKey ? 3 : 1));
          break;
        case "ArrowUp":
        case "ArrowDown":
          if (onRange) return;
          event.preventDefault();
          setMuted(false);
          setVolume((current) => Math.min(1, Math.max(0, Math.round((current + (event.key === "ArrowUp" ? 0.05 : -0.05)) * 100) / 100)));
          break;
        case "m":
        case "M":
          setMuted((current) => !current);
          break;
        case "l":
        case "L":
          setLoop((current) => !current);
          break;
        case "f":
        case "F":
          if (isVideo) toggleFullscreen();
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, toggle, seek, toggleFullscreen, isVideo]);

  // ---- where it is: over the page's room, or in the corner
  const miniSize = isVideo ? MINI_VIDEO : MINI_AUDIO;
  const box: Box =
    mode === "full" && slot
      ? slot
      : {
          left: viewport.width - miniSize.width - MINI_MARGIN,
          top: viewport.height - miniSize.height - MINI_MARGIN,
          width: miniSize.width,
          height: miniSize.height,
        };

  const speakerOff = muted || volume === 0;
  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  const rootShape = mini ? `${isVideo ? "flex-col" : "flex-row items-center"} shadow-2xl` : "flex-col";
  const rootLook = fullscreen ? `player-dark bg-black ${showControls ? "" : "cursor-none"}` : "card";
  const glide = settled && !fullscreen ? "transition-[left,top,width,height,opacity] duration-300 ease-out motion-reduce:transition-none" : "";

  return (
    <div
      ref={containerRef}
      dir="ltr"
      onMouseMove={fullscreen ? wake : undefined}
      className={`fixed z-40 flex overflow-hidden ${rootShape} ${rootLook} ${glide} ${mode === "pending" ? "pointer-events-none" : ""}`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, opacity: mode === "pending" ? 0 : 1 }}
    >
      {/* The picture (or the spectrum) takes whatever room is left above the controls. */}
      <div className={mini ? (isVideo ? "relative aspect-video w-full shrink-0" : "relative ml-2 h-12 w-12 shrink-0") : "relative min-h-0 flex-1"}>
        <video
          ref={elementRef}
          src={media.url}
          crossOrigin={withoutCors ? undefined : "anonymous"}
          autoPlay={autoPlay}
          playsInline
          preload="auto"
          className={isVideo ? "absolute inset-0 block h-full w-full cursor-pointer bg-black object-contain" : "hidden"}
          aria-label={title}
          onClick={isVideo ? toggle : undefined}
          onDoubleClick={isVideo ? (mini ? onExpand : toggleFullscreen) : undefined}
          onPlay={() => {
            setPlaying(true);
            setProblem(null);
            void connectGraph();
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(event) => !playing && setTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => Number.isFinite(event.currentTarget.duration) && setDuration(event.currentTarget.duration)}
          onDurationChange={(event) => Number.isFinite(event.currentTarget.duration) && setDuration(event.currentTarget.duration)}
          onError={() => {
            // Asked to be read with CORS and refused: try once more without the analyser.
            if (!withoutCors && !graph.current) setWithoutCors(true);
            else setProblem(t("player.cantPlay"));
          }}
        />

        {isVideo && !playing && !problem && !mini && (
          <button
            type="button"
            onClick={toggle}
            aria-label={t("player.play")}
            className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/30 focus-visible:outline-none"
          >
            <span className="flex h-16 w-16 animate-pop items-center justify-center rounded-full bg-white/90 text-black shadow-xl">
              <Icon name="play" className="ml-1 h-7 w-7" />
            </span>
          </button>
        )}

        {!isVideo && (
          <div
            className={mini ? "absolute inset-0 flex items-center justify-center" : "absolute inset-0 flex flex-col items-center px-6 pb-2 pt-6"}
          >
            {/* A size container: the spectrum is as big as the room allows, always round. */}
            <div
              className={mini ? "flex h-full w-full items-center justify-center" : "flex min-h-0 w-full flex-1 items-center justify-center"}
              style={{ containerType: "size" }}
            >
              <AudioOrb analyser={analyser} playing={playing} />
            </div>
            {!mini && (
              <p dir="auto" className="mt-2 max-w-full shrink-0 truncate text-headline font-bold text-ink" title={title}>
                {title}
              </p>
            )}
          </div>
        )}

        {problem && !mini && (
          <p role="alert" className="absolute inset-x-4 top-4 animate-shake rounded-lg bg-danger/15 px-3 py-2 text-body text-danger">
            {problem}
          </p>
        )}
      </div>

      {mini ? (
        <>
          <div className={`flex min-w-0 items-center gap-2 ${isVideo ? "h-[52px] shrink-0 px-2" : "h-full flex-1 pl-1 pr-2"}`}>
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? t("player.pause") : t("player.play")}
              title={playing ? t("player.pause") : t("player.play")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-fill text-accent-on transition duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fill/60 active:scale-95"
            >
              <Icon name={playing ? "pause" : "play"} className={`h-4 w-4 ${playing ? "" : "ml-0.5"}`} />
            </button>
            <div className="min-w-0 flex-1">
              <p dir="auto" className={`truncate text-caption font-semibold ${problem ? "text-danger" : "text-ink"}`} title={problem ?? title}>
                {problem ?? title}
              </p>
              <p className="text-caption tabular-nums text-ink-2">
                {clock(time)} / {clock(duration)}
              </p>
            </div>
            <button type="button" className="btn-icon h-7 w-7 shrink-0" aria-label={t("nav.player")} title={t("nav.player")} onClick={onExpand}>
              <Icon name="fullscreen" className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="btn-icon h-7 w-7 shrink-0" aria-label={t("common.close")} title={t("common.close")} onClick={onClose}>
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </div>
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-track">
            <div className="h-full bg-accent-fill" style={{ width: `${progress}%` }} />
          </div>
        </>
      ) : (
        <div className={`shrink-0 px-4 pb-3 pt-2 transition-opacity duration-300 ${showControls ? "opacity-100" : "pointer-events-none opacity-0"}`}>
          <div className="flex items-center gap-3">
            <span className="w-11 text-right text-caption tabular-nums text-ink-2">{clock(time)}</span>
            <input
              type="range"
              className="slider min-w-0 flex-1"
              min={0}
              max={duration || 1}
              step={0.1}
              value={Math.min(time, duration || 1)}
              style={fillOf(time, duration)}
              aria-label={t("player.seek")}
              aria-valuetext={t("player.seekValue", { time: clock(time), total: clock(duration) })}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span className="w-11 text-caption tabular-nums text-ink-2">{clock(duration)}</span>
          </div>

          {/* Play sits in the middle, under the seek bar; volume on its left, the other options on its right. */}
          <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="btn-icon h-8 w-8"
                aria-label={speakerOff ? t("player.unmute") : t("player.mute")}
                title={speakerOff ? t("player.unmuteHint") : t("player.muteHint")}
                onClick={() => (volume === 0 ? (setVolume(0.6), setMuted(false)) : setMuted((current) => !current))}
              >
                <Icon name={speakerOff ? "volumeMute" : "volume"} />
              </button>
              <input
                type="range"
                className="slider w-16 min-[560px]:w-24"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                style={fillOf(muted ? 0 : volume, 1)}
                aria-label={t("player.volume")}
                aria-valuetext={t("common.percent", { n: Math.round((muted ? 0 : volume) * 100) })}
                onChange={(event) => {
                  setMuted(false);
                  setVolume(Number(event.target.value));
                }}
              />
            </div>

            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? t("player.pause") : t("player.play")}
              title={playing ? t("player.pauseHint") : t("player.playHint")}
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-fill text-accent-on shadow-[0_6px_18px_-8px_rgb(var(--accent-fill)/0.9)] transition duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fill/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-95"
            >
              <Icon
                name="play"
                className={`absolute h-[18px] w-[18px] transition-all duration-200 ${playing ? "scale-50 opacity-0" : "ml-0.5 scale-100 opacity-100"}`}
              />
              <Icon
                name="pause"
                className={`absolute h-[18px] w-[18px] transition-all duration-200 ${playing ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
              />
            </button>

            <div className="flex items-center justify-end gap-0.5">
              <button
                type="button"
                className={`btn-icon h-8 w-8 ${loop ? "bg-accent-fill/15 text-accent" : ""}`}
                aria-label={t("player.repeat")}
                aria-pressed={loop}
                title={t("player.repeatHint")}
                onClick={() => setLoop((current) => !current)}
              >
                <Icon name="repeat" />
              </button>
              <button
                type="button"
                className="btn btn-ghost h-8 w-11 px-0 tabular-nums"
                aria-label={t("player.speed", { rate })}
                title={t("player.speedTitle")}
                onClick={() => setRate(SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length])}
              >
                {rate}×
              </button>
              {isVideo && (
                <button
                  type="button"
                  className="btn-icon h-8 w-8"
                  aria-label={fullscreen ? t("player.exitFullscreen") : t("player.fullscreen")}
                  title={fullscreen ? t("player.exitFullscreenHint") : t("player.fullscreenHint")}
                  onClick={toggleFullscreen}
                >
                  <Icon name={fullscreen ? "fullscreenExit" : "fullscreen"} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
