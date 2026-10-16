import { RANKS } from './cards';
import { rangePct } from './handclasses';

/* ---------- range notation ---------- */

/** Expand notation like "66+,A9s+,A5s-A3s,KQo" into a set of hand classes. */
export function expandRange(spec: string): Set<string> {
  const set = new Set<string>();
  const R = '[2-9TJQKA]';
  for (let tok of spec.split(',')) {
    tok = tok.trim();
    let m: RegExpMatchArray | null;
    if ((m = tok.match(new RegExp(`^(${R})\\1\\+$`)))) {
      for (let r = RANKS.indexOf(m[1]); r < 13; r++) set.add(RANKS[r] + RANKS[r]);
    } else if ((m = tok.match(new RegExp(`^(${R})\\1-(${R})\\2$`)))) {
      const x = RANKS.indexOf(m[1]), y = RANKS.indexOf(m[2]);
      for (let r = Math.min(x, y); r <= Math.max(x, y); r++) set.add(RANKS[r] + RANKS[r]);
    } else if ((m = tok.match(new RegExp(`^(${R})\\1$`)))) {
      set.add(tok);
    } else if ((m = tok.match(new RegExp(`^(${R})(${R})([so])\\+$`)))) {
      const hi = RANKS.indexOf(m[1]);
      for (let r = RANKS.indexOf(m[2]); r < hi; r++) set.add(m[1] + RANKS[r] + m[3]);
    } else if ((m = tok.match(new RegExp(`^(${R})(${R})([so])-\\1(${R})\\3$`)))) {
      const a = RANKS.indexOf(m[2]), b = RANKS.indexOf(m[4]);
      for (let r = Math.min(a, b); r <= Math.max(a, b); r++) set.add(m[1] + RANKS[r] + m[3]);
    } else if ((m = tok.match(new RegExp(`^(${R})(${R})([so])$`)))) {
      set.add(tok);
    }
  }
  return set;
}

/* ---------- opening ranges, keyed by players still to act behind you ---------- */

export const RANGE_SPEC: Record<string, string> = {
  8: '66+,A9s+,A5s,KTs+,QTs+,JTs,T9s,AJo+,KQo',
  7: '55+,A8s+,A5s-A4s,KTs+,QTs+,JTs,T9s,ATo+,KQo',
  6: '44+,A7s+,A5s-A3s,K9s+,Q9s+,J9s+,T9s,98s,ATo+,KJo+',
  5: '33+,A2s+,K9s+,Q9s+,J9s+,T9s,98s,87s,ATo+,KJo+,QJo',
  4: '22+,A2s+,K8s+,Q9s+,J9s+,T8s+,98s,87s,76s,A9o+,KTo+,QJo',
  3: '22+,A2s+,K6s+,Q8s+,J8s+,T8s+,97s+,86s+,76s,65s,A8o+,KTo+,QTo+,JTo',
  2: '22+,A2s+,K2s+,Q5s+,J7s+,T7s+,96s+,85s+,75s+,64s+,54s,A2o+,K8o+,Q9o+,J9o+,T9o,98o',
  1: '22+,A2s+,K4s+,Q7s+,J7s+,T7s+,97s+,86s+,75s+,65s,54s,A5o+,K9o+,Q9o+,J9o+,T9o',
  HU: '22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,84s+,74s+,63s+,53s+,43s,A2o+,K2o+,Q2o+,J4o+,T6o+,96o+,86o+,75o+,65o,54o',
};
export const RANGES: Record<string, Set<string>> = {};
for (const k of Object.keys(RANGE_SPEC)) RANGES[k] = expandRange(RANGE_SPEC[k]);

export const SEAT_TIPS: Record<string, string> = {
  UTG: 'Everyone else is still to act, so someone will often have a big hand. Raise only strong hands and fold the rest without a second thought.',
  'UTG+1': 'Still very early. Add the next-best pairs and aces, nothing fancy.',
  'UTG+2': 'Early-middle seat. Small pairs and good suited hands start to become raises.',
  LJ: 'Middle position. All suited aces become raises, plus the best suited connectors.',
  HJ: 'Getting later. Suited connectors down to 76s and more offsuit broadways.',
  CO: 'Only the button and blinds are left. Open wide and try to steal the blinds.',
  BTN: 'The best seat: you act last after the flop in every hand. Raise almost half your hands.',
  SB: "Only the big blind is left, but you'll be out of position after the flop. Raise or fold; don't just complete.",
  BB: "Nobody opens from the big blind. If it's folded to you, you win the blinds. Your job here is defending against raises.",
};

export const SEAT_SIZE: Record<number, string> = {
  8: 'Raise to 2.5 BB.', 7: 'Raise to 2.5 BB.', 6: 'Raise to 2.3–2.5 BB.', 5: 'Raise to 2.2–2.5 BB.',
  4: 'Raise to 2.2 BB.', 3: 'Raise to 2–2.2 BB.', 2: 'Raise to 2–2.2 BB.',
  1: "Raise to about 3 BB, because you'll play the hand out of position.",
};

/* ---------- facing an open raise / 3-bet / all-in ---------- */

export interface Spec { r?: string; c?: string }
export type Group = 'E' | 'M' | 'L' | 'H' | 'S';
export type HeroType = 'IP' | 'SB' | 'BB';

export const VS_OPEN_SPEC: Record<string, Partial<Record<HeroType, Spec>>> = {
  E: {
    IP: { r: 'QQ+,AKs,AKo,A5s', c: '66-JJ,AQs-AJs,KQs,QJs,JTs,T9s,AQo' },
    SB: { r: 'TT+,AQs+,AKo,A5s', c: '' },
    BB: { r: 'QQ+,AKs,AKo', c: '22-JJ,A2s-AQs,KTs+,QTs+,J9s+,T9s,98s,87s,76s,AJo-AQo,KQo' },
  },
  M: {
    IP: { r: 'JJ+,AQs+,AKo,A5s-A4s', c: '22-TT,ATs-AJs,KTs+,QTs+,JTs,T9s,98s,AQo,KQo' },
    SB: { r: 'TT+,AJs+,KQs,AQo+,A5s-A4s', c: '' },
    BB: { r: 'JJ+,AQs+,AKo,A5s', c: '22-TT,A2s-AJs,K8s+,Q9s+,J8s+,T8s+,97s+,86s+,75s+,65s,54s,ATo-AQo,KJo+,QJo' },
  },
  L: {
    IP: { r: 'TT+,AJs+,KQs,AQo+,A5s-A2s,76s,65s', c: '22-99,A9s-ATs,KTs-KJs,QTs+,J9s+,T9s,98s,87s,AJo,KQo' },
    SB: { r: '88+,A9s+,A5s-A2s,KTs+,QTs+,JTs,AJo+,KQo', c: '' },
    BB: { r: 'TT+,AJs+,KQs,AQo+,A5s-A2s', c: '22-99,A6s-ATs,K2s+,Q6s+,J7s+,T7s+,96s+,85s+,75s+,64s+,54s,A2o-AJo,K9o+,Q9o+,J9o+,T9o,98o' },
  },
  H: {
    BB: { r: '88+,A8s+,A5s-A2s,KTs+,QJs,ATo+,KJo+', c: '22-77,A2s-A7s,K2s-K9s,Q2s-QTs,J4s+,T6s+,96s+,85s+,74s+,63s+,53s+,43s,A2o-A9o,K5o-KTo,Q7o+,J8o+,T8o+,98o,87o' },
  },
  S: {
    BB: { r: '99+,ATs+,KJs+,AJo+,KQo,A5s-A2s', c: '22-88,A2s-A9s,K2s-KTs,Q2s+,J5s+,T6s+,96s+,85s+,74s+,64s+,53s+,43s,A2o-ATo,K5o-KJo,Q8o+,J8o+,T8o+,98o,87o' },
  },
};

export const VS_3B_SPEC: Record<Group, Spec> = {
  E: { r: 'QQ+,AKs,AKo', c: '99-JJ,AQs-AJs,KQs' },
  M: { r: 'QQ+,AKs,AKo', c: '88-JJ,ATs-AQs,KJs+,QJs,JTs,AQo' },
  L: { r: 'JJ+,AQs+,AKo,A5s', c: '66-TT,ATs-AJs,KTs+,QJs,JTs,T9s,98s,AJo-AQo,KQo' },
  H: { r: 'TT+,AJs+,AQo+,A5s-A4s,KQs', c: '22-99,A2s-ATs,K8s+,Q9s+,J9s+,T8s+,98s,87s,76s,65s,A8o-AJo,KTo+,QJo' },
  S: { r: 'TT+,AQs+,AKo,A5s-A4s', c: '55-99,A9s-AJs,KTs+,QTs+,JTs,T9s,AJo-AQo,KQo' },
};

export type Bucket = 10 | 15 | 20 | 30;
export const ALLIN_SPEC: Record<Group, Record<Bucket, string>> = {
  E: { 10: '66+,A9s+,ATo+,KQs', 15: '77+,ATs+,AJo+,KQs', 20: '88+,AJs+,AQo+', 30: 'TT+,AQs+,AKo' },
  M: { 10: '55+,A7s+,A9o+,KTs+,KQo', 15: '66+,A9s+,ATo+,KJs+,KQo', 20: '77+,ATs+,AJo+,KQs', 30: '99+,AJs+,AQo+' },
  L: { 10: '33+,A2s+,A5o+,K8s+,KTo+,QTs+,QJo,JTs', 15: '44+,A4s+,A7o+,K9s+,KJo+,QJs', 20: '55+,A7s+,A9o+,KTs+,KQo', 30: '77+,A9s+,ATo+,KQs' },
  S: { 10: '22+,A2s+,A2o+,K2s+,K5o+,Q7s+,Q9o+,J8s+,J9o+,T8s+,98s', 15: '22+,A2s+,A3o+,K6s+,K9o+,Q9s+,QTo+,J9s+,T9s', 20: '33+,A2s+,A7o+,K9s+,KTo+,QTs+,QJo,JTs', 30: '55+,A7s+,A9o+,KTs+,KQo' },
  H: { 10: '22+,A2s+,A2o+,K2s+,K2o+,Q4s+,Q8o+,J6s+,J8o+,T7s+,T8o+,97s+,87s', 15: '22+,A2s+,A2o+,K5s+,K8o+,Q8s+,QTo+,J9s+,JTo,T9s', 20: '22+,A2s+,A3o+,K6s+,K9o+,Q9s+,QTo+,J9s+,T9s', 30: '33+,A2s+,A7o+,K9s+,KTo+,QTs+,QJo,JTs' },
};
export const STACK_BUCKETS: [Bucket, string, number][] = [
  [10, 'Up to 10 BB', 8], [15, '10–15 BB', 12], [20, '15–25 BB', 20], [30, '25 BB +', 35],
];
export const bucketOf = (bb: number): Bucket => (bb <= 10 ? 10 : bb <= 15 ? 15 : bb <= 25 ? 20 : 30);

export const ALLIN: Record<string, Record<number, Set<string>>> = {};
for (const g of Object.keys(ALLIN_SPEC) as Group[]) {
  ALLIN[g] = {};
  for (const b of Object.keys(ALLIN_SPEC[g])) ALLIN[g][+b] = expandRange(ALLIN_SPEC[g][+b as Bucket]);
}

/** Equity needed to call an all-in of `stack` BB. */
export function needEq(stack: number, n: number, isBB: boolean): number {
  const antes = n >= 3 ? 1 : 0;
  const call = isBB ? stack - 1 : stack;
  return call / (stack * 2 + (isBB ? 0.5 : 1.5) + antes);
}

export interface RangeSet { r: Set<string>; c: Set<string>; rs: string; cs: string }
const mk = (o: Spec): RangeSet => {
  const r = expandRange(o.r || ''), c = expandRange(o.c || '');
  r.forEach((x) => c.delete(x));
  return { r, c, rs: o.r || '', cs: o.c || '' };
};
export const VS_OPEN: Record<string, Partial<Record<HeroType, RangeSet>>> = {};
for (const g of Object.keys(VS_OPEN_SPEC)) {
  VS_OPEN[g] = {};
  for (const t of Object.keys(VS_OPEN_SPEC[g]) as HeroType[]) VS_OPEN[g][t] = mk(VS_OPEN_SPEC[g][t]!);
}
export const VS_3B = {} as Record<Group, RangeSet>;
for (const g of Object.keys(VS_3B_SPEC) as Group[]) VS_3B[g] = mk(VS_3B_SPEC[g]);

export const GROUP_NAME: Record<string, string> = {
  H: 'the button (heads-up)', E: 'an early seat', M: 'a middle seat', L: 'a late seat', S: 'the small blind',
};

/* ---------- seats ---------- */

/** Seat names from first to act to big blind, for an n-handed table. */
export function seatList(n: number): string[] {
  if (n === 2) return ['BTN', 'BB'];
  const m = Math.max(0, n - 3);
  const labs = m <= 3 ? ['LJ', 'HJ', 'CO'].slice(3 - m) : Array.from({ length: m - 3 }, (_, i) => (i ? 'UTG+' + i : 'UTG')).concat(['LJ', 'HJ', 'CO']);
  return labs.concat(['BTN', 'SB', 'BB']);
}
/** Players still to act behind `pos` (capped at 8). */
export function behindOf(pos: string, n: number): number | null {
  const l = seatList(n), i = l.indexOf(pos);
  return i < 0 ? null : Math.min(8, n - 1 - i);
}
export function groupOf(pos: string, n: number): Group | null {
  if (n === 2) return pos === 'BTN' ? 'H' : null;
  const k = behindOf(pos, n);
  if (k == null || k === 0) return null;
  return k >= 6 ? 'E' : k >= 4 ? 'M' : k >= 2 ? 'L' : 'S';
}
export const heroType = (pos: string): HeroType => (pos === 'BB' ? 'BB' : pos === 'SB' ? 'SB' : 'IP');
export function validRaisers(pos: string, n: number): string[] {
  const l = seatList(n), i = l.indexOf(pos);
  return l.slice(0, i).filter((p) => p !== 'BB');
}

export type Mode = 'open' | 'vsopen' | 'vs3b' | 'allin';

/** The raise/call ranges for a preflop spot, or null when there is no such spot. */
export function spotSets(mode: Mode, pos: string, raiser: string | null, n: number, bucket: Bucket = 15): RangeSet | null {
  if (mode === 'allin') {
    const g = raiser ? groupOf(raiser, n) : null;
    if (!g || !ALLIN[g]) return null;
    return { r: ALLIN[g][bucket], c: new Set(), rs: ALLIN_SPEC[g][bucket], cs: '' };
  }
  if (mode === 'open') {
    if (n === 2) return pos === 'BTN' ? { r: RANGES.HU, c: new Set(), rs: RANGE_SPEC.HU, cs: '' } : null;
    const k = behindOf(pos, n);
    return k ? { r: RANGES[k], c: new Set(), rs: RANGE_SPEC[k], cs: '' } : null;
  }
  if (mode === 'vsopen') {
    const g = raiser ? groupOf(raiser, n) : null;
    if (!g) return null;
    return (VS_OPEN[g] || {})[heroType(pos)] || null;
  }
  const g = groupOf(pos, n);
  return g ? VS_3B[g] : null;
}

export const MODE_WORDS: Record<Mode, { r: string; c: string; f: string }> = {
  allin: { r: 'Call all-in', c: '', f: 'Fold' },
  open: { r: 'Raise', c: 'Call (limp)', f: 'Fold' },
  vsopen: { r: 'Re-raise (3-bet)', c: 'Call', f: 'Fold' },
  vs3b: { r: '4-bet', c: 'Call', f: 'Fold' },
};

export type Action = 'raise' | 'call' | 'fold';
/** What the chart says to do with a specific hand class. */
export function chartAction(sets: RangeSet, cls: string): Action {
  return sets.r.has(cls) ? 'raise' : sets.c.has(cls) ? 'call' : 'fold';
}

export { rangePct };
