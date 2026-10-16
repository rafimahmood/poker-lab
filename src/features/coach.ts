import { type ChatMessage, chat, explain } from '../ai/client';
import { toolLabel } from '../ai/toolLabels';
import { $, esc, ls, md } from '../ui/dom';
import { getStatsDigest } from './context';
import { chips } from './coachRun';
import { updateQuota } from './coachStatus';

interface Turn { role: 'user' | 'assistant'; content: string; tools?: { label: string }[]; error?: boolean }

const KEY = 'pl-chat-v1';
let turns: Turn[] = ls.get<Turn[]>(KEY, []).filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string').slice(-30);
let ctl: AbortController | null = null;
let busy = false;

const STARTERS = [
  'What equity does AKs have against QQ?',
  'I\'m on the button, 9-handed, 30 BB. UTG opens. Should I call with 77?',
  'What are my biggest leaks?',
  'On the bubble, 4 left and 3 paid, should I call a shove with A9s? Stacks 20k, 15k, 8k, 4k.',
];

function save() { ls.set(KEY, turns.slice(-30).map(({ role, content, tools }) => ({ role, content, tools }))); }

function bubble(t: Turn, streaming = false): string {
  if (t.role === 'user') return `<div class="msg user"><span class="who">You</span><div>${esc(t.content).replace(/\n/g, '<br>')}</div></div>`;
  return `<div class="msg bot${t.error ? ' err' : ''}"><span class="who">Coach</span><div class="md">${chips(t.tools || [])}${t.content ? md(t.content) : streaming ? '<p class="note">Thinking…</p>' : ''}</div></div>`;
}

function render(streaming = false) {
  const log = $('chat-log');
  log.innerHTML = turns.length ? turns.map((t, i) => bubble(t, streaming && i === turns.length - 1)).join('') : '<p class="note chat-empty">Ask about a hand, a range or a tournament spot to get started.</p>';
  log.scrollTop = log.scrollHeight;
  $('chat-starters').hidden = turns.length > 0;
}

async function send(text: string) {
  if (busy || !text.trim()) return;
  busy = true;
  $('chat-msg').textContent = '';
  turns.push({ role: 'user', content: text.trim() });
  const reply: Turn = { role: 'assistant', content: '', tools: [] };
  turns.push(reply);
  $<HTMLButtonElement>('chat-send').disabled = true; $('chat-stop').hidden = false;
  render(true);
  ctl = new AbortController();
  try {
    const history: ChatMessage[] = turns.slice(0, -1).filter((t) => !t.error && t.content).map((t) => ({ role: t.role, content: t.content }));
    await chat({ messages: history, mode: 'chat', stats: getStatsDigest() }, {
      onMeta: updateQuota,
      onDelta: (d) => { reply.content += d; render(true); },
      onToolStart: (t) => { reply.tools!.push({ label: `${t.name}…` }); render(true); },
      onTool: (t) => { reply.tools![reply.tools!.length - 1] = { label: toolLabel(t.name, t.args, t.result) }; render(true); },
      onDone: (d) => { if (d.truncated) reply.content += '\n\n_(The reply was cut short. Ask me to continue.)_'; },
    }, ctl.signal);
    if (!reply.content) reply.content = 'I did not get an answer back. Try asking again.';
  } catch (e) {
    const msg = explain(e);
    if (reply.content || reply.tools?.length) reply.content += `\n\n${msg}`;
    else { reply.content = msg; reply.error = true; }
  } finally {
    busy = false;
    $<HTMLButtonElement>('chat-send').disabled = false; $('chat-stop').hidden = true;
    save(); render();
  }
}

export function initCoachChat() {
  $('chat-starters').innerHTML = STARTERS.map((s) => `<button type="button" class="chip" data-starter="${esc(s)}">${esc(s)}</button>`).join('');
  $('chat-starters').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-starter]');
    if (b) void send(b.dataset.starter!);
  });
  const input = $<HTMLTextAreaElement>('chat-input');
  $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; void send(v); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $<HTMLFormElement>('chat-form').requestSubmit(); } });
  $('chat-stop').addEventListener('click', () => ctl?.abort());
  $('chat-new').addEventListener('click', () => { ctl?.abort(); turns = []; save(); render(); input.focus(); });
  render();
}

/** Open the coach tab with a question ready to send (used by "Ask the coach" buttons). */
export function askCoachAbout(text: string) {
  location.hash = '#coach';
  setTimeout(() => { $<HTMLTextAreaElement>('chat-input').value = text; $('chat-input').focus(); }, 0);
}
