import { RANKS, handClass, parseCards } from './cards';

export const POS_ORDER = ['UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

/** One hand from the hero's point of view, with preflop/postflop stat flags. */
export interface ParsedHand {
  id: string;
  site: 'PS' | 'GG';
  /** T = tournament, C = cash */
  g: 'T' | 'C';
  bb: number;
  t: string;
  pos: string;
  n: number;
  /** hero stack in BB */
  st: number;
  /** hero cards, e.g. "AhKd" */
  c: string;
  /** hand class, e.g. "AKo" */
  h: string;
  vp: number; pf: number; lp: number; tb: number; to: number;
  sf: number; sd: number; ws: number; ab: number; ac: number; ai: number;
  net: number;
  nbb: number;
  /** action summary, e.g. "PF: UTG r2.5, Hero c2.5 | F [Qh 7c 2d]: ..." */
  sum: string;
  /** set on hands that come from a home-game / live recorder */
  home?: number;
  lite?: undefined;
}

const numv = (s: string) => parseFloat(String(s).replace(/[$€£,]/g, ''));
const AMT = '([$€£]?[\\d.,]+)';
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Split a hand history file (PokerStars or GGPoker) into parsed hands. Unreadable hands are skipped. */
export function parseHandFile(text: string): ParsedHand[] {
  text = text.replace(/^﻿/, '').replace(/\r/g, '');
  return text
    .split(/\n(?=PokerStars |Poker Hand #)/)
    .map((p) => {
      try { return parseHand(p); } catch { return null; }
    })
    .filter((h): h is ParsedHand => !!h);
}

export function parseHand(block: string): ParsedHand | null {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const head = lines[0];
  const idm = head.match(/Hand #([A-Z]{0,3}\d+)/);
  const gg = /^Poker Hand #/.test(head);
  if (!idm || !/Hold'em/.test(head)) return null;
  const tour = /Tournament #/.test(head) || /Hand #TM/.test(head);
  const bm = head.match(/\(([$€£]?[\d.,]+)\/([$€£]?[\d.,]+)/);
  if (!bm) return null;
  const bb = numv(bm[2]);
  if (!(bb > 0)) return null;
  const dm = head.match(/(\d{4}\/\d{2}\/\d{2}) (\d{1,2}:\d{2}:\d{2})/);
  const btnm = (lines[1] || '').match(/Seat #(\d+) is the button/);
  const btnSeat = btnm ? +btnm[1] : 0;

  const seats: { seat: number; name: string; chips: number }[] = [];
  for (const l of lines) {
    if (l.startsWith('*** HOLE CARDS')) break;
    const m = l.match(/^Seat (\d+): (.+) \(([$€£]?[\d.,]+) in chips/);
    if (m && !/sitting out/.test(l)) seats.push({ seat: +m[1], name: m[2], chips: numv(m[3]) });
  }
  let hero: string | null = null;
  let hc: [string, string] | null = null;
  for (const l of lines) {
    const m = l.match(/^Dealt to (.+?) \[(\S\S) (\S\S)\]/);
    if (m) { hero = m[1]; hc = [m[2], m[3]]; break; }
  }
  if (!hero || !hc || !seats.length) return null;
  const heroSeat = seats.find((s) => s.name === hero);
  if (!heroSeat) return null;
  const cids = hc.map((c) => { const p = parseCards(c); return p.cards ? p.cards[0] : null; });
  if (cids.some((x) => x == null)) return null;

  const names = seats.map((s) => s.name).sort((a, b) => b.length - a.length);
  const who = (l: string) => names.find((n) => l.startsWith(n + ': ')) || null;
  let sb: string | null = null, bbN: string | null = null;
  for (const l of lines) {
    const n = who(l);
    if (!n) continue;
    const r = l.slice(n.length + 2);
    if (r.startsWith('posts small blind') && !sb) sb = n;
    else if (r.startsWith('posts big blind') && !bbN) bbN = n;
    if (l.startsWith('*** HOLE')) break;
  }
  const sorted = seats.slice().sort((a, b) => a.seat - b.seat);
  const order = sorted.filter((s) => s.seat > btnSeat).concat(sorted.filter((s) => s.seat <= btnSeat));
  const pos: Record<string, string> = {};
  order.forEach((s) => {
    if (s.name === sb) pos[s.name] = 'SB';
    else if (s.name === bbN) pos[s.name] = 'BB';
    else if (s.seat === btnSeat) pos[s.name] = 'BTN';
  });
  const rest = order.filter((s) => !pos[s.name]);
  const m = rest.length;
  const labs = m <= 3 ? ['LJ', 'HJ', 'CO'].slice(3 - m) : Array.from({ length: m - 3 }, (_, i) => (i ? 'UTG+' + i : 'UTG')).concat(['LJ', 'HJ', 'CO']);
  rest.forEach((s, i) => (pos[s.name] = labs[i] || 'EP'));

  const bbf = (x: number) => +(x / bb).toFixed(1);
  const r: ParsedHand = {
    id: idm[1], site: gg ? 'GG' : 'PS', g: tour ? 'T' : 'C', bb, t: dm ? dm[1] + ' ' + dm[2] : '',
    pos: pos[hero] || '?', n: seats.length, st: bbf(heroSeat.chips), c: hc.join(''),
    h: handClass(cids[0]!, cids[1]!),
    vp: 0, pf: 0, lp: 0, tb: 0, to: 0, sf: 0, sd: 0, ws: 0, ab: 0, ac: 0, ai: 0, net: 0, nbb: 0, sum: '',
  };

  let street = 'pre', raises = 0, heroRaised = false, heroFolded = false, invest = 0, sc = 0, coll = 0;
  const sum: Record<string, string[]> = { pre: [], flop: [], turn: [], river: [], sd: [] };
  const board: { flop?: string; turn?: string; river?: string } = {};
  const lastBr = (l: string) => { const mm = l.match(/\[([^\]]+)\]\s*$/); return mm ? mm[1] : ''; };

  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('*** SUMMARY')) break;
    if (l.startsWith('*** FLOP')) { invest += sc; sc = 0; street = 'flop'; board.flop = lastBr(l); if (!heroFolded) r.sf = 1; continue; }
    if (l.startsWith('*** TURN')) { invest += sc; sc = 0; street = 'turn'; board.turn = lastBr(l); continue; }
    if (l.startsWith('*** RIVER')) { invest += sc; sc = 0; street = 'river'; board.river = lastBr(l); continue; }
    if (l.startsWith('*** SHOW')) { invest += sc; sc = 0; street = 'sd'; if (!heroFolded) r.sd = 1; continue; }
    if (l.startsWith('***')) continue;
    const um = l.match(new RegExp('^Uncalled bet \\(' + AMT + '\\) returned to (.+)$'));
    if (um) { if (um[2] === hero) invest -= numv(um[1]); continue; }
    const cm = l.match(new RegExp('^(.+?) collected ' + AMT + ' from'));
    if (cm) { if (cm[1] === hero) coll += numv(cm[2]); continue; }
    const p = who(l);
    if (!p) continue;
    const rs = l.slice(p.length + 2), isH = p === hero, tag = isH ? 'Hero' : pos[p] || '?';
    const amt = (re: RegExp) => { const mm = rs.match(re); return mm ? numv(mm[1]) : 0; };
    if (rs.startsWith('posts the ante')) { if (isH) invest += amt(new RegExp('ante ' + AMT)); continue; }
    if (rs.startsWith('posts small & big blinds')) { if (isH) sc += amt(new RegExp('blinds ' + AMT)); continue; }
    if (rs.startsWith('posts')) { if (isH) sc += amt(new RegExp('blind ' + AMT)); continue; }
    const allin = /all-in/.test(rs);
    let a: string;
    if (rs.startsWith('folds')) { a = 'f'; if (isH) heroFolded = true; }
    else if (rs.startsWith('checks')) a = 'x';
    else if (rs.startsWith('calls')) { const x = amt(new RegExp('calls ' + AMT)); a = 'c' + bbf(x); if (isH) sc += x; }
    else if (rs.startsWith('bets')) { const x = amt(new RegExp('bets ' + AMT)); a = 'b' + bbf(x); if (isH) sc += x; }
    else if (rs.startsWith('raises')) { const x = amt(new RegExp('to ' + AMT)); a = 'r' + bbf(x); if (isH) sc = x; }
    else if (rs.startsWith('shows')) a = 'shows ' + ((rs.match(/\[(.+?)\]/) || [])[1] || '');
    else continue;
    if (allin && a[0] !== 's') a += ' AI';
    if (street === 'pre' && isH && 'crfx'.includes(a[0])) {
      if (raises === 1 && !heroRaised && a[0] !== 'x') r.to = 1;
      if (a[0] === 'c') { r.vp = 1; if (raises === 0) r.lp = 1; }
      if (a[0] === 'r') { r.vp = 1; r.pf = 1; if (raises === 1) r.tb = 1; heroRaised = true; }
      if (allin) r.ai = 1;
    }
    if (street === 'pre' && a[0] === 'r') raises++;
    if (isH && (street === 'flop' || street === 'turn' || street === 'river')) {
      if (a[0] === 'b' || a[0] === 'r') r.ab++;
      else if (a[0] === 'c') r.ac++;
    }
    sum[street].push(tag + ' ' + a);
  }
  invest += sc;
  if (gg) {
    const si = lines.findIndex((l) => l.startsWith('*** SUMMARY'));
    const sl = (si < 0 ? [] : lines.slice(si)).find((l) => new RegExp('^Seat \\d+: ' + escRe(hero!) + ' ').test(l)) || '';
    r.sd = !heroFolded && / (showed|mucked) /.test(sl) ? 1 : 0;
  }
  r.net = +(coll - invest).toFixed(2);
  r.nbb = +((coll - invest) / bb).toFixed(2);
  if (r.sd && coll > 0) r.ws = 1;
  const acts = (a: string[]) => (a.length ? a.join(', ') : 'no action');
  let s = 'PF: ' + acts(sum.pre);
  if (board.flop) s += ' | F [' + board.flop + ']: ' + acts(sum.flop);
  if (board.turn) s += ' | T [' + board.turn + ']: ' + acts(sum.turn);
  if (board.river) s += ' | R [' + board.river + ']: ' + acts(sum.river);
  if (sum.sd.length) s += ' | SD: ' + sum.sd.join(', ');
  r.sum = s;
  return r;
}

/* ---------- stats & leaks ---------- */

export interface Stats {
  n: number;
  vpip: number | null; pfr: number | null; limp: number | null;
  to: number; tb: number | null;
  af: number | null; sf: number; wtsd: number | null; sdn: number; wsd: number | null;
  bb100: number | null; netbb: number;
}

export function stats(hs: readonly ParsedHand[]): Stats {
  const n = hs.length;
  const s = (k: keyof ParsedHand) => hs.reduce((a, h) => a + ((h[k] as number) || 0), 0);
  const pf = hs.filter((h) => h.sf && !h.ai);
  const pfSd = pf.filter((h) => h.sd).length;
  return {
    n, vpip: n ? s('vp') / n : null, pfr: n ? s('pf') / n : null, limp: n ? s('lp') / n : null,
    to: s('to'), tb: s('to') ? s('tb') / s('to') : null,
    af: s('ac') ? s('ab') / s('ac') : s('ab') ? 99 : null,
    sf: pf.length, wtsd: pf.length ? pfSd / pf.length : null,
    sdn: s('sd'), wsd: s('sd') ? s('ws') / s('sd') : null,
    bb100: n ? (s('nbb') / n) * 100 : null, netbb: s('nbb'),
  };
}

export interface Leak { lv: 'bad' | 'warn' | 'good'; t: string; p: string }
const fp = (x: number | null) => (x == null ? '–' : Math.round(x * 100) + '%');

export function leaks(st: Stats, hs: readonly ParsedHand[]): Leak[] {
  const L: Leak[] = [];
  if (st.n < 100) L.push({ lv: 'warn', t: 'Early numbers', p: `You have ${st.n} hands. Stats start to mean something around 1,000 hands, so treat these as a first look.` });
  if (st.vpip! > 0.32) L.push({ lv: 'bad', t: `Playing too many hands (${fp(st.vpip)} VPIP)`, p: 'At full tables most winning tournament players are around 18–26%. Cut the weak offsuit hands and small pairs from early position.' });
  else if (st.vpip != null && st.vpip < 0.14 && st.n >= 100) L.push({ lv: 'warn', t: `Very tight (${fp(st.vpip)} VPIP)`, p: 'You may be folding spots that make money, especially on the button and in late position.' });
  if (st.vpip != null && st.pfr != null && st.vpip - st.pfr > 0.09) L.push({ lv: 'bad', t: `Calling too much preflop (VPIP ${fp(st.vpip)} vs PFR ${fp(st.pfr)})`, p: 'A big gap means you call more than you raise. Winning players mostly raise or fold preflop. Aim for a gap under 6 points.' });
  if (st.limp! > 0.05) L.push({ lv: 'bad', t: `Open-limping (${fp(st.limp)} of hands)`, p: 'Limping lets the blinds in cheaply and gives up the initiative. If a hand is worth playing first in, raise it.' });
  if (st.to >= 30 && st.tb! < 0.04) L.push({ lv: 'warn', t: `Rarely 3-betting (${fp(st.tb)})`, p: 'Against a single raise you re-raise less than 4% of the time. Add 3-bets with strong hands and a few suited aces, especially from the blinds and button.' });
  if (st.to >= 30 && st.tb! > 0.14) L.push({ lv: 'warn', t: `3-betting a lot (${fp(st.tb)})`, p: 'Fine against loose openers, but check you are not re-raising weak hands into tight players.' });
  if (st.af != null && st.af < 1.5 && st.sf >= 40) L.push({ lv: 'bad', t: `Passive after the flop (aggression ${st.af.toFixed(1)})`, p: 'You call much more than you bet or raise. Betting your good hands and draws wins more pots and makes you harder to play against.' });
  if (st.wtsd != null && st.sf >= 40 && st.wtsd > 0.36) L.push({ lv: 'bad', t: `Going to showdown too often (${fp(st.wtsd)})`, p: 'You pay off too much. Fold more to big turn and river bets without a strong hand. Most players under-bluff them.' });
  if (st.wsd != null && st.sdn >= 20 && st.wsd < 0.46) L.push({ lv: 'bad', t: `Losing at showdown (${fp(st.wsd)} won)`, p: 'You take weak hands to showdown. Check the biggest losing hands below for calls with second-best hands.' });
  const ep = stats(hs.filter((h) => /^UTG/.test(h.pos)));
  const lp = stats(hs.filter((h) => h.pos === 'BTN' || h.pos === 'CO'));
  if (ep.n >= 40 && lp.n >= 40 && ep.vpip! >= lp.vpip!) L.push({ lv: 'bad', t: 'Not using position', p: `You play as many hands from early position (${fp(ep.vpip)}) as from the cutoff and button (${fp(lp.vpip)}). Play tight early and open wider late.` });
  const short = hs.filter((h) => h.st <= 15 && h.vp && !h.ai && h.g === 'T');
  if (short.length >= 5) L.push({ lv: 'warn', t: `Not shoving when short (${short.length} hands)`, p: 'With 15 BB or less you entered pots without going all-in. At that depth shove or fold is usually best.' });
  if (!L.length || (L.length === 1 && L[0].t === 'Early numbers')) L.push({ lv: 'good', t: 'No big leaks showing', p: 'Your main numbers are inside normal winning ranges. Keep importing hands so the picture sharpens.' });
  return L;
}

export { RANKS };
