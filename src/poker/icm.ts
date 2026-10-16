/** Malmuth–Harville ICM: expected prize for each stack. */
export function icm(stacks: readonly number[], pay: readonly number[]): number[] {
  const n = stacks.length;
  const memo = new Map<number, number[]>();
  function rec(mask: number, place: number): number[] {
    if (place >= pay.length || mask === 0) return new Array(n).fill(0);
    const hit = memo.get(mask);
    if (hit) return hit;
    let tot = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) tot += stacks[i];
    const ev = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const p = stacks[i] / tot;
      if (!p) continue;
      ev[i] += p * pay[place];
      const sub = rec(mask & ~(1 << i), place + 1);
      for (let k = 0; k < n; k++) ev[k] += p * sub[k];
    }
    memo.set(mask, ev);
    return ev;
  }
  return rec((1 << n) - 1, 0);
}

/** ICM where a busted player takes the payout for the place they finished in. */
export function icmWithBust(stacks: readonly number[], pay: readonly number[], bustedIdx: number | null): number[] {
  const alive = stacks.map((_, i) => i).filter((i) => stacks[i] > 0);
  const ev = new Array(stacks.length).fill(0);
  const sub = icm(alive.map((i) => stacks[i]), pay);
  alive.forEach((i, k) => (ev[i] = sub[k]));
  if (bustedIdx != null) ev[bustedIdx] = pay[alive.length] || 0;
  return ev;
}

export interface CallAnalysis {
  /** Equity needed to call the shove, under ICM. */
  required: number;
  /** Extra equity over a cash game's 50% that ICM demands. */
  riskPremium: number;
  fold: number;
  win: number;
  lose: number;
  effective: number;
}

/** Hero (index hi) facing an all-in from villain (index vi), heads-up for the effective stack. */
export function icmCall(stacks: readonly number[], pay: readonly number[], hi: number, vi: number): CallAnalysis {
  const eff = Math.min(stacks[hi], stacks[vi]);
  const fold = icm(stacks, pay)[hi];
  const winS = stacks.slice();
  winS[hi] += eff; winS[vi] -= eff;
  const loseS = stacks.slice();
  loseS[hi] -= eff; loseS[vi] += eff;
  const win = icmWithBust(winS, pay, winS[vi] === 0 ? vi : null)[hi];
  const lose = icmWithBust(loseS, pay, loseS[hi] === 0 ? hi : null)[hi];
  const required = (fold - lose) / (win - lose);
  return { required, riskPremium: required - 0.5, fold, win, lose, effective: eff };
}
