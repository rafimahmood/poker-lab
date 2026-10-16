import { type Card, handClass, parseCards } from './cards';
import { equityVs } from './equity';
import { ALL_CLASSES, combosFor, narrow, rangePct, topRange } from './handclasses';
import { type HUAct, type HUStart, type HUState, boardCards, opp } from './headsUp';
import {
  ALLIN, RANGES, SEAT_SIZE, VS_3B, VS_OPEN, behindOf, bucketOf, groupOf, heroType, needEq, spotSets,
} from './ranges';
import { type Rng, defaultRng } from './rng';

/** The built-in rules-based coach. Pure functions: cards and situation in, suggestion out. */
export interface Suggestion {
  act: string; label: string; why: string;
  eq?: number; need?: number; range?: string; amt?: number; amtUse?: number;
}

const pctR = (x: number) => Math.round(x * 100) + '%';
const m2 = (x: number) => String(+(+x).toFixed(2));
const r2 = (x: number) => Math.round(x * 100) / 100;
const fmtChips = (x: number) => Math.round(x).toLocaleString('en-GB');

/* ---------- heads-up cash ---------- */
export function coachHU(st: HUStart, S: HUState, acts: readonly HUAct[], cardsStr: string, rng: Rng = defaultRng): Suggestion | null {
  const hp = parseCards(cardsStr || '');
  if (hp.error !== undefined || hp.cards.length !== 2) return null;
  const hero = hp.cards, cls = handClass(hero[0], hero[1]), bb = st.bb;
  const effBB = Math.min(st.stacks.h, st.stacks.v) / bb, heroBtn = st.btn === 'h';
  const toCall = S.maxComm - S.comm.h, stack = S.stacks.h, maxTo = S.comm.h + stack, pot = S.potNow;
  const pre: Extract<HUAct, { t: 'act' }>[] = [];
  for (const a of acts) { if (a.t === 'board') break; if (a.t === 'act') pre.push(a); }
  let p = st.btn;
  const preBy = pre.map((a) => { const x = { p, type: a.type }; p = opp(p); return x; });
  const vR = preBy.filter((x) => x.p === 'v' && x.type === 'raise').length, hR = preBy.filter((x) => x.p === 'h' && x.type === 'raise').length;
  const vAllIn = S.stacks.v === 0;
  const bucket = bucketOf(effBB);
  const callDecision = (oppList: ReturnType<typeof combosFor>, rangeTxt: string): Suggestion => {
    const eq = equityVs(hero, S.street === 'pre' ? [] : boardCards(S), [oppList], 3000, rng), need = toCall / (pot + toCall);
    return eq >= need
      ? { act: 'call', label: 'Call £' + m2(Math.min(toCall, stack)), eq, need, range: rangeTxt, why: `You win ${pctR(eq)} of the time against their likely hands and only need ${pctR(need)} to make the call profitable.` }
      : { act: 'fold', label: 'Fold', eq, need, range: rangeTxt, why: `You need ${pctR(need)} to call but only win about ${pctR(eq)} against their likely hands.` };
  };
  if (S.street === 'pre') {
    if (vAllIn && toCall > 0) {
      const pctShove = vR === 1 && hR === 0 ? (effBB <= 10 ? 0.6 : effBB <= 15 ? 0.4 : effBB <= 25 ? 0.25 : 0.12) : vR === 1 ? (effBB <= 10 ? 0.35 : effBB <= 15 ? 0.25 : effBB <= 25 ? 0.14 : 0.07) : effBB <= 15 ? 0.12 : 0.05;
      return callDecision(combosFor(topRange(pctShove), hero), `top ${pctR(pctShove)} for an all-in here`);
    }
    if (heroBtn && preBy.filter((x) => x.p === 'h').length === 0) {
      if (effBB <= 12) {
        const callSet = ALLIN.H[bucket], fc = rangePct(callSet), eq = equityVs(hero, [], [combosFor(callSet, hero)], 3000, rng);
        const evShove = (1 - fc) * 1 + fc * (eq * 2 * effBB - effBB);
        return evShove > -0.5
          ? { act: 'raise', amt: maxTo, label: 'All-in', eq, range: `they call with about ${pctR(fc)}`, why: `With ${effBB.toFixed(0)} BB, going all-in beats folding: they fold ${pctR(1 - fc)} of the time and you still have ${pctR(eq)} when called.` }
          : { act: 'fold', label: 'Fold', why: `${cls} is too weak to shove ${effBB.toFixed(0)} BB heads-up.` };
      }
      return RANGES.HU.has(cls)
        ? { act: 'raise', amt: r2(Math.min(maxTo, bb * 2.5)), label: 'Raise to £' + m2(Math.min(maxTo, bb * 2.5)), why: `${cls} is in the heads-up button range (about 75% of hands). Raise, don't limp.` }
        : { act: 'fold', label: 'Fold', why: `${cls} is one of the weakest hands. Fold and wait.` };
    }
    if (!heroBtn && hR === 0 && vR === 0 && toCall === 0) {
      return VS_OPEN.H.BB!.r.has(cls)
        ? { act: 'raise', amt: r2(Math.min(maxTo, bb * 3.5)), label: 'Raise to £' + m2(Math.min(maxTo, bb * 3.5)), why: `They limped. ${cls} is strong enough to raise and punish it.` }
        : { act: 'check', label: 'Check', why: `They limped. See a free flop with ${cls}.` };
    }
    if (!heroBtn && vR === 1 && hR === 0) {
      const BB = VS_OPEN.H.BB!;
      if (effBB <= 20 && BB.r.has(cls)) return { act: 'raise', amt: maxTo, label: 'All-in', why: `With ${effBB.toFixed(0)} BB, re-raise all-in with ${cls} instead of a small re-raise.` };
      if (BB.r.has(cls)) return { act: 'raise', amt: r2(Math.min(maxTo, S.maxComm * 3)), label: 'Re-raise to £' + m2(Math.min(maxTo, S.maxComm * 3)), why: `${cls} is in the big-blind re-raise range against a button raise.` };
      if (BB.c.has(cls)) return { act: 'call', label: 'Call £' + m2(Math.min(toCall, stack)), why: `${cls} is in the big-blind defending range: you already have 1 BB in, so calling is cheap.` };
      return { act: 'fold', label: 'Fold', why: `${cls} is too weak to defend, even with the big blind already in.` };
    }
    if (heroBtn && hR >= 1 && vR >= 1 && vR === hR) {
      const R = VS_3B.H;
      if (R.r.has(cls)) return { act: 'raise', amt: effBB <= 40 ? maxTo : r2(Math.min(maxTo, S.maxComm * 2.3)), label: effBB <= 40 ? 'All-in' : '4-bet to £' + m2(Math.min(maxTo, S.maxComm * 2.3)), why: `${cls} is in the 4-bet range against a big-blind re-raise.` };
      if (R.c.has(cls) && effBB > 25) return { act: 'call', label: 'Call £' + m2(Math.min(toCall, stack)), why: `${cls} is good enough to call the re-raise and see a flop.` };
      return { act: 'fold', label: 'Fold', why: `${cls} isn't strong enough to continue against a re-raise.` };
    }
    if (toCall > 0) return callDecision(combosFor(topRange(vR >= 2 ? 0.06 : 0.2), hero), `top ${vR >= 2 ? '6%' : '20%'}`);
    return { act: 'check', label: 'Check', why: 'No bet to you.' };
  }
  // after the flop: their range from the preflop line, narrowed by their bets since
  const bd = boardCards(S);
  let base: Set<string> | null = null, label = '';
  const lastPreRaiser = [...preBy].reverse().find((x) => x.type === 'raise');
  const vPreR = preBy.filter((x) => x.p === 'v' && x.type === 'raise').length;
  if (!lastPreRaiser) { base = heroBtn ? new Set(ALL_CLASSES.filter((c) => !VS_OPEN.H.BB!.r.has(c))) : null; label = heroBtn ? "any hand they didn't raise" : 'almost any hand'; }
  else if (lastPreRaiser.p === 'v') { base = vPreR === 1 ? (heroBtn ? VS_OPEN.H.BB!.r : RANGES.HU) : vPreR === 2 ? VS_3B.H.r : topRange(0.04); label = vPreR === 1 ? (heroBtn ? 'their re-raising range' : 'the button raising range') : 'a strong 4-bet range'; }
  else { base = hR === 1 ? VS_OPEN.H.BB!.c : VS_3B.H.c; label = hR === 1 ? 'the big-blind calling range' : 'their range for calling a re-raise'; }
  let list = combosFor(base, [...hero, ...bd]);
  let keep = 1, pp: 'h' | 'v' = st.btn, street = 'pre';
  for (const a of acts) {
    if (a.t === 'board') { street = 'post'; pp = opp(st.btn); continue; }
    if (a.t !== 'act') continue;
    if (street === 'post' && pp === 'v' && a.type === 'raise') keep *= S.maxComm > 0 && a === acts[acts.length - 1] ? 0.5 : 0.6;
    pp = opp(pp);
  }
  keep = Math.max(0.15, keep);
  list = narrow(list, bd, keep);
  const eq = equityVs(hero, bd, [list], 2500, rng);
  const rng_ = label + (keep < 1 ? `, narrowed to the top ${pctR(keep)} because they bet` : '');
  if (toCall > 0) {
    const need = toCall / (pot + toCall);
    if (eq >= Math.max(0.65, need + 0.2) && stack > toCall) {
      const to = r2(Math.min(maxTo, S.maxComm * 3));
      return { act: 'raise', amt: to, label: to >= maxTo ? 'All-in' : 'Raise to £' + m2(to), eq, need, range: rng_, why: `You're a big favourite (${pctR(eq)}). Raise for value.` };
    }
    return eq >= need
      ? { act: 'call', label: 'Call £' + m2(Math.min(toCall, stack)), eq, need, range: rng_, why: `You win ${pctR(eq)} and need ${pctR(need)}. The price is right to call.` }
      : { act: 'fold', label: 'Fold', eq, need, range: rng_, why: `You need ${pctR(need)} but win only about ${pctR(eq)} against the hands they bet with.` };
  }
  if (eq >= 0.62) { const b = r2(Math.min(maxTo, Math.max(bb, pot * 0.66))); return { act: 'raise', amt: b, label: b >= maxTo ? 'All-in' : 'Bet £' + m2(b), eq, range: rng_, why: `You're ahead of most of their hands (${pctR(eq)}). Bet about two-thirds of the pot for value.` }; }
  if (eq >= 0.5 && S.street !== 'river') { const b = r2(Math.min(maxTo, Math.max(bb, pot * 0.33))); return { act: 'raise', amt: b, label: 'Bet £' + m2(b), eq, range: rng_, why: `Slightly ahead (${pctR(eq)}). A small bet gets value from worse hands and protects yours.` }; }
  return { act: 'check', label: 'Check', eq, range: rng_, why: eq >= 0.35 ? `Your hand has some value (${pctR(eq)}) but isn't strong enough to bet. Check and keep the pot small.` : `You're behind (${pctR(eq)}). Check and give up unless you improve.` };
}

/* ---------- live tournament table ---------- */
export type Sit = 'folded' | 'limped' | 'raised' | 'allin' | '3bet';

export interface TourPreInput {
  cards: string; sit: Sit | null; pos: string; n: number; myBB: number;
  sitSeat: string | null; sitBB: number; limpers: number;
}

export function tourPreSuggestion(i: TourPreInput, rng: Rng = defaultRng): Suggestion | null {
  const hp = parseCards(i.cards);
  if (!i.sit || hp.error !== undefined || hp.cards.length !== 2) return null;
  const hero = hp.cards, cls = handClass(hero[0], hero[1]), { pos, n, myBB } = i;
  if (i.sit === 'folded') {
    const set = spotSets('open', pos, null, n);
    if (!set) return { act: 'check', label: 'Check', why: 'Folded to you in the big blind: you win the blinds.' };
    if (myBB <= 12) {
      const k = behindOf(pos, n)!;
      const pushSet = topRange(Math.min(0.9, (k <= 1 ? 0.55 : k <= 2 ? 0.4 : k <= 4 ? 0.25 : 0.15) * (myBB <= 8 ? 1.3 : 1)));
      return pushSet.has(cls)
        ? { act: 'allin', label: `All-in (${myBB.toFixed(0)} BB)`, why: `With ${myBB.toFixed(0)} BB, go all-in or fold. ${cls} is strong enough to shove from ${pos}.` }
        : { act: 'fold', label: 'Fold', why: `At ${myBB.toFixed(0)} BB it's shove or fold, and ${cls} is too weak to shove from ${pos}.` };
    }
    return set.r.has(cls)
      ? { act: 'raise', label: 'Raise', why: `${cls} is in the ${pos} opening range (${pctR(rangePct(set.r))} of hands). ${SEAT_SIZE[behindOf(pos, n)!] || 'Raise to about 2.5 BB.'}` }
      : { act: 'fold', label: 'Fold', why: `${cls} isn't in the ${pos} opening range. Fold.` };
  }
  if (i.sit === 'limped') {
    const k = behindOf(pos, n) || 1, tight = RANGES[Math.min(8, k + 2)] || RANGES[8], open = spotSets('open', pos, null, n);
    if (tight.has(cls)) return { act: 'raise', label: `Raise to ${3 + i.limpers} BB`, why: `${cls} is strong. Raise the limper${i.limpers > 1 ? 's' : ''}: about 3 BB plus 1 BB each.` };
    if (pos === 'BB') return { act: 'check', label: 'Check', why: `Take the free flop with ${cls}.` };
    if (open && open.r.has(cls) && (cls[0] === cls[1] || cls[2] === 's')) return { act: 'call', label: 'Call (limp behind)', why: `${cls} plays well in a multi-way pot: you hope to hit big and get paid.` };
    return { act: 'fold', label: 'Fold', why: `${cls} is too weak to play behind limpers.` };
  }
  if (i.sit === 'raised') {
    if (!i.sitSeat) return null;
    const S = spotSets('vsopen', pos, i.sitSeat, n);
    if (!S) return null;
    if (myBB <= 25 && S.r.has(cls)) return { act: 'allin', label: 'All-in', why: `With ${myBB.toFixed(0)} BB, re-raise all-in with ${cls} rather than a small re-raise.` };
    if (S.r.has(cls)) return { act: 'reraise', label: 'Re-raise', why: `${cls} is in the re-raise range against a ${i.sitSeat} raise. ${heroType(pos) === 'IP' ? 'Make it about 3× their raise.' : 'Make it about 4× their raise.'}` };
    if (S.c.has(cls)) return { act: 'call', label: 'Call', why: `${cls} is good enough to call a ${i.sitSeat} raise${pos === 'BB' ? ' from the big blind.' : ' and play the flop in position.'}` };
    return { act: 'fold', label: 'Fold', why: `${cls} isn't strong enough against a raise from ${i.sitSeat}.` };
  }
  if (i.sit === 'allin') {
    if (!i.sitSeat) return null;
    const bbv = Math.min(i.sitBB, myBB), g = groupOf(i.sitSeat, n);
    const shovePct = g === 'E' ? 0.1 : g === 'M' ? 0.15 : g === 'L' ? 0.3 : g === 'S' || g === 'H' ? 0.45 : 0.2;
    const range = topRange(Math.min(0.9, shovePct * (bbv <= 10 ? 1.5 : bbv <= 15 ? 1.1 : bbv <= 25 ? 0.7 : 0.4)));
    const eq = equityVs(hero, [], [combosFor(range, hero)], 3000, rng), need = needEq(bbv, n, pos === 'BB');
    const rtxt = `top ${pctR(rangePct(range))} from ${i.sitSeat}`;
    return eq >= need
      ? { act: 'call', label: 'Call', eq, need, range: rtxt, why: `You win ${pctR(eq)} against a typical ${bbv.toFixed(0)} BB shove from ${i.sitSeat}, and need ${pctR(need)}.` }
      : { act: 'fold', label: 'Fold', eq, need, range: rtxt, why: `You need ${pctR(need)} but win only ${pctR(eq)} against their likely shoving hands.` };
  }
  if (i.sit === '3bet') {
    const S = spotSets('vs3b', pos, null, n);
    if (!S) return null;
    if (S.r.has(cls)) return { act: myBB <= 40 ? 'allin' : 'reraise', label: myBB <= 40 ? 'All-in' : '4-bet', why: `${cls} is in the 4-bet range when you opened from ${pos}.` };
    if (S.c.has(cls) && myBB > 30) return { act: 'call', label: 'Call', why: `${cls} is good enough to call the re-raise.` };
    return { act: 'fold', label: 'Fold', why: `${cls} isn't strong enough to continue against a re-raise.` };
  }
  return null;
}

export interface TourPostInput {
  hero: Card[]; board: Card[]; pos: string; n: number; sit: Sit | null; sitSeat: string | null;
  heroRaised: boolean; toCall: number; pot: number; opps: number; bb: number;
}

export function tourPostSuggestion(i: TourPostInput, rng: Rng = defaultRng): Suggestion {
  const g = groupOf(i.pos, i.n) || 'L';
  let main: Set<string>, label: string;
  if (i.sit === 'raised' && i.sitSeat && !i.heroRaised) { const s = spotSets('open', i.sitSeat, null, i.n); main = s ? s.r : topRange(0.2); label = i.sitSeat + "'s raising range"; }
  else if (i.sit === '3bet') { const s = VS_OPEN[g]; main = new Set([...(s.IP ? s.IP.r : []), ...(s.BB ? s.BB.r : [])]); label = 'a re-raising range'; }
  else if (i.sit === 'limped') { main = topRange(0.5); label = 'a limping range'; }
  else { const s = VS_OPEN[g] && VS_OPEN[g].BB; main = s ? new Set([...s.c]) : topRange(0.35); label = 'a calling range'; }
  const { toCall: tc, pot, bb } = i;
  const dead = [...i.hero, ...i.board];
  let list = combosFor(main, dead);
  if (tc > 0) list = narrow(list, i.board, 0.55);
  const opps = [list];
  for (let k = 1; k < i.opps; k++) opps.push(combosFor(topRange(0.4), dead));
  const eq = equityVs(i.hero, i.board, opps, 2000, rng), fair = 1 / (i.opps + 1);
  const rngTxt = label + (tc > 0 ? ', narrowed because they bet' : '') + (i.opps > 1 ? ` plus ${i.opps - 1} more player${i.opps > 2 ? 's' : ''}` : '');
  if (tc > 0) {
    const need = tc / (pot + tc);
    if (eq >= Math.max(0.65, need + 0.2)) return { act: 'raise', label: 'Raise to about ' + fmtChips(tc * 3), eq, need, range: rngTxt, why: `You're a big favourite (${pctR(eq)}). Raise for value.` };
    if (eq >= need) return { act: 'call', label: 'Call ' + fmtChips(tc), eq, need, range: rngTxt, why: `You win ${pctR(eq)} and only need ${pctR(need)}. Call.` };
    return { act: 'fold', label: 'Fold', eq, need, range: rngTxt, why: `You need ${pctR(need)} but win only ${pctR(eq)}. Fold.` };
  }
  if (eq >= Math.max(0.62, fair + 0.25)) return { act: 'raise', label: 'Bet about ' + fmtChips(Math.max(bb, pot * 0.66)), eq, range: rngTxt, why: `You're ahead (${pctR(eq)}). Bet two-thirds of the pot for value.` };
  if (eq >= Math.max(0.5, fair + 0.15) && i.board.length < 5) return { act: 'raise', label: 'Bet about ' + fmtChips(Math.max(bb, pot * 0.33)), eq, range: rngTxt, why: `Slightly ahead (${pctR(eq)}). A small bet gets value and protects your hand.` };
  return { act: 'check', label: 'Check', eq, range: rngTxt, why: eq >= fair ? `Some value (${pctR(eq)}) but not enough to bet. Check.` : `You're behind (${pctR(eq)}). Check and give up unless you improve.` };
}
