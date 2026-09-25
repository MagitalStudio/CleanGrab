// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";
import { getSaveDir } from "../services/settings";
import { POPUP_AT_TOP } from "../services/tauri";
import { createEntry } from "../views/linkEntries";
import QuickSave, { type PopupItem } from "./QuickSave";

const noop = () => {};

/**
 * The quick-save popup as the tour shows it: the real card (`QuickSave`) with an example link, pinned
 * to the corner of the window where the popup appears on the screen, and untouchable: it is only there
 * to be looked at. It never starts anything.
 */
export default function TourPopupPreview() {
  const t = useT();
  const [saveDir, setSaveDir] = useState("");
  useEffect(() => {
    getSaveDir()
      .then(setSaveDir)
      .catch(() => {});
  }, []);

  const items = useMemo<PopupItem[]>(() => {
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const entry = { ...createEntry("mp3"), url };
    return [{ id: entry.id, link: { url, platform: "YouTube", removedTrackers: 1 }, entry, jobId: null, failure: null }];
  }, []);

  return (
    <div
      data-tour="popup"
      // React 18 has no `inert` prop yet: the attribute is set by hand, so focus and clicks cannot reach the copy.
      {...({ inert: "" } as object)}
      aria-hidden="true"
      // The real popup sits at the right of the screen in every language, so this is a physical right, not the end.
      className={`pointer-events-none fixed right-3 w-[380px] max-w-[calc(100vw-1.5rem)] ${POPUP_AT_TOP ? "top-3" : "bottom-3"}`}
    >
      {/* Not the real thing: nothing here can be clicked, and nothing is downloaded. */}
      <span className="absolute -top-2.5 start-4 z-10 rounded-full bg-accent-fill px-2 py-0.5 text-caption font-bold uppercase tracking-wider text-accent-on shadow-sm">
        {t("tour.popup.preview")}
      </span>
      <QuickSave
        items={items}
        jobs={[]}
        saveDir={saveDir}
        opacity={0.95}
        interacted
        starting={false}
        onInteract={noop}
        onChange={noop}
        onRemove={noop}
        onDownload={noop}
        onDismiss={noop}
        onOpenSetup={noop}
        onChangeFolder={noop}
        onOpenFolder={noop}
      />
    </div>
  );
}
