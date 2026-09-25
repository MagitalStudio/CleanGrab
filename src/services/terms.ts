// SPDX-License-Identifier: GPL-3.0-only
import { call } from "./tauri";

// Acceptance is persisted by the Rust backend (src-tauri/src/terms.rs), which
// also keeps the clipboard watcher, tool setup and downloads disabled until
// it is granted.

export const isTermsAccepted = () => call<boolean>("terms_accepted");
export const acceptTerms = () => call<void>("accept_terms");
export const declineTerms = () => call<void>("decline_terms");
