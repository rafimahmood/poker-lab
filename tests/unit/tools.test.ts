import { describe, expect, it } from 'vitest';
import { TOOL_DEFS, runTool } from '../../netlify/functions/_lib/tools';

const call = (name: string, args: unknown, ctx = {}) => JSON.parse(runTool(name, typeof args === 'string' ? args : JSON.stringify(args), ctx));
const hh = `PokerStars Hand #250000000001: Tournament #3000000001, $1.00+$0.10 USD Hold'em No Limit - Level I (10/20) - 2025/03/01 20:15:00 ET
Table '3000000001 1' 6-max Seat #3 is the button
Seat 1: Alice (1500 in chips)
Seat 2: Hero (1500 in chips)
Seat 3: Bob (1500 in chips)
Seat 4: Carol (1500 in chips)
Carol: posts small blind 10
Alice: posts big blind 20
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Hero: raises 40 to 60
Bob: folds
Carol: folds
Alice: folds
Uncalled bet (40) returned to Hero
Hero collected 50 from pot
*** SUMMARY ***`;

describe('tool definitions', () => {
  it('are well-formed function tools with unique names', () => {
    const names = TOOL_DEFS.map((t) => t.function.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['parse_hand_history', 'lookup_range', 'calc_equity', 'calc_icm', 'pot_odds', 'get_my_stats']));
    for (const t of TOOL_DEFS) { expect(t.type).toBe('function'); expect(t.function.parameters.type).toBe('object'); }
  });
});

describe('calc_equity', () => {
  it('AhKh vs QsQd is about 46%', () => {
    const r = call('calc_equity', { hero: 'AhKh', villain: 'QsQd' });
    expect(r.equity).toBeGreaterThan(0.43);
    expect(r.equity).toBeLessThan(0.49);
  });
  it('supports a villain range', () => {
    const r = call('calc_equity', { hero: 'AhAd', villain_range: 'KK,QQ,AKs' });
    expect(r.equity).toBeGreaterThan(0.7);
    expect(r.range_percent_of_hands).toBeGreaterThan(0);
  });
  it('supports random opponents and a board', () => {
    const r = call('calc_equity', { hero: 'AhAd', opponents: 3, board: '2c7d9s' });
    expect(r.equity).toBeGreaterThan(0.5);
  });
  it.each([
    [{ hero: 'Ah' }, /exactly 2|needs 2/],
    [{ hero: 'AhKh', villain: 'AhQd' }, /same card/],
    [{ hero: 'AhKh', board: '2c7d' }, /board needs/],
    [{ hero: 'Zz9s' }, /isn't a card/],
    [{ hero: 'AhKh', villain_range: 'garbage' }, /could not be read/],
  ])('rejects bad input %j', (args, msg) => expect(call('calc_equity', args).error).toMatch(msg as RegExp));
});

describe('lookup_range', () => {
  it('UTG opens AKs but not 72o (9-handed)', () => {
    expect(call('lookup_range', { players: 9, position: 'UTG', situation: 'open', hand: 'AhKh' }).chart_action).toBe('Raise');
    expect(call('lookup_range', { players: 9, position: 'UTG', situation: 'open', hand: '72o' }).chart_action).toBe('Fold');
  });
  it('BB vs BTN raise: 87s is a call', () => {
    const r = call('lookup_range', { players: 9, position: 'BB', situation: 'vs_open', raiser: 'BTN', hand: '87s' });
    expect(r.chart_action).toBe('Call');
    expect(r.percent_of_hands_continuing).toBeGreaterThan(20);
  });
  it('validates seats and raisers', () => {
    expect(call('lookup_range', { players: 6, position: 'UTG', situation: 'open' }).error).toMatch(/position must be one of/);
    expect(call('lookup_range', { players: 9, position: 'BB', situation: 'vs_open', raiser: 'BB' }).error).toMatch(/raiser must be/);
    expect(call('lookup_range', { players: 9, position: 'BB', situation: 'open' }).error).toMatch(/No chart/);
  });
  it('all-in ranges depend on stack depth', () => {
    const small = call('lookup_range', { players: 9, position: 'BB', situation: 'vs_allin', raiser: 'BTN', stack_bb: 8 });
    const big = call('lookup_range', { players: 9, position: 'BB', situation: 'vs_allin', raiser: 'BTN', stack_bb: 40 });
    expect(small.percent_of_hands_continuing).toBeGreaterThan(big.percent_of_hands_continuing);
  });
});

describe('calc_icm / pot_odds / parse / stats', () => {
  it('icm equities sum to the prize pool and give a call price', () => {
    const r = call('calc_icm', { stacks: [18000, 12500, 9000, 6000, 3500], payouts: [250, 150, 100], hero: 2, villain: 0 });
    const sum = r.prize_equity.reduce((a: number, p: { equity: number }) => a + p.equity, 0);
    expect(sum).toBeCloseTo(500, 0);
    expect(r.call_analysis.equity_needed_to_call).toBeGreaterThan(0.5);
  });
  it('icm rejects bad input', () => {
    expect(call('calc_icm', { stacks: [100], payouts: [1] }).error).toBeTruthy();
    expect(call('calc_icm', { stacks: [100, -5], payouts: [1] }).error).toBeTruthy();
    expect(call('calc_icm', { stacks: [100, 100], payouts: [1], hero: 0, villain: 0 }).error).toMatch(/different/);
  });
  it('pot odds', () => {
    expect(call('pot_odds', { pot: 100, to_call: 50 }).percent).toBeCloseTo(33.3, 1);
    expect(call('pot_odds', { pot: 100, to_call: 0 }).error).toBeTruthy();
  });
  it('parses a pasted hand history', () => {
    const r = call('parse_hand_history', { text: hh });
    expect(r.count).toBe(1);
    expect(r.hands[0]).toMatchObject({ hero_cards: 'AhKd', hand_class: 'AKo', position: 'CO', result_bb: 1.5 });
    expect(call('parse_hand_history', { text: 'hello' }).error).toMatch(/No Hold'em/);
  });
  it('get_my_stats returns the client digest or a hint', () => {
    expect(call('get_my_stats', {}, { stats: { vpip: 0.3 } })).toEqual({ vpip: 0.3 });
    expect(call('get_my_stats', {}).note).toMatch(/not imported/);
  });
});

describe('robustness', () => {
  it('unknown tools and bad JSON return errors, never throw', () => {
    expect(call('rm_rf', {}).error).toMatch(/Unknown tool/);
    expect(JSON.parse(runTool('calc_equity', '{not json')).error).toMatch(/valid JSON/);
    expect(JSON.parse(runTool('calc_equity', '')).error).toBeTruthy();
  });
  it('caps result size', () => {
    const big = 'x'.repeat(50000);
    expect(runTool('get_my_stats', {}, { stats: { big } }).length).toBeLessThan(7000);
  });
});
