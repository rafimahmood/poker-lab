import { type Card, deckWithout } from './cards';
import { catOf, evalHand } from './evaluator';
import { type Rng, defaultRng } from './rng';
import type { Combo } from './handclasses';

export interface EquityResult {
  equity: number;
  win: number;
  tie: number;
  iterations: number;
  /** How often hero finishes with each hand category (index = category 0..8). */
  dist: number[];
}

export interface EquityInput {
  hero: readonly Card[];
  /** Villain's exact hand; when omitted, `opponents` random hands are dealt. */
  villain?: readonly Card[];
  board?: readonly Card[];
  opponents?: number;
  iterations?: number;
  rng?: Rng;
}

/**
 * Monte Carlo equity for hero vs. one known hand or N random hands.
 * Ties count fractionally (split pot).
 */
export function equity(input: EquityInput): EquityResult {
  const hero = input.hero, vill = input.villain ?? [], board = input.board ?? [];
  const rng = input.rng ?? defaultRng;
  const nOpp = vill.length ? 1 : Math.max(1, input.opponents ?? 1);
  const iters = input.iterations ?? 30000;
  const base = deckWithout([...hero, ...vill, ...board]);
  const needBoard = 5 - board.length;
  const dist = new Array(9).fill(0);
  let win = 0, tie = 0;
  const d = base.slice();
  for (let k = 0; k < iters; k++) {
    let p = d.length;
    const draw = () => {
      const j = (rng() * p) | 0;
      const c = d[j];
      d[j] = d[p - 1];
      d[p - 1] = c;
      p--;
      return c;
    };
    const bd = board.slice();
    for (let i = 0; i < needBoard; i++) bd.push(draw());
    const hv = evalHand([...hero, ...bd]);
    dist[catOf(hv)]++;
    let best = -1, cnt = 0;
    for (let o = 0; o < nOpp; o++) {
      const oh = vill.length ? vill : [draw(), draw()];
      const ov = evalHand([...oh, ...bd]);
      if (ov > best) { best = ov; cnt = 1; } else if (ov === best) cnt++;
    }
    if (hv > best) win++;
    else if (hv === best) tie += 1 / (cnt + 1);
  }
  return { equity: (win + tie) / iters, win: win / iters, tie: tie / iters, iterations: iters, dist: dist.map((x) => x / iters) };
}

/** Hero equity against opponents who each hold a hand drawn from a list of combos. */
export function equityVs(
  hero: readonly Card[],
  board: readonly Card[],
  opps: Combo[][],
  iters = 2500,
  rng: Rng = defaultRng,
): number {
  let win = 0;
  const base = deckWithout([...hero, ...board]);
  for (let it = 0; it < iters; it++) {
    const used = new Set([...hero, ...board]);
    const oh: Combo[] = [];
    let ok = true;
    for (const list of opps) {
      let pick: Combo | null = null;
      for (let tries = 0; tries < 30; tries++) {
        const c = list[(rng() * list.length) | 0];
        if (c && !used.has(c[0]) && !used.has(c[1])) { pick = c; break; }
      }
      if (!pick) { ok = false; break; }
      used.add(pick[0]); used.add(pick[1]); oh.push(pick);
    }
    if (!ok) { it--; iters--; if (iters < 200) break; continue; }
    const rest = base.filter((c) => !used.has(c));
    const bd = board.slice();
    for (let k = bd.length; k < 5; k++) {
      const j = (rng() * rest.length) | 0;
      bd.push(rest[j]);
      rest[j] = rest[rest.length - 1];
      rest.pop();
    }
    const hv = evalHand([...hero, ...bd]);
    let best = -1, cnt = 0;
    for (const o of oh) {
      const v = evalHand([...o, ...bd]);
      if (v > best) { best = v; cnt = 1; } else if (v === best) cnt++;
    }
    if (hv > best) win++;
    else if (hv === best) win += 1 / (cnt + 1);
  }
  return iters > 0 ? win / iters : 0;
}
