import { type Card, RANKS, handClass } from '../poker/cards';
import { rangePct } from '../poker/handclasses';
import {
  type Bucket, GROUP_NAME, MODE_WORDS, type Mode, type RangeSet, SEAT_SIZE, SEAT_TIPS, STACK_BUCKETS, behindOf, bucketOf, groupOf, heroType,
  needEq, seatList, spotSets, validRaisers,
} from '../poker/ranges';
import { pick } from '../poker/rng';
import { freshDeck } from '../poker/cards';
import type { ParsedHand } from '../poker/handHistory';
import { $, $$, cardsHTML, esc, ls, pct, showCards } from '../ui/dom';
import { psAll } from './trackerData';

let rgN = 9, rgPos = 'UTG', rgMode: Mode = 'open', rgRaiser: string | null = null, rgStack: Bucket = 15;
{
  const s = ls.get<any>('pl-rg', null);
  if (s) {
    if (s.n >= 2 && s.n <= 9) rgN = s.n;
    if (seatList(rgN).includes(s.pos)) rgPos = s.pos;
    if (['open', 'vsopen', 'vs3b', 'allin'].includes(s.mode)) rgMode = s.mode;
    if ([10, 15, 20, 30].includes(s.stack)) rgStack = s.stack;
    rgRaiser = s.raiser || null;
  }
}
const saveRg = () => ls.set('pl-rg', { n: rgN, pos: rgPos, mode: rgMode, raiser: rgRaiser, stack: rgStack });
const seatValid = (p: string) => rgMode === 'open' || (rgMode === 'vs3b' ? p !== 'BB' : validRaisers(p, rgN).length > 0);

function fixState() {
  if (!seatList(rgN).includes(rgPos)) rgPos = 'UTG';
  if (!seatValid(rgPos)) rgPos = rgMode === 'vsopen' || rgMode === 'allin' ? 'BB' : 'CO';
  const vr = validRaisers(rgPos, rgN);
  if ((rgMode === 'vsopen' || rgMode === 'allin') && (!rgRaiser || !vr.includes(rgRaiser))) rgRaiser = vr.includes('CO') ? 'CO' : vr[0];
}

const NOTES: Record<Mode, string[]> = {
  open: ["<b>Only when it's folded to you.</b> If someone has already raised, switch to \"Facing a raise\".",
    '<b>Stacks of about 20–60 big blinds</b>, the normal middle stage of a tournament. <b>Under 15 BB</b>, stop raising small: go all-in or fold.',
    "<b>Raise, never limp.</b> When it's folded to you, calling the big blind (limping) gives up your chance to win the blinds straight away and lets everyone in cheaply. If a hand isn't good enough to raise, fold it. The only real exception is the small blind, where strong players sometimes limp; raise-or-fold is still the simpler, better default.",
    "<b>Someone else limped first?</b> Raise your good hands bigger (about 3 BB plus 1 BB per limper). Calling behind with small pairs and suited connectors is fine in loose home games, because you'll get paid when you hit.",
    '<b>Fewer players = wider ranges.</b> The chart is based on how many players are left to act behind you, so a 6-handed UTG uses roughly the same range as a 9-handed LJ. Heads-up, the button raises about four hands in five.',
    '<b>Loose home games:</b> when people call almost every raise, cut the weakest offsuit hands and small suited ones from early seats, and raise a bit bigger with the rest.'],
  vsopen: ['<b>One normal raise (2–3 BB) and everyone else folded.</b> If someone already called the raise, tighten up: re-raise a little less and call a little less.',
    "<b>The earlier the raiser, the stronger their hand.</b> Someone raising from UTG usually has a strong hand; a button raise can be almost anything. That's why you play so many more hands against late raisers.",
    "<b>In the big blind you already have 1 BB in</b>, so you get a good price and can call wide. <b>In the small blind, re-raise or fold</b>: calling leaves the big blind behind you and puts you out of position.",
    "<b>Re-raise size:</b> about 3× their raise when you'll act after them, about 4× from the blinds.",
    '<b>Suited aces like A5s are re-raise bluffs:</b> they block aces and make nut flushes and straights when called.',
    '<b>Under 25 BB</b>, calling raises gets expensive; with the re-raise hands, just go all-in instead.'],
  allin: ['<b>Someone went all-in before the flop and everyone else folded to you.</b> If another player already called the all-in, tighten up a lot: call mostly with big pairs and AK.',
    "<b>Their stack matters most.</b> Someone shoving 8 BB is desperate and shoves lots of hands; someone shoving 30 BB usually has a big pair or AK. The smaller the all-in, the wider you call.",
    '<b>Their seat matters too.</b> A shove from the button or small blind is much wider than one from UTG.',
    "<b>You don't need to be ahead to call.</b> With blinds and antes in the pot you only need about 40–45% equity against their range, so hands like A7o can be a call against a short late-position shove.",
    '<b>Near the money or at a final table</b>, tighten up: busting costs you more than the chips. Check the spot in Tools → ICM.',
    '<b>In the big blind</b> you already have 1 BB in, so you can call slightly wider than the chart.'],
  vs3b: ["<b>You raised, someone re-raised about 3× your raise, and it's back to you.</b>",
    '<b>Most players at low stakes re-raise mainly with strong hands.</b> Against a tight player, fold more than the chart; against a player who re-raises a lot, call and 4-bet more.',
    '<b>4-bet size:</b> about 2.2–2.5× their re-raise. With 40 BB or less, a 4-bet is usually just going all-in.',
    '<b>Calling a 3-bet commits a big part of your stack.</b> Suited hands and pairs play best, because they can make strong hands; weak offsuit aces often get dominated.',
    '<b>Under 30 BB:</b> call less. Either go all-in with the 4-bet hands and the best calling hands, or fold.'],
};

const listLine = (label: string, colour: string, spec: string) =>
  spec ? `<div><span class="swatch" style="background:${colour}"></span><b>${label}:</b> <span class="mono">${esc(spec.replace(/,/g, ', '))}</span></div>` : '';

function renderTable() {
  $$('[data-rgn]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.rgn! === rgN)));
  $$('[data-rgm]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rgm === rgMode)));
  const seats = seatList(rgN), T = $('rg-table');
  $('rg-felt').textContent = rgMode === 'open' ? 'Folded to you' : rgMode === 'vsopen' ? (rgRaiser ? rgRaiser + ' raised' : 'Someone raised') : rgMode === 'allin' ? (rgRaiser ? rgRaiser + ' is all-in' : 'Someone is all-in') : 'You raised, got re-raised';
  T.querySelectorAll('.seat').forEach((s) => s.remove());
  seats.forEach((p, i) => {
    const th = ((90 + ((i + 0.5) * 360) / rgN) * Math.PI) / 180;
    const b = document.createElement('button');
    const ok = seatValid(p);
    b.className = 'seat' + (p === 'BB' && rgMode === 'open' ? ' bb' : '') + (ok ? '' : ' off') + ((rgMode === 'vsopen' || rgMode === 'allin') && p === rgRaiser ? ' raiser' : '');
    b.textContent = p; b.type = 'button'; b.disabled = !ok;
    b.style.left = 50 + 45 * Math.cos(th) + '%'; b.style.top = 50 + 44 * Math.sin(th) + '%';
    b.setAttribute('aria-pressed', String(p === rgPos));
    b.addEventListener('click', () => { rgPos = p; fixState(); saveRg(); renderRanges(); });
    T.appendChild(b);
  });
  $('rg-raiserlabel').textContent = rgMode === 'allin' ? 'Who went all-in?' : 'Who raised?';
  $('rg-stackbox').hidden = rgMode !== 'allin';
  if (rgMode === 'allin') $('rg-stacks').innerHTML = STACK_BUCKETS.map(([b, l]) => `<button class="small" data-rgs="${b}" aria-pressed="${b === rgStack}">${l}</button>`).join('');
  if (rgMode === 'vsopen' || rgMode === 'allin') {
    $('rg-raiserbox').hidden = false;
    $('rg-raisers').innerHTML = validRaisers(rgPos, rgN).map((p) => `<button class="small" data-rgr="${p}" aria-pressed="${p === rgRaiser}">${p}</button>`).join('');
  } else $('rg-raiserbox').hidden = true;
}

export function renderRanges() {
  fixState(); renderTable();
  const sets = spotSets(rgMode, rgPos, rgRaiser, rgN, rgStack), grid = $('rg-grid'), W = MODE_WORDS[rgMode];
  $('rg-notes').innerHTML = NOTES[rgMode].map((x) => `<li>${x}</li>`).join('');
  $('rg-legend').innerHTML = `<span><span class="swatch" style="background:var(--accent)"></span> ${W.r}</span>${rgMode === 'open' || rgMode === 'allin' ? '' : `<span><span class="swatch" style="background:var(--gold)"></span> ${W.c}</span>`}<span><span class="swatch" style="background:var(--sunk);border:1px solid var(--line)"></span> Fold</span>`;
  const tip = (title: string, body: string) => ($('rg-tip').innerHTML = `<b>${esc(title)}</b><p class="note" style="margin:0">${esc(body)}</p>`);
  if (rgMode === 'open') {
    const k = behindOf(rgPos, rgN), hu = rgN === 2;
    $('rg-title').textContent = hu ? (rgPos === 'BTN' ? 'Heads-up · button (small blind)' : 'Heads-up · big blind') : rgPos + (k ? ` · ${k} player${k > 1 ? 's' : ''} behind` : '');
    tip(hu && rgPos === 'BTN' ? 'Button (small blind)' : rgPos,
      hu ? (rgPos === 'BTN' ? 'Heads-up, the button posts the small blind, acts first before the flop and last after it. Raise most hands: only the big blind stands between you and the blinds.' : 'You never open from the big blind. Switch to "Facing a raise" to see how to defend against the button.')
        : rgN <= 4 && rgPos === 'BTN' ? 'Short-handed, the button is only up against the blinds. Open very wide.' : SEAT_TIPS[rgPos] || '');
    $('rg-size').textContent = (hu ? (rgPos === 'BTN' ? 'Raise to 2–2.5 BB. ' : '') : k ? SEAT_SIZE[k] + ' ' : '') + 'The "+" means that hand and everything better of the same kind, e.g. A9s+ is A9s, ATs, AJs, AQs, AKs.';
  } else if (rgMode === 'vsopen') {
    const g = rgRaiser ? groupOf(rgRaiser, rgN) : null;
    $('rg-title').textContent = `${rgPos} vs ${rgRaiser} raise`;
    tip(rgN === 2 ? 'The button raised.' : `${rgRaiser} raised from ${(g && GROUP_NAME[g]) || ''}.`,
      heroType(rgPos) === 'BB' ? (rgN === 2 ? 'Heads-up, the button raises most hands, so you defend a lot: you already have 1 BB in and only need about 30% equity to call a 2.5 BB raise.' : "You're in the big blind, so you can call more hands at a good price.")
        : heroType(rgPos) === 'SB' ? 'From the small blind, re-raise or fold. Calling leaves the big blind to act behind you.' : "You'll act after them for the rest of the hand, which lets you call with hands that play well after the flop.");
    $('rg-size').textContent = heroType(rgPos) === 'IP' ? 'Re-raise to about 3× their raise.' : 'Re-raise to about 4× their raise.';
  } else if (rgMode === 'allin') {
    const g = rgRaiser ? groupOf(rgRaiser, rgN) : null, bl = STACK_BUCKETS.find((x) => x[0] === rgStack)!, eq = needEq(bl[2], rgN, rgPos === 'BB');
    $('rg-title').textContent = `${rgPos} vs ${rgN === 2 ? 'button' : rgRaiser} all-in · ${bl[1]}`;
    tip(`${rgN === 2 ? 'The button' : rgRaiser} shoves ${bl[1].toLowerCase()}.`,
      (g === 'E' ? 'An early all-in is usually strong: big pairs, AK, AQ.' : g === 'M' ? 'A middle-seat shove is a bit wider, but still mostly good aces and pairs.' : 'Late-seat and blind shoves are wide, so you can call with many more hands.') + ` Calling a ${bl[2]} BB shove, you need about ${Math.round(eq * 100)}% equity against their range.`);
    $('rg-size').textContent = "It's call or fold: re-raising an all-in isn't possible.";
  } else {
    const g = groupOf(rgPos, rgN);
    $('rg-title').textContent = `You opened from ${rgPos}, got 3-bet`;
    tip(`You opened from ${(g && GROUP_NAME[g]) || rgPos}.`,
      g === 'H' ? 'Heads-up, the big blind re-raises you with a wide range because you open so many hands. Defend a lot of them.' : g === 'E' ? 'An early raise shows strength, so anyone re-raising you usually has a real hand. Keep going only with the best.'
        : g === 'S' ? 'Only the big blind can have re-raised you. They can do it with a wide range, so defend quite a lot.' : 'Late raises are wide, so players re-raise you lighter. You can defend more hands.');
    $('rg-size').textContent = '4-bet to about 2.2–2.5× their re-raise, or all-in with 40 BB or less.';
  }
  grid.innerHTML = '';
  if (!sets) { $('rg-pct').textContent = ''; $('rg-list').innerHTML = `<p class="note">${rgMode === 'open' ? 'No opening range: the big blind never raises first.' : 'Pick a seat.'}</p>`; return; }
  const tot = rangePct(sets.r) + rangePct(sets.c);
  $('rg-pct').textContent = `Play ${pct(tot, 0)}` + (sets.c.size ? ` · ${pct(rangePct(sets.r), 0)} ${W.r.toLowerCase().replace(/ \(.*\)/, '')}` : '');
  for (let i = 0; i < 13; i++)
    for (let j = 0; j < 13; j++) {
      const r1 = 12 - i, r2 = 12 - j;
      const name = i === j ? RANKS[r1] + RANKS[r1] : i < j ? RANKS[r1] + RANKS[r2] + 's' : RANKS[r2] + RANKS[r1] + 'o';
      const d = document.createElement('div'), R = sets.r.has(name), C = sets.c.has(name);
      d.textContent = name;
      d.style.background = R ? 'var(--accent)' : C ? 'var(--gold)' : 'var(--sunk)';
      d.style.color = R ? 'var(--accent-fg)' : C ? 'var(--bg)' : 'var(--muted)';
      d.title = `${name}: ${R ? W.r : C ? W.c : 'Fold'}`;
      grid.appendChild(d);
    }
  $('rg-list').innerHTML = listLine(W.r, 'var(--accent)', sets.rs) + listLine(W.c, 'var(--gold)', sets.cs);
}

/* ---------- drill ---------- */
interface Drill { mode: Mode; pos: string; raiser: string | null; n: number; bucket: Bucket | null; c: Card[]; h: string; sets: RangeSet; done: boolean }
let rgd: Drill | null = null;
let rgScore = ls.get('pl-rgscore', { r: 0, t: 0 });

export function newRgDrill() {
  const n = rgN, mode = rgMode, seats = seatList(n);
  const posPool = mode === 'vsopen' || mode === 'allin' ? seats.filter((p) => validRaisers(p, n).length) : seats.filter((p) => p !== 'BB');
  const pos = pick(posPool);
  const raiser = mode === 'vsopen' || mode === 'allin' ? pick(validRaisers(pos, n)) : null;
  const bucket = mode === 'allin' ? pick(STACK_BUCKETS)[0] : null;
  const sets = spotSets(mode, pos, raiser, n, bucket ?? 15)!;
  let c: Card[];
  const playable = [...sets.r, ...sets.c];
  if (mode !== 'open' && playable.length && Math.random() < 0.55) {
    const want = pick(playable);
    const r1 = RANKS.indexOf(want[0]), r2 = RANKS.indexOf(want[1]);
    const s1 = (Math.random() * 4) | 0;
    const s2 = want.length === 2 ? (s1 + 1 + ((Math.random() * 3) | 0)) % 4 : want[2] === 's' ? s1 : (s1 + 1 + ((Math.random() * 3) | 0)) % 4;
    c = [r1 * 4 + s1, r2 * 4 + s2].sort((a, b) => b - a);
  } else { const d = freshDeck(); c = [d[0], d[1]].sort((a, b) => b - a); }
  rgd = { mode, pos, raiser, n, bucket, c, h: handClass(c[0], c[1]), sets, done: false };
  const W = MODE_WORDS[mode];
  $('rgd-call').hidden = mode === 'allin';
  $('rgd-title').textContent = mode === 'allin' ? 'Call or fold?' : mode === 'open' ? 'Raise or fold?' : mode === 'vsopen' ? 'Re-raise, call or fold?' : '4-bet, call or fold?';
  $('rgd-raise').textContent = W.r; $('rgd-call').textContent = W.c; $('rgd-fold').textContent = 'Fold';
  showCards($('rgd-cards'), c, true);
  $('rgd-pos').textContent = n === 2 && pos === 'BTN' ? 'Button (SB)' : pos;
  $('rgd-players').textContent = n === 2 ? 'Heads-up' : n + ' players';
  const bl = bucket && STACK_BUCKETS.find((x) => x[0] === bucket);
  $('rgd-spot').textContent = mode === 'allin' ? `${n === 2 ? 'The button' : raiser} goes all-in for ${bl![2]} BB. Everyone else folds to you.`
    : mode === 'open' ? (n === 2 ? "Heads-up. You're on the button (small blind) and first to act." : 'Everyone before you has folded.')
      : mode === 'vsopen' ? (n === 2 ? 'Heads-up. The button raises to 2.5 BB.' : `${raiser} raises to 2.5 BB. Everyone else folds to you.`)
        : `You raise from ${pos}. A player behind you re-raises to about 3× and it's back to you.`;
  $('rgd-out').innerHTML = '';
  ['rgd-raise', 'rgd-call', 'rgd-fold'].forEach((id) => ($<HTMLButtonElement>(id).disabled = false));
  $('rgd-score').textContent = `${rgScore.r} / ${rgScore.t}`;
}

function answer(choice: 'raise' | 'call' | 'fold') {
  if (!rgd || rgd.done) return;
  rgd.done = true;
  const S = rgd.sets, best = S.r.has(rgd.h) ? 'raise' : S.c.has(rgd.h) ? 'call' : 'fold', W = MODE_WORDS[rgd.mode];
  const ok = choice === best;
  rgScore.t++; if (ok) rgScore.r++;
  ls.set('pl-rgscore', rgScore);
  $('rgd-score').textContent = `${rgScore.r} / ${rgScore.t}`;
  ['rgd-raise', 'rgd-call', 'rgd-fold'].forEach((id) => ($<HTMLButtonElement>(id).disabled = true));
  const bestWord = best === 'raise' ? W.r : best === 'call' ? W.c : 'Fold';
  let why = '';
  if (rgd.mode === 'open' && choice === 'call') why = rgd.pos === 'SB'
    ? "Limping from the small blind isn't a disaster, and strong players sometimes do it with a mixed strategy. But the big blind gets to see a flop for free or raise you, and you play the whole hand out of position. Raise-or-fold is simpler and wins more for most players."
    : `Calling when it's folded to you is limping. You can't win the blinds straight away, you invite several players in cheaply, and anyone can raise you off your hand. If ${rgd.h} is good enough to play from here, it's good enough to raise; if not, fold it.`;
  else if (rgd.mode === 'vsopen' && choice === 'call' && rgd.pos === 'SB') why = 'From the small blind, calling leaves the big blind behind you to squeeze, and you\'ll be out of position. Re-raise or fold.';
  else if (rgd.mode === 'allin') { const bl = STACK_BUCKETS.find((x) => x[0] === rgd!.bucket)!; why = `${best === 'raise' ? rgd.h + ' has enough equity against their shoving range to call.' : rgd.h + " doesn't have enough equity against their shoving range."} Calling ${bl[2]} BB needs about ${Math.round(needEq(bl[2], rgd.n, rgd.pos === 'BB') * 100)}%.`; }
  else if (!ok && best === 'fold') why = `${rgd.h} is too weak here. ${rgd.mode === 'vs3b' ? 'Against a re-raise it will often be dominated, and calling costs a big part of your stack.' : 'Against a raise it is often behind or dominated.'}`;
  else if (!ok && best === 'call') why = `${rgd.h} is strong enough to continue, but not strong enough to raise again. Calling keeps weaker hands in.`;
  else if (!ok && best === 'raise') why = `${rgd.h} is one of the best hands in this spot. Raise to build the pot${rgd.h.length === 3 && rgd.h[0] === 'A' && '2345'.includes(rgd.h[1]) ? ' (or as a bluff: it blocks aces and makes nut flushes and straights)' : ''}.`;
  const lines = listLine(W.r, 'var(--accent)', S.rs) + listLine(W.c, 'var(--gold)', S.cs);
  $('rgd-out').innerHTML = `<div class="verdict ${ok ? 'good' : 'bad'}"><b>${ok ? 'Right.' : 'Not this time.'} ${esc(rgd.h)}: ${esc(bestWord.toLowerCase())}.</b>${why ? `<p style="margin:0">${esc(why)}</p>` : ''}<div style="display:grid;gap:4px;font-size:13px">${lines}</div></div>`;
}

/* ---------- compare your real hands with the chart ---------- */
interface Spot { h: ParsedHand; sets: RangeSet; act: string; best: string; raiser?: string }
const preTokens = (h: ParsedHand) => { const m = /^PF: ([^|]*)/.exec(h.sum || ''); return m ? m[1].split(', ') : null; };
const actOf = (a: string) => (a[0] === 'r' ? 'raise' : a[0] === 'c' ? 'call' : a[0] === 'f' ? 'fold' : null);
const isFold = (x: string) => / f$/.test(x);

export function spotsFor(mode: Mode, hands: ParsedHand[] = psAll()): Spot[] {
  const out: Spot[] = [];
  for (let h of hands) {
    if (!h.n || h.n < 2 || !h.sum) continue;
    const t0 = preTokens(h);
    if (!t0) continue;
    const t = t0.map((x) => (h.n === 2 ? x.replace(/^SB /, 'BTN ') : x));
    h = { ...h, pos: h.n === 2 && h.pos === 'SB' ? 'BTN' : h.pos };
    const hi = t.findIndex((x) => x.startsWith('Hero '));
    if (hi < 0) continue;
    const before = t.slice(0, hi), ha = t[hi].slice(5).trim();
    const best = (s: RangeSet) => (s.r.has(h.h) ? 'raise' : s.c.has(h.h) ? 'call' : 'fold');
    if (mode === 'open') {
      if (h.pos === 'BB' || !(h.st >= 15) || before.some((x) => !isFold(x))) continue;
      const sets = spotSets('open', h.pos, null, h.n); const a = actOf(ha);
      if (!sets || !a) continue;
      out.push({ h, sets, act: a === 'call' ? 'limp' : a, best: sets.r.has(h.h) ? 'raise' : 'fold' });
    } else if (mode === 'vsopen') {
      if (!(h.st >= 20)) continue;
      const rs = before.filter((x) => !isFold(x));
      if (rs.length !== 1) continue;
      const m = /^(\S+) r([\d.]+)$/.exec(rs[0]);
      if (!m || +m[2] > 4) continue;
      const sets = spotSets('vsopen', h.pos, m[1], h.n); const a = actOf(ha);
      if (!sets || !a) continue;
      out.push({ h, sets, act: a, raiser: m[1], best: best(sets) });
    } else if (mode === 'allin') {
      const rs = before.filter((x) => !isFold(x));
      if (rs.length !== 1) continue;
      const m = /^(\S+) r([\d.]+) AI$/.exec(rs[0]);
      if (!m) continue;
      const eff = Math.min(+m[2], h.st), sets = spotSets('allin', h.pos, m[1], h.n, bucketOf(eff)); const a = actOf(ha);
      if (!sets || !a) continue;
      out.push({ h, sets, act: a === 'fold' ? 'fold' : 'raise', raiser: `${m[1]} ${Math.round(eff)} BB`, best: sets.r.has(h.h) ? 'raise' : 'fold' });
    } else {
      if (!(h.st >= 25) || h.pos === 'BB' || before.some((x) => !isFold(x)) || ha[0] !== 'r') continue;
      const rest = t.slice(hi + 1), h2 = rest.findIndex((x) => x.startsWith('Hero '));
      if (h2 < 0) continue;
      const raises = rest.slice(0, h2).filter((x) => / r[\d.]+/.test(x));
      if (raises.length !== 1 || /AI$/.test(raises[0])) continue;
      const sets = spotSets('vs3b', h.pos, null, h.n); const a = actOf(rest[h2].slice(5).trim());
      if (!sets || !a) continue;
      out.push({ h, sets, act: a, best: best(sets) });
    }
  }
  return out;
}

export function renderRangeCompare() {
  const el = $('rg-mine'), W = MODE_WORDS[rgMode], spots = spotsFor(rgMode);
  const word = (a: string) => (a === 'raise' ? W.r : a === 'call' ? W.c : a === 'limp' ? 'Limp' : 'Fold');
  const desc = { allin: 'Spots where exactly one player went all-in before you and everyone else folded.', open: 'Spots where everyone before you folded and you had 15 BB or more.', vsopen: 'Spots where exactly one player raised to 4 BB or less before you, everyone else folded, and you had 20 BB or more.', vs3b: 'Spots where you opened with 25 BB or more and one player re-raised (not all-in).' }[rgMode];
  if (!spots.length) { el.innerHTML = `<p class="note">No matching spots in your hands yet. ${esc(desc)}</p>`; return; }
  const ok = spots.filter((s) => s.act === s.best), bad = spots.filter((s) => s.act !== s.best);
  const loose = spots.filter((s) => (s.act === 'raise' && s.best !== 'raise') || (s.act === 'call' && s.best === 'fold') || s.act === 'limp').length;
  const tight = spots.filter((s) => (s.act === 'fold' && s.best !== 'fold') || (s.act === 'call' && s.best === 'raise')).length;
  const row = (s: Spot) => `<tr><td>${cardsHTML(s.h.c)}</td><td class="mono">${esc(s.h.h)}</td><td><b>${esc(s.h.pos)}</b>${s.raiser ? ` <span class="muted">vs ${esc(s.raiser)}</span>` : ''}</td><td class="mono">${s.h.st} BB</td><td>You: ${esc(word(s.act).toLowerCase())} · chart: <b>${esc(word(s.best).toLowerCase())}</b></td></tr>`;
  const stat = (l: string, v: string) => `<div class="stat"><span class="label">${l}</span><span class="v">${v}</span></div>`;
  el.innerHTML = `<div class="stats">${stat('Spots', String(spots.length))}${stat('Matched chart', pct(ok.length / spots.length, 0))}${stat('Too loose', String(loose))}${stat('Too tight', String(tight))}</div><p class="note">${esc(desc)}</p>` +
    (bad.length ? `<div class="tablewrap"><table><tr><th>Hand</th><th></th><th>Seat</th><th>Stack</th><th>Decision</th></tr>${bad.slice(0, 15).map(row).join('')}</table></div>${bad.length > 15 ? `<p class="note">Showing 15 of ${bad.length}.</p>` : ''}` : '<p>Every decision matched the chart.</p>');
}

export function initRanges() {
  $('rg-stacks').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-rgs]'); if (!b) return; rgStack = +b.dataset.rgs! as Bucket; saveRg(); renderRanges(); });
  $('rg-raisers').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-rgr]'); if (!b) return; rgRaiser = b.dataset.rgr!; saveRg(); renderRanges(); });
  $$('[data-rgm]').forEach((b) => b.addEventListener('click', () => { rgMode = b.dataset.rgm as Mode; fixState(); saveRg(); renderRanges(); newRgDrill(); renderRangeCompare(); }));
  $$('[data-rgn]').forEach((b) => b.addEventListener('click', () => { rgN = +b.dataset.rgn!; fixState(); saveRg(); renderRanges(); newRgDrill(); renderRangeCompare(); }));
  $('rgd-raise').addEventListener('click', () => answer('raise'));
  $('rgd-call').addEventListener('click', () => answer('call'));
  $('rgd-fold').addEventListener('click', () => answer('fold'));
  $('rgd-next').addEventListener('click', newRgDrill);
  renderRanges(); newRgDrill(); renderRangeCompare();
}
