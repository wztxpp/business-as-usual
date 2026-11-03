import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ref, reactive, computed } from 'vue';
import * as game from '../src/engine.js';
import * as story from '../src/story.js';
import * as transitionApi from '../src/transitions.js';

const { characters, rounds } = story;
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const setupStart = main.indexOf('setup() {') + 'setup() {'.length;
const setupEnd = main.indexOf('\n},\ntemplate:', setupStart);
assert.ok(setupStart >= 'setup() {'.length && setupEnd > setupStart, 'App setup must be available for integration tests');
const setupSource = main.slice(setupStart, setupEnd);
const copy = value => JSON.parse(JSON.stringify(value));
const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('\n') : value && typeof value === 'object' ? Object.values(value).map(text).join('\n') : '';
const restore = state => game.readState({getItem: () => JSON.stringify(state)});
const clinicalReveal = /住院|病区|病房|精神科|护士|入院|被裁|裁撤|解除劳动关系|求职未果|失业|妄想|幻觉/;

// Exercise the actual setup handlers with real Vue refs/computeds and the real
// engine. DOM effects and persistence are isolated; this is not a browser test.
function uiFor(saved) {
  const calls = [], writes = [];
  const observedGame = {...game};
  for (const name of ['performWork', 'present', 'choose', 'next']) {
    observedGame[name] = (...args) => {calls.push(name); return game[name](...args);};
  }
  const context = {
    ...story, ...transitionApi, game: observedGame, ref, reactive, computed,
    watch() {}, nextTick(callback) {callback?.();},
    localStorage: {getItem: () => JSON.stringify(saved), setItem(key, value) {assert.equal(key, game.SAVE_KEY); writes.push(JSON.parse(value));}},
    document: {activeElement: null, body: {style: {}}, querySelector: () => null},
    window: {addEventListener() {}, scrollTo() {}}, setTimeout() {},
  };
  const ui = new Function(...Object.keys(context), setupSource)(...Object.values(context));
  return {ui, calls, writes};
}

function prepare(state, round, challenge) {
  assert.equal(game.talk(state, challenge.characterId, round), true);
  assert.equal(game.collect(state, round.clues.find(clue => clue.id === challenge.correctClueId), round), true);
}
function complete(state, round, challenge) {
  prepare(state, round, challenge);
  assert.equal(game.performWork(state, round, challenge, challenge.work.answer), true);
  assert.equal(game.present(state, challenge, challenge.correctClueId), true);
}
function beforeTask(id) {
  const state = game.blankState();
  state.started = true;
  // These tests isolate review behavior; bridges are covered by transitions.test.
  state.sceneTransitions = {seen: Object.keys(transitionApi.transitions), pending: null};
  for (const round of rounds) {
    for (const challenge of round.challenges) {
      if (challenge.id === id) return state;
      complete(state, round, challenge);
    }
    assert.equal(game.choose(state, round, round.decision.options[0]), true);
    assert.equal(game.next(state, rounds), true);
  }
  throw new Error(`Unknown challenge ${id}`);
}
function openReadyWork(ui, challenge) {
  ui.openPerson(challenge.characterId);
  ui.ask();
  ui.inspect(ui.round.value.clues.find(clue => clue.id === challenge.correctClueId));
  ui.openWork();
}
function chooseWork(ui, selection) {
  ui.clearWork();
  for (const index of selection) ui.pickWork(index);
}

for (const round of rounds) for (const challenge of round.challenges) {
  test(`${challenge.id}: correct work opens review but cannot accept evidence or advance the story`, () => {
    const {ui, calls, writes} = uiFor(beforeTask(challenge.id));
    const previousSolved = [...ui.state.solved], previousChoices = copy(ui.state.choices);
    openReadyWork(ui, challenge);
    chooseWork(ui, challenge.work.answer);
    ui.checkWork();
    assert.deepEqual(calls, ['performWork']);
    assert.equal(ui.workOpen.value, false);
    assert.equal(ui.workFeedback.value, 'success');
    assert.equal(ui.person.value, challenge.characterId);
    assert.equal(ui.evidencePicker.value, true);
    assert.equal(ui.activeTask.value.id, challenge.id);
    assert.equal(ui.state.work.includes(challenge.id), true);
    assert.deepEqual([...ui.state.solved], previousSolved);
    assert.deepEqual(copy(ui.state.choices), previousChoices);
    assert.equal(ui.state.round, rounds.indexOf(round));
    assert.equal(ui.state.ending, null);
    assert.equal(ui.ready.value, false);
    assert.equal(ui.state.score.attempts[challenge.id].work.correct, true);
    assert.equal(ui.state.score.attempts[challenge.id].evidence.correct, false);
    assert.equal(writes.length, 1, 'work is saved before the review opens');
    assert.equal(game.activeChallenge(restore(writes[0]), round).id, challenge.id);
    assert.equal(game.scoreSummary(ui.state, rounds).score, 100);

    ui.submitEvidence(round.clues.find(clue => clue.id === challenge.correctClueId));
    assert.deepEqual(calls, ['performWork', 'present']);
    assert.equal(ui.state.solved.includes(challenge.id), true);
    assert.notEqual(ui.activeTask.value?.id, challenge.id);
    assert.equal(ui.feedback.value, 'success');
    assert.equal(game.scoreSummary(ui.state, rounds).score, 100);
  });
}

test('all nine old v2 worked-but-unreviewed saves resume directly at explicit evidence review', () => {
  for (const round of rounds) for (const challenge of round.challenges) {
    const saved = beforeTask(challenge.id);
    prepare(saved, round, challenge);
    assert.equal(game.performWork(saved, round, challenge, challenge.work.answer), true);
    delete saved.score;
    const {ui, calls} = uiFor(saved);
    const priorWork = [...ui.state.work], priorSolved = [...ui.state.solved];
    ui.hint();
    assert.equal(ui.person.value, challenge.characterId, challenge.id);
    assert.equal(ui.workOpen.value, false);
    assert.equal(ui.activeTask.value.id, challenge.id);
    assert.equal(ui.evidencePicker.value, true);
    assert.deepEqual(calls, []);
    assert.deepEqual([...ui.state.work], priorWork);
    assert.deepEqual([...ui.state.solved], priorSolved);
    assert.equal(ui.state.score.attempts[challenge.id].work.carried, true);
    assert.equal(ui.state.score.attempts[challenge.id].evidence.correct, false);
    ui.closeDialog();
    ui.openPerson(challenge.characterId);
    assert.equal(ui.worked(challenge.id), true, 'reopening needs no extra work or reveal click');
    ui.submitEvidence(round.clues.find(clue => clue.id === challenge.correctClueId));
    assert.deepEqual(calls, ['present']);
    assert.equal(ui.state.solved.includes(challenge.id), true);
    const summary = game.scoreSummary(ui.state, rounds);
    assert.equal(summary.firstPass, 0, 'old work must not become a first-pass success');
    assert.equal(summary.tracked, 0);
    assert.equal(summary.carried, priorWork.length);
    assert.equal(summary.score, 100);
  }
});

test('wrong work stays in the workbench and unchanged evidence penalties survive review reopen and reload', () => {
  const round = rounds[0], challenge = round.challenges[1];
  let {ui, calls} = uiFor(beforeTask(challenge.id));
  openReadyWork(ui, challenge);
  chooseWork(ui, [1]);
  ui.checkWork();
  assert.equal(ui.workOpen.value, true);
  assert.equal(ui.workFeedback.value, 'failure');
  assert.equal(ui.person.value, null);
  assert.equal(ui.state.work.includes(challenge.id), false);
  assert.deepEqual(calls, ['performWork']);
  assert.equal(game.scoreSummary(ui.state, rounds).score, 96);
  ui.checkWork();
  assert.equal(game.scoreSummary(ui.state, rounds).wrong, 1);
  chooseWork(ui, challenge.work.answer);
  ui.checkWork();
  const wrongClue = round.clues[0];
  ui.submitEvidence(wrongClue);
  assert.equal(ui.feedback.value, 'failure');
  assert.equal(ui.activeTask.value.id, challenge.id);
  assert.equal(game.scoreSummary(ui.state, rounds).score, 92);
  ({ui, calls} = uiFor(copy(ui.state)));
  ui.hint();
  ui.submitEvidence(wrongClue);
  assert.equal(game.scoreSummary(ui.state, rounds).wrong, 2);
  assert.equal(game.scoreSummary(ui.state, rounds).score, 92);
  ui.submitEvidence(round.clues.find(clue => clue.id === challenge.correctClueId));
  assert.equal(game.scoreSummary(ui.state, rounds).firstPass, 1);
  assert.equal(game.scoreSummary(ui.state, rounds).tracked, 2);
  assert.equal(game.scoreSummary(ui.state, rounds).score, 92);
  assert.deepEqual(calls, ['present', 'present']);
});

test('locked, empty, malformed and incomplete work cannot trigger automatic review or a scoring attempt', () => {
  const challenge = rounds[0].challenges[2];
  const {ui, calls, writes} = uiFor(beforeTask(challenge.id));
  ui.openWork();
  ui.workSelection.value = [...challenge.work.answer];
  const lockedState = copy(ui.state);
  ui.checkWork();
  assert.deepEqual(copy(ui.state), lockedState);
  assert.equal(ui.workOpen.value, true);
  assert.equal(ui.person.value, null);
  openReadyWork(ui, challenge);
  const readyState = copy(ui.state);
  for (const selection of [[], [2], [2, 0, 3, 1], [0, 0, 1, 2, 3], [0, 1, 2, 3, 99]]) {
    ui.workSelection.value = selection;
    ui.checkWork();
    assert.deepEqual(copy(ui.state), readyState);
    assert.equal(ui.workOpen.value, true);
    assert.equal(ui.person.value, null);
    assert.equal(ui.evidencePicker.value, false);
    assert.equal(ui.activeTask.value.id, challenge.id);
  }
  assert.deepEqual(calls, Array(6).fill('performWork'));
  assert.deepEqual(writes, []);
  assert.equal(game.scoreSummary(ui.state, rounds).score, 100);
});

test('ordered selection toggles and clearing affect only local workbench state, never score or saves', () => {
  const challenge = rounds[0].challenges[2];
  const {ui, calls, writes} = uiFor(beforeTask(challenge.id));
  openReadyWork(ui, challenge);
  const original = copy(ui.state);
  ui.pickWork(2); ui.pickWork(0); ui.pickWork(3);
  assert.deepEqual([...ui.workSelection.value], [2, 0, 3]);
  ui.pickWork(0);
  assert.deepEqual([...ui.workSelection.value], [2, 3]);
  assert.deepEqual(copy(ui.state), original);
  ui.clearWork();
  assert.deepEqual([...ui.workSelection.value], []);
  assert.equal(ui.workFeedback.value, '');
  assert.deepEqual(copy(ui.state), original);
  assert.deepEqual(calls, []);
  assert.deepEqual(writes, []);
  chooseWork(ui, [0, 1, 2, 3, 4]);
  ui.checkWork();
  assert.equal(ui.workFeedback.value, 'failure');
  const afterWrong = copy(ui.state);
  ui.clearWork(); ui.clearWork();
  assert.deepEqual([...ui.workSelection.value], []);
  assert.equal(ui.workFeedback.value, '');
  assert.deepEqual(copy(ui.state), afterWrong);
  assert.equal(game.scoreSummary(ui.state, rounds).score, 96);
  assert.deepEqual(calls, ['performWork']);
  assert.deepEqual(writes, []);
  assert.equal(Object.hasOwn(ui.state, 'workSelection'), false);
});

test('review preserves optional chats and story choices as explicit separate actions', () => {
  const challenge = rounds[0].challenges[0], {ui, calls} = uiFor(beforeTask(challenge.id));
  openReadyWork(ui, challenge); chooseWork(ui, challenge.work.answer); ui.checkWork();
  const beforeChat = copy(ui.state);
  assert.ok(ui.casualOptions.value.length >= 2);
  ui.chat(ui.casualOptions.value[0]);
  assert.equal(ui.casualLog.value.length, 1);
  assert.deepEqual(copy(ui.state), beforeChat);
  assert.deepEqual(calls, ['performWork']);
  assert.match(main, /@click="chat\(exchange\)"/);
  assert.match(main, /@click="conversation='followup'"/);
  assert.match(main, /challenge\.unlockedOption\.reply/);
  assert.match(main, /@click="selectDecision\(option\)"/);
  assert.match(main, /@click="advance"/);
});

test('UI uses a compact chapter title and no redundant deliver-result control', () => {
  const banner = main.match(/<div class="mission-banner compact">([\s\S]*?)<div v-if="state.round>0"/)?.[1];
  assert.ok(banner);
  assert.match(banner, /<h1>\{\{round\.title\}\}<\/h1>/);
  assert.doesNotMatch(main, /\{\{round\.objective\}\}/);
  assert.doesNotMatch(main, /交付(?:这份|你的)?(?:工作)?结果(?:\s|<)/);
  const workbench = main.slice(main.indexOf('<div v-if="workOpen && activeTask"'), main.indexOf('<div v-if="decisionOpen"'));
  assert.doesNotMatch(workbench, /@click="handoff"|@click="submitEvidence/);
  const checkWork = setupSource.match(/function checkWork\(\)\s*\{([^\n]*)\}/)?.[1];
  assert.ok(checkWork);
  assert.match(checkWork, /if\(accepted\)\{persistNow\(\);handoff\(\);\}/);
  assert.doesNotMatch(checkWork, /game\.(?:present|choose|next)\(|submitEvidence\(|selectDecision\(|advance\(/);
});

test('worked tasks always show their success and evidence options without a reveal gate', () => {
  assert.match(main, /v-if="worked\(challenge\.id\)&&!solved\(challenge\.id\)" class="review-arrival"[^]*?\{\{challenge\.work\.success\}\}/);
  assert.match(main, /<div v-if="worked\(challenge\.id\)" class="evidence-picker">/);
  assert.doesNotMatch(main, /v-if="[^"]*evidencePicker[^"]*"[^>]*class="evidence-picker"/);
  assert.match(main, /allClues\.filter\(c=>found\(c\.id\)\)" :key="clue\.id" @click="submitEvidence\(clue\)"/);
});

test('order UI separates stable letter IDs from right-side step badges and offers a local clear control', () => {
  assert.match(main, /class="option-letter">\{\{String\.fromCharCode\(65\+i\)\}\}<\/span>/);
  assert.match(main, /class="selection-badge">\{\{workSelection\.includes\(i\)\?\(activeTask\.work\.mode==='order'\?'第'\+\(workSelection\.indexOf\(i\)\+1\)\+'步'/);
  assert.match(css, /\.work-option p\{flex:1\}/);
  assert.match(css, /\.work-option \.selection-badge\{[^}]*text-align:right/);
  assert.match(main, /@click="clearWork" :disabled="!workSelection\.length">清空顺序/);
  assert.match(main, /workSelection\.map\(i=>String\.fromCharCode\(65\+i\)\)\.join\(' → '\)/);
  assert.match(main, /activeTask\.work\.mode==='order' && workSelection\.length!==activeTask\.work\.answer\.length/);
  const clearWork = setupSource.match(/function clearWork\(\)\s*\{([^\n]*)\}/)?.[1];
  assert.ok(clearWork);
  assert.doesNotMatch(clearWork, /game\.|state\.|persistNow\(|localStorage/);
});

test('the full roster has the requested genders and scene hotspots name recognizable office places', () => {
  assert.deepEqual(Object.fromEntries(characters.map(character => [character.id, character.gender])), {
    player: 'male', boss: 'male', director: 'male', assistant: 'female',
    finance: 'female', qa: 'female', product: 'male', success: 'female',
  });
  assert.deepEqual(rounds.flatMap(round => round.clues.map(clue => clue.object)), [
    '陈序的工位', '顾遥的工位', '叶青的工位', '会议桌', '许岚的工位', '打印机旁', '你的电脑', '会议室', '文件柜',
  ]);
  assert.match(main, /所有人物与公司均为虚构/);
  assert.equal(game.SAVE_KEY, 'tomorrow-as-usual:v2');
  assert.equal(game.blankState().version, 2);
});

test('source cards show label, date, source and excerpt in both inspection and the workbench', () => {
  const inspection = main.slice(main.indexOf('<template v-else-if="inspected">'), main.indexOf('<template v-else><div class="panel-label">YOUR NOTEBOOK'));
  const workbench = main.slice(main.indexOf('<div v-if="workOpen && activeTask"'), main.indexOf('<div v-if="decisionOpen"'));
  assert.match(inspection, /v-for="material in inspected\.materials"/);
  assert.match(workbench, /v-for="material in allClues\.find\(c=>c\.id===activeTask\.correctClueId\)\.materials"/);
  for (const section of [inspection, workbench]) for (const field of ['label', 'date', 'source', 'excerpt']) {
    assert.ok(section.includes(`{{material.${field}}}`), `${field} rendered in each view`);
  }
});

test('final task supplies readable evidence for each stated comparison without revealing the ending', () => {
  const round = rounds[2], challenge = round.challenges[2], clue = round.clues.find(clue => clue.id === challenge.correctClueId);
  assert.ok(Array.isArray(clue.materials));
  assert.equal(clue.materials.length, 5);
  assert.equal(new Set(clue.materials.map(material => material.label)).size, 5);
  for (const material of clue.materials) for (const field of ['label', 'date', 'source', 'excerpt']) {
    assert.ok(typeof material[field] === 'string' && material[field].trim().length >= 8, `${material.label}: readable ${field}`);
  }
  const [april, november, nextApril, may, screenshot] = clue.materials;
  assert.match(april.date, /四月二十四日.*十二月十二日/);
  assert.match(april.excerpt, /流程完整.*首批10笔.*1000元/);
  assert.match(november.date, /十一月三十日.*次年五月/);
  assert.match(november.source, /林屿.*唐宁.*B-1130/);
  assert.match(nextApril.date, /次年四月八日/);
  assert.match(nextApril.excerpt, /旧记录.*不是一次新交付/);
  assert.match(may.date, /次年五月六日/);
  assert.match(may.excerpt, /情况说明.*摘录.*一起读/);
  assert.match(screenshot.source, /没有发送人.*支付凭证/);
  assert.match(screenshot.excerpt, /18笔.*没有.*订单编号/);
  assert.doesNotMatch(text([clue, challenge.prompt, challenge.failure, challenge.work]), clinicalReveal);
  assert.match(challenge.success, /被裁.*次年五月.*精神科住院/);
});

test('final ordering has one complete dependency chain and only one accepted permutation', () => {
  const round = rounds[2], challenge = round.challenges[2], work = challenge.work;
  assert.equal(work.mode, 'order');
  assert.equal(work.options.length, 5);
  assert.deepEqual(work.answer, [1, 3, 0, 4, 2]);
  const steps = work.answer.map(index => work.options[index]);
  for (const [step, pattern] of [
    [steps[0], /筛出.*四份.*原件.*增长截图.*待确认/],
    [steps[1], /已筛出.*两栏日期.*发生日.*转发日/],
    [steps[2], /已分开.*原始日期.*排序/],
    [steps[3], /排好的时间线.*四月.*18笔.*疑问/],
    [steps[4], /已标出.*疑问.*唐宁.*情况说明/],
  ]) assert.match(step, pattern);
  const permutations = values => values.length ? values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest])) : [[]];
  let accepted = 0;
  for (const selection of permutations([0, 1, 2, 3, 4])) {
    const state = beforeTask(challenge.id);
    prepare(state, round, challenge);
    const correct = game.performWork(state, round, challenge, selection);
    if (correct) {accepted++; assert.deepEqual(selection, work.answer);}
    assert.equal(game.activeChallenge(state, round).id, challenge.id);
    assert.equal(state.solved.includes(challenge.id), false);
  }
  assert.equal(accepted, 1);
});
