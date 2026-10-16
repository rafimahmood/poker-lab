import { describe, expect, it } from 'vitest';
import { icm, icmCall } from '../../src/poker/icm';
import { potOdds, theoryNums } from '../../src/poker/theory';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('icm', () => {
  it('equal stacks get equal equity', () => {
    const ev = icm([1000, 1000, 1000], [50, 30, 20]);
    ev.forEach((x) => expect(x).toBeCloseTo(100 / 3, 6));
  });
  it('prize equities add up to the total prize pool', () => {
    const ev = icm([18000, 12500, 9000, 6000, 3500], [250, 150, 100]);
    expect(sum(ev)).toBeCloseTo(500, 6);
  });
  it('the chip leader has more equity, but less than their chip share of the pool (ICM concavity)', () => {
    const stacks = [7000, 2000, 1000];
    const ev = icm(stacks, [50, 30, 20]);
    expect(ev[0]).toBeGreaterThan(ev[1]);
    expect(ev[1]).toBeGreaterThan(ev[2]);
    expect(ev[0] / 100).toBeLessThan(0.7);
  });
  it('winner-take-all ICM equals chip share', () => {
    const ev = icm([3000, 1000], [100]);
    expect(ev[0]).toBeCloseTo(75, 6);
  });
  it('heads-up with two payouts known value', () => {
    const ev = icm([2000, 1000], [70, 30]);
    expect(ev[0]).toBeCloseTo(2 / 3 * 70 + 1 / 3 * 30, 6);
  });
});

describe('icmCall', () => {
  it('requires more than 50% equity near the bubble, and is bounded', () => {
    const r = icmCall([18000, 12500, 9000, 6000, 3500], [250, 150, 100], 2, 0);
    expect(r.required).toBeGreaterThan(0.5);
    expect(r.required).toBeLessThan(1);
    expect(r.riskPremium).toBeCloseTo(r.required - 0.5, 10);
    expect(r.win).toBeGreaterThan(r.fold);
    expect(r.lose).toBeLessThan(r.fold);
    expect(r.effective).toBe(9000);
  });
  it('winner-take-all is exactly a cash game: 50% for equal stacks', () => {
    const r = icmCall([1000, 1000], [100], 0, 1);
    expect(r.required).toBeCloseTo(0.5, 6);
  });
});

describe('theory', () => {
  it('pot-size bet: caller needs 33%, MDF 50%, bluff must work 50%', () => {
    const n = theoryNums(1);
    expect(n.req).toBeCloseTo(1 / 3, 6);
    expect(n.mdf).toBeCloseTo(0.5, 6);
    expect(n.alpha).toBeCloseTo(0.5, 6);
  });
  it('potOdds', () => expect(potOdds(100, 50)).toBeCloseTo(1 / 3, 6));
});
