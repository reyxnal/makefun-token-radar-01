// Token Radar — entrypoint.
//
// Reads the frozen snapshot, ranks the pre-token protocols with the
// radar-2 model, and writes everything the gate and the judge read:
// board.json, data.js, the dashboard, the screenshots and the
// dossier. Deterministic: the same snapshot always writes the same
// bytes, so the two grading runs agree.
//
// Usage:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildDossier } from "./vendor/makefun-board.ts";
import {
  parseSnapshot,
  calibrateMultiples,
  buildRadar,
  boardIssue,
  boardDocument,
  dataScript,
} from "./lib/model.ts";

function flagValue(argv: string[], name: string): string | null {
  const at = argv.indexOf(name);
  if (at < 0 || at + 1 >= argv.length) return null;
  return argv[at + 1];
}

function copyTopLevel(fromDir: string, toDir: string): number {
  mkdirSync(toDir, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(fromDir)) {
    const from = join(fromDir, entry);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(toDir, entry));
    copied++;
  }
  return copied;
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputPath = flagValue(argv, "--input");
  if (inputPath === null) {
    throw new Error("usage: node main.ts --input <snapshot.json>");
  }
  const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? "/output");
  const here = resolve(".");
  mkdirSync(outDir, { recursive: true });

  const snap = parseSnapshot(readFileSync(inputPath, "utf8"));
  const cal = calibrateMultiples(snap);
  const rows = buildRadar(snap);
  const issue = boardIssue(rows, snap);
  if (issue !== null) {
    throw new Error(`board issue: ${issue}`);
  }

  const boardPath = join(outDir, "board.json");
  writeFileSync(boardPath, JSON.stringify(boardDocument(rows, cal), null, 2) + "\n");
  const dataPath = join(outDir, "data.js");
  writeFileSync(dataPath, dataScript(rows, snap));
  const dashCopied = copyTopLevel(join(here, "dashboard"), join(outDir, "dashboard"));
  const shotsCopied = copyTopLevel(join(here, "screenshots"), join(outDir, "screenshots"));

  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, "dossier.json"), dossier);

  const total = rows.reduce((sum, r) => sum + r.implied_value_usd, 0);
  const middle = [...rows].sort((a, b) => a.implied_value_usd - b.implied_value_usd)[
    Math.floor(rows.length / 2)
  ].implied_value_usd;
  const covered = rows.filter((r) => r.watchlist).length;
  console.log(
    `token-radar-01 radar-2: ${rows.length} rows, watchlist ${covered}/${snap.watchlist.length}, ` +
      `global median ${cal.tuning.global_median}, total implied $${total.toLocaleString("en-US")}, ` +
      `median implied $${middle.toLocaleString("en-US")}`,
  );
  console.log(
    `wrote board.json (${rows.length} rows), data.js, dashboard/ (${dashCopied} files), ` +
      `screenshots/ (${shotsCopied} files), dossier.json (${dossier.length} bytes)`,
  );
}

main();
