import { type Card, RANKS, SUITS, SYM, deckWithout, handClass } from './cards';
import { CAT, catOf, evalHand } from './evaluator';
import { equityVs } from './equity';
import { ALL_CLASSES, type Combo, RANKED, classCombos, combosFor, comboStrength, rangePct, topRange } from './handclasses';
import { RANGES, VS_3B, VS_OPEN, behindOf, expandRange, groupOf, heroType, seatList, spotSets } from './ranges';
import { type Rng, defaultRng, pick, shuffle } from './rng';

/* ---------- chart-frequency helpers (how often a strong player takes each action) ---------- */
export const sig = (x: number) => 1 / (1 + Math.exp(-x));

export function smoothIn(set: Set<string>, cls: string): number {
  const i = RANKED.indexOf(cls);
  let w = 0, t = 0;
  for (let d = -3; d <= 3; d++) {
    const j = i + d;
    if (j < 0 || j >= RANKED.length) continue;
    const wt = [0.5, 1, 2, 3, 2, 1, 0.5][d + 3];
    t += wt;
    if (set.has(RANKED[j])) w += wt;
  }
  return w / t;
}

/** Round to 5% steps that add to exactly 100. */
export function roundFreqs(f: Record<string, number>): Record<string, number> {
  const keys = Object.keys(f);
  const r: Record<string, number> = {};
  let tot = 0;
  keys.forEach((k) => { r[k] = Math.round(f[k] * 20) * 5; tot += r[k]; });
  const big = keys.reduce((a, k) => (r[k] > r[a] ? k : a), keys[0]);
  r[big] += 100 - tot;
  return r;
}

export function chartFreqs(r: Set<string>, c: Set<string>, cls: string) {
  const own = (x: Set<string>) => x.has(cls), rc = new Set([...r, ...c]);
  const mR = own(r) ? Math.min(1, Math.max(0.6, smoothIn(r, cls))) : Math.min(0.3, smoothIn(r, cls));
  const mRC = own(rc) ? Math.min(1, Math.max(0.6, smoothIn(rc, cls))) : Math.min(0.3, smoothIn(rc, cls));
  const raise = c.size ? Math.min(mR, mRC) : mRC, call = c.size ? Math.max(0, mRC - raise) : 0;
  return { raise, call, fold: Math.max(0, 1 - raise - call) };
}

export type Verdict = 'good' | 'live' | 'bad';
export function verdict(freqs: Record<string, number>, choice: string): [Verdict, string] {
  const f = freqs[choice] || 0;
  return f >= 50 ? ['good', 'Best play'] : f >= 20 ? ['live', 'Fine, mixed play'] : ['bad', 'Mistake'];
}

export const SPOT_NAME: Record<string, string> = {
  open: 'Folded to you', limpers: 'Behind limpers', vsopen: 'Facing a raise', squeeze: 'Facing a raise + callers', vs3b: 'Facing a 3-bet',
  allin: 'Facing an all-in or big raise', bigpot: 'Big preflop pot', first: 'After the flop: checked to you / first to act',
  'facing bet': 'After the flop: facing a bet', 'facing raise': 'After the flop: facing a raise',
};

const PR_NAMES = ['Sam', 'Priya', 'Tom', 'Aisha', 'Dan', 'Mia', 'Leo', 'Zara', 'Ben', 'Kai', 'Noah', 'Ella'];
const suitedOrPair = (c: string) => c.length === 2 || c[2] === 's';
const fmt = (x: number) => Math.round(x).toLocaleString('en-GB');

/* ---------- game state ---------- */
export interface Player {
  pos: string; name: string; hero: boolean; stack0: number; st: number; tot: number; in: boolean; allin: boolean;
  cards: Card[]; type: 'hero' | 'tight' | 'loose' | 'aggro'; range: Set<string> | null; list: Combo[] | null; acted: string;
}
export type LogEntry = { t: 'v' | 'h2'; txt: string } | { t: 's'; txt: string } | { t: 'h'; fb: Feedback };
export interface Option extends Array<string> { 0: string; 1: string }
export interface Decision { opts: [string, string][]; raiseTo: number | null; toCall: number; ask: string }
export interface Feedback {
  fr: Record<string, number>; why: string; labels: Record<string, string>; eq: number | null; need: number | null; spot: string;
  verdict: string; cls: Verdict; choice: string; label: string; street: string; ask: string; ctx: string; stackBB: number; board: Card[];
}
export interface PracticeRecord {
  id: string; created: string; n: number; pos: string; stackBB: number; cards: string; cls: string; board: string; net: number; chip: number; result: string;
  decisions: Array<{ street: string; spot: string; ask: string; ctx: string; choice: string; label: string; fr: Record<string, number>; labels: Record<string, string>; verdict: string; cls: Verdict; eq: number | null; need: number | null; why: string; board: string }>;
  log: string[];
}

const nm = (c: Card) => RANKS[c >> 2] + SUITS[c & 3];
const nmSym = (c: Card) => RANKS[c >> 2] + SYM[SUITS[c & 3]];

export class PracticeHand {
  id: string; created: string; n: number; seats: string[]; hi: number; chip: number;
  board: Card[] = []; street: 'pre' | 'flop' | 'turn' | 'river' = 'pre';
  cur = 1; minRaise = 1; nRaises = 0; callers = 0; limpers = 0; lastAgg: number | null = null; opener: number | null = null;
  log: LogEntry[] = []; fbs: Feedback[] = []; recent: string[] = []; done = false;
  result: { net: number; txt: string } | null = null; dec: Decision | null = null; queue: number[] = []; shown = false; hadDecision = false;
  players: Player[] = []; deck: Card[] = []; fb: Feedback | null = null; saved = false;
  private rng: Rng;

  constructor(n: number, rng: Rng = defaultRng) {
    this.rng = rng;
    this.n = n;
    this.seats = seatList(n);
    this.hi = (rng() * n) | 0;
    this.id = Date.now() + '' + ((rng() * 1000) | 0);
    this.created = new Date().toISOString();
    this.chip = pick([100, 200, 400, 500, 1000], rng);
  }

  /** Deal a hand where the hero has a decision. Retries a few times for a worthwhile spot. */
  static deal(n: number, rng: Rng = defaultRng): PracticeHand {
    let g!: PracticeHand;
    for (let a = 0; a < 80; a++) { g = new PracticeHand(n, rng); if (g.start()) break; }
    return g;
  }

  private start(): boolean {
    const { n, seats, hi, rng } = this;
    const names = shuffle(PR_NAMES.slice(), rng);
    let deck = shuffle(deckWithout([]), rng);
    let hero: Card[] = [];
    for (let t = 0; t < 6; t++) {
      const c = [deck[2 * t], deck[2 * t + 1]];
      hero = c;
      const r = RANKED.indexOf(handClass(Math.max(...c), Math.min(...c)));
      if (r < 115 || rng() < 0.3) break;
    }
    deck = deck.filter((c) => !hero.includes(c));
    this.players = seats.map((pos, i) => ({
      pos, name: i === hi ? 'You' : names[i], hero: i === hi,
      stack0: i === hi ? pick([20, 25, 30, 40, 50, 60, 80, 100], rng) : pick([15, 20, 25, 30, 40, 50, 60, 80, 100, 120], rng),
      st: 0, tot: 0, in: true, allin: false,
      cards: i === hi ? hero.slice().sort((a, b) => b - a) : [deck.pop()!, deck.pop()!].sort((a, b) => b - a),
      type: i === hi ? 'hero' : pick(['tight', 'loose', 'loose', 'aggro'] as const, rng), range: null, list: null, acted: '',
    }));
    this.deck = deck;
    const sbI = n === 2 ? 0 : n - 2, bbI = n - 1;
    this.postBlind(sbI, 0.5); this.postBlind(bbI, 1);
    this.queue = [...Array(n).keys()];
    this.loop();
    if (this.dec && this.street === 'pre' && this.nRaises === 0 && this.limpers === 0 && rng() < 0.4) return false;
    return this.hadDecision;
  }

  /* ---- helpers ---- */
  get hero(): Player { return this.players[this.hi]; }
  stk(p: Player) { return Math.max(0, +(p.stack0 - p.tot).toFixed(4)); }
  bbf1 = (x: number) => fmt(Math.round(x * this.chip));
  potTotal() { return this.players.reduce((a, p) => a + p.tot, 0); }
  nameOf(p: Player) { return p.hero ? 'You' : `${p.name} (${this.n === 2 && p.pos === 'BTN' ? 'BTN' : p.pos})`; }
  private postBlind(i: number, a: number) { const p = this.players[i], x = Math.min(a, p.stack0); p.st += x; p.tot += x; if (this.stk(p) <= 0) p.allin = true; }
  private preOrder() { return [...Array(this.n).keys()]; }
  private postOrder() { const n = this.n; return n === 2 ? [1, 0] : [n - 2, n - 1].concat([...Array(n - 2).keys()]); }
  private orderAfter(i: number) { const o = this.street === 'pre' ? this.preOrder() : this.postOrder(), k = o.indexOf(i); return o.slice(k + 1).concat(o.slice(0, k)); }
  private logA(p: Player, txt: string, fold = false) {
    if (p.hero) txt = txt.replace(/^(\w+?)s\b/, '$1');
    const line = `${this.nameOf(p)} ${txt}`;
    if (!fold) { this.log.push({ t: p.hero ? 'h2' : 'v', txt: line }); if (!p.hero) this.recent.push(line); }
  }

  /* ---- actions ---- */
  private doFold(i: number) { const p = this.players[i]; p.in = false; p.acted = 'Fold'; this.logA(p, 'folds', true); }
  private doCheck(i: number) { const p = this.players[i]; p.acted = 'Check'; this.logA(p, 'checks'); }
  private doCall(i: number) {
    const p = this.players[i], amt = Math.min(this.cur - p.st, this.stk(p));
    p.st += amt; p.tot += amt;
    if (this.stk(p) <= 1e-9) p.allin = true;
    if (this.street === 'pre') {
      if ((this.nRaises === 0 && p.pos !== (this.n === 2 ? 'BTN' : 'SB')) || (this.nRaises === 0 && this.n > 2)) this.limpers += this.nRaises === 0 ? 1 : 0;
      else this.callers++;
    } else this.callers++;
    p.acted = this.nRaises === 0 && this.street === 'pre' ? 'Limp' : 'Call';
    this.logA(p, `${this.nRaises === 0 && this.street === 'pre' ? 'limps' : 'calls'} ${this.bbf1(amt)}${p.allin ? ' (all-in)' : ''}`);
  }
  private doRaise(i: number, to: number) {
    const p = this.players[i];
    to = Math.min(to, p.st + this.stk(p));
    const add = to - p.st, inc = to - this.cur, wasBet = this.cur === 0;
    p.st = to; p.tot += add;
    if (this.stk(p) <= 1e-9) p.allin = true;
    if (inc > 0) {
      if (inc >= this.minRaise) this.minRaise = inc;
      this.cur = to; this.nRaises++; this.lastAgg = i; this.callers = 0;
      if (this.street === 'pre' && this.nRaises === 1) this.opener = i;
      this.queue = this.orderAfter(i).filter((j) => this.players[j].in && !this.players[j].allin);
    }
    p.acted = wasBet ? 'Bet' : 'Raise';
    this.logA(p, `${wasBet ? 'bets ' : 'raises to '}${this.bbf1(to)}${p.allin ? ' (all-in)' : ''}`);
  }

  /* ---- main loop ---- */
  private loop() {
    let guard = 0;
    while (!this.done && guard++ < 400) {
      const active = this.players.filter((p) => p.in);
      if (active.length === 1) return this.awardAll(active[0]);
      if (!this.queue.length) { this.endStreet(); continue; }
      const i = this.queue[0], p = this.players[i];
      if (!p.in || p.allin) { this.queue.shift(); continue; }
      if (p.hero) { this.dec = this.heroDec(); this.hadDecision = true; return; }
      this.queue.shift();
      this.botAct(i);
    }
  }
  private endStreet() {
    this.players.forEach((p) => { p.st = 0; });
    if (this.street === 'river') return this.showdown();
    const canAct = this.players.filter((p) => p.in && !p.allin);
    this.street = this.street === 'pre' ? 'flop' : this.street === 'flop' ? 'turn' : 'river';
    const k = this.street === 'flop' ? 3 : 1;
    for (let j = 0; j < k; j++) this.board.push(this.deck.pop()!);
    this.log.push({ t: 's', txt: `${this.street[0].toUpperCase()}${this.street.slice(1)}: ${this.board.map(nmSym).join(' ')} · pot ${this.bbf1(this.potTotal())} · ${this.players.filter((p) => p.in).length} players` });
    this.cur = 0; this.minRaise = 1; this.nRaises = 0; this.callers = 0; this.lastAgg = null; this.recent = [];
    this.players.forEach((p) => { if (p.in) p.acted = ''; });
    if (this.street === 'flop') {
      const hero = this.hero;
      this.players.forEach((p) => {
        if (p.in && !p.hero) {
          p.list = combosFor(p.range || null, hero.cards.concat(this.board));
          if (!p.list.some((c) => c[0] === p.cards[0] && c[1] === p.cards[1])) p.list.push([p.cards[0], p.cards[1]]);
        }
      });
    } else this.players.forEach((p) => { if (p.list) p.list = p.list.filter((c) => !this.board.includes(c[0]) && !this.board.includes(c[1])); });
    if (canAct.length <= 1) { while (this.board.length < 5) this.board.push(this.deck.pop()!); return this.showdown(); }
    this.queue = this.postOrder().filter((j) => this.players[j].in && !this.players[j].allin);
  }
  private awardAll(w: Player) {
    const won = this.potTotal();
    this.done = true; this.shown = false;
    this.result = { net: (w.hero ? won : 0) - this.hero.tot, txt: w.hero ? `Everyone folded. You win ${this.bbf1(won)}.` : `${this.nameOf(w)} wins ${this.bbf1(won)} without a showdown.` };
  }
  private showdown() {
    while (this.board.length < 5) this.board.push(this.deck.pop()!);
    this.shown = true; this.done = true;
    const ins = this.players.filter((p) => p.in), vals = new Map(ins.map((p) => [p, evalHand(p.cards.concat(this.board))]));
    const win = new Map(this.players.map((p) => [p, 0]));
    const levels = [...new Set(ins.map((p) => p.tot))].sort((a, b) => a - b);
    let prev = 0;
    levels.forEach((L, li) => {
      let slice = this.players.reduce((a, p) => a + Math.max(0, Math.min(p.tot, L) - Math.min(p.tot, prev)), 0);
      if (li === levels.length - 1) slice += this.players.reduce((a, p) => a + Math.max(0, p.tot - L), 0);
      const el = ins.filter((p) => p.tot >= L), best = Math.max(...el.map((p) => vals.get(p)!)), ws = el.filter((p) => vals.get(p) === best);
      ws.forEach((p) => win.set(p, win.get(p)! + slice / ws.length));
      prev = L;
    });
    const hero = this.hero, hv = vals.get(hero);
    const top = [...win.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]);
    const lines = top.map(([p, w]) => `${p.hero ? 'You win ' : this.nameOf(p) + ' wins '}${this.bbf1(w)} with ${CAT[catOf(vals.get(p)!)].toLowerCase()}`);
    this.result = { net: win.get(hero)! - hero.tot, txt: `Showdown. ${lines.join('; ')}${hv != null && !win.get(hero) ? '. You had ' + CAT[catOf(hv)].toLowerCase() : ''}.` };
  }

  /* ---- bots ---- */
  private openSetFor(p: Player): Set<string> {
    const base = spotSets('open', p.pos, null, this.n);
    if (!base) return new Set();
    if (p.type === 'loose') return topRange(Math.min(0.9, rangePct(base.r) * 1.5));
    if (p.type === 'aggro') return topRange(Math.min(0.9, rangePct(base.r) * 1.25));
    return base.r;
  }
  raiseSize(i: number, kind: 'open' | 'iso' | '3bet' | '4bet' | 'allin'): number {
    const p = this.players[i], ip = !['SB', 'BB'].includes(p.pos) && !(this.n === 2 && p.pos === 'BB'), tot = p.st + this.stk(p);
    let to: number;
    if (kind === 'open') to = (p.pos === 'SB' && this.n > 2 ? 3 : 2.5) + this.limpers;
    else if (kind === 'iso') to = 3 + this.limpers;
    else if (kind === '3bet') to = this.cur * (ip ? 3 : 4) + this.callers * this.cur;
    else if (kind === '4bet') to = tot <= 40 ? tot : this.cur * 2.3;
    else to = tot;
    return to >= 0.4 * tot ? tot : +to.toFixed(2);
  }
  private botAct(i: number) {
    const rng = this.rng;
    const p = this.players[i], cls = handClass(p.cards[0], p.cards[1]), toCall = this.cur - p.st, tot = p.st + this.stk(p);
    if (this.street !== 'pre') return this.botPost(i);
    const big = this.lastAgg != null && (this.players[this.lastAgg].allin || this.cur >= 0.4 * tot);
    if (big && toCall > 0) { const S = topRange(tot <= 15 ? 0.15 : tot <= 30 ? 0.08 : 0.05); if (S.has(cls)) { p.range = S; return this.doCall(i); } return this.doFold(i); }
    if (this.nRaises === 0) {
      const open = this.openSetFor(p), k = behindOf(p.pos, this.n) || 1;
      if (toCall === 0) {
        const iso = RANGES[Math.min(8, k + 2)] || RANGES[8];
        if (this.limpers > 0 && iso.has(cls)) { p.range = iso; return this.doRaise(i, this.raiseSize(i, 'iso')); }
        p.range = new Set(ALL_CLASSES.filter((c) => !iso.has(c)));
        return this.doCheck(i);
      }
      if (this.limpers > 0) {
        const iso = RANGES[Math.min(8, k + 2)] || RANGES[8];
        if (iso.has(cls) || (p.type === 'aggro' && open.has(cls) && rng() < 0.4)) { p.range = iso; return this.doRaise(i, this.raiseSize(i, 'iso')); }
        if (open.has(cls) && (suitedOrPair(cls) || p.type === 'loose')) { p.range = open; return this.doCall(i); }
        return this.doFold(i);
      }
      if (open.has(cls)) { p.range = open; return tot <= 12 ? this.doRaise(i, tot) : this.doRaise(i, this.raiseSize(i, 'open')); }
      if (p.type === 'loose' && topRange(0.55).has(cls) && rng() < 0.65) { p.range = topRange(0.55); return this.doCall(i); }
      if (p.type === 'tight' && !['SB', 'BB'].includes(p.pos) && suitedOrPair(cls) && topRange(0.4).has(cls) && rng() < 0.3) { p.range = topRange(0.4); return this.doCall(i); }
      if (p.pos === 'SB' && this.n > 2 && topRange(0.45).has(cls) && rng() < 0.3) { p.range = topRange(0.45); return this.doCall(i); }
      return this.doFold(i);
    }
    if (this.nRaises === 1) {
      const rp = this.players[this.lastAgg!], g = groupOf(rp.pos, this.n) || 'L';
      const S = (VS_OPEN[g] || {})[heroType(p.pos)] || (VS_OPEN[g] || {}).BB || VS_OPEN.L.IP!;
      let r = S.r;
      const c = new Set(S.c);
      if (p.type === 'aggro') r = new Set([...r, ...topRange(0.1)]);
      if (p.type === 'loose' && rng() < 0.75) topRange(0.35).forEach((x) => { if (!r.has(x)) c.add(x); });
      if (p.type !== 'loose' && p.pos !== 'SB') ALL_CLASSES.forEach((x) => { if ((x.length === 2 || (x[2] === 's' && RANKS.indexOf(x[1]) >= 8)) && !r.has(x) && topRange(0.3).has(x) && rng() < 0.45) c.add(x); });
      if (this.callers > 0) ALL_CLASSES.forEach((x) => { if (x.length === 2 || (x[2] === 's' && Math.abs(RANKS.indexOf(x[0]) - RANKS.indexOf(x[1])) === 1 && RANKS.indexOf(x[1]) >= 3)) if (!r.has(x) && rng() < 0.5) c.add(x); });
      if (p.acted === 'Limp') {
        if (expandRange('QQ+,AKs,AKo').has(cls)) { p.range = expandRange('QQ+,AKs,AKo'); return this.doRaise(i, this.raiseSize(i, '4bet')); }
        if (topRange(0.3).has(cls)) { p.range = topRange(0.3); return this.doCall(i); }
        return this.doFold(i);
      }
      if (r.has(cls)) { p.range = r; return this.doRaise(i, this.raiseSize(i, '3bet')); }
      if (c.has(cls)) { p.range = c; return this.doCall(i); }
      return this.doFold(i);
    }
    if (this.nRaises === 2 && this.opener === i) {
      const g = groupOf(p.pos, this.n) || 'L', V = VS_3B[g] || VS_3B.L;
      if (V.r.has(cls)) { p.range = V.r; return this.doRaise(i, this.raiseSize(i, '4bet')); }
      if (V.c.has(cls) && tot > 30) { p.range = V.c; return this.doCall(i); }
      return this.doFold(i);
    }
    const strong = expandRange(tot <= 25 ? 'TT+,AQs+,AKo' : 'QQ+,AKs,AKo');
    if (expandRange('KK+').has(cls)) { p.range = expandRange('KK+'); return this.doRaise(i, tot); }
    if (strong.has(cls)) { p.range = strong; return this.doCall(i); }
    return this.doFold(i);
  }
  private pctIn(p: Player): number {
    const mine = comboStrength(p.cards, this.board), L = p.list || [];
    let better = 0;
    L.forEach((c) => { if (comboStrength(c, this.board) > mine) better++; });
    return L.length ? better / L.length : 0.5;
  }
  private narrowP(p: Player, mode: 'bet' | 'call' | 'raise' | 'check') {
    if (!p.list) return;
    const sc = p.list.map((c) => [comboStrength(c, this.board), c] as const).sort((a, b) => b[0] - a[0]), N = sc.length;
    const keep = mode === 'bet' ? 0.45 : mode === 'call' ? 0.6 : mode === 'raise' ? 0.2 : 1, drop = mode === 'check' ? 0.15 : 0;
    const L = sc.slice(Math.floor(N * drop), Math.max(6, Math.ceil(N * keep))).map((x) => x[1]);
    if (!L.some((c) => c[0] === p.cards[0] && c[1] === p.cards[1])) L.push([p.cards[0], p.cards[1]]);
    p.list = L;
  }
  private botPost(i: number) {
    const rng = this.rng;
    const p = this.players[i], k = this.players.filter((x) => x.in).length - 1, toCall = this.cur - p.st, pct = this.pctIn(p), pot = this.potTotal();
    if (toCall === 0) {
      if (pct < (k === 1 ? 0.33 : 0.22) || (k === 1 && pct > 0.8 && rng() < 0.25)) { this.narrowP(p, 'bet'); return this.doRaise(i, Math.min(this.stk(p), +(pot * pick([0.5, 0.75], rng)).toFixed(2))); }
      this.narrowP(p, 'check'); return this.doCheck(i);
    }
    const need = toCall / (pot + toCall);
    if (pct < 0.07 && this.stk(p) > toCall * 2.5) { this.narrowP(p, 'raise'); return this.doRaise(i, +(this.cur * 3).toFixed(2)); }
    if (pct < (this.nRaises >= 2 ? 0.2 : 0.55 - need * 0.5 - 0.08 * (k - 1))) { this.narrowP(p, 'call'); return this.doCall(i); }
    return this.doFold(i);
  }

  /* ---- hero's decision ---- */
  private heroDec(): Decision {
    const h = this.hero, toCall = Math.min(this.cur - h.st, this.stk(h)), tot = h.st + this.stk(h), f = this.bbf1;
    let opts: [string, string][], raiseTo: number | null = null, ask: string;
    const rec = this.recent.length ? this.recent.join(', ') + '.' : '';
    if (this.street === 'pre') {
      if (this.nRaises === 0 && toCall > 0) {
        raiseTo = this.raiseSize(this.hi, this.limpers ? 'iso' : 'open');
        opts = [['raise', raiseTo >= tot ? `All-in (${f(tot)})` : 'Raise to ' + f(raiseTo)], ['call', (this.limpers ? 'Limp behind ' : 'Limp ') + f(toCall)], ['fold', 'Fold']];
        ask = (rec || 'Everyone folds to you.') + ' What do you do?';
      } else if (toCall === 0) {
        raiseTo = this.raiseSize(this.hi, 'iso');
        opts = [['raise', 'Raise to ' + f(raiseTo)], ['check', 'Check']];
        ask = (rec || '') + " You're in the big blind.";
      } else {
        raiseTo = this.raiseSize(this.hi, this.nRaises === 1 ? '3bet' : this.nRaises === 2 ? '4bet' : 'allin');
        opts = [['fold', 'Fold'], ['call', 'Call ' + f(toCall) + (toCall >= this.stk(h) ? ' (all-in)' : '')]];
        if (this.stk(h) > toCall && raiseTo > this.cur) opts.push(['raise', raiseTo >= tot ? `All-in (${f(tot)})` : (this.nRaises === 1 ? 'Re-raise to ' : 'Raise to ') + f(raiseTo)]);
        ask = rec + ' What do you do?';
      }
    } else {
      const pot = this.potTotal();
      if (toCall === 0) {
        raiseTo = +Math.min(this.stk(h), pot * 0.66).toFixed(2);
        opts = [['raise', 'Bet ' + f(raiseTo) + (raiseTo >= this.stk(h) ? ' (all-in)' : '')], ['check', 'Check']];
        ask = (rec ? rec + ' ' : "You're first to act. ") + 'Bet or check?';
      } else {
        raiseTo = +Math.min(tot, this.cur * 3).toFixed(2);
        opts = [['fold', 'Fold'], ['call', 'Call ' + f(toCall) + (toCall >= this.stk(h) ? ' (all-in)' : '')]];
        if (this.stk(h) > toCall) opts.push(['raise', raiseTo >= tot ? `All-in (${f(tot)})` : 'Raise to ' + f(raiseTo)]);
        ask = rec + ' What do you do?';
      }
    }
    return { opts, raiseTo, toCall, ask: ask.trim() };
  }
  private oppLists(): Combo[][] {
    const h = this.hero, dead = h.cards.concat(this.board);
    return this.players.filter((p) => p.in && !p.hero).map((p) => this.street === 'pre' ? combosFor(p.range || topRange(0.5), dead) : (p.list || combosFor(null, dead)).filter((c) => !dead.includes(c[0]) && !dead.includes(c[1])));
  }

  /** What a strong player would do here, as percentages, with an explanation. */
  feedback(): Omit<Feedback, 'verdict' | 'cls' | 'choice' | 'label' | 'street' | 'ask' | 'ctx' | 'stackBB' | 'board'> {
    const P = this, h = P.hero, n = P.n, cls = handClass(h.cards[0], h.cards[1]), pos = h.pos, toCall = P.cur - h.st, tot = h.st + P.stk(h), d = P.dec!, f = P.bbf1;
    let spot = '', fr: Record<string, number> = {}, why = '';
    const labels: Record<string, string> = { raise: 'Raise', call: 'Call', fold: 'Fold', check: 'Check' };
    let eq: number | null = null, need: number | null = null;
    const pctR = (x: number) => Math.round(x * 100) + '%';
    const eqBased = (sp: string) => {
      const L = P.oppLists();
      eq = equityVs(h.cards, P.board, L, L.length > 1 ? 1800 : 2500, P.rng);
      need = toCall / (P.potTotal() + toCall);
      const c = sig((eq - need) / 0.04), rs = P.street === 'pre' || P.stk(h) <= toCall ? 0 : sig((eq - 0.7) / 0.05);
      fr = roundFreqs(P.stk(h) > toCall && d.opts.some((o) => o[0] === 'raise') ? { raise: c * rs, call: c * (1 - rs), fold: 1 - c } : { call: c, fold: 1 - c });
      spot = sp;
      why = `You win ${pctR(eq)} against ${L.length > 1 ? `the ${L.length} players still in` : 'their likely hands'} and need ${pctR(need)} to call ${f(toCall)} into ${f(P.potTotal())}.`;
    };
    if (P.street === 'pre') {
      const big = P.lastAgg != null && (P.players[P.lastAgg].allin || P.cur >= 0.4 * tot);
      if (P.nRaises === 0 && P.limpers === 0 && toCall > 0) {
        spot = 'open';
        const S = spotSets('open', pos, null, n), fq = chartFreqs(S ? S.r : new Set(), new Set(), cls);
        fr = roundFreqs({ raise: fq.raise, call: 0, fold: fq.fold });
        labels.call = 'Limp';
        why = `${cls}${S && S.r.has(cls) ? ' is in' : " isn't in"} the ${n === 2 ? 'heads-up button' : pos} opening range (${pctR(rangePct(S ? S.r : new Set()))} of hands).${fr.raise > 0 && fr.fold > 0 ? " It's near the edge, so strong players mix." : ''} Don't limp when it's folded to you.`;
      } else if (P.nRaises === 0) {
        spot = 'limpers';
        const k = behindOf(pos, n) || 1, iso = RANGES[Math.min(8, k + 2)] || RANGES[8], open = spotSets('open', pos, null, n), over = new Set([...(open ? open.r : [])].filter(suitedOrPair));
        if (toCall === 0) { const fq = chartFreqs(iso, new Set(), cls); fr = roundFreqs({ raise: fq.raise, check: 1 - fq.raise }); }
        else fr = roundFreqs(chartFreqs(iso, over, cls));
        labels.call = 'Limp behind';
        why = `${P.limpers} limper${P.limpers > 1 ? 's' : ''}. Raise strong hands to about ${3 + P.limpers} big blinds to punish them${toCall > 0 ? '; small pairs and suited hands can limp behind for a cheap multi-way flop.' : '; otherwise take the free flop.'}`;
      } else if (big && toCall > 0) eqBased('allin');
      else if (P.nRaises === 1 && h.acted !== 'Limp') {
        const rp = P.players[P.lastAgg!], g = groupOf(rp.pos, n) || 'L', S = (VS_OPEN[g] || {})[heroType(pos)] || (VS_OPEN[g] || {}).BB || VS_OPEN.L.IP!;
        const r = S.r;
        let c = S.c;
        spot = P.callers > 0 ? 'squeeze' : 'vsopen';
        if (P.callers > 0) c = new Set([...c].filter((x) => suitedOrPair(x) || (x[0] === 'A' && 'KQJ'.includes(x[1]))));
        let fq = chartFreqs(r, c, cls);
        if (pos === 'SB' && n > 2 && !P.callers) fq = { raise: fq.raise + fq.call, call: 0, fold: fq.fold };
        fr = roundFreqs(fq);
        labels.raise = 'Re-raise';
        why = `Against a ${n === 2 ? 'button' : rp.pos} raise${P.callers ? ` with ${P.callers} caller${P.callers > 1 ? 's' : ''}` : ''}, ${cls}${r.has(cls) ? ' is a re-raise' : c.has(cls) ? ' is a call' : ' is a fold'}.${P.callers ? ' With callers in, re-raise bigger and call only with hands that play well multi-way: pairs, suited hands, strong aces.' : ''}`;
      } else if (P.nRaises === 2 && P.opener === P.hi) {
        const g = groupOf(pos, n) || 'L', V = VS_3B[g] || VS_3B.L;
        fr = roundFreqs(chartFreqs(V.r, P.stk(h) > 30 ? V.c : new Set(), cls));
        labels.raise = '4-bet'; spot = 'vs3b';
        why = `You opened from ${pos} and got re-raised: ${cls}${V.r.has(cls) ? ' is strong enough to 4-bet.' : V.c.has(cls) && P.stk(h) > 30 ? ' is good enough to call.' : ' should fold.'}`;
      } else eqBased('bigpot');
    } else {
      const k = P.players.filter((p) => p.in).length - 1;
      if (toCall === 0) {
        const L = P.oppLists();
        eq = equityVs(h.cards, P.board, L, L.length > 1 ? 1800 : 2500, P.rng);
        const fair = 1 / (k + 1), ip = P.postOrder().filter((j) => P.players[j].in).pop() === P.hi;
        const b = sig((eq - (fair + (ip ? 0.05 : 0.1))) / 0.06);
        fr = roundFreqs({ raise: b, check: 1 - b });
        labels.raise = 'Bet'; spot = 'first';
        why = (eq >= fair + 0.15 ? `You're ahead of the field (${pctR(eq)} with ${k + 1} players), so bet for value.` : eq >= fair ? `About even (${pctR(eq)}). A bet is fine, checking is fine too.` : `You're behind (${pctR(eq)}, a fair share would be ${pctR(fair)}). Mostly check.`) + (k > 1 ? ' With more players, you need a stronger hand to bet.' : '');
      } else eqBased(P.nRaises >= 2 ? 'facing raise' : 'facing bet');
    }
    return { fr, why, labels, eq, need, spot };
  }

  /** The hero acts. Returns the scored feedback for the decision. */
  act(choice: string): Feedback | null {
    if (!this.dec || this.done) return null;
    const d = this.dec, h = this.hero, fb = this.feedback();
    const [cl, verdictText] = verdict(fb.fr, choice);
    const lab = (d.opts.find((o) => o[0] === choice) || ['', choice])[1];
    const ctx = this.log.filter((e) => e.t !== 'h').map((e) => (e as { txt: string }).txt).join(' | ');
    const full: Feedback = { ...fb, verdict: verdictText, cls: cl, choice, label: lab, street: this.street, ask: d.ask, ctx, stackBB: +h.stack0.toFixed(1), board: this.board.slice() };
    this.fb = full;
    this.fbs.push(full);
    this.log.push({ t: 'h', fb: full });
    this.recent = [];
    this.queue.shift();
    this.dec = null;
    if (choice === 'fold') { h.in = false; h.acted = 'Fold'; this.done = true; this.result = { net: -h.tot, txt: 'You folded.' }; return full; }
    if (choice === 'check') this.doCheck(this.hi);
    else if (choice === 'call') this.doCall(this.hi);
    else this.doRaise(this.hi, d.raiseTo!);
    this.loop();
    return full;
  }

  /** A saved record of the finished hand, or null if the hero never had a decision. */
  record(): PracticeRecord | null {
    if (!this.done || !this.result) return null;
    const h = this.hero;
    if (!this.fbs.length) return null;
    return {
      id: this.id, created: this.created, n: this.n, pos: h.pos, stackBB: h.stack0, cards: h.cards.map(nm).join(' '), cls: handClass(h.cards[0], h.cards[1]),
      board: this.board.map(nm).join(' '), net: +this.result.net.toFixed(2), chip: this.chip, result: this.result.txt,
      decisions: this.fbs.map((f) => ({ street: f.street, spot: f.spot, ask: f.ask, ctx: (f.ctx || '').slice(-600), choice: f.choice, label: f.label, fr: f.fr, labels: f.labels, verdict: f.verdict, cls: f.cls, eq: f.eq, need: f.need, why: f.why, board: (f.board || []).map(nm).join(' ') })),
      log: this.log.filter((e) => e.t !== 'h').map((e) => (e as { txt: string }).txt).slice(0, 60),
    };
  }
}

export { classCombos };
