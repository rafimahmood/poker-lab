import { CAT, evalHand } from '../poker/evaluator';
import { deckWithout, parseCards, RANKS } from '../poker/cards';
import { equity } from '../poker/equity';
import { icm, icmCall } from '../poker/icm';
import { theoryNums } from '../poker/theory';
import { $, pct, showCards } from '../ui/dom';

/* ---------- equity calculator ---------- */

let eqRunning = false;
export function runEquity() {
  if (eqRunning) return;
  const H = parseCards($<HTMLInputElement>('e-hero').value), V = parseCards($<HTMLInputElement>('e-vill').value), B = parseCards($<HTMLInputElement>('e-board').value);
  const errEl = $('e-err');
  errEl.textContent = '';
  const err = H.error || V.error || B.error;
  if (err) { errEl.textContent = err; return; }
  const hero = H.cards!, vill = V.cards!, board = B.cards!;
  if (hero.length !== 2) { errEl.textContent = 'Your hand needs exactly 2 cards.'; return; }
  if (vill.length && vill.length !== 2) { errEl.textContent = "Villain's hand needs 2 cards, or leave it blank."; return; }
  if (![0, 3, 4, 5].includes(board.length)) { errEl.textContent = 'The board needs 0, 3, 4 or 5 cards.'; return; }
  const all = [...hero, ...vill, ...board];
  if (new Set(all).size !== all.length) { errEl.textContent = 'The same card appears twice.'; return; }
  showCards($('e-c-hero'), hero);
  showCards($('e-c-board'), board);
  const nOpp = vill.length ? 1 : +$<HTMLSelectElement>('e-opps').value;
  const TOTAL = 30000, CH = 2500;
  let done = 0, winSum = 0, tieSum = 0;
  const dist = new Array(9).fill(0);
  eqRunning = true;
  $<HTMLButtonElement>('e-run').disabled = true;
  const chunk = () => {
    const r = equity({ hero, villain: vill, board, opponents: nOpp, iterations: CH });
    winSum += r.win * CH; tieSum += r.tie * CH;
    r.dist.forEach((d, i) => (dist[i] += d * CH));
    done += CH;
    $('e-eq').textContent = pct((winSum + tieSum) / done);
    $('e-win').textContent = pct(winSum / done);
    $('e-tie').textContent = pct(tieSum / done);
    $('e-bar-w').style.width = pct(winSum / done);
    $('e-bar-t').style.width = pct(tieSum / done);
    $('e-meta').textContent = `Monte Carlo, ${done.toLocaleString('en-GB')} deals against ${vill.length ? "the villain's hand" : nOpp + ' random hand' + (nOpp > 1 ? 's' : '')}.`;
    let rows = '<tr><th>Hand</th><th class="n">How often</th></tr>';
    for (let c = 8; c >= 0; c--) if (dist[c]) rows += `<tr><td>${CAT[c]}</td><td class="n">${pct(dist[c] / done)}</td></tr>`;
    $('e-dist').innerHTML = rows;
    if (done < TOTAL) setTimeout(chunk, 0);
    else { eqRunning = false; $<HTMLButtonElement>('e-run').disabled = false; }
  };
  chunk();
}

/* ---------- bet sizing theory ---------- */

export function renderTheory() {
  const p = +$<HTMLInputElement>('t-size').value, b = p / 100, n = theoryNums(b);
  $('t-sizeval').textContent = p + '%';
  const stat = (l: string, v: string) => `<div class="stat"><span class="label">${l}</span><span class="v">${v}</span></div>`;
  $('t-stats').innerHTML =
    stat('Equity to call', pct(n.req)) + stat('Defend at least (MDF)', pct(n.mdf)) + stat('Bluff must work', pct(n.alpha)) +
    stat('Bluffs in river range', pct(n.bluff)) + stat('Value : bluff', ((1 + b) / b).toFixed(1) + ' : 1');
}
export function renderTheoryTable() {
  const sizes: [number, string][] = [[25, '¼ pot'], [33, '⅓ pot'], [50, '½ pot'], [66, '⅔ pot'], [75, '¾ pot'], [100, 'Pot'], [150, '1.5× pot'], [200, '2× pot']];
  let h = '<tr><th>Bet</th><th class="n">Equity to call</th><th class="n">MDF</th><th class="n">Bluff must work</th><th class="n">River bluffs</th></tr>';
  for (const [p, l] of sizes) {
    const n = theoryNums(p / 100);
    h += `<tr><td>${l}</td><td class="n">${pct(n.req)}</td><td class="n">${pct(n.mdf)}</td><td class="n">${pct(n.alpha)}</td><td class="n">${pct(n.bluff)}</td></tr>`;
  }
  $('t-table').innerHTML = h;
}

/* ---------- starting-hand heatmap ---------- */

interface Cell { d: HTMLElement; name: string; hand: [number, number] }
const heatCache: Record<string, number[]> = {};

function paintCell(c: Cell, v: number, nOpp: number) {
  const fair = 1 / (nOpp + 1);
  const t = Math.max(0, Math.min(1, (v - fair * 0.55) / (Math.min(0.86, fair * 2.6) - fair * 0.55)));
  const m = Math.round(8 + t * 88);
  c.d.style.background = `color-mix(in oklab, var(--accent) ${m}%, var(--surface))`;
  c.d.style.color = m > 55 ? 'var(--accent-fg)' : 'var(--fg)';
  c.d.innerHTML = `${c.name}<small>${Math.round(v * 100)}</small>`;
  c.d.title = `${c.name}: ${pct(v)} equity`;
}

let heatToken = 0;
export function runHeat() {
  const nOpp = +$<HTMLSelectElement>('h-opps').value;
  const grid = $('h-grid');
  const token = ++heatToken;
  const cells: Cell[] = [];
  grid.innerHTML = '';
  for (let i = 0; i < 13; i++)
    for (let j = 0; j < 13; j++) {
      const r1 = 12 - i, r2 = 12 - j;
      const d = document.createElement('div');
      let name: string, hand: [number, number];
      if (i === j) { name = RANKS[r1] + RANKS[r1]; hand = [r1 * 4, r1 * 4 + 1]; }
      else if (i < j) { name = RANKS[r1] + RANKS[r2] + 's'; hand = [r1 * 4 + 3, r2 * 4 + 3]; }
      else { name = RANKS[r2] + RANKS[r1] + 'o'; hand = [r2 * 4 + 3, r1 * 4 + 2]; }
      d.innerHTML = `${name}<small>…</small>`;
      d.style.background = 'var(--sunk)';
      grid.appendChild(d);
      cells.push({ d, name, hand });
    }
  const key = String(nOpp);
  if (heatCache[key]) { cells.forEach((c, k) => paintCell(c, heatCache[key][k], nOpp)); $('h-status').textContent = ''; return; }
  const vals = new Array<number>(169);
  let idx = 0;
  $('h-status').textContent = 'Calculating…';
  const ITER = 1500;
  const step = () => {
    if (token !== heatToken) return;
    const end = Math.min(idx + 6, 169);
    for (; idx < end; idx++) {
      const hand = cells[idx].hand, base = deckWithout(hand);
      let s = 0;
      for (let k = 0; k < ITER; k++) {
        let p = base.length;
        const draw = () => { const j = (Math.random() * p) | 0; const c = base[j]; base[j] = base[p - 1]; base[p - 1] = c; p--; return c; };
        const bd = [draw(), draw(), draw(), draw(), draw()];
        const hv = evalHand([...hand, ...bd]);
        let best = -1, cnt = 0;
        for (let o = 0; o < nOpp; o++) { const ov = evalHand([draw(), draw(), ...bd]); if (ov > best) { best = ov; cnt = 1; } else if (ov === best) cnt++; }
        if (hv > best) s++; else if (hv === best) s += 1 / (cnt + 1);
      }
      vals[idx] = s / ITER;
      paintCell(cells[idx], vals[idx], nOpp);
    }
    $('h-status').textContent = idx < 169 ? `Calculating… ${Math.round((idx / 169) * 100)}%` : '';
    if (idx < 169) setTimeout(step, 0); else heatCache[key] = vals;
  };
  step();
}

/* ---------- ICM ---------- */

function fillPlayerSelects(n: number) {
  const h = $<HTMLSelectElement>('i-hero'), v = $<HTMLSelectElement>('i-vill'), hv = h.value, vv = v.value;
  const opts = Array.from({ length: n }, (_, i) => `<option value="${i}">Player ${i + 1}</option>`).join('');
  h.innerHTML = opts; v.innerHTML = opts;
  h.value = hv && +hv < n ? hv : String(Math.min(2, n - 1));
  v.value = vv && +vv < n ? vv : '0';
}

export function runICM() {
  const err = $('i-err');
  err.textContent = '';
  const stacks = $<HTMLInputElement>('i-stacks').value.split(/[,\s]+/).filter(Boolean).map(Number);
  const pay = $<HTMLInputElement>('i-pay').value.split(/[,\s]+/).filter(Boolean).map(Number);
  if (stacks.some((x) => !(x > 0)) || stacks.length < 2) { err.textContent = 'Enter at least two stacks, all above zero.'; return; }
  if (stacks.length > 12) { err.textContent = 'Up to 12 players at a time.'; return; }
  if (!pay.length || pay.some((x) => !(x >= 0))) { err.textContent = 'Enter at least one payout.'; return; }
  fillPlayerSelects(stacks.length);
  const ev = icm(stacks, pay), totChips = stacks.reduce((a, b) => a + b, 0), totPay = pay.slice(0, stacks.length).reduce((a, b) => a + b, 0);
  let h = '<tr><th>Player</th><th class="n">Stack</th><th class="n">Chip share</th><th class="n">Prize equity</th><th class="n">Prize share</th></tr>';
  stacks.forEach((s, i) => { h += `<tr><td>Player ${i + 1}</td><td class="n">${s.toLocaleString('en-GB')}</td><td class="n">${pct(s / totChips)}</td><td class="n">£${ev[i].toFixed(2)}</td><td class="n">${pct(ev[i] / totPay)}</td></tr>`; });
  $('i-table').innerHTML = h;
  const hi = +$<HTMLSelectElement>('i-hero').value, vi = +$<HTMLSelectElement>('i-vill').value;
  if (hi === vi) { $('i-req').textContent = '–'; $('i-prem').textContent = '–'; $('i-explain').textContent = 'Pick two different players to price a call.'; return; }
  const c = icmCall(stacks, pay, hi, vi);
  $('i-req').textContent = pct(c.required);
  $('i-prem').textContent = (c.riskPremium >= 0 ? '+' : '−') + pct(Math.abs(c.riskPremium));
  $('i-explain').textContent = `Player ${vi + 1} shoves ${c.effective.toLocaleString('en-GB')} effective. Folding keeps £${c.fold.toFixed(2)}, winning takes you to £${c.win.toFixed(2)}, losing drops you to £${c.lose.toFixed(2)}. You need ${pct(c.required)} equity to call, against 50% in a cash game.`;
}

export function initTools() {
  $('e-run').addEventListener('click', runEquity);
  $('t-size').addEventListener('input', renderTheory);
  $('h-opps').addEventListener('change', runHeat);
  $('i-run').addEventListener('click', runICM);
  $('i-hero').addEventListener('change', runICM);
  $('i-vill').addEventListener('change', runICM);
  renderTheory(); renderTheoryTable(); runICM(); runEquity();
}
