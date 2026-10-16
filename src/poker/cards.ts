import { type Rng, shuffle } from './rng';

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';
export const SYM: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

/** A card is an integer 0..51: rank * 4 + suit index (c,d,h,s). */
export type Card = number;

export type ParseResult = { cards: Card[]; error?: undefined } | { error: string; cards?: undefined };

export function parseCards(str: string | null | undefined): ParseResult {
  const s = (str || '')
    .replace(/10/g, 'T')
    .replace(/♣/g, 'c')
    .replace(/♦/g, 'd')
    .replace(/♥/g, 'h')
    .replace(/♠/g, 's')
    .replace(/[\s,]+/g, '');
  if (s.length % 2) return { error: 'Each card needs a rank and a suit, like Ah or 7c.' };
  const out: Card[] = [];
  for (let i = 0; i < s.length; i += 2) {
    const r = RANKS.indexOf(s[i].toUpperCase());
    const su = SUITS.indexOf(s[i + 1].toLowerCase());
    if (r < 0 || su < 0)
      return { error: `"${s.slice(i, i + 2)}" isn't a card. Use ranks 2–9, T, J, Q, K, A and suits c, d, h, s.` };
    out.push(r * 4 + su);
  }
  return { cards: out };
}

export const cardRank = (c: Card) => c >> 2;
export const cardSuit = (c: Card) => c & 3;
export const cardName = (c: Card) => RANKS[c >> 2] + SUITS[c & 3];
export const cardsToString = (cs: readonly Card[]) => cs.map(cardName).join(' ');

export function deckWithout(used: readonly Card[]): Card[] {
  const u = new Set(used);
  const d: Card[] = [];
  for (let c = 0; c < 52; c++) if (!u.has(c)) d.push(c);
  return d;
}

export const freshDeck = (rng?: Rng) => shuffle(deckWithout([]), rng);

/** Starting-hand class like "AKs", "QJo", "88". */
export function handClass(c1: Card, c2: Card): string {
  const r1 = c1 >> 2, r2 = c2 >> 2;
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  if (hi === lo) return RANKS[hi] + RANKS[hi];
  return RANKS[hi] + RANKS[lo] + ((c1 & 3) === (c2 & 3) ? 's' : 'o');
}
