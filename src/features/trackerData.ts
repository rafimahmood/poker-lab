import { handClass, parseCards } from '../poker/cards';
import { type ParsedHand, parseHandFile } from '../poker/handHistory';
import { store } from '../storage/db';

export interface LiteHand { id: string; lite: 1; g: 'T' | 'C'; c: string; pos: string; won: boolean | null; pot: number; t: string; tour?: string }
export interface HandImport { id: string; created: string; files: string[]; hands: Array<ParsedHand | LiteHand> }
const isLite = (h: ParsedHand | LiteHand): h is LiteHand => 'lite' in h && !!h.lite;

/** Home-game / recorder hands: parse the PokerStars-style text we generated when saving. */
const liveCache = new Map<string, ParsedHand[]>();
function liveParsed(): ParsedHand[] {
  const out: ParsedHand[] = [];
  for (const d of store.list('livehands')) {
    if (!d.text) continue;
    if (!liveCache.has(d.text)) liveCache.set(d.text, parseHandFile(d.text).map((h) => Object.assign(h, { home: 1 })));
    out.push(...liveCache.get(d.text)!);
  }
  return out;
}

/** Live tournament entries, turned into preflop-only tracker hands. */
const tourCache = new Map<string, ParsedHand>();
function liveTourParsed(): ParsedHand[] {
  const out: ParsedHand[] = [];
  for (const x of store.list('tourhands')) {
    if (!x.act || !(x.bb > 0)) continue;
    const key = `${x.id}|${x.act}|${x.after}`;
    if (!tourCache.has(key)) {
      const pc = parseCards(x.cards || ''), ok = !!(pc.cards && pc.cards.length === 2);
      const st = x.before / x.bb, seat = x.sitSeat || 'EP';
      const hero = ({ fold: 'f', check: 'x', call: 'c1', raise: 'r2.5', reraise: 'r7.5', allin: 'r' + +st.toFixed(1) + ' AI' } as Record<string, string>)[x.act] || 'f';
      const toks = x.sit === 'raised' ? [seat + ' r2.5', 'Hero ' + hero] : x.sit === 'allin' ? [seat + ' r' + (x.sitBB || 15) + ' AI', 'Hero ' + hero]
        : x.sit === 'limped' ? ['EP c1', 'Hero ' + hero] : x.sit === '3bet' ? ['Hero r2.5', (x.sitSeat || 'BB') + ' r7.5', 'Hero ' + hero] : ['Hero ' + hero];
      const vp = ['call', 'raise', 'reraise', 'allin'].includes(x.act) ? 1 : 0, pf = ['raise', 'reraise', 'allin'].includes(x.act) ? 1 : 0;
      tourCache.set(key, {
        id: 'LT' + x.id, site: 'PS', g: 'T', home: 1, bb: x.bb, t: (x.created || '').slice(0, 19).replace('T', ' '), pos: x.pos || '?', n: x.players || 0,
        st: +st.toFixed(1), c: ok ? x.cards.replace(/\s+/g, '') : '', h: ok ? handClass(pc.cards![0], pc.cards![1]) : '', vp, pf,
        lp: x.act === 'call' && (!x.sit || x.sit === 'folded') ? 1 : 0, tb: x.sit === 'raised' && (x.act === 'reraise' || x.act === 'allin') ? 1 : 0,
        to: ['raised', 'allin', '3bet'].includes(x.sit) ? 1 : 0, sf: 0, sd: 0, ws: 0, ab: 0, ac: 0, ai: x.act === 'allin' ? 1 : 0,
        net: x.after - x.before, nbb: +((x.after - x.before) / x.bb).toFixed(2),
        sum: 'PF: ' + toks.join(', ') + (x.board ? ' | board ' + x.board : '') + ' (live tournament, preflop only)',
      });
    }
    out.push(tourCache.get(key)!);
  }
  return out;
}

/** Every full hand we know about, de-duplicated by id. */
export function psAll(): ParsedHand[] {
  const seen = new Set<string>();
  const out: ParsedHand[] = [];
  const add = (h: ParsedHand) => { if (!seen.has(h.id)) { seen.add(h.id); out.push(h); } };
  for (const im of store.list<HandImport & { id: string }>('hhimports')) for (const h of im.hands || []) if (!isLite(h)) add(h);
  liveParsed().forEach(add);
  liveTourParsed().forEach(add);
  return out;
}

/** Hand-list-only rows from screenshots, minus any we now have in full. */
export function psLite(): LiteHand[] {
  const full = new Set(psAll().map((h) => h.id));
  const seen = new Set<string>();
  const out: LiteHand[] = [];
  for (const im of store.list<HandImport & { id: string }>('hhimports'))
    for (const h of im.hands || []) {
      if (!isLite(h) || seen.has(h.id)) continue;
      const num = String(h.id).replace(/^L/, '').split('-')[0];
      if (full.has(num)) continue;
      seen.add(h.id);
      out.push(h);
    }
  return out;
}

export function clearTrackerCaches() { liveCache.clear(); tourCache.clear(); }
