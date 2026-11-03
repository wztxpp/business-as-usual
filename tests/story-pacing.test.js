import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { characters, rounds, endings, ambientDialogues, emptyDesks, casualExchanges } from '../src/story.js';
import { SAVE_KEY, blankState, activeChallenge, canInspect, talk, collect, performWork, present, canDecide, choose, next, readState, scoreSummary } from '../src/engine.js';
import { transitions, normalizeTransitions, beginTransition, finishTransition, nextStageBridge } from '../src/transitions.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const strings = value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
const text = value => strings(value).join('\n');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const restore = state => readState({ getItem(key) { assert.equal(key, SAVE_KEY); return JSON.stringify(state); } });
const beforeReveal = rounds[2].challenges.map((challenge, index) => index === 2 ? Object.fromEntries(Object.entries(challenge).filter(([key]) => !['success', 'unlockedOption'].includes(key))) : challenge);
const clinicalReveal = /住院|病区|病房|精神科|护士|入院|被裁|裁撤|解除劳动关系|求职未果|失业|妄想|幻觉/;

function completeTask(state, round, challenge) {
  assert.equal(activeChallenge(state, round)?.id, challenge.id);
  const clue = round.clues.find(clue => clue.id === challenge.correctClueId);
  assert.equal(canInspect(state, clue, round), false);
  assert.equal(talk(state, challenge.characterId, round), true);
  assert.equal(collect(state, clue, round), true);
  assert.equal(performWork(state, round, challenge, challenge.work.answer), true);
  assert.equal(present(state, challenge, clue.id), true);
}

function playBridge(state, id) {
  const before = structuredClone(state);
  assert.equal(beginTransition(state, id), true, id);
  const restored = restore(state);
  normalizeTransitions(restored);
  assert.equal(restored.sceneTransitions.pending, id);
  for (const key of ['round', 'talked', 'clues', 'work', 'solved', 'choices', 'score']) assert.deepEqual(restored[key], before[key], `${id}: ${key}`);
  assert.equal(beginTransition(restored, id), false);
  assert.equal(finishTransition(restored), true);
  assert.equal(finishTransition(restored), false);
  assert.equal(beginTransition(restored, id), false);
  return restored;
}

test('the published big-company competition task remains exactly unchanged', () => {
  // Canonical object digest from the original approved feature-tradeoff task,
  // src/story.js rounds[1].challenges[0]. No repository metadata is needed to run.
  const digest = createHash('sha256').update(JSON.stringify(canonical(rounds[1].challenges[0]))).digest('hex');
  assert.equal(digest, '55fec45e7726ee8f75d71d1cb187c11d66b919b3618b3ba6a4488ab2718708b8');
});

test('chapter two keeps the three colleagues leaving and never announces the player departure', () => {
  const chapter = text([rounds[1], characters.map(c => ambientDialogues[c.id]?.[1]), characters.map(c => casualExchanges[c.id]?.[1]), transitions.november, transitions.handoff]);
  assert.doesNotMatch(chapter, /第四(?:只|个)?(?:纸箱|箱子)|第4(?:只|个)?(?:纸箱|箱子)|四只纸箱|第四份.{0,8}(?:离职|解雇|裁员)/);
  assert.doesNotMatch(chapter, /(?:你|林屿).{0,16}(?:被裁|被解雇|解除劳动关系|离职通知|裁员通知)|你的(?:离职|解雇|裁员)|林屿.{0,8}离职/);
  assert.match(rounds[1].clues[2].detail, /三只纸箱.*叶青、陈序、顾遥/);
  assert.match(rounds[1].challenges[2].success, /你回到自己的桌前.*待办/);
  assert.doesNotMatch(chapter, clinicalReveal);
});

test('chapter three has a normal comeback, later discrepancy, then document reconstruction', () => {
  const chapter = rounds[2];
  assert.equal(chapter.sections.length, 3);
  assert.deepEqual(chapter.sections.map(section => section.time), ['09:10', '18:40', '22:15']);
  assert.equal(chapter.intro, chapter.sections[0].intro);
  assert.match(chapter.sections[0].intro, /新增3笔付费订单/);
  assert.match(chapter.sections[1].intro, /单位|数据源/);
  assert.match(chapter.sections[2].intro, /时间线/);
  // April 17 and December 12 in the same year cannot both be Monday.
  assert.doesNotMatch(text([chapter.intro, chapter.sections]), /十二月十二日，周一/);
});

test('no visible pre-completion chapter-three material reveals hospitalization or firing', () => {
  const chapter = rounds[2];
  const visible = text([chapter.title, chapter.location, chapter.objective, chapter.intro, chapter.sections, chapter.npcs, chapter.clues, beforeReveal, emptyDesks, characters.map(c => ambientDialogues[c.id]?.[2]), characters.map(c => casualExchanges[c.id]?.[2]), transitions.dawn, transitions.analysis, transitions.reconcile]);
  assert.doesNotMatch(visible, clinicalReveal);
  assert.doesNotMatch(visible, /一切都是假的|一直在幻想|想象中的复工|已经失去的生活/);
});

test('the entire first comeback task succeeds without planting an early anomaly', () => {
  const chapter = rounds[2], first = chapter.challenges[0];
  const visible = text([chapter.intro, chapter.sections[0], chapter.npcs[0], chapter.clues[0], first, emptyDesks, characters.map(c => ambientDialogues[c.id]?.[2]), transitions.dawn]);
  assert.doesNotMatch(visible, /旧演示|重放|演示数据|时间戳却|时间没有向前|记忆对不上|找不到支付|错觉|幻觉|想象中的|过于安静|似乎换过|1000万元/);
  assert.match(first.success, /今天又有5笔付费.*累计18笔/);
  assert.match(first.success, /1800元/);
  assert.match(first.success, /流程完整/);
});

test('growth audit explicitly normalizes 1000 yuan to 0.1 ten-thousand yuan, not 1000', () => {
  const audit = rounds[2].challenges[1];
  const clue = rounds[2].clues.find(clue => clue.id === audit.correctClueId);
  assert.match(clue.detail, /10笔订单.*每笔100元.*合计1000元.*万元.*0\.1/);
  assert.match(audit.success, /1000元.*0\.1万元.*不是1000万元/);
  assert.match(audit.work.success, /0\.1万元.*1000万元/);
  assert.match(audit.success, /支付依据/);
  assert.match(audit.success, /增量.*一样|曲线.*重复/);
  assert.equal(audit.work.mode, 'multi');
  assert.ok(audit.work.answer.length >= 3);
});

test('only final delivery reveals the lost job and care, preserving the real earlier kindness', () => {
  const final = rounds[2].challenges[2];
  assert.doesNotMatch(text([final.prompt, final.failure, final.work, rounds[2].clues[2]]), clinicalReveal);
  assert.match(final.success, /你也在被裁的名单里/);
  assert.match(final.success, /几个月.*投递简历/);
  assert.match(final.success, /想象中的复工.*已经失去的生活/);
  assert.match(final.success, /次年五月.*精神科住院.*照护/);
  assert.match(final.unlockedOption.reply, /小单是真的.*合照是真的/);
  assert.match(final.unlockedOption.reply, /不是你的过错/);
  assert.match(rounds[2].reveal, /恢复不会.*完成/);
  assert.match(rounds[2].reveal, /善意没有被推翻.*值得被认真对待/);
  for (const ending of Object.values(endings)) {
    assert.match(text([ending.summary, ending.codeOutcome]), /照护|陪伴/);
    assert.doesNotMatch(text(ending), /立刻康复|马上痊愈|彻底治愈|都是你的错/);
  }
});

test('all eight desks have distinct concrete descriptions and personal memories without spoilers', () => {
  const ids = characters.map(character => character.id).sort();
  assert.deepEqual(Object.keys(emptyDesks).sort(), ids);
  assert.equal(new Set(Object.values(emptyDesks).map(desk => desk.description)).size, 8);
  assert.equal(new Set(Object.values(emptyDesks).map(desk => desk.memory)).size, 8);
  for (const [id, desk] of Object.entries(emptyDesks)) {
    assert.ok(typeof desk.description === 'string' && desk.description.length >= 25, id);
    assert.ok(typeof desk.memory === 'string' && desk.memory.length >= 25, id);
    assert.match(desk.memory, /我记得/);
    assert.doesNotMatch(text(desk), clinicalReveal);
    assert.equal(ambientDialogues[id][2], desk.description);
  }
});

test('first two chapters offer at least two distinct exchanges in every before/during/after phase', () => {
  for (const {id} of characters) {
    assert.equal(ambientDialogues[id].length, 3);
    for (let chapter = 0; chapter < 2; chapter++) {
      const allPrompts = [];
      for (const phase of ['before', 'during', 'after']) {
        const exchanges = casualExchanges[id][chapter][phase];
        assert.ok(exchanges.length >= 2, `${id} chapter ${chapter + 1} ${phase}`);
        for (const exchange of exchanges) {
          assert.ok(typeof exchange.player === 'string' && exchange.player.trim());
          assert.ok(typeof exchange.reply === 'string' && exchange.reply.trim());
          allPrompts.push(exchange.player);
        }
      }
      // UI chat history uses the player prompt as its key across phase changes.
      assert.equal(new Set(allPrompts).size, allPrompts.length, `${id} chapter ${chapter + 1}: prompt keys`);
    }
  }
});

test('professional tasks contain substantive multiple selections and ordered procedures', () => {
  const tasks = rounds.flatMap(round => round.challenges);
  const ordered = tasks.filter(task => task.work.mode === 'order');
  const multiple = tasks.filter(task => task.work.mode === 'multi');
  assert.ok(ordered.length >= 4);
  assert.ok(multiple.length >= 4);
  for (const task of tasks) {
    assert.ok(task.work.options.length >= 4, task.id);
    assert.ok(task.work.answer.length >= 2, task.id);
    if (task.work.mode === 'order') assert.ok(task.work.answer.length >= 4, task.id);
    if (task.work.mode === 'multi') assert.ok(task.work.answer.length < task.work.options.length, task.id);
    assert.match(text(task.work), /验收|编号|记录|数据|版本|支付|来源|回归/);
  }
});

test('UI routes third-chapter avatars to desks and keeps task messages on a separate entry', () => {
  assert.match(main, /@click="state\.round===2\?openDesk\(c\.id\):openPerson\(c\.id\)"/);
  assert.match(main, /v-if="state\.round===2 && activeTask" class="task-message"[^\n]*@click="hint"/);
  assert.match(main, /function openDesk\(id\)\s*\{[^\n]*desk\.value=id;[^\n]*person\.value=null/);
  assert.match(main, /emptyDesks\[desk\]\?\.description/);
  assert.match(main, /emptyDesks\[desk\]\?\.memory/);
});

test('casual UI exchanges never claim tasks or write scoring attempts', () => {
  const chat = main.match(/function chat\(exchange\)\s*\{([^\n]*)\}/)?.[1];
  assert.ok(chat, 'chat handler exists');
  assert.match(chat, /casualLog\.value\.push\(exchange\)/);
  assert.doesNotMatch(chat, /game\.|state\.|talk\(|performWork\(|present\(/);
  assert.match(main, /@click="chat\(exchange\)"/);
  assert.match(main, /闲聊、探索、(?:时间|耗时)和(?:故事|剧情)选择不扣分/);
});

test('UI restarts transition state, refreshes old choice copy, and displays chapter-three stages', () => {
  const restart = main.match(/function restart\(\)\s*\{([^\n]*)\}/)?.[1];
  assert.ok(restart);
  assert.match(restart, /Object\.assign\(state,game\.blankState\(\)\)/);
  assert.match(restart, /state\.sceneTransitions=\{seen:\[\],pending:null\}/);
  assert.match(restart, /casualLog\.value=\[\]/);
  assert.match(main, /const sceneDate[^\n]*12月12日/);
  assert.match(main, /round\.sections\?\.\[thirdStage\]\?\.title/);
  assert.match(main, /const sceneIntro[^\n]*round\.value\.sections/);
  assert.match(main, /for\(const choice of state\.choices\)[^\n]*optionId[^\n]*consequence:current\.consequence/);
  assert.doesNotMatch(main, /你记得的11月|你记得的十一月/);
});

let routeCount = 0;
for (const first of rounds[0].decision.options) for (const second of rounds[1].decision.options) for (const final of rounds[2].decision.options) {
  routeCount++;
  test(`consolidated route stays at 100 through every reload and bridge: ${first.id}/${second.id}/${final.id}`, () => {
    let state = blankState(); state.started = true; normalizeTransitions(state);
    const decisions = [first, second, final];
    const seenStages = [];
    for (const [index, round] of rounds.entries()) {
      state = playBridge(state, ['spring', 'november', 'dawn'][index]);
      for (const challenge of round.challenges) {
        const bridge = nextStageBridge(state);
        if (bridge) { seenStages.push(bridge); state = playBridge(state, bridge); }
        completeTask(state, round, challenge);
        state = restore(state); normalizeTransitions(state);
        assert.equal(scoreSummary(state, rounds).score, 100);
      }
      assert.equal(canDecide(state, round), true);
      assert.equal(choose(state, round, decisions[index]), true);
      state = restore(state); normalizeTransitions(state);
      assert.equal(next(state, rounds), index < 2);
    }
    assert.deepEqual(seenStages, ['handoff', 'analysis', 'reconcile']);
    assert.deepEqual(state.sceneTransitions.seen, ['spring', 'november', 'handoff', 'dawn', 'analysis', 'reconcile']);
    assert.equal(state.ending, final.endingKey);
    assert.equal(state.solved.length, 9);
    assert.equal(state.choices.length, 3);
    assert.deepEqual(scoreSummary(state, rounds), {max: 100, score: 100, wrong: 0, firstPass: 9, finished: 9, tracked: 9, carried: 0, total: 9, penaltyPerWrong: 4});
  });
}
test('all twelve decision combinations are covered by consolidated traversal', () => assert.equal(routeCount, 12));

test('a legacy v2 save at the handoff continues through new stages without inventing past grades', () => {
  let state = blankState(); state.started = true;
  for (const challenge of rounds[0].challenges) completeTask(state, rounds[0], challenge);
  assert.equal(choose(state, rounds[0], rounds[0].decision.options[1]), true);
  assert.equal(next(state, rounds), true);
  for (const challenge of rounds[1].challenges.slice(0, 2)) completeTask(state, rounds[1], challenge);
  const progress = {solved: [...state.solved], work: [...state.work], choices: structuredClone(state.choices)};
  delete state.score; delete state.sceneTransitions;
  state = restore(state); normalizeTransitions(state);
  for (const key of Object.keys(progress)) assert.deepEqual(state[key], progress[key]);
  assert.equal(nextStageBridge(state), 'handoff');
  state = playBridge(state, 'handoff');
  completeTask(state, rounds[1], rounds[1].challenges[2]);
  assert.equal(choose(state, rounds[1], rounds[1].decision.options[1]), true);
  assert.equal(next(state, rounds), true);
  state = playBridge(state, 'dawn');
  for (const challenge of rounds[2].challenges) {
    const bridge = nextStageBridge(state);
    if (bridge) state = playBridge(state, bridge);
    completeTask(state, rounds[2], challenge);
    state = restore(state); normalizeTransitions(state);
  }
  assert.equal(choose(state, rounds[2], rounds[2].decision.options[2]), true);
  assert.deepEqual(scoreSummary(state, rounds), {max: 100, score: 100, wrong: 0, firstPass: 4, finished: 9, tracked: 4, carried: 5, total: 9, penaltyPerWrong: 4});
  assert.equal(state.ending, 'suspend');
});
