/** Human-readable one-liners for tool calls, shown as chips so the player can see the coach used real maths. */
const pc = (x: unknown) => (typeof x === 'number' ? Math.round(x * 100) + '%' : '?');

export function toolLabel(name: string, args: any, result: any): string {
  const a = args || {}, r = result || {};
  if (r.error) return `${name}: ${String(r.error).slice(0, 80)}`;
  switch (name) {
    case 'calc_equity':
      return `Equity ${a.hero ?? ''}${a.villain ? ' vs ' + a.villain : a.villain_range ? ' vs ' + a.villain_range : ' vs random'}${a.board ? ' on ' + a.board : ''} → ${pc(r.equity)}`;
    case 'lookup_range':
      return `Chart ${a.position ?? ''} ${String(a.situation ?? '').replace('_', ' ')}${a.raiser ? ' vs ' + a.raiser : ''}${r.chart_action ? ' → ' + r.chart_action : r.percent_of_hands_continuing != null ? ' → ' + r.percent_of_hands_continuing + '% of hands' : ''}`;
    case 'calc_icm':
      return r.call_analysis ? `ICM call needs ${pc(r.call_analysis.equity_needed_to_call)}` : 'ICM prize equities';
    case 'pot_odds':
      return `Pot odds ${a.to_call} into ${a.pot} → needs ${pc(r.equity_needed)}`;
    case 'parse_hand_history':
      return `Parsed ${r.count ?? 0} hand${r.count === 1 ? '' : 's'}`;
    case 'get_my_stats':
      return 'Read your stats';
    default:
      return name;
  }
}
