import { COLLECTIONS, store } from '../storage/db';
import { $, todayISO } from '../ui/dom';

function summary() {
  const parts = COLLECTIONS.map((c) => [c, store.list(c).length] as const).filter(([, n]) => n);
  $('data-summary').textContent = (store.persistent ? '' : 'Storage is blocked in this browser window, so nothing here survives a reload. ') +
    (parts.length ? parts.map(([c, n]) => `${n} ${c}`).join(' · ') : 'Nothing saved yet.');
}

async function restore(mode: 'merge' | 'replace') {
  const f = $<HTMLInputElement>('data-file').files?.[0], msg = $('data-msg');
  if (!f) { msg.textContent = 'Choose a backup file first.'; return; }
  if (mode === 'replace' && !confirm('Replace everything in this browser with the backup? This cannot be undone.')) return;
  try {
    const n = await store.importAll(JSON.parse(await f.text()), mode);
    msg.textContent = `Restored ${n} item${n === 1 ? '' : 's'}.`;
    summary();
  } catch (e) { msg.textContent = e instanceof Error && /backup/.test(e.message) ? e.message : "Couldn't read that file."; }
}

export function initData() {
  $('data-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `poker-lab-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('data-merge').addEventListener('click', () => void restore('merge'));
  $('data-replace').addEventListener('click', () => void restore('replace'));
  for (const c of COLLECTIONS) store.onChange(c, summary);
  summary();
}
