import { type Card, parseCards } from '../poker/cards';
import { type Sit, type Suggestion, coachHU, tourPostSuggestion, tourPreSuggestion } from '../poker/coachEngine';
import { type HUAct, type HUStart, type HUState, boardCards, liveText, opp, simulate } from '../poker/headsUp';
import { seatList, validRaisers } from '../poker/ranges';
import { store } from '../storage/db';
import { $, $$, $maybe, debounce, esc, fmtChips, ls, m2, ordinal, pct, pctR, todayISO } from '../ui/dom';
import { drawTable } from '../ui/table';

/* ---------- types ---------- */
interface Sess { id: string; status: 'active' | 'ended'; started: string; ended?: string; names: { h: string; v: string }; sb: number; bb: number; stacks: { h: number; v: number }; buyins: { h: number; v: number }; btn: 'h' | 'v'; n: number }
interface TourSeat { name: string; out: boolean; outAt?: number }
interface Tour { id: string; status: 'active' | 'ended'; created: string; ended?: string; name: string; seats: TourSeat[]; me: number; btn: number; stack: number; sb: number; bb: number; ante: number; buyin: number; startStack: number; n: number; place?: number; prize?: number }

let coachOn = ls.get('pl-coach-on', true);
{ const v = ls.raw('pl-coach'); if (v != null) coachOn = v === '1'; }

/* ---------- shared: suggestion box ---------- */
function suggHTML(s: Suggestion | null): string {
  if (!s) return '';
  const meter = s.eq != null ? `<div class="meter" title="Your equity"><span style="width:${Math.round(s.eq * 100)}%"></span>${s.need != null ? `<i style="left:calc(${Math.round(s.need * 100)}% - 1px)"></i>` : ''}</div><div class="note" style="margin:0">Your equity ${pctR(s.eq)}${s.need != null ? ' · needed to call ' + pctR(s.need) : ''}${s.range ? ' · their likely hands: ' + s.range : ''}</div>` : '';
  return `<div class="sugg"><span class="label">Coach suggests</span><span class="big">${esc(s.label)}</span>${meter}<p style="margin:0">${esc(s.why)}</p></div>`;
}
function setCoach(v: boolean) {
  coachOn = v;
  ls.setRaw('pl-coach', v ? '1' : '0');
  ['lv-coachon', 'lt-coachon'].forEach((id) => { const e = $maybe<HTMLInputElement>(id); if (e) e.checked = v; });
  $('lt-coachbody').hidden = !v;
  renderLive();
  if (tour) renderTour();
}

/* =====================================================================
   HEADS-UP CASH SESSION
   ===================================================================== */
let liveSess: Sess | null = null, liveActs: HUAct[] = [], liveStart: HUStart | null = null, liveSaving = false, liveEndConfirm = false;
let curHU: string | null = null, curT: string | null = null;
let coachKey: string | null = null, coachCache: Suggestion | null = null, liveLastSug: Suggestion | null = null;

const sessions = () => store.list<Sess>('sessions');
const saveLiveDraft = () => ls.set('pl-live', { sid: liveSess?.id, start: liveStart, acts: liveActs, cards: $<HTMLInputElement>('lv-cards').value, note: $<HTMLInputElement>('lv-note').value });
const loadLiveDraft = () => ls.get<any>('pl-live', null);

function newHandStart() {
  const s = liveSess!;
  liveStart = { id: String(Date.now()) + String(Math.floor(Math.random() * 90 + 10)), time: Date.now(), n: s.n, names: s.names, btn: s.btn, sb: s.sb, bb: s.bb, stacks: { h: s.stacks.h, v: s.stacks.v } };
  liveActs = [];
  $<HTMLInputElement>('lv-cards').value = ''; $<HTMLInputElement>('lv-note').value = '';
  saveLiveDraft();
}
function lvAct(a: HUAct) { liveActs.push(a); saveLiveDraft(); renderLive(); }

export function renderLive() {
  const active = !!(liveSess && liveSess.status === 'active');
  $('lv-setup').hidden = active; $('lv-play').hidden = !active;
  if (!active) return;
  if (!liveStart || liveStart.n !== liveSess!.n) newHandStart();
  const st = liveStart!, S = simulate(st, liveActs), nm = (p: 'h' | 'v') => st.names[p];
  $('lv-title').textContent = 'Hand ' + st.n;
  $('lv-blinds').textContent = `£${m2(st.sb)} / £${m2(st.bb)}`;
  drawLiveTable(st, S);
  $('lv-coachout').innerHTML = coachOn ? `<p class="note">${S.phase === 'act' ? esc(nm(S.toAct)) + ' to act.' : S.phase === 'done' ? 'Hand finished.' : 'Enter the next card to continue.'}</p>` : "<p class=\"note\">The coach is off. Switch it on to get suggestions when it's your turn.</p>";
  $('lv-log').innerHTML = S.log.length ? S.log.map((l) => `<div>${esc(l)}</div>`).join('') : `<div>Blinds posted. ${esc(nm(st.btn))} acts first.</div>`;
  $<HTMLButtonElement>('lv-undo').disabled = !liveActs.length;
  const A = $('lv-actions');
  const cardsVal = $<HTMLInputElement>('lv-cards').value;
  if (S.phase === 'act') {
    const p = S.toAct, m = S.maxComm, toCall = m - S.comm[p], stack = S.stacks[p], maxTo = S.comm[p] + stack;
    const oAll = S.stacks[opp(p)] === 0;
    const minTo = Math.min(maxTo, m + Math.max(S.lastRaise, st.bb));
    const pot = S.potNow, sizes: [string, number][] = [];
    if (!oAll && stack > toCall) {
      sizes.push(['Min', minTo]);
      const frac = (f: number) => Math.min(maxTo, Math.max(minTo, +(m + (pot + toCall) * f).toFixed(2)));
      if (S.street === 'pre' && m <= st.bb) { sizes.push(['2.5x', Math.min(maxTo, Math.max(minTo, +(st.bb * 2.5).toFixed(2)))]); sizes.push(['3x', Math.min(maxTo, Math.max(minTo, +(st.bb * 3).toFixed(2)))]); }
      else { sizes.push(['½ pot', frac(0.5)]); sizes.push(['¾ pot', frac(0.75)]); sizes.push(['Pot', frac(1)]); }
      sizes.push(['All-in', maxTo]);
    }
    const aggr = m === 0 ? 'Bet' : 'Raise to';
    let sug: Suggestion | null = null, coachMsg = '';
    if (coachOn && p === 'h') {
      const key = `${st.id}|${liveActs.length}|${cardsVal.trim()}`;
      if (key === coachKey) sug = coachCache; else { sug = coachHU(st, S, liveActs, cardsVal); coachKey = key; coachCache = sug; }
      if (!sug) coachMsg = "<p class=\"note\">Type your cards above to get the coach's suggestion.</p>";
    }
    liveLastSug = p === 'h' ? sug : null;
    if (sug && sug.amt && sug.act === 'raise') sug.amtUse = Math.max(minTo, Math.min(maxTo, sug.amt));
    if (coachOn && p === 'h') $('lv-coachout').innerHTML = sug ? suggHTML(sug) : coachMsg;
    A.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center"><h3>${esc(nm(p))} to act</h3><span class="mono muted">${S.street.replace('pre', 'preflop')}${toCall > 0 ? ` · £${m2(Math.min(toCall, stack))} to call` : ''}</span></div>` +
      `<div class="row">${toCall > 0 ? `<button data-lv="fold">Fold</button><button class="primary" data-lv="call">Call £${m2(Math.min(toCall, stack))}</button>` : '<button class="primary" data-lv="check">Check</button>'}</div>` +
      (sizes.length ? `<div class="row" style="align-items:end"><div class="field" style="flex:0 1 150px"><label class="label" for="lv-amt">${aggr} (£)</label><input type="number" id="lv-amt" step="0.01" min="${minTo}" max="${maxTo}" value="${sug && sug.amtUse ? sug.amtUse : sizes[Math.min(1, sizes.length - 1)][1]}"></div><button data-lv="raise">${aggr}</button></div>` +
        `<div class="row">${sizes.map(([l, v]) => `<button class="small ghost" data-lvamt="${v}">${l} £${m2(v)}</button>`).join('')}</div>` : '');
    if (sug) A.querySelectorAll<HTMLElement>('button[data-lv]').forEach((b) => b.classList.toggle('suggest', b.dataset.lv === sug!.act));
  } else if (S.phase === 'board') {
    const lab = { flop: 'Flop (3 cards)', turn: 'Turn', river: 'River' }[S.next!];
    A.innerHTML = `<h3>Deal the ${S.next}${S.runout ? ' (all-in, running it out)' : ''}</h3><div class="row" style="align-items:end"><div class="field" style="flex:0 1 200px"><label class="label" for="lv-boardin">${lab}</label><input class="mono" id="lv-boardin" placeholder="${S.next === 'flop' ? 'e.g. Qh 7c 2d' : 'e.g. 9s'}" autocomplete="off"></div><button class="primary" data-lv="board">Continue</button></div><span class="note" id="lv-boardmsg">Leave blank if you don't remember it.</span>`;
    setTimeout(() => $maybe('lv-boardin')?.focus(), 0);
  } else if (S.phase === 'showdown') {
    A.innerHTML = `<h3>Showdown</h3><div class="field" style="max-width:220px"><label class="label" for="lv-oppcards">${esc(nm('v'))}'s cards (if shown)</label><input class="mono" id="lv-oppcards" placeholder="e.g. Jd Jc" autocomplete="off"></div>` +
      `<div class="row"><button class="primary" data-lvsd="h">${esc(nm('h'))} won</button><button class="primary" data-lvsd="v">${esc(nm('v'))} won</button><button data-lvsd="split">Split pot</button></div>`;
  } else {
    const net = S.stacks.h - st.stacks.h, c = parseCards(cardsVal), hasCards = c.error === undefined && c.cards.length === 2;
    A.innerHTML = `<h3>${S.winner === 'split' ? 'Split pot' : esc(nm(S.winner as 'h' | 'v')) + ' wins £' + m2(S.pot)}</h3><p class="mono">${esc(nm('h'))}: ${net >= 0 ? '+' : '−'}£${m2(Math.abs(net))} this hand</p>` +
      (hasCards ? '' : '<p class="note" style="color:var(--bad)">Add your cards above so this hand counts in your stats.</p>') +
      `<div class="row"><button class="primary" data-lv="next"${liveSaving ? ' disabled' : ''}>Save and next hand</button></div>`;
  }
  renderLiveHist();
}

function drawLiveTable(st: HUStart, S: HUState) {
  const cur = (x: number) => '£' + m2(x), hp = parseCards($<HTMLInputElement>('lv-cards').value), op = parseCards(S.oppCards || '');
  const seat = (p: 'h' | 'v') => ({
    name: st.names[p], pos: st.btn === p ? 'BTN/SB' : 'BB', me: p === 'h', stack: cur(S.stacks[p]),
    cards: (p === 'h' ? (hp.cards && hp.cards.length === 2 ? hp.cards : 'back') : (op.cards && op.cards.length === 2 ? op.cards : 'back')) as Card[] | 'back',
    bet: S.comm[p] > 0 && S.phase !== 'done' ? cur(S.comm[p]) : '', dealer: st.btn === p, hl: S.phase === 'act' && S.toAct === p,
    state: S.phase === 'act' && S.toAct === p ? 'To act' : S.phase === 'done' ? (S.winner === p ? 'Wins' : S.winner === 'split' ? 'Split' : '') : S.stacks[p] === 0 ? 'All-in' : '',
  });
  const inFront = S.phase === 'done' ? 0 : S.comm.h + S.comm.v, middle = (S.phase === 'done' ? S.pot : S.potNow) - inFront;
  drawTable($('lv-table'), [seat('h'), seat('v')], 0, { pot: middle > 0 ? 'Pot ' + cur(middle) : '', board: boardCards(S), total: inFront > 0 && middle > 0 ? 'Total ' + cur(S.potNow) : '' });
}

function renderLiveHist() {
  if (!liveSess) return;
  const hs = store.list('livehands').filter((d) => d.sid === liveSess!.id).sort((a, b) => b.n - a.n);
  const buy = liveSess.buyins || { h: 0, v: 0 };
  const net = liveSess.stacks.h - (buy.h || 0);
  const ca = hs.reduce((a, d) => a + ((d.coach && d.coach.agree) || 0), 0), ct = hs.reduce((a, d) => a + ((d.coach && d.coach.total) || 0), 0);
  $('lv-sessnet').textContent = `${hs.length} hand${hs.length === 1 ? '' : 's'} · ${net >= 0 ? '+' : '−'}£${m2(Math.abs(net))}${ct ? ` · you matched the coach ${ca}/${ct}` : ''}`;
  $('lv-hist').innerHTML = hs.length ? `<div class="tablewrap"><table><tr><th>#</th><th>Cards</th><th class="n">Result</th><th>Note</th></tr>${hs.slice(0, 30).map((d) => `<tr><td class="mono">${d.n}</td><td class="mono">${esc(d.cards || '–')}</td><td class="n"><span class="pill ${d.net > 0 ? 'good' : d.net < 0 ? 'bad' : ''}">${d.net >= 0 ? '+' : '−'}£${m2(Math.abs(d.net))}</span></td><td style="white-space:normal">${esc(d.note || '')}</td></tr>`).join('')}</table></div>` : '<p class="note">Finished hands appear here.</p>';
}

async function saveLiveHand() {
  if (liveSaving || !liveSess || !liveStart) return;
  liveSaving = true; renderLive();
  const st = liveStart, cards = $<HTMLInputElement>('lv-cards').value.trim();
  const acts = liveActs.map((a) => (a.t === 'sd' ? { ...a, hero: cards } : a));
  const S2 = simulate(st, acts);
  const withSug = liveActs.filter((a): a is Extract<HUAct, { t: 'act' }> => a.t === 'act' && !!a.sug);
  const doc = { sid: liveSess.id, n: st.n, created: new Date().toISOString(), cards, note: $<HTMLInputElement>('lv-note').value.trim(), net: +(S2.stacks.h - st.stacks.h).toFixed(2), text: liveText(st, S2, cards), coach: { agree: withSug.filter((a) => a.sug === a.type).length, total: withSug.length } };
  const upd = { stacks: { h: +S2.stacks.h.toFixed(2), v: +S2.stacks.v.toFixed(2) }, btn: opp(st.btn), n: st.n + 1 };
  try {
    await store.add('livehands', doc);
    await store.update('sessions', liveSess.id, upd);
    liveSess = { ...liveSess, ...upd };
    liveStart = null; newHandStart();
  } catch { $('lv-endmsg').textContent = "Couldn't save that hand. Press Save again."; }
  finally { liveSaving = false; renderLive(); }
}

function adoptSessions() {
  const actives = sessions().filter((s) => s.status === 'active').sort((a, b) => (b.started || '').localeCompare(a.started || ''));
  const act = curHU === 'new' ? null : curHU ? actives.find((s) => s.id === curHU) || null : actives[0] || null;
  if (!act) { liveSess = null; renderLive(); renderSessions(); return; }
  const changed = !liveSess || liveSess.id !== act.id || liveSess.n !== act.n;
  liveSess = act;
  if (changed || !liveStart) {
    const d = loadLiveDraft();
    if (d && d.sid === act.id && d.start && d.start.n === act.n) { liveStart = d.start; liveActs = d.acts || []; $<HTMLInputElement>('lv-cards').value = d.cards || ''; $<HTMLInputElement>('lv-note').value = d.note || ''; }
    else if (!liveStart || liveStart.n !== act.n) liveStart = null;
  }
  renderLive(); renderSessions();
}

async function topUp(p: 'h' | 'v') {
  const x = +$<HTMLInputElement>('lv-topamt').value;
  if (!(x > 0) || !liveSess) return;
  if (liveActs.length) { $('lv-endmsg').textContent = 'Top up between hands, before any action.'; return; }
  const stacks = { h: liveSess.stacks.h, v: liveSess.stacks.v }, buy = { h: liveSess.buyins?.h ?? 0, v: liveSess.buyins?.v ?? 0 };
  stacks[p] = +(stacks[p] + x).toFixed(2); buy[p] = +(buy[p] + x).toFixed(2);
  try { await store.update('sessions', liveSess.id, { stacks, buyins: buy }); liveSess = { ...liveSess, stacks, buyins: buy }; liveStart = null; renderLive(); $<HTMLInputElement>('lv-topamt').value = ''; $('lv-endmsg').textContent = `Added £${m2(x)}.`; }
  catch { $('lv-endmsg').textContent = "Couldn't top up. Try again."; }
}

function initHU() {
  $('lv-actions').addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const amtB = t.closest<HTMLElement>('button[data-lvamt]');
    if (amtB) { const i = $maybe<HTMLInputElement>('lv-amt'); if (i) i.value = amtB.dataset.lvamt!; return; }
    const sd = t.closest<HTMLElement>('button[data-lvsd]');
    if (sd) { lvAct({ t: 'sd', winner: sd.dataset.lvsd as 'h' | 'v' | 'split', hero: $<HTMLInputElement>('lv-cards').value, opp: $maybe<HTMLInputElement>('lv-oppcards')?.value || '' }); return; }
    const b = t.closest<HTMLElement>('button[data-lv]');
    if (!b) return;
    const k = b.dataset.lv!;
    const sg = liveLastSug ? { sug: liveLastSug.act } : {};
    if (k === 'fold' || k === 'check' || k === 'call') { lvAct({ t: 'act', type: k, ...sg }); return; }
    if (k === 'raise') { const v = +($maybe<HTMLInputElement>('lv-amt')?.value || 0); if (!(v > 0)) return; lvAct({ t: 'act', type: 'raise', amt: v, ...sg }); return; }
    if (k === 'board') {
      const v = $<HTMLInputElement>('lv-boardin').value.trim(), S = simulate(liveStart!, liveActs), need = S.next === 'flop' ? 3 : 1;
      if (v) {
        const c = parseCards(v);
        if (c.error !== undefined || c.cards.length !== need) { $('lv-boardmsg').textContent = c.error ?? `Enter ${need} card${need > 1 ? 's' : ''}.`; return; }
        const used = [...(parseCards($<HTMLInputElement>('lv-cards').value).cards || []), ...(parseCards([S.board.flop, S.board.turn].filter(Boolean).join(' ').replace(/\?\?/g, '')).cards || [])];
        if (c.cards.some((x) => used.includes(x))) { $('lv-boardmsg').textContent = 'That card is already out.'; return; }
      }
      lvAct({ t: 'board', cards: v });
      return;
    }
    if (k === 'next') await saveLiveHand();
  });
  $('lv-undo').addEventListener('click', () => { liveActs.pop(); saveLiveDraft(); renderLive(); });
  $('lv-restart').addEventListener('click', () => { liveActs = []; saveLiveDraft(); renderLive(); });
  const cardsTimer = debounce(() => { const S = liveStart && simulate(liveStart, liveActs); if (S && (S.phase === 'done' || (coachOn && S.phase === 'act' && S.toAct === 'h'))) renderLive(); }, 300);
  $('lv-cards').addEventListener('input', () => { saveLiveDraft(); cardsTimer(); });
  $('lv-note').addEventListener('input', saveLiveDraft);
  $('lv-setup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id: string) => $<HTMLInputElement>(id).value;
    const me = v('lv-me').trim(), op = v('lv-opp').trim(), msg = $('lv-setupmsg');
    if (!me || !op || me.toLowerCase() === op.toLowerCase()) { msg.textContent = 'Enter two different names.'; return; }
    if (/[:[\]]/.test(me + op)) { msg.textContent = "Names can't contain : or brackets."; return; }
    const sb = +v('lv-sb'), bb = +v('lv-bb'), hs = +v('lv-mystack'), vs = +v('lv-oppstack');
    if (!(sb > 0 && bb >= sb && hs > 0 && vs > 0)) { msg.textContent = 'Check the blinds and stacks. The big blind must be at least the small blind.'; return; }
    const s = { status: 'active', started: new Date().toISOString(), names: { h: me, v: op }, sb, bb, stacks: { h: hs, v: vs }, buyins: { h: hs, v: vs }, btn: v('lv-firstbtn'), n: 1 };
    try {
      const id = await store.add('sessions', s);
      curHU = id; liveStart = null; msg.textContent = '';
      adoptSessions();
    } catch { msg.textContent = "Couldn't start the session. Try again."; }
  });
  $('lv-topme').addEventListener('click', () => void topUp('h'));
  $('lv-topopp').addEventListener('click', () => void topUp('v'));
  $('lv-end').addEventListener('click', async () => {
    if (!liveSess) return;
    if (!liveEndConfirm) { liveEndConfirm = true; $('lv-end').textContent = 'Confirm end session'; $('lv-endmsg').textContent = liveActs.length ? "The hand in progress won't be saved." : 'Your result will be added to Results.'; return; }
    liveEndConfirm = false; $('lv-end').textContent = 'End session';
    const s = liveSess, buy = (s.buyins || { h: 0 }).h || 0;
    const res = { date: todayISO(), format: 'Home game', name: 'Heads-up cash vs ' + s.names.v, buyIn: +buy.toFixed(2), prize: +s.stacks.h.toFixed(2), entries: 2, finish: null, notes: `${s.n - 1} hands recorded in Live session`, created: new Date().toISOString() };
    try {
      await store.update('sessions', s.id, { status: 'ended', ended: new Date().toISOString() });
      await store.add('results', res);
      liveSess = null; curHU = null; liveStart = null; liveActs = []; ls.del('pl-live');
      adoptSessions();
      $('lv-setupmsg').textContent = 'Session saved to Results.';
    } catch { $('lv-endmsg').textContent = "Couldn't end the session. Try again."; }
  });
}

/* =====================================================================
   LIVE TOURNAMENT TABLE
   ===================================================================== */
let lvMode: 'hu' | 'tour' = ls.raw('pl-lvmode') === 'tour' ? 'tour' : 'hu';
let tour: Tour | null = null, ltSel: number | null = null, ltAct: string | null = null, ltRes: string | null = null, ltSaving = false, ltEndConfirm = false;
let ltView: 'btn' | 'me' = ls.raw('pl-ltview') === 'me' ? 'me' : 'btn';
let ltSit: Sit | null = null, ltSitSeat: string | null = null, ltSitBB = 15, ltLimpers = 1, ltOpps = 1, ltLastPre: Suggestion | null = null, ltUserAct = false;

const tours = () => store.list<Tour>('tours');
const tourHandsAll = () => store.list('tourhands');
const activeSeats = (t: Tour) => t.seats.map((_, i) => i).filter((i) => !t.seats[i].out);
const nextActive = (t: Tour, i: number) => { const N = t.seats.length; for (let k = 1; k <= N; k++) { const j = (i + k) % N; if (!t.seats[j].out) return j; } return i; };

export function tourPositions(t: Tour) {
  const A = activeSeats(t), n = A.length, out: Record<number, string> = {};
  if (n < 2) return { labels: out, sb: null as number | null, bb: null as number | null, btn: A[0] };
  let btn = t.btn;
  if (t.seats[btn].out) btn = nextActive(t, btn);
  const b = A.indexOf(btn), labs = seatList(n), start = n === 2 ? b : (b + 3) % n;
  labs.forEach((l, i) => { out[A[(start + i) % n]] = l; });
  const sb = n === 2 ? btn : A[(b + 1) % n], bb = n === 2 ? A[(b + 1) % n] : A[(b + 2) % n];
  return { labels: out, sb, bb, btn };
}
function handsToBB(t: Tour): number | null {
  const A = activeSeats(t), n = A.length;
  if (n < 2) return null;
  const P = tourPositions(t);
  return (A.indexOf(t.me) - A.indexOf(P.bb!) + n) % n;
}
const myPos = (t: Tour) => { const P = tourPositions(t), n = activeSeats(t).length; return n === 2 && t.me === P.btn ? 'BTN' : P.labels[t.me] || ''; };

const saveTourDraft = () => ls.set('pl-tour', { id: tour?.id, n: tour?.n, cards: $<HTMLInputElement>('lt-cards').value, act: ltAct, res: ltRes, after: $<HTMLInputElement>('lt-after').value, note: $<HTMLInputElement>('lt-note').value });
const loadTourDraft = () => ls.get<any>('pl-tour', null);

function resetTourHand() {
  ltAct = null; ltRes = null; ltUserAct = false; ltSit = null; ltOpps = 1;
  ['lt-board', 'lt-pot'].forEach((id) => { const e = $maybe<HTMLInputElement>(id); if (e) e.value = ''; });
  const tc = $maybe<HTMLInputElement>('lt-tocall'); if (tc) tc.value = '0';
  const pb = $maybe<HTMLDetailsElement>('lt-postbox'); if (pb) pb.open = false;
  $<HTMLInputElement>('lt-cards').value = ''; $<HTMLInputElement>('lt-note').value = '';
  $<HTMLInputElement>('lt-after').value = tour ? String(tour.stack) : '';
  $('lt-msg').textContent = '';
  saveTourDraft();
}
async function saveTour(upd: Partial<Tour>) {
  tour = { ...tour!, ...upd };
  await store.update('tours', tour.id, upd);
}

function renderTourTable() {
  $$('[data-ltv]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ltv === ltView)));
  const t = tour!, P = tourPositions(t), A = activeSeats(t), hu = A.length === 2;
  const hp = parseCards($<HTMLInputElement>('lt-cards').value), bp = parseCards($<HTMLInputElement>('lt-board').value);
  const seats = t.seats.map((s, i) => ({
    name: i === t.me ? 'You' : s.name || 'Seat ' + (i + 1), pos: s.out ? '' : hu && P.labels[i] === 'BTN' ? 'BTN/SB' : P.labels[i] || '', me: i === t.me, out: !!s.out,
    stack: i === t.me ? fmtChips(t.stack) : '', cards: s.out ? null : i === t.me && hp.cards && hp.cards.length === 2 ? hp.cards : ('back' as const), state: s.out ? 'Out' : '',
    bet: s.out ? '' : i === P.sb && !hu ? fmtChips(t.sb) : i === P.btn && hu ? fmtChips(t.sb) : i === P.bb ? fmtChips(t.bb) : '', dealer: i === P.btn, sel: i === ltSel,
    onClick: () => { ltSel = ltSel === i ? null : i; renderTour(); },
  }));
  drawTable($('lt-table'), seats, ltView === 'btn' ? P.btn : t.me, {
    pot: `Blinds ${fmtChips(t.sb)} / ${fmtChips(t.bb)}${+t.ante ? ' · ante ' + fmtChips(t.ante) : ''}`, board: bp.cards && bp.error === undefined ? bp.cards.slice(0, 5) : [], total: `${A.length} of ${t.seats.length} left`,
  });
}

function renderSeatPanel() {
  const el = $('lt-seatpanel');
  if (ltSel == null) { el.hidden = true; return; }
  const s = tour!.seats[ltSel], me = ltSel === tour!.me;
  el.hidden = false;
  el.innerHTML = `<div class="row" style="align-items:end"><div class="field" style="flex:1 1 160px"><label class="label" for="lt-rename">Seat ${ltSel + 1}${me ? ' · you' : ''}</label><input id="lt-rename" value="${esc(s.name || '')}" placeholder="Name"></div><button class="small" data-lts="rename">Save name</button></div>` +
    `<div class="row">${me ? '' : s.out ? '<button class="small" data-lts="back">Bring back in</button>' : '<button class="small" data-lts="out" style="border-color:var(--bad);color:var(--bad)">Knocked out</button>'}${s.out ? '' : '<button class="small" data-lts="btn">Move button here</button>'}<button class="small ghost" data-lts="close">Close</button></div>`;
}

const LT_ACTS: [string, string][] = [['fold', 'Fold'], ['check', 'Check'], ['call', 'Call / limp'], ['raise', 'Raise'], ['reraise', 'Re-raise'], ['allin', 'All-in']];
const LT_RES: [string, string][] = [['folded', 'Folded'], ['won', 'Won'], ['lost', 'Lost'], ['split', 'Split']];
const LT_SITS: [Sit, string][] = [['folded', 'Folded to me'], ['limped', 'Someone limped'], ['raised', 'Someone raised'], ['allin', 'Someone went all-in'], ['3bet', 'I raised, got re-raised']];

function defaultAfter(): number {
  const t = tour!, P = tourPositions(t);
  if (ltAct === 'fold' || ltRes === 'folded') {
    let loss = 0;
    if (t.me === P.bb) loss = +t.bb + (+t.ante || 0);
    else if (t.me === P.sb) loss = +t.sb;
    return Math.max(0, t.stack - loss);
  }
  return t.stack;
}

function renderTour() {
  const tActs = tours().filter((x) => x.status === 'active').sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  const active = curT === 'new' ? null : curT ? tActs.find((x) => x.id === curT) || null : tActs[0] || null;
  if (active && (!tour || tour.id !== active.id || tour.n !== active.n || JSON.stringify(tour.seats) !== JSON.stringify(active.seats) || tour.btn !== active.btn || tour.stack !== active.stack || tour.bb !== active.bb)) {
    const fresh = !tour || tour.id !== active.id || tour.n !== active.n;
    tour = active;
    if (fresh) {
      const d = loadTourDraft();
      if (d && d.id === tour.id && d.n === tour.n) { ltAct = d.act; ltRes = d.res; $<HTMLInputElement>('lt-cards').value = d.cards || ''; $<HTMLInputElement>('lt-note').value = d.note || ''; $<HTMLInputElement>('lt-after').value = d.after !== '' && d.after != null ? d.after : String(tour.stack); }
      else resetTourHand();
    }
  }
  if (!active) tour = null;
  $('lt-setup').hidden = !!tour; $('lt-play').hidden = !tour;
  if (!tour) return;
  const t = tour, P = tourPositions(t), A = activeSeats(t), pos = P.labels[t.me] || '–';
  $('lt-title').textContent = (t.name ? t.name + ' · ' : '') + 'Hand ' + t.n;
  $('lt-left').textContent = `${A.length} of ${t.seats.length} left`;
  renderTourTable(); renderSeatPanel();
  $('lt-pos').textContent = A.length === 2 && t.me === P.btn ? 'BTN (SB)' : pos;
  $('lt-mystack').textContent = fmtChips(t.stack);
  $('lt-mybb').textContent = (t.stack / t.bb).toFixed(1) + ' BB';
  $('lt-blinds').textContent = fmtChips(t.sb) + ' / ' + fmtChips(t.bb) + (+t.ante ? ` (${fmtChips(t.ante)})` : '');
  const h = handsToBB(t);
  $('lt-bbin').textContent = h === 0 ? "You're in the big blind" : h != null ? `Big blind in ${h} hand${h > 1 ? 's' : ''}` : '';
  const bbNow = t.me === P.bb;
  $('lt-acts').innerHTML = LT_ACTS.filter(([k]) => k !== 'check' || bbNow).map(([k, l]) => `<button class="small" data-lta="${k}" aria-pressed="${ltAct === k}">${l}</button>`).join('');
  $('lt-res').innerHTML = LT_RES.map(([k, l]) => `<button class="small" data-ltr="${k}" aria-pressed="${ltRes === k}">${l}</button>`).join('');
  if (!$<HTMLInputElement>('lt-nsb').value) { $<HTMLInputElement>('lt-nsb').value = String(t.sb); $<HTMLInputElement>('lt-nbb').value = String(t.bb); $<HTMLInputElement>('lt-nante').value = String(t.ante || 0); }
  renderTourHist();
  renderTourCoach();
  renderSessions();
}

function renderTourCoach() {
  if (!tour) return;
  $<HTMLInputElement>('lt-coachon').checked = coachOn; $('lt-coachbody').hidden = !coachOn;
  if (!coachOn) return;
  const pos = myPos(tour), n = activeSeats(tour).length;
  $('lt-sit').innerHTML = LT_SITS.filter(([k]) => k !== 'folded' || pos !== 'BB').map(([k, l]) => `<button class="small" data-lsit="${k}" aria-pressed="${ltSit === k}">${l}</button>`).join('');
  const x = $('lt-sitx');
  if (ltSit === 'raised' || ltSit === 'allin') {
    const before = validRaisers(pos, n === 2 ? 2 : n);
    if (!ltSitSeat || !before.includes(ltSitSeat)) ltSitSeat = before[before.length - 1] || null;
    x.innerHTML = `<div class="field" style="flex:0 1 auto"><span class="label">Who?</span><div class="row">${before.map((p) => `<button class="small" data-lseat="${p}" aria-pressed="${p === ltSitSeat}">${p}</button>`).join('')}</div></div>` +
      (ltSit === 'allin' ? `<div class="field" style="flex:0 1 150px"><label class="label" for="lt-sitbb">All-in size (BB)</label><input type="number" id="lt-sitbb" min="1" step="0.5" value="${ltSitBB}"></div>` : '');
  } else if (ltSit === 'limped') {
    x.innerHTML = `<div class="field"><span class="label">How many limpers?</span><div class="row">${[1, 2, 3].map((k) => `<button class="small" data-llimp="${k}" aria-pressed="${k === ltLimpers}">${k}${k === 3 ? '+' : ''}</button>`).join('')}</div></div>`;
  } else x.innerHTML = '';
  $('lt-opps').innerHTML = [1, 2, 3].map((k) => `<button class="small" data-lopp="${k}" aria-pressed="${k === ltOpps}">${k}${k === 3 ? '+' : ''}</button>`).join('');
  if (!$<HTMLInputElement>('lt-pot').value) $<HTMLInputElement>('lt-pot').value = String(Math.round(tour.bb * 2.5 + tour.sb + tour.bb + (+tour.ante || 0)));
  ltLastPre = tourPre();
  $('lt-preout').innerHTML = ltLastPre ? suggHTML(ltLastPre) : '<p class="note">Enter your cards and pick what happened before you to get a suggestion.</p>';
  renderTourPost();
  $$('#lt-acts button').forEach((b) => b.classList.toggle('suggest', !!ltLastPre && b.dataset.lta === ltLastPre.act));
}

function tourPre(): Suggestion | null {
  if (!tour) return null;
  return tourPreSuggestion({
    cards: $<HTMLInputElement>('lt-cards').value, sit: ltSit, pos: myPos(tour), n: activeSeats(tour).length, myBB: tour.stack / tour.bb,
    sitSeat: ltSitSeat, sitBB: +($maybe<HTMLInputElement>('lt-sitbb')?.value || 0) || ltSitBB, limpers: ltLimpers,
  });
}

function renderTourPost() {
  const out = $('lt-postout'), hp = parseCards($<HTMLInputElement>('lt-cards').value), bp = parseCards($<HTMLInputElement>('lt-board').value);
  if (hp.error !== undefined || hp.cards.length !== 2) { out.innerHTML = '<p class="note">Enter your cards first.</p>'; return; }
  if (bp.error !== undefined || bp.cards.length < 3 || bp.cards.length > 5) { out.innerHTML = '<p class="note">Enter the flop (3 cards), and the turn and river as they come.</p>'; return; }
  const hero = hp.cards, bd = bp.cards;
  if (new Set(hero.concat(bd)).size !== hero.length + bd.length) { out.innerHTML = '<p class="note">The same card appears twice.</p>'; return; }
  const s = tourPostSuggestion({
    hero, board: bd, pos: myPos(tour!), n: activeSeats(tour!).length, sit: ltSit, sitSeat: ltSitSeat,
    heroRaised: (!!ltLastPre && ['raise', 'reraise'].includes(ltLastPre.act)) || ['raise', 'reraise'].includes(ltAct || ''),
    toCall: +$<HTMLInputElement>('lt-tocall').value || 0, pot: +$<HTMLInputElement>('lt-pot').value || 0, opps: ltOpps, bb: tour!.bb,
  });
  out.innerHTML = suggHTML(s) + '<p class="note">Assumes they play like the charts. After the flop it only knows how many bets you enter, so trust your read on the player too.</p>';
}

function applyTourSug() {
  if (ltLastPre && !ltUserAct) {
    ltAct = ltLastPre.act;
    if (ltAct === 'fold') { ltRes = 'folded'; $<HTMLInputElement>('lt-after').value = String(defaultAfter()); }
    else if (ltRes === 'folded') { ltRes = null; $<HTMLInputElement>('lt-after').value = String(tour!.stack); }
    renderTour();
  }
}

function renderTourHist() {
  if (!tour) return;
  const hs = tourHandsAll().filter((h) => h.tid === tour!.id).sort((a, b) => a.n - b.n);
  const played = hs.filter((h) => h.act && h.act !== 'fold' && h.act !== 'check'), raised = hs.filter((h) => ['raise', 'reraise', 'allin'].includes(h.act));
  const withAct = hs.filter((h) => h.act), cs = hs.filter((h) => h.sug && h.act);
  $('lt-sum').textContent = `${hs.length} hands${withAct.length ? ` · VPIP ${pct(played.length / withAct.length, 0)} · PFR ${pct(raised.length / withAct.length, 0)}` : ''}${cs.length ? ` · matched the coach ${cs.filter((h) => h.sug === h.act).length}/${cs.length}` : ''}`;
  const pts = [tour.startStack / (hs[0] ? hs[0].bb : tour.bb)].concat(hs.map((h) => h.after / h.bb));
  if (pts.length >= 3) {
    const W = 640, H = 150, L = 44, R = 12, T = 10, B = 22, mx = Math.max(...pts) * 1.05, mn = 0;
    const x = (i: number) => L + ((W - L - R) * i) / (pts.length - 1), y = (v: number) => T + (H - T - B) * (1 - (v - mn) / (mx - mn || 1));
    const line = pts.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    $('lt-chart').innerHTML = `<div class="tablewrap"><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:100%;display:block" role="img" aria-label="Your stack in big blinds"><line x1="${L}" x2="${W - R}" y1="${y(15)}" y2="${y(15)}" stroke="var(--gold)" stroke-dasharray="3 4"/><text x="${L - 6}" y="${y(15) + 4}" text-anchor="end">15</text><text x="${L - 6}" y="${y(mx) + 10}" text-anchor="end">${Math.round(mx)}</text><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"/><circle cx="${x(pts.length - 1)}" cy="${y(pts[pts.length - 1])}" r="4" fill="var(--accent)"/><text x="${L}" y="${H - 5}">start</text><text x="${W - R}" y="${H - 5}" text-anchor="end">hand ${hs.length} · stack in BB</text></svg></div>`;
  } else $('lt-chart').innerHTML = '';
  const label = (k: string) => (LT_ACTS.find((x) => x[0] === k) || ['', ''])[1];
  $('lt-hist').innerHTML = hs.length ? `<div class="tablewrap"><table><tr><th>#</th><th>Seat</th><th>Cards</th><th>You</th><th>Result</th><th class="n">Stack</th><th>Note</th></tr>${hs.slice().reverse().slice(0, 40).map((h) => { const d = h.after - h.before; return `<tr><td class="mono">${h.n}</td><td><b>${esc(h.pos || '')}</b> <span class="muted">${h.players}</span></td><td class="mono">${esc(h.cards || '–')}</td><td>${esc(label(h.act) || '–')}</td><td>${esc((LT_RES.find((x) => x[0] === h.res) || ['', ''])[1] || '')}</td><td class="n">${fmtChips(h.after)} <span class="pill ${d > 0 ? 'good' : d < 0 ? 'bad' : ''}">${d >= 0 ? '+' : '−'}${fmtChips(Math.abs(d))}</span></td><td style="white-space:normal">${esc(h.note || '')}</td></tr>`; }).join('')}</table></div>` : '<p class="note">Hands you record appear here.</p>';
}

function initTour() {
  $$('[data-ltv]').forEach((b) => b.addEventListener('click', () => { ltView = b.dataset.ltv as 'btn' | 'me'; ls.setRaw('pl-ltview', ltView); renderTour(); }));
  $('lt-seatpanel').addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-lts]');
    if (!b || ltSel == null || !tour) return;
    const k = b.dataset.lts, seats = tour.seats.map((x) => ({ ...x }));
    try {
      if (k === 'close') ltSel = null;
      else if (k === 'rename') { seats[ltSel].name = $<HTMLInputElement>('lt-rename').value.trim().slice(0, 24); await saveTour({ seats }); }
      else if (k === 'out') { seats[ltSel].out = true; seats[ltSel].outAt = tour.n; await saveTour({ seats }); ltSel = null; $('lt-msg').textContent = `Knocked out. ${activeSeats(tour).length} players left.`; }
      else if (k === 'back') { seats[ltSel].out = false; delete seats[ltSel].outAt; await saveTour({ seats }); }
      else if (k === 'btn') { await saveTour({ btn: ltSel }); ltSel = null; }
    } catch { $('lt-msg').textContent = "Couldn't save that change. Try again."; }
    renderTour();
  });
  $('lt-acts').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-lta]');
    if (!b) return;
    ltAct = b.dataset.lta!; ltUserAct = true;
    if (ltAct === 'fold') { ltRes = 'folded'; $<HTMLInputElement>('lt-after').value = String(defaultAfter()); }
    else if (ltRes === 'folded') { ltRes = null; $<HTMLInputElement>('lt-after').value = String(tour!.stack); }
    saveTourDraft(); renderTour();
  });
  $('lt-res').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-ltr]');
    if (!b) return;
    ltRes = b.dataset.ltr!;
    if (ltRes === 'folded') $<HTMLInputElement>('lt-after').value = String(defaultAfter());
    saveTourDraft(); renderTour(); $('lt-after').focus();
  });
  ['lt-cards', 'lt-note', 'lt-after'].forEach((id) => $(id).addEventListener('input', saveTourDraft));
  const cardsTimer = debounce(() => { renderTourCoach(); if (ltLastPre && !ltUserAct) { ltAct = ltLastPre.act; if (ltAct === 'fold') { ltRes = 'folded'; $<HTMLInputElement>('lt-after').value = String(defaultAfter()); } renderTour(); } }, 300);
  $('lt-cards').addEventListener('input', () => { if (tour) renderTourTable(); cardsTimer(); });
  $('lt-coachon').addEventListener('change', (e) => setCoach((e.target as HTMLInputElement).checked));
  $('lv-coachon').addEventListener('change', (e) => setCoach((e.target as HTMLInputElement).checked));
  $('lt-sit').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-lsit]'); if (!b) return; ltSit = ltSit === b.dataset.lsit ? null : (b.dataset.lsit as Sit); renderTourCoach(); applyTourSug(); });
  $('lt-sitx').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const s = t.closest<HTMLElement>('button[data-lseat]');
    if (s) { ltSitSeat = s.dataset.lseat!; renderTourCoach(); applyTourSug(); return; }
    const l = t.closest<HTMLElement>('button[data-llimp]');
    if (l) { ltLimpers = +l.dataset.llimp!; renderTourCoach(); }
  });
  $('lt-sitx').addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (t.id === 'lt-sitbb') { ltSitBB = +t.value || ltSitBB; renderTourCoach(); } });
  $('lt-opps').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-lopp]'); if (!b) return; ltOpps = +b.dataset.lopp!; renderTourCoach(); });
  $('lt-board').addEventListener('input', () => { const b = parseCards($<HTMLInputElement>('lt-board').value); if (b.cards && b.cards.length >= 3) $<HTMLDetailsElement>('lt-postbox').open = true; if (tour) renderTourTable(); });
  const postTimer = debounce(renderTourPost, 250);
  ['lt-board', 'lt-pot', 'lt-tocall'].forEach((id) => $(id).addEventListener('input', postTimer));

  $('lt-next').addEventListener('click', async () => {
    if (!tour || ltSaving) return;
    const msg = $('lt-msg'), afterRaw = $<HTMLInputElement>('lt-after').value, after = afterRaw === '' ? tour.stack : +afterRaw;
    if (!(after >= 0)) { msg.textContent = 'Enter your stack after the hand.'; return; }
    const c = $<HTMLInputElement>('lt-cards').value.trim();
    if (c) { const p = parseCards(c); if (p.error !== undefined || p.cards.length !== 2) { msg.textContent = 'Your cards: ' + (p.error ?? 'enter two cards, like Ah Kd.'); return; } }
    const P = tourPositions(tour), A = activeSeats(tour);
    const hand = { tid: tour.id, n: tour.n, created: new Date().toISOString(), pos: A.length === 2 && tour.me === P.btn ? 'BTN' : P.labels[tour.me] || '', players: A.length, cards: c, act: ltAct || '', res: ltRes || (ltAct === 'fold' ? 'folded' : ''), before: tour.stack, after, bb: tour.bb, note: $<HTMLInputElement>('lt-note').value.trim(), board: $<HTMLInputElement>('lt-board').value || '', sit: ltSit || '', sitSeat: ltSitSeat || '', sitBB: +($maybe<HTMLInputElement>('lt-sitbb')?.value || 0) || ltSitBB, sug: ltLastPre ? ltLastPre.act : '' };
    ltSaving = true; $<HTMLButtonElement>('lt-next').disabled = true;
    try {
      await store.add('tourhands', hand);
      await saveTour({ stack: after, n: tour.n + 1, btn: nextActive(tour, P.btn) });
      resetTourHand();
      if (after === 0) { msg.textContent = "You're out. Fill in your finishing place and prize below, then press Finish tournament."; $<HTMLInputElement>('lt-place').value = String(A.length); $('lt-place').focus(); }
      else msg.textContent = `Saved hand ${hand.n}.`;
    } catch { msg.textContent = "Couldn't save that hand. Press Next hand again."; }
    finally { ltSaving = false; $<HTMLButtonElement>('lt-next').disabled = false; renderTour(); }
  });
  $('lt-blindsup').addEventListener('click', async () => {
    const sb = +$<HTMLInputElement>('lt-nsb').value, bb = +$<HTMLInputElement>('lt-nbb').value, an = +$<HTMLInputElement>('lt-nante').value || 0;
    if (!(sb > 0 && bb >= sb)) { $('lt-endmsg').textContent = 'The big blind must be at least the small blind.'; return; }
    try { await saveTour({ sb, bb, ante: an }); $('lt-endmsg').textContent = `Blinds updated to ${fmtChips(sb)} / ${fmtChips(bb)}.`; renderTour(); } catch { $('lt-endmsg').textContent = "Couldn't update the blinds."; }
  });
  $('lt-setup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id: string) => +$<HTMLInputElement>(id).value;
    const n = v('lt-players'), me = v('lt-myseat') - 1, btn = v('lt-btnseat') - 1, stack = v('lt-stack'), sb = v('lt-sb'), bb = v('lt-bb'), msg = $('lt-setupmsg');
    if (!(n >= 2 && n <= 10)) { msg.textContent = 'Players must be between 2 and 10.'; return; }
    if (!(me >= 0 && me < n) || !(btn >= 0 && btn < n)) { msg.textContent = `Seats must be between 1 and ${n}.`; return; }
    if (!(stack > 0 && sb > 0 && bb >= sb)) { msg.textContent = 'Check the stack and blinds.'; return; }
    const seats = Array.from({ length: n }, (_, i) => ({ name: i === me ? 'You' : '', out: false }));
    const t = { status: 'active', created: new Date().toISOString(), name: $<HTMLInputElement>('lt-name').value.trim(), seats, me, btn, stack, sb, bb, ante: v('lt-ante') || 0, buyin: v('lt-buyin') || 0, startStack: stack, n: 1 };
    try {
      const id = await store.add('tours', t);
      tour = null; curT = id;
      $<HTMLInputElement>('lt-nsb').value = ''; $<HTMLInputElement>('lt-place').value = ''; $<HTMLInputElement>('lt-prize').value = '0';
      resetTourHand(); renderTour(); msg.textContent = '';
    } catch { msg.textContent = "Couldn't start the tournament. Try again."; }
  });
  $('lt-end').addEventListener('click', async () => {
    if (!tour) return;
    const place = +$<HTMLInputElement>('lt-place').value, prize = +$<HTMLInputElement>('lt-prize').value || 0;
    if (!(place >= 1)) { $('lt-endmsg').textContent = 'Enter where you finished.'; $('lt-place').focus(); return; }
    if (!ltEndConfirm) { ltEndConfirm = true; $('lt-end').textContent = 'Confirm finish'; $('lt-endmsg').textContent = 'This saves the tournament to Results.'; return; }
    ltEndConfirm = false; $('lt-end').textContent = 'Finish tournament';
    const t = tour, hs = tourHandsAll().filter((h) => h.tid === t.id);
    const res = { date: todayISO(), format: 'Live', name: t.name || 'Live tournament', buyIn: t.buyin || 0, prize, entries: t.seats.length, finish: place, notes: `${hs.length} hands recorded in Live session`, created: new Date().toISOString() };
    try {
      await store.update('tours', t.id, { status: 'ended', ended: new Date().toISOString(), place, prize });
      await store.add('results', res);
      tour = null; curT = null; ls.del('pl-tour');
      renderTour(); $('lt-setupmsg').textContent = 'Tournament saved to Results.';
    } catch { $('lt-endmsg').textContent = "Couldn't save. Try again."; }
  });
}

/* =====================================================================
   mode switch + sessions list
   ===================================================================== */
function setLvMode(m: 'hu' | 'tour') { lvMode = m; ls.setRaw('pl-lvmode', m); renderLvMode(); }
function renderLvMode() {
  $$('[data-lvm]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lvm === lvMode)));
  $('lt-wrap').hidden = lvMode !== 'tour'; $('lv-hu').hidden = lvMode !== 'hu';
  if (lvMode === 'tour') renderTour();
  renderSessions();
}

let lvsConfirm: string | null = null, lvsOpen: string | null = null;
function sessionHandsHTML(r: { kind: string; id: string }) {
  if (r.kind === 'hu') {
    const hs = store.list('livehands').filter((h) => h.sid === r.id).sort((a, b) => a.n - b.n);
    return `<div style="display:grid;gap:4px">${hs.map((h) => `<div class="hhline">#${h.n} · ${esc(h.cards || '–')} · ${h.net >= 0 ? '+' : '−'}£${m2(Math.abs(h.net))}${h.note ? ' · ' + esc(h.note) : ''}</div>`).join('')}</div>`;
  }
  const hs = tourHandsAll().filter((h) => h.tid === r.id).sort((a, b) => a.n - b.n);
  return `<div style="display:grid;gap:4px">${hs.map((h) => `<div class="hhline">#${h.n} · ${esc(h.pos || '')} · ${esc(h.cards || '–')} · ${esc(h.act || '–')}${h.board ? ' · board ' + esc(h.board) : ''} · stack ${fmtChips(h.after)}${h.note ? ' · ' + esc(h.note) : ''}</div>`).join('')}</div>`;
}
function renderSessions() {
  const el = $maybe('lvs-list');
  if (!el) return;
  const liveHands = store.list('livehands'), tourHands = tourHandsAll();
  interface Row { kind: 'hu' | 'tour'; id: string; date: string; name: string; hands: number; active: boolean; result: string; good: boolean; bad: boolean; cur: boolean }
  const rows: Row[] = [];
  sessions().forEach((x) => { const hs = liveHands.filter((h) => h.sid === x.id); const net = (x.stacks?.h || 0) - (x.buyins?.h || 0); rows.push({ kind: 'hu', id: x.id, date: x.started || '', name: 'Heads-up vs ' + (x.names?.v || '?'), hands: hs.length, active: x.status === 'active', result: (net >= 0 ? '+' : '−') + '£' + m2(Math.abs(net)), good: net > 0, bad: net < 0, cur: !!(liveSess && liveSess.id === x.id && lvMode === 'hu') }); });
  tours().forEach((x) => { const hs = tourHands.filter((h) => h.tid === x.id); rows.push({ kind: 'tour', id: x.id, date: x.created || '', name: x.name || 'Live tournament', hands: hs.length, active: x.status === 'active', result: x.status === 'active' ? fmtChips(x.stack) + ' chips' : (x.place ? ordinal(x.place) + ' of ' + x.seats.length : 'Finished') + (x.prize ? ' · £' + m2(x.prize) : ''), good: (x.prize || 0) > 0, bad: false, cur: !!(tour && tour.id === x.id && lvMode === 'tour') }); });
  rows.sort((a, b) => Number(b.active) - Number(a.active) || b.date.localeCompare(a.date));
  if (!rows.length) { el.innerHTML = '<p class="note">No sessions yet. Start a heads-up game or a tournament above.</p>'; return; }
  el.innerHTML = '<div class="tablewrap"><table><tr><th>Started</th><th>Game</th><th class="n">Hands</th><th>Result</th><th></th></tr>' + rows.map((r) => {
    const key = r.kind + ':' + r.id;
    return `<tr><td class="mono">${esc(r.date.slice(0, 16).replace('T', ' '))}</td><td>${esc(r.name)} ${r.active ? `<span class="pill live">${r.cur ? 'Open now' : 'Playing'}</span>` : '<span class="pill">Finished</span>'}</td><td class="n">${r.hands}</td><td><span class="pill ${r.good ? 'good' : r.bad ? 'bad' : ''}">${esc(r.result)}</span></td><td><div class="row" style="gap:6px;flex-wrap:nowrap">${r.active && !r.cur ? `<button class="small" data-lvso="${key}">Open</button>` : ''}${r.hands ? `<button class="small ghost" data-lvsh="${key}">${lvsOpen === key ? 'Hide hands' : 'Hands'}</button>` : ''}<button class="small ghost" data-lvsd="${key}" style="color:var(--bad)">${lvsConfirm === key ? 'Confirm delete' : 'Delete'}</button></div></td></tr>` +
      (lvsOpen === key ? `<tr><td colspan="5" style="white-space:normal">${sessionHandsHTML(r)}</td></tr>` : '');
  }).join('') + '</table></div>';
}

function initSessions() {
  $('lvs-list').addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const o = t.closest<HTMLElement>('button[data-lvso]'), h = t.closest<HTMLElement>('button[data-lvsh]'), d = t.closest<HTMLElement>('button[data-lvsd]');
    if (o) { const [k, id] = o.dataset.lvso!.split(':'); if (k === 'hu') { curHU = id; setLvMode('hu'); adoptSessions(); } else { curT = id; tour = null; setLvMode('tour'); renderTour(); } return; }
    if (h) { lvsOpen = lvsOpen === h.dataset.lvsh ? null : h.dataset.lvsh!; renderSessions(); return; }
    if (!d) return;
    const key = d.dataset.lvsd!;
    if (lvsConfirm !== key) { lvsConfirm = key; renderSessions(); $('lvs-msg').textContent = 'This deletes the session and its hands from your tracker. Results already saved stay in My poker → Results.'; return; }
    lvsConfirm = null;
    const [k, id] = key.split(':');
    try {
      if (k === 'hu') {
        for (const x of store.list('livehands').filter((x) => x.sid === id)) await store.remove('livehands', x.id);
        await store.remove('sessions', id);
        if (curHU === id) curHU = null;
        if (liveSess && liveSess.id === id) { liveSess = null; liveStart = null; liveActs = []; ls.del('pl-live'); }
        adoptSessions();
      } else {
        for (const x of tourHandsAll().filter((x) => x.tid === id)) await store.remove('tourhands', x.id);
        await store.remove('tours', id);
        if (curT === id) curT = null;
        if (tour && tour.id === id) { tour = null; ls.del('pl-tour'); }
        renderTour();
      }
      $('lvs-msg').textContent = 'Session deleted.'; renderSessions();
    } catch { $('lvs-msg').textContent = "Couldn't delete everything. Try again."; }
  });
  $('lvs-newhu').addEventListener('click', () => { curHU = 'new'; setLvMode('hu'); adoptSessions(); $('lv-opp').focus(); });
  $('lvs-newt').addEventListener('click', () => { curT = 'new'; tour = null; setLvMode('tour'); renderTour(); $('lt-name').focus(); });
  $$('[data-lvm]').forEach((b) => b.addEventListener('click', () => setLvMode(b.dataset.lvm as 'hu' | 'tour')));
}

export function initLive() {
  initHU(); initTour(); initSessions();
  $<HTMLInputElement>('lv-coachon').checked = coachOn; $<HTMLInputElement>('lt-coachon').checked = coachOn; $('lt-coachbody').hidden = !coachOn;
  store.onChange('sessions', adoptSessions);
  store.onChange('tours', () => { if (lvMode === 'tour') renderTour(); else if (tours().some((x) => x.status === 'active') && !liveSess) setLvMode('tour'); });
  store.onChange('livehands', () => { renderLiveHist(); renderSessions(); });
  store.onChange('tourhands', () => { renderTourHist(); renderSessions(); });
  adoptSessions();
  renderLvMode();
  renderSessions();
}
