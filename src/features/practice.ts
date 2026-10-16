import { type Feedback, PracticeHand, type PracticeRecord, SPOT_NAME } from '../poker/practice';
import { store } from '../storage/db';
import { $, $$, cardsHTML, esc, fmtChips, ls, pctR } from '../ui/dom';
import { drawTable } from '../ui/table';
import { askCoach } from './coachRun';

let G: PracticeHand | null = null;
let prN = ls.get<any>('pl-pr', null)?.n >= 2 ? ls.get<any>('pl-pr', { n: 9 }).n : 9;

export const getPracticeRecords = () => store.list<PracticeRecord & { id: string }>('practice');
const bestOf = (fr: Record<string, number> | undefined) => Object.keys(fr || {}).reduce((a, k) => ((fr![k] > (fr![a] ?? -1)) ? k : a), '');

export function prDecisions() {
  return getPracticeRecords().sort((a, b) => (b.created || '').localeCompare(a.created || ''))
    .flatMap((h) => (h.decisions || []).map((d, k) => ({ hand: h, k, ...d })));
}

const PR_COL: Record<string, string> = { raise: 'var(--accent)', call: 'var(--gold)', check: 'var(--gold)', fold: 'var(--line)' };
function freqBar(fr: Record<string, number>, labels: Record<string, string>) {
  const keys = Object.keys(fr);
  return `<div class="bar" style="height:16px">${keys.filter((k) => fr[k] > 0).map((k) => `<span style="width:${fr[k]}%;background:${PR_COL[k]}" title="${esc(labels[k])} ${fr[k]}%"></span>`).join('')}</div>` +
    `<div class="row" style="gap:12px;font-size:13px">${keys.map((k) => `<span><span class="swatch" style="background:${PR_COL[k]}"></span>${esc(labels[k])} <b class="mono">${fr[k]}%</b></span>`).join('')}</div>`;
}

export function fbHTML(f: Pick<Feedback, 'cls' | 'street' | 'spot' | 'verdict' | 'label' | 'fr' | 'labels' | 'eq' | 'need' | 'why'>) {
  return `<div class="verdict ${f.cls === 'good' ? 'good' : f.cls === 'bad' ? 'bad' : ''}" style="gap:8px"><div class="row" style="justify-content:space-between;align-items:center"><span class="label">${esc((f.street === 'pre' ? 'Preflop' : f.street[0].toUpperCase() + f.street.slice(1)) + ' · ' + (SPOT_NAME[f.spot] || ''))}</span><span class="pill ${f.cls}">${esc(f.verdict)}</span></div>` +
    `<div><b>You:</b> ${esc(f.label)}</div>${freqBar(f.fr, f.labels)}` +
    (f.eq != null ? `<div class="note" style="margin:0">Your equity ${pctR(f.eq)}${f.need != null ? ' · needed to call ' + pctR(f.need) : ''}</div>` : '') +
    `<p style="margin:0">${esc(f.why)}</p></div>`;
}

export function prScoreText() {
  const recs = getPracticeRecords(), decs = recs.flatMap((h) => h.decisions || []), tot = decs.length;
  const best = decs.filter((d) => d.cls === 'good').length, fine = decs.filter((d) => d.cls === 'live').length, miss = decs.filter((d) => d.cls === 'bad').length;
  const net = recs.reduce((a, h) => a + (h.net || 0), 0);
  return `${recs.length} hand${recs.length === 1 ? '' : 's'} · ${tot} decision${tot === 1 ? '' : 's'}${tot ? ` · ${pctR(best / tot)} best, ${pctR(fine / tot)} fine, ${miss} mistake${miss === 1 ? '' : 's'}` : ''} · ${net >= 0 ? '+' : '−'}${Math.abs(net).toFixed(1)} big blinds`;
}

function drawPrTable(P: PracticeHand) {
  const T = $('pr-table'), N = P.n;
  const inFront = P.players.reduce((a, p) => a + p.st, 0), middle = P.potTotal() - inFront;
  drawTable(T, P.players.map((p, i) => ({
    name: p.hero ? 'You' : p.name, pos: N === 2 && p.pos === 'BTN' ? 'BTN/SB' : p.pos, me: p.hero, out: !p.in, hl: P.lastAgg === i && !P.done, dealer: p.pos === 'BTN',
    cards: p.hero ? p.cards : p.in ? (P.shown ? p.cards : 'back') : null, stack: fmtChips(P.stk(p) * P.chip),
    bet: p.st > 0 ? fmtChips(p.st * P.chip) : '', state: !p.in ? 'Folded' : p.allin ? 'All-in' : p.acted || '',
  })), P.hi, {
    pot: middle > 0.001 ? 'Pot ' + fmtChips(middle * P.chip) : '', board: P.board,
    total: inFront > 0 && middle > 0.001 ? 'Total ' + fmtChips(P.potTotal() * P.chip) : '',
  });
}

export function prRender() {
  const P = G;
  if (!P) return;
  $$('[data-prn]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.prn! === prN)));
  $('pr-score').textContent = prScoreText();
  const h = P.hero;
  $('pr-title').textContent = `${P.n === 2 ? 'Heads-up' : P.n + ' players'} · ${P.n === 2 && h.pos === 'BTN' ? 'Button' : h.pos}`;
  $('pr-stacks').textContent = `Blinds ${fmtChips(P.chip / 2)} / ${fmtChips(P.chip)}`;
  drawPrTable(P);
  $('pr-spot').textContent = `You have ${fmtChips(P.stk(h) * P.chip)} chips${P.street === 'pre' ? ` (${Math.round(h.stack0)} big blinds).` : '.'}`;
  if (P.dec && !P.done) {
    $('pr-ask').textContent = P.dec.ask;
    $('pr-opts').innerHTML = P.dec.opts.map(([k, l], i) => `<button class="${i === 0 ? 'primary' : ''}" data-pra="${k}">${esc(l)}</button>`).join('');
    $('pr-end').innerHTML = '';
  } else {
    $('pr-ask').textContent = ''; $('pr-opts').innerHTML = '';
    const r = P.result || { net: 0, txt: '' };
    $('pr-end').innerHTML = `<div class="verdict ${r.net > 0 ? 'good' : r.net < 0 ? 'bad' : ''}"><b>${esc(r.txt)}</b><span class="mono">${r.net >= 0 ? '+' : '−'}${P.bbf1(Math.abs(r.net))}</span></div><div class="row"><button class="primary" id="pr-next">Next hand</button></div>`;
  }
  $('pr-fb').innerHTML = P.fb ? fbHTML(P.fb) : '<p class="note">Make your first decision to see feedback.</p>';
  const L = P.log.map((e) => e.t === 'h' ? fbHTML(e.fb) : e.t === 's' ? `<div style="font-weight:700;margin-top:4px">${esc(e.txt)}</div>` : `<div class="hhline">${esc(e.txt)}</div>`);
  $('pr-log').innerHTML = L.length ? L.join('') : "<p class=\"note\">Everyone's actions and your decisions appear here as the hand plays out.</p>";
}

function save(P: PracticeHand) {
  if (P.saved || !P.done) return;
  P.saved = true;
  const rec = P.record();
  if (rec) void store.set('practice', rec.id, rec).catch(() => {});
}

export function prNew() { G = PracticeHand.deal(prN); prRender(); }

function act(choice: string) {
  if (!G) return;
  G.act(choice);
  if (G.done) save(G);
  prRender();
}

/* ---------- practice record ---------- */
let clearArmed = false;
let openHand: string | null = null;

export function renderPrRecord() {
  const el = $('prr-body'), decs = prDecisions();
  if (!decs.length) { el.innerHTML = "<p class=\"note\">Play some practice hands. Each one is saved here so you can see which spots you get right and which you don't.</p>"; return; }
  const spots = Object.keys(SPOT_NAME).map((k) => { const x = decs.filter((d) => d.spot === k); return { k, n: x.length, best: x.filter((d) => d.cls === 'good').length, fine: x.filter((d) => d.cls === 'live').length, miss: x.filter((d) => d.cls === 'bad').length }; }).filter((s) => s.n);
  const mist = decs.filter((d) => d.cls === 'bad').slice(0, 12);
  const recent = getPracticeRecords().sort((a, b) => (b.created || '').localeCompare(a.created || '')).slice(0, 25);
  el.innerHTML = `<div class="tablewrap"><table><tr><th>Spot</th><th class="n">Decisions</th><th class="n">Best</th><th class="n">Fine</th><th class="n">Mistakes</th></tr>` +
    spots.map((s) => `<tr><td>${esc(SPOT_NAME[s.k])}</td><td class="n">${s.n}</td><td class="n">${pctR(s.best / s.n)}</td><td class="n">${pctR(s.fine / s.n)}</td><td class="n"><span class="pill ${s.miss / s.n > 0.3 ? 'bad' : s.miss ? 'live' : 'good'}">${s.miss}</span></td></tr>`).join('') + '</table></div>' +
    '<h3 style="margin-top:14px">Recent mistakes</h3>' + (mist.length ? '<div style="display:grid;gap:8px">' + mist.map((d) => { const b = bestOf(d.fr); return `<div class="item"><div class="row" style="gap:10px;align-items:center">${cardsHTML(d.hand.cards)}<b>${esc(d.hand.pos)}</b><span class="mono">${Math.round(d.hand.stackBB)} BB</span><span class="pill">${esc(SPOT_NAME[d.spot] || '')}</span>${d.board ? `<span class="mono">${esc(d.board)}</span>` : ''}</div><div>You: <b>${esc(d.label)}</b> (${(d.fr || {})[d.choice] || 0}%) · best: <b>${esc((d.labels || {})[b] || b)}</b> (${(d.fr || {})[b] || 0}%)</div><div class="note">${esc(d.why || '')}</div></div>`; }).join('') + '</div>' : '<p class="note">No mistakes yet.</p>') +
    '<h3 style="margin-top:14px">Hands</h3><div>' + recent.map((h) => `<details class="item"${openHand === h.id ? ' open' : ''} data-prh="${esc(h.id)}"><summary><span class="mono muted">${esc((h.created || '').slice(0, 16).replace('T', ' '))}</span>${cardsHTML(h.cards)}<b>${esc(h.pos)}</b><span class="mono">${h.n}-handed</span><span class="pill ${h.net > 0 ? 'good' : h.net < 0 ? 'bad' : ''}">${h.net >= 0 ? '+' : '−'}${Math.abs(h.net).toFixed(1)} BB</span>${(h.decisions || []).map((d) => `<span class="pill ${d.cls}" title="${esc(d.verdict)}">${esc(d.street === 'pre' ? 'P' : d.street[0].toUpperCase())}</span>`).join('')}</summary><div class="body">${(h.decisions || []).map((d) => fbHTML(d)).join('')}<div class="hhline">${esc((h.log || []).join(' · '))}</div><div class="note">${esc(h.result || '')}</div></div></details>`).join('') + '</div>';
}

/** Looks up a practice decision by lesson question id "P<handId>-<k>". */
export function prLookup(id: string) {
  const m = /^P(.+)-(\d+)$/.exec(String(id));
  if (!m) return null;
  const h = getPracticeRecords().find((x) => x.id === m[1]);
  return h ? { id, c: h.cards.replace(/\s+/g, ''), pos: h.pos, st: Math.round(h.stackBB) } : null;
}

export function practicePromptPart(): string {
  const decs = prDecisions();
  if (!decs.length) return '';
  const spots = Object.keys(SPOT_NAME).map((k) => { const x = decs.filter((d) => d.spot === k); return x.length ? `${SPOT_NAME[k]}: ${x.length} decisions, ${pctR(x.filter((d) => d.cls === 'good').length / x.length)} best, ${x.filter((d) => d.cls === 'bad').length} mistakes` : ''; }).filter(Boolean).join('; ');
  const cands = decs.filter((d) => d.cls !== 'good').slice(0, 25).map((d) => `P${d.hand.id}-${d.k} | ${d.hand.pos} | ${d.hand.cards.replace(/\s+/g, '')} | ${Math.round(d.hand.stackBB)} | practice ${d.hand.n}-handed | ${d.street === 'pre' ? 'preflop' : d.street + ' on ' + d.board}: ${d.ask || ''} | player chose ${d.label} (${(d.fr || {})[d.choice] || 0}%), best ${bestOf(d.fr)} (${(d.fr || {})[bestOf(d.fr)] || 0}%)`);
  return `\n\nPRACTICE TRAINER RESULTS (${getPracticeRecords().length} hands, scored by how often a strong player takes each action). By spot: ${spots}\nPRACTICE CANDIDATE DECISIONS for questions (id | position | cards | stack BB | game | spot and action before the decision | what they chose vs best):\n${cands.join('\n')}`;
}

export function initPractice() {
  $('pr-opts').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-pra]'); if (b) act(b.dataset.pra!); });
  $('pr-end').addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('#pr-next')) prNew(); });
  $$('[data-prn]').forEach((b) => b.addEventListener('click', () => { prN = +b.dataset.prn!; ls.set('pl-pr', { n: prN }); prNew(); }));
  $('prr-body').addEventListener('toggle', (e) => { const d = e.target as HTMLDetailsElement; if (d.dataset?.prh) openHand = d.open ? d.dataset.prh : openHand === d.dataset.prh ? null : openHand; }, true);
  $('prr-clear').addEventListener('click', async () => {
    const btn = $('prr-clear');
    if (!clearArmed) { clearArmed = true; btn.textContent = 'Confirm clear'; return; }
    clearArmed = false; btn.textContent = 'Clear history';
    await store.clear('practice');
    renderPrRecord(); prRender();
  });
  $('prr-analyse').addEventListener('click', () => {
    const decs = prDecisions();
    if (!decs.length) { $('prr-out').innerHTML = '<p class="note">Play some practice hands first.</p>'; return; }
    const spots = Object.keys(SPOT_NAME).map((k) => { const x = decs.filter((d) => d.spot === k); return x.length ? `${SPOT_NAME[k]}: ${x.length} decisions, ${pctR(x.filter((d) => d.cls === 'good').length / x.length)} best, ${x.filter((d) => d.cls === 'bad').length} mistakes` : ''; }).filter(Boolean).join('\n');
    const mist = decs.filter((d) => d.cls === 'bad').slice(0, 20).map((d) => `- ${d.hand.n}-handed, ${d.hand.pos}, ${Math.round(d.hand.stackBB)} BB, ${d.hand.cards}${d.board ? ', board ' + d.board : ''}. Spot: ${SPOT_NAME[d.spot] || d.spot}. Action before: ${d.ask || ''}. Player chose ${d.label} (${(d.fr || {})[d.choice] || 0}%); best was ${bestOf(d.fr)} (${(d.fr || {})[bestOf(d.fr)] || 0}%).`).join('\n');
    void askCoach(`Analyse this player's practice session in a poker trainer. Each decision was scored by how often a strong player takes that action.\n\nBy spot:\n${spots}\n\nMistakes:\n${mist}\n\nGive: ## Summary (what the numbers show), ## Biggest leaks (2-3, each with the pattern in their mistakes and exactly what to change), ## Rules to remember (3 short bullets), ## What to practise next.`, $('prr-out'), $<HTMLButtonElement>('prr-analyse'), null);
  });
  store.onChange('practice', () => { renderPrRecord(); if (G) $('pr-score').textContent = prScoreText(); });
  prNew();
  renderPrRecord();
}
