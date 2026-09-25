// SPDX-License-Identifier: GPL-3.0-only
import { call, subscribe } from "./tauri";

export interface EngineStatus {
  ytDlpInstalled: boolean;
  /** Only filled in when asked for: reading it means starting yt-dlp. */
  ytDlpVersion: string | null;
  ffmpegInstalled: boolean;
  ready: boolean;
}

export interface EngineProgress {
  stage: "yt-dlp" | "FFmpeg" | "done" | "error";
  percent: number;
  message: string | null;
  /** Set when the setup failed on a certificate check. */
  kind?: string | null;
}

export const getEngineStatus = (withVersion = false) => call<EngineStatus>("engine_status", { withVersion });
export const installEngine = () => call<void>("install_engine");
export const updateYtDlp = () => call<string>("update_yt_dlp");
export const onEngineProgress = (callback: (progress: EngineProgress) => void) =>
  subscribe("engine-progress", callback);
