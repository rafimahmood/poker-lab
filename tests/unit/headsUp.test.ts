import { describe, expect, it } from 'vitest';
import { type HUAct, type HUStart, liveText, simulate } from '../../src/poker/headsUp';
import { parseHandFile } from '../../src/poker/handHistory';

const st: HUStart = { id: '1', time: Date.UTC(2026, 0, 1), n: 1, names: { h: 'Me', v: 'Sam' }, btn: 'h', sb: 0.1, bb: 0.2, stacks: { h: 20, v: 20 } };
const A = (type: 'fold' | 'check' | 'call' | 'raise', amt?: number): HUAct => ({ t: 'act', type, amt });

describe('heads-up simulator', () => {
  it('posts blinds and the button acts first preflop', () => {
    const S = simulate(st, []);
    expect(S.toAct).toBe('h');
    expect(S.comm).toEqual({ h: 0.1, v: 0.2 });
    expect(S.potNow).toBeCloseTo(0.3);
  });
  it('fold ends the hand and awards the pot (uncalled bet returned)', () => {
    const S = simulate(st, [A('raise', 0.5), A('fold')]);
    expect(S.phase).toBe('done');
    expect(S.winner).toBe('h');
    expect(S.stacks.h).toBeCloseTo(20.2);
    expect(S.stacks.v).toBeCloseTo(19.8);
  });
  it('limp + check moves to the flop with the big blind acting first', () => {
    const S = simulate(st, [A('call'), A('check')]);
    expect(S.phase).toBe('board');
    expect(S.next).toBe('flop');
    const S2 = simulate(st, [A('call'), A('check'), { t: 'board', cards: 'Qh 7c 2d' }]);
    expect(S2.phase).toBe('act');
    expect(S2.toAct).toBe('v');
    expect(S2.street).toBe('flop');
  });
  it('all-in and call runs out the board then goes to showdown', () => {
    const S = simulate(st, [A('raise', 20), A('call'), { t: 'board', cards: 'Qh 7c 2d' }, { t: 'board', cards: '9s' }, { t: 'board', cards: 'Kd' }]);
    expect(S.phase).toBe('showdown');
    expect(S.runout).toBe(true);
    const done = simulate(st, [A('raise', 20), A('call'), { t: 'board', cards: 'Qh 7c 2d' }, { t: 'board', cards: '9s' }, { t: 'board', cards: 'Kd' }, { t: 'sd', winner: 'h', hero: 'Ah Ad', opp: 'Kc Kh' }]);
    expect(done.stacks.h).toBe(40);
    expect(done.stacks.v).toBe(0);
  });
  it('split pot divides the pot', () => {
    const S = simulate(st, [A('raise', 20), A('call'), { t: 'board', cards: 'Qh 7c 2d' }, { t: 'board', cards: '9s' }, { t: 'board', cards: 'Kd' }, { t: 'sd', winner: 'split', hero: '', opp: '' }]);
    expect(S.stacks.h).toBe(20);
    expect(S.stacks.v).toBe(20);
  });
  it('conserves chips', () => {
    const S = simulate(st, [A('raise', 0.6), A('raise', 1.8), A('call'), { t: 'board', cards: 'Qh 7c 2d' }, A('check'), A('raise', 1), A('fold')]);
    expect(S.phase).toBe('done');
    expect(S.stacks.h + S.stacks.v).toBeCloseTo(40); // pot already paid out
    const mid = simulate(st, [A('raise', 0.6), A('raise', 1.8), A('call'), { t: 'board', cards: 'Qh 7c 2d' }, A('check')]);
    expect(mid.stacks.h + mid.stacks.v + mid.total.h + mid.total.v + mid.comm.h + mid.comm.v).toBeCloseTo(40);
  });
  it('generates text the hand-history parser reads back, with the right net result', () => {
    const acts: HUAct[] = [A('raise', 0.5), A('fold')];
    const S = simulate(st, acts);
    const [h] = parseHandFile(liveText(st, S, 'Ah Kd'));
    expect(h).toBeTruthy();
    expect(h.c).toBe('AhKd');
    expect(h.pos).toBe('SB');
    expect(h.n).toBe(2);
    expect(h.nbb).toBeCloseTo(1); // won the big blind
  });
});
