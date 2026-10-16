import { store } from '../storage/db';
import { $, confirmer, esc, gbp, onClick, pct, todayISO } from '../ui/dom';

interface Result { id: string; date: string; format: string; name: string; buyIn: number; prize: number; entries: number | null; finish: number | null; notes: string; created: string }

const del = confirmer();
export const getResults = () => store.list<Result>('results');

function renderChart(rs: Result[]) {
  const el = $('r-chart');
  if (rs.length < 2) { el.innerHTML = '<p class="note">The graph appears once you have two results.</p>'; return; }
  let c = 0;
  const pts = [0, ...rs.map((r) => (c += (+r.prize || 0) - (+r.buyIn || 0)))];
  const W = 640, H = 200, L = 56, R = 12, T = 12, B = 26;
  let mn = Math.min(0, ...pts), mx = Math.max(0, ...pts);
  if (mx === mn) mx += 1;
  const x = (i: number) => L + ((W - L - R) * i) / (pts.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - (v - mn) / (mx - mn));
  const line = pts.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const last = pts[pts.length - 1];
  el.innerHTML = `<div class="tablewrap"><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:100%;display:block" role="img" aria-label="Cumulative profit">
    <line x1="${L}" x2="${W - R}" y1="${y(mx)}" y2="${y(mx)}" stroke="var(--line)" stroke-dasharray="3 4"/>
    <line x1="${L}" x2="${W - R}" y1="${y(mn)}" y2="${y(mn)}" stroke="var(--line)" stroke-dasharray="3 4"/>
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)"/>
    <path d="${area}" fill="var(--accent)" fill-opacity=".14"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="${x(pts.length - 1)}" cy="${y(last)}" r="4.5" fill="var(--accent)"/>
    <text x="${L - 8}" y="${y(mx) + 4}" text-anchor="end">${gbp(Math.round(mx))}</text>
    ${mn < 0 ? `<text x="${L - 8}" y="${y(mn) + 4}" text-anchor="end">${gbp(Math.round(mn))}</text>` : ''}
    <text x="${L - 8}" y="${y(0) + 4}" text-anchor="end">£0</text>
    <text x="${L}" y="${H - 6}">start</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end">event ${pts.length - 1}</text></svg></div>`;
}

export function renderResults() {
  const rs = getResults().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const n = rs.length, inv = rs.reduce((a, r) => a + (+r.buyIn || 0), 0), won = rs.reduce((a, r) => a + (+r.prize || 0), 0), profit = won - inv;
  const itm = rs.filter((r) => +r.prize > 0).length;
  const split = (f: string) => {
    const x = rs.filter((r) => r.format === f);
    const i = x.reduce((a, r) => a + (+r.buyIn || 0), 0), w = x.reduce((a, r) => a + (+r.prize || 0), 0);
    return x.length ? pct((w - i) / (i || 1), 0) + ' · ' + x.length : '–';
  };
  const stat = (l: string, v: string, style = '') => `<div class="stat"><span class="label">${l}</span><span class="v"${style ? ` style="${style}"` : ''}>${v}</span></div>`;
  $('r-stats').innerHTML =
    stat('Events', String(n)) + stat('Invested', gbp(inv)) + stat('Profit', gbp(profit), `color:var(${profit >= 0 ? '--good' : '--bad'})`) +
    stat('ROI', inv ? pct(profit / inv, 0) : '–') + stat('In the money', n ? pct(itm / n, 0) : '–') +
    stat('Live ROI · events', split('Live'), 'font-size:18px') + stat('Online ROI · events', split('Online'), 'font-size:18px');
  renderChart(rs);
  const list = $('r-list');
  if (!n) { list.innerHTML = '<div class="empty">No results yet. Add your next tournament with the form above and your ROI, cash rate and profit graph fill in here.</div>'; return; }
  let h = '<div class="tablewrap"><table><tr><th>Date</th><th>Event</th><th>Format</th><th class="n">Buy-in</th><th class="n">Finish</th><th class="n">Won</th><th class="n">Profit</th><th>Notes</th><th></th></tr>';
  for (const r of rs.slice().reverse()) {
    const p = (+r.prize || 0) - (+r.buyIn || 0);
    const fin = r.finish ? r.finish + (r.entries ? ' / ' + r.entries : '') : '–';
    h += `<tr><td class="mono">${esc(r.date || '')}</td><td>${esc(r.name || '')}</td><td><span class="pill ${r.format === 'Live' ? 'live' : ''}">${esc(r.format || '')}</span></td><td class="n">${gbp(+r.buyIn || 0)}</td><td class="n">${esc(fin)}</td><td class="n">${gbp(+r.prize || 0)}</td><td class="n"><span class="pill ${p > 0 ? 'good' : p < 0 ? 'bad' : ''}">${gbp(p)}</span></td><td style="white-space:normal;min-width:180px;max-width:320px">${esc(r.notes || '')}</td><td><button class="small ghost" data-del="${esc(r.id)}">${del.is(r.id) ? 'Confirm delete' : 'Delete'}</button></td></tr>`;
  }
  list.innerHTML = h + '</table></div>';
}

export async function addResult(r: Omit<Result, 'id'>): Promise<void> { await store.add('results', r); }

export function initResults() {
  $('r-date').setAttribute('value', todayISO());
  ($('r-date') as HTMLInputElement).value = todayISO();
  $('r-banner').hidden = store.persistent;
  store.onChange('results', renderResults);
  onClick($('r-list'), 'button[data-del]', async (b) => {
    if (!del.click(b.dataset.del!)) { renderResults(); return; }
    try { await store.remove('results', b.dataset.del!); } catch { $('r-msg').textContent = "Couldn't delete that result. Try again."; }
  });
  $('r-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id: string) => $<HTMLInputElement>(id).value;
    const r = { date: v('r-date'), format: v('r-fmt'), name: v('r-name').trim(), buyIn: +v('r-buy') || 0, prize: +v('r-prize') || 0,
      entries: v('r-entries') ? +v('r-entries') : null, finish: v('r-finish') ? +v('r-finish') : null, notes: v('r-notes').trim(), created: new Date().toISOString() };
    const msg = $('r-msg');
    msg.textContent = '';
    if (!r.date || !r.name) { msg.textContent = 'Add a date and an event name.'; return; }
    if (r.finish && r.entries && r.finish > r.entries) { msg.textContent = "Your finish can't be larger than the number of entrants."; return; }
    $<HTMLButtonElement>('r-add').disabled = true;
    try {
      await addResult(r);
      msg.textContent = 'Saved.';
      ['r-name', 'r-buy', 'r-entries', 'r-finish', 'r-notes'].forEach((id) => (($(id) as HTMLInputElement).value = ''));
      $<HTMLInputElement>('r-prize').value = '0';
    } catch { msg.textContent = "Couldn't save. Storage may be full or blocked."; }
    finally { $<HTMLButtonElement>('r-add').disabled = false; }
  });
  renderResults();
}
