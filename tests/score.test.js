import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_KEY, blankState, talk, collect, performWork, present, choose, next, readState, scoreSummary } from '../src/engine.js';
import { rounds } from '../src/story.js';

const restore = state => readState({getItem(key) { assert.equal(key, SAVE_KEY); return JSON.stringify(state); }});
const fixture = (mode = 'single', answer = [1], options = ['A', 'B', 'C']) => {
  const challenge = {id: 'task', characterId: 'qa', correctClueId: 'right', work: {mode, answer, options}};
  const round = {challenges: [challenge], clues: [{id: 'right', unlockedBy: ['qa']}]};
  return {state: blankState(), round, challenge, summary: state => scoreSummary(state, [round])};
};
function ready({state, round, challenge}) {
  assert.equal(talk(state, challenge.characterId, round), true);
  assert.equal(collect(state, round.clues.find(c => c.id === challenge.correctClueId), round), true);
}
function complete(state, round, challenge) {
  ready({state, round, challenge});
  assert.equal(performWork(state, round, challenge, challenge.work.answer), true);
  assert.equal(present(state, challenge, challenge.correctClueId), true);
}

test('fresh score is 100, independent in each replay, and compatible with save version 2', () => {
  const a = fixture(), b = fixture();
  assert.deepEqual(a.state.score, {version: 1, attempts: {}, legacyTasks: []});
  assert.deepEqual(a.summary(a.state), {max: 100, score: 100, wrong: 0, firstPass: 0, finished: 0, tracked: 0, carried: 0, total: 1, penaltyPerWrong: 4});
  ready(a);
  performWork(a.state, a.round, a.challenge, [0]);
  assert.equal(a.summary(a.state).score, 96);
  assert.equal(b.summary(b.state).score, 100);
  assert.deepEqual(restore(b.state), b.state);
  assert.match(SAVE_KEY, /v2$/);
});

test('locked work and evidence, exploration, conversation and elapsed-time metadata have no cost', () => {
  const f = fixture(), {state, round, challenge} = f;
  const baseline = structuredClone(state.score);
  assert.equal(performWork(state, round, challenge, [0]), false);
  state.clues.push('other');
  assert.equal(present(state, challenge, 'other'), false);
  assert.equal(collect(state, round.clues[0], round), false);
  assert.equal(talk(state, 'other-character', round), false);
  talk(state, 'qa', round);
  assert.equal(performWork(state, round, challenge, [0]), false);
  collect(state, round.clues[0], round);
  talk(state, 'qa', round);
  state.casualTalk = {qa: 20};
  state.sceneTransitions = {seen: ['spring'], pending: null};
  state.elapsed = 500000;
  assert.deepEqual(state.score, baseline);
  assert.equal(f.summary(state).score, 100);
});

test('empty, malformed and incomplete submissions do not count as attempts', () => {
  for (const [mode, answer] of [['single', [1]], ['multi', [0, 2]], ['order', [2, 0, 1]]]) {
    const f = fixture(mode, answer), {state, round, challenge} = f;
    ready(f);
    const before = structuredClone(state);
    const invalid = [undefined, null, {}, '0', [], [-1], [999], ['0'], [NaN], [Infinity], [0.5], [0, 0], [0, undefined], Array(1)];
    if (mode === 'single') invalid.push([0, 1]);
    if (mode === 'order') invalid.push([0], [0, 1], [0, 1, 2, 3]);
    for (const selection of invalid) assert.equal(performWork(state, round, challenge, selection), false);
    assert.deepEqual(state, before, mode);
    assert.equal(f.summary(state).wrong, 0);
  }
});

test('every work mode penalizes distinct valid mistakes by four; multi may have a wrong count', () => {
  for (const [mode, answer, wrong] of [['single', [1], [0]], ['multi', [0, 2], [0]], ['order', [2, 0, 1], [0, 1, 2]]]) {
    const f = fixture(mode, answer), {state, round, challenge} = f;
    ready(f);
    assert.equal(performWork(state, round, challenge, wrong), false);
    assert.equal(f.summary(state).wrong, 1, mode);
    assert.equal(f.summary(state).score, 96, mode);
    assert.deepEqual(state.work, []);
  }
});

test('multi permutations, repeated clicks and reloads never count the same wrong selection twice', () => {
  const f = fixture('multi', [0, 2]);
  let {state} = f;
  ready(f);
  for (const selection of [[0, 1], [1, 0], [0, 1]]) performWork(state, f.round, f.challenge, selection);
  assert.equal(f.summary(state).wrong, 1);
  state = restore(state);
  performWork(state, f.round, f.challenge, [1, 0]);
  assert.equal(f.summary(state).wrong, 1);
  performWork(state, f.round, f.challenge, [0]);
  assert.equal(f.summary(state).wrong, 2);
  assert.equal(f.summary(state).score, 92);
  assert.deepEqual(restore(state), state);
});

test('only an available wrong evidence submission after work can cost points', () => {
  const f = fixture(), {state, round, challenge} = f;
  ready(f);
  state.clues.push('other', 'another');
  assert.equal(present(state, challenge, 'other'), false);
  performWork(state, round, challenge, challenge.work.answer);
  for (const clue of [null, undefined, '', [], {}, 'uncollected']) assert.equal(present(state, challenge, clue), false);
  assert.equal(f.summary(state).wrong, 0);
  assert.equal(present(state, challenge, 'other'), false);
  assert.equal(present(state, challenge, 'other'), false);
  assert.equal(f.summary(restore(state)).wrong, 1);
  assert.equal(present(state, challenge, 'another'), false);
  assert.equal(f.summary(state).score, 92);
  assert.equal(present(state, challenge, 'right'), true);
  assert.equal(f.summary(state).firstPass, 0);
  assert.equal(f.summary(state).tracked, 1);
});

test('correct phases are idempotent and closed phases cannot gain new penalties', () => {
  const f = fixture(), {state, round, challenge} = f;
  ready(f);
  performWork(state, round, challenge, [1]);
  const afterWork = structuredClone(state);
  assert.equal(performWork(state, round, challenge, [1]), true);
  assert.equal(performWork(state, round, challenge, [0]), false);
  assert.deepEqual(state, afterWork);
  state.clues.push('other');
  assert.equal(present(state, challenge, 'right'), true);
  const afterEvidence = structuredClone(state);
  assert.equal(present(state, challenge, 'right'), true);
  assert.equal(present(state, challenge, 'other'), false);
  assert.equal(performWork(state, round, challenge, [0]), false);
  assert.deepEqual(state, afterEvidence);
  assert.equal(f.summary(state).firstPass, 1);
  assert.equal(f.summary(state).score, 100);
});

test('all actual story tasks correct on the first attempt finish at 100', () => {
  let state = blankState(); state.started = true;
  for (const round of rounds) {
    for (const challenge of round.challenges) {
      complete(state, round, challenge);
      state = restore(state);
    }
    choose(state, round, round.decision.options[0]);
    next(state, rounds);
  }
  const summary = scoreSummary(state, rounds);
  assert.equal(summary.score, 100);
  assert.equal(summary.firstPass, 9);
  assert.equal(summary.tracked, 9);
  assert.equal(summary.finished, 9);
  assert.equal(summary.wrong, 0);
  assert.equal(summary.carried, 0);
});

test('old solved progress is carried without inventing first-pass credit or penalties', () => {
  const f = fixture(); complete(f.state, f.round, f.challenge);
  delete f.state.score;
  f.state.sceneTransitions = {seen: ['spring'], pending: null};
  f.state.casualTalk = {qa: ['hello']};
  const state = restore(f.state), summary = f.summary(state);
  assert.deepEqual(summary, {max: 100, score: 100, wrong: 0, firstPass: 0, finished: 1, tracked: 0, carried: 1, total: 1, penaltyPerWrong: 4});
  assert.deepEqual(state.sceneTransitions, f.state.sceneTransitions);
  assert.deepEqual(state.casualTalk, f.state.casualTalk);
  assert.equal(state.score.attempts.task.work.correct, false);
  assert.equal(state.score.attempts.task.work.carried, true);
  assert.equal(state.score.attempts.task.evidence.carried, true);
  const before = structuredClone(state.score);
  present(state, f.challenge, 'right');
  assert.deepEqual(state.score, before);
  assert.deepEqual(restore(state), state);
});

test('old partially worked task only scores new evidence and never retroactively awards work', () => {
  const f = fixture(); ready(f);
  f.state.work.push('task');
  delete f.state.score;
  let state = restore(f.state);
  const before = structuredClone(state.score);
  assert.equal(performWork(state, f.round, f.challenge, [1]), true);
  assert.equal(performWork(state, f.round, f.challenge, [0]), false);
  assert.deepEqual(state.score, before);
  state.clues.push('other');
  assert.equal(present(state, f.challenge, 'other'), false);
  state = restore(state);
  assert.equal(present(state, f.challenge, 'other'), false);
  assert.equal(present(state, f.challenge, 'right'), true);
  assert.equal(state.score.attempts.task.work.carried, true);
  assert.equal(state.score.attempts.task.evidence.correct, true);
  assert.deepEqual(f.summary(state), {max: 100, score: 96, wrong: 1, firstPass: 0, finished: 1, tracked: 0, carried: 1, total: 1, penaltyPerWrong: 4});
});

test('old conversation and collected clues alone do not exclude a newly completed first-pass task', () => {
  const f = fixture(); ready(f); delete f.state.score;
  const state = restore(f.state);
  complete(state, f.round, f.challenge);
  assert.equal(f.summary(state).carried, 0);
  assert.equal(f.summary(state).firstPass, 1);
});

test('score metadata corruption is sanitized independently without losing progress or other state', () => {
  const f = fixture(); complete(f.state, f.round, f.challenge);
  f.state.sceneTransitions = {seen: ['spring'], pending: null};
  for (const score of [null, [], 'bad', {}, {version: 999}, {version: 1, attempts: null}, {version: 1, attempts: [], legacyTasks: 'task'}, {version: 1, attempts: {task: {work: {correct: 'true'}, evidence: {correct: 1}}}}]) {
    const state = restore({...f.state, score});
    assert.equal(state.solved.includes('task'), true);
    assert.deepEqual(state.sceneTransitions, f.state.sceneTransitions);
    assert.equal(f.summary(state).score, 100);
    assert.equal(f.summary(state).firstPass, 0);
    assert.equal(f.summary(state).carried, 1);
    assert.deepEqual(restore(state), state);
  }
});

test('wrong-key sanitization rejects malformed values, duplicates, correct answers and unknown tasks', () => {
  const f = fixture(); ready(f);
  f.state.clues.push('other');
  f.state.score = JSON.parse('{"version":1,"attempts":{"__proto__":{"work":{"correct":true}},"task":{"work":{"correct":true,"wrongKeys":[null,4,"bad","[]","[-1]","[0,0]","[\\"0\\"]","[0]","[0]","[1]","[999]"]},"evidence":{"correct":true,"wrongKeys":[null,"","uncollected","other","other","right"]}},"unknown":{"work":{"wrongKeys":["[0]"]}}},"legacyTasks":[null,4,"task","unknown"]}');
  const state = restore(f.state), summary = f.summary(state);
  assert.equal(Object.hasOwn(state.score.attempts, '__proto__'), false);
  assert.equal({}.correct, undefined);
  assert.equal(state.score.attempts.task.work.correct, false);
  assert.equal(state.score.attempts.task.evidence.correct, false);
  assert.deepEqual(state.score.legacyTasks, []);
  assert.deepEqual(state.score.attempts.task.evidence.wrongKeys, []);
  assert.equal(summary.wrong, 1);
  assert.equal(summary.score, 96);
  assert.equal(summary.firstPass, 0);
  assert.deepEqual(restore(state), state);
});

test('points have a zero floor while the ledger still reports every distinct valid mistake', () => {
  const f = fixture('multi', [0, 1, 2, 3, 4, 5], ['A', 'B', 'C', 'D', 'E', 'F']); ready(f);
  for (let mask = 1; mask <= 30; mask++) {
    const selection = Array.from({length: 6}, (_, i) => i).filter(i => mask & (1 << i));
    assert.equal(performWork(f.state, f.round, f.challenge, selection), false);
  }
  assert.equal(f.summary(f.state).wrong, 30);
  assert.equal(f.summary(f.state).score, 0);
});

test('summary is pure and ignores unavailable task IDs or duplicate round definitions', () => {
  const f = fixture(); complete(f.state, f.round, f.challenge);
  const before = structuredClone(f.state);
  assert.equal(scoreSummary(f.state, [f.round, f.round]).firstPass, 1);
  assert.equal(scoreSummary(f.state, []).wrong, 0);
  assert.deepEqual(f.state, before);
});


test('a later task stays unscored even when its conversation and clue are already in a malformed save', () => {
  const f = fixture();
  const later = {...f.challenge, id: 'later', correctClueId: 'later-clue'};
  f.round.challenges.push(later);
  ready(f);
  f.state.clues.push('later-clue');
  const before = structuredClone(f.state.score);
  assert.equal(performWork(f.state, f.round, later, [0]), false);
  assert.deepEqual(f.state.score, before);
  assert.equal(f.summary(f.state).wrong, 0);
});
