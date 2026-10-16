import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { leaks, parseHand, parseHandFile, stats } from '../../src/poker/handHistory';

const ps = readFileSync(new URL('./fixtures/pokerstars.txt', import.meta.url), 'utf8');
const gg = readFileSync(new URL('./fixtures/ggpoker.txt', import.meta.url), 'utf8');

describe('PokerStars parser', () => {
  const hands = parseHandFile(ps);
  it('finds both hands', () => expect(hands.map((h) => h.id)).toEqual(['250000000001', '250000000002']));
  it('reads game, blinds, stack, cards and class', () => {
    const h = hands[0];
    expect(h.site).toBe('PS');
    expect(h.g).toBe('T');
    expect(h.bb).toBe(20);
    expect(h.st).toBe(75);
    expect(h.c).toBe('AhKd');
    expect(h.h).toBe('AKo');
    expect(h.n).toBe(4);
  });
  it('assigns positions around the button', () => {
    expect(hands[0].pos).toBe('CO'); // button seat 3, SB seat 4, BB seat 1, Hero seat 2
    expect(hands[1].pos).toBe('BB');
  });
  it('flags a raise and c-bet; counts VPIP/PFR and postflop aggression', () => {
    const h = hands[0];
    expect(h.vp).toBe(1); expect(h.pf).toBe(1); expect(h.sf).toBe(1); expect(h.ab).toBe(1); expect(h.ac).toBe(0);
  });
  it('computes net result in chips and BB', () => {
    expect(hands[0].net).toBe(60); // invested 60 + 0 more (uncalled 80 back); won 120
    expect(hands[0].nbb).toBe(3);
    expect(hands[1].net).toBe(-20); // lost the big blind
    expect(hands[1].nbb).toBe(-1);
  });
  it('writes an action summary', () => {
    expect(hands[0].sum).toBe('PF: Hero r3, BTN f, SB f, BB c2 | F [Ac 7d 2s]: BB x, Hero b4, BB f');
    expect(hands[1].sum).toContain('Hero f');
  });
  it('a folded blind has VPIP 0', () => expect(hands[1].vp).toBe(0));
  it('returns null for non-hold\'em or garbage', () => {
    expect(parseHand('hello world')).toBeNull();
    expect(parseHandFile('nothing here')).toEqual([]);
  });
});

describe('GGPoker parser', () => {
  const [h] = parseHandFile(gg);
  it('parses the GG format and tags the site', () => {
    expect(h.site).toBe('GG');
    expect(h.g).toBe('T');
    expect(h.id).toBe('TM900000001');
    expect(h.bb).toBe(100);
    expect(h.h).toBe('QQ');
  });
  it('detects a 3-bet', () => {
    expect(h.tb).toBe(1);
    expect(h.pf).toBe(1);
  });
  it('hero on the small blind in 3-max', () => expect(h.pos).toBe('SB'));
});

describe('stats & leaks', () => {
  const hands = parseHandFile(ps + '\n\n' + gg);
  it('computes VPIP/PFR over hands', () => {
    const st = stats(hands);
    expect(st.n).toBe(3);
    expect(st.vpip).toBeCloseTo(2 / 3, 6);
    expect(st.pfr).toBeCloseTo(2 / 3, 6);
  });
  it('empty input yields null rates, not NaN', () => {
    const st = stats([]);
    expect(st.vpip).toBeNull();
    expect(st.bb100).toBeNull();
  });
  it('flags small samples', () => {
    expect(leaks(stats(hands), hands)[0].t).toBe('Early numbers');
  });
  it('flags a loose-passive player', () => {
    const h = parseHandFile(ps)[0];
    const loose = Array.from({ length: 200 }, (_, i) => ({ ...h, id: 'x' + i, vp: 1, pf: i % 10 === 0 ? 1 : 0, lp: 0 }));
    const titles = leaks(stats(loose), loose).map((l) => l.t).join('|');
    expect(titles).toMatch(/Playing too many hands/);
    expect(titles).toMatch(/Calling too much preflop/);
  });
});
