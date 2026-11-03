import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_KEY, blankState, key, activeChallenge, canInspect, talk, collect, canWork, performWork, present, canDecide, choose, next, readState } from '../src/engine.js';
import { characters, rounds, endings } from '../src/story.js';

const mockStorage = raw => ({ getItem(k) { assert.equal(k, SAVE_KEY); return raw; } });
function prepareTask(s,r,ch) {
  assert.equal(talk(s,ch.characterId,r),true);
  assert.equal(collect(s,r.clues.find(c=>c.id===ch.correctClueId),r),true);
}
function solveRound(s,r) {
  for(const ch of r.challenges) {
    assert.equal(activeChallenge(s,r).id,ch.id);
    prepareTask(s,r,ch);
    assert.equal(performWork(s,r,ch,ch.work.answer),true);
    assert.equal(present(s,ch,ch.correctClueId),true);
  }
  assert.equal(activeChallenge(s,r),null);
}

test('story has eight characters, three linked chapters, valid work and all cast epilogues',()=>{
  assert.equal(characters.length,8);
  const ids=new Set(characters.map(c=>c.id));
  assert.deepEqual(ids,new Set(['player','boss','director','assistant','finance','qa','product','success']));
  assert.match(characters.find(c=>c.id==='success').role,/外包/);
  assert.equal(rounds.length,3);
  const globalIds=[], speaking=new Set(), modes=new Set();
  for(const r of rounds) {
    globalIds.push(r.id);
    assert.equal(r.npcs.length,3);assert.equal(r.clues.length,3);assert.equal(r.challenges.length,3);
    const npcs=new Set(r.npcs.map(n=>n.characterId)), clues=new Set(r.clues.map(c=>c.id));
    assert.equal(npcs.size,3);
    for(const n of npcs){assert.ok(ids.has(n));speaking.add(n);}
    for(const c of r.clues){globalIds.push(c.id);assert.equal(c.unlockedBy.length,1);for(const id of c.unlockedBy)assert.ok(npcs.has(id));}
    for(const ch of r.challenges){
      globalIds.push(ch.id);assert.ok(npcs.has(ch.characterId));assert.ok(clues.has(ch.correctClueId));
      assert.ok(ch.taskTitle);const w=ch.work;assert.ok(w?.prompt && w.success && w.failure);
      assert.ok(['single','multi','order'].includes(w.mode));modes.add(w.mode);
      assert.ok(Array.isArray(w.options)&&w.options.length>=2);assert.ok(w.options.every(o=>typeof o==='string'&&o.length));
      assert.ok(Array.isArray(w.answer)&&w.answer.length);assert.equal(new Set(w.answer).size,w.answer.length);
      assert.ok(w.answer.every(i=>Number.isInteger(i)&&i>=0&&i<w.options.length));
      if(w.mode==='single')assert.equal(w.answer.length,1);
    }
    for(const o of r.decision.options){globalIds.push(o.id);if(o.endingKey)assert.ok(endings[o.endingKey]);}
  }
  assert.equal(globalIds.length,new Set(globalIds).size);
  assert.deepEqual(speaking,new Set([...ids].filter(id=>id!=='player')));
  assert.equal(Object.keys(endings).length,3);
  for(const e of Object.values(endings)){assert.ok(e.summary&&e.codeOutcome);assert.equal(e.epilogues.length,8);assert.deepEqual(new Set(e.epilogues.map(x=>x.characterId)),ids);}
});

test('blank replay state has independent arrays and current save version',()=>{
  const a=blankState(), b=blankState();
  assert.deepEqual(a,{version:2,started:false,round:0,talked:[],clues:[],work:[],solved:[],choices:[],ending:null,score:{version:1,attempts:{},legacyTasks:[]}});
  for(const k of ['talked','clues','work','solved','choices']){assert.notEqual(a[k],b[k]);a[k].push('changed');}
  assert.deepEqual(b,blankState());assert.match(SAVE_KEY,/v2$/);
});

test('linked tasks enforce previous solution, conversation, evidence, work and presentation',()=>{
  const s=blankState(), r=rounds[0];
  for(let i=0;i<r.challenges.length;i++){
    const ch=r.challenges[i], clue=r.clues.find(c=>c.id===ch.correctClueId);
    assert.equal(activeChallenge(s,r).id,ch.id);
    for(const later of r.challenges.slice(i+1)){
      assert.equal(talk(s,later.characterId,r),false);
      assert.equal(collect(s,r.clues.find(c=>c.id===later.correctClueId),r),false);
      assert.equal(canWork(s,r,later),false);
      assert.equal(performWork(s,r,later,later.work.answer),false);
      assert.equal(present(s,later,later.correctClueId),false);
    }
    assert.equal(canInspect(s,clue,r),false);assert.equal(collect(s,clue,r),false);
    assert.equal(canWork(s,r,ch),false);assert.equal(performWork(s,r,ch,ch.work.answer),false);
    assert.equal(talk(s,ch.characterId,r),true);assert.equal(talk(s,ch.characterId,r),true);
    assert.equal(s.talked.filter(id=>id===key(s.round,ch.characterId)).length,1);
    assert.equal(canInspect(s,clue,r),true);assert.equal(canWork(s,r,ch),false);
    assert.equal(collect(s,clue,r),true);assert.equal(collect(s,clue,r),true);
    assert.equal(s.clues.filter(id=>id===clue.id).length,1);
    assert.equal(canWork(s,r,ch),true);assert.equal(present(s,ch,clue.id),false);
    const before=JSON.stringify(s);
    for(const bad of [null,undefined,[],[-1],[999],['0'],[...ch.work.answer,999]])assert.equal(performWork(s,r,ch,bad),false);
    assert.equal(JSON.stringify(s),before);
    assert.equal(performWork(s,r,ch,ch.work.answer),true);assert.equal(performWork(s,r,ch,ch.work.answer),true);
    assert.equal(s.work.filter(id=>id===ch.id).length,1);
    const inventory=[...s.clues];
    assert.equal(present(s,ch,'wrong-evidence'),false);assert.equal(present(s,ch,clue.id),true);assert.equal(present(s,ch,clue.id),true);
    assert.equal(s.solved.filter(id=>id===ch.id).length,1);assert.deepEqual(s.clues,inventory);
    assert.equal(canDecide(s,r),i===r.challenges.length-1);
  }
});

test('work single/multi/order answer matching supports retry and preserves caller selections',()=>{
  for(const [mode,answer,good,bad] of [['single',[1],[1],[0]],['multi',[0,2],[2,0],[0,0]],['order',[2,0,1],[2,0,1],[1,0,2]]]){
    const ch={id:'task',characterId:'qa',correctClueId:'clue',work:{mode,answer,options:['A','B','C']}},r={challenges:[ch]};
    const s=blankState();talk(s,'qa',r);s.clues.push('clue');
    assert.equal(performWork(s,r,ch,bad),false);assert.deepEqual(s.work,[]);
    const copy=[...good];assert.equal(performWork(s,r,ch,good),true);assert.deepEqual(good,copy);assert.deepEqual(s.work,['task']);
  }
});

test('round advancement requires full tasks and one canonical decision',()=>{
  const s=blankState();
  for(let i=0;i<rounds.length;i++){
    const r=rounds[i],o=r.decision.options[0];assert.equal(s.round,i);
    assert.equal(choose(s,r,o),false);assert.equal(next(s,rounds),false);
    for(const ch of r.challenges){prepareTask(s,r,ch);performWork(s,r,ch,ch.work.answer);assert.equal(choose(s,r,o),false);present(s,ch,ch.correctClueId);}
    assert.equal(choose(s,r,null),false);assert.equal(choose(s,r,{}),false);assert.equal(choose(s,r,{id:'invalid'}),false);
    assert.equal(next(s,rounds),false);
    assert.equal(choose(s,r,{id:o.id,label:'FORGED',consequence:'FORGED',endingKey:'FORGED',flag:'FORGED',epilogue:'FORGED'}),true);
    assert.deepEqual(s.choices[i],{round:i,optionId:o.id,label:o.label,consequence:o.consequence,flag:o.flag||null,epilogue:o.epilogue||null});
    assert.equal(s.ending,o.endingKey||null);assert.equal(choose(s,r,o),false);
    assert.equal(next(s,rounds),i<2);
  }
});

test('earlier conversations never unlock new chapter evidence',()=>{
  const s=blankState();for(let i=0;i<2;i++){solveRound(s,rounds[i]);choose(s,rounds[i],rounds[i].decision.options[0]);next(s,rounds);}
  for(const c of rounds[2].clues)assert.equal(canInspect(s,c,rounds[2]),false);
});

let routes=0;
for(const first of rounds[0].decision.options)for(const second of rounds[1].decision.options)for(const final of rounds[2].decision.options){
  routes++;
  test(`complete traversal: ${first.id} / ${second.id} / ${final.endingKey}`,()=>{
    const s=blankState();s.started=true;const options=[first,second,final];
    rounds.forEach((r,i)=>{solveRound(s,r);assert.equal(choose(s,r,options[i]),true);assert.equal(s.choices[i].optionId,options[i].id);assert.equal(next(s,rounds),i<2);assert.deepEqual(readState(mockStorage(JSON.stringify(s))),s);});
    assert.equal(s.ending,final.endingKey);assert.equal(s.clues.length,9);assert.equal(s.work.length,9);assert.equal(s.solved.length,9);assert.equal(s.choices.length,3);assert.equal(next(s,rounds),false);
  });
}
test('exactly twelve full decision routes are exercised',()=>assert.equal(routes,12));

test('missing malformed and incompatible saves recover without crashing',()=>{
  const valid=blankState();
  const invalid=[null,undefined,'','{bad','null','false','[]','{}'];
  for(const patch of [{version:1},{version:99},{started:'yes'},{round:-1},{round:3},{round:1.5},{round:'1'},{ending:'unknown'},{ending:undefined},{choices:[null]},{choices:[{}]},{choices:[{round:'1',optionId:'x',label:'x'}]},{choices:[{round:0,optionId:7,label:'x'}]},{choices:[{round:0,optionId:'x',label:null}]}])invalid.push(JSON.stringify({...valid,...patch}));
  for(const raw of invalid)assert.deepEqual(readState(mockStorage(raw)),blankState());
  for(const field of ['talked','clues','work','solved','choices']){
    const incomplete={...valid};delete incomplete[field];assert.deepEqual(readState(mockStorage(JSON.stringify(incomplete))),blankState());
    assert.deepEqual(readState(mockStorage(JSON.stringify({...valid,[field]:{}}))),blankState());
    if(field!=='choices')assert.deepEqual(readState(mockStorage(JSON.stringify({...valid,[field]:[null]}))),blankState());
  }
  assert.deepEqual(readState({getItem(){throw new Error('Storage unavailable');}}),blankState());assert.deepEqual(readState(null),blankState());
});
