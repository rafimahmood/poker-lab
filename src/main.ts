import './styles/main.css';
import { initCoachChat } from './features/coach';
import { initCoachStatus } from './features/coachStatus';
import { initData } from './features/data';
import { initLessons, setSource } from './features/lessons';
import { initLive } from './features/live';
import { initPractice } from './features/practice';
import { initRanges, renderRangeCompare } from './features/ranges';
import { initResults } from './features/results';
import { initReview } from './features/review';
import { initTools, runHeat } from './features/tools';
import { initTracker, refreshTracker } from './features/tracker';
import { store } from './storage/db';
import { $, $$, esc, ls } from './ui/dom';

const GROUPS = [
  { id: 'play', tabs: [['practice', 'Practice'], ['live', 'Live session']] },
  { id: 'study', tabs: [['ranges', 'Preflop ranges'], ['lessons', 'Lessons'], ['hands', 'Starting hands'], ['theory', 'Bet sizing']] },
  { id: 'mine', tabs: [['stars', 'Tracker'], ['review', 'Hand review'], ['results', 'Results'], ['data', 'Backup']] },
  { id: 'tools', tabs: [['equity', 'Equity'], ['icm', 'ICM']] },
  { id: 'coach', tabs: [['coach', 'Ask the coach']] },
] as const;
const TABS: string[] = GROUPS.flatMap((g) => g.tabs.map((t) => t[0]));
const groupOf = (t: string) => GROUPS.find((g) => g.tabs.some((x) => x[0] === t)) ?? GROUPS[0];

function initTheme() {
  const root = document.documentElement;
  const saved = ls.raw('pl-theme');
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  const current = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const paint = () => { $('theme-label').textContent = current() === 'dark' ? 'Light' : 'Dark'; };
  $('theme-toggle').addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    ls.setRaw('pl-theme', next);
    paint();
  });
  paint();
}

let lastSub = ls.get<Record<string, string>>('pl-sub', {});
let heatStarted = false;

function showTab(t: string) {
  if (!TABS.includes(t)) t = 'practice';
  TABS.forEach((x) => { $('p-' + x).hidden = x !== t; });
  const g = groupOf(t);
  lastSub[g.id] = t;
  ls.set('pl-sub', lastSub);
  $$<HTMLAnchorElement>('nav.tabs a').forEach((a) => {
    const sel = a.dataset.group === g.id;
    a.setAttribute('aria-selected', String(sel));
    if (sel) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    const sub = lastSub[a.dataset.group!];
    if (sub && TABS.includes(sub)) a.setAttribute('href', '#' + sub);
  });
  const sub = $('subtabs');
  sub.hidden = g.tabs.length < 2;
  sub.innerHTML = g.tabs.map(([id, l]) => `<a href="#${id}" data-tab="${id}"${id === t ? ' aria-current="page"' : ''}>${esc(l)}</a>`).join('');
  document.title = `${g.tabs.find((x) => x[0] === t)![1]} · Poker Lab`;
  if (t === 'hands' && !heatStarted) { heatStarted = true; runHeat(); }
  if (t === 'stars') refreshTracker();
  if (t === 'ranges') renderRangeCompare();
}
const goTab = (t: string) => { showTab(t); try { history.replaceState(null, '', '#' + t); } catch { /* ignore */ } };

async function boot() {
  await store.init();
  initTheme();
  if (import.meta.env.DEV) (window as unknown as { __store: typeof store }).__store = store; // for screenshot/e2e seeding
  initTools();
  initResults();
  initReview();
  initTracker();
  initLessons();
  initRanges();
  initPractice();
  initLive();
  initData();
  initCoachChat();
  initCoachStatus();

  $$<HTMLAnchorElement>('nav.tabs a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const g = GROUPS.find((x) => x.id === a.dataset.group)!;
    goTab(lastSub[g.id] && TABS.includes(lastSub[g.id]) ? lastSub[g.id] : g.tabs[0][0]);
  }));
  $('subtabs').addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('a[data-tab]');
    if (!a) return;
    e.preventDefault();
    goTab(a.dataset.tab!);
  });
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  $('prr-lessons').addEventListener('click', () => { setSource('practice'); goTab('lessons'); $('ls-build').focus(); });
  showTab(location.hash.slice(1) || 'practice');
  document.documentElement.dataset.ready = '1';
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('afterbegin', '<p style="padding:16px">Poker Lab failed to start. Try reloading the page.</p>');
});
