/** Late-bound providers so features can share data without importing each other. */
let statsProvider: () => unknown = () => undefined;
export const setStatsProvider = (fn: () => unknown) => { statsProvider = fn; };
export const getStatsDigest = () => statsProvider();
