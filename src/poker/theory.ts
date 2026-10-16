/** Bet-sizing maths. `b` is the bet as a fraction of the pot. */
export function theoryNums(b: number) {
  return { req: b / (1 + 2 * b), mdf: 1 / (1 + b), alpha: b / (1 + b), bluff: b / (1 + 2 * b) };
}

/** Pot odds: equity needed to call `toCall` into `pot`. */
export const potOdds = (pot: number, toCall: number) => toCall / (pot + toCall);
