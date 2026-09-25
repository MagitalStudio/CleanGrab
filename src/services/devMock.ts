// SPDX-License-Identifier: GPL-3.0-only
// In-memory stand-in for the Rust backend, used only by `npm run dev` in a
// plain browser so the UI can be previewed without Tauri. Never bundled in
// production builds (see call() in tauri.ts).

import type { DetectedLink, Job, Quality, Trim } from "./downloader";
import type { EngineStatus } from "./engine";
import type { Settings } from "./settings";

const emit = (event: string, detail: unknown) =>
  window.dispatchEvent(new CustomEvent(`mock:${event}`, { detail }));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const storedTerms = () => {
  try {
    return localStorage.getItem("mock:terms") === "1";
  } catch {
    return false;
  }
};

let termsAccepted = storedTerms();

// ?update=1: 0.2.0 is out and can be installed by the app; ?update=page: it can only be opened on its page.
const mockUpdate = () => {
  const asked = new URLSearchParams(window.location.search).get("update");
  return asked
    ? {
        version: "0.2.0",
        notes: "Fixes and a new player.",
        url: "https://github.com/MagitalStudio/CleanGrab/releases/tag/v0.2.0",
        installable: asked !== "page",
      }
    : null;
};
let mockUpdateProgress = { stage: "idle", percent: 0, message: null as string | null };
let engineReady = new URLSearchParams(window.location.search).get("engine") !== "missing";
let settings: Settings = {
  appearance: "system",
  startInBackground: true,
  popupOpacity: 0.95,
  watchClipboard: true,
  saveDir: null,
  removeWatermark: true,
  vertical916: false,
  trimAudioSilence: false,
  allowUntrustedCertificates: false,
  tutorialDone: false,
  checkForUpdates: true,
  offerAnyLink: false,
  language: "system",
};

// `?demo=certificate` shows how a failed certificate check looks.
const demoCertificate = new URLSearchParams(window.location.search).get("demo") === "certificate";
const CERTIFICATE_MESSAGE =
  "Security certificate not trusted\nThe site's certificate isn't one this computer trusts, so CleanGrab stopped. Usually something sits between you and the site: an antivirus that scans secure connections, or a school, work or public Wi-Fi network.";

// ---- the player, in a browser preview: real sound and picture made on the spot.

/** 14 s of sound that goes from silence to loud and back, to try the circle out. */
function makeSong(): string {
  const rate = 22050;
  const seconds = 14;
  const samples = new Int16Array(rate * seconds);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    let value = 0;
    if (t >= 2 && t < 4) value = 0.12 * Math.sin(2 * Math.PI * 220 * t);
    else if (t >= 4 && t < 7) {
      const chord = Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t);
      value = 0.17 * chord * (0.75 + 0.25 * Math.sin(2 * Math.PI * 4 * t));
    } else if (t >= 7 && t < 8.5) value = 0.05 * Math.sin(2 * Math.PI * 440 * t);
    else if (t >= 8.5 && t < 11) {
      const beat = (t - 8.5) % 0.5;
      value = 0.8 * Math.sin(2 * Math.PI * 60 * beat) * Math.exp(-beat * 9) + 0.25 * (Math.random() * 2 - 1) * Math.exp(-beat * 25);
    }
    samples[i] = Math.max(-1, Math.min(1, value)) * 32767;
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, k) => view.setUint8(offset + k, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

/** A short moving picture with a tone, recorded from a canvas. */
async function makeClip(): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  const stream = canvas.captureStream(25);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start();
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const frame = () => {
      const t = (performance.now() - started) / 1000;
      if (context) {
        const gradient = context.createLinearGradient(0, 0, 640, 360);
        gradient.addColorStop(0, `hsl(${(t * 60) % 360} 70% 45%)`);
        gradient.addColorStop(1, `hsl(${(t * 60 + 120) % 360} 70% 25%)`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, 640, 360);
        context.fillStyle = "#fff";
        context.beginPath();
        context.arc(320 + Math.cos(t * 3) * 180, 180 + Math.sin(t * 4) * 90, 34, 0, Math.PI * 2);
        context.fill();
      }
      if (t < 4) requestAnimationFrame(frame);
      else resolve();
    };
    frame();
  });
  recorder.stop();
  await done;
  return URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
}

async function prepareMock(path: string) {
  const converted = /convert/i.test(path);
  if (converted) {
    for (let percent = 5; percent <= 95; percent += 10) {
      emit("playback-progress", { path, percent });
      await wait(160);
    }
  }
  if (/missing/i.test(path)) throw "This file can't be found. It may have been moved or deleted.";
  const kind = /\.(mp4|mkv|webm|mov|avi)$/i.test(path) || /clip/i.test(path) ? "video" : "audio";
  const title = (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");
  return { path: kind === "video" ? await makeClip() : makeSong(), kind, title, seconds: null, converted };
}

let jobs: Job[] = [
  ...(demoCertificate
    ? [
        {
          id: "demo-cert",
          url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
          platform: "YouTube",
          format: "mp3",
          title: null,
          status: "error",
          stage: "downloading",
          percent: 0,
          path: null,
          error: CERTIFICATE_MESSAGE,
          errorKind: "certificate-untrusted",
          createdAt: 1_700_000_200,
          trim: null,
          quality: "best",
        } satisfies Job,
      ]
    : []),
  {
    id: "demo-1",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    platform: "YouTube",
    format: "mp3",
    title: "Rick Astley – Never Gonna Give You Up",
    status: "done",
    stage: "downloading",
    percent: 100,
    path: "C:\\Users\\you\\Downloads\\CleanGrab\\Never Gonna Give You Up.mp3",
    error: null,
    createdAt: 1_700_000_000,
    trim: { start: 30, end: 75 },
    quality: "192",
  },
  {
    id: "demo-2",
    url: "https://www.tiktok.com/@clean/video/7300000000000000000",
    platform: "TikTok",
    format: "mp4",
    title: null,
    status: "error",
    stage: "downloading",
    percent: 0,
    path: null,
    error: "This video is private or needs you to sign in",
    createdAt: 1_700_000_100,
    trim: null,
    quality: "best",
  },
];

const publishJobs = () => emit("jobs-changed", jobs);

function patch(id: string, change: Partial<Job>) {
  jobs = jobs.map((job) => (job.id === id ? { ...job, ...change } : job));
  publishJobs();
}

async function simulate(id: string) {
  await wait(500);
  patch(id, { title: "Lo-fi beats to study to", stage: "downloading" });
  for (let percent = 4; percent <= 92; percent += 4) {
    if (jobs.find((j) => j.id === id)?.status !== "running") return;
    patch(id, { percent });
    await wait(280);
  }
  patch(id, { stage: "converting", percent: 96 });
  await wait(900);
  if (jobs.find((j) => j.id === id)?.status === "running") {
    patch(id, { status: "done", percent: 100, path: "C:\\Users\\you\\Downloads\\CleanGrab\\Lo-fi beats.mp3" });
  }
}

// Any web link is accepted, as the real one does: the site's name is the platform.
function parse(text: string): DetectedLink | null {
  const match = text.match(/https?:\/\/(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\S*/i);
  if (!match || /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(match[1])) return null;
  if (match[1] === "open.spotify.com" && !/\/track\//.test(match[0])) return null;
  const platforms: Record<string, DetectedLink["platform"]> = {
    "youtube.com": "YouTube",
    "youtu.be": "YouTube",
    "tiktok.com": "TikTok",
    "instagram.com": "Instagram",
    "open.spotify.com": "Spotify",
    "pornhub.com": "Pornhub",
    "vimeo.com": "Vimeo",
  };
  const [clean] = match[0].split("&si=");
  const url = clean.split("?si=")[0];
  return { url, platform: platforms[match[1].toLowerCase()] ?? match[1].toLowerCase(), removedTrackers: url === match[0] ? 0 : 1 };
}

export async function mockInvoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  switch (command) {
    case "terms_accepted":
      return termsAccepted;
    case "accept_terms":
      termsAccepted = true;
      try {
        localStorage.setItem("mock:terms", "1");
      } catch {
        // Storage can be unavailable in previews.
      }
      return;
    case "decline_terms":
      return;
    case "get_settings":
      return settings;
    case "update_settings":
      settings = args.settings as Settings;
      emit("settings-changed", settings);
      return settings;
    case "get_save_dir":
      return settings.saveDir ?? "C:\\Users\\you\\Downloads\\CleanGrab";
    case "choose_folder":
      return "D:\\Media\\CleanGrab";
    case "pick_media_file":
      // `?pick=C:\Videos\clip.mp4` (or convert-me.avi, missing.mp3) chooses what the picker returns.
      return new URLSearchParams(window.location.search).get("pick") ?? "C:\\Music\\Blinding Lights.mp3";
    case "prepare_playback":
      return prepareMock(String(args.path));
    case "cancel_playback":
      return;
    case "set_tray_labels":
      return;
    case "ui_zoom":
      return 1;
    case "open_save_dir":
    case "reveal_job":
    case "open_main":
    case "present_toast":
      // Dev-only trace of the sizes the real window would be given.
      ((window as unknown as { __presentToast?: number[] }).__presentToast ??= []).push(Number(args.height));
      return;
    case "activate_toast":
      return;
    case "preview_toast":
      emit("clipboard-media-detected", { url: "https://youtu.be/dQw4w9WgXcQ", platform: "YouTube", removedTrackers: 2 });
      return;
    case "engine_status":
      return {
        ytDlpInstalled: engineReady,
        ytDlpVersion: engineReady && args.withVersion ? "2026.09.01" : null,
        ffmpegInstalled: engineReady,
        ready: engineReady,
      } satisfies EngineStatus;
    // A newer version is announced when the page is opened with ?update=1.
    case "check_for_update":
      return { current: "0.1.0", update: mockUpdate() };
    case "latest_update":
      return mockUpdate();    case "open_update_page":
      return null;
    case "update_progress":
      return mockUpdateProgress;
    case "download_update": {
      for (let percent = 0; percent <= 100; percent += 10) {
        mockUpdateProgress = { stage: "downloading", percent, message: null };
        emit("update-progress", mockUpdateProgress);
        await wait(250);
      }
      mockUpdateProgress = { stage: "ready", percent: 100, message: null };
      emit("update-progress", mockUpdateProgress);
      return;
    }
    case "install_update":
      // The real one quits CleanGrab and lets the installer replace it. Here the page stays: window.__publish("0.3.0")
      // announces a later version, the way the daily search would.
      (window as unknown as { __publish?: (version: string) => void }).__publish = (version) =>
        emit("update-available", {
          version,
          notes: "More fixes.",
          url: `https://github.com/MagitalStudio/CleanGrab/releases/tag/v${version}`,
          installable: true,
        });
      return;
    case "launched_after_update":
      return false;
    case "install_engine":
      if (demoCertificate) {
        await wait(400);
        emit("engine-progress", { stage: "error", percent: 0, message: CERTIFICATE_MESSAGE, kind: "certificate-untrusted" });
        throw CERTIFICATE_MESSAGE;
      }
      for (let percent = 0; percent <= 100; percent += 5) {
        emit("engine-progress", { stage: percent < 15 ? "yt-dlp" : "FFmpeg", percent, message: null });
        await wait(120);
      }
      engineReady = true;
      emit("engine-progress", { stage: "done", percent: 100, message: null });
      return;
    case "update_yt_dlp":
      await wait(600);
      return "yt-dlp is up to date (2026.09.01)";
    case "parse_link":
      return parse(String(args.text ?? ""));
    case "list_jobs":
      return jobs;
    case "start_download": {
      if (!engineReady) throw "SETUP_REQUIRED";
      const link = parse(String(args.url ?? ""));
      if (!link) throw "This link isn't supported";
      const id = `mock-${Date.now()}`;
      jobs = [
        {
          id,
          url: link.url,
          platform: link.platform,
          format: args.format as Job["format"],
          title: null,
          status: "running",
          stage: "starting",
          percent: 0,
          path: null,
          error: null,
          createdAt: Math.floor(Date.now() / 1000),
          trim: (args.trim as Trim | null) ?? null,
          quality: (args.quality as Quality | undefined) ?? "best",
        },
        ...jobs,
      ];
      publishJobs();
      void simulate(id);
      return id;
    }
    case "cancel_job":
      patch(String(args.id), { status: "canceled" });
      return;
    case "remove_job":
      jobs = jobs.filter((job) => job.id !== args.id);
      publishJobs();
      return;
    case "clear_finished":
      jobs = jobs.filter((job) => job.status === "running");
      publishJobs();
      return;
    default:
      throw new Error(`No mock for command "${command}"`);
  }
}
