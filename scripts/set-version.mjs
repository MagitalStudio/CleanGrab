// SPDX-License-Identifier: GPL-3.0-only
// Sets CleanGrab's version number everywhere it is written, so that it is never different from one
// file to the next (the update check compares the number in the app with the release's tag).
//
//   npm run version:set 0.2.0     changes the number in every file
//   npm run version:check         says whether every file has the same number

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = (relative) => join(root, relative);
const read = (relative) => readFileSync(path(relative), "utf8");

/** Each place a version is written: how to read it and how to change it. Text is edited in place, so
 *  the rest of each file (spacing, line endings, order) stays exactly as it was. */
const PLACES = [
  {
    file: "package.json",
    pattern: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    file: "src-tauri/tauri.conf.json",
    pattern: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    file: "src-tauri/Cargo.toml",
    // The first `version = "..."` at the start of a line is the package's own.
    pattern: /(^version\s*=\s*")([^"]+)(")/m,
  },
  {
    file: "src-tauri/Cargo.lock",
    pattern: /(name = "cleangrab"\r?\nversion = ")([^"]+)(")/,
  },
  {
    file: "package-lock.json",
    // The package's own number, at the top (npm keeps a second copy under "packages" > "").
    pattern: /("version"\s*:\s*")([^"]+)(")/,
  },
  {
    file: "package-lock.json",
    pattern: /("packages"\s*:\s*\{\s*""\s*:\s*\{[^}]*?"version"\s*:\s*")([^"]+)(")/,
  },
];

const found = PLACES.map((place) => {
  const match = place.pattern.exec(read(place.file));
  if (!match) throw new Error(`No version found in ${place.file}`);
  return { ...place, version: match[2] };
});

const argument = process.argv[2];

if (argument === "--check" || argument === undefined) {
  const versions = new Set(found.map((place) => place.version));
  for (const place of found) console.log(`${place.version.padEnd(10)} ${place.file}`);
  if (versions.size === 1) {
    console.log(`\nAll the same: ${[...versions][0]}`);
  } else {
    console.log("\nThe numbers differ. Fix them with: npm run version:set <number>");
    process.exitCode = 1;
  }
} else {
  if (!/^\d+\.\d+\.\d+$/.test(argument)) {
    console.error(`"${argument}" is not a version number. Write three numbers, like 0.2.0`);
    process.exit(1);
  }
  const edited = new Map();
  for (const place of PLACES) {
    const text = edited.get(place.file) ?? read(place.file);
    edited.set(place.file, text.replace(place.pattern, (_all, before, _old, after) => `${before}${argument}${after}`));
  }
  for (const [file, text] of edited) writeFileSync(path(file), text);
  console.log(`Version set to ${argument} in:`);
  for (const file of edited.keys()) console.log(`  ${file}`);
  console.log(`\nNext: commit and push, then push the tag v${argument} (git tag v${argument} && git push origin v${argument}): GitHub Actions builds the installer into a draft release.`);
}
