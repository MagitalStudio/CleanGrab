// SPDX-License-Identifier: GPL-3.0-only
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev server port and relative asset paths.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Rust build output lives in src-tauri/target and is locked while compiling.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
