import { describe, expect, it } from 'vitest';
import { coachHU, tourPostSuggestion, tourPreSuggestion } from '../../src/poker/coachEngine';
import { parseCards } from '../../src/poker/cards';
import { type HUStart, simulate } from '../../src/poker/headsUp';
import { seeded } from '../../src/poker/rng';

const st: HUStart = { id: '1', time: 0, n: 1, names: { h: 'Me', v: 'Sam' }, btn: 'h', sb: 0.1, bb: 0.2, stacks: { h: 20, v: 20 } };
const c = (s: string) => parseCards(s).cards!;

describe('tournament preflop coach', () => {
  const base = { sit: 'folded' as const, pos: 'UTG', n: 9, myBB: 40, sitSeat: null, sitBB: 15, limpers: 1 };
  it('raises AA and folds 72o from UTG', () => {
    expect(tourPreSuggestion({ ...base, cards: 'AhAd' })!.act).toBe('raise');
    expect(tourPreSuggestion({ ...base, cards: '7h2d' })!.act).toBe('fold');
  });
  it('is shove-or-fold when short', () => {
    expect(tourPreSuggestion({ ...base, myBB: 8, pos: 'BTN', cards: 'AhKd' })!.act).toBe('allin');
    expect(tourPreSuggestion({ ...base, myBB: 8, pos: 'UTG', cards: '7h2d' })!.act).toBe('fold');
  });
  it('big blind just checks when folded to', () => expect(tourPreSuggestion({ ...base, pos: 'BB', cards: '7h2d' })!.act).toBe('check'));
  it('re-raises QQ over a CO raise and folds 72o', () => {
    expect(['reraise', 'allin']).toContain(tourPreSuggestion({ ...base, sit: 'raised', pos: 'BTN', sitSeat: 'CO', cards: 'QhQd', myBB: 60 })!.act);
    expect(tourPreSuggestion({ ...base, sit: 'raised', pos: 'BTN', sitSeat: 'CO', cards: '7h2d' })!.act).toBe('fold');
  });
  it('calls an all-in with AA and folds 72o using equity vs range', () => {
    const rng = seeded(1);
    const a = tourPreSuggestion({ ...base, sit: 'allin', pos: 'BB', sitSeat: 'BTN', sitBB: 12, cards: 'AhAd' }, rng)!;
    expect(a.act).toBe('call');
    expect(a.eq!).toBeGreaterThan(a.need!);
    expect(tourPreSuggestion({ ...base, sit: 'allin', pos: 'BB', sitSeat: 'UTG', sitBB: 30, myBB: 40, cards: '7h2d' }, rng)!.act).toBe('fold');
  });
  it('raises limpers with strong hands, checks the BB option', () => {
    expect(tourPreSuggestion({ ...base, sit: 'limped', pos: 'CO', cards: 'KhKd', limpers: 2 })!.label).toBe('Raise to 5 BB');
    expect(tourPreSuggestion({ ...base, sit: 'limped', pos: 'BB', cards: '7h2d' })!.act).toBe('check');
  });
  it('4-bets KK over a 3-bet', () => expect(['reraise', 'allin']).toContain(tourPreSuggestion({ ...base, sit: '3bet', pos: 'CO', cards: 'KhKd' })!.act));
  it('returns null until it has cards and a situation', () => {
    expect(tourPreSuggestion({ ...base, cards: '' })).toBeNull();
    expect(tourPreSuggestion({ ...base, sit: null, cards: 'AhAd' })).toBeNull();
  });
});

describe('tournament postflop coach', () => {
  const base = { pos: 'BTN', n: 6, sit: 'raised' as const, sitSeat: 'CO', heroRaised: false, toCall: 0, pot: 1000, opps: 1, bb: 200 };
  it('bets a made monster, gives up with air', () => {
    expect(tourPostSuggestion({ ...base, hero: c('AhAd'), board: c('Ac 7d 2s') }, seeded(2)).act).toBe('raise');
    expect(tourPostSuggestion({ ...base, hero: c('7h2d'), board: c('Ac Kd Qs') }, seeded(2)).act).toBe('check');
  });
  it('folds air to a big bet and calls with a good price', () => {
    expect(tourPostSuggestion({ ...base, hero: c('7h2d'), board: c('Ac Kd Qs'), toCall: 900 }, seeded(3)).act).toBe('fold');
    const flushDraw = tourPostSuggestion({ ...base, hero: c('AhKh'), board: c('Qh 7h 2c'), toCall: 100, pot: 1200 }, seeded(3));
    expect(['call', 'raise']).toContain(flushDraw.act);
  });
});

describe('heads-up coach', () => {
  it('needs hero cards', () => expect(coachHU(st, simulate(st, []), [], '')).toBeNull());
  it('button raises a strong hand and folds the very worst', () => {
    const S = simulate(st, []);
    expect(coachHU(st, S, [], 'Ah Kd', seeded(1))!.act).toBe('raise');
    expect(coachHU(st, S, [], '7h 2d', seeded(1))!.act).toBe('fold');
  });
  it('shoves short stacks with a good hand', () => {
    const short = { ...st, stacks: { h: 2, v: 2 } };
    expect(coachHU(short, simulate(short, []), [], 'Ah Ad', seeded(1))!.act).toBe('raise');
  });
  it('big blind calls or re-raises a button raise with a good hand, folds trash', () => {
    const b: HUStart = { ...st, btn: 'v' };
    const acts = [{ t: 'act', type: 'raise', amt: 0.5 } as const];
    const S = simulate(b, acts);
    expect(['raise', 'call']).toContain(coachHU(b, S, acts, 'Ah Qd', seeded(1))!.act);
    expect(coachHU(b, S, acts, '7h 2d', seeded(1))!.act).toBe('fold');
  });
  it('facing a big all-in uses equity vs range', () => {
    const b: HUStart = { ...st, btn: 'v', stacks: { h: 10, v: 10 } };
    const acts = [{ t: 'act', type: 'raise', amt: 10 } as const];
    const S = simulate(b, acts);
    const aa = coachHU(b, S, acts, 'Ah Ad', seeded(1))!;
    expect(aa.act).toBe('call');
    expect(aa.eq!).toBeGreaterThan(0.6);
  });
});
