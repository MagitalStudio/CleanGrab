// SPDX-License-Identifier: GPL-3.0-only
import type { TKey } from "../i18n";

export interface KeyPoint {
  icon: "device" | "clipboard" | "scale";
  title: TKey;
  body: TKey;
}

/** The three things worth knowing before you agree, in plain language. */
export const KEY_POINTS: KeyPoint[] = [
  { icon: "device", title: "welcome.point1.title", body: "welcome.point1.body" },
  { icon: "clipboard", title: "welcome.point2.title", body: "welcome.point2.body" },
  { icon: "scale", title: "welcome.point3.title", body: "welcome.point3.body" },
];
