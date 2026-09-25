// SPDX-License-Identifier: GPL-3.0-only
import { useId, type ReactNode } from "react";

// One icon family: 16px grid, 1.5 stroke, round caps. Every icon that stands
// alone must be given an accessible label by the control that wraps it.
const PATHS: Record<string, ReactNode> = {
  download: (
    <>
      <path d="M8 2.5v7.5" />
      <path d="M4.75 7.25 8 10.5l3.25-3.25" />
      <path d="M3 13h10" />
    </>
  ),
  folder: <path d="M2 4.75A1.25 1.25 0 0 1 3.25 3.5h2.4l1.35 1.5h5.75A1.25 1.25 0 0 1 14 6.25v5.5a1.25 1.25 0 0 1-1.25 1.25h-9.5A1.25 1.25 0 0 1 2 11.75v-7Z" />,
  // A cog: eight teeth around a hub with a round hole.
  gear: (
    <>
      <path d="M6.74 2.95 L7.08 1.46 L8.92 1.46 L9.26 2.95 A5.2 5.2 0 0 1 10.68 3.54 L11.97 2.73 L13.27 4.03 L12.46 5.32 A5.2 5.2 0 0 1 13.05 6.74 L14.54 7.08 L14.54 8.92 L13.05 9.26 A5.2 5.2 0 0 1 12.46 10.68 L13.27 11.97 L11.97 13.27 L10.68 12.46 A5.2 5.2 0 0 1 9.26 13.05 L8.92 14.54 L7.08 14.54 L6.74 13.05 A5.2 5.2 0 0 1 5.32 12.46 L4.03 13.27 L2.73 11.97 L3.54 10.68 A5.2 5.2 0 0 1 2.95 9.26 L1.46 8.92 L1.46 7.08 L2.95 6.74 A5.2 5.2 0 0 1 3.54 5.32 L2.73 4.03 L4.03 2.73 L5.32 3.54 A5.2 5.2 0 0 1 6.74 2.95Z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  x: <path d="m4 4 8 8M12 4l-8 8" />,
  plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
  scissors: (
    <>
      <circle cx="4.25" cy="4.5" r="1.75" />
      <circle cx="4.25" cy="11.5" r="1.75" />
      <path d="M5.6 5.6 13.5 12M5.6 10.4 13.5 4" />
    </>
  ),
  check: <path d="m3.5 8.5 3 3 6-7" />,
  clipboard: (
    <>
      <rect x="3.25" y="3" width="9.5" height="10.5" rx="1.5" />
      <path d="M6 3V2.5A.5.5 0 0 1 6.5 2h3a.5.5 0 0 1 .5.5V3" />
      <path d="M5.75 7h4.5M5.75 9.75h3" />
    </>
  ),
  device: (
    <>
      <rect x="2.25" y="3" width="11.5" height="7.5" rx="1.25" />
      <path d="M1.5 13h13" />
    </>
  ),
  scale: (
    <>
      <path d="M8 2.5v11M5 13.5h6" />
      <path d="M3 5h10" />
      <path d="m3 5-1.75 4.25a2 2 0 0 0 3.5 0L3 5ZM13 5l-1.75 4.25a2 2 0 0 0 3.5 0L13 5Z" />
    </>
  ),
  // A folder with an arrow inside: pick a different folder.
  folderPick: (
    <>
      <path d="M2 4.75A1.25 1.25 0 0 1 3.25 3.5h2.4l1.35 1.5h5.75A1.25 1.25 0 0 1 14 6.25v5.5a1.25 1.25 0 0 1-1.25 1.25h-9.5A1.25 1.25 0 0 1 2 11.75v-7Z" />
      <path d="M5.75 9h4.5M8.75 7l1.75 2-1.75 2" />
    </>
  ),
  trash: (
    <>
      <path d="M3 4.5h10M6.5 4.5V3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75V4.5" />
      <path d="m4.5 4.5.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" />
    </>
  ),
  retry: (
    <>
      <path d="M13 8a5 5 0 1 1-1.6-3.67" />
      <path d="M13 2.75v2.5h-2.5" />
    </>
  ),
  paste: (
    <>
      <rect x="3" y="3.5" width="7" height="9.5" rx="1.25" />
      <path d="M10 6h1.75A1.25 1.25 0 0 1 13 7.25v4.5A1.25 1.25 0 0 1 11.75 13H10" />
    </>
  ),
  chevron: <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9" />
    </>
  ),
  moon: <path d="M13.25 9.4A5.5 5.5 0 0 1 6.6 2.75a5.5 5.5 0 1 0 6.65 6.65Z" />,
  sparkle: <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4.2 4.2l1.6 1.6M10.2 10.2l1.6 1.6M11.8 4.2l-1.6 1.6M5.8 10.2l-1.6 1.6" />,
  alert: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 5v3.5M8 10.75v.01" />
    </>
  ),
  home: <path d="M2.5 7.25 8 2.5l5.5 4.75v5.25a1 1 0 0 1-1 1h-2.75V9.75h-3.5v3.75H3.5a1 1 0 0 1-1-1Z" />,
  // Player: solid shapes, so they read clearly at a small size.
  play: <path d="M5.4 3.6v8.8a.5.5 0 0 0 .77.42l6.9-4.4a.5.5 0 0 0 0-.84l-6.9-4.4a.5.5 0 0 0-.77.42Z" fill="currentColor" />,
  pause: (
    <>
      <rect x="3.75" y="3" width="3" height="10" rx="1" fill="currentColor" />
      <rect x="9.25" y="3" width="3" height="10" rx="1" fill="currentColor" />
    </>
  ),
  volume: (
    <>
      <path d="M2.75 6.25h2L8 3.5v9L4.75 9.75h-2a.5.5 0 0 1-.5-.5v-2.5a.5.5 0 0 1 .5-.5Z" fill="currentColor" />
      <path d="M10.4 5.9a3.1 3.1 0 0 1 0 4.2M12.2 4.1a5.6 5.6 0 0 1 0 7.8" />
    </>
  ),
  volumeMute: (
    <>
      <path d="M2.75 6.25h2L8 3.5v9L4.75 9.75h-2a.5.5 0 0 1-.5-.5v-2.5a.5.5 0 0 1 .5-.5Z" fill="currentColor" />
      <path d="m10.5 6 3.5 4M14 6l-3.5 4" />
    </>
  ),
  fullscreen: <path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />,
  fullscreenExit: <path d="M6 2.5V5a1 1 0 0 1-1 1H2.5M13.5 6H11a1 1 0 0 1-1-1V2.5M10 13.5V11a1 1 0 0 1 1-1h2.5M2.5 10H5a1 1 0 0 1 1 1v2.5" />,
  repeat: <path d="M3 7.5V7a2 2 0 0 1 2-2h7M10 3l2 2-2 2M13 8.5V9a2 2 0 0 1-2 2H4M6 13l-2-2 2-2" />,
};

interface IconProps {
  name: keyof typeof PATHS;
  className?: string;
}

export default function Icon({ name, className = "h-4 w-4" }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The CleanGrab logo: a blue loop ending in a download arrow, on a transparent background. */
export function Mark({ className = "h-14 w-14" }: { className?: string }) {
  const gradient = `mark-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="35 35 137 152" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#4fb0ff" />
          <stop offset="0.5" stopColor="#0071e3" />
          <stop offset="1" stopColor="#0044b8" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradient})`}
        d="M 96.477315 44.905269 C 83.325173 45.582301 70.56138 51.028614 60.881038 60.708956 C 45.392495 76.197501 40.740761 99.581767 49.1231 119.81853 C 57.073572 139.01267 75.316322 151.91566 95.86495 153.19427 C 96.510292 153.30696 97.174366 153.36583 97.852942 153.36583 L 117.54063 153.36583 C 123.8517 153.36583 128.9327 148.28483 128.9327 141.97376 L 128.9327 141.74225 C 128.9327 135.43118 123.8517 130.3507 117.54063 130.3507 L 99.232186 130.3507 L 99.232186 130.29902 C 86.564651 130.29902 75.220619 122.71872 70.372965 111.01545 C 65.525311 99.312167 68.187347 85.929862 77.144645 76.972563 C 86.101944 68.015263 99.484252 65.353744 111.18753 70.2014 C 122.63286 74.942213 130.13462 85.898164 130.45974 98.227079 L 130.45405 98.227079 L 130.45405 153.29969 L 128.9327 153.29969 A 7.0951109 7.1093693 0 0 0 121.83752 160.40881 A 7.0951109 7.1093693 0 0 0 123.09895 164.43492 L 123.07259 164.41735 L 123.11135 164.45456 A 7.0951109 7.1093693 0 0 0 125.2213 166.46839 L 137.73991 174.29944 A 7.0951109 7.1093693 0 0 0 141.96188 175.69522 A 7.0951109 7.1093693 0 0 0 146.02209 174.41623 L 146.02313 174.41571 A 7.0951109 7.1093693 0 0 0 146.02416 174.41519 L 158.2105 166.60223 A 7.0951109 7.1093693 0 0 0 158.21205 166.6012 A 7.0951109 7.1093693 0 0 0 161.82216 160.40881 A 7.0951109 7.1093693 0 0 0 154.72699 153.29969 L 153.47022 153.29969 L 153.47022 99.062687 L 153.47074 99.062687 C 153.47074 98.991457 153.4705 98.919933 153.47022 98.848747 L 153.47022 98.227079 L 153.46402 98.227079 C 153.13203 76.655665 139.96714 57.228704 119.98802 48.953084 C 112.39924 45.809706 104.3686 44.499051 96.477315 44.905269 z"
      />
    </svg>
  );
}
