export const SAVE_KEY = 'tomorrow-as-usual:v2';
const SCORE_VERSION = 1;
const MAX_SCORE = 100;
const WRONG_PENALTY = 4;
const blankScore = () => ({ version: SCORE_VERSION, attempts: {}, legacyTasks: [] });
export const blankState = () => ({ version: 2, started: false, round: 0, talked: [], clues: [], work: [], solved: [], choices: [], ending: null, score: blankScore() });

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = id => typeof id === 'string' && id.trim().length > 0 && !['__proto__', 'prototype', 'constructor'].includes(id);
const phaseState = () => ({ wrongKeys: [], correct: false, carried: false });

// Keys describe selections, not clicks. Unordered answers share a key in any order.
function selectionKey(work, selection) {
  return JSON.stringify(work.mode === 'order' ? selection : [...selection].sort((a, b) => a - b));
}
function validSelection(work, selection) {
  if (!work || !['single', 'multi', 'order'].includes(work.mode) || !Array.isArray(work.options) || !Array.isArray(work.answer) || !work.answer.length || !Array.isArray(selection) || !selection.length) return false;
  if (!Array.from(selection).every(n => Number.isInteger(n) && n >= 0 && n < work.options.length) || new Set(selection).size !== selection.length) return false;
  // An incomplete sequence is still being assembled. A nonempty multi-selection,
  // including one with the wrong number of choices, is a valid submitted answer.
  return work.mode === 'multi' || selection.length === (work.mode === 'single' ? 1 : work.answer.length);
}
function workKey(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const values = JSON.parse(raw);
    if (!Array.isArray(values) || !values.length || !values.every(n => Number.isSafeInteger(n) && n >= 0) || new Set(values).size !== values.length) return null;
    return JSON.stringify(values);
  } catch { return null; }
}
function normalizeScore(state) {
  const source = isRecord(state.score) && state.score.version === SCORE_VERSION ? state.score : {};
  const attempts = isRecord(source.attempts) ? source.attempts : {};
  const work = new Set(Array.isArray(state.work) ? state.work : []);
  const solved = new Set(Array.isArray(state.solved) ? state.solved : []);
  const clues = new Set(Array.isArray(state.clues) ? state.clues : []);
  const legacy = new Set(Array.isArray(source.legacyTasks) ? source.legacyTasks.filter(safeId) : []);
  const result = blankScore();
  const ids = new Set([...Object.keys(attempts), ...work, ...solved]);
  for (const id of ids) {
    if (!safeId(id)) continue;
    const raw = isRecord(attempts[id]) ? attempts[id] : {};
    const task = { work: phaseState(), evidence: phaseState() };
    for (const phase of ['work', 'evidence']) {
      const saved = isRecord(raw[phase]) ? raw[phase] : {};
      const completed = phase === 'work' ? work.has(id) || solved.has(id) : solved.has(id);
      const phaseWasOpen = phase === 'work' || work.has(id) || solved.has(id);
      const wrongKeys = phaseWasOpen && Array.isArray(saved.wrongKeys) ? saved.wrongKeys : [];
      task[phase].wrongKeys = [...new Set(wrongKeys.map(value => phase === 'work' ? workKey(value) : safeId(value) && clues.has(value) ? value : null).filter(value => value !== null))];
      task[phase].correct = completed && saved.correct === true && saved.carried !== true;
      // Missing/corrupt history must not turn prior progress into perfect attempts.
      task[phase].carried = completed && !task[phase].correct;
    }
    if (task.work.carried || task.evidence.carried || (legacy.has(id) && (work.has(id) || solved.has(id)))) result.legacyTasks.push(id);
    if (task.work.correct || task.evidence.correct || task.work.carried || task.evidence.carried || task.work.wrongKeys.length || task.evidence.wrongKeys.length) result.attempts[id] = task;
  }
  return result;
}
function recordAttempt(state, challenge, phase, wrongKey = null) {
  const score = normalizeScore(state);
  const task = Object.hasOwn(score.attempts, challenge.id) ? score.attempts[challenge.id] : { work: phaseState(), evidence: phaseState() };
  if (!safeId(challenge.id) || task[phase].correct || task[phase].carried) return;
  if (wrongKey === null) task[phase].correct = true;
  else if (!task[phase].wrongKeys.includes(wrongKey)) task[phase].wrongKeys.push(wrongKey);
  score.attempts[challenge.id] = task;
  state.score = score;
}

// Only completed tasks with both phases observed are in the first-pass denominator.
// Carried progress is shown separately; its new attempts can still affect points.
export function scoreSummary(state, rounds) {
  const ledger = normalizeScore(state);
  const tasks = new Map((Array.isArray(rounds) ? rounds : []).flatMap(round => Array.isArray(round.challenges) ? round.challenges : []).filter(challenge => safeId(challenge?.id)).map(challenge => [challenge.id, challenge]));
  const solved = new Set(Array.isArray(state.solved) ? state.solved : []);
  let wrong = 0, firstPass = 0, finished = 0, tracked = 0, carried = 0;
  for (const [id, challenge] of tasks) {
    const entry = Object.hasOwn(ledger.attempts, id) ? ledger.attempts[id] : null;
    const oldProgress = ledger.legacyTasks.includes(id);
    if (oldProgress) carried++;
    if (solved.has(id)) finished++;
    if (!entry) continue;
    const workMistakes = new Set(entry.work.wrongKeys.flatMap(raw => {
      const selection = JSON.parse(raw);
      return validSelection(challenge.work, selection) && selectionKey(challenge.work, selection) !== selectionKey(challenge.work, challenge.work.answer) ? [selectionKey(challenge.work, selection)] : [];
    })).size;
    const evidenceMistakes = entry.evidence.wrongKeys.filter(id => id !== challenge.correctClueId).length;
    wrong += workMistakes + evidenceMistakes;
    if (solved.has(id) && !oldProgress && entry.work.correct && entry.evidence.correct) {
      tracked++;
      if (workMistakes + evidenceMistakes === 0) firstPass++;
    }
  }
  return { max: MAX_SCORE, score: Math.max(0, MAX_SCORE - wrong * WRONG_PENALTY), wrong, firstPass, finished, tracked, carried, total: tasks.size, penaltyPerWrong: WRONG_PENALTY };
}

export const key = (round, id) => `${round}:${id}`;
export function activeChallenge(state, round) { return round.challenges.find(c=>!state.solved.includes(c.id)) || null; }
export function canInspect(state, clue, round) { if(round && activeChallenge(state,round)?.correctClueId!==clue.id && !state.clues.includes(clue.id)) return false; return (clue.unlockedBy || []).every(id => state.talked.includes(key(state.round, id))); }
export function talk(state, characterId, round) { if(round && activeChallenge(state,round)?.characterId!==characterId) return false; const id = key(state.round, characterId); if (!state.talked.includes(id)) state.talked.push(id); return true; }
export function collect(state, clue, round) { if (!canInspect(state, clue, round)) return false; if (!state.clues.includes(clue.id)) state.clues.push(clue.id); return true; }
export function canWork(state, round, challenge) { return activeChallenge(state,round)?.id===challenge.id && state.talked.includes(key(state.round,challenge.characterId)) && state.clues.includes(challenge.correctClueId); }
export function performWork(state, round, challenge, selection) {
  if (!canWork(state, round, challenge) || !validSelection(challenge.work, selection)) return false;
  const actual = selectionKey(challenge.work, selection);
  const correct = actual === selectionKey(challenge.work, challenge.work.answer);
  if (!state.work.includes(challenge.id)) recordAttempt(state, challenge, 'work', correct ? null : actual);
  if (!correct) return false;
  if (!state.work.includes(challenge.id)) state.work.push(challenge.id);
  return true;
}
export function present(state, challenge, clueId) {
  if (!state.work.includes(challenge.id) || !state.clues.includes(clueId) || !state.talked.includes(key(state.round, challenge.characterId))) return false;
  const correct = clueId === challenge.correctClueId;
  if (!state.solved.includes(challenge.id) && safeId(clueId)) recordAttempt(state, challenge, 'evidence', correct ? null : clueId);
  if (!correct) return false;
  if (!state.solved.includes(challenge.id)) state.solved.push(challenge.id);
  return true;
}
export function canDecide(state, round) { return round.challenges.every(c => state.solved.includes(c.id)); }
export function choose(state, round, option) { if (!canDecide(state, round)) return false; const canonical = round.decision.options.find(o => o.id === option?.id); if (!canonical || state.choices.some(c => c.round === state.round)) return false; state.choices.push({round: state.round, optionId: canonical.id, label: canonical.label, consequence: canonical.consequence, epilogue: canonical.epilogue || null, flag: canonical.flag || null}); if (canonical.endingKey) state.ending = canonical.endingKey; return true; }
export function next(state, rounds) { if (state.ending || !state.choices.some(c => c.round === state.round) || state.round >= rounds.length - 1) return false; state.round++; return true; }
export function readState(storage) { try { const s = JSON.parse(storage.getItem(SAVE_KEY)); if (!s || s.version !== 2 || typeof s.started !== 'boolean' || !Number.isInteger(s.round) || s.round < 0 || s.round > 2 || !['talked','clues','work','solved'].every(k => Array.isArray(s[k]) && s[k].every(v=>typeof v==='string')) || !Array.isArray(s.choices) || !s.choices.every(c=>c && Number.isInteger(c.round) && c.round >= 0 && c.round <= s.round && typeof c.optionId==='string' && typeof c.label==='string') || new Set(s.choices.map(c=>c.round)).size!==s.choices.length || (s.ending!==null && !['transparent','sandbox','suspend'].includes(s.ending))) return blankState(); return {...blankState(), ...s, score: normalizeScore(s)}; } catch { return blankState(); } }
