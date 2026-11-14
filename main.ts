// Token launch radar — program entrypoint (Node 22+, standard library only).
//
// The grader runs this file bare, with no arguments, inside a fresh
// container: the sealed snapshot is mounted at /input/snapshot.json and
// the only writable directory is /output. So every path below has a
// grader default, and every repository-relative path is resolved from
// this file's own directory, never from the working directory.
//
// What one run produces, in order:
//   /output/board.json     the ranked board (rows, ranks, implied values)
//   /output/data.js        the same board as a script the dashboard reads
//   /output/dashboard/     the static page, copied from the repository
//   /output/screenshots/   the three captured views, copied as-is
//   /output/dossier.json   the judge's dossier, built from /output itself
//
// Local runs can point elsewhere without changing the code:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
//   node main.ts --input path/to/input-dir --output path/to/out-dir
//
// Deterministic: the same snapshot bytes always produce the same output
// bytes, so the grader's two runs of this program agree exactly.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import {
  boardDocument,
  boardIssue,
  buildRadar,
  calibrateMultiples,
  dataScript,
  parseSnapshot,
} from "./lib/model.ts";
import type { BoardRow, SnapshotFile } from "./lib/model.ts";

/** Where the grader mounts the sealed snapshot, and where output goes. */
const SEALED_INPUT_DIR = "/input";
const SEALED_SNAPSHOT_NAME = "snapshot.json";
const GRADER_OUTPUT_DIR = "/output";

/** The dossier text cap from the scorer's gate: it shapes the bytes. */
const DOSSIER_TEXT_CAP = 65_536;

/** The gate wants the board, a detail view and a filtered view. */
const SCREENSHOTS_REQUIRED = 3;

/** This file's own directory: the repository root at the graded commit. */
const REPO_ROOT = fileURLToPath(new URL(".", import.meta.url));

/** Stop with a message on stderr and a non-zero exit code. */
function abort(message: string, code: number): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(code);
}

/**
 * The value of `--name <value>` or `--name=<value>` on the command line,
 * or undefined when the flag is absent. Later occurrences win.
 */
function flagValue(flag: string): string | undefined {
  let found: string | undefined;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === `--${flag}` && i + 1 < argv.length) {
      found = argv[i + 1]!;
      i += 1;
    } else if (token.startsWith(`--${flag}=`)) {
      found = token.slice(flag.length + 3);
    }
  }
  return found;
}

/**
 * Turn the raw input argument into the snapshot file to read: a path
 * ending in .json is the file itself, anything else is a directory
 * holding snapshot.json. Defaults to the sealed /input mount.
 */
function snapshotPath(): string {
  const raw = flagValue("input") ?? SEALED_INPUT_DIR;
  const file = raw.endsWith(".json") ? raw : join(raw, SEALED_SNAPSHOT_NAME);
  if (!existsSync(file)) {
    abort(
      `no snapshot at ${file}: pass --input <snapshot.json|directory> or mount the sealed /input`,
      2,
    );
  }
  return file;
}

/**
 * The output directory: --output wins, then MAKEFUN_OUTPUT_DIR (the
 * local stand-in), then the grader's /output.
 */
function outputPath(): string {
  return flagValue("output") ?? process.env.MAKEFUN_OUTPUT_DIR ?? GRADER_OUTPUT_DIR;
}

/**
 * Mirror one directory's regular files into another, skipping names
 * that start with a dot. Returns how many files were copied.
 */
function mirrorFiles(sourceDir: string, destDir: string): number {
  if (!existsSync(sourceDir)) return 0;
  mkdirSync(destDir, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(sourceDir)) {
    if (name.startsWith(".")) continue;
    const source = join(sourceDir, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(destDir, name));
    copied += 1;
  }
  return copied;
}

/** One-line rollup of the board for the closing log line. */
function rollup(rows: BoardRow[], snap: SnapshotFile): string {
  const total = rows.reduce((sum, row) => sum + row.implied_value_usd, 0);
  const sorted = [...rows].sort((a, b) => a.implied_value_usd - b.implied_value_usd);
  const middle = sorted[Math.floor(sorted.length / 2)]!.implied_value_usd;
  const covered = rows.filter((row) => row.watchlist).length;
  return (
    `${rows.length} rows, watchlist ${covered}/${snap.watchlist.length}, ` +
    `total implied $${total.toLocaleString("en-US")}, median implied $${middle.toLocaleString("en-US")}`
  );
}

const snapshot: SnapshotFile = parseSnapshot(readFileSync(snapshotPath(), "utf8"));
const calibration = calibrateMultiples(snapshot);
const rows: BoardRow[] = buildRadar(snapshot);
const refusal = boardIssue(rows, snapshot);
if (refusal !== null) {
  abort(`the model wrote a board the gate refuses: ${refusal}`, 1);
}

const outDir = outputPath();
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "board.json"), `${JSON.stringify(boardDocument(rows, calibration), null, 2)}\n`);
writeFileSync(join(outDir, "data.js"), dataScript(rows, snapshot));

const dashboardFiles = mirrorFiles(join(REPO_ROOT, "dashboard"), join(outDir, "dashboard"));
const screenshotFiles = mirrorFiles(join(REPO_ROOT, "screenshots"), join(outDir, "screenshots"));
if (screenshotFiles < SCREENSHOTS_REQUIRED) {
  abort(
    `screenshots/ holds ${screenshotFiles} image(s): hand in ${SCREENSHOTS_REQUIRED}, the board, a detail view and a filtered view`,
    1,
  );
}

// The dossier is written last: the scorer rebuilds it from this /output
// and compares bytes, so it must see the finished directory.
const dossier = buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_CAP });
writeFileSync(join(outDir, "dossier.json"), dossier);

process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist — ${rollup(rows, snapshot)}\n` +
    `token-radar: global median ${calibration.tuning.global_median}; wrote board.json, data.js, ` +
    `dashboard/ (${dashboardFiles} files), screenshots/ (${screenshotFiles} images), ` +
    `dossier.json (${dossier.length} bytes) to ${outDir}\n`,
);
