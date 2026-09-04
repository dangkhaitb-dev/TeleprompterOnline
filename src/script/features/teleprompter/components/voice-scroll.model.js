/**
 * @fileoverview Teleprompter Voice Scroll Model Layer.
 * Pure functions only. NO DOM, NO IO. Deterministic state transformations.
 */

/* =========================================================================
 * 1. Constants
 * ========================================================================= */

export const MATCH = Object.freeze({
  BUF: 12, LOOK_BACK: 0, LOOK_AHEAD_PAD: 6, REACH_MAX: 30,
  CONTEXT_WORDS: 6, CONTEXT_MIN_WORDS: 2, CONTEXT_NEAR_SPAN: 8,
  RECOVERY_MIN_TOKENS: 4, RECOVERY_MAX_TOKENS: 8,
  RECOVERY_AFTER_MISSES: 1, RECOVERY_ACCEPT: 0.72,
  RECOVERY_MIN_DENSITY: 0.75,
  ACCEPT: 0.30, ACCEPT_STRICT: 0.45, LOCALITY_HALVING: 45,
  TIE_MARGIN: 0.04, FAR_JUMP_MIN_TOKENS: 2, FAR_JUMP_MAX_DIST: 20,
  RECENCY_DECAY: 0.82, INS_FACTOR: 0.6,
  WIN_SHRINK: 0.35, WIN_GROW: 0.6,
  COST_FOLD: 0.15, COST_SCALE: 1.15, COST_VIKEY: 0.08,
  COST_PREFIX_BASE: 0.10, COST_PREFIX_SPAN: 0.30,
  PARTIAL_MIN_CHARS: 4, PARTIAL_PREFIX_COST: 0.1,
  MATCH_MAX_COST: 0.5, MATCH_MAX_COST_LONG: 0.7, MATCH_LONG_LEN: 5,
  LOCAL_MIN_MATCHED: 2, LOCAL_MIN_DENSITY: 0.5,
  RESCUE_MIN_MATCHED: 4, RESCUE_MIN_DENSITY: 0.45,
  DRIFT_MAX: 30, FORCE_AFTER_STALLS: 3, FORCE_MAX_RUN: 8,
  WEAK_LOCAL: 0.55,
});

export const CREEP = Object.freeze({
  MAX_AHEAD: 3, DEFAULT_WPM: 130, MIN_WPM: 60, MAX_WPM: 280,
  RATE: 0.85, SILENCE_MS: 900, STALL_MS: 1200, MAX_AHEAD_STALLED: 10,
});

export const TPCOM_PID = Object.freeze({
  kp: 1.2, ki: 0.05, kd: 0.95,
  deadzone: 0.1, velocitySmoothness: 0.85, integralLeakage: 0.6,
});

// A long pause between speech-recognition results must not be treated as one
// giant animation frame. Without this cap, resuming after a few seconds can
// multiply the next velocity by the whole idle interval and jump several
// paragraphs in a single paint.
const MAX_PID_FRAME_SECONDS = 0.05;

export const MANUAL_SCROLL_THRESHOLD = 10;

export const BIAS = Object.freeze({
  AHEAD: 120, BEHIND: 12, MIN_LEN: 2, MAX_LEN: 6,
  STRIDE: 3, MAX_PHRASES: 48, NEAR: 40,
  // July 2026 Chrome 150 benchmark: boost 6 materially improved English and
  // Korean. Vietnamese degraded at fast speech, while Japanese and Spanish
  // were neutral, so unmeasured languages use the conservative boost 2.
  BOOST_NEAR: 2.0,
  BOOST_NEAR_BY_LANGUAGE: Object.freeze({ en: 6.0, ko: 6.0 }),
  BOOST_FAR: 2.0, REFRESH_EVERY: 16,
});

/* =========================================================================
 * 2. Text Normalization Functions
 * ========================================================================= */

const DIGIT_BASES = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0b66, 0x0be6,
  0x0c66, 0x0ce6, 0x0d66, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x17e0];

function foldDigits(t) {
  let out = '';
  for (const ch of t) {
    const cp = ch.codePointAt(0);
    let mapped = ch;
    for (const base of DIGIT_BASES) {
      if (cp >= base && cp <= base + 9) { mapped = String(cp - base); break; }
    }
    out += mapped;
  }
  return out;
}

const NUM_WORDS = new Map(Object.entries({
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20', thirty: '30', forty: '40',
  fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90',
  hundred: '100', thousand: '1000', million: '1000000',
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6',
  seventh: '7', eighth: '8', ninth: '9', tenth: '10',
  'không': '0', 'một': '1', 'hai': '2', 'ba': '3', 'bốn': '4', 'năm': '5',
  'sáu': '6', 'bảy': '7', 'tám': '8', 'chín': '9', 'mười': '10',
  'trăm': '100', 'nghìn': '1000', 'ngàn': '1000', 'triệu': '1000000',
}));

const FILLERS = new Set(['uh', 'um', 'umm', 'uhm', 'er', 'erm', 'ah', 'hmm', 'mmm',
  'ừ', 'ừm', 'à', 'ờ', 'ợ', 'ê', 'eh', 'えーと', 'あの', '嗯', '那个']);

export function normalize(w) {
  let t = (w || '').normalize('NFKC').toLowerCase();
  t = foldDigits(t);
  t = t.replace(/[\u2018\u2019\u02bc'`]/g, '');
  t = t.replace(/[-\u2010-\u2015_.]/g, '');
  t = t.replace(/[^\p{L}\p{N}]/gu, '');
  if (!t) return '';
  const ord = /^(\d+)(st|nd|rd|th)$/.exec(t);
  if (ord) return ord[1];
  return NUM_WORDS.get(t) || t;
}

export function isFiller(norm, tokenIndex) {
  return FILLERS.has(norm) && !tokenIndex.has(norm);
}

export function foldDiacritics(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd').replace(/ð/g, 'd').replace(/ø/g, 'o')
    .replace(/ł/g, 'l').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe');
}

/* =========================================================================
 * 3. Vietnamese Phonetic Key
 * ========================================================================= */

const VI_TONE_MARKS = /[\u0300\u0301\u0303\u0309\u0323]/g;
const VI_ONSETS = [
  ['ngh', 'ng'], ['gh', 'g'], ['gi', 'z'], ['qu', 'kw'], ['ng', 'ng'],
  ['ph', 'f'], ['th', 'T'], ['kh', 'K'], ['tr', 'c'], ['ch', 'c'], ['nh', 'nh'],
  ['đ', 'd'], ['d', 'z'], ['r', 'z'], ['x', 's'], ['s', 's'],
  ['c', 'k'], ['k', 'k'], ['q', 'k'], ['g', 'g'],
];

export function viKey(norm) {
  let s = norm.normalize('NFD').replace(VI_TONE_MARKS, '').normalize('NFC');
  for (const [on, code] of VI_ONSETS) {
    if (s.startsWith(on)) {
      let rest = s.slice(on.length);
      if (on === 'gi' && !rest) rest = 'i';
      s = code + rest;
      break;
    }
  }
  return s.replace(/y/g, 'i').replace(/nh$/, 'ng').replace(/ch$/, 'c');
}

/* =========================================================================
 * 4. Tokenization
 * ========================================================================= */

let _segmenter = null;
function getSegmenter() {
  if (_segmenter !== null) return _segmenter;
  try {
    _segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
      ? new Intl.Segmenter(undefined, { granularity: 'word' })
      : false;
  } catch { _segmenter = false; }
  return _segmenter;
}

export function segmentParts(text) {
  const seg = getSegmenter();
  if (!seg) {
    return text.split(/(\s+)/).filter((t) => t !== '')
      .map((t) => ({ text: t, isWord: !/^\s+$/.test(t) && !!normalize(t) }));
  }
  const out = [];
  for (const s of seg.segment(text)) {
    out.push({ text: s.segment, isWord: !!s.isWordLike && !!normalize(s.segment) });
  }
  return out;
}

export function tokenizeSpoken(text) {
  return segmentParts(text || '').filter((p) => p.isWord).map((p) => normalize(p.text));
}

/* =========================================================================
 * 5. Index Building
 * ========================================================================= */

export function buildIndices(words) {
  const tokenIndex = new Map();
  const foldIndex = new Map();
  const posIndex = new Map();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    tokenIndex.set(w.norm, true);
    foldIndex.set(w.fold, true);
    if (!posIndex.has(w.norm)) posIndex.set(w.norm, []);
    posIndex.get(w.norm).push(i);
  }
  let junkAnchors = new Set();
  const junkCut = words.length / 100 + 1;
  for (const [tok, poss] of posIndex) if (poss.length > junkCut) junkAnchors.add(tok);
  if (posIndex.size && junkAnchors.size > posIndex.size * 0.4) junkAnchors = new Set();
  return { tokenIndex, foldIndex, posIndex, junkAnchors };
}

/* =========================================================================
 * 6. Substitution Cost
 * ========================================================================= */

function charDistance(a, la, b, lb, cap) {
  if (Math.abs(la - lb) >= cap) return cap;
  let prev = new Array(lb + 1);
  const cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin >= cap) return cap;
    prev = cur.slice();
  }
  return prev[lb];
}

export function subCost(spokenNorm, spokenFold, w, spokenVKey) {
  if (spokenNorm === w.norm) return 0;
  if (spokenVKey !== undefined && spokenVKey === w.vkey) return MATCH.COST_VIKEY;
  if (spokenFold === w.fold) return MATCH.COST_FOLD;
  const a = spokenFold, b = w.fold;
  const la = a.length, lb = b.length;
  const maxLen = Math.max(la, lb);
  if (!maxLen) return 1;
  const short = la <= lb ? a : b, long = la <= lb ? b : a;
  if (long.startsWith(short) &&
      (short.length >= 4 || (long.length - short.length <= 1 && short.length >= 2))) {
    return MATCH.COST_PREFIX_BASE + MATCH.COST_PREFIX_SPAN * (1 - short.length / long.length);
  }
  const cap = Math.ceil(maxLen / MATCH.COST_SCALE) + 1;
  return Math.min(1, (charDistance(a, la, b, lb, cap) / maxLen) * MATCH.COST_SCALE);
}

export function prefixCost(spokenFold, w) {
  if (spokenFold.length < MATCH.PARTIAL_MIN_CHARS) return 1;
  if (w.fold.length > spokenFold.length && w.fold.startsWith(spokenFold)) {
    return MATCH.PARTIAL_PREFIX_COST;
  }
  return 1;
}

/* =========================================================================
 * 7. Core DP Alignment
 * ========================================================================= */

export function recencyWeights(n) {
  const w = new Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) { w[i] = Math.pow(MATCH.RECENCY_DECAY, n - 1 - i); sum += w[i]; }
  return { w, sum };
}

function createMatchCtx(buf, feedTailPartial) {
  return {
    costCache: new Array(buf.length),
    feedTailPartial,
    costCachePartialIdx: feedTailPartial ? buf.length - 1 : -1,
    curBufVKey: buf.map(viKey),
  };
}

function subCostCached(i, buf, bufFold, j, ctx, matchCtx) {
  let row = matchCtx.costCache[i];
  if (row === undefined) { row = new Map(); matchCtx.costCache[i] = row; }
  let v = row.get(j);
  if (v === undefined) {
    v = subCost(buf[i], bufFold[i], ctx.words[j], matchCtx.curBufVKey[i]);
    if (i === matchCtx.costCachePartialIdx) v = Math.min(v, prefixCost(bufFold[i], ctx.words[j]));
    row.set(j, v);
  }
  return v;
}

export function windowDistance(buf, bufFold, wts, start, end, ctx, matchCtx) {
  const n = buf.length, m = end - start + 1;
  let prev = new Array(m + 1);
  const cur = new Array(m + 1);
  const ins0 = wts.w[0] * MATCH.INS_FACTOR;
  prev[0] = 0;
  for (let j = 1; j <= m; j++) prev[j] = prev[j - 1] + ins0;
  for (let i = 1; i <= n; i++) {
    const wi = wts.w[i - 1];
    const ins = wi * MATCH.INS_FACTOR;
    cur[0] = prev[0] + wi;
    for (let j = 1; j <= m; j++) {
      const c = subCostCached(i - 1, buf, bufFold, start + j - 1, ctx, matchCtx);
      cur[j] = Math.min(prev[j] + wi, cur[j - 1] + ins, prev[j - 1] + wi * c);
    }
    prev = cur.slice();
  }
  return prev[m];
}

export function alignLastMatch(buf, bufFold, wts, start, end, ctx, matchCtx) {
  const n = buf.length, m = end - start + 1;
  const D = [];
  const ins0 = wts.w[0] * MATCH.INS_FACTOR;
  D.push(new Array(m + 1));
  D[0][0] = 0;
  for (let j = 1; j <= m; j++) D[0][j] = D[0][j - 1] + ins0;
  for (let i = 1; i <= n; i++) {
    const wi = wts.w[i - 1], ins = wi * MATCH.INS_FACTOR;
    const row = new Array(m + 1);
    row[0] = D[i - 1][0] + wi;
    for (let j = 1; j <= m; j++) {
      const c = subCostCached(i - 1, buf, bufFold, start + j - 1, ctx, matchCtx);
      row[j] = Math.min(D[i - 1][j] + wi, row[j - 1] + ins, D[i - 1][j - 1] + wi * c);
    }
    D.push(row);
  }
  let i = n, j = m;
  const hits = [];
  while (i > 0 && j > 0) {
    const wi = wts.w[i - 1];
    const c = subCostCached(i - 1, buf, bufFold, start + j - 1, ctx, matchCtx);
    if (Math.abs(D[i][j] - (D[i - 1][j - 1] + wi * c)) < 1e-9) {
      const wj = ctx.words[start + j - 1];
      const long = Math.min(bufFold[i - 1].length, wj.fold.length) >= MATCH.MATCH_LONG_LEN;
      const maxCost = long ? MATCH.MATCH_MAX_COST_LONG : MATCH.MATCH_MAX_COST;
      if (c <= maxCost) hits.push({ i: i - 1, j: start + j - 1, long });
      i--; j--;
    } else if (Math.abs(D[i][j] - (D[i - 1][j] + wi)) < 1e-9) {
      i--;
    } else {
      j--;
    }
  }
  if (!hits.length) return null;
  let land = -1;
  for (let k = 0; k < hits.length; k++) {
    const h = hits[k];
    if (h.long) { land = k; break; }
    const older = hits[k + 1], newer = k > 0 ? hits[k - 1] : null;
    if ((older && older.i === h.i - 1 && older.j === h.j - 1)
      || (newer && newer.i === h.i + 1 && newer.j === h.j + 1)) { land = k; break; }
  }
  if (land < 0) land = hits.length - 1;
  return { pos: hits[land].j, ti: hits[land].i, matched: hits.length };
}

export function scoreEnd(buf, bufFold, wts, end, anchor, useLocality, ctx, matchCtx) {
  let best = null;
  const distAhead = Math.abs(end - (anchor + ctx.curDrift));
  const lo = Math.max(1, Math.round(buf.length * (1 - MATCH.WIN_SHRINK)));
  const hi = Math.round(buf.length * (1 + MATCH.WIN_GROW));
  for (let wLen = lo; wLen <= hi; wLen++) {
    const start = end - wLen + 1;
    if (start < 0) continue;
    const dist = windowDistance(buf, bufFold, wts, start, end, ctx, matchCtx);
    const sim = 1 - dist / wts.sum;
    if (sim <= 0) continue;
    const score = useLocality ? sim / (1 + distAhead / MATCH.LOCALITY_HALVING) : sim;
    if (!best || score > best.score) best = { end, score, sim, dist, wLen };
  }
  return best;
}

function contextContinuity(contextTokens, candidate, ctx) {
  if (!contextTokens.length || !candidate) return null;
  const candidateStart = candidate.end - candidate.wLen + 1;
  const length = Math.min(contextTokens.length, candidateStart);
  if (length < MATCH.CONTEXT_MIN_WORDS) return null;
  const spoken = contextTokens.slice(-length);
  const scriptStart = candidateStart - length;
  let score = 0;
  for (let index = 0; index < length; index++) {
    const token = spoken[index];
    const word = ctx.words[scriptStart + index];
    score += 1 - subCost(token, foldDiacritics(token), word, viKey(token));
  }
  return score / length;
}

function pickLocalCandidate(candidates, anchor, ctx) {
  if (!candidates.length) return null;
  const peakSimilarity = candidates.reduce(
    (peak, candidate) => Math.max(peak, candidate.sim),
    -Infinity
  );
  const nearPeak = candidates.filter(
    (candidate) => candidate.sim >= peakSimilarity * (1 - MATCH.TIE_MARGIN)
  );
  const expected = anchor + ctx.curDrift;
  const distanceFromExpected = (candidate) => Math.abs(candidate.end - expected);
  const nearestDistance = nearPeak.reduce(
    (nearest, candidate) => Math.min(nearest, distanceFromExpected(candidate)),
    Infinity
  );
  const nearby = nearPeak.filter(
    (candidate) => distanceFromExpected(candidate)
      <= nearestDistance + MATCH.CONTEXT_NEAR_SPAN
  );
  nearby.sort((left, right) => {
    const leftContext = left.contextScore ?? -1;
    const rightContext = right.contextScore ?? -1;
    if (Math.abs(rightContext - leftContext) > 1e-9) {
      return rightContext - leftContext;
    }
    const distanceDiff = distanceFromExpected(left) - distanceFromExpected(right);
    if (distanceDiff) return distanceDiff;
    return left.end - right.end;
  });
  return nearby[0];
}

export function searchLocal(
  buf,
  bufFold,
  wts,
  lo,
  hi,
  anchor,
  minScore,
  ctx,
  matchCtx,
  contextTokens = []
) {
  const candidates = [];
  const accepted = [];
  for (let end = lo; end <= hi; end++) {
    const distAhead = Math.max(0, end - anchor);
    if (buf.length < MATCH.FAR_JUMP_MIN_TOKENS && distAhead > MATCH.FAR_JUMP_MAX_DIST) continue;
    const cand = scoreEnd(buf, bufFold, wts, end, anchor, true, ctx, matchCtx);
    if (!cand) continue;
    cand.contextScore = contextContinuity(contextTokens, cand, ctx);
    candidates.push(cand);
    if (cand.score <= minScore) continue;
    accepted.push(cand);
  }

  // Level 1 ranks current-chunk similarity. Level 2 first limits candidates to
  // the nearest neighborhood, then uses the immediately preceding words as
  // context. An exact tie chooses the earlier candidate, so repeated text
  // cannot pull the reader toward a distant occurrence.
  return {
    best: pickLocalCandidate(accepted, anchor, ctx),
    bestAny: pickLocalCandidate(candidates, anchor, ctx),
  };
}

function searchForwardRecovery(buf, contextTokens, start, ctx) {
  if (buf.length < MATCH.RECOVERY_MIN_TOKENS || start >= ctx.words.length) {
    return null;
  }
  const bufFold = buf.map(foldDiacritics);
  const wts = recencyWeights(buf.length);
  const matchCtx = createMatchCtx(buf, false);

  // This is deliberately an ordered scan, not a global "best score" search.
  // The first strongly confirmed chunk below the cursor wins, so an identical
  // occurrence farther down can never overtake the nearest valid occurrence.
  for (let end = start; end < ctx.words.length; end++) {
    const candidate = scoreEnd(buf, bufFold, wts, end, ctx.cursor, false, ctx, matchCtx);
    if (!candidate || candidate.sim < MATCH.RECOVERY_ACCEPT) continue;

    const windowStart = Math.max(0, candidate.end - candidate.wLen + 1);
    const trace = alignLastMatch(
      buf,
      bufFold,
      wts,
      windowStart,
      candidate.end,
      ctx,
      matchCtx
    );
    if (!trace || trace.pos < start) continue;
    if (trace.matched < MATCH.RECOVERY_MIN_TOKENS) continue;
    if (trace.matched / buf.length < MATCH.RECOVERY_MIN_DENSITY) continue;

    return {
      ...candidate,
      contextScore: contextContinuity(contextTokens, candidate, ctx),
      end: trace.pos,
      ti: trace.ti,
      matched: trace.matched,
      aligned: true,
      matchLevel: 2,
      sequentialRecovery: true,
      newMissStreak: 0,
    };
  }
  return null;
}

// Chrome may shrink and re-emit an interim, or finalize a segment that repeats
// words already delivered. Those tokens look "fresh" to the stream counter but
// were already matched at the cursor. In repeated text the nearest forward
// occurrence of the same phrase is the next paragraph, so treating a replay as
// a skipped paragraph would leap over everything in between. Drop the leading
// tokens that align with the text ending at the cursor; whatever remains is
// what the reader actually said since the last match.
const REPLAY_END_SLACK = 1;
const REPLAY_MIN_TOKENS = 2;

function dropTokensAlreadyRead(buf, anchor, ctx) {
  if (buf.length < REPLAY_MIN_TOKENS || anchor < 0) return buf;
  let replayed = 0;
  for (let len = buf.length; len >= REPLAY_MIN_TOKENS && !replayed; len--) {
    const prefix = buf.slice(0, len);
    const prefixFold = prefix.map(foldDiacritics);
    const wts = recencyWeights(len);
    const matchCtx = createMatchCtx(prefix, false);
    const needed = Math.max(REPLAY_MIN_TOKENS, Math.ceil(len * MATCH.RECOVERY_MIN_DENSITY));
    for (let end = anchor; end >= Math.max(0, anchor - REPLAY_END_SLACK); end--) {
      const start = Math.max(0, end - len - REPLAY_END_SLACK + 1);
      const trace = alignLastMatch(prefix, prefixFold, wts, start, end, ctx, matchCtx);
      // The newest hit must land exactly on the window end. A short paragraph
      // whose start merely fits inside the window is new reading, not a replay.
      if (trace && trace.matched >= needed && trace.pos === end) {
        replayed = len;
        break;
      }
    }
  }
  return replayed ? buf.slice(replayed) : buf;
}

export function refineSpoken(tokens, ctx) {
  const recent = tokens.slice(-Math.ceil(MATCH.BUF * 1.6));
  const dedup = [];
  for (const t of recent) {
    if (isFiller(t, ctx.tokenIndex)) continue;
    if (t !== dedup[dedup.length - 1]) dedup.push(t);
  }
  return dedup;
}

export function findBestEnd(
  buf,
  reachTokens,
  ctx,
  acceptThresholdVal = MATCH.ACCEPT,
  contextTokens = [],
  recoveryTokens = [],
  recoveryContextTokens = []
) {
  const bufFold = buf.map(foldDiacritics);
  const matchCtx = createMatchCtx(buf, ctx.feedTailPartial || false);
  const wts = recencyWeights(buf.length);
  const anchor = ctx.cursor;
  
  const reach = Math.min(Math.max(ctx.curDrift, 1), Math.max(reachTokens, 1), MATCH.REACH_MAX)
    + MATCH.LOOK_AHEAD_PAD;
  const lo = Math.max(0, anchor - MATCH.LOOK_BACK);
  const hi = Math.min(ctx.words.length - 1, anchor + reach);
  
  const { best: local, bestAny } = searchLocal(
    buf,
    bufFold,
    wts,
    lo,
    hi,
    anchor,
    acceptThresholdVal - 1e-9,
    ctx,
    matchCtx,
    contextTokens
  );

  let localTrace = null;
  if (local) {
    const wStart = Math.max(0, local.end - (local.wLen || buf.length) + 1);
    localTrace = alignLastMatch(buf, bufFold, wts, wStart, local.end, ctx, matchCtx);
  }
  const minLocalMatched = Math.min(MATCH.LOCAL_MIN_MATCHED, ctx.words.length);
  const localConfirmed = !!(localTrace
    && localTrace.pos > anchor
    && localTrace.matched >= minLocalMatched
    && localTrace.matched / (localTrace.ti + 1) >= MATCH.LOCAL_MIN_DENSITY);
  
  if (local && local.score >= MATCH.WEAK_LOCAL && localConfirmed) {
    return {
      ...local,
      end: localTrace.pos,
      ti: localTrace.ti,
      matched: localTrace.matched,
      aligned: true,
      newMissStreak: 0,
    };
  }
  
  if (bestAny) {
    const wStart = Math.max(0, bestAny.end - (bestAny.wLen || buf.length) + 1);
    const trace = alignLastMatch(buf, bufFold, wts, wStart, bestAny.end, ctx, matchCtx);
    if (trace && trace.pos > anchor
      && trace.matched >= MATCH.RESCUE_MIN_MATCHED
      && trace.matched / (trace.ti + 1) >= MATCH.RESCUE_MIN_DENSITY) {
      return { ...bestAny, end: trace.pos, ti: trace.ti, aligned: true, rescued: true, newMissStreak: 0 };
    }
  }
  
  if (local && localConfirmed) {
    return {
      ...local,
      end: localTrace.pos,
      ti: localTrace.ti,
      matched: localTrace.matched,
      aligned: true,
      newMissStreak: 0,
    };
  }

  // If the reader intentionally skips a paragraph, the normal local window
  // cannot see the new phrase. After one failed local update, use only words
  // spoken since the last confirmed match and scan the unread suffix in order.
  // Requiring a dense multi-word match keeps an old cumulative transcript from
  // being treated as permission to jump.
  if ((ctx.missStreak || 0) >= MATCH.RECOVERY_AFTER_MISSES) {
    const recovery = searchForwardRecovery(
      dropTokensAlreadyRead(recoveryTokens, anchor, ctx),
      recoveryContextTokens,
      anchor + 1,
      ctx
    );
    if (recovery) return recovery;
  }
  return { newMissStreak: (ctx.missStreak || 0) + 1 };
}

/**
 * Orchestrates the matching. Pure function returning the new state.
 */
export function feedTranscript(allTokens, reachTokens, tailPartial, ctx) {
  if (!ctx.words || !ctx.words.length) return ctx;
  const refined = refineSpoken(allTokens, ctx);
  if (!refined.length) return ctx;
  const buf = refined.slice(-MATCH.BUF);
  const contextTokens = refined.slice(
    Math.max(0, refined.length - MATCH.BUF - MATCH.CONTEXT_WORDS),
    Math.max(0, refined.length - MATCH.BUF)
  );
  
  const feedTailPartial = !!tailPartial && buf[buf.length - 1] === allTokens[allTokens.length - 1];
  
  const streamLen = allTokens.length;
  let lastMatchStreamLen = ctx.lastMatchStreamLen || 0;
  if (streamLen < (ctx.lastFeedStreamLen || 0)) {
    lastMatchStreamLen -= ((ctx.lastFeedStreamLen || 0) - streamLen);
  }
  const curDrift = Math.max(0, Math.min(streamLen - lastMatchStreamLen, MATCH.DRIFT_MAX));
  const freshStreamTokens = Math.max(0, streamLen - lastMatchStreamLen);
  // slice(-0) would return the whole buffer, turning an old transcript into
  // recovery input. No fresh tokens means no recovery candidates.
  const recoveryCount = Math.min(refined.length, freshStreamTokens, MATCH.RECOVERY_MAX_TOKENS);
  const recoveryTokens = recoveryCount > 0 ? refined.slice(-recoveryCount) : [];
  const recoveryContextEnd = Math.max(0, refined.length - recoveryTokens.length);
  const recoveryContextTokens = refined.slice(
    Math.max(0, recoveryContextEnd - MATCH.CONTEXT_WORDS),
    recoveryContextEnd
  );
  
  const findCtx = {
    ...ctx,
    feedTailPartial,
    curDrift,
  };
  
  const best = findBestEnd(
    buf,
    reachTokens,
    findCtx,
    ctx.acceptThresholdVal || MATCH.ACCEPT,
    contextTokens,
    recoveryTokens,
    recoveryContextTokens
  );
  
  const nextCtx = {
    ...ctx,
    feedTailPartial,
    lastFeedStreamLen: streamLen,
    curDrift,
    missStreak: best && best.newMissStreak !== undefined ? best.newMissStreak : ctx.missStreak,
  };
  
  // Recognition is forward-only and local to the current cursor. Only an
  // explicit user re-anchor is allowed to move backward or jump elsewhere.
  if (best && best.end !== undefined && best.end >= ctx.cursor) {
    nextCtx.cursor = best.end;
    nextCtx.lastMatch = best;
    nextCtx.lastMatchStreamLen = streamLen;
  }
  
  return nextCtx;
}

/* =========================================================================
 * 8. PID Controller
 * ========================================================================= */

export function createPIDController(params = TPCOM_PID) {
  const s = {
    targetValue: 0, currentValue: 0, previousError: 0,
    integralError: 0, currentVelocity: 0, lastTimestamp: null,
  };
  return {
    setTarget(target, snap = false, current = null) {
      const wasSettled = Math.abs(s.targetValue - s.currentValue) < params.deadzone
        && Math.abs(s.currentVelocity) < 5;
      if (snap) {
        s.targetValue = target;
        s.currentValue = current !== null ? current : target;
        s.currentVelocity = 0;
        s.lastTimestamp = null;
        s.integralError = 0;
      } else if (!(current !== null && current > target)) {
        s.targetValue = target;
        if (current !== null) s.currentValue = current;
      }
      // The rAF loop stops while settled. Start a later movement with a fresh
      // clock so time spent waiting for the next spoken phrase cannot become
      // part of the animation delta.
      if (wasSettled) s.lastTimestamp = null;
    },
    tick(now) {
      if (s.lastTimestamp === null) {
        s.lastTimestamp = now;
        s.previousError = 0;
        s.integralError = 0;
        return { position: s.currentValue, settled: false };
      }
      const dt = Math.min((now - s.lastTimestamp) / 1000, MAX_PID_FRAME_SECONDS);
      if (dt <= 0) {
        return { position: s.currentValue, settled: false };
      }
      s.lastTimestamp = now;
      const error = s.targetValue - s.currentValue;
      
      const isSettled = Math.abs(error) < params.deadzone && Math.abs(s.currentVelocity) < 5;
      
      if (isSettled) {
        s.currentValue = s.targetValue;
        s.currentVelocity = 0;
        s.integralError = 0;
        return { position: s.currentValue, settled: true };
      }

      // A new recognition result may move the target to the other side of the
      // current position. Drop the old momentum before accelerating back so
      // the scroll never jolts briefly in the wrong direction.
      if (s.currentVelocity * error < 0) {
        s.currentVelocity = 0;
        s.integralError = 0;
      }
      
      s.integralError *= Math.pow(params.integralLeakage, dt);
      s.integralError += error * dt * 2;
      const output = params.kp * error
        + params.ki * s.integralError
        + params.kd * (-s.currentVelocity);
      // velocitySmoothness is the amount of velocity retained per 60 Hz
      // frame. Convert it to a frame-rate-independent blend. The previous
      // division by dt always produced a blend of 1 at 60 Hz, making the
      // derivative term alternate between a large and a tiny step every
      // frame — the visible "stutter" at auto-scroll startup.
      const velocityBlend = 1 - Math.pow(params.velocitySmoothness, dt * 60);
      s.currentVelocity += (output - s.currentVelocity) * velocityBlend;

      if (s.currentVelocity * error <= 0) {
        s.currentVelocity = 0;
        s.integralError = 0;
        return { position: s.currentValue, settled: false };
      }

      const nextValue = s.currentValue + s.currentVelocity * dt;
      const crossedTarget = (s.targetValue - s.currentValue)
        * (s.targetValue - nextValue) <= 0;
      s.currentValue = crossedTarget ? s.targetValue : nextValue;
      if (crossedTarget) {
        s.currentVelocity = 0;
        s.integralError = 0;
      }
      s.previousError = error;
      
      return { position: s.currentValue, settled: crossedTarget };
    },
    syncTo(pos) {
      s.currentValue = pos;
      s.targetValue = pos;
      s.currentVelocity = 0;
      s.lastTimestamp = null;
      s.integralError = 0;
    },
    current() { return s.currentValue; },
    target() { return s.targetValue; },
    isSettled() {
      const error = s.targetValue - s.currentValue;
      return Math.abs(error) < params.deadzone && Math.abs(s.currentVelocity) < 5;
    },
    reset(pos = 0) {
      s.targetValue = pos;
      s.currentValue = pos;
      s.previousError = 0;
      s.integralError = 0;
      s.currentVelocity = 0;
      s.lastTimestamp = null;
    }
  };
}

/* =========================================================================
 * 9. Language Detection (pure parts)
 * ========================================================================= */

export const LANGS = [
  { code: 'en-US', label: '🇺🇸 English (US)' },
  { code: 'en-GB', label: '🇬🇧 English (UK)' },
  { code: 'vi-VN', label: '🇻🇳 Tiếng Việt' },
  { code: 'ja-JP', label: '🇯🇵 日本語' },
  { code: 'ko-KR', label: '🇰🇷 한국어' },
  { code: 'zh-CN', label: '🇨🇳 中文 (简体)' },
  { code: 'zh-TW', label: '🇹🇼 中文 (繁體)' },
  { code: 'ru-RU', label: '🇷🇺 Русский' },
  { code: 'uk-UA', label: '🇺🇦 Українська' },
  { code: 'bg-BG', label: '🇧🇬 Български' },
  { code: 'sr-RS', label: '🇷🇸 Српски' },
  { code: 'de-DE', label: '🇩🇪 Deutsch' },
  { code: 'fr-FR', label: '🇫🇷 Français' },
  { code: 'es-ES', label: '🇪🇸 Español' },
  { code: 'es-MX', label: '🇲🇽 Español (MX)' },
  { code: 'it-IT', label: '🇮🇹 Italiano' },
  { code: 'pt-BR', label: '🇧🇷 Português (BR)' },
  { code: 'pt-PT', label: '🇵🇹 Português (PT)' },
  { code: 'nl-NL', label: '🇳🇱 Nederlands' },
  { code: 'pl-PL', label: '🇵🇱 Polski' },
  { code: 'sv-SE', label: '🇸🇪 Svenska' },
  { code: 'cs-CZ', label: '🇨🇿 Čeština' },
  { code: 'el-GR', label: '🇬🇷 Ελληνικά' },
  { code: 'tr-TR', label: '🇹🇷 Türkçe' },
  { code: 'ar-SA', label: '🇸🇦 العربية' },
  { code: 'he-IL', label: '🇮🇱 עברית' },
  { code: 'fa-IR', label: '🇮🇷 فارسی' },
  { code: 'hi-IN', label: '🇮🇳 हिन्दी' },
  { code: 'bn-BD', label: '🇧🇩 বাংলা' },
  { code: 'th-TH', label: '🇹🇭 ไทย' },
  { code: 'id-ID', label: '🇮🇩 Bahasa Indonesia' },
  { code: 'ms-MY', label: '🇲🇾 Bahasa Melayu' },
];

export const ISO_TO_LOCALE = {
  en: 'en-US', vi: 'vi-VN', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT',
  pt: 'pt-BR', nl: 'nl-NL', ru: 'ru-RU', uk: 'uk-UA', pl: 'pl-PL', tr: 'tr-TR',
  id: 'id-ID', th: 'th-TH', hi: 'hi-IN', ar: 'ar-SA', ja: 'ja-JP', ko: 'ko-KR',
  zh: 'zh-CN', sv: 'sv-SE', cs: 'cs-CZ', el: 'el-GR', ms: 'ms-MY', bg: 'bg-BG',
  sr: 'sr-RS', he: 'he-IL', iw: 'he-IL', fa: 'fa-IR', bn: 'bn-BD',
};

export const LABEL = {
  en: 'English', vi: 'Tiếng Việt', es: 'Español', fr: 'Français', de: 'Deutsch',
  it: 'Italiano', pt: 'Português', nl: 'Nederlands', ru: 'Русский', uk: 'Українська',
  pl: 'Polski', tr: 'Türkçe', id: 'Bahasa Indonesia', th: 'ไทย', hi: 'हिन्दी',
  ar: 'العربية', ja: '日本語', ko: '한국어', zh: '中文', sv: 'Svenska',
  cs: 'Čeština', el: 'Ελληνικά', ms: 'Bahasa Melayu', bg: 'Български',
  sr: 'Српски', he: 'עברית', iw: 'עברית', fa: 'فارسی', bn: 'বাংলা',
};

export const FUNC = {
  en: ['the','a','an','and','or','but','is','are','was','were','be','been','to','of','in','on','at','for','with','that','this','you','we','they','it','he','she','not','have','has','will','would','can','from','by','as','if','so','your'],
  vi: ['và','của','là','các','được','người','không','này','cho','một','có','trong','những','để','với','đã','thì','ra','khi','cũng','nếu','vì','rằng','tôi','bạn','chúng','đây','đó','nên','hay','mà','ở','đến','về','theo','nhưng','hoặc','sẽ','đang','rất','như'],
  es: ['el','la','los','las','un','una','de','que','y','en','por','con','para','es','no','se','su','lo','como','más','pero','sus','le','ya','este','porque','muy','está'],
  fr: ['le','la','les','un','une','des','et','que','est','pour','dans','pas','vous','ce','je','qui','sur','au','avec','ne','se','plus','par','mais','ou','son','nous','être'],
  de: ['der','die','das','und','ist','zu','den','ein','eine','nicht','mit','sie','ich','auf','für','von','dem','sich','des','im','war','als','auch','es','an','werden','aber','oder'],
  pt: ['o','a','os','as','um','uma','de','que','e','do','da','em','para','com','não','se','no','por','mais','como','mas','ao','dos','pelo','você','muito'],
  it: ['il','lo','la','gli','le','un','una','di','che','e','per','con','non','sono','della','del','in','si','ho','ma','più','come','anche','questo'],
  nl: ['de','het','een','en','van','is','dat','op','te','die','niet','met','voor','zijn','je','ik','maar','ook','als','naar','er','aan','door','wij'],
};

export const FUNC_SET = {};
for (const l in FUNC) FUNC_SET[l] = new Set(FUNC[l]);

export function scriptCounts(t) {
  const c = { latin: 0, cjk: 0, kana: 0, hangul: 0, cyrillic: 0, arabic: 0, thai: 0, deva: 0 };
  for (const ch of t) {
    const x = ch.codePointAt(0);
    if (x >= 0x4e00 && x <= 0x9fff) c.cjk++;
    else if (x >= 0x3040 && x <= 0x30ff) c.kana++;
    else if (x >= 0xac00 && x <= 0xd7af) c.hangul++;
    else if (x >= 0x0400 && x <= 0x04ff) c.cyrillic++;
    else if (x >= 0x0600 && x <= 0x06ff) c.arabic++;
    else if (x >= 0x0e00 && x <= 0x0e7f) c.thai++;
    else if (x >= 0x0900 && x <= 0x097f) c.deva++;
    else if ((x >= 0x41 && x <= 0x5a) || (x >= 0x61 && x <= 0x7a) || (x >= 0xc0 && x <= 0x24f)) c.latin++;
  }
  return c;
}

const VN_LETTER = /[ăâđêôơưĂÂĐÊÔƠƯ]/;
export function vnSignal(word) {
  return VN_LETTER.test(word) || /[̣̉]/.test(word.normalize('NFD'));
}

function mono(iso, confidence) {
  return { iso, locale: ISO_TO_LOCALE[iso] || 'en-US', label: LABEL[iso] || iso, confidence };
}

export function detectLanguage(text) {
  const t = (text || '').slice(0, 8000);
  if (!t.trim()) return mono('en', 0);
  
  const c = scriptCounts(t);
  const total = Object.values(c).reduce((a, b) => a + b, 0) || 1;
  const nonLatin = [
    ['zh', c.cjk], ['ja', c.kana], ['ko', c.hangul], ['ru', c.cyrillic],
    ['ar', c.arabic], ['th', c.thai], ['hi', c.deva],
  ].sort((a, b) => b[1] - a[1]);
  
  if (nonLatin[0][1] / total > 0.15) {
    let iso = nonLatin[0][0];
    if (iso === 'zh' && c.kana > 0) iso = 'ja';
    return mono(iso, 0.95);
  }
  
  const tokens = t.toLowerCase().match(/[\p{L}]+/gu) || [];
  const score = {};
  let tagged = 0;
  for (const w of tokens) {
    if (vnSignal(w)) { score.vi = (score.vi || 0) + 1; tagged++; continue; }
    const hits = [];
    for (const lang in FUNC_SET) if (FUNC_SET[lang].has(w)) hits.push(lang);
    if (!hits.length) continue;
    tagged++;
    const share = 1 / hits.length;
    for (const lang of hits) score[lang] = (score[lang] || 0) + share;
  }
  
  if (tagged < 2) return mono('en', 0.2);
  const [iso, n] = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return mono(iso, Math.min(1, n / tagged));
}
