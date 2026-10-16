import { explain, json } from '../ai/client';
import { parseCards, handClass } from '../poker/cards';
import { type ParsedHand, POS_ORDER, leaks, parseHandFile, stats as calcStats } from '../poker/handHistory';
import { store } from '../storage/db';
import { $, cardsHTML, confirmer, esc, fbb, fp, ls, onClick, pct, todayISO } from '../ui/dom';
import { askCoach, stopCoach } from './coachRun';
import { setStatsProvider } from './context';
import { type LiteHand, psAll, psLite } from './trackerData';

const del = confirmer();
const T = (id: string) => $(id);

/* ---------- stats digest the coach can read with get_my_stats ---------- */
export function statsDigest() {
  const hs = psAll();
  if (!hs.length) return undefined;
  const st = calcStats(hs);
  const round = (x: number | null, d = 3) => (x == null ? null : +x.toFixed(d));
  return {
    hands: st.n, vpip: round(st.vpip), pfr: round(st.pfr), open_limp: round(st.limp), three_bet: round(st.tb), aggression: round(st.af, 2),
    went_to_showdown: round(st.wtsd), won_at_showdown: round(st.wsd), bb_per_100: round(st.bb100, 1),
    by_position: POS_ORDER.filter((p) => hs.some((h) => h.pos === p)).map((p) => { const s = calcStats(hs.filter((h) => h.pos === p)); return { pos: p, hands: s.n, vpip: round(s.vpip), pfr: round(s.pfr) }; }),
    leaks: leaks(st, hs).map((l) => l.t),
  };
}

/* ---------- rendering ---------- */
export function renderStars() {
  const f = $<HTMLSelectElement>('ps-game').value;
  const all = psAll(), hs = f === 'all' ? all : all.filter((h) => h.g === f), st = calcStats(hs);
  const lite = psLite().filter((h) => f === 'all' || h.g === f), ln = T('ps-litenote');
  if (lite.length) {
    const known = lite.filter((h) => h.won != null), won = known.filter((h) => h.won).length;
    ln.hidden = false;
    ln.textContent = `Plus ${lite.length} hand${lite.length > 1 ? 's' : ''} from hand-list screenshots${known.length ? ', of which you won ' + won : ''}. Those only show cards and winners, so they aren't in the stats below. Screenshot the full hand text to include them.`;
  } else ln.hidden = true;
  const homeN = hs.filter((h) => h.home).length;
  const stat = (k: string, v: string) => `<div class="stat"><span class="label">${k}</span><span class="v">${v}</span></div>`;
  T('ps-stats').innerHTML =
    `<div class="stat"><span class="label">Hands stored</span><span class="v">${(st.n + lite.length).toLocaleString('en-GB')}</span><span class="note">${st.n} full${homeN ? ` (incl. ${homeN} live)` : ''}${lite.length ? ` · ${lite.length} from hand lists` : ''}</span></div>` +
    ([['VPIP', fp(st.vpip)], ['PFR', fp(st.pfr)], ['3-bet', fp(st.tb)], ['Aggression', st.af == null ? '–' : st.af >= 99 ? '∞' : st.af.toFixed(1)], ['Went to showdown', fp(st.wtsd)], ['Won at showdown', fp(st.wsd)], ['BB won / 100 hands', fbb(st.bb100)]] as [string, string][]).map(([k, v]) => stat(k, v)).join('');
  if (!hs.length) {
    T('ps-leaks').innerHTML = '<div class="empty">Import your PokerStars hand histories to see your stats and leaks.</div>';
    T('ps-pos').innerHTML = ''; T('ps-depth').innerHTML = ''; T('ps-losses').innerHTML = '<p class="note">Nothing yet.</p>';
  } else {
    T('ps-leaks').innerHTML = leaks(st, hs).map((x) => `<div class="leak ${x.lv}"><span class="pill ${x.lv === 'bad' ? 'bad' : x.lv === 'good' ? 'good' : 'live'}">${x.lv === 'bad' ? 'Leak' : x.lv === 'good' ? 'Good' : 'Watch'}</span><b>${esc(x.t)}</b><p>${esc(x.p)}</p></div>`).join('');
    const row = (lab: string, s: ReturnType<typeof calcStats>) => `<tr><td>${lab}</td><td class="n">${s.n}</td><td class="n">${fp(s.vpip)}</td><td class="n">${fp(s.pfr)}</td><td class="n">${fbb(s.bb100)}</td></tr>`;
    const th = '<tr><th></th><th class="n">Hands</th><th class="n">VPIP</th><th class="n">PFR</th><th class="n">BB/100</th></tr>';
    T('ps-pos').innerHTML = th + POS_ORDER.filter((p) => hs.some((h) => h.pos === p)).map((p) => row(p, calcStats(hs.filter((h) => h.pos === p)))).join('');
    const bins: [string, number, number][] = [['Under 10 BB', 0, 10], ['10–15 BB', 10, 15], ['15–25 BB', 15, 25], ['25–40 BB', 25, 40], ['40 BB +', 40, 1e9]];
    T('ps-depth').innerHTML = th.replace('<th></th>', '<th>Your stack</th>') + bins.map(([l, a, b]) => { const x = hs.filter((h) => h.st >= a && h.st < b); return x.length ? row(l, calcStats(x)) : ''; }).join('');
    const worst = hs.filter((h) => h.nbb < 0).sort((a, b) => a.nbb - b.nbb).slice(0, 10);
    T('ps-losses').innerHTML = worst.length ? worst.map((h) =>
      `<div class="item"><div class="row" style="gap:10px;align-items:center">${cardsHTML(h.c)}<b>${esc(h.pos)}</b><span class="mono">${h.st} BB</span><span class="pill bad">${fbb(h.nbb)} BB</span><span class="pill">${h.g === 'T' ? 'Tournament' : 'Cash'}</span><span class="mono muted">${esc(h.t)}</span></div>
      <div class="hhline">${esc(h.sum)}</div><div class="md" id="psrv-${esc(h.id)}"></div><div><button class="small" data-psrv="${esc(h.id)}">Review this hand</button></div></div>`).join('') : '<p class="note">No losing hands yet.</p>';
  }
  const imports = store.list('hhimports');
  T('ps-imports').innerHTML = imports.length ? '<div class="tablewrap"><table><tr><th>Imported</th><th>Files</th><th class="n">Hands</th><th></th></tr>' +
    imports.sort((a, b) => (b.created || '').localeCompare(a.created || '')).map((im) => `<tr><td class="mono">${esc((im.created || '').slice(0, 16).replace('T', ' '))}</td><td style="white-space:normal">${esc((im.files || []).join(', '))}</td><td class="n">${(im.hands || []).length}</td><td><button class="small ghost" data-psdel="${esc(im.id)}">${del.is(im.id) ? 'Confirm remove' : 'Remove'}</button></td></tr>`).join('') + '</table></div>' : '<p class="note">No imports yet.</p>';
}

/* ---------- importing ---------- */
const msg = (t: string) => { T('ps-msg').textContent = t; };

async function importTexts(items: { name: string; text: string }[]): Promise<boolean> {
  msg('Reading hands…');
  const existing = new Set(psAll().map((h) => h.id));
  const fresh: ParsedHand[] = [];
  let dup = 0;
  const used: string[] = [];
  for (const it of items) {
    const hs = parseHandFile(it.text);
    if (hs.length) used.push(it.name);
    for (const h of hs) { if (existing.has(h.id)) { dup++; continue; } existing.add(h.id); fresh.push(h); }
  }
  if (!fresh.length) { msg(dup ? `All ${dup} of those hands were already imported.` : 'No Hold\'em hands found. Each hand should start with "PokerStars Hand #" or "Poker Hand #" (GGPoker).'); return false; }
  const CH = 300;
  try {
    for (let i = 0; i < fresh.length; i += CH) await store.add('hhimports', { created: new Date().toISOString(), files: used.slice(0, 20), hands: fresh.slice(i, i + CH) });
    msg(`Imported ${fresh.length.toLocaleString('en-GB')} new hand${fresh.length > 1 ? 's' : ''}${dup ? `, skipped ${dup} already imported` : ''}.`);
    return true;
  } catch { msg("Some hands couldn't be saved. Storage may be full."); return false; }
}

async function importFiles(files: File[]) {
  const items: { name: string; text: string }[] = [];
  let zipFail = false;
  for (const f of files) {
    try {
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
        const JSZip = (await import('jszip')).default;
        const z = await JSZip.loadAsync(f);
        for (const e of Object.values(z.files)) if (!e.dir && /\.txt$/i.test(e.name)) items.push({ name: e.name.split('/').pop()!, text: await e.async('string') });
      } else items.push({ name: f.name, text: await f.text() });
    } catch { zipFail = zipFail || /\.zip$/i.test(f.name); }
  }
  if (!items.length && zipFail) { msg("Couldn't open that zip here. Unzip it and choose the .txt files inside."); return; }
  await importTexts(items);
}

/* screenshots → hand histories via the vision model on the server */
const isImg = (f: File) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|hei[cf])$/i.test(f.name || '');

async function shrink(file: File, max = 1500): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

const screenPrompt = (name: string) =>
  `These are screenshots of the PokerStars poker client's Instant Hand History window.${name ? ` The player's screen name is "${name}".` : ''}\n` +
  'Reply with only JSON of this shape: {"histories": ["..."], "rows": [{"hand": "", "table": "", "cards": "", "seat": "", "winner": "", "pot": 0}]}\n' +
  '- histories: every hand history text visible (text that starts with a line "PokerStars Hand #..."). Transcribe each hand exactly, line by line, keeping every name, number and symbol, with lines joined by \\n. If one hand continues across several screenshots, join the parts in order into one string without repeating lines. Never guess text you cannot read. Leave out any hand whose first "PokerStars Hand #" line is not visible.\n' +
  '- rows: one object per row of the hand list table (columns Hand #, Table, My Cards, Winner, Pot). hand and table exactly as shown, even if cut off with "...". cards without spaces, like "Js3s". seat is "SB" or "BB" when shown in brackets after the cards, otherwise "". pot as a number.\n' +
  'Use empty arrays when there is nothing of that kind.';

async function importScreens(files: File[]) {
  const heic = files.filter((f) => /\.hei[cf]$/i.test(f.name) || /heic|heif/i.test(f.type));
  files = files.filter((f) => !heic.includes(f));
  if (!files.length) { msg("Those are HEIC photos, which can't be read. Take a normal screenshot (Cmd+Shift+4) or export as PNG or JPEG."); return; }
  const name = $<HTMLInputElement>('ps-name').value.trim();
  const per = 3;
  const histories: string[] = [], rows: any[] = [];
  for (let i = 0; i < files.length; i += per) {
    const batch = files.slice(i, i + per);
    msg(`Reading screenshot${files.length > 1 ? `s ${i + 1}–${Math.min(i + per, files.length)} of ${files.length}` : ''}… this can take up to a minute.`);
    try {
      const images = await Promise.all(batch.map((f) => shrink(f)));
      const out = await json('/api/vision', { prompt: screenPrompt(name), images });
      if (Array.isArray(out?.histories)) out.histories.forEach((t: unknown) => { if (typeof t === 'string' && t.includes('PokerStars')) histories.push(t); });
      if (Array.isArray(out?.rows)) out.rows.forEach((r: any) => { if (r?.hand) rows.push(r); });
    } catch (e) { msg(explain(e)); return; }
  }
  let fullOK = 0;
  if (histories.length) {
    const text = histories.join('\n\n\n');
    fullOK = parseHandFile(text).length;
    if (fullOK) await importTexts([{ name: 'Screenshots ' + todayISO(), text }]);
  }
  const have = new Set(psLite().map((h) => h.id));
  const lite: LiteHand[] = [];
  for (const r of rows) {
    const cards = String(r.cards || '').replace(/\s+/g, '');
    const id = 'L' + String(r.hand).replace(/[^0-9]/g, '') + '-' + cards;
    if (have.has(id)) continue;
    have.add(id);
    const winner = String(r.winner || '').trim();
    lite.push({ id, lite: 1, g: /^T/.test(String(r.table || '')) ? 'T' : 'C', c: cards, pos: r.seat || '?', won: name && winner ? winner.toLowerCase() === name.toLowerCase() : null, pot: +r.pot || 0, t: '' });
  }
  if (lite.length) {
    try { await store.add('hhimports', { created: new Date().toISOString(), files: ['Hand list screenshot'], hands: lite }); }
    catch { msg("Couldn't save the hand list. Try again."); return; }
  }
  if (!fullOK && !lite.length) { msg('No hands found in those screenshots. Make sure the hand text or the hand list is visible and readable.'); return; }
  const parts: string[] = [];
  if (fullOK) parts.push(`${fullOK} full hand${fullOK > 1 ? 's' : ''} read`);
  if (lite.length) parts.push(`${lite.length} hand-list row${lite.length > 1 ? 's' : ''} recorded${name ? '' : ' (add your screen name to count your wins)'}`);
  msg(parts.join(', ') + '. Check a couple against PokerStars: screenshot reading can occasionally misread a number.');
}

function routeFiles(fs: File[]) {
  const imgs = fs.filter(isImg), txt = fs.filter((f) => !isImg(f));
  if (txt.length) void importFiles(txt);
  if (imgs.length) void importScreens(imgs);
}

/* ---------- AI prompts ---------- */
export function psHandPrompt(h: ParsedHand): string {
  return `Review this ${h.site === 'GG' ? 'GGPoker' : 'PokerStars'} ${h.g === 'T' ? 'tournament' : 'cash game'} hand from its hand history. Hero is in ${h.pos} with ${h.c}, stack ${h.st} BB, ${h.n} players dealt in. ` +
    `Actions use position names, amounts are in big blinds (c = call, b = bet, r = raise to, x = check, f = fold, AI = all-in):\n${h.sum}\nHero's result: ${fbb(h.nbb)} BB.\n\n` +
    'Give: ## Verdict (one line), ## Where it went wrong (street by street, only the decisions that mattered), ## Takeaway (one rule for next time).';
}

function analysePrompt(f: string): string | null {
  const all = psAll(), hs = f === 'all' ? all : all.filter((h) => h.g === f);
  if (!hs.length) return null;
  const st = calcStats(hs);
  const posT = POS_ORDER.filter((p) => hs.some((h) => h.pos === p)).map((p) => { const s = calcStats(hs.filter((h) => h.pos === p)); return `${p}: ${s.n} hands, VPIP ${fp(s.vpip)}, PFR ${fp(s.pfr)}, ${fbb(s.bb100)} BB/100`; }).join('\n');
  const depth = ([['<10', 0, 10], ['10-15', 10, 15], ['15-25', 15, 25], ['25-40', 25, 40], ['40+', 40, 1e9]] as [string, number, number][]).map(([l, a, b]) => { const x = hs.filter((h) => h.st >= a && h.st < b); if (!x.length) return ''; const s = calcStats(x); return `${l} BB: ${s.n} hands, VPIP ${fp(s.vpip)}, PFR ${fp(s.pfr)}, ${fbb(s.bb100)} BB/100`; }).filter(Boolean).join('\n');
  const worst = hs.filter((h) => h.nbb < 0).sort((a, b) => a.nbb - b.nbb).slice(0, 12).map((h) => `- ${h.pos} ${h.c} (${h.st} BB, ${h.g === 'T' ? 'tourn' : 'cash'}): ${h.sum} => ${fbb(h.nbb)} BB`).join('\n');
  const lk = leaks(st, hs).map((x) => '- ' + x.t).join('\n');
  const lite = psLite().filter((h) => f === 'all' || h.g === f);
  let liteTxt = '';
  if (lite.length) {
    const won = lite.filter((h) => h.won);
    const cls = (h: LiteHand) => { const p = parseCards(h.c); return p.cards && p.cards.length === 2 ? handClass(p.cards[0], p.cards[1]) : h.c; };
    liteTxt = `\n\nAlso ${lite.length} more hands known only from hand-list screenshots (hero's cards, whether hero won the pot, final pot size; no betting actions). Hero won ${won.length} of these pots (${pct(won.length / lite.length, 0)}).\n` +
      `Premium or strong starting hands dealt that hero did NOT win the pot with: ${lite.filter((h) => !h.won && /^(AA|KK|QQ|JJ|TT|99|AK|AQ|AJs|KQs)/.test(cls(h))).map((h) => `${cls(h)} (pot ${h.pot})`).join(', ') || 'none'}.`;
  }
  return `Analyse this player's game from their tracked data (${f === 'T' ? 'tournaments only' : f === 'C' ? 'cash games only' : 'tournaments and cash games'}). Detailed stats come only from the ${st.n} full hand histories. Say which conclusions rest on which data. You can call get_my_stats and verify spots with the calculators.\n` +
    `Overall: ${st.n} hands, VPIP ${fp(st.vpip)}, PFR ${fp(st.pfr)}, open-limp ${fp(st.limp)}, 3-bet ${fp(st.tb)} of ${st.to} chances, postflop aggression factor ${st.af == null ? 'n/a' : st.af.toFixed(2)}, went to showdown ${fp(st.wtsd)} of flops seen, won ${fp(st.wsd)} at showdown, ${fbb(st.bb100)} BB per 100 hands.\n\n` +
    `By position:\n${posT}\n\nBy hero stack size:\n${depth}\n\nAutomatic leak flags:\n${lk}\n\nBiggest losing hands (amounts in BB; c call, b bet, r raise to, x check, f fold, AI all-in):\n${worst}${liteTxt}\n\n` +
    'Give: ## Summary (2-3 lines on what kind of player the numbers show, and how reliable the sample is), ## Top 3 leaks (each with the evidence and exactly what to change), ## Hands to learn from (2-3 of the losing hands and the lesson), ## Plan for the next two weeks (concrete, using drills like pot-odds practice, ICM bubble spots and push/fold charts).';
}

export function initTracker() {
  setStatsProvider(statsDigest);
  const nameEl = $<HTMLInputElement>('ps-name');
  const saved = ls.raw('pl-psname');
  if (saved) nameEl.value = saved;
  nameEl.addEventListener('change', () => ls.setRaw('pl-psname', nameEl.value.trim()));
  $('ps-game').addEventListener('change', renderStars);
  $('ps-file').addEventListener('change', (e) => { const el = e.target as HTMLInputElement; const fs = [...(el.files || [])]; el.value = ''; if (fs.length) routeFiles(fs); });
  $('ps-img').addEventListener('change', (e) => { const el = e.target as HTMLInputElement; const fs = [...(el.files || [])]; el.value = ''; if (fs.length) routeFiles(fs); });
  $('ps-pastebtn').addEventListener('click', async () => {
    const t = $<HTMLTextAreaElement>('ps-paste').value;
    if (!t.trim()) { msg('Paste some hands first.'); return; }
    if (await importTexts([{ name: 'Pasted ' + todayISO(), text: t }])) $<HTMLTextAreaElement>('ps-paste').value = '';
  });
  const panel = $('p-stars');
  (['dragenter', 'dragover'] as const).forEach((t) => panel.addEventListener(t, (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; panel.querySelectorAll('.drop').forEach((d) => d.classList.add('over')); }));
  panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget as Node)) panel.querySelectorAll('.drop').forEach((d) => d.classList.remove('over')); });
  panel.addEventListener('drop', (e) => {
    e.preventDefault();
    panel.querySelectorAll('.drop').forEach((d) => d.classList.remove('over'));
    const fs = [...(e.dataTransfer?.files || [])];
    if (fs.length) { routeFiles(fs); return; }
    const t = e.dataTransfer?.getData('text/plain');
    if (t && /PokerStars|Poker Hand #/.test(t)) void importTexts([{ name: 'Dropped text ' + todayISO(), text: t }]);
    else msg('Nothing to import there. Drop screenshot files or hand history .txt files.');
  });
  document.addEventListener('paste', (e) => {
    if (panel.hidden) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const fs = [...(cd.files || [])];
    if (!fs.length && cd.items) for (const it of cd.items) if (it.kind === 'file') { const f = it.getAsFile(); if (f) fs.push(f); }
    if (fs.length) { e.preventDefault(); routeFiles(fs); return; }
    if ((e.target as HTMLElement)?.id === 'ps-paste') return;
    const t = cd.getData('text/plain');
    if (t && /PokerStars Hand #|Poker Hand #/.test(t)) { e.preventDefault(); void importTexts([{ name: 'Pasted ' + todayISO(), text: t }]); }
  });
  onClick($('ps-imports'), 'button[data-psdel]', async (b) => {
    const id = b.dataset.psdel!;
    if (!del.click(id)) { b.textContent = 'Confirm remove'; return; }
    await store.remove('hhimports', id).catch(() => msg("Couldn't remove that import. Try again."));
  });
  onClick($('ps-losses'), 'button[data-psrv]', async (b) => {
    const h = psAll().find((x) => x.id === b.dataset.psrv);
    if (h) await askCoach(psHandPrompt(h), $('psrv-' + h.id), b as HTMLButtonElement, null);
  });
  $('ps-analyse').addEventListener('click', () => {
    const p = analysePrompt($<HTMLSelectElement>('ps-game').value);
    if (!p) { $('ps-out').innerHTML = '<p class="note">Import some hands first.</p>'; return; }
    void askCoach(p, $('ps-out'), $<HTMLButtonElement>('ps-analyse'), $('ps-stop'));
  });
  $('ps-stop').addEventListener('click', stopCoach);
  for (const c of ['hhimports', 'livehands', 'tourhands'] as const) store.onChange(c, renderStars);
  renderStars();
}
export { renderStars as refreshTracker };
