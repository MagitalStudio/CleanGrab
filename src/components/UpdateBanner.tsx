// SPDX-License-Identifier: GPL-3.0-only
import type { UpdateState } from "../hooks/useUpdate";
import { useT } from "../i18n";
import Icon from "./Icons";
import UpdateControls from "./UpdateControls";

/**
 * At the top of Home when a newer CleanGrab has been published: says so, and lets the person
 * download it here, then install it with a button. "Later" hides it for this version, unless the
 * update is being downloaded or is ready to install.
 */
export default function UpdateBanner({ news }: { news: UpdateState }) {
  const t = useT();
  const { update, progress, dismiss } = news;
  if (!update) return null;
  const waiting = progress.stage === "downloading" || progress.stage === "ready";
  return (
    <section
      role="status"
      aria-labelledby="update-title"
      className="card flex animate-fade-up flex-wrap items-center gap-x-4 gap-y-3 border-accent-fill/40 p-4"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-fill/15 text-accent">
        <Icon name="download" className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-[12rem] flex-1">
        <h2 id="update-title" className="text-headline font-bold text-ink">
          {t("update.banner.title", { version: update.version })}
        </h2>
        <p className="mt-0.5 text-body text-ink-2">{progress.stage === "ready" ? t("update.readyNote") : t("update.banner.body")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!waiting && (
          <button type="button" className="btn btn-ghost" onClick={dismiss}>
            {t("update.later")}
          </button>
        )}
        <UpdateControls news={news} />
      </div>
    </section>
  );
}
