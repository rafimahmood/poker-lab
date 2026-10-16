import { type ChatMessage, chat, explain } from '../ai/client';
import { toolLabel } from '../ai/toolLabels';
import { esc, md } from '../ui/dom';
import { getStatsDigest } from './context';
import { updateQuota } from './coachStatus';

export let coachCtl: AbortController | null = null;
export const stopCoach = () => coachCtl?.abort();

export const chips = (tools: { label: string }[]) =>
  tools.length ? `<div class="toolchips" aria-label="Calculations the coach ran">${tools.map((t) => `<span class="toolchip">🔧 ${esc(t.label)}</span>`).join('')}</div>` : '';

/** One-shot coach review: streams the answer into `outEl`, showing the tool calls the coach made. */
export async function askCoach(prompt: string, outEl: HTMLElement, btn: HTMLButtonElement | null, stopBtn: HTMLElement | null): Promise<string | null> {
  coachCtl = new AbortController();
  outEl.innerHTML = '<p class="note">Thinking… the coach may run a few calculations first.</p>';
  if (btn) btn.disabled = true;
  if (stopBtn) stopBtn.hidden = false;
  let text = '';
  const tools: { label: string }[] = [];
  const paint = (extra = '') => { outEl.innerHTML = chips(tools) + md(text) + extra; };
  try {
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
    let truncated = false;
    await chat({ messages, mode: 'review', stats: getStatsDigest() }, {
      onMeta: updateQuota,
      onDelta: (t) => { text += t; paint(); },
      onToolStart: (t) => { tools.push({ label: `${t.name}…` }); paint(); },
      onTool: (t) => { tools[tools.length - 1] = { label: toolLabel(t.name, t.args, t.result) }; paint(); },
      onDone: (d) => { truncated = !!d.truncated; },
    }, coachCtl.signal);
    paint(truncated ? '<p class="note">The review was cut short. Try again with less detail.</p>' : '');
    return text;
  } catch (e) {
    paint(`<p class="note">${esc(explain(e))}</p>`);
    return null;
  } finally {
    if (btn) btn.disabled = false;
    if (stopBtn) stopBtn.hidden = true;
  }
}
