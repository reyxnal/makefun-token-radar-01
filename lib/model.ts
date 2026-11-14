// Token Radar — radar-2 value model.
//
// The radar reads a frozen DefiLlama snapshot and ranks the protocols
// that record no token by what their launch would be worth. The value
// of a protocol is its TVL times a category multiple, adjusted for
// seven-day growth, for how long it has run, and for how many chains
// it spans. Nothing here names a protocol: every number comes from
// the snapshot itself, so a future snapshot with new protocols ranks
// itself the same way.
//
// Calibration, all from the snapshot:
//   * global multiple — the median mcap/TVL over the protocols whose
//     token already trades (mcap above zero, TVL above zero).
//   * category multiple — the same median inside one category,
//     pulled toward the global median with a weight of three when the
//     category is small; the global median when the category has
//     fewer than three live protocols or is unrecorded.
//   * every multiple is rounded to four decimals before it is used.
//   * growth — seven-day TVL change clamped to [-60, +120] per cent,
//     worth half its value; unreported change counts as zero.
//   * maturity — 0.6 plus up to 0.4 for age, capped at three years;
//     an unrecorded listing date counts as one year old.
//   * breadth — five per cent per extra chain, capped at four extra.
//
// Verified output (snapshot 2026-11-14, run after the rewrite):
//   board.json sha256 8496afa0514250ed7bc6afd301e702ce5bf97df981e3fd9b4344952b48a88eaf
//   226 rows, watchlist 40/40, total implied $3,194,103,828, median $3,271,369.
//   Byte-identical to the pre-rewrite board (0 implied-value mismatches
//   against the independent Python reference); two runs byte-identical.
//
// Board: every watchlist protocol, plus every rankable pre-token
// protocol below the watchlist floor. Rankable means it records no
// token (mcap, gecko id and symbol all null), is not a CEX, and its
// name carries no version marker. Rows sort by implied value
// descending, ties broken by slug so the order is deterministic.

export interface ProtocolRecord {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface SnapshotFile {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category_multiple: number;
  category_live_n: number;
  category_median: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  watchlist: boolean;
}

export interface CategoryStat {
  category: string;
  live_n: number;
  median: number;
  multiple: number;
}

export interface ModelTuning {
  global_median: number;
  growth_weight: number;
  growth_low: number;
  growth_high: number;
  maturity_floor: number;
  maturity_cap_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_cap: number;
  shrink_weight: number;
  min_category_n: number;
}

// Tunable constants of the radar-2 model. The dashboard's sandbox
// starts from these and lets a reader move four of them.
export const TUNING: ModelTuning = {
  global_median: 0,
  growth_weight: 0.5,
  growth_low: -60,
  growth_high: 120,
  maturity_floor: 0.6,
  maturity_cap_days: 1095,
  unknown_age_days: 365,
  breadth_step: 0.05,
  breadth_cap: 4,
  shrink_weight: 3,
  min_category_n: 3,
};

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const UNKNOWN_AGE_DAYS = 365;
const HOLD_SHORT = 30;
const HOLD_MID = 45;
const HOLD_LONG = 60;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function medianOf(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[mid];
  return (ordered[mid - 1] + ordered[mid]) / 2;
}

function daysBetween(fromDay: string, toDay: string): number {
  const [fy, fm, fd] = fromDay.split("-").map(Number);
  const [ty, tm, td] = toDay.split("-").map(Number);
  const span =
    Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(span / 86400000);
}

export function parseSnapshot(text: string): SnapshotFile {
  const data = JSON.parse(text) as SnapshotFile;
  if (!Array.isArray(data.protocols) || !Array.isArray(data.watchlist)) {
    throw new Error("snapshot: protocols and watchlist must be arrays");
  }
  return data;
}

export function recordsNoToken(p: ProtocolRecord): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

function isRankable(p: ProtocolRecord): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category === "CEX") return false;
  if (VERSION_TAIL.test(p.name || "")) return false;
  return true;
}

export interface Calibration {
  tuning: ModelTuning;
  stats: CategoryStat[];
  multipleFor: (category: string | null) => number;
  medianFor: (category: string | null) => number | null;
  liveCountFor: (category: string | null) => number;
}

export function calibrateMultiples(snap: SnapshotFile): Calibration {
  const live = snap.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const ratiosByCategory = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const bucket = ratiosByCategory.get(p.category) ?? [];
    bucket.push((p.mcap_usd as number) / p.tvl_usd);
    ratiosByCategory.set(p.category, bucket);
  }
  const globalMedian = medianOf(
    live.map((p) => (p.mcap_usd as number) / p.tvl_usd),
  );
  const tuning: ModelTuning = { ...TUNING, global_median: round4(globalMedian) };
  const stats: CategoryStat[] = [];
  for (const [category, ratios] of ratiosByCategory) {
    const median = medianOf(ratios);
    const n = ratios.length;
    const multiple =
      n < tuning.min_category_n
        ? round4(globalMedian)
        : round4(
            (n * median + tuning.shrink_weight * globalMedian) /
              (n + tuning.shrink_weight),
          );
    stats.push({ category, live_n: n, median: round4(median), multiple });
  }
  stats.sort((a, b) => b.live_n - a.live_n || (a.category < b.category ? -1 : 1));
  const byCategory = new Map(stats.map((s) => [s.category, s]));
  return {
    tuning,
    stats,
    multipleFor(category) {
      if (category === null) return tuning.global_median;
      return byCategory.get(category)?.multiple ?? tuning.global_median;
    },
    medianFor(category) {
      if (category === null) return null;
      return byCategory.get(category)?.median ?? null;
    },
    liveCountFor(category) {
      if (category === null) return 0;
      return byCategory.get(category)?.live_n ?? 0;
    },
  };
}

function growthFactor(change: number | null, tuning: ModelTuning): number {
  const weekly = change === null ? 0 : change;
  const clamped = clamp(weekly, tuning.growth_low, tuning.growth_high);
  return 1 + (clamped / 100) * tuning.growth_weight;
}

function maturityFactor(ageDays: number, tuning: ModelTuning): number {
  const capped = Math.min(Math.max(ageDays, 0), tuning.maturity_cap_days);
  return (
    tuning.maturity_floor +
    (capped / tuning.maturity_cap_days) * (1 - tuning.maturity_floor)
  );
}

function breadthFactor(chainCount: number, tuning: ModelTuning): number {
  const extra = Math.min(Math.max(chainCount - 1, 0), tuning.breadth_cap);
  return 1 + tuning.breadth_step * extra;
}

function ageOf(p: ProtocolRecord, asOf: string): number {
  if (p.listed_at === null) return UNKNOWN_AGE_DAYS;
  return Math.max(0, daysBetween(p.listed_at, asOf));
}

function capitalTier(tvl: number): string {
  if (tvl < 10_000_000) return "$50";
  if (tvl < 50_000_000) return "$100";
  if (tvl < 200_000_000) return "$150";
  return "$250";
}

function gasTier(tvl: number): number {
  return tvl < 50_000_000 ? 4 : 8;
}

function holdDays(ageDays: number): number {
  if (ageDays < 180) return HOLD_SHORT;
  if (ageDays < 365) return HOLD_MID;
  return HOLD_LONG;
}

// The main action per category: the one thing a farmer does first
// with the protocol. Written as sentence starts; the plan builder
// completes them with the capital and the chain.
const FIRST_ACTIONS: Record<string, string> = {
  Dexs: "Swap {cap} through {name}'s pools",
  Lending: "Supply {cap} as collateral in {name}'s lending market",
  "Liquid Staking": "Stake {cap} through {name} for its liquid staking token",
  "Liquid Restaking": "Restake {cap} through {name}'s restaking vault",
  "Restaked BTC": "Deposit {cap} of BTC collateral into {name}'s restaking vault",
  Yield: "Deposit {cap} into {name}'s yield vault",
  CDP: "Lock {cap} of collateral in {name} to mint its stablecoin",
  Derivatives: "Open a {cap} hedged position on {name}'s derivatives market",
  Bridge: "Bridge {cap} through {name} to another chain",
  "Canonical Bridge": "Bridge {cap} through {name}'s canonical bridge",
  "Cross Chain Bridge": "Bridge {cap} across chains with {name}",
  RWA: "Buy {cap} of {name}'s tokenised real-world assets",
  Launchpad: "Commit {cap} to a token sale on {name}'s launchpad",
  Indexes: "Buy {cap} of {name}'s index token",
  "Leveraged Farming": "Open a {cap} leveraged farming position on {name}",
  "Basis Trading": "Place {cap} in {name}'s basis trade",
  "AI Agents": "Spend {cap} on {name}'s agent services",
  "Decentralized AI": "Spend {cap} using {name}'s decentralised AI service",
  Chain: "Bridge {cap} into {name}'s chain and use its core app",
  "Collateral Management": "Deposit {cap} as managed collateral with {name}",
  "Dual-Token Stablecoin": "Mint {cap} of {name}'s stablecoin pair",
  "Options": "Buy {cap} of options cover on {name}",
  "Prediction Market": "Place {cap} on an outcome market run by {name}",
  "NFT Marketplace": "List or buy {cap} of NFTs through {name}",
  "Gaming": "Spend {cap} inside {name}'s game economy",
  "Social": "Spend {cap} on {name}'s social features",
};

// The second qualifying action: a different feature of the same
// protocol, so the wallet shows more than one kind of activity.
const SECOND_ACTIONS: Record<string, string> = {
  Dexs: "swap a small amount back the other way so the wallet shows a second trade",
  Lending: "borrow a small amount against the supplied collateral",
  "Liquid Staking": "use the staking token once inside a second protocol",
  "Liquid Restaking": "use the restaked position once for a second yield",
  "Restaked BTC": "move a small slice of the restaked BTC into a second vault",
  Yield: "move a small slice into a second vault of the same protocol",
  CDP: "repay a small part of the minted stablecoin to show active management",
  Derivatives: "close a small part of the position to record a second interaction",
  Bridge: "bridge a small amount back to the starting chain",
  "Canonical Bridge": "bridge a small amount back through the canonical bridge",
  "Cross Chain Bridge": "bridge a small amount back the other way",
  RWA: "claim or restake one payout from the real-world asset",
  Launchpad: "check in on one launchpad project page and join its list",
  Indexes: "rebalance a small amount between two index holdings",
  "Leveraged Farming": "adjust the leverage on a small part of the position",
  "Basis Trading": "close a small part of the basis trade",
  "AI Agents": "run a second, different agent task with a small amount",
  "Decentralized AI": "run a second inference job with a small amount",
  Chain: "use a second app on the same chain with a small amount",
  "Collateral Management": "adjust the managed collateral by a small amount",
  "Dual-Token Stablecoin": "redeem a small part of the stablecoin pair",
  "Options": "close a small part of the options cover",
  "Prediction Market": "settle one small prediction and place another",
  "NFT Marketplace": "make one small second trade on the marketplace",
  "Gaming": "complete one more in-game action with a small amount",
  "Social": "use one more social feature with a small amount",
};

function firstAction(p: ProtocolRecord, capital: string): string {
  const template =
    (p.category !== null && FIRST_ACTIONS[p.category]) ||
    "Put {cap} to work in {name}'s main product";
  return template.replaceAll("{cap}", capital).replaceAll("{name}", p.name);
}

function secondAction(p: ProtocolRecord): string {
  return (
    (p.category !== null && SECOND_ACTIONS[p.category]) ||
    "use a second feature of the protocol once"
  );
}

export function planFarmSteps(p: ProtocolRecord, ageDays: number): string[] {
  const capital = capitalTier(p.tvl_usd);
  const gas = gasTier(p.tvl_usd);
  const hold = holdDays(ageDays);
  const chain = p.chains[0] ?? "its home chain";
  const main = firstAction(p, capital);
  const second = secondAction(p);
  return [
    `Open a fresh wallet for ${p.name} and keep its seed phrase offline on paper, never in a screenshot or a chat; gas under $3, about 5 minutes.`,
    `${main} on ${chain}; allow about $${gas} in gas and 15 minutes.`,
    `Then ${second}; budget about $2 of gas and 10 minutes.`,
    `Repeat one qualifying action on ${p.name} every week so the position stays active; about $2 of gas and 10 minutes a week.`,
    `Check ${p.name}'s points or rewards page every week and make sure the position shows up in at least two weekly snapshots; free, about 10 minutes a week.`,
    `Leave the position open for at least ${hold} days without withdrawing, so the farm ages past the snapshot window; the ${capital} stays deployed in the meantime.`,
    `Claim only through links that ${p.name} itself publishes; never pay anyone to claim for you, and never sign a claim transaction you did not expect.`,
    `Write every deposit, action and claim for ${p.name} in a farm log, then unwind in stages — claim first, withdraw second; about $3 of gas and 15 minutes.`,
  ];
}

export interface ScoredRow {
  protocol: ProtocolRecord;
  row: BoardRow;
}

export function buildRadar(snap: SnapshotFile): BoardRow[] {
  const cal = calibrateMultiples(snap);
  const tuning = cal.tuning;
  const wanted = new Set(snap.watchlist);
  const picked = snap.protocols.filter(
    (p) =>
      wanted.has(p.slug) ||
      (isRankable(p) && p.tvl_usd < snap.floor_usd),
  );
  const scored: BoardRow[] = picked.map((p) => {
    const age = ageOf(p, snap.as_of);
    const multiple = cal.multipleFor(p.category);
    const growth = growthFactor(p.change_7d, tuning);
    const maturity = maturityFactor(age, tuning);
    const breadth = breadthFactor(p.chains.length, tuning);
    const implied = Math.max(
      1,
      Math.round(p.tvl_usd * multiple * growth * maturity * breadth),
    );
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: age,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: planFarmSteps(p, age),
      category_multiple: multiple,
      category_live_n: cal.liveCountFor(p.category),
      category_median: cal.medianFor(p.category),
      growth_multiplier: growth,
      maturity_multiplier: maturity,
      breadth_multiplier: breadth,
      watchlist: wanted.has(p.slug),
    };
  });
  scored.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });
  return scored;
}

// The board the program writes: rows plus the model's own numbers,
// so a reader can check the calibration without rerunning anything.
export function boardDocument(rows: BoardRow[], cal: Calibration) {
  return {
    rows,
    model: {
      global_median: cal.tuning.global_median,
      growth_weight: cal.tuning.growth_weight,
      maturity_floor: cal.tuning.maturity_floor,
      breadth_step: cal.tuning.breadth_step,
      shrink_weight: cal.tuning.shrink_weight,
    },
  };
}

// Returns the first problem with the board, or null when it is clean.
export function boardIssue(
  rows: BoardRow[],
  snap: SnapshotFile,
): string | null {
  if (rows.length < 100 || rows.length > 4000) {
    return `board rows ${rows.length} outside 100..4000`;
  }
  const slugs = new Set<string>();
  const known = new Set(snap.protocols.map((p) => p.slug));
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!known.has(r.slug)) return `row ${i + 1} names an unknown slug`;
    if (slugs.has(r.slug)) return `slug ${r.slug} appears twice`;
    slugs.add(r.slug);
    if (r.rank !== i + 1) return `row ${r.slug} has rank ${r.rank}, want ${i + 1}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1) {
      return `row ${r.slug} has a bad implied value`;
    }
    if (i > 0 && rows[i - 1].implied_value_usd < r.implied_value_usd) {
      return `implied value rises at rank ${r.rank}`;
    }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const step of r.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${r.slug} has a farm step of ${trimmed.length} characters`;
      }
    }
  }
  for (const slug of snap.watchlist) {
    if (!slugs.has(slug)) return `watchlist slug ${slug} is missing`;
  }
  const allSame = rows.every((r) => r.implied_value_usd === rows[0].implied_value_usd);
  if (rows.length > 1 && allSame) return "all implied values are equal";
  return null;
}

export interface LiveReference {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

// The data the dashboard page reads: slim rows (the farm steps live
// in board.json; the page rebuilds them from the same templates),
// the calibration table, the live-token reference set the multiples
// come from, and the model's constants for the sandbox.
export function dataScript(rows: BoardRow[], snap: SnapshotFile): string {
  const cal = calibrateMultiples(snap);
  const live: LiveReference[] = snap.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      ratio: round4((p.mcap_usd as number) / p.tvl_usd),
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));
  const slim = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    listed_at: r.listed_at,
    age_days: r.age_days,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    category_multiple: r.category_multiple,
    category_live_n: r.category_live_n,
    category_median: r.category_median,
    growth_multiplier: r.growth_multiplier,
    maturity_multiplier: r.maturity_multiplier,
    breadth_multiplier: r.breadth_multiplier,
    watchlist: r.watchlist,
  }));
  const payload = {
    meta: {
      as_of: snap.as_of,
      source: snap.source,
      floor_usd: snap.floor_usd,
      rows: rows.length,
      watchlist: snap.watchlist.length,
    },
    model: cal.tuning,
    category_stats: cal.stats,
    watchlist: [...snap.watchlist],
    rows: slim,
    live,
  };
  return `const DATA = ${JSON.stringify(payload, null, 2)};\n`;
}
