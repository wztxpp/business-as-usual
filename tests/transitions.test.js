import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_KEY, blankState, readState, next, choose, talk, collect, performWork, present } from '../src/engine.js';
import { rounds } from '../src/story.js';
import { transitions, normalizeTransitions, hasSeen, eligible, beginTransition, finishTransition, requiresHandoffBridge, thirdChapterStage } from '../src/transitions.js';

const gameplay = state => { const {sceneTransitions, ...rest}=state; return structuredClone(rest); };
const reload = state => readState({getItem(key) { assert.equal(key,SAVE_KEY); return JSON.stringify(state); }});
function solve(state, round, challenge) {
  assert.equal(talk(state,challenge.characterId,round),true);
  assert.equal(collect(state,round.clues.find(c=>c.id===challenge.correctClueId),round),true);
  assert.equal(performWork(state,round,challenge,challenge.work.answer),true);
  assert.equal(present(state,challenge,challenge.correctClueId),true);
}
function completeRound(state) {
  const round=rounds[state.round];
  for(const challenge of round.challenges) solve(state,round,challenge);
  assert.equal(choose(state,round,round.decision.options[0]),true);
}

test('legacy v2 saves gain presentation state without losing gameplay progress',()=>{
  const original=blankState();original.started=true;
  solve(original,rounds[0],rounds[0].challenges[0]);
  const state=reload(original);
  assert.equal(Object.hasOwn(state,'sceneTransitions'),false);
  assert.deepEqual(normalizeTransitions(state),{seen:[],pending:null});
  assert.deepEqual(gameplay(state),original);
  assert.equal(beginTransition(state,'spring'),false);
  assert.deepEqual(reload(state),state);
});

test('unknown, duplicate and invalid transition data is sanitized independently',()=>{
  for(const raw of [null,{},[],{seen:'spring',pending:'unknown'},{seen:['spring','spring',null,3,'unknown','dawn'],pending:'handoff'}]) {
    const state=blankState();state.started=true;state.sceneTransitions=raw;
    const before=gameplay(state);
    const cleaned=normalizeTransitions(state);
    assert.deepEqual(cleaned, {seen:Array.isArray(raw?.seen)?[...new Set(raw.seen.filter(id=>Object.hasOwn(transitions,id)))]:[],pending:null});
    assert.deepEqual(gameplay(state),before);
    assert.deepEqual(normalizeTransitions(state),cleaned);
  }
});

test('begin and finish are idempotent and never alter tasks, choices or chapter',()=>{
  for(const [id,round] of [['spring',0],['november',1],['dawn',2]]) {
    const state=blankState();state.started=true;state.round=round;
    const before=gameplay(state);
    assert.equal(beginTransition(state,id),true);
    assert.equal(beginTransition(state,id),false);
    assert.equal(beginTransition(state,'unknown'),false);
    assert.deepEqual(gameplay(state),before);
    assert.equal(finishTransition(state),true);
    assert.equal(finishTransition(state),false);
    assert.equal(beginTransition(state,id),false);
    assert.equal(hasSeen(state,id),true);
    assert.deepEqual(state.sceneTransitions,{seen:[id],pending:null});
    assert.deepEqual(gameplay(state),before);
  }
});

test('refresh during chapter transition neither skips nor duplicates chapter advancement',()=>{
  let state=blankState();state.started=true;
  for(const id of ['november','dawn']) {
    completeRound(state);
    assert.equal(next(state,rounds),true);
    const chapter=state.round, before=gameplay(state);
    assert.equal(beginTransition(state,id),true);
    state=reload(state);normalizeTransitions(state);
    assert.equal(state.sceneTransitions.pending,id);
    assert.equal(state.round,chapter);
    assert.deepEqual(gameplay(state),before);
    assert.equal(beginTransition(state,id),false);
    assert.equal(next(state,rounds),false);
    assert.equal(finishTransition(state),true);
    state=reload(state);normalizeTransitions(state);
    assert.equal(finishTransition(state),false);
    assert.equal(beginTransition(state,id),false);
    assert.equal(state.round,chapter);
    assert.deepEqual(gameplay(state),before);
  }
});

test('Nov28 chapter and Nov30 handoff bridges respect original task boundaries',()=>{
  const state=blankState();state.started=true;
  assert.equal(eligible(state,'november'),false);
  completeRound(state);assert.equal(next(state,rounds),true);
  assert.equal(eligible(state,'november'),true);
  assert.equal(requiresHandoffBridge(state),false);
  solve(state,rounds[1],rounds[1].challenges[0]);
  assert.equal(requiresHandoffBridge(state),false);
  solve(state,rounds[1],rounds[1].challenges[1]);
  assert.equal(requiresHandoffBridge(state),true);
  const before=gameplay(state);
  assert.equal(beginTransition(state,'handoff'),true);
  const restored=reload(state);normalizeTransitions(restored);
  assert.equal(restored.sceneTransitions.pending,'handoff');
  assert.equal(finishTransition(restored),true);
  assert.equal(requiresHandoffBridge(restored),false);
  assert.deepEqual(gameplay(restored),before);
  solve(restored,rounds[1],rounds[1].challenges[2]);
  assert.equal(eligible(restored,'handoff'),false);
  // An old save already past the handoff must not replay that phase.
  delete restored.sceneTransitions;
  normalizeTransitions(restored);
  assert.equal(requiresHandoffBridge(restored),false);
  restored.round=2;
  assert.equal(eligible(restored,'november'),false);
  assert.equal(eligible(restored,'handoff'),false);
});

test('a finished save cannot be interrupted by a new or stale transition',()=>{
  const state=blankState();state.started=true;state.round=2;state.ending='transparent';
  state.sceneTransitions={seen:['spring','november','handoff'],pending:'dawn'};
  const before=gameplay(state);
  normalizeTransitions(state);
  assert.equal(state.sceneTransitions.pending,null);
  for(const id of Object.keys(transitions)) {
    assert.equal(eligible(state,id),false);
    assert.equal(beginTransition(state,id),false);
  }
  assert.equal(requiresHandoffBridge(state),false);
  assert.equal(finishTransition(state),false);
  assert.deepEqual(gameplay(state),before);
});

test('bridge copy keeps the revealed timeline out of the subjective dawn',()=>{
  assert.equal(transitions.november.date,'11月28日');
  assert.equal(transitions.handoff.date,'11月30日');
  assert.match(transitions.handoff.elapsed,/两天/);
  assert.match(transitions.november.paragraphs.join(''),/六周/);
  assert.match(transitions.dawn.elapsed,/十二天/);
  assert.doesNotMatch(JSON.stringify(transitions.dawn),/五月|5月|住院|病区|精神科|次日/);
});

test('third chapter bridges follow completed work and preserve state on reload',()=>{
  let state=blankState();state.started=true;state.round=2;
  for(const [index,id] of [[0,'analysis'],[1,'reconcile']]){
    assert.equal(eligible(state,id),false);
    solve(state,rounds[2],rounds[2].challenges[index]);
    assert.equal(beginTransition(state,id),true);
    const before=gameplay(state);state=reload(state);normalizeTransitions(state);
    assert.equal(state.sceneTransitions.pending,id);assert.deepEqual(gameplay(state),before);
    assert.equal(finishTransition(state),true);assert.equal(beginTransition(state,id),false);
  }
});

test('third chapter atmosphere waits for explicit stage continuation',()=>{
 const state=blankState();state.started=true;state.round=2;normalizeTransitions(state);
 assert.equal(thirdChapterStage(state),0);
 solve(state,rounds[2],rounds[2].challenges[0]);assert.equal(thirdChapterStage(state),0);
 beginTransition(state,'analysis');assert.equal(thirdChapterStage(state),0);finishTransition(state);assert.equal(thirdChapterStage(state),1);
 solve(state,rounds[2],rounds[2].challenges[1]);assert.equal(thirdChapterStage(state),1);
 beginTransition(state,'reconcile');assert.equal(thirdChapterStage(state),1);finishTransition(state);assert.equal(thirdChapterStage(state),2);
});
