// SPDX-License-Identifier: GPL-3.0-only
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import QuickSave, { RESIZE_MS, type PopupItem } from "../components/QuickSave";
import { useJobs, useSettings } from "../hooks/useBackend";
import {
  SETUP_REQUIRED,
  errorMessage,
  onClipboardMediaDetected,
  openMain,
  startDownload,
  type DetectedLink,
} from "../services/downloader";
import { chooseFolder, getSaveDir, openSaveDir } from "../services/settings";
import { hasTauriRuntime, hideThisWindow, POPUP_AT_TOP as ANCHORED_TOP } from "../services/tauri";
import { activateToast, presentToast } from "../services/toast";
import { analyzeEntry, createEntry, patchEntryFields, type Entry } from "../views/linkEntries";

const EXIT_MS = 160;

const RESIZE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
/** After the window has grown, how long before the card starts sliding into it. */
const WINDOW_SETTLE_MS = 24;

function makeItem(link: DetectedLink, format: Entry["format"]): PopupItem {
  const entry = { ...createEntry(format), url: link.url };
  return { id: entry.id, link, entry, jobId: null, failure: null };
}

/**
 * The floating quick-save window. The backend announces every supported link
 * that is copied; this window lists them, lets each one be tuned (format,
 * quality, trim) and downloads them together. It sizes and shows itself.
 */
export default function ToastWindow() {
  const [items, setItems] = useState<PopupItem[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [saveDir, setSaveDir] = useState("");
  const jobs = useJobs();
  const [settings, updateSettings] = useSettings();

  const exitTimer = useRef<ReturnType<typeof setTimeout>>();
  // Counts links arriving, so a hide that was already under way can tell that a newer link came in.
  const arrivals = useRef(0);
  // Read by callbacks that outlive a render: is the popup on its way out?
  const closing = useRef(false);
  const interactedRef = useRef(false);
  // The popup's natural height, and the (animated) height it is drawn at.
  const naturalRef = useRef<HTMLDivElement>(null);
  const [drawnHeight, setDrawnHeight] = useState<number | null>(null);
  const windowHeight = useRef(0);
  // Height the popup only keeps for a moment (see QuickSave's onHold), and a way to re-measure.
  const heldHeight = useRef(0);
  const remeasure = useRef<() => void>(() => {});
  const shrinkTimer = useRef<ReturnType<typeof setTimeout>>();
  const hasItems = items.length > 0;

  useEffect(() => {
    getSaveDir().then(setSaveDir).catch(() => {});
  }, [settings?.saveDir]);

  // A link was copied: start a new popup, or add it to the one that is open.
  useEffect(() => {
    const add = (link: DetectedLink) => {
      arrivals.current += 1;
      clearTimeout(exitTimer.current);
      closing.current = false;
      setLeaving(false);
      setItems((current) => {
        if (current.length === 0) return [makeItem(link, "mp3")];
        // Already waiting in the list: nothing to add.
        if (current.some((item) => item.link.url === link.url && !item.jobId && !item.failure)) return current;
        return [...current, makeItem(link, current[current.length - 1].entry.format)];
      });
    };

    // In a plain browser preview there is no clipboard daemon, so show a sample.
    if (!hasTauriRuntime() && import.meta.env.DEV) {
      add({ url: "https://youtu.be/dQw4w9WgXcQ", platform: "YouTube", removedTrackers: 2 });
    }
    return onClipboardMediaDetected(add);
  }, []);

  // A started download appears in the job list a moment after its id comes
  // back. Note when it has, so that until then it reads as starting (never as
  // saved), and give up waiting after a few seconds in case it never does.
  useEffect(() => {
    const waiting = items.filter((item) => item.jobId && !item.seen);
    if (waiting.length === 0) return;

    const listed = new Set(jobs.map((job) => job.id));
    const arrived = new Set(waiting.filter((item) => listed.has(item.jobId as string)).map((item) => item.id));
    if (arrived.size > 0) {
      setItems((current) => current.map((item) => (arrived.has(item.id) ? { ...item, seen: true } : item)));
      return;
    }
    const timer = setTimeout(
      () => setItems((current) => current.map((item) => (item.jobId && !item.seen ? { ...item, seen: true } : item))),
      3000,
    );
    return () => clearTimeout(timer);
  }, [jobs, items]);

  // Follow the content's height. The window jumps straight to the size it will
  // need (it is transparent, so nothing shows), while the card itself changes
  // height with a CSS transition. Growing is immediate; shrinking waits for the
  // animation to finish so the window never cuts the card off.
  useLayoutEffect(() => {
    if (!hasItems) {
      setDrawnHeight(null);
      windowHeight.current = 0;
      return;
    }
    const element = naturalRef.current;
    if (!element) return;

    let frame = 0;
    // Only the latest measurement gets to start an animation.
    let version = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (closing.current) return; // never bring a closing window back
        const height = Math.ceil(element.getBoundingClientRect().height) - heldHeight.current;
        const current = ++version;

        clearTimeout(shrinkTimer.current);
        if (height >= windowHeight.current) {
          // Growing: make the window big enough first, and only then let the card
          // slide into it. Starting the slide while the window is still small
          // would cut the card off for a few frames, which shows as a flicker.
          windowHeight.current = height;
          presentToast(height)
            .catch(() => {})
            .then(() => {
              // Give the page a moment to take on the window's new size.
              requestAnimationFrame(() =>
                setTimeout(() => {
                  if (current === version && !closing.current) setDrawnHeight(height);
                }, WINDOW_SETTLE_MS),
              );
            });
        } else {
          // Shrinking: slide the card first, and only shrink the window after.
          setDrawnHeight(height);
          shrinkTimer.current = setTimeout(() => {
            if (closing.current) return;
            windowHeight.current = height;
            presentToast(height).catch(() => {});
          }, RESIZE_MS + 30);
        }
      });
    };

    remeasure.current = measure;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(shrinkTimer.current);
      observer.disconnect();
    };
  }, [hasItems]);

  const dismiss = useCallback(() => {
    closing.current = true;
    setLeaving(true);
    const seenArrivals = arrivals.current;
    exitTimer.current = setTimeout(() => {
      hideThisWindow()
        .catch(() => {})
        .finally(() => {
          // A link copied while the window was hiding keeps the popup: it is shown again.
          if (arrivals.current !== seenArrivals) return;
          setItems([]);
          interactedRef.current = false;
          setInteracted(false);
          setLeaving(false);
          closing.current = false;
        });
    }, EXIT_MS);
  }, []);

  // The popup never takes focus on its own. The first click gives it focus so
  // trim times can be typed.
  const interact = useCallback(() => {
    if (interactedRef.current) return;
    interactedRef.current = true;
    setInteracted(true);
    void activateToast().catch(() => {});
  }, []);

  // A menu closed: the popup should slide back down now, though its content
  // still holds the menu's room for a moment.
  const hold = useCallback((pixels: number) => {
    heldHeight.current = pixels;
    remeasure.current();
  }, []);

  const changeItem = useCallback((id: string, patch: Partial<Entry>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, entry: patchEntryFields(item.entry, patch) } : item)),
    );
  }, []);

  const removeItem = useCallback(
    (id: string) => {
      const remaining = items.filter((item) => item.id !== id);
      if (remaining.length === 0) dismiss();
      else setItems(remaining);
    },
    [items, dismiss],
  );

  const download = async () => {
    if (starting) return;
    setStarting(true);

    for (const item of items) {
      if (item.jobId || item.failure) continue;
      const row = analyzeEntry(item.entry, { text: item.link.url, link: item.link });
      if (!row.ready) continue;

      try {
        const jobId = await startDownload(item.link.url, row.format, row.trim, row.quality);
        setItems((current) => current.map((it) => (it.id === item.id ? { ...it, jobId } : it)));
      } catch (error) {
        const message = errorMessage(error);
        const failure =
          message === SETUP_REQUIRED
            ? { message: "Finish setting up CleanGrab first", needsSetup: true }
            : { message, needsSetup: false };
        setItems((current) => current.map((it) => (it.id === item.id ? { ...it, failure } : it)));
      }
    }

    setStarting(false);
  };

  const changeFolder = async () => {
    const folder = await chooseFolder().catch(() => null);
    if (folder) updateSettings({ saveDir: folder });
  };

  const openSetup = () => {
    void openMain("home");
    dismiss();
  };

  if (!hasItems) return null;

  return (
    // Pinned to the edge the window is anchored to, so the card grows away from it.
    <div
      className={`fixed inset-x-0 transition-opacity duration-150 ${ANCHORED_TOP ? "top-0" : "bottom-0"} ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
    >
      <div
        className="overflow-hidden"
        style={{
          // No height until the first measurement, so the first paint is not animated.
          height: drawnHeight ?? undefined,
          transition: `height ${RESIZE_MS}ms ${RESIZE_EASING}`,
        }}
      >
        <div ref={naturalRef}>
          <QuickSave
            items={items}
            jobs={jobs}
            saveDir={saveDir}
            opacity={settings?.popupOpacity ?? 0.95}
            interacted={interacted}
            starting={starting}
            onInteract={interact}
            onHold={hold}
            onChange={changeItem}
            onRemove={removeItem}
            onDownload={() => void download()}
            onDismiss={dismiss}
            onOpenSetup={openSetup}
            onChangeFolder={() => void changeFolder()}
            onOpenFolder={() => void openSaveDir().catch(() => {})}
          />
        </div>
      </div>
    </div>
  );
}
