// Token Radar dashboard.
//
// Reads the DATA global that main.ts wrote beside this page and
// renders the board: sortable, filterable, with a detail view per
// protocol and a sandbox that replays the value model live.
//
// The farm plans below use the same wording as lib/model.ts, so the
// steps a reader sees in the detail view are the steps board.json
// carries for that protocol.

const PRE_ROWS = DATA.rows;
const LIVE_ROWS = DATA.live;
const MODEL = DATA.model;
const STATS = DATA.category_stats;
const WATCHLIST = new Set(DATA.watchlist);

const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round4 = (v) => Math.round(v * 10000) / 10000;

// ---- farm plans (same templates as lib/model.ts) --------------------

const FIRST_ACTIONS = {
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
  Options: "Buy {cap} of options cover on {name}",
  "Prediction Market": "Place {cap} on an outcome market run by {name}",
  "NFT Marketplace": "List or buy {cap} of NFTs through {name}",
  Gaming: "Spend {cap} inside {name}'s game economy",
  Social: "Spend {cap} on {name}'s social features",
};

const SECOND_ACTIONS = {
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
  Options: "close a small part of the options cover",
  "Prediction Market": "settle one small prediction and place another",
  "NFT Marketplace": "make one small second trade on the marketplace",
  Gaming: "complete one more in-game action with a small amount",
  Social: "use one more social feature with a small amount",
};

function capitalTier(tvl) {
  if (tvl < 10_000_000) return "$50";
  if (tvl < 50_000_000) return "$100";
  if (tvl < 200_000_000) return "$150";
  return "$250";
}

function farmStepsFor(row) {
  const capital = capitalTier(row.tvl_usd);
  const gas = row.tvl_usd < 50_000_000 ? 4 : 8;
  const hold = row.age_days < 180 ? 30 : row.age_days < 365 ? 45 : 60;
  const chain = row.chains[0] ?? "its home chain";
  const first = (FIRST_ACTIONS[row.category] || "Put {cap} to work in {name}'s main product")
    .replaceAll("{cap}", capital)
    .replaceAll("{name}", row.name);
  const second = SECOND_ACTIONS[row.category] || "use a second feature of the protocol once";
  return [
    `Open a fresh wallet for ${row.name} and keep its seed phrase offline on paper, never in a screenshot or a chat; gas under $3, about 5 minutes.`,
    `${first} on ${chain}; allow about $${gas} in gas and 15 minutes.`,
    `Then ${second}; budget about $2 of gas and 10 minutes.`,
    `Repeat one qualifying action on ${row.name} every week so the position stays active; about $2 of gas and 10 minutes a week.`,
    `Check ${row.name}'s points or rewards page every week and make sure the position shows up in at least two weekly snapshots; free, about 10 minutes a week.`,
    `Leave the position open for at least ${hold} days without withdrawing, so the farm ages past the snapshot window; the ${capital} stays deployed in the meantime.`,
    `Claim only through links that ${row.name} itself publishes; never pay anyone to claim for you, and never sign a claim transaction you did not expect.`,
    `Write every deposit, action and claim for ${row.name} in a farm log, then unwind in stages — claim first, withdraw second; about $3 of gas and 15 minutes.`,
  ];
}

// ---- value model (recomputed live for the sandbox) ------------------

function multipleFor(category, globalMedian, tuning) {
  const stat = STATS.find((s) => s.category === category);
  if (!stat || stat.live_n < tuning.min_category_n) return round4(globalMedian);
  return round4(
    (stat.live_n * stat.median + tuning.shrink_weight * globalMedian) /
      (stat.live_n + tuning.shrink_weight),
  );
}

function impliedOf(row, tuning, globalMedian) {
  const multiple = multipleFor(row.category, globalMedian, tuning);
  const change = row.change_7d === null ? 0 : row.change_7d;
  const growth = 1 + (clamp(change, tuning.growth_low, tuning.growth_high) / 100) * tuning.growth_weight;
  const maturity =
    tuning.maturity_floor +
    (Math.min(row.age_days, tuning.maturity_cap_days) / tuning.maturity_cap_days) *
      (1 - tuning.maturity_floor);
  const breadth = 1 + tuning.breadth_step * Math.min(Math.max(row.chains.length - 1, 0), tuning.breadth_cap);
  return Math.max(1, Math.round(row.tvl_usd * multiple * growth * maturity * breadth));
}

// ---- state and rendering ---------------------------------------------

const state = {
  tab: "pre",
  q: "",
  category: "",
  chain: "",
  minTvl: 0,
  watchOnly: false,
  sortKey: "rank",
  sortDir: 1,
  sandbox: null,
};

function tuningNow() {
  if (!state.sandbox) return MODEL;
  return {
    ...MODEL,
    growth_weight: state.sandbox.growth,
    maturity_floor: state.sandbox.floor,
    breadth_step: state.sandbox.breadth,
    global_median: MODEL.global_median * state.sandbox.scale,
  };
}

function visibleRows() {
  const tuning = tuningNow();
  const globalMedian = tuning.global_median;
  let list = state.tab === "pre" ? [...PRE_ROWS] : [...LIVE_ROWS];
  if (state.tab === "pre" && state.sandbox) {
    list = list.map((r) => ({ ...r, implied_value_usd: impliedOf(r, tuning, globalMedian) }));
    list.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
    list.forEach((r, i) => { r.rank = i + 1; });
  }
  const q = state.q.trim().toLowerCase();
  return list.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    if (state.category && r.category !== state.category) return false;
    if (state.tab === "pre") {
      if (state.chain && !r.chains.includes(state.chain)) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.watchOnly && !r.watchlist) return false;
    }
    return true;
  });
}

function sortRows(list) {
  const key = state.sortKey;
  const dir = state.sortDir;
  const val = (r) => (key === "chains" ? r.chains.length : r[key] ?? "");
  return [...list].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

function pct(change) {
  if (change === null || change === undefined) return "—";
  const sign = change > 0 ? "+" : "";
  const cls = change > 0 ? "pos" : change < 0 ? "neg" : "";
  return `<span class="${cls}">${sign}${change.toFixed(1)}%</span>`;
}

function renderTable() {
  const head = document.querySelector("#board thead tr");
  const body = $("rows");
  const list = sortRows(visibleRows());
  if (state.tab === "pre") {
    head.innerHTML =
      `<th data-sort="rank">#</th><th data-sort="name">Protocol</th><th data-sort="category">Category</th>` +
      `<th data-sort="tvl_usd" class="num">TVL</th><th data-sort="change_7d" class="num">7d</th>` +
      `<th data-sort="age_days" class="num">Age</th><th data-sort="implied_value_usd" class="num">Implied value</th>` +
      `<th data-sort="chains">Chains</th>`;
    body.innerHTML = list
      .map(
        (r) => `<tr data-slug="${esc(r.slug)}"><td class="num">${r.rank}</td>` +
          `<td><strong>${esc(r.name)}</strong>${r.watchlist ? '<span class="badge">watchlist</span>' : ""}<br><span class="mono">${esc(r.slug)}</span></td>` +
          `<td>${esc(r.category ?? "—")}</td><td class="num">${money(r.tvl_usd)}</td>` +
          `<td class="num">${pct(r.change_7d)}</td><td class="num">${r.age_days}d</td>` +
          `<td class="num"><strong>${money(r.implied_value_usd)}</strong></td>` +
          `<td>${r.chains.length} · ${esc(r.chains.slice(0, 2).join(", "))}${r.chains.length > 2 ? "…" : ""}</td></tr>`,
      )
      .join("");
  } else {
    head.innerHTML =
      `<th data-sort="name">Protocol</th><th data-sort="category">Category</th>` +
      `<th data-sort="tvl_usd" class="num">TVL</th><th data-sort="mcap_usd" class="num">Market cap</th>` +
      `<th data-sort="ratio" class="num">Mcap / TVL</th>`;
    body.innerHTML = list
      .map(
        (r) => `<tr><td><strong>${esc(r.name)}</strong><br><span class="mono">${esc(r.slug)}</span></td>` +
          `<td>${esc(r.category ?? "—")}</td><td class="num">${money(r.tvl_usd)}</td>` +
          `<td class="num">${money(r.mcap_usd)}</td><td class="num">${r.ratio.toFixed(4)}</td></tr>`,
      )
      .join("");
  }
  $("rowCount").textContent = `${list.length} of ${state.tab === "pre" ? PRE_ROWS.length : LIVE_ROWS.length} shown`;
  $("empty").hidden = list.length > 0;
  const active = [];
  if (state.q.trim()) active.push(`search "${state.q.trim()}"`);
  if (state.category) active.push(`category ${state.category}`);
  if (state.chain) active.push(`chain ${state.chain}`);
  if (state.minTvl > 0) active.push(`TVL ≥ ${money(state.minTvl)}`);
  if (state.watchOnly) active.push("watchlist only");
  if (state.sandbox) active.push("sandbox tuning on");
  const status = $("filterStatus");
  if (active.length === 0) { status.hidden = true; }
  else {
    status.hidden = false;
    status.textContent = `Filter active: ${active.join(" · ")} — ${list.length} of ${state.tab === "pre" ? PRE_ROWS.length : LIVE_ROWS.length} shown.`;
  }
  body.querySelectorAll("tr[data-slug]").forEach((tr) => {
    tr.addEventListener("click", () => openDetail(tr.dataset.slug));
  });
  head.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = key === "name" || key === "category" ? 1 : -1; }
      renderTable();
    });
  });
}

function renderIntro() {
  $("asOf").textContent = DATA.meta.as_of;
  const values = PRE_ROWS.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const total = values.reduce((s, v) => s + v, 0);
  const median = values[Math.floor(values.length / 2)];
  $("ledeStats").textContent =
    `Total implied value across the board is ${money(total)} (median ${money(median)}); ` +
    `${DATA.meta.watchlist} watchlist protocols, ${PRE_ROWS.length} rows.`;
  $("modelText").textContent =
    `Implied value = TVL × category multiple × growth × maturity × breadth. The category multiple is the ` +
    `median mcap/TVL of live-token protocols in that category (global median ${MODEL.global_median}), pulled ` +
    `toward the global median with weight ${MODEL.shrink_weight} when the category is small. Growth counts ` +
    `half the seven-day TVL change, clamped to ${MODEL.growth_low}%…${MODEL.growth_high}%. Maturity starts at ` +
    `${MODEL.maturity_floor} and rises to 1 over ${MODEL.maturity_cap_days} days. Breadth adds ` +
    `${MODEL.breadth_step} per extra chain, up to ${MODEL.breadth_cap} extra chains.`;
  const ok = PRE_ROWS.filter(
    (r) =>
      Math.round(
        r.tvl_usd * r.category_multiple * r.growth_multiplier * r.maturity_multiplier * r.breadth_multiplier,
      ) === r.implied_value_usd,
  ).length;
  $("reconcile").textContent =
    `Reconciliation: ${ok}/${PRE_ROWS.length} rows recompute exactly from the multipliers shown in their detail view.`;
  const top = [...STATS].sort((a, b) => b.live_n - a.live_n).slice(0, 10);
  $("benchmark").innerHTML =
    `<h3>Where the multiples come from — top categories by live protocols</h3>` +
    `<table class="bench"><thead><tr><th>Category</th><th class="num">Live</th>` +
    `<th class="num">Median mcap/TVL</th><th class="num">Multiple used</th></tr></thead><tbody>` +
    top.map((s) => `<tr><td>${esc(s.category)}</td><td class="num">${s.live_n}</td>` +
      `<td class="num">${s.median.toFixed(4)}</td><td class="num">${s.multiple.toFixed(4)}</td></tr>`).join("") +
    `</tbody></table>`;
}

function fillSelects() {
  const cats = [...new Set(PRE_ROWS.map((r) => r.category).filter(Boolean))].sort();
  $("fCategory").innerHTML = `<option value="">All</option>` + cats.map((c) => `<option>${esc(c)}</option>`).join("");
  const chains = [...new Set(PRE_ROWS.flatMap((r) => r.chains))].sort();
  $("fChain").innerHTML = `<option value="">All</option>` + chains.map((c) => `<option>${esc(c)}</option>`).join("");
}

function openDetail(slug) {
  const row = PRE_ROWS.find((r) => r.slug === slug);
  if (!row) return;
  const pctTop = Math.ceil((row.rank / PRE_ROWS.length) * 100);
  const stat = STATS.find((s) => s.category === row.category);
  const steps = farmStepsFor(row);
  $("detailBody").innerHTML =
    `<h2>${esc(row.name)}</h2><p class="mono">${esc(row.slug)}${row.watchlist ? ' · <span class="badge">watchlist</span>' : ""}</p>` +
    `<div class="equation">implied = ${money(row.tvl_usd)} × ${row.category_multiple} × ${row.growth_multiplier.toFixed(4)} × ${row.maturity_multiplier.toFixed(4)} × ${row.breadth_multiplier.toFixed(2)} = <strong>${money(row.implied_value_usd)}</strong></div>` +
    `<dl class="facts">` +
    `<div><dt>Rank</dt><dd>#${row.rank} of ${PRE_ROWS.length} — top ${pctTop}%</dd></div>` +
    `<div><dt>Category multiple</dt><dd>${row.category_multiple} (median ${row.category_median === null ? "—" : row.category_median} over ${row.category_live_n} live protocols${stat ? `, shrunk toward ${MODEL.global_median}` : ""})</dd></div>` +
    `<div><dt>TVL</dt><dd>${money(row.tvl_usd)}</dd></div>` +
    `<div><dt>7-day change</dt><dd>${row.change_7d === null ? "unreported" : row.change_7d.toFixed(2) + "%"}</dd></div>` +
    `<div><dt>Listed</dt><dd>${row.listed_at ?? "unknown"} (${row.age_days} days old)</dd></div>` +
    `<div><dt>Chains</dt><dd>${esc(row.chains.join(", "))}</dd></div>` +
    `</dl>` +
    `<h3>How to farm it</h3><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` +
    `<p class="note">This protocol records no token on DefiLlama — the board says it records none, never that it has none.</p>`;
  $("detail").showModal();
  $("detail").scrollTop = 0;
  history.replaceState(null, "", `#p=${encodeURIComponent(slug)}`);
}

function applyHash() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("category")) { state.category = hash.get("category"); $("fCategory").value = state.category; }
  if (hash.get("chain")) { state.chain = hash.get("chain"); $("fChain").value = state.chain; }
  if (hash.get("watchlist") === "1") { state.watchOnly = true; $("fWatch").checked = true; }
  if (hash.get("minTvl")) { state.minTvl = Number(hash.get("minTvl")); $("fTvl").value = String(state.minTvl); }
  renderTable();
  if (hash.get("scroll")) document.getElementById(hash.get("scroll"))?.scrollIntoView();
  if (hash.get("p")) openDetail(hash.get("p"));
}

function wireSandbox() {
  const g = $("sbGrowth");
  const f = $("sbFloor");
  const b = $("sbBreadth");
  const s = $("sbScale");
  g.value = MODEL.growth_weight;
  f.value = MODEL.maturity_floor;
  b.value = MODEL.breadth_step;
  s.value = 1;
  const read = () => {
    const growth = Number(g.value);
    const floor = Number(f.value);
    const breadth = Number(b.value);
    const scale = Number(s.value);
    const isDefault =
      growth === MODEL.growth_weight && floor === MODEL.maturity_floor &&
      breadth === MODEL.breadth_step && scale === 1;
    state.sandbox = isDefault
      ? null
      : { growth, floor, breadth, scale };
    $("sbFlag").hidden = isDefault;
    state.sortKey = "rank";
    state.sortDir = 1;
    renderTable();
  };
  for (const el of [g, f, b, s]) el.addEventListener("input", read);
  $("sbReset").addEventListener("click", () => {
    g.value = MODEL.growth_weight;
    f.value = MODEL.maturity_floor;
    b.value = MODEL.breadth_step;
    s.value = 1;
    read();
  });
}

function wireControls() {
  $("q").addEventListener("input", (e) => { state.q = e.target.value; renderTable(); });
  $("fCategory").addEventListener("change", (e) => { state.category = e.target.value; renderTable(); });
  $("fChain").addEventListener("change", (e) => { state.chain = e.target.value; renderTable(); });
  $("fTvl").addEventListener("change", (e) => { state.minTvl = Number(e.target.value); renderTable(); });
  $("fWatch").addEventListener("change", (e) => { state.watchOnly = e.target.checked; renderTable(); });
  const setTab = (tab) => {
    state.tab = tab;
    $("tabPre").setAttribute("aria-selected", String(tab === "pre"));
    $("tabLive").setAttribute("aria-selected", String(tab === "live"));
    state.sortKey = tab === "pre" ? "rank" : "mcap_usd";
    state.sortDir = tab === "pre" ? 1 : -1;
    renderTable();
  };
  $("tabPre").addEventListener("click", () => setTab("pre"));
  $("tabLive").addEventListener("click", () => setTab("live"));
  $("detailClose").addEventListener("click", () => $("detail").close());
  $("detail").addEventListener("close", () => history.replaceState(null, "", location.pathname + location.search));
  window.addEventListener("hashchange", applyHash);
}

fillSelects();
renderIntro();
wireControls();
wireSandbox();
renderTable();
applyHash();
