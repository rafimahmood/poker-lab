import { type Card, cardsToString, parseCards } from '../../../src/poker/cards';
import { equity, equityVs } from '../../../src/poker/equity';
import { ALL_CLASSES, combosFor, rangePct } from '../../../src/poker/handclasses';
import { parseHandFile } from '../../../src/poker/handHistory';
import { icmCall, icm } from '../../../src/poker/icm';
import { type Mode, STACK_BUCKETS, bucketOf, chartAction, expandRange, MODE_WORDS, seatList, spotSets, validRaisers } from '../../../src/poker/ranges';
import { potOdds } from '../../../src/poker/theory';

/** Tool definitions in OpenAI/OpenRouter function-calling format. */
export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'parse_hand_history',
      description: 'Parse PokerStars or GGPoker hand history text into structured hands: hero cards, position, stack in BB, action summary and result in BB. Use this whenever the user pastes a hand history.',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'Raw hand history text' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_range',
      description: 'Look up the recommended preflop chart for a seat. situation: "open" (folded to hero), "vs_open" (facing one raise), "vs_3bet" (hero opened and was re-raised) or "vs_allin" (facing a shove). Optionally pass hero hand to get the chart action for it.',
      parameters: {
        type: 'object',
        properties: {
          players: { type: 'integer', minimum: 2, maximum: 9, description: 'Players at the table' },
          position: { type: 'string', description: 'Hero seat: UTG, UTG+1, UTG+2, LJ, HJ, CO, BTN, SB, BB' },
          situation: { type: 'string', enum: ['open', 'vs_open', 'vs_3bet', 'vs_allin'] },
          raiser: { type: 'string', description: 'Seat of the raiser/shover (vs_open, vs_allin)' },
          stack_bb: { type: 'number', description: 'Effective stack in BB (vs_allin only)' },
          hand: { type: 'string', description: 'Optional hero hand, e.g. "AhKd" or class like "AKo"' },
        },
        required: ['players', 'position', 'situation'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calc_equity',
      description: 'Monte Carlo equity for hero vs a specific hand, a range (e.g. "QQ+,AKs") or N random hands, with an optional board.',
      parameters: {
        type: 'object',
        properties: {
          hero: { type: 'string', description: 'Hero cards e.g. "AhKh"' },
          villain: { type: 'string', description: 'Villain exact cards, optional' },
          villain_range: { type: 'string', description: 'Villain range in notation e.g. "TT+,AQs+,AKo", optional' },
          board: { type: 'string', description: '0, 3, 4 or 5 board cards e.g. "Jh7h2c"' },
          opponents: { type: 'integer', minimum: 1, maximum: 8, description: 'Random opponents when no villain/range given' },
        },
        required: ['hero'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calc_icm',
      description: 'ICM prize equity for each stack and, if hero and villain indexes are given, the equity hero needs to call villain\'s all-in.',
      parameters: {
        type: 'object',
        properties: {
          stacks: { type: 'array', items: { type: 'number' }, description: 'Chip stacks, 2-10 players' },
          payouts: { type: 'array', items: { type: 'number' }, description: 'Prizes for 1st, 2nd, ...' },
          hero: { type: 'integer', description: '0-based index of hero in stacks' },
          villain: { type: 'integer', description: '0-based index of the shoving player' },
        },
        required: ['stacks', 'payouts'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pot_odds',
      description: 'Pot odds: the equity needed to call a bet.',
      parameters: { type: 'object', properties: { pot: { type: 'number', description: 'Pot before the bet' }, to_call: { type: 'number' } }, required: ['pot', 'to_call'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_stats',
      description: 'The player\'s own tracked stats and automatic leak flags from their imported hands (VPIP, PFR, 3-bet, showdown, BB/100, leaks). Empty if they have not imported hands.',
      parameters: { type: 'object', properties: {} },
    },
  },
] as const;

export interface ToolContext {
  /** Client-supplied digest of the player's stats (untrusted data, size-capped). */
  stats?: unknown;
}

const MAX_RESULT = 6000;
const clip = (o: unknown) => {
  const s = JSON.stringify(o);
  return s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + '…(truncated)' : s;
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const err = (message: string) => ({ error: message });

function cards(str: unknown, min: number, max: number, label: string): { cards: Card[] } | { error: string } {
  if (typeof str !== 'string') return { error: `${label} must be a string like "AhKd".` };
  const p = parseCards(str);
  if (p.error !== undefined) return { error: `${label}: ${p.error}` };
  if (p.cards.length < min || p.cards.length > max) return { error: `${label} needs ${min === max ? min : `${min}-${max}`} cards.` };
  return { cards: p.cards };
}

const SITUATION: Record<string, Mode> = { open: 'open', vs_open: 'vsopen', vs_3bet: 'vs3b', vs_allin: 'allin' };

export function runTool(name: string, rawArgs: string | Record<string, unknown>, ctx: ToolContext = {}): string {
  let a: Record<string, any>;
  try {
    a = typeof rawArgs === 'string' ? (rawArgs.trim() ? JSON.parse(rawArgs) : {}) : rawArgs;
  } catch {
    return clip(err('Arguments were not valid JSON.'));
  }
  try {
    return clip(dispatch(name, a, ctx));
  } catch (e) {
    return clip(err('Tool failed: ' + (e instanceof Error ? e.message : String(e))));
  }
}

function dispatch(name: string, a: Record<string, any>, ctx: ToolContext): unknown {
  switch (name) {
    case 'parse_hand_history': {
      if (typeof a.text !== 'string' || !a.text.trim()) return err('Provide the hand history text.');
      const hs = parseHandFile(a.text.slice(0, 40000));
      if (!hs.length) return err('No Hold\'em hands found. Hands must start with "PokerStars Hand #" or "Poker Hand #".');
      return {
        count: hs.length,
        note: hs.length > 5 ? 'Showing the first 5.' : undefined,
        hands: hs.slice(0, 5).map((h) => ({
          id: h.id, site: h.site, type: h.g === 'T' ? 'tournament' : 'cash', players: h.n, position: h.pos,
          stack_bb: h.st, hero_cards: h.c, hand_class: h.h, actions_in_bb: h.sum, result_bb: h.nbb,
          preflop: { vpip: !!h.vp, raised: !!h.pf, three_bet: !!h.tb, limped: !!h.lp, all_in: !!h.ai },
        })),
      };
    }
    case 'lookup_range': {
      const n = Number(a.players);
      if (!Number.isInteger(n) || n < 2 || n > 9) return err('players must be 2-9.');
      const seats = seatList(n);
      const pos = String(a.position || '').toUpperCase().replace('UTG1', 'UTG+1').replace('UTG2', 'UTG+2');
      if (!seats.includes(pos)) return err(`position must be one of ${seats.join(', ')} for ${n} players.`);
      const mode = SITUATION[String(a.situation)];
      if (!mode) return err('situation must be open, vs_open, vs_3bet or vs_allin.');
      let raiser: string | null = null;
      if (mode === 'vsopen' || mode === 'allin') {
        raiser = String(a.raiser || '').toUpperCase();
        const valid = validRaisers(pos, n);
        if (!valid.includes(raiser)) return err(`raiser must be a seat before ${pos}: ${valid.join(', ') || '(none)'}.`);
      }
      const bucket = bucketOf(Number(a.stack_bb) || 15);
      const sets = spotSets(mode, pos, raiser, n, bucket);
      if (!sets) return err('No chart for that spot (e.g. nobody opens from the big blind).');
      const W = MODE_WORDS[mode];
      const out: Record<string, unknown> = {
        spot: `${pos} ${a.situation}${raiser ? ' vs ' + raiser : ''}, ${n} players${mode === 'allin' ? ', ' + STACK_BUCKETS.find((b) => b[0] === bucket)![1] : ''}`,
        [W.r.toLowerCase()]: sets.rs,
        ...(sets.cs ? { [W.c.toLowerCase()]: sets.cs } : {}),
        percent_of_hands_continuing: Math.round((rangePct(sets.r) + rangePct(sets.c)) * 100),
      };
      if (a.hand) {
        const raw = String(a.hand).trim();
        let cls = raw;
        if (!ALL_CLASSES.includes(cls)) {
          const c = cards(raw, 2, 2, 'hand');
          if ('error' in c) return err('hand must be a class like "AKo" or cards like "AhKd".');
          const [x, y] = c.cards;
          const r1 = x >> 2, r2 = y >> 2;
          const hi = Math.max(r1, r2), lo = Math.min(r1, r2), R = '23456789TJQKA';
          cls = hi === lo ? R[hi] + R[hi] : R[hi] + R[lo] + ((x & 3) === (y & 3) ? 's' : 'o');
        }
        out.hand = cls;
        const act = chartAction(sets, cls);
        out.chart_action = act === 'raise' ? W.r : act === 'call' ? W.c : 'Fold';
      }
      return out;
    }
    case 'calc_equity': {
      const h = cards(a.hero, 2, 2, 'hero');
      if ('error' in h) return h;
      const b = a.board ? cards(a.board, 0, 5, 'board') : { cards: [] as Card[] };
      if ('error' in b) return b;
      if (![0, 3, 4, 5].includes(b.cards.length)) return err('board needs 0, 3, 4 or 5 cards.');
      let v: { cards: Card[] } | null = null;
      if (a.villain) {
        const vv = cards(a.villain, 2, 2, 'villain');
        if ('error' in vv) return vv;
        v = vv;
      }
      const all = [...h.cards, ...(v?.cards ?? []), ...b.cards];
      if (new Set(all).size !== all.length) return err('The same card appears twice.');
      if (a.villain_range && !v) {
        const set = expandRange(String(a.villain_range).slice(0, 400));
        if (!set.size) return err('villain_range could not be read. Use notation like "TT+,AQs+,AKo".');
        const list = combosFor(set, all);
        if (!list.length) return err('villain_range has no combos left after removing known cards.');
        const eq = equityVs(h.cards, b.cards, [list], 6000);
        return { hero: cardsToString(h.cards), board: cardsToString(b.cards), vs_range: String(a.villain_range), range_percent_of_hands: Math.round(rangePct(set) * 100), equity: r3(eq) };
      }
      const nOpp = Math.min(8, Math.max(1, Math.floor(Number(a.opponents) || 1)));
      const r = equity({ hero: h.cards, villain: v?.cards, board: b.cards, opponents: nOpp, iterations: 20000 });
      return {
        hero: cardsToString(h.cards), board: cardsToString(b.cards),
        vs: v ? cardsToString(v.cards) : `${nOpp} random hand${nOpp > 1 ? 's' : ''}`,
        equity: r3(r.equity), win: r3(r.win), tie: r3(r.tie),
      };
    }
    case 'calc_icm': {
      const stacks = a.stacks, pay = a.payouts;
      if (!Array.isArray(stacks) || !Array.isArray(pay)) return err('stacks and payouts must be arrays.');
      if (stacks.length < 2 || stacks.length > 10) return err('2-10 players supported.');
      if (stacks.some((x: unknown) => typeof x !== 'number' || !(x > 0)) || pay.some((x: unknown) => typeof x !== 'number' || !(x >= 0))) return err('stacks must be positive numbers and payouts non-negative numbers.');
      const ev = icm(stacks, pay);
      const out: Record<string, unknown> = { prize_equity: ev.map((x, i) => ({ player: i, stack: stacks[i], equity: Math.round(x * 100) / 100 })) };
      if (Number.isInteger(a.hero) && Number.isInteger(a.villain)) {
        if (a.hero === a.villain || a.hero < 0 || a.villain < 0 || a.hero >= stacks.length || a.villain >= stacks.length) return err('hero and villain must be different valid indexes.');
        const c = icmCall(stacks, pay, a.hero, a.villain);
        out.call_analysis = {
          equity_needed_to_call: r3(c.required), cash_game_equivalent: 0.5, risk_premium: r3(c.riskPremium),
          value_if_fold: Math.round(c.fold * 100) / 100, value_if_win: Math.round(c.win * 100) / 100, value_if_lose: Math.round(c.lose * 100) / 100, effective_stack: c.effective,
        };
      }
      return out;
    }
    case 'pot_odds': {
      const pot = Number(a.pot), call = Number(a.to_call);
      if (!(pot >= 0) || !(call > 0)) return err('pot must be >= 0 and to_call > 0.');
      const need = potOdds(pot, call);
      return { equity_needed: r3(need), odds: `${r3(pot / call)} to 1`, percent: Math.round(need * 1000) / 10 };
    }
    case 'get_my_stats':
      return ctx.stats ?? { note: 'The player has not imported any hands yet.' };
    default:
      return err(`Unknown tool "${name}".`);
  }
}
