import { getAccessCode, getStatus, setAccessCode, type Status } from '../ai/client';
import { $maybe } from '../ui/dom';

let status: Status | null = null;
export const getCachedStatus = () => status;

function render() {
  const el = $maybe('ai-status');
  if (!el) return;
  if (!status) { el.textContent = 'Checking the coach…'; return; }
  if (!status.configured) { el.innerHTML = '<b>Coach offline.</b> The site owner has not added an API key yet. Everything else works.'; return; }
  if (status.codeValid) { el.innerHTML = '<b>Access code accepted.</b> You have full coach access.'; return; }
  const left = status.freeRemaining;
  el.innerHTML = `<b>${left == null ? status.freePerDay : left} free message${left === 1 ? '' : 's'} left today.</b>` +
    (status.accessCodeEnabled ? ' Have an access code? Enter it below for more.' : '');
}

/** Called with the `meta` event of every AI response to keep the quota display fresh. */
export function updateQuota(m: { tier: 'free' | 'code'; remaining: number | null }) {
  if (!status) return;
  status = { ...status, codeValid: m.tier === 'code', freeRemaining: m.remaining };
  render();
}

export async function refreshStatus() {
  status = await getStatus();
  render();
  const codeBox = $maybe('ai-code-box');
  if (codeBox) codeBox.hidden = !status?.accessCodeEnabled;
}

export function initCoachStatus() {
  const input = $maybe<HTMLInputElement>('ai-code');
  if (input) input.value = getAccessCode();
  $maybe('ai-code-save')?.addEventListener('click', async () => {
    setAccessCode((input?.value || '').trim());
    await refreshStatus();
    const m = $maybe('ai-code-msg');
    if (m) m.textContent = status?.codeValid ? 'Code accepted.' : getAccessCode() ? 'That code is not right.' : 'Code cleared.';
  });
  void refreshStatus();
}
