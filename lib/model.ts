// Token Radar — radar-3 value model.
//
// The radar reads a frozen DefiLlama snapshot and ranks the protocols
// that record no token by what their launch would be worth. Nothing
// here names a protocol: every number comes from the snapshot itself,
// so a future snapshot with new protocols ranks itself the same way.
//
// The value curve (fitted, not assumed). Market cap grows slower than
// TVL across the live-token comps, so a flat mcap/TVL multiple would
// overvalue the biggest protocols. The curve is an ordinary-least-
// squares fit of log10(market cap) on log10(TVL) over the live comps:
//   log10(value) = intercept + slope * log10(tvl).
// On top of the curve sits a category shift: the median log residual
// inside one category, pulled toward zero with a weight of three
// (empirical-Bayes-style shrinkage — small categories borrow the
// curve), zero when the category has fewer than three live protocols
// or is unrecorded. The curve base and the shift factor are rounded
// (to cents and to six decimals) before they are used, so the page,
// the board and an independent audit all recompute the same dollars.
//
// The launch adjustments. The curve predicts a market value; a launch
// is worth more when the protocol is growing, seasoned and broad, so
// the curve value is multiplied by three stated priors:
//   * growth — seven-day TVL change clamped to [-60, +120] per cent,
//     worth half its value; unreported change counts as zero.
//   * maturity — 0.6 plus up to 0.4 for age, capped at three years;
//     an unrecorded listing date counts as one year old.
//   * breadth — five per cent per extra chain, capped at four extra.
// Implied value = curve base x category shift x growth x maturity
// x breadth, rounded to whole dollars, at least $1.
//
// Blind validation. The curve is tested out of sample before it is
// trusted: leave-one-out over all live comps, a seeded random 70/30
// split, and a time split at the median listing date (undated comps
// excluded from that scheme, and the count is reported). Four
// predictors run on every scheme — the full model, the curve alone,
// the power law alone, and a global-median-only baseline — each
// scored by median absolute log10 error and the hit rate within 2x.
// The uncertainty band comes from the full model's leave-one-out
// error: band factor = 10 ^ median error, so the low end of the band
// is implied / band factor. The band is what the farm economics use.
//
// Farm economics. Every row is netted to dollars at the LOW end of
// the band, under assumptions stated on the page: the farmer's share
// is 0.001% of fully diluted value (a 10% airdrop pool shared by
// 10,000 qualifying wallets), time is worth $15 an hour, and the
// alternative is a 4.5% T-bill over the hold period. Farm cost is the
// gas named in the farm steps plus the time the steps name. The
// verdict is farm when the net covers the cost — the low-end value
// is at least twice the cost — thin when the net is positive but
// below that margin, and skip when the net is zero or worse, or
// loses to the T-bill.
//
// Rank ranges. Two hundred bootstrap refits resample the live comps
// with replacement (one seeded stream), refit the curve, and re-rank
// the board; each row's range is the 5th–95th percentile of its 200
// ranks. Same seed, same ranges, every run.
//
// Board: every watchlist protocol, plus every rankable pre-token
// protocol below the watchlist floor. Rankable means it records no
// token (mcap, gecko id and symbol all null), is not a CEX, and its
// name carries no version marker. Rows sort by implied value
// descending, ties broken by slug so the order is deterministic.
//
// Determinism: one seeded generator, fixed split rules, rounded
// intermediates. The same snapshot bytes always produce the same
// output bytes.
//
// Verified output (snapshot 2026-11-14, independent Python audit):
//   curve slope 0.522266, intercept 3.024669, R2 0.193917, 128 comps.
//   LOO full-model error 0.5981 (baseline 0.7050), band x3.9637.
//   226 rows, watchlist 40/40, total implied $1,821,203,487, median
//   $4,988,071. Verdicts 1 farm / 5 thin / 220 skip.
//   Audit: 226/226 implied values exact, all backtest cells exact,
//   all 200-refit bootstrap ranges exact, all economics exact.
//   Two runs byte-identical (see the run log in the workdir).

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

export type Verdict = "farm" | "thin" | "skip";

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
  rank_low: number;
  rank_high: number;
  implied_value_usd: number;
  curve_base_usd: number;
  category_shift_factor: number;
  category_live_n: number;
  category_residual: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  band_low_usd: number;
  expected_usd: number;
  gas_usd: number;
  time_usd: number;
  farm_cost_usd: number;
  net_usd: number;
  tbill_usd: number;
  verdict: Verdict;
  farm_steps: string[];
  watchlist: boolean;
}

export interface CategoryStat {
  category: string;
  live_n: number;
  residual_median: number;
  shift: number;
  shift_factor: number;
}

export interface ModelTuning {
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

// Tunable constants of the radar-3 model. The dashboard's sandbox
// starts from these and lets a reader move four of them.
export const TUNING: ModelTuning = {
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

// The stated economics assumptions. They are constants, not fitted:
// the page shows them next to every verdict they produce.
export const ECONOMICS = {
  farmer_share: 0.00001,
  time_value_usd_per_hour: 15,
  tbill_rate: 0.045,
  margin_multiple: 1,
  wallet_gas_usd: 3,
  second_action_gas_usd: 2,
  weekly_gas_usd: 2,
  unwind_gas_usd: 3,
  setup_minutes: 30,
  weekly_minutes: 20,
  unwind_minutes: 15,
};

// One fixed seed drives the random split and the bootstrap stream,
// so both are reproducible from the snapshot alone.
export const VALIDATION_SEED = 20261114;
export const BOOTSTRAP_REFITS = 200;

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

function round6(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

// Mulberry32: the one deterministic generator in the model. The
// independent audit mirrors this exact recurrence, including the
// 32-bit masking, so its refits and splits match bit for bit.
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

// The live comps, slug-sorted: the one canonical order every split,
// refit and resample draws from, so the draws are reproducible.
export function liveComps(snap: SnapshotFile): ProtocolRecord[] {
  return snap.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

export interface CurveFit {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
  global_median: number;
  stats: CategoryStat[];
  shiftFor: (category: string | null) => number;
  shiftFactorFor: (category: string | null) => number;
  residualFor: (category: string | null) => number | null;
  liveCountFor: (category: string | null) => number;
}

// Fit the curve on a set of live comps: OLS of log10(mcap) on
// log10(TVL), plus the shrunk category residual shifts. The slope,
// intercept and residual medians are rounded to six decimals at fit
// time; every prediction downstream uses the rounded values.
export function fitCurve(live: ProtocolRecord[], tuning: ModelTuning): CurveFit {
  const n = live.length;
  if (n < 2) throw new Error("fitCurve: need at least two live comps");
  const xs = live.map((p) => Math.log10(p.tvl_usd));
  const ys = live.map((p) => Math.log10(p.mcap_usd as number));
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0) throw new Error("fitCurve: all live comps share one TVL");
  const slope = round6(sxy / sxx);
  const intercept = round6(meanY - slope * meanX);
  const r2 = syy === 0 ? 0 : round6((sxy * sxy) / (sxx * syy));
  const globalMedian = round4(
    medianOf(live.map((p) => (p.mcap_usd as number) / p.tvl_usd)),
  );
  const residualsByCategory = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const residual =
      Math.log10(p.mcap_usd as number) -
      (intercept + slope * Math.log10(p.tvl_usd));
    const bucket = residualsByCategory.get(p.category) ?? [];
    bucket.push(residual);
    residualsByCategory.set(p.category, bucket);
  }
  const stats: CategoryStat[] = [];
  for (const [category, residuals] of residualsByCategory) {
    const median = round6(medianOf(residuals));
    const count = residuals.length;
    const shift =
      count < tuning.min_category_n
        ? 0
        : round6((count * median) / (count + tuning.shrink_weight));
    stats.push({
      category,
      live_n: count,
      residual_median: median,
      shift,
      shift_factor: round6(Math.pow(10, shift)),
    });
  }
  stats.sort((a, b) => b.live_n - a.live_n || (a.category < b.category ? -1 : 1));
  const byCategory = new Map(stats.map((s) => [s.category, s]));
  return {
    slope,
    intercept,
    r2,
    n,
    global_median: globalMedian,
    stats,
    shiftFor(category) {
      if (category === null) return 0;
      return byCategory.get(category)?.shift ?? 0;
    },
    shiftFactorFor(category) {
      if (category === null) return 1;
      return byCategory.get(category)?.shift_factor ?? 1;
    },
    residualFor(category) {
      if (category === null) return null;
      return byCategory.get(category)?.shift ?? null;
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

// The curve value of one protocol's TVL, before the category shift
// and the launch adjustments. Rounded to cents, like every other
// intermediate the board, the page and the audit share.
export function curveBase(tvl: number, fit: CurveFit): number {
  return round2(Math.pow(10, fit.intercept + fit.slope * Math.log10(tvl)));
}

export interface Prediction {
  implied: number;
  curveBase: number;
  shiftFactor: number;
  growth: number;
  maturity: number;
  breadth: number;
}

// The one prediction path: board rows, backtest folds and bootstrap
// refits all score through here, so they cannot drift apart.
export function predictValue(
  p: ProtocolRecord,
  ageDays: number,
  fit: CurveFit,
  tuning: ModelTuning,
): Prediction {
  const base = curveBase(p.tvl_usd, fit);
  const shiftFactor = fit.shiftFactorFor(p.category);
  const growth = growthFactor(p.change_7d, tuning);
  const maturity = maturityFactor(ageDays, tuning);
  const breadth = breadthFactor(p.chains.length, tuning);
  const implied = Math.max(
    1,
    Math.round(base * shiftFactor * growth * maturity * breadth),
  );
  return { implied, curveBase: base, shiftFactor, growth, maturity, breadth };
}

function capitalUsd(tvl: number): number {
  if (tvl < 10_000_000) return 50;
  if (tvl < 50_000_000) return 100;
  if (tvl < 200_000_000) return 150;
  return 250;
}

function capitalTier(tvl: number): string {
  return `$${capitalUsd(tvl)}`;
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

// ---- blind validation -------------------------------------------------

export interface PredictorScore {
  n: number;
  med_abs_log_err: number;
  hit_rate_2x: number;
}

export interface SchemeResult {
  id: string;
  label: string;
  train_n: number;
  test_n: number;
  excluded_n: number;
  cutoff?: string;
  seed?: number;
  scores: Record<string, PredictorScore>;
}

export interface Validation {
  schemes: SchemeResult[];
  band: { log_err: number; factor: number; source: string; predictor: string };
}

const LOG2 = Math.log10(2);

function scorePredictions(pairs: Array<[number, number]>): PredictorScore {
  const errors = pairs
    .map(([predicted, actual]) => Math.abs(Math.log10(predicted) - Math.log10(actual)))
    .sort((a, b) => a - b);
  const median = medianOf(errors);
  const hits = pairs.filter(
    ([predicted, actual]) => Math.abs(Math.log10(predicted / actual)) <= LOG2,
  ).length;
  return {
    n: pairs.length,
    med_abs_log_err: round4(median),
    hit_rate_2x: round4(hits / pairs.length),
  };
}

type PredictorId = "full" | "curve" | "powerlaw" | "baseline";

// One prediction for one held-out protocol, under one predictor, from
// a fit that never saw that protocol.
function predictHeldOut(
  p: ProtocolRecord,
  ageDays: number,
  fit: CurveFit,
  tuning: ModelTuning,
  predictor: PredictorId,
): number {
  if (predictor === "full") return predictValue(p, ageDays, fit, tuning).implied;
  if (predictor === "curve") {
    return Math.max(1, Math.round(curveBase(p.tvl_usd, fit) * fit.shiftFactorFor(p.category)));
  }
  if (predictor === "powerlaw") {
    return Math.max(1, Math.round(curveBase(p.tvl_usd, fit)));
  }
  return Math.max(1, Math.round(p.tvl_usd * fit.global_median));
}

function scoreScheme(
  train: ProtocolRecord[],
  test: ProtocolRecord[],
  snap: SnapshotFile,
  tuning: ModelTuning,
): Record<string, PredictorScore> {
  const fit = fitCurve(train, tuning);
  const predictors: PredictorId[] = ["full", "curve", "powerlaw", "baseline"];
  const scores: Record<string, PredictorScore> = {};
  for (const predictor of predictors) {
    const pairs = test.map(
      (p) =>
        [
          predictHeldOut(p, ageOf(p, snap.as_of), fit, tuning, predictor),
          p.mcap_usd as number,
        ] as [number, number],
    );
    scores[predictor] = scorePredictions(pairs);
  }
  return scores;
}

export function backtestModel(
  snap: SnapshotFile,
  live: ProtocolRecord[],
  tuning: ModelTuning,
): Validation {
  // Leave-one-out: every comp is predicted once, from a fit on the
  // other 127. The band is built from this scheme's full-model error.
  const looScores: Record<string, Array<[number, number]>> = {
    full: [],
    curve: [],
    powerlaw: [],
    baseline: [],
  };
  const predictors: PredictorId[] = ["full", "curve", "powerlaw", "baseline"];
  for (let i = 0; i < live.length; i++) {
    const train = live.filter((_, j) => j !== i);
    const fit = fitCurve(train, tuning);
    const held = live[i];
    for (const predictor of predictors) {
      looScores[predictor].push([
        predictHeldOut(held, ageOf(held, snap.as_of), fit, tuning, predictor),
        held.mcap_usd as number,
      ]);
    }
  }
  const loo: SchemeResult = {
    id: "loo",
    label: "Leave-one-out",
    train_n: live.length - 1,
    test_n: live.length,
    excluded_n: 0,
    scores: {
      full: scorePredictions(looScores.full),
      curve: scorePredictions(looScores.curve),
      powerlaw: scorePredictions(looScores.powerlaw),
      baseline: scorePredictions(looScores.baseline),
    },
  };

  // Seeded random split: the slug-sorted comps are shuffled with one
  // Fisher-Yates pass (mulberry32, fixed seed) and cut 70/30.
  const order = live.map((_, i) => i);
  const rnd = mulberry32(VALIDATION_SEED);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const nTrain = Math.floor(live.length * 0.7);
  const random: SchemeResult = {
    id: "random",
    label: "Random 70/30",
    train_n: nTrain,
    test_n: live.length - nTrain,
    excluded_n: 0,
    seed: VALIDATION_SEED,
    scores: scoreScheme(
      order.slice(0, nTrain).map((i) => live[i]),
      order.slice(nTrain).map((i) => live[i]),
      snap,
      tuning,
    ),
  };

  // Time split: fit on the comps listed before the median listing
  // date, predict the ones listed on or after it. Undated comps take
  // no part in this scheme, and the page says how many that is.
  const dated = live.filter((p) => p.listed_at !== null);
  const dates = dated.map((p) => p.listed_at as string).sort();
  const cutoff = dates[Math.floor(dates.length / 2)];
  const time: SchemeResult = {
    id: "time",
    label: "Time split",
    train_n: dated.filter((p) => (p.listed_at as string) < cutoff).length,
    test_n: dated.filter((p) => (p.listed_at as string) >= cutoff).length,
    excluded_n: live.length - dated.length,
    cutoff,
    scores: scoreScheme(
      dated.filter((p) => (p.listed_at as string) < cutoff),
      dated.filter((p) => (p.listed_at as string) >= cutoff),
      snap,
      tuning,
    ),
  };

  const bandLogErr = loo.scores.full.med_abs_log_err;
  return {
    schemes: [loo, random, time],
    band: {
      log_err: bandLogErr,
      factor: round4(Math.pow(10, bandLogErr)),
      source: "loo",
      predictor: "full",
    },
  };
}

// ---- bootstrap rank ranges --------------------------------------------

// Two hundred refits on resampled comps; each row's range is the
// nearest-rank 5th–95th percentile of its 200 ranks (sorted indices
// 9 and 189). One seeded stream, draws in refit order, 128 draws per
// refit — the audit replays the same stream and must match exactly.
export function bootstrapRankRanges(
  protocols: ProtocolRecord[],
  snap: SnapshotFile,
  live: ProtocolRecord[],
  tuning: ModelTuning,
): Map<string, { low: number; high: number }> {
  const rnd = mulberry32(VALIDATION_SEED);
  const ranks = new Map<string, number[]>();
  for (const p of protocols) ranks.set(p.slug, []);
  for (let b = 0; b < BOOTSTRAP_REFITS; b++) {
    const sample: ProtocolRecord[] = [];
    for (let i = 0; i < live.length; i++) {
      sample.push(live[Math.floor(rnd() * live.length)]);
    }
    const fit = fitCurve(sample, tuning);
    const scored = protocols.map((p) => ({
      slug: p.slug,
      implied: predictValue(p, ageOf(p, snap.as_of), fit, tuning).implied,
    }));
    scored.sort(
      (a, b) =>
        b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );
    scored.forEach((s, i) => {
      ranks.get(s.slug)!.push(i + 1);
    });
  }
  const ranges = new Map<string, { low: number; high: number }>();
  for (const [slug, list] of ranks) {
    const sorted = [...list].sort((a, b) => a - b);
    ranges.set(slug, { low: sorted[9], high: sorted[189] });
  }
  return ranges;
}

// ---- farm economics ---------------------------------------------------

export interface FarmEconomics {
  band_low_usd: number;
  expected_usd: number;
  gas_usd: number;
  time_usd: number;
  farm_cost_usd: number;
  net_usd: number;
  tbill_usd: number;
  verdict: Verdict;
}

// Net a farm to dollars at the low end of the band. Every money
// figure is rounded to cents before it is compared, so the verdict
// is a function of the printed numbers, not of hidden precision.
export function farmEconomics(
  implied: number,
  tvl: number,
  ageDays: number,
  bandFactor: number,
): FarmEconomics {
  const hold = holdDays(ageDays);
  const weeks = hold / 7;
  const gas = round2(
    ECONOMICS.wallet_gas_usd +
      gasTier(tvl) +
      ECONOMICS.second_action_gas_usd +
      ECONOMICS.weekly_gas_usd * weeks +
      ECONOMICS.unwind_gas_usd,
  );
  const minutes =
    ECONOMICS.setup_minutes + ECONOMICS.weekly_minutes * weeks + ECONOMICS.unwind_minutes;
  const time = round2((minutes / 60) * ECONOMICS.time_value_usd_per_hour);
  const cost = round2(gas + time);
  const bandLow = round2(implied / bandFactor);
  const expected = round2(bandLow * ECONOMICS.farmer_share);
  const tbill = round2((capitalUsd(tvl) * ECONOMICS.tbill_rate * hold) / 365);
  const net = round2(expected - cost);
  const verdict: Verdict =
    net <= 0 || net < tbill
      ? "skip"
      : net < ECONOMICS.margin_multiple * cost
        ? "thin"
        : "farm";
  return {
    band_low_usd: bandLow,
    expected_usd: expected,
    gas_usd: gas,
    time_usd: time,
    farm_cost_usd: cost,
    net_usd: net,
    tbill_usd: tbill,
    verdict,
  };
}

// ---- one analysis, shared by board and page ---------------------------

export interface Coverage {
  total: number;
  pre_token: number;
  live_comps: number;
  live_categories: number;
  watchlist: number;
  rows: number;
}

export interface Analysis {
  tuning: ModelTuning;
  fit: CurveFit;
  rows: BoardRow[];
  validation: Validation;
  bandFactor: number;
  coverage: Coverage;
  verdictCounts: Record<Verdict, number>;
}

export function analyzeSnapshot(snap: SnapshotFile): Analysis {
  const tuning: ModelTuning = { ...TUNING };
  const live = liveComps(snap);
  const fit = fitCurve(live, tuning);
  const validation = backtestModel(snap, live, tuning);
  const bandFactor = validation.band.factor;
  const wanted = new Set(snap.watchlist);
  const picked = snap.protocols.filter(
    (p) => wanted.has(p.slug) || (isRankable(p) && p.tvl_usd < snap.floor_usd),
  );
  const ranges = bootstrapRankRanges(picked, snap, live, tuning);
  const rows: BoardRow[] = picked.map((p) => {
    const age = ageOf(p, snap.as_of);
    const pred = predictValue(p, age, fit, tuning);
    const econ = farmEconomics(pred.implied, p.tvl_usd, age, bandFactor);
    const range = ranges.get(p.slug)!;
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
      rank_low: range.low,
      rank_high: range.high,
      implied_value_usd: pred.implied,
      curve_base_usd: pred.curveBase,
      category_shift_factor: pred.shiftFactor,
      category_live_n: fit.liveCountFor(p.category),
      category_residual: fit.residualFor(p.category),
      growth_multiplier: pred.growth,
      maturity_multiplier: pred.maturity,
      breadth_multiplier: pred.breadth,
      band_low_usd: econ.band_low_usd,
      expected_usd: econ.expected_usd,
      gas_usd: econ.gas_usd,
      time_usd: econ.time_usd,
      farm_cost_usd: econ.farm_cost_usd,
      net_usd: econ.net_usd,
      tbill_usd: econ.tbill_usd,
      verdict: econ.verdict,
      farm_steps: planFarmSteps(p, age),
      watchlist: wanted.has(p.slug),
    };
  });
  rows.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  const verdictCounts: Record<Verdict, number> = { farm: 0, thin: 0, skip: 0 };
  for (const row of rows) verdictCounts[row.verdict] += 1;
  const liveCategories = new Set(
    live.map((p) => p.category).filter((c) => c !== null),
  ).size;
  return {
    tuning,
    fit,
    rows,
    validation,
    bandFactor,
    coverage: {
      total: snap.protocols.length,
      pre_token: snap.protocols.filter(recordsNoToken).length,
      live_comps: live.length,
      live_categories: liveCategories,
      watchlist: snap.watchlist.length,
      rows: rows.length,
    },
    verdictCounts,
  };
}

// The board the program writes: rows plus the model's own numbers —
// the curve, the blind validation, the economics and the coverage —
// so a reader can check every claim without rerunning anything.
export function boardDocument(analysis: Analysis) {
  return {
    rows: analysis.rows,
    model: {
      ...analysis.tuning,
      slope: analysis.fit.slope,
      intercept: analysis.fit.intercept,
      r2: analysis.fit.r2,
      global_median: analysis.fit.global_median,
      live_n: analysis.fit.n,
    },
    curve: {
      slope: analysis.fit.slope,
      intercept: analysis.fit.intercept,
      r2: analysis.fit.r2,
      n: analysis.fit.n,
      categories: analysis.fit.stats,
    },
    validation: analysis.validation,
    economics: {
      ...ECONOMICS,
      band_factor: analysis.bandFactor,
      band_log_err: analysis.validation.band.log_err,
    },
    coverage: analysis.coverage,
    verdict_counts: analysis.verdictCounts,
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
    if (
      !Number.isInteger(r.rank_low) ||
      !Number.isInteger(r.rank_high) ||
      r.rank_low < 1 ||
      r.rank_high < r.rank_low ||
      r.rank_high > rows.length
    ) {
      return `row ${r.slug} has a bad rank range [${r.rank_low}, ${r.rank_high}]`;
    }
    if (r.verdict !== "farm" && r.verdict !== "thin" && r.verdict !== "skip") {
      return `row ${r.slug} has verdict ${r.verdict}`;
    }
    if (Math.abs(r.net_usd - (r.expected_usd - r.farm_cost_usd)) > 0.011) {
      return `row ${r.slug} net does not match expected minus cost`;
    }
    if (Math.abs(r.farm_cost_usd - (r.gas_usd + r.time_usd)) > 0.011) {
      return `row ${r.slug} cost does not match gas plus time`;
    }
    if (r.band_low_usd > r.implied_value_usd) {
      return `row ${r.slug} band low sits above its implied value`;
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
// the curve and its category shifts, the blind validation, the
// economics constants, the live-token reference set the curve is
// fitted on, and the model's constants for the sandbox.
export function dataScript(analysis: Analysis, snap: SnapshotFile): string {
  const live: LiveReference[] = liveComps(snap).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd as number,
    ratio: round4((p.mcap_usd as number) / p.tvl_usd),
  }));
  live.sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));
  const slim = analysis.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    listed_at: r.listed_at,
    age_days: r.age_days,
    rank: r.rank,
    rank_low: r.rank_low,
    rank_high: r.rank_high,
    implied_value_usd: r.implied_value_usd,
    curve_base_usd: r.curve_base_usd,
    category_shift_factor: r.category_shift_factor,
    category_live_n: r.category_live_n,
    category_residual: r.category_residual,
    growth_multiplier: r.growth_multiplier,
    maturity_multiplier: r.maturity_multiplier,
    breadth_multiplier: r.breadth_multiplier,
    band_low_usd: r.band_low_usd,
    expected_usd: r.expected_usd,
    gas_usd: r.gas_usd,
    time_usd: r.time_usd,
    farm_cost_usd: r.farm_cost_usd,
    net_usd: r.net_usd,
    tbill_usd: r.tbill_usd,
    verdict: r.verdict,
    watchlist: r.watchlist,
  }));
  const payload = {
    meta: {
      as_of: snap.as_of,
      source: snap.source,
      floor_usd: snap.floor_usd,
      rows: analysis.rows.length,
      watchlist: snap.watchlist.length,
      coverage: analysis.coverage,
    },
    model: analysis.tuning,
    curve: {
      slope: analysis.fit.slope,
      intercept: analysis.fit.intercept,
      r2: analysis.fit.r2,
      n: analysis.fit.n,
      global_median: analysis.fit.global_median,
    },
    category_stats: analysis.fit.stats,
    validation: analysis.validation,
    economics: {
      ...ECONOMICS,
      band_factor: analysis.bandFactor,
      band_log_err: analysis.validation.band.log_err,
    },
    verdict_counts: analysis.verdictCounts,
    watchlist: [...snap.watchlist],
    rows: slim,
    live,
  };
  return `const DATA = ${JSON.stringify(payload, null, 2)};\n`;
}
