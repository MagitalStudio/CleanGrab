// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState, type ReactNode } from "react";
import { headline } from "../components/CertificateNotice";
import Checkbox from "../components/Checkbox";
import Dropdown from "../components/Dropdown";
import EngineSetup from "../components/EngineSetup";
import Icon from "../components/Icons";
import LegalBody from "../components/LegalBody";
import Segmented from "../components/Segmented";
import Toggle from "../components/Toggle";
import { PRIVACY_POLICY, TERMS_AND_CONDITIONS, type LegalDoc } from "../content/legal";
import type { EngineState } from "../hooks/useBackend";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { LANGUAGES, useT, type LanguageSetting, type TKey } from "../i18n";
import type { Appearance } from "../services/appearance";
import { errorMessage } from "../services/downloader";
import { updateYtDlp } from "../services/engine";
import { chooseFolder, getSaveDir, openSaveDir, type Settings } from "../services/settings";
import { changeAppearance } from "../services/themeTransition";
import { checkForUpdate } from "../services/updates";
import UpdateControls from "../components/UpdateControls";
import type { UpdateState } from "../hooks/useUpdate";
import { previewToast } from "../services/toast";
import pkg from "../../package.json";

interface SettingsViewProps {
  settings: Settings | null;
  onChange: (patch: Partial<Settings>) => void;
  engine: EngineState;
  /** Shows the first-run tour again, on the Home page. */
  onReplayTour: () => void;
  /** The search for a newer version of CleanGrab, to offer it here too. */
  news: UpdateState;
}

const APPEARANCES: { id: Appearance; label: TKey }[] = [
  { id: "system", label: "settings.themeSystem" },
  { id: "light", label: "settings.themeLight" },
  { id: "dark", label: "settings.themeDark" },
];

function Group({ title, children, index = 0 }: { title: string; children: ReactNode; index?: number }) {
  return (
    <section className="animate-fade-up" style={{ animationDelay: `${index * 55}ms` }}>
      <h2 className="label mb-2 px-1">{title}</h2>
      <div className="card divide-y divide-line/10">{children}</div>
    </section>
  );
}

function Row({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3.5">
      <div className="min-w-[12rem] flex-1">
        <p className="text-body font-semibold text-ink">{title}</p>
        {description && <p className="mt-0.5 break-words text-caption text-ink-2">{description}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

type LegalKey = "terms" | "privacy";

const LEGAL_DOCS: Record<LegalKey, { titleKey: TKey; doc: LegalDoc }> = {
  terms: { titleKey: "settings.terms", doc: TERMS_AND_CONDITIONS },
  privacy: { titleKey: "settings.privacy", doc: PRIVACY_POLICY },
};

function LegalSheet({ title, doc, onClose }: { title: string; doc: LegalDoc; onClose: () => void }) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-sheet-title"
        className="card flex max-h-full w-full max-w-lg animate-toast-in flex-col shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line/10 px-5 py-3">
          <h2 id="terms-sheet-title" className="text-headline font-bold text-ink">
            {title}
          </h2>
          <button ref={closeRef} type="button" className="btn btn-primary" onClick={onClose}>
            {t("settings.termsDone")}
          </button>
        </div>
        <div className="thin-scroll overflow-y-auto px-5 py-4">
          <LegalBody doc={doc} />
        </div>
      </div>
    </div>
  );
}

/**
 * The last question before certificate checks are turned off. The safe answer is the one in focus
 * and the one Esc gives; the way through is the red button.
 */
function CertificateConfirm({ onCancel, onProceed }: { onCancel: () => void; onProceed: () => void }) {
  const t = useT();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/50 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cert-confirm-title"
        aria-describedby="cert-confirm-body"
        className="card w-full max-w-md animate-toast-in p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
            <Icon name="alert" className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 id="cert-confirm-title" className="text-headline font-bold text-ink">
              {t("settings.certConfirm.title")}
            </h2>
            <div id="cert-confirm-body">
              <p className="mt-1.5 text-body text-ink">{t("settings.certConfirm.body")}</p>
              <p className="mt-2 text-body text-ink-2">{t("settings.certConfirm.note")}</p>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn-danger" onClick={onProceed}>
            {t("settings.certConfirm.proceed")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsView({ settings, onChange, engine, onReplayTour, news }: SettingsViewProps) {
  const t = useT();
  const [saveDir, setSaveDir] = useState<string>("");
  const [openLegal, setOpenLegal] = useState<LegalKey | null>(null);
  // Ticking the certificate box asks first; the setting only changes on "Proceed".
  const [confirmCertificates, setConfirmCertificates] = useState(false);
  const [updateNote, setUpdateNote] = useState<{ text: string; failed: boolean } | null>(null);
  // The answer to "Check now" for a newer CleanGrab: the version that was found running, or why it failed.
  const [checkedVersion, setCheckedVersion] = useState<string | null>(null);
  const [checkFailure, setCheckFailure] = useState<string | null>(null);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    getSaveDir().then(setSaveDir).catch(() => {});
  }, [settings?.saveDir]);

  // The Tools section shows yt-dlp's version, which costs a process launch.
  const refreshEngine = engine.refresh;
  useEffect(() => {
    refreshEngine(true);
  }, [refreshEngine]);

  if (!settings) return null;

  const choose = async () => {
    const folder = await chooseFolder().catch(() => null);
    if (folder) onChange({ saveDir: folder });
  };

  const update = async () => {
    setUpdating(true);
    setUpdateNote(null);
    try {
      setUpdateNote({ text: await updateYtDlp(), failed: false });
      engine.refresh(true);
    } catch (e) {
      setUpdateNote({ text: errorMessage(e), failed: true });
    }
    setUpdating(false);
  };

  const checkVersion = async () => {
    setCheckingVersion(true);
    setCheckFailure(null);
    try {
      // A newer version, if there is one, reaches `news` by itself (the backend announces it).
      setCheckedVersion((await checkForUpdate()).current);
    } catch (e) {
      setCheckFailure(errorMessage(e));
    }
    setCheckingVersion(false);
  };

  // What the Updates row says without being asked: a newer version is out, or this one is the latest.
  const versionStatus = checkFailure
    ? { failed: true, text: checkFailure }
    : news.update
      ? { failed: false, text: t("settings.updatesAvailable", { version: news.update.version }) }
      : { failed: false, text: t("settings.updatesUpToDate", { version: checkedVersion ?? pkg.version }) };

  const status = engine.status;

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[720px] space-y-5 px-6 pb-[calc(2rem+var(--dock,0px))] pt-6">
        <header className="flex min-h-8 animate-fade-up items-center">
          <h1 className="text-title font-bold text-ink">{t("settings.title")}</h1>
        </header>

        <Group title={t("settings.appearance")} index={0}>
          <Row title={t("settings.theme")} description={t("settings.themeDesc")}>
            <Segmented
              value={settings.appearance}
              onChange={(appearance) => changeAppearance(appearance, () => onChange({ appearance }))}
              options={APPEARANCES.map((option) => ({ id: option.id, label: t(option.label) }))}
              label={t("settings.theme")}
              className="w-60 max-w-full"
            />
          </Row>
          <Row title={t("settings.language")} description={t("settings.languageDesc")}>
            <Dropdown<LanguageSetting>
              value={settings.language}
              options={[
                { id: "system", label: t("settings.languageAuto") },
                ...LANGUAGES.map((language) => ({ id: language.code as LanguageSetting, label: language.name })),
              ]}
              onChange={(language) => onChange({ language })}
              label={t("settings.language")}
              width="w-44"
            />
          </Row>
          <Row title={t("settings.opacity")} description={t("settings.opacityDesc")}>
            <input
              type="range"
              min={50}
              max={100}
              step={5}
              value={Math.round(settings.popupOpacity * 100)}
              onChange={(e) => onChange({ popupOpacity: Number(e.target.value) / 100 })}
              aria-label={t("settings.opacity")}
              aria-valuetext={t("common.percent", { n: Math.round(settings.popupOpacity * 100) })}
              className="h-5 w-32 cursor-pointer"
              style={{ accentColor: "rgb(var(--accent-fill))" }}
            />
            <span className="w-10 text-end text-body tabular-nums text-ink-2">
              {Math.round(settings.popupOpacity * 100)}%
            </span>
            <button type="button" className="btn btn-secondary" onClick={() => void previewToast().catch(() => {})}>
              {t("settings.preview")}
            </button>
          </Row>
        </Group>

        <Group title={t("settings.general")} index={1}>
          <Row title={t("settings.background")} description={t("settings.backgroundDesc")}>
            <Toggle
              checked={settings.startInBackground}
              onChange={(startInBackground) => onChange({ startInBackground })}
              label={t("settings.background")}
            />
          </Row>
          <Row title={t("settings.watch")} description={t("settings.watchDesc")}>
            <Toggle
              checked={settings.watchClipboard}
              onChange={(watchClipboard) => onChange({ watchClipboard })}
              label={t("settings.watch")}
            />
          </Row>
          <Row title={t("settings.anyLink")} description={t("settings.anyLinkDesc")}>
            <Toggle
              checked={settings.offerAnyLink}
              onChange={(offerAnyLink) => onChange({ offerAnyLink })}
              label={t("settings.anyLink")}
            />
          </Row>
          <Row title={t("settings.saveLocation")} description={saveDir}>
            <button type="button" className="btn btn-secondary" onClick={choose}>
              {t("settings.choose")}
            </button>
            <button type="button" className="btn-icon" aria-label={t("settings.showLocation")} title={t("jobs.showInFolder")} onClick={() => void openSaveDir().catch(() => {})}>
              <Icon name="folder" />
            </button>
            {settings.saveDir && (
              <button type="button" className="btn btn-ghost" onClick={() => onChange({ saveDir: null })}>
                {t("settings.reset")}
              </button>
            )}
          </Row>
        </Group>

        <Group title={t("settings.scrubbing")} index={2}>
          <Row title={t("settings.watermark")} description={t("settings.watermarkDesc")}>
            <Toggle
              checked={settings.removeWatermark}
              onChange={(removeWatermark) => onChange({ removeWatermark })}
              label={t("settings.watermark")}
            />
          </Row>
          <Row title={t("settings.vertical")} description={t("settings.verticalDesc")}>
            <Toggle
              checked={settings.vertical916}
              onChange={(vertical916) => onChange({ vertical916 })}
              label={t("settings.vertical")}
            />
          </Row>
          <Row title={t("settings.silence")} description={t("settings.silenceDesc")}>
            <Toggle
              checked={settings.trimAudioSilence}
              onChange={(trimAudioSilence) => onChange({ trimAudioSilence })}
              label={t("settings.silence")}
            />
          </Row>
        </Group>

        {status && !status.ready ? (
          <EngineSetup engine={engine} />
        ) : (
          <Group title={t("settings.tools")} index={3}>
            <Row title="yt-dlp" description={status?.ytDlpVersion ? t("home.version", { v: status.ytDlpVersion }) : status?.ytDlpInstalled ? t("home.installed") : t("settings.checking")}>
              {updateNote && (
                <span
                  title={updateNote.text}
                  className={`max-w-56 truncate text-caption ${updateNote.failed ? "text-danger" : "text-ink-3"}`}
                  aria-live="polite"
                >
                  {headline(updateNote.text)}
                </span>
              )}
              <button type="button" className="btn btn-secondary" disabled={updating} onClick={update}>
                <Icon name="retry" />
                {updating ? t("settings.updating") : t("settings.checkUpdates")}
              </button>
            </Row>
            <Row title="FFmpeg" description={status?.ffmpegInstalled ? t("home.installed") : t("settings.checking")}>
              <span />
            </Row>
          </Group>
        )}

        <Group title={t("settings.security")} index={4}>
          <Row title={t("settings.certTitle")} description={t("settings.certDesc")}>
            <Checkbox
              checked={settings.allowUntrustedCertificates}
              onChange={(allow) => (allow ? setConfirmCertificates(true) : onChange({ allowUntrustedCertificates: false }))}
              label={t("settings.certCheckbox")}
            />
          </Row>
          {settings.allowUntrustedCertificates && (
            <div
              role="status"
              className="flex animate-fade-up items-center gap-2 bg-danger/[0.06] px-5 py-2.5 text-caption font-semibold text-danger"
            >
              <Icon name="alert" className="h-3.5 w-3.5 shrink-0" />
              {t("settings.certWarning")}
            </div>
          )}
        </Group>

        <Group title={t("settings.about")} index={5}>
          <Row title={t("settings.updates")} description={t("settings.updatesDesc")}>
            <span role="status" className={`text-caption ${versionStatus.failed ? "text-danger" : "text-ink-2"}`}>
              {versionStatus.text}
            </span>
            {news.update && <UpdateControls news={news} />}
            <button type="button" className="btn btn-secondary" disabled={checkingVersion} onClick={() => void checkVersion()}>
              <Icon name="retry" />
              {checkingVersion ? t("settings.updatesChecking") : t("settings.updatesCheck")}
            </button>
            <Toggle
              checked={settings.checkForUpdates}
              onChange={(checkForUpdates) => onChange({ checkForUpdates })}
              label={t("settings.updates")}
            />
          </Row>
          <Row title={t("settings.tour")} description={t("settings.tourDesc")}>
            <button type="button" className="btn btn-secondary" onClick={onReplayTour}>
              {t("settings.tourShow")}
            </button>
          </Row>
          <Row title={t("settings.terms")} description={t("settings.termsDesc")}>
            <button type="button" className="btn btn-secondary" onClick={() => setOpenLegal("terms")}>
              {t("settings.termsView")}
            </button>
          </Row>
          <Row title={t("settings.privacy")} description={t("settings.privacyDesc")}>
            <button type="button" className="btn btn-secondary" onClick={() => setOpenLegal("privacy")}>
              {t("settings.termsView")}
            </button>
          </Row>
          <Row title={t("settings.version", { version: pkg.version })} description={t("settings.versionDesc")}>
            <span />
          </Row>
        </Group>
      </div>

      {openLegal && (
        <LegalSheet title={t(LEGAL_DOCS[openLegal].titleKey)} doc={LEGAL_DOCS[openLegal].doc} onClose={() => setOpenLegal(null)} />
      )}
      {confirmCertificates && (
        <CertificateConfirm
          onCancel={() => setConfirmCertificates(false)}
          onProceed={() => {
            setConfirmCertificates(false);
            onChange({ allowUntrustedCertificates: true });
          }}
        />
      )}
    </div>
  );
}
