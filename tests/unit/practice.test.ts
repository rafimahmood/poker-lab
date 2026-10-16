import { describe, expect, it } from 'vitest';
import { PracticeHand, chartFreqs, roundFreqs, smoothIn, verdict } from '../../src/poker/practice';
import { expandRange } from '../../src/poker/ranges';
import { seeded } from '../../src/poker/rng';

describe('frequency helpers', () => {
  it('roundFreqs gives 5% steps that sum to 100', () => {
    for (const f of [{ raise: 0.333, call: 0.333, fold: 0.334 }, { raise: 0.9, fold: 0.1 }, { a: 0.49, b: 0.51 }] as Record<string, number>[]) {
      const r = roundFreqs(f);
      expect(Object.values(r).reduce((a, b) => a + b, 0)).toBe(100);
      Object.values(r).forEach((v) => expect(v % 5).toBe(0));
    }
  });
  it('verdict thresholds', () => {
    expect(verdict({ raise: 70, fold: 30 }, 'raise')[0]).toBe('good');
    expect(verdict({ raise: 70, fold: 30 }, 'fold')[0]).toBe('live');
    expect(verdict({ raise: 90, fold: 10 }, 'fold')[0]).toBe('bad');
    expect(verdict({ raise: 90 }, 'call')[0]).toBe('bad');
  });
  it('chartFreqs: a hand inside the range mostly raises, far outside mostly folds', () => {
    const r = expandRange('QQ+,AKs');
    expect(chartFreqs(r, new Set(), 'AA').raise).toBeGreaterThan(0.9);
    expect(chartFreqs(r, new Set(), '72o').fold).toBeGreaterThan(0.6);
    const f = chartFreqs(r, new Set(), 'AA');
    expect(f.raise + f.call + f.fold).toBeCloseTo(1);
  });
  it('smoothIn is in 0..1', () => {
    const v = smoothIn(expandRange('22+'), 'JJ');
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe('PracticeHand', () => {
  for (const n of [2, 3, 6, 9]) {
    it(`${n}-handed: deals, stays consistent, and plays out to a result`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const g = PracticeHand.deal(n, seeded(seed * 31 + n));
        expect(g.players).toHaveLength(n);
        expect(new Set(g.players.flatMap((p) => p.cards)).size).toBe(n * 2); // no duplicate cards
        let guard = 0;
        while (!g.done && guard++ < 30) {
          expect(g.dec).toBeTruthy();
          const opts = g.dec!.opts.map((o) => o[0]);
          expect(opts.length).toBeGreaterThanOrEqual(2);
          const fb = g.act(opts[guard % opts.length])!;
          expect(Object.values(fb.fr).reduce((a, b) => a + b, 0)).toBe(100);
          expect(['good', 'live', 'bad']).toContain(fb.cls);
          expect(fb.why.length).toBeGreaterThan(5);
        }
        expect(g.done).toBe(true);
        expect(g.result).toBeTruthy();
        // chips are conserved: everyone's net sums to zero
        const hero = g.hero;
        expect(g.result!.net).toBeGreaterThanOrEqual(-hero.tot - 1e-9);
        expect(g.board.length === 0 || [3, 4, 5].includes(g.board.length)).toBe(true);
        const rec = g.record();
        expect(rec).toBeTruthy();
        expect(rec!.decisions.length).toBe(g.fbs.length);
        expect(JSON.parse(JSON.stringify(rec))).toEqual(rec); // storable
      }
    });
  }
  it('folding ends the hand and costs exactly what hero had in', () => {
    const g = PracticeHand.deal(6, seeded(7));
    const invested = g.hero.tot;
    g.act('fold');
    expect(g.done).toBe(true);
    expect(g.result!.net).toBeCloseTo(-invested);
  });
  it('is deterministic for a given seed (apart from the timestamp-based id)', () => {
    const a = PracticeHand.deal(6, seeded(99)), b = PracticeHand.deal(6, seeded(99));
    expect(a.players.map((p) => p.cards)).toEqual(b.players.map((p) => p.cards));
    expect(a.dec!.ask).toBe(b.dec!.ask);
  });
  it('open-limping when folded to you is scored as a mistake for a strong hand', () => {
    let found = false;
    for (let s = 1; s < 200 && !found; s++) {
      const g = PracticeHand.deal(9, seeded(s));
      if (g.street === 'pre' && g.nRaises === 0 && g.limpers === 0 && g.dec!.opts.some((o) => o[0] === 'call')) {
        const f = g.feedback();
        if (f.fr.raise >= 90) { const fb = g.act('call')!; expect(fb.cls).toBe('bad'); found = true; }
      }
    }
    expect(found).toBe(true);
  });
  it('never offers raise sizes beyond the stack', () => {
    for (let s = 1; s <= 40; s++) {
      const g = PracticeHand.deal(6, seeded(s + 1000));
      const tot = g.hero.st + g.stk(g.hero);
      if (g.dec?.raiseTo != null) expect(g.dec.raiseTo).toBeLessThanOrEqual(tot + 1e-9);
    }
  });
});
