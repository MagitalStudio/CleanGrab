// SPDX-License-Identifier: GPL-3.0-only
import { useId } from "react";
import { localizeMessage, useT, type TKey } from "../i18n";
import Icon from "./Icons";

/** The three certificate problems the backend reports (see certs.rs). */
export type CertificateKind = "certificate-untrusted" | "certificate-expired" | "certificate-site";

const KINDS: readonly string[] = ["certificate-untrusted", "certificate-expired", "certificate-site"];

export const isCertificateKind = (kind: string | null | undefined): kind is CertificateKind =>
  kind != null && KINDS.includes(kind);

/** The headline of an error message: its first line, in the current language when it is a known one. */
export const headline = (message: string) => localizeMessage(message.split("\n")[0]);

/** Each problem: the short name its texts are filed under, and what the person can do about it. */
const PROBLEMS: Record<CertificateKind, { name: "untrusted" | "expired" | "site"; steps: TKey[] }> = {
  "certificate-untrusted": { name: "untrusted", steps: ["cert.untrusted.step1", "cert.untrusted.step2", "cert.untrusted.step3"] },
  "certificate-expired": { name: "expired", steps: ["cert.expired.step1", "cert.expired.step2"] },
  "certificate-site": { name: "site", steps: ["cert.site.step1", "cert.site.step2", "cert.site.step3"] },
};

interface CertificateNoticeProps {
  kind: CertificateKind;
  /** What the backend said; the notice words the problem itself, in the current language. */
  message: string | null;
  /**
   * "download": a download failed, and the person may allow it anyway in Settings.
   * "setup": yt-dlp or FFmpeg could not be fetched; that is always verified, and
   * there is no way around it.
   */
  scope?: "download" | "setup";
  /** Downloads are already allowed to go ahead anyway: there is nothing more to offer. */
  allowed?: boolean;
  onOpenSettings?: () => void;
  onDismiss?: () => void;
}

/** Explains a failed certificate check, and what to do about it. */
export default function CertificateNotice({ kind, message, scope = "download", allowed = false, onOpenSettings, onDismiss }: CertificateNoticeProps) {
  const t = useT();
  const titleId = useId();
  const problem = PROBLEMS[kind];
  const title = t(`cert.${problem.name}.title` as TKey);
  const detail = message === null ? "" : t(`cert.${problem.name}.detail` as TKey);

  return (
    <section
      role="alert"
      aria-labelledby={titleId}
      className="card animate-fade-up border-danger/30 bg-danger/[0.06] p-4"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
          <Icon name="alert" className="h-[18px] w-[18px]" />
        </span>

        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-headline font-bold text-ink">
            {title || t("cert.fallbackTitle")}
          </h2>
          {detail && <p className="mt-1 text-body text-ink-2">{detail}</p>}

          <p className="label mt-3">{t("cert.whatToDo")}</p>
          <ul className="mt-1.5 space-y-1.5 text-body text-ink-2">
            {problem.steps.map((step) => (
              <li key={step} className="flex gap-2">
                <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                <span>{t(step)}</span>
              </li>
            ))}
          </ul>

          {scope === "download" && allowed ? (
            <div className="mt-3 border-t border-danger/20 pt-3">
              <p className="text-body text-ink-2">{t("cert.allowedNote")}</p>
            </div>
          ) : scope === "download" ? (
            <div className="mt-3 border-t border-danger/20 pt-3">
              <p className="text-body text-ink-2">{t("cert.riskNote")}</p>
              {onOpenSettings && (
                <button type="button" className="btn btn-secondary mt-2" onClick={onOpenSettings}>
                  {t("cert.openSettings")}
                </button>
              )}
            </div>
          ) : (
            <p className="mt-3 text-caption text-ink-3">{t("cert.setupNote")}</p>
          )}
        </div>

        {onDismiss && (
          <button type="button" className="btn-icon -me-1 -mt-1 shrink-0" aria-label={t("common.dismiss")} onClick={onDismiss}>
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </section>
  );
}
