import { describe, expect, it } from 'vitest';
import { parseCards } from '../../src/poker/cards';
import { equity, equityVs } from '../../src/poker/equity';
import { combosFor } from '../../src/poker/handclasses';
import { seeded } from '../../src/poker/rng';

const c = (s: string) => parseCards(s).cards!;
const eq = (h: string, v: string, b = '', iterations = 20000) =>
  equity({ hero: c(h), villain: v ? c(v) : undefined, board: b ? c(b) : [], iterations, rng: seeded(42) });

describe('equity (Monte Carlo, seeded)', () => {
  it('AA vs KK ≈ 81–82%', () => expect(eq('AhAd', 'KsKc').equity).toBeCloseTo(0.82, 1));
  it('AKs vs QQ is a coin flip ≈ 46%', () => expect(eq('AhKh', 'QsQd').equity).toBeCloseTo(0.46, 1));
  it('AKo vs 22 ≈ 47%', () => expect(eq('AhKd', '2s2c').equity).toBeCloseTo(0.47, 1));
  it('AA vs a random hand ≈ 85%', () => expect(equity({ hero: c('AhAd'), opponents: 1, iterations: 20000, rng: seeded(1) }).equity).toBeCloseTo(0.85, 1));
  it('is ~100% for the nuts on the river and ~0 for dead', () => {
    expect(eq('AhKh', 'QsQd', 'Qh Jh Th 2c 3d', 200).equity).toBe(1);
    expect(eq('2c3d', 'AsAd', 'Kh Qh 9h 5c 7d', 200).equity).toBe(0);
  });
  it('splits a tied board: 0.5 equity, all tie', () => {
    const r = eq('2c3d', '4c5d', 'As Ks Qs Js Ts', 100);
    expect(r.equity).toBe(0.5);
    expect(r.tie).toBe(0.5); // a two-way split counts as half a win each
    expect(r.win).toBe(0);
  });
  it('flush draw on the flop ≈ 35% to improve and wins ≈ 54% vs top pair', () => {
    const r = eq('AhKh', 'QsQd', 'Jh 7h 2c', 20000);
    expect(r.equity).toBeGreaterThan(0.5);
    expect(r.equity).toBeLessThan(0.6);
  });
  it('is reproducible with the same seed', () => {
    expect(eq('AhKh', 'QsQd').equity).toBe(eq('AhKh', 'QsQd').equity);
  });
  it('probabilities and distribution sum to 1', () => {
    const r = eq('AhKh', 'QsQd', '', 2000);
    expect(r.dist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(r.win + r.tie).toBeLessThanOrEqual(1);
  });
  it('more opponents lowers equity', () => {
    const one = equity({ hero: c('AhAd'), opponents: 1, iterations: 5000, rng: seeded(3) }).equity;
    const four = equity({ hero: c('AhAd'), opponents: 4, iterations: 5000, rng: seeded(3) }).equity;
    expect(four).toBeLessThan(one);
  });
});

describe('equityVs (range vs hand)', () => {
  it('AA crushes a broad range', () => {
    const range = combosFor(new Set(['KK', 'QQ', 'AKs', 'AKo']), c('AhAd'));
    expect(equityVs(c('AhAd'), [], [range], 4000, seeded(5))).toBeGreaterThan(0.75);
  });
  it('never gives a villain a dead card', () => {
    const range = combosFor(new Set(['AA']), c('AhAd'));
    expect(range.every(([a, b]) => ![...c('AhAd')].includes(a) && ![...c('AhAd')].includes(b))).toBe(true);
    expect(range.length).toBe(1);
  });
});
