import { describe, expect, it } from 'vitest';
import { ALL_CLASSES, classCombos, combosFor, rangePct, topRange } from '../../src/poker/handclasses';
import {
  ALLIN, RANGES, VS_3B, VS_OPEN, behindOf, bucketOf, chartAction, expandRange, groupOf, needEq, seatList, spotSets, validRaisers,
} from '../../src/poker/ranges';

describe('expandRange notation', () => {
  it('pairs plus', () => expect([...expandRange('QQ+')].sort()).toEqual(['AA', 'KK', 'QQ']));
  it('pair spans', () => expect([...expandRange('66-88')].sort()).toEqual(['66', '77', '88']));
  it('suited/offsuit plus', () => {
    expect([...expandRange('A9s+')].sort()).toEqual(['A9s', 'AJs', 'AKs', 'AQs', 'ATs']);
    expect([...expandRange('KQo')]).toEqual(['KQo']);
  });
  it('spans', () => expect([...expandRange('A5s-A3s')].sort()).toEqual(['A3s', 'A4s', 'A5s']));
  it('ignores empties', () => expect(expandRange('').size).toBe(0));
});

describe('hand classes', () => {
  it('169 classes covering all 1326 combos', () => {
    expect(ALL_CLASSES.length).toBe(169);
    expect(ALL_CLASSES.reduce((a, c) => a + classCombos(c).length, 0)).toBe(1326);
    expect(combosFor(null).length).toBe(1326);
  });
  it('combo counts: pair 6, suited 4, offsuit 12', () => {
    expect(classCombos('AA').length).toBe(6);
    expect(classCombos('AKs').length).toBe(4);
    expect(classCombos('AKo').length).toBe(12);
  });
  it('topRange(x) covers about x of all combos and starts with the best hands', () => {
    expect(rangePct(topRange(0.1))).toBeGreaterThanOrEqual(0.1);
    expect(rangePct(topRange(0.1))).toBeLessThan(0.13);
    expect(topRange(0.03).has('AA')).toBe(true);
    expect(topRange(0.03).has('72o')).toBe(false);
  });
});

describe('opening ranges', () => {
  it('get wider as fewer players are behind (key 1 is the small blind, deliberately tighter than the button)', () => {
    for (let k = 2; k < 8; k++) expect(rangePct(RANGES[k])).toBeGreaterThan(rangePct(RANGES[k + 1]));
    expect(rangePct(RANGES[1])).toBeLessThan(rangePct(RANGES[2]));
  });
  it('UTG (8 behind) ≈ 10–13% of hands; button (2 behind) ≈ 38–46%', () => {
    expect(rangePct(RANGES[8])).toBeGreaterThan(0.1);
    expect(rangePct(RANGES[8])).toBeLessThan(0.13);
    expect(rangePct(RANGES[2])).toBeGreaterThan(0.38);
    expect(rangePct(RANGES[2])).toBeLessThan(0.46);
  });
  it('each tighter range is contained in the next wider one', () => {
    const a = RANGES[7];
    for (const h of RANGES[8]) if (!['A5s'].includes(h)) expect(a.has(h)).toBe(true);
  });
  it('heads-up button opens most hands', () => expect(rangePct(RANGES.HU)).toBeGreaterThan(0.7));
  it('premium pairs/AK are in every range, 72o is in none', () => {
    for (const k of Object.keys(RANGES)) {
      expect(RANGES[k].has('AA')).toBe(true);
      expect(RANGES[k].has('AKs')).toBe(true);
      expect(RANGES[k].has('72o')).toBe(false);
    }
  });
});

describe('seats', () => {
  it('seatList for 9 and 6 handed', () => {
    expect(seatList(9)).toEqual(['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(seatList(6)).toEqual(['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(seatList(2)).toEqual(['BTN', 'BB']);
  });
  it('behindOf counts players left to act', () => {
    expect(behindOf('UTG', 9)).toBe(8);
    expect(behindOf('BTN', 9)).toBe(2);
    expect(behindOf('BB', 9)).toBe(0);
    expect(behindOf('XX', 9)).toBeNull();
  });
  it('groups', () => {
    expect(groupOf('UTG', 9)).toBe('E');
    expect(groupOf('CO', 9)).toBe('L');
    expect(groupOf('SB', 9)).toBe('S');
    expect(groupOf('BB', 9)).toBeNull();
    expect(groupOf('BTN', 2)).toBe('H');
  });
  it('validRaisers excludes the BB and anyone after you', () => {
    expect(validRaisers('BTN', 6)).toEqual(['LJ', 'HJ', 'CO']);
    expect(validRaisers('UTG', 9)).toEqual([]);
  });
});

describe('spotSets & chartAction', () => {
  it('open: UTG raises AA, folds 72o; BB has no opening range', () => {
    const s = spotSets('open', 'UTG', null, 9)!;
    expect(chartAction(s, 'AA')).toBe('raise');
    expect(chartAction(s, '72o')).toBe('fold');
    expect(spotSets('open', 'BB', null, 9)).toBeNull();
  });
  it('vs open: BB defends wide against a BTN raise, 3-bets QQ, calls 87s, folds 72o', () => {
    const s = spotSets('vsopen', 'BB', 'BTN', 9)!;
    expect(chartAction(s, 'QQ')).toBe('raise');
    expect(chartAction(s, '87s')).toBe('call');
    expect(chartAction(s, '72o')).toBe('fold');
  });
  it('call and raise sets never overlap', () => {
    for (const g of Object.keys(VS_OPEN)) for (const t of Object.values(VS_OPEN[g])) for (const h of t!.r) expect(t!.c.has(h)).toBe(false);
    for (const g of Object.keys(VS_3B)) for (const h of VS_3B[g as 'E'].r) expect(VS_3B[g as 'E'].c.has(h)).toBe(false);
  });
  it('vs 3-bet: early opener 4-bets KK, folds AJo', () => {
    const s = spotSets('vs3b', 'UTG', null, 9)!;
    expect(chartAction(s, 'KK')).toBe('raise');
    expect(chartAction(s, 'AJo')).toBe('fold');
  });
  it('all-in calling range widens as the shove gets smaller and the shover later', () => {
    expect(ALLIN.E[10].size).toBeGreaterThan(ALLIN.E[30].size);
    expect(ALLIN.H[15].size).toBeGreaterThan(ALLIN.E[15].size);
    const s = spotSets('allin', 'BB', 'UTG', 9, 30)!;
    expect(chartAction(s, 'AA')).toBe('raise');
    expect(chartAction(s, 'A9o')).toBe('fold');
  });
  it('bucketOf', () => {
    expect([5, 10, 12, 15, 20, 25, 26, 80].map(bucketOf)).toEqual([10, 10, 15, 15, 20, 20, 30, 30]);
  });
  it('needEq is between 0 and 1 and smaller for the BB', () => {
    const sb = needEq(12, 9, false), bb = needEq(12, 9, true);
    expect(sb).toBeGreaterThan(0.3); expect(sb).toBeLessThan(0.6);
    expect(bb).toBeLessThan(sb);
  });
});
