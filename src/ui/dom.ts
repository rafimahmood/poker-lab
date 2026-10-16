import { type Card, RANKS, SUITS, SYM, parseCards } from '../poker/cards';

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}
export const $maybe = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const pct = (x: number, d = 1) => (x * 100).toFixed(d) + '%';
export const pctR = (x: number) => Math.round(x * 100) + '%';
export const gbp = (x: number) => (x < 0 ? '−£' : '£') + Math.abs(x).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const m2 = (x: number) => String(+(+x).toFixed(2));
export const fmtChips = (x: number) => Math.round(x).toLocaleString('en-GB');
export const fp = (x: number | null) => (x == null ? '–' : pct(x, 0));
export const fbb = (x: number | null) => (x == null ? '–' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1));
export const signed = (x: number, d = 1) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);
export const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

export function todayISO(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Tiny markdown: ## headings, - bullets, **bold**, paragraphs. Output is escaped HTML. */
export function md(text: string): string {
  const lines = esc(text).split('\n');
  let html = '', inList = false;
  for (let l of lines) {
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    if (/^\s*[-*•] /.test(l)) {
      if (!inList) { html += '<ul class="plain">'; inList = true; }
      html += '<li>' + l.replace(/^\s*[-*•] /, '') + '</li>';
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^#{1,4} /.test(l)) html += '<h3>' + l.replace(/^#{1,4} /, '') + '</h3>';
    else if (l.trim()) html += '<p>' + l + '</p>';
  }
  if (inList) html += '</ul>';
  return html;
}

/* ---------- cards ---------- */

export function cardEl(c: Card | null, big = false): HTMLElement {
  const d = document.createElement('div');
  if (c == null) { d.className = 'card back' + (big ? ' big' : ''); return d; }
  const s = SUITS[c & 3];
  d.className = 'card' + (s === 'd' || s === 'h' ? ' red' : '') + (big ? ' big' : '');
  d.innerHTML = `<span>${RANKS[c >> 2]}</span><span class="s">${SYM[s]}</span>`;
  d.setAttribute('aria-label', RANKS[c >> 2] + s);
  return d;
}
export const showCards = (el: HTMLElement, cards: readonly Card[], big = false) => el.replaceChildren(...cards.map((c) => cardEl(c, big)));

export function cardsHTML(str: string): string {
  const p = parseCards(str);
  if (p.error || !p.cards) return esc(str || '');
  const d = document.createElement('div');
  d.className = 'cards';
  d.style.minHeight = '0';
  showCards(d, p.cards);
  return d.outerHTML;
}

/** Wire a click handler on a container for elements matching `sel`. */
export function onClick(root: HTMLElement | Document, sel: string, fn: (el: HTMLElement, e: MouseEvent) => void) {
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest(sel) as HTMLElement | null;
    if (t && root.contains(t)) fn(t, e as MouseEvent);
  });
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Safe localStorage helpers (storage can be blocked). */
export const ls = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v == null ? d : (JSON.parse(v) as T); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  raw(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  setRaw(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

/** Two-step "Delete" -> "Confirm delete" buttons. */
export function confirmer() {
  let pending: string | null = null;
  return {
    is: (id: string) => pending === id,
    /** Returns true when the action is confirmed (second click). */
    click(id: string): boolean { if (pending === id) { pending = null; return true; } pending = id; return false; },
    reset() { pending = null; },
  };
}
