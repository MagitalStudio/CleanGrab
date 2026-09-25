// SPDX-License-Identifier: GPL-3.0-only
import { useSyncExternalStore } from "react";
import en from "./locales/en";

// The ten most spoken languages in the world. Each name is written in its own language,
// so a person can find theirs whatever language the app is showing.
export const LANGUAGES = [
  { code: "en", name: "English", rtl: false },
  { code: "zh", name: "中文（简体）", rtl: false },
  { code: "hi", name: "हिन्दी", rtl: false },
  { code: "es", name: "Español", rtl: false },
  { code: "fr", name: "Français", rtl: false },
  { code: "ar", name: "العربية", rtl: true },
  { code: "bn", name: "বাংলা", rtl: false },
  { code: "pt", name: "Português", rtl: false },
  { code: "ru", name: "Русский", rtl: false },
  { code: "ur", name: "اردو", rtl: true },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
/** What is saved in the settings: a language, or "system" to follow the computer's. */
export type LanguageSetting = "system" | LanguageCode;

type Plural = "one" | "other";
type Base<K> = K extends `${infer B}.${Plural}` ? B : K;
/** Every text the interface can ask for. Plural texts are asked for by their base name. */
export type TKey = Base<keyof typeof en>;
type Params = Record<string, string | number>;
type Messages = Record<string, string>;

// English is part of the app (it is the source of every key, and what a missing text falls back to).
// The other nine are loaded when they are needed, so no window carries texts nobody reads.
const LOADERS: Record<Exclude<LanguageCode, "en">, () => Promise<{ default: Messages }>> = {
  zh: () => import("./locales/zh"),
  hi: () => import("./locales/hi"),
  es: () => import("./locales/es"),
  fr: () => import("./locales/fr"),
  ar: () => import("./locales/ar"),
  bn: () => import("./locales/bn"),
  pt: () => import("./locales/pt"),
  ru: () => import("./locales/ru"),
  ur: () => import("./locales/ur"),
};
const DICTIONARIES: Partial<Record<LanguageCode, Messages>> = { en };
const loading: Partial<Record<LanguageCode, Promise<void>>> = {};

/** Makes sure the texts of a language are in memory. A language that cannot be loaded reads as English. */
export function loadLanguage(code: LanguageCode): Promise<void> {
  if (DICTIONARIES[code] || code === "en") return Promise.resolve();
  loading[code] ??= LOADERS[code]()
    .then((module) => {
      DICTIONARIES[code] = module.default;
    })
    .catch(() => {
      delete loading[code]; // tried again the next time it is asked for
    });
  return loading[code] as Promise<void>;
}

/** Loads every language (the first-run screen shows its heading in each of them). */
export const loadAllLanguages = (): Promise<void> =>
  Promise.all(LANGUAGES.map((entry) => loadLanguage(entry.code))).then(() => undefined);

const CODES: readonly string[] = LANGUAGES.map((language) => language.code);
const CACHE_KEY = "cleangrab.language";

export const isLanguageSetting = (value: unknown): value is LanguageSetting =>
  value === "system" || (typeof value === "string" && CODES.includes(value));

/** The language of this computer, when it is one of ours; English otherwise. */
export function systemLanguage(): LanguageCode {
  const preferred = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const primary = tag?.toLowerCase().split("-")[0];
    if (primary && CODES.includes(primary)) return primary as LanguageCode;
  }
  return "en";
}

export const resolveLanguage = (setting: LanguageSetting): LanguageCode => (setting === "system" ? systemLanguage() : setting);

function cachedSetting(): LanguageSetting {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (isLanguageSetting(stored)) return stored;
  } catch {
    // Storage can be unavailable; the settings file stays the source of truth.
  }
  return "system";
}

let language: LanguageCode = resolveLanguage(cachedSetting());
const listeners = new Set<() => void>();

/** Language and reading direction on the page itself, so fonts, hyphenation and layout follow. */
function announce(): void {
  const root = document.documentElement;
  root.lang = language;
  root.dir = LANGUAGES.find((entry) => entry.code === language)?.rtl ? "rtl" : "ltr";
}
announce();

/** The latest switch asked for: one that was overtaken while its texts were loading is dropped. */
let latestSwitch = 0;

/** Switches the interface to this language (or to the computer's, for "system"), once its texts are there. */
export async function setLanguageSetting(setting: LanguageSetting): Promise<void> {
  try {
    localStorage.setItem(CACHE_KEY, setting);
  } catch {
    // Storage can be unavailable.
  }
  const next = resolveLanguage(setting);
  const mine = ++latestSwitch;
  await loadLanguage(next);
  if (mine !== latestSwitch || next === language) return;
  language = next;
  announce();
  listeners.forEach((listener) => listener());
}

/** Resolves once the language shown at start (the one remembered from last time) can be read. */
export const languageReady = (): Promise<void> => loadLanguage(language);

export const currentLanguage = (): LanguageCode => language;
export const isRtl = (): boolean => document.documentElement.dir === "rtl";

const interpolate = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : text;

const pluralRules: Partial<Record<LanguageCode, Intl.PluralRules>> = {};

/**
 * The text for a key in the current language, with `{name}` filled in from `params`.
 * With a numeric `n`, the plural form that fits the count is chosen. A text a language
 * does not have yet falls back to English rather than showing a key.
 */
export function t(key: TKey, params?: Params): string {
  const messages: Messages = DICTIONARIES[language] ?? (en as Messages);
  const name: string = key;
  let text: string | undefined;

  if (params && typeof params.n === "number") {
    const rules = (pluralRules[language] ??= new Intl.PluralRules(language));
    const form = rules.select(params.n);
    text = messages[`${name}.${form}`] ?? messages[`${name}.other`] ?? (en as Messages)[`${name}.${form}`] ?? (en as Messages)[`${name}.other`];
  }
  text ??= messages[name] ?? (en as Messages)[name] ?? name;
  return interpolate(text, params);
}

/** A text in a given language, whatever the one on screen is (for showing one message in several languages). */
export function textIn(code: LanguageCode, key: TKey): string {
  const name: string = key;
  const messages: Messages = DICTIONARIES[code] ?? (en as Messages);
  return messages[name] ?? (en as Messages)[name] ?? name;
}

/** The language on screen; the component re-renders when it changes. */
export function useLanguage(): LanguageCode {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => language,
  );
}

/** For a component: gives `t` and re-renders when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => language,
  );
  return t;
}

/** A date such as "2026-09-18", written the way this language writes dates. */
export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: "long" }).format(new Date(`${iso}T12:00:00`));
  } catch {
    return iso;
  }
}

// What the engine says in English, and the text that says it in the current language. Anything
// not listed (yt-dlp's own words about a particular site, say) is shown as it came.
const KNOWN: [RegExp, TKey][] = [
  [/^This video is private or needs you to sign in/i, "err.private"],
  [/^This video is no longer available/i, "err.unavailable"],
  [/^This link isn't supported/i, "err.unsupportedLink"],
  [/^Spotify links can only be saved as MP3/i, "err.spotifyMp3Only"],
  [/^yt-dlp is not installed/i, "err.notInstalled"],
  [/^Terms of Use not accepted/i, "err.termsNotAccepted"],
  [/^This download has no file/i, "err.noFile"],
  [/^The file has been moved or deleted/i, "err.fileMoved"],
  [/^Finish setting up CleanGrab first/i, "err.setupFirst"],
  [/^Finish the one-time setup first/i, "home.setupFirst"],
  [/does not match its official checksum/i, "err.checksum"],
  [/^This file can't be found/i, "err.playerNotFound"],
  [/^This file doesn't seem to contain audio or video/i, "err.playerNoMedia"],
  [/^CleanGrab's player opens audio and video files only/i, "err.playerOnlyMedia"],
  [/^Finish CleanGrab's one-time setup to play/i, "err.playerNeedsSetup"],
  [/^ffmpeg could not convert this file/i, "err.convertFailed"],
  [/^No video could be found at this link/i, "err.noVideoFound"],
  [/^This video is protected \(DRM\)/i, "err.drm"],
  [/^Updates are not set up/i, "err.updatesNotSetUp"],
  [/^Could not check for updates/i, "err.updatesFailed"],
  [/^The downloaded update does not match/i, "err.updateChecksum"],
  [/^Could not download the update/i, "err.updateDownload"],
  [/^Downloads are still running/i, "err.updateBusy"],
  [/^The update has not been downloaded/i, "err.updateNotReady"],
  [/^Could not start the installer/i, "err.updateInstall"],
  [/^Security certificate not trusted/i, "cert.untrusted.title"],
  [/^Security certificate expired/i, "cert.expired.title"],
  [/^Security certificate is for another site/i, "cert.site.title"],
];

/** A message from the engine, in the current language when it is one we know. */
export function localizeMessage(message: string): string {
  const found = KNOWN.find(([pattern]) => pattern.test(message));
  return found ? t(found[1]) : message;
}
