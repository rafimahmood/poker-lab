import { explain, json } from '../ai/client';
import { POS_ORDER, leaks, stats as calcStats } from '../poker/handHistory';
import { store } from '../storage/db';
import { $, $$, cardsHTML, esc, fbb, fp, ls, md } from '../ui/dom';
import { updateQuota } from './coachStatus';
import { getSavedHands } from './review';
import { getResults } from './results';
import { practicePromptPart, prDecisions, prLookup, getPracticeRecords } from './practice';
import { psAll, psLite } from './trackerData';
import type { ParsedHand } from '../poker/handHistory';

interface Question { handId: string; setup: string; question: string; options: string[]; answer: number; explanation: string }
interface Lesson { title: string; type: 'leak' | 'strength'; why: string; concept: string; rule: string; questions: Question[]; drill: string }
interface Plan { strengths: string[]; weaknesses: string[]; lessons: Lesson[] }
interface LessonDoc { id: string; created: string; hands: number; source: string; plan: Plan; answers: Record<string, number> }

type Source = 'real' | 'practice' | 'both';
let source: Source = (['real', 'practice', 'both'] as const).includes(ls.raw('pl-lss') as Source) ? (ls.raw('pl-lss') as Source) : 'real';
let ctl: AbortController | null = null;

export function setSource(v: Source) {
  source = v;
  ls.setRaw('pl-lss', v);
  $$('[data-lss]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lss === v)));
}

const doc = () => store.get<LessonDoc>('lessons', 'current');

function pickHands(): ParsedHand[] {
  const hs = psAll(), picked = new Map<string, ParsedHand>();
  const add = (arr: ParsedHand[], n: number) => arr.slice(0, n).forEach((h) => picked.set(h.id, h));
  add(hs.filter((h) => h.nbb < 0).sort((a, b) => a.nbb - b.nbb), 10);
  add(hs.filter((h) => h.g === 'T' && h.st <= 15 && h.vp && !h.ai), 6);
  add(hs.filter((h) => h.st <= 15 && !h.vp && /^(A|K[QJT]|QJ|[2-9TJQ]{2}$)/.test(h.h) && (h.h[0] === h.h[1] || /^A/.test(h.h) || /^K[QJT]/.test(h.h))), 5);
  add(hs.filter((h) => h.lp), 4);
  add(hs.filter((h) => h.to && h.vp && !h.pf), 4);
  add(hs.filter((h) => h.nbb > 0).sort((a, b) => b.nbb - a.nbb), 4);
  return [...picked.values()].slice(0, 30);
}

export function lessonPrompt(): string {
  const hs = psAll(), st = calcStats(hs), cand = pickHands(), lite = psLite();
  const L: string[] = [];
  L.push('You are a poker coach building a personalised lesson plan for an amateur player who plays home games, live tournaments and online tournaments. Everything here is from finished hands.');
  L.push(`\nSTATS from ${st.n} full hand histories: VPIP ${fp(st.vpip)}, PFR ${fp(st.pfr)}, open-limp ${fp(st.limp)}, 3-bet ${fp(st.tb)} of ${st.to} chances, postflop aggression ${st.af == null ? 'n/a' : st.af >= 99 ? 'very high' : st.af.toFixed(2)}, went to showdown ${fp(st.wtsd)}, won at showdown ${fp(st.wsd)}, ${fbb(st.bb100)} BB/100.`);
  const posT = POS_ORDER.filter((p) => hs.some((h) => h.pos === p)).map((p) => { const s = calcStats(hs.filter((h) => h.pos === p)); return `${p} ${s.n}h VPIP ${fp(s.vpip)} PFR ${fp(s.pfr)} ${fbb(s.bb100)}bb/100`; }).join('; ');
  if (posT) L.push('By position: ' + posT);
  L.push('Automatic leak flags: ' + leaks(st, hs).map((x) => x.t).join('; '));
  if (lite.length) L.push(`Plus ${lite.length} list-only hands (cards and winner only): hero won ${lite.filter((h) => h.won).length} pots.`);
  const notes = getResults().filter((r) => r.notes).slice(-8).map((r) => `- ${r.date} ${r.name} (${r.format}, finished ${r.finish || '?'}${r.entries ? ' of ' + r.entries : ''}): ${r.notes}`);
  if (notes.length) L.push("\nPlayer's own tournament notes:\n" + notes.join('\n'));
  const rev = getSavedHands().slice(-5).map((h) => `- ${h.game}, ${h.pos}${h.stack ? ' ' + h.stack + 'BB' : ''}, ${h.cards}. Preflop: ${h.pre}${h.flop ? ` | Flop ${h.flop}: ${h.aflop}` : ''}${h.turn ? ` | Turn ${h.turn}: ${h.aturn}` : ''}${h.river ? ` | River ${h.river}: ${h.ariver}` : ''} | Result: ${h.result}`);
  if (rev.length) L.push('\nHands the player wrote up (live or home games):\n' + rev.join('\n'));
  L.push('\nCANDIDATE HANDS for questions (id | hero position | hero cards | hero stack in BB | game | actions in BB: c call, b bet, r raise to, x check, f fold, AI all-in | hero result):');
  cand.forEach((h) => L.push(`${h.id} | ${h.pos} | ${h.c} | ${h.st} | ${h.g === 'T' ? 'tournament' : 'cash'} | ${h.sum} | ${fbb(h.nbb)} BB`));
  L.push('\nReply with only JSON of this shape:');
  L.push('{"strengths":["..."],"weaknesses":["..."],"lessons":[{"title":"","type":"leak","why":"","concept":"","rule":"","questions":[{"handId":"","setup":"","question":"","options":["","",""],"answer":0,"explanation":""}],"drill":""}]}');
  L.push("Rules: 2-4 short strengths and 3-5 short weaknesses, each one line tied to evidence. Make 4 or 5 lessons ordered by how much the leak costs, most important first; at most one lesson with type \"strength\", the rest \"leak\". why: 1-2 sentences citing this player's numbers or hands. concept: the teaching in 3-6 short sentences or \"- \" bullets, including simple maths (pot odds, fold equity, push/fold stack depths, ICM) where it helps. rule: one memorable line. questions: 1-3 per lesson, each on a DIFFERENT real hand from the candidate list, handId copied exactly. setup: describe the spot only up to hero's key decision (position, stack, action so far, board) and never reveal what happened after. options: 3 or 4 plausible actions with exactly one best; answer is its 0-based index. explanation: why the best option wins, with numbers where useful, then what actually happened. drill: one concrete practice task, naming Poker Lab tools where they fit: Practice hands, the Preflop ranges drill, Equity calculator, ICM calculator, Starting hands chart, or Hand review. Keep the whole reply under 2,500 words. Use British English.");
  let out = L.join('\n');
  if (source === 'practice') out = out.replace(/STATS from[\s\S]*?CANDIDATE HANDS for questions[\s\S]*?(?=\nReply with only JSON)/, 'Build these lessons ONLY from the practice trainer results below.' + practicePromptPart() + '\n');
  else if (source === 'both') out = out.replace('\nReply with only JSON', practicePromptPart() + '\n\nReply with only JSON');
  return out;
}

export function renderLessons() {
  const list = $('ls-list'), sum = $('ls-summary'), d = doc();
  if (!d || !d.plan) {
    sum.hidden = true; $('ls-progress').textContent = '';
    list.innerHTML = '<div class="empty">No lessons yet. Import your PokerStars hands, then choose Build my lessons. You\'ll get 4–5 lessons on your biggest leaks, each quizzing you on hands you actually played.</div>';
    $('ls-build').textContent = 'Build my lessons';
    return;
  }
  $('ls-build').textContent = 'Rebuild lessons';
  const plan = d.plan, ans = d.answers || {};
  sum.hidden = false;
  $('ls-str').innerHTML = (plan.strengths || []).map((s) => `<li>${esc(s)}</li>`).join('');
  $('ls-weak').innerHTML = (plan.weaknesses || []).map((s) => `<li>${esc(s)}</li>`).join('');
  let total = 0, done = 0, right = 0;
  const all = psAll();
  list.innerHTML = plan.lessons.map((l, li) => {
    const qs = l.questions || [];
    const qhtml = qs.map((q, qi) => {
      total++;
      const key = `l${li}q${qi}`, a = ans[key], answered = a != null;
      if (answered) { done++; if (a === q.answer) right++; }
      const h = all.find((x) => x.id === String(q.handId)) || prLookup(q.handId);
      const head = h ? `<div class="row" style="gap:10px;align-items:center">${cardsHTML(h.c)}<b>${esc(h.pos)}</b><span class="mono">${h.st} BB</span><span class="mono muted">#${esc(h.id)}</span></div>` : '';
      const opts = (q.options || []).map((o, oi) => `<button class="${answered ? (oi === q.answer ? 'right' : oi === a ? 'wrong' : '') : ''}" data-ls="${key}" data-opt="${oi}"${answered ? ' disabled' : ''}>${esc(o)}</button>`).join('');
      return `<div class="q"><span class="label">Your hand · question ${qi + 1}</span>${head}<p>${esc(q.setup || '')}</p><b>${esc(q.question || "What's the best play?")}</b><div class="opts">${opts}</div>` +
        (answered ? `<div class="verdict ${a === q.answer ? 'good' : 'bad'}"><b>${a === q.answer ? 'Right.' : 'Not quite.'}</b><div class="md">${md(q.explanation || '')}</div></div>` : '') + '</div>';
    }).join('');
    const lDone = qs.every((_, qi) => ans[`l${li}q${qi}`] != null);
    return `<article class="box"><div class="row" style="justify-content:space-between;align-items:center"><span class="lesson-num">Lesson ${li + 1}</span><span class="pill ${l.type === 'strength' ? 'good' : 'bad'}">${l.type === 'strength' ? 'Strength' : 'Leak'}</span>${lDone && qs.length ? '<span class="pill good">Done</span>' : ''}</div>` +
      `<h3 style="font-size:20px">${esc(l.title || '')}</h3>${l.why ? `<p class="muted">${esc(l.why)}</p>` : ''}<div class="md">${md(l.concept || '')}</div>${l.rule ? `<div class="rule">${esc(l.rule)}</div>` : ''}${qhtml}${l.drill ? `<p><b>Practice:</b> ${esc(l.drill)}</p>` : ''}</article>`;
  }).join('');
  $('ls-progress').textContent = `${done} of ${total} questions answered · ${right} right · built from ${d.hands || '?'} hands on ${String(d.created || '').slice(0, 10)}`;
}

async function build() {
  const msg = $('ls-msg');
  if (source === 'practice' && !prDecisions().length) { msg.textContent = 'Play some Practice hands first.'; return; }
  if (source === 'real' && !psAll().length) { msg.textContent = 'Import some PokerStars hand histories first, or build from Practice hands.'; return; }
  if (source === 'both' && !psAll().length && !prDecisions().length) { msg.textContent = 'Play some Practice hands or import PokerStars hands first.'; return; }
  ctl = new AbortController();
  $<HTMLButtonElement>('ls-build').disabled = true; $('ls-stop').hidden = false;
  msg.textContent = `Building your lessons from ${source === 'practice' ? getPracticeRecords().length + ' practice' : psAll().length + ' full'} hands… this can take up to a minute.`;
  try {
    const plan = await json<Plan>('/api/lesson', { prompt: lessonPrompt() }, { onMeta: updateQuota }, ctl.signal);
    if (!plan || !Array.isArray(plan.lessons) || !plan.lessons.length) throw new Error('empty');
    plan.lessons.forEach((l) => { l.questions = (Array.isArray(l.questions) ? l.questions : []).filter((q) => q && Array.isArray(q.options) && q.options.length >= 2); });
    await store.set('lessons', 'current', { created: new Date().toISOString(), hands: source === 'practice' ? getPracticeRecords().length : psAll().length, source, plan, answers: {} });
    msg.textContent = 'Your lessons are ready.';
  } catch (e) {
    msg.textContent = e instanceof Error && e.message === 'empty' ? 'The lessons came back incomplete. Try again.' : explain(e);
  } finally { $<HTMLButtonElement>('ls-build').disabled = false; $('ls-stop').hidden = true; }
}

export function initLessons() {
  setSource(source);
  $$('[data-lss]').forEach((b) => b.addEventListener('click', () => setSource(b.dataset.lss as Source)));
  $('ls-build').addEventListener('click', () => void build());
  $('ls-stop').addEventListener('click', () => ctl?.abort());
  $('ls-list').addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-ls]');
    const d = doc();
    if (!b || !d) return;
    const key = b.dataset.ls!, opt = +b.dataset.opt!;
    if ((d.answers || {})[key] != null) return;
    try { await store.update('lessons', 'current', { answers: { ...d.answers, [key]: opt } }); }
    catch { $('ls-msg').textContent = "Couldn't save that answer."; }
  });
  store.onChange('lessons', renderLessons);
  store.onChange('practice', renderLessons);
  renderLessons();
}
