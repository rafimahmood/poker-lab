import { describe, expect, it } from 'vitest';
import { cardName, deckWithout, handClass, parseCards } from '../../src/poker/cards';

describe('parseCards', () => {
  it('parses spaced, unspaced and symbol cards', () => {
    expect(parseCards('Ah Kd').cards).toEqual(parseCards('AhKd').cards);
    expect(parseCards('A♥ K♦').cards).toEqual(parseCards('Ah Kd').cards);
    expect(parseCards('10s').cards).toEqual(parseCards('Ts').cards);
  });
  it('encodes rank*4+suit', () => {
    expect(parseCards('2c').cards).toEqual([0]);
    expect(parseCards('As').cards).toEqual([51]);
    expect(cardName(51)).toBe('As');
  });
  it('reports errors', () => {
    expect(parseCards('Ah K').error).toMatch(/rank and a suit/);
    expect(parseCards('Xh').error).toMatch(/isn't a card/);
    expect(parseCards('').cards).toEqual([]);
  });
});

describe('handClass', () => {
  const cls = (s: string) => { const c = parseCards(s).cards!; return handClass(c[0], c[1]); };
  it('classifies pairs, suited and offsuit regardless of order', () => {
    expect(cls('AhAd')).toBe('AA');
    expect(cls('KsAs')).toBe('AKs');
    expect(cls('Td9c')).toBe('T9o');
  });
});

describe('deckWithout', () => {
  it('removes used cards', () => {
    expect(deckWithout([0, 1, 2]).length).toBe(49);
    expect(deckWithout([]).length).toBe(52);
  });
});
