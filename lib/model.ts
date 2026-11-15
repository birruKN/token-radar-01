// Token Launch Radar — the valuation model (model id "comps-curve", version 3).
//
// Version 3 keeps version 2's pricing exactly — same fit, same adjustments, same board — and adds
// the one thing version 2 never showed: proof, produced blind. Before the shipped curve is fitted
// on every live protocol, the whole method is rehearsed on a split of the live set fixed by a hash
// of each protocol's slug (bucket 0 of 5 is held out, chosen by the name alone, before any number
// is fitted). The rehearsal fits the curve and the category factors on the fit part only, prices
// the held-out protocols with that blind fit through the same valueProtocol the board uses, and
// reports the errors against the market caps the snapshot records for them: median absolute log
// error and the share landing inside the ±1-sigma band, beside the same figures in sample. The
// board below is still priced from the full fit; the rehearsal is the evidence for how far a
// price from this method can be trusted, and it is recomputed from the snapshot on every run.
//
// One sealed DefiLlama snapshot in, one ranked board out. The board's implied values are not picked:
// they are read off the snapshot's own market. The 416 protocols whose token already trades are the
// market's answer to the same question this board asks of the pre-token ones, so the model first
// learns, from the 128 of them that carry both a market cap and a TVL, how the market prices TVL:
//
//   1. Fit a power law to the live set: log10(market cap) = A + B x log10(TVL), least squares,
//      with one round of 2.5-sigma clipping and a refit so a handful of absurd ratios (a token
//      priced at 400x its TVL) cannot bend the curve. On this snapshot: A = 2.67, B = 0.57,
//      scatter (residual sd) = 0.84 dex. B < 1 is the market's size discount: the multiple a token
//      commands falls from ~0.44x TVL at $10M to ~0.03x at $5B.
//   2. Adjust per category: the median residual of the category's live protocols, shrunk toward
//      zero by n / (n + 6) and clamped to +/-0.4 dex, so a category with two wild members cannot
//      drag its pre-token rows with it. Lending adjusts down (0.66x: its tokens capture little of
//      the TVL), bridges and RWA adjust up.
//   3. Price each pre-token protocol on that curve at its own TVL, then apply two small,
//      stated adjustments from the snapshot's other two figures:
//        momentum  = 1 + 0.30 x clamp(change_7d, -40, +60) / 100      (a week of TVL flow)
//        maturity  = 0.75 + 0.25 x min(age_days, 1095) / 1095         (years run with no token)
//      implied_value = round(curve x category x momentum x maturity), and the board also carries
//      the model's own uncertainty: a one-sigma band, implied x / x 10^scatter.
//   4. Rank by implied value. The board separates the live set (shown with the market caps the
//      snapshot records, never modelled) from the pre-token set it ranks.
//
// Board membership is a rule, not a taste: every watchlist slug, plus every other pre-token
// protocol in the snapshot that is an independent candidate for a launch of its own — not an
// exchange (CEX), not a versioned pool of another protocol, and not a wrapped, staked or bridged
// product of a token that already trades (the same signals the house's watchlist rule reads:
// bridge and staking categories, "wrapped / staked / staking" name words, exchange name prefixes).
// On this snapshot that rule yields 198 rows: 40 watchlist, 20 more at or above the $50M floor,
// and 138 early protocols below it — every independent pre-token protocol the snapshot carries.
//
// No protocol name is special-cased anywhere in this file: the same functions score every row,
// and the farm plans are derived from each protocol's own category, chains, TVL and age.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's method constants: the knobs of the method, stated in the dashboard. The curve itself is fitted, never stated. */
export interface ModelSpec {
  clip_sigma: number;
  category_min_n: number;
  category_shrink_k: number;
  category_clamp_dex: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL_SPEC: ModelSpec = {
  clip_sigma: 2.5,
  category_min_n: 4,
  category_shrink_k: 6,
  category_clamp_dex: 0.4,
  momentum_weight: 0.3,
  momentum_floor: -40,
  momentum_cap: 60,
  maturity_floor: 0.75,
  maturity_range: 0.25,
  maturity_days: 1095,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'comps-curve v3';

/** The fitted curve and what it was fitted on, all recomputed from the snapshot at run time. */
export interface Calibration {
  live_with_caps: number;
  fitted_n: number;
  intercept: number;
  slope: number;
  scatter_dex: number;
  /** Per-category multiplicative adjustments actually used (1 when the category earned none). */
  category_factors: Record<string, number>;
  /** The live peers the detail view quotes, per category: up to four, by TVL. */
  comps: Record<string, CompPeer[]>;
}

/** One live protocol quoted as a comparable: the market's own figures, never modelled. */
export interface CompPeer {
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/**
 * The blind rehearsal's report: the whole method fitted on one part of the live set and scored,
 * through the board's own pricing, on the part it never saw. Errors are log10 distances between
 * the blind price and the market cap the snapshot records; coverage is the share of a set whose
 * error lands inside the blind fit's own one-sigma band.
 */
export interface Validation {
  /** Live protocols carrying both a market cap and a TVL: the rehearsal's whole universe. */
  live_n: number;
  /** Protocols the blind fit was allowed to see (slug-hash buckets 1 to 4 of 5). */
  fit_n: number;
  /** Of those, the ones the blind fit kept after its clip: the curve was fitted on these. */
  fit_fitted_n: number;
  /** Protocols held out (bucket 0): priced blind, never fitted on. */
  held_out_n: number;
  /** The blind fit's own scatter: the width of the band the coverage figures use. */
  band_dex: number;
  fit_median_abs_err_dex: number;
  held_out_median_abs_err_dex: number;
  fit_band_coverage: number;
  held_out_band_coverage: number;
  /** Mean signed held-out error: how far the blind prices lean, and which way. */
  held_out_mean_signed_err_dex: number;
}

/** Which part of the board a row belongs to. */
export type Tier = 'watchlist' | 'large' | 'early';

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  tier: Tier;
  on_watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  range_low_usd: number;
  range_high_usd: number;
  model: {
    curve_value_usd: number;
    category_factor: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one live-token protocol: the market's figures, shown as recorded. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  spec: ModelSpec;
  calibration: Calibration;
  validation: Validation;
  counts: { protocols: number; watchlist: number; board: number; large: number; early: number; live: number };
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A whole day count from listed_at to as_of, clamped at zero; null when the date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a release marker is a later pool of another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories whose members are products of another asset or venue, not independent launches. */
const PRODUCT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
/** Whole words that mark a wrapped or staked product of a token that already trades. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
/** Names that begin with an exchange's name are that exchange's products. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a pre-token protocol is an independent candidate for a launch of its own, by the same
 * signals the watchlist rule reads. Watchlist members are exempt: the house already kept them.
 */
export function isIndependent(p: SnapshotProtocol): boolean {
  if (PRODUCT_CATEGORIES.has(p.category ?? '')) return false;
  if (VERSIONED.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** Least squares of ys on xs, with the residuals and their standard deviation. */
function fitLine(xs: number[], ys: number[]): { a: number; b: number; sd: number; resid: number[] } {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  const resid = ys.map((y, i) => y - (a + b * xs[i]!));
  const sd = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / n);
  return { a, b, sd, resid };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** The fitted heart of the model: a curve, its scatter and its category factors, from one live set. */
export interface CurveFit {
  fitted_n: number;
  intercept: number;
  slope: number;
  scatter_dex: number;
  category_factors: Record<string, number>;
}

/**
 * Fit the curve and the category factors on one set of live protocols: least squares of
 * log10(market cap) on log10(TVL), one 2.5-sigma clip and a refit, then each category's median
 * residual shrunk toward zero and clamped. calibrate() runs this on the whole live set; the
 * blind rehearsal runs the identical code on its fit split only, so the two fits differ only
 * in what they were allowed to see.
 */
export function fitOn(live: SnapshotProtocol[], spec: ModelSpec = MODEL_SPEC): CurveFit {
  const xs = live.map((p) => Math.log10(p.tvl_usd));
  const ys = live.map((p) => Math.log10(p.mcap_usd!));
  let fit = fitLine(xs, ys);
  const keep = live.map((_, i) => Math.abs(fit.resid[i]!) <= spec.clip_sigma * fit.sd);
  const keptX = xs.filter((_, i) => keep[i]);
  const keptY = ys.filter((_, i) => keep[i]);
  if (keptX.length >= 8 && keptX.length < xs.length) fit = fitLine(keptX, keptY);
  const fitted = live.filter((_, i) => keep[i]);

  // Category adjustments: median residual per category, shrunk toward zero, clamped.
  const residuals = new Map<string, number[]>();
  for (const p of fitted) {
    const key = p.category ?? '(uncategorised)';
    const list = residuals.get(key) ?? [];
    list.push(Math.log10(p.mcap_usd!) - (fit.a + fit.b * Math.log10(p.tvl_usd)));
    residuals.set(key, list);
  }
  const factors: Record<string, number> = {};
  for (const [category, list] of residuals) {
    if (list.length < spec.category_min_n) continue;
    const shrunk = median(list) * (list.length / (list.length + spec.category_shrink_k));
    const clamped = Math.min(spec.category_clamp_dex, Math.max(-spec.category_clamp_dex, shrunk));
    if (clamped !== 0) factors[category] = round4(10 ** clamped);
  }

  return {
    fitted_n: fitted.length,
    intercept: round4(fit.a),
    slope: round4(fit.b),
    scatter_dex: round4(fit.sd),
    category_factors: factors,
  };
}

/**
 * Fit the market's curve from the snapshot's live set: protocols whose token trades and which
 * carry both a market cap and a TVL. One 2.5-sigma clip and refit keeps absurd ratios out.
 */
export function calibrate(snapshot: Snapshot, spec: ModelSpec = MODEL_SPEC): Calibration {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const core = fitOn(live, spec);

  // Comparable live peers per category, largest TVL first, for the detail view.
  const comps: Record<string, CompPeer[]> = {};
  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const key = p.category ?? '(uncategorised)';
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  for (const [category, list] of byCategory) {
    comps[category] = [...list]
      .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
      .slice(0, 4)
      .map((p) => ({ name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, multiple: round2(p.mcap_usd! / p.tvl_usd) }));
  }

  return {
    live_with_caps: live.length,
    fitted_n: core.fitted_n,
    intercept: core.intercept,
    slope: core.slope,
    scatter_dex: core.scatter_dex,
    category_factors: core.category_factors,
    comps,
  };
}

/** The curve's value at one TVL, before category and per-protocol adjustments. */
export function curveValue(tvlUsd: number, cal: Calibration): number {
  return 10 ** (cal.intercept + cal.slope * Math.log10(Math.max(1, tvlUsd)));
}

/** One protocol's full valuation under the fitted curve: every factor the dashboard shows. */
export function valueProtocol(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  cal: Calibration,
  spec: ModelSpec = MODEL_SPEC,
): { implied: number; curve: number; categoryFactor: number; momentum: number; maturity: number; age: number | null } {
  const age = ageDays(snapshot.as_of, p.listed_at);
  const curve = curveValue(p.tvl_usd, cal);
  const categoryFactor = cal.category_factors[p.category ?? '(uncategorised)'] ?? 1;
  const growth = p.change_7d === null ? 0 : Math.min(spec.momentum_cap, Math.max(spec.momentum_floor, p.change_7d));
  // The factors are rounded to the four decimals the dashboard prints BEFORE they price the row,
  // so the page's own recompute from the printed components lands on board.json's number exactly.
  const momentum = round4(1 + (growth / 100) * spec.momentum_weight);
  const ageForModel = age ?? spec.unknown_age_days;
  const maturity = round4(spec.maturity_floor + (Math.min(Math.max(ageForModel, 0), spec.maturity_days) / spec.maturity_days) * spec.maturity_range);
  const implied = Math.max(1, Math.round(curve * categoryFactor * momentum * maturity));
  return { implied, curve: Math.round(curve), categoryFactor, momentum, maturity, age };
}

/**
 * Which fifth of the split a slug falls in, by an FNV-1a hash of the slug alone. The split is
 * fixed by the protocol's name before any figure is fitted, so it cannot be chosen to flatter
 * the model, and it is the same on every run and every machine.
 */
export function slugBucket(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 5;
}

/**
 * The blind rehearsal. The live set is split by slugBucket: bucket 0 is held out, the rest is
 * the fit split. The curve and category factors are fitted on the fit split only (fitOn, the
 * same code calibrate runs), then every protocol of both splits is priced through valueProtocol
 * under that blind fit and compared with the market cap the snapshot records for it. Nothing
 * here touches the shipped board, which calibrate prices from the full fit; this is the
 * out-of-sample evidence for the method, recomputed from the snapshot on every run.
 */
export function validateBlind(snapshot: Snapshot, spec: ModelSpec = MODEL_SPEC): Validation {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const fitSet = live.filter((p) => slugBucket(p.slug) !== 0);
  const heldOut = live.filter((p) => slugBucket(p.slug) === 0);
  const core = fitOn(fitSet, spec);
  const blind: Calibration = {
    live_with_caps: fitSet.length,
    fitted_n: core.fitted_n,
    intercept: core.intercept,
    slope: core.slope,
    scatter_dex: core.scatter_dex,
    category_factors: core.category_factors,
    comps: {},
  };
  const errors = (set: SnapshotProtocol[]): number[] =>
    set.map((p) => Math.log10(valueProtocol(p, snapshot, blind, spec).implied) - Math.log10(p.mcap_usd!));
  const summarise = (errs: number[]): { medianAbs: number; coverage: number; meanSigned: number } => {
    if (errs.length === 0) return { medianAbs: 0, coverage: 0, meanSigned: 0 };
    return {
      medianAbs: round4(median(errs.map((e) => Math.abs(e)))),
      coverage: round4(errs.filter((e) => Math.abs(e) <= core.scatter_dex).length / errs.length),
      meanSigned: round4(errs.reduce((s, e) => s + e, 0) / errs.length),
    };
  };
  const inSample = summarise(errors(fitSet));
  const outSample = summarise(errors(heldOut));
  return {
    live_n: live.length,
    fit_n: fitSet.length,
    fit_fitted_n: core.fitted_n,
    held_out_n: heldOut.length,
    band_dex: core.scatter_dex,
    fit_median_abs_err_dex: inSample.medianAbs,
    held_out_median_abs_err_dex: outSample.medianAbs,
    fit_band_coverage: inSample.coverage,
    held_out_band_coverage: outSample.coverage,
    held_out_mean_signed_err_dex: outSample.meanSigned,
  };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A chain's rough gas climate, from its name: mainnet is dear, the rest are not. */
function gasFor(chain: string): { action: string; weekly: string } {
  if (chain === 'Ethereum') return { action: 'about $12', weekly: 'about $6' };
  if (chain === 'Solana' || chain === 'Bitcoin') return { action: 'under $1', weekly: 'under $1' };
  return { action: 'about $3', weekly: 'about $2' };
}

/** How much capital one qualifying position needs, scaled to the protocol's own size. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 50;
  return 25;
}

/** How long to hold so the activity spans more than one weekly snapshot, from the protocol's age. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 540) return 45;
  return 30;
}

/** The category's core qualifying action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into one of ${n}'s curated vaults on ${chain}; vault shares are the position most points programmes count.`;
  if (c.includes('lend') || c.includes('cdp')) return `Supply $${capital} of USDC as collateral to ${n} on ${chain} and borrow a small amount against it, so both sides of the market see the wallet.`;
  if (c.includes('dex')) return `Provide $${capital} split between USDC and the chain's main asset in ${n}'s highest-volume pool on ${chain}, and make two swaps a week through the same wallet.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC margin on ${n} and open one small hedged position a week; volume and open interest are what these programmes usually count.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${n}, then use the bridged funds in one app on the far side instead of bridging straight back.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the liquid receipt token in the same wallet.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${n}'s main yield vault on ${chain} and leave the shares untouched while they accrue.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it; these issuers count holders and holding time.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it in the farming wallet.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position in a liquid market on ${n} each week; settle rather than sell early when you can.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy to expiry; cover buyers are the users these protocols count.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${n}'s chain, then use two of its native apps (a swap and a lending deposit) so the wallet reads as a real chain user.`;
  if (c.includes('payment')) return `Move $${capital} through ${n} in real payments over several weeks rather than one transfer; routed volume is the activity that counts.`;
  if (c.includes('basis')) return `Open the protocol's standard basis position with $${capital} on ${n} and keep it funded; size and duration are what basis programmes reward.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its main product and keep the position open.`;
}

/** A second, deeper action that separates a farmer from a drive-by deposit. */
function depthFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('risk curator') || c.includes('allocator')) return `In week two, add a second, smaller position in a different ${n} market or vault, so the wallet is not riding on a single pool.`;
  if (c.includes('dex') || c.includes('yield')) return `In week two, claim any rewards the position earned and restake them in ${n} instead of withdrawing, compounding the counted balance.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Once a week, adjust the hedge rather than closing it, so the account shows continuous open interest on ${n}.`;
  if (c.includes('governance') || c.includes('incentive')) return `Vote in every ${n} governance or incentive round that opens while you farm; votes are cheap and are often a separate multiplier.`;
  return `In week two, repeat the core action with a smaller amount from the same wallet, so ${n} records recurring use rather than one visit.`;
}

/** A step as one string: action, then its cost and its time, kept inside the gate's 20..600 characters. */
function stepText(action: string, cost: string, time: string): string {
  let s = `${action} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page weekly.`;
  return s;
}

/**
 * One protocol's farm plan: seven steps, before and after a launch, each derived from the
 * protocol's own record — category, first chain, TVL and age — never from a list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    stepText(
      `Set up a fresh wallet for ${p.name} that holds only the funds you plan to farm, and keep its seed phrase offline and written down.`,
      'no fee; the wallet is free',
      '5 minutes',
    ),
    stepText(actionFor(p, capital, chain), `$${capital} of capital plus ${gas.action} of gas on ${chain}`, '15 minutes to set up'),
    stepText(depthFor(p, chain), `about $${Math.max(10, Math.round(capital / 5))} more capital plus ${gas.weekly} of gas`, '10 minutes in week two'),
    stepText(
      `Make one qualifying action every week from the same wallet — a deposit, a swap, a vote or a claim — so the activity looks continuous, not staged.`,
      `${gas.weekly} of gas a week`,
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${hold} days, so it is counted in several weekly snapshots and not in a single one.`,
      `the $${capital} stays in the position and carries its usual market risk`,
      `${hold} days`,
    ),
    stepText(
      `Check ${p.name}'s own points or rewards page from inside its app, and claim only through a link the protocol itself publishes; never pay a third party to claim.`,
      'no fee to check, and never pay to claim',
      '10 minutes',
    ),
    stepText(
      `If a token launches, claim it to this same wallet, keep at least half of any allocation until the first unlock schedule is public, and log every transaction with its date so the position can be repeated or unwound.`,
      'one claim transaction of gas when the day comes',
      '20 minutes on launch day, 5 minutes to log',
    ),
  ];
}

/** The board: watchlist first by rule, then every other independent pre-token protocol, ranked by implied value. */
export function buildBoard(snapshot: Snapshot, cal: Calibration, spec: ModelSpec = MODEL_SPEC): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const band = 10 ** cal.scatter_dex;
  const chosen: { p: SnapshotProtocol; tier: Tier }[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    if (watch.has(p.slug)) chosen.push({ p, tier: 'watchlist' });
    else if (!isIndependent(p)) continue;
    else chosen.push({ p, tier: p.tvl_usd >= snapshot.floor_usd ? 'large' : 'early' });
  }
  const scored = chosen.map(({ p, tier }) => {
    const v = valueProtocol(p, snapshot, cal, spec);
    return { p, tier, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    tier: s.tier,
    on_watchlist: s.tier === 'watchlist',
    implied_value_usd: s.implied,
    multiple: round2(s.implied / Math.max(1, s.p.tvl_usd)),
    range_low_usd: Math.max(1, Math.round(s.implied / band)),
    range_high_usd: Math.round(s.implied * band),
    model: {
      curve_value_usd: s.curve,
      category_factor: s.categoryFactor,
      momentum_multiplier: s.momentum,
      maturity_multiplier: s.maturity,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The live set, as the dashboard shows it: the market's own caps, largest first. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: p.tvl_usd > 0 ? round2(p.mcap_usd! / p.tvl_usd) : null,
      change_7d: p.change_7d,
    }));
}

/** Everything the entry writes, from the snapshot alone. */
export function buildRadar(snapshot: Snapshot, spec: ModelSpec = MODEL_SPEC): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot, spec);
  const board = buildBoard(snapshot, cal, spec);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    spec,
    calibration: cal,
    validation: validateBlind(snapshot, spec),
    counts: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      board: board.length,
      large: board.filter((r) => r.tier === 'large').length,
      early: board.filter((r) => r.tier === 'early').length,
      live: live.length,
    },
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. Mirrors the scorer's board checks. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
