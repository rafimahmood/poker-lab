import { parseCards } from '../poker/cards';
import { store } from '../storage/db';
import { $, cardsHTML, confirmer, esc, md, onClick, todayISO } from '../ui/dom';
import { askCoach, stopCoach } from './coachRun';

export interface SavedHand {
  id: string; created: string; date: string; game: string; players: number | null; pos: string; stack: number | null; cards: string;
  blinds: string; stage: string; vpos: string; vstack: number | null; flop: string; turn: string; river: string;
  pre: string; aflop: string; aturn: string; ariver: string; read: string; result: string; question: string; review: string;
}
export const getSavedHands = () => store.list<SavedHand>('hands');

const val = (id: string) => $<HTMLInputElement>(id).value.trim();

function collect(): Omit<SavedHand, 'id'> {
  return {
    created: new Date().toISOString(), date: todayISO(), game: val('hr-game'), players: +val('hr-players') || null, pos: val('hr-pos'),
    stack: val('hr-stack') ? +val('hr-stack') : null, cards: val('hr-cards'), blinds: val('hr-blinds'), stage: val('hr-stage'),
    vpos: val('hr-vpos'), vstack: val('hr-vstack') ? +val('hr-vstack') : null, flop: val('hr-flop'), turn: val('hr-turn'), river: val('hr-river'),
    pre: val('hr-a-pre'), aflop: val('hr-a-flop'), aturn: val('hr-a-turn'), ariver: val('hr-a-river'), read: val('hr-read'),
    result: val('hr-result'), question: val('hr-q'), review: '',
  };
}

export function validateHand(h: Pick<SavedHand, 'cards' | 'flop' | 'turn' | 'river' | 'pre'>): string | null {
  if (!h.cards) return 'Add your two cards.';
  const c = parseCards(h.cards);
  if (c.error !== undefined) return 'Your cards: ' + c.error;
  if (c.cards.length !== 2) return 'Your cards need exactly 2 cards, like Th Tc.';
  for (const [k, n, lab] of [['flop', 3, 'Flop'], ['turn', 1, 'Turn'], ['river', 1, 'River']] as const) {
    const v = h[k];
    if (v) {
      const b = parseCards(v);
      if (b.error !== undefined) return lab + ': ' + b.error;
      if (b.cards.length !== n) return `${lab} needs ${n} card${n > 1 ? 's' : ''}.`;
    }
  }
  if (!h.pre) return 'Describe the preflop action.';
  return null;
}

export function handPrompt(h: Omit<SavedHand, 'id'>): string {
  const L: string[] = ['Review this hand.', `Game: ${h.game}${h.players ? ', ' + h.players + ' players at the table' : ''}`];
  if (h.blinds) L.push('Blinds: ' + h.blinds);
  if (h.stage) L.push('Tournament stage: ' + h.stage);
  L.push(`Hero: ${h.pos}${h.stack ? ', ' + h.stack + ' BB' : ''}, holding ${h.cards}`);
  if (h.vpos || h.vstack) L.push('Main opponent: ' + (h.vpos || 'position unknown') + (h.vstack ? ', ' + h.vstack + ' BB' : ''));
  if (h.read) L.push('Read on opponent: ' + h.read);
  L.push('Preflop: ' + h.pre);
  if (h.flop) L.push(`Flop [${h.flop}]: ${h.aflop || 'no notes'}`);
  if (h.turn) L.push(`Turn [${h.turn}]: ${h.aturn || 'no notes'}`);
  if (h.river) L.push(`River [${h.river}]: ${h.ariver || 'no notes'}`);
  L.push('Result: ' + h.result);
  if (h.question) L.push('What the player was unsure about: ' + h.question);
  L.push('\nGive: ## Verdict (one line: good, OK or mistake, and the biggest one), ## Street by street (what hero did vs the better play and why), ## Key idea (the concept behind it), ## Takeaway (one rule to use next session).');
  return L.join('\n');
}

const del = confirmer();

export function renderMyHands() {
  const el = $('hr-list');
  const hs = getSavedHands().sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  if (!hs.length) { el.innerHTML = '<div class="empty">No hands saved yet. Your write-ups and their reviews collect here so you can re-read them before your next session.</div>'; return; }
  el.innerHTML = hs.map((h) => {
    const board = [h.flop, h.turn, h.river].filter(Boolean).join(' ');
    const res = h.result === 'I won' ? 'good' : h.result === 'I lost' ? 'bad' : '';
    const detail = ['Preflop: ' + (h.pre || ''), h.flop ? 'Flop: ' + (h.aflop || '') : '', h.turn ? 'Turn: ' + (h.aturn || '') : '', h.river ? 'River: ' + (h.ariver || '') : '', h.question ? 'Unsure about: ' + h.question : ''].filter(Boolean).join(' · ');
    return `<details class="item"><summary><span class="mono muted">${esc(h.date || '')}</span>${cardsHTML(h.cards)}<b>${esc(h.pos || '')}</b>${h.stack ? `<span class="mono">${esc(String(h.stack))} BB</span>` : ''}<span class="pill">${esc(h.game || '')}</span><span class="pill ${res}">${esc(h.result || '')}</span>${h.review ? '<span class="pill good">Reviewed</span>' : ''}</summary>
      <div class="body">${board ? `<div>${cardsHTML(board)}</div>` : ''}<div class="hhline">${esc(detail)}</div>
      <div class="md" id="rv-${esc(h.id)}">${h.review ? md(h.review) : ''}</div>
      <div class="row">${h.review ? '' : `<button class="small primary" data-rv="${esc(h.id)}">Review this hand</button>`}<button class="small ghost" data-hdel="${esc(h.id)}">${del.is(h.id) ? 'Confirm delete' : 'Delete'}</button></div></div></details>`;
  }).join('');
}

async function submit(review: boolean) {
  const h = collect(), err = validateHand(h), msg = $('hr-msg');
  msg.textContent = '';
  if (err) { msg.textContent = err; return; }
  let id: string;
  try { id = await store.add('hands', h); } catch { msg.textContent = "Couldn't save the hand. Storage may be full."; return; }
  msg.textContent = 'Saved.';
  ['hr-cards', 'hr-flop', 'hr-turn', 'hr-river', 'hr-a-pre', 'hr-a-flop', 'hr-a-turn', 'hr-a-river', 'hr-read', 'hr-q', 'hr-vstack'].forEach((i) => (($(i) as HTMLInputElement).value = ''));
  $<HTMLSelectElement>('hr-vpos').value = '';
  if (!review) return;
  const text = await askCoach(handPrompt(h), $('hr-out'), $<HTMLButtonElement>('hr-reviewbtn'), $('hr-stop'));
  if (text) await store.update('hands', id, { review: text }).catch(() => {});
}

export function initReview() {
  $('hr-form').addEventListener('submit', (e) => { e.preventDefault(); void submit(true); });
  $('hr-savebtn').addEventListener('click', () => void submit(false));
  $('hr-stop').addEventListener('click', stopCoach);
  store.onChange('hands', renderMyHands);
  onClick($('hr-list'), 'button[data-rv]', async (b) => {
    const h = store.get<SavedHand>('hands', b.dataset.rv!);
    if (!h) return;
    const t = await askCoach(handPrompt(h), $('rv-' + h.id), b as HTMLButtonElement, null);
    if (t) await store.update('hands', h.id, { review: t }).catch(() => {});
  });
  onClick($('hr-list'), 'button[data-hdel]', async (b) => {
    const id = b.dataset.hdel!;
    if (!del.click(id)) { b.textContent = 'Confirm delete'; return; }
    await store.remove('hands', id).catch(() => { $('hr-msg').textContent = "Couldn't delete that hand."; });
  });
  renderMyHands();
}
