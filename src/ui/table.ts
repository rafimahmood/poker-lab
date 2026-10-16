import type { Card } from '../poker/cards';
import { cardEl, esc, showCards } from './dom';

export interface TableSeat {
  name: string; pos?: string; me?: boolean; out?: boolean; hl?: boolean; sel?: boolean; dealer?: boolean;
  cards?: Card[] | 'back' | null; stack?: string; bet?: string; state?: string; onClick?: () => void;
}
export interface TableMid { pot?: string; board?: Card[]; total?: string }

/** Draw players around an oval table. `anchor` is the seat index shown at the bottom. */
export function drawTable(T: HTMLElement, seats: TableSeat[], anchor: number, mid?: TableMid) {
  T.querySelectorAll('.pseat,.pbet,.pdealer').forEach((x) => x.remove());
  const N = seats.length;
  seats.forEach((s, i) => {
    const rel = (i - anchor + N) % N, th = ((90 + (rel * 360) / N) * Math.PI) / 180;
    const cx = 50 + 40 * Math.cos(th), cy = 50 + 45 * Math.sin(th);
    const el = document.createElement(s.onClick ? 'button' : 'div');
    if (s.onClick) { (el as HTMLButtonElement).type = 'button'; el.addEventListener('click', s.onClick); el.setAttribute('aria-pressed', String(!!s.sel)); }
    el.className = 'pseat' + (s.me ? ' me' : '') + (s.out ? ' folded' : '') + (s.hl ? ' villain' : '') + (s.sel ? ' sel' : '');
    const cards = s.cards === 'back' ? cardEl(null).outerHTML + cardEl(null).outerHTML : Array.isArray(s.cards) && s.cards.length ? s.cards.map((c) => cardEl(c).outerHTML).join('') : '';
    el.innerHTML = (cards ? `<div class="cards pcards">${cards}</div>` : '') + `<div class="pname"><span>${esc(s.name)}</span>${s.pos ? `<span class="ppos">${esc(s.pos)}</span>` : ''}</div>` +
      (s.stack != null && s.stack !== '' ? `<div class="pstack mono">${esc(s.stack)}</div>` : '') + (s.state ? `<div class="pstate">${esc(s.state)}</div>` : '');
    el.style.left = cx + '%'; el.style.top = cy + '%';
    T.appendChild(el);
    if (s.bet) {
      const b = document.createElement('div');
      b.className = 'pbet mono';
      b.innerHTML = '<i></i>' + esc(s.bet);
      b.style.left = 50 + 26 * Math.cos(th) + '%'; b.style.top = 50 + 26 * Math.sin(th) + '%';
      T.appendChild(b);
    }
    if (s.dealer) {
      const d = document.createElement('div');
      d.className = 'pdealer'; d.textContent = 'D'; d.setAttribute('aria-label', 'Dealer button');
      d.style.left = 50 + 29 * Math.cos(th + 0.3) + '%'; d.style.top = 50 + 30 * Math.sin(th + 0.3) + '%';
      T.appendChild(d);
    }
  });
  if (mid) {
    const pe = T.querySelector<HTMLElement>('.pm-pot'), be = T.querySelector<HTMLElement>('.pm-board'), te = T.querySelector<HTMLElement>('.pm-total');
    if (pe) pe.textContent = mid.pot || '';
    if (be) { if (mid.board && mid.board.length) showCards(be, mid.board); else be.innerHTML = ''; }
    if (te) te.textContent = mid.total || '';
  }
}
