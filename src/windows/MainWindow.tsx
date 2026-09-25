// SPDX-License-Identifier: GPL-3.0-only
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useEngine, useJobs, useSettings } from "../hooks/useBackend";
import { usePlayerSession, type PlayRequest } from "../hooks/usePlayerSession";
import { useUpdate } from "../hooks/useUpdate";
import { currentLanguage, setLanguageSetting, systemLanguage, type LanguageCode, type LanguageSetting } from "../i18n";
import { useTrayLabels } from "../i18n/sync";
import { onNavigate } from "../services/downloader";
import { pickMediaFile } from "../services/player";
import { launchedAfterUpdate } from "../services/updates";
import { showThisWindow, subscribe, usesCustomTitleBar } from "../services/tauri";
import { isTermsAccepted } from "../services/terms";
import PlayerHost from "../components/PlayerHost";
import Sidebar, { type View } from "../components/Sidebar";
import TitleBar from "../components/TitleBar";
import Tour from "../components/Tour";
import DownloadsView from "../views/DownloadsView";
import LanguageChoice from "../views/LanguageChoice";
import PlayerView from "../views/PlayerView";
import SettingsView from "../views/SettingsView";
import ToolsSetup from "../views/ToolsSetup";
import Welcome from "../views/Welcome";

type TermsState = "loading" | "required" | "accepted";

/** What is saved for a language: the computer's own is kept as "system", so it goes on following the computer. */
const languageSetting = (code: LanguageCode): LanguageSetting => (code === systemLanguage() ? "system" : code);

export default function MainWindow() {
  const [terms, setTerms] = useState<TermsState>("loading");
  // First launch: the language, then the Terms, then the tools (yt-dlp and FFmpeg), and then the app itself.
  const [firstStep, setFirstStep] = useState<"language" | "terms" | "tools">("language");
  const [view, setView] = useState<View>("home");
  const [playRequest, setPlayRequest] = useState<PlayRequest | null>(null);
  // The player lives above the pages, so the music or the video carries on when another page is shown.
  const session = usePlayerSession(playRequest);
  // The room the Player page keeps for the player, and how much room the small player takes on other pages.
  const [playerSlot, setPlayerSlot] = useState<HTMLElement | null>(null);
  const [dock, setDock] = useState(0);
  const jobs = useJobs();
  const [settings, updateSettings] = useSettings();
  const engine = useEngine();
  const news = useUpdate();
  useTrayLabels(news.update?.version ?? null);
  // The installer of an update starts CleanGrab again: its window opens, even if it starts in the tray.
  const [afterUpdate, setAfterUpdate] = useState<boolean | null>(null);
  useEffect(() => {
    launchedAfterUpdate()
      .then(setAfterUpdate)
      .catch(() => setAfterUpdate(false));
  }, []);

  useEffect(() => {
    isTermsAccepted()
      .then((accepted) => setTerms(accepted ? "accepted" : "required"))
      // If the state can't be read, fail closed and ask again.
      .catch(() => setTerms("required"));
  }, []);

  // The window starts hidden. Reveal it once there is something painted, except
  // when CleanGrab was set to start quietly in the tray. The welcome screen
  // always opens, since the Terms of Use need an answer.
  const revealed = useRef(false);
  useEffect(() => {
    if (revealed.current || terms === "loading") return;
    if (terms === "accepted") {
      if (!settings || afterUpdate === null) return; // wait to know whether to stay hidden
      if (settings.startInBackground && !afterUpdate) {
        revealed.current = true;
        return;
      }
    }
    revealed.current = true;
    // Not cancelled on cleanup: this effect re-runs when settings arrive, and
    // that must not cancel the reveal it just scheduled.
    requestAnimationFrame(() => void showThisWindow().catch(() => {}));
  }, [terms, settings, afterUpdate]);

  // The language is asked once, on a fresh install. Someone who has been through the tour has a language
  // already, and only has the Terms to read again (they changed).
  useEffect(() => {
    if (settings?.tutorialDone) setFirstStep((step) => (step === "language" ? "terms" : step));
  }, [settings?.tutorialDone]);

  useEffect(() => onNavigate(setView), []);

  // Opens a file in the player, or asks which one first.
  const play = useCallback((path: string, title?: string) => {
    setPlayRequest({ path, title, nonce: Date.now() });
    setView("player");
  }, []);
  const closePlayer = useCallback(() => setPlayRequest(null), []);
  const goTo = useCallback((next: View) => setView(next), []);

  // Closing the window sends CleanGrab to the tray: what was playing stops with it.
  useEffect(() => subscribe("window-hidden", closePlayer), [closePlayer]);
  const chooseAndPlay = useCallback(async () => {
    const path = await pickMediaFile().catch(() => null);
    if (path) play(path);
  }, [play]);

  useEffect(() => {
    if (terms !== "accepted") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === ",") {
        setView("settings");
        e.preventDefault();
      } else if (e.key === "Escape" && view === "settings" && !document.querySelector('[aria-modal="true"]')) {
        setView("home");
      } else if (e.key === "Escape" && view === "player" && !document.fullscreenElement) {
        setView("home");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [terms, view]);

  if (terms === "loading") return null;

  // The system's title bar is off (except on macOS): the window has its own.
  const frame = (content: ReactNode) => (
    <div className="flex h-full flex-col">
      {usesCustomTitleBar() && <TitleBar />}
      <div className="flex min-h-0 flex-1">{content}</div>
    </div>
  );

  if (terms === "required") {
    // First launch: the language comes first, so the Terms and the tour are already in it.
    return frame(
      <div className="min-w-0 flex-1">
        {firstStep === "language" ? (
          <LanguageChoice
            onPick={(code) => {
              const language = languageSetting(code);
              setLanguageSetting(language);
              updateSettings({ language });
            }}
            onContinue={() => {
              // Saved again: the settings may not have been loaded yet at the first pick.
              updateSettings({ language: languageSetting(currentLanguage()) });
              setFirstStep("terms");
            }}
          />
        ) : firstStep === "terms" ? (
          // With the tools already there (a reinstall, say) there is nothing to explain or download.
          <Welcome onAccepted={() => (engine.status?.ready ? setTerms("accepted") : setFirstStep("tools"))} />
        ) : (
          <ToolsSetup engine={engine} onDone={() => setTerms("accepted")} />
        )}
      </div>,
    );
  }

  // The menu takes the whole height of the window, up to the very top; the title bar (with the window
  // buttons) belongs to the pages beside it.
  return (
    <div className="flex h-full">
      <Sidebar
        view={view}
        onNavigate={goTo}
        watching={settings?.watchClipboard ?? true}
        onWatchingChange={(watchClipboard) => updateSettings({ watchClipboard })}
        playing={session.phase === "ready"}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {usesCustomTitleBar() && <TitleBar />}
        {/* Pages fade in; the menu beside them stays put. */}
        <main key={view} className="min-h-0 min-w-0 flex-1 animate-fade-in" style={{ "--dock": `${dock}px` } as CSSProperties}>
          {view === "home" ? (
            <DownloadsView
              jobs={jobs}
              engine={engine}
              settings={settings}
              onSettingsChange={updateSettings}
              onOpenSettings={() => goTo("settings")}
              onPlayFile={play}
              news={news}
            />
          ) : view === "player" ? (
            <PlayerView
              request={playRequest}
              session={session}
              onOpenFile={() => void chooseAndPlay()}
              onClose={closePlayer}
              onSlot={setPlayerSlot}
            />
          ) : (
            <SettingsView
              settings={settings}
              onChange={updateSettings}
              engine={engine}
              news={news}
              onReplayTour={() => {
                updateSettings({ tutorialDone: false });
                setView("home");
              }}
            />
          )}
        </main>
      </div>
      <PlayerHost
        request={playRequest}
        session={session}
        onPlayerPage={view === "player"}
        slot={playerSlot}
        onExpand={() => goTo("player")}
        onClose={closePlayer}
        onDock={setDock}
      />
      {/* The first-run tour, once, on the Home page. It waits a moment for the page to settle. */}
      {view === "home" && settings && !settings.tutorialDone && <Tour onDone={() => updateSettings({ tutorialDone: true })} />}
    </div>
  );
}
