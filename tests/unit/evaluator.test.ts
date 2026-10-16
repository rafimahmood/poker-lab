import { describe, expect, it } from 'vitest';
import { parseCards } from '../../src/poker/cards';
import { catName, evalHand } from '../../src/poker/evaluator';

const v = (s: string) => evalHand(parseCards(s).cards!);

describe('evalHand categories', () => {
  const cases: [string, string][] = [
    ['As Kd 9c 5h 3d', 'High card'],
    ['As Ad 9c 5h 3d', 'Pair'],
    ['As Ad 9c 9h 3d', 'Two pair'],
    ['As Ad Ac 5h 3d', 'Three of a kind'],
    ['5s 6d 7c 8h 9d', 'Straight'],
    ['As 2s 9s 5s 3s', 'Flush'],
    ['As Ad Ac 5h 5d', 'Full house'],
    ['As Ad Ac Ah 3d', 'Four of a kind'],
    ['5s 6s 7s 8s 9s', 'Straight flush'],
  ];
  for (const [hand, name] of cases) it(`${hand} is ${name}`, () => expect(catName(v(hand))).toBe(name));

  it('recognises the wheel (A-5 straight) as the lowest straight', () => {
    expect(catName(v('As 2d 3c 4h 5d'))).toBe('Straight');
    expect(v('As 2d 3c 4h 5d')).toBeLessThan(v('2s 3d 4c 5h 6d'));
  });
  it('does not wrap straights around (Q K A 2 3)', () => {
    expect(catName(v('Qs Kd Ac 2h 3d'))).not.toBe('Straight');
  });
  it('finds a straight flush inside 7 cards, not a mere flush', () => {
    expect(catName(v('5s 6s 7s 8s 9s Ad Ac'))).toBe('Straight flush');
  });
  it('prefers a full house over a flush when both are available', () => {
    expect(catName(v('As Ad Ac Ks Kd 2s 3s'))).toBe('Full house');
  });
  it('uses the best of two sets of trips for a full house', () => {
    expect(catName(v('As Ad Ac Ks Kd Kc 2h'))).toBe('Full house');
    expect(v('As Ad Ac Ks Kd Kc 2h')).toBe(v('As Ad Ac Ks Kd 2h 3c'));
  });
});

describe('evalHand ordering and ties', () => {
  it('ranks by category first', () => {
    expect(v('As Ad 9c 5h 3d')).toBeGreaterThan(v('As Kd Qc Jh 9d'));
    expect(v('2s 2d 2c 5h 3d')).toBeGreaterThan(v('As Ad 9c 9h 3d'));
  });
  it('breaks ties with kickers', () => {
    expect(v('As Ad Kc 5h 3d')).toBeGreaterThan(v('As Ad Qc 5h 3d'));
  });
  it('ties when the board plays', () => {
    expect(v('As Ks Qs Js Ts 2d 3c')).toBe(v('As Ks Qs Js Ts 4d 5c'));
  });
  it('ignores the 6th/7th card when it cannot help', () => {
    expect(v('As Ad 9c 5h 3d 2c 7h')).toBe(v('As Ad 9c 7h 5h 3d 2c'));
  });
});
