// SPDX-License-Identifier: GPL-3.0-only
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { languageReady } from "./i18n";
import { applyAppearance, cachedAppearance } from "./services/appearance";
import { windowLabel } from "./services/tauri";
import "./index.css";

// Paint in the remembered palette right away; the saved setting confirms it after load.
applyAppearance(cachedAppearance());

// The main window paints an opaque background; the toast stays transparent.
document.documentElement.classList.add(`window-${windowLabel()}`);

// The interface starts once the texts of the language shown last time are loaded (a moment: they are local),
// so nothing is ever drawn in English and then redrawn.
void languageReady().then(() =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
);
