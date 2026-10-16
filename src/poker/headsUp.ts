import { RANKS, SUITS, parseCards } from './cards';

export type Side = 'h' | 'v';
export const opp = (p: Side): Side => (p === 'h' ? 'v' : 'h');
const m2 = (x: number) => String(+(+x).toFixed(2));
const pad = (n: number) => String(n).padStart(2, '0');
export const psDate = (d: Date) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export interface HUStart {
  id: string; time: number; n: number; names: Record<Side, string>; btn: Side; sb: number; bb: number; stacks: Record<Side, number>;
}
export type HUAct =
  | { t: 'act'; type: 'fold' | 'check' | 'call' | 'raise'; amt?: number; sug?: string }
  | { t: 'board'; cards: string }
  | { t: 'sd'; winner: Side | 'split'; hero: string; opp: string };

export interface HUState {
  stacks: Record<Side, number>; comm: Record<Side, number>; total: Record<Side, number>;
  street: 'pre' | 'flop' | 'turn' | 'river'; toAct: Side; acted: Side[]; lastRaise: number;
  phase: 'act' | 'board' | 'showdown' | 'done'; next: 'flop' | 'turn' | 'river' | null; runout: boolean;
  board: { flop?: string; turn?: string; river?: string }; lines: string[]; log: string[];
  winner: Side | 'split' | null; pot: number; oppCards: string; potNow: number; maxComm: number; holeAt: number;
}

/** Replay recorded actions into a full heads-up hand state plus a PokerStars-style history. */
export function simulate(st: HUStart, acts: readonly HUAct[]): HUState {
  const nm = (p: Side) => st.names[p], btn = st.btn, bbP = opp(btn);
  const S: HUState = {
    stacks: { h: st.stacks.h, v: st.stacks.v }, comm: { h: 0, v: 0 }, total: { h: 0, v: 0 }, street: 'pre', toAct: btn, acted: [],
    lastRaise: st.bb, phase: 'act', next: null, runout: false, board: {}, lines: [], log: [], winner: null, pot: 0, oppCards: '', potNow: 0, maxComm: 0, holeAt: 0,
  };
  const L = S.lines;
  L.push(`PokerStars Hand #${st.id}: Hold'em No Limit (£${m2(st.sb)}/£${m2(st.bb)} GBP) - ${psDate(new Date(st.time))}`);
  L.push(`Table 'Home game' 2-max Seat #${btn === 'h' ? 1 : 2} is the button`);
  L.push(`Seat 1: ${nm('h')} (${m2(st.stacks.h)} in chips)`);
  L.push(`Seat 2: ${nm('v')} (${m2(st.stacks.v)} in chips)`);
  const post = (p: Side, a: number, kind: string) => { const x = Math.min(a, S.stacks[p]); S.comm[p] = x; S.stacks[p] -= x; L.push(`${nm(p)}: posts ${kind} blind ${m2(x)}`); };
  post(btn, st.sb, 'small');
  post(bbP, st.bb, 'big');
  L.push('*** HOLE CARDS ***');
  const holeAt = L.length;
  const mx = () => Math.max(S.comm.h, S.comm.v);
  const potNow = () => S.total.h + S.total.v + S.comm.h + S.comm.v;
  function returnUncalled() {
    if (S.comm.h !== S.comm.v) {
      const big: Side = S.comm.h > S.comm.v ? 'h' : 'v', ex = S.comm[big] - S.comm[opp(big)];
      S.comm[big] -= ex; S.stacks[big] += ex;
      L.push(`Uncalled bet (${m2(ex)}) returned to ${nm(big)}`);
      S.log.push(`${nm(big)} gets ${m2(ex)} back`);
    }
    S.total.h += S.comm.h; S.total.v += S.comm.v; S.comm = { h: 0, v: 0 };
  }
  function closeStreet() {
    returnUncalled(); S.acted = []; S.lastRaise = st.bb;
    const allin = S.stacks.h === 0 || S.stacks.v === 0;
    if (S.street === 'river') { S.phase = 'showdown'; return; }
    S.runout = allin; S.phase = 'board';
    S.next = ({ pre: 'flop', flop: 'turn', turn: 'river' } as const)[S.street];
  }
  function finish(w: Side | 'split') {
    S.pot = S.total.h + S.total.v;
    if (w === 'split') {
      const a = Math.round(S.pot * 50) / 100, b = Math.round((S.pot - a) * 100) / 100;
      S.stacks.h += a; S.stacks.v += b;
      L.push(`${nm('h')} collected ${m2(a)} from pot`); L.push(`${nm('v')} collected ${m2(b)} from pot`);
    } else { S.stacks[w] += S.pot; L.push(`${nm(w)} collected ${m2(S.pot)} from pot`); }
    S.winner = w; S.phase = 'done';
  }
  for (const a of acts) {
    if (a.t === 'act' && S.phase === 'act') {
      const p = S.toAct, o = opp(p), m = mx(), toCall = m - S.comm[p];
      if (a.type === 'fold') { L.push(`${nm(p)}: folds`); S.log.push(`${nm(p)} folds`); returnUncalled(); finish(o); continue; }
      if (a.type === 'check') { L.push(`${nm(p)}: checks`); S.log.push(`${nm(p)} checks`); S.acted.push(p); }
      else if (a.type === 'call') {
        const pay = Math.min(toCall, S.stacks[p]);
        S.comm[p] += pay; S.stacks[p] -= pay;
        const ai = S.stacks[p] === 0;
        L.push(`${nm(p)}: calls ${m2(pay)}${ai ? ' and is all-in' : ''}`); S.log.push(`${nm(p)} calls ${m2(pay)}${ai ? ' (all-in)' : ''}`); S.acted.push(p);
      } else if (a.type === 'raise') {
        const X = Math.min(+a.amt!, S.comm[p] + S.stacks[p]), pay = X - S.comm[p], inc = X - m;
        if (inc > S.lastRaise) S.lastRaise = inc;
        S.comm[p] = X; S.stacks[p] -= pay;
        const ai = S.stacks[p] === 0;
        if (m === 0) { L.push(`${nm(p)}: bets ${m2(pay)}${ai ? ' and is all-in' : ''}`); S.log.push(`${nm(p)} bets ${m2(pay)}${ai ? ' (all-in)' : ''}`); }
        else { L.push(`${nm(p)}: raises ${m2(inc)} to ${m2(X)}${ai ? ' and is all-in' : ''}`); S.log.push(`${nm(p)} raises to ${m2(X)}${ai ? ' (all-in)' : ''}`); }
        S.acted = [p];
      }
      if (S.acted.includes('h') && S.acted.includes('v')) closeStreet();
      else if (S.stacks[o] === 0 && S.comm[o] >= S.comm[p]) closeStreet();
      else S.toAct = o;
      continue;
    }
    if (a.t === 'board' && S.phase === 'board') {
      const c = (a.cards || '').trim() || (S.next === 'flop' ? '?? ?? ??' : '??');
      S.board[S.next!] = c; S.street = S.next!;
      const f = S.board.flop || '?? ?? ??';
      if (S.street === 'flop') L.push(`*** FLOP *** [${f}]`);
      if (S.street === 'turn') L.push(`*** TURN *** [${f}] [${S.board.turn}]`);
      if (S.street === 'river') L.push(`*** RIVER *** [${f} ${S.board.turn}] [${S.board.river}]`);
      S.log.push(S.street[0].toUpperCase() + S.street.slice(1) + ': ' + c);
      if (S.runout) { if (S.street === 'river') S.phase = 'showdown'; else S.next = ({ flop: 'turn', turn: 'river' } as const)[S.street]; }
      else { S.phase = 'act'; S.toAct = bbP; S.acted = []; }
      continue;
    }
    if (a.t === 'sd' && S.phase === 'showdown') {
      L.push('*** SHOW DOWN ***');
      const hc = parseCards(a.hero || '');
      if (hc.cards && hc.cards.length === 2) L.push(`${nm('h')}: shows [${a.hero.trim()}]`);
      if (a.opp) {
        const oc = parseCards(a.opp);
        if (oc.cards && oc.cards.length === 2) { L.push(`${nm('v')}: shows [${a.opp.trim()}]`); S.oppCards = a.opp.trim(); }
      }
      finish(a.winner);
      S.log.push(a.winner === 'split' ? 'Split pot' : `${nm(a.winner)} wins ${m2(S.pot)}`);
    }
  }
  S.potNow = potNow(); S.maxComm = mx(); S.holeAt = holeAt;
  return S;
}

/** The hand as PokerStars-style text, with hero's cards inserted so the tracker can parse it. */
export function liveText(st: HUStart, S: HUState, cards: string): string {
  const L = S.lines.slice();
  const c = parseCards(cards || '');
  if (c.cards && c.cards.length === 2) {
    const t = cards.trim().split(/\s+/).length === 2 ? cards.trim() : `${RANKS[c.cards[0] >> 2]}${SUITS[c.cards[0] & 3]} ${RANKS[c.cards[1] >> 2]}${SUITS[c.cards[1] & 3]}`;
    L.splice(S.holeAt, 0, `Dealt to ${st.names.h} [${t}]`);
  }
  L.push('*** SUMMARY ***');
  return L.join('\n');
}

export function boardCards(S: Pick<HUState, 'board'>): number[] {
  const b = [S.board.flop, S.board.turn, S.board.river].filter(Boolean).join(' ').replace(/\?\?/g, '');
  return parseCards(b).cards || [];
}
