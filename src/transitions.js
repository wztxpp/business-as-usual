// Presentation-only chapter bridges. Task state and the v2 save key are unchanged.
export const transitions = {
  spring: {
    id:'spring', chapter:'第一章', marker:'APR 17', elapsed:'故事开始的那一天', date:'4月17日', time:'09:20', place:'开放办公区', art:'scene-day.svg',
    title:'从一个被认真听见的想法开始。',
    paragraphs:['你把方案写在白板上。陈序挪来一把椅子，顾遥把显示器转向你。','今天要做的事还很具体：定好范围，接通界面，再一起把第一版测完。'],
    next:'陈序正在等你确认第一版范围。', button:'继续 · 进入第一章'
  },
  november: {
    id:'november', chapter:'第二章', marker:'NOV 28', elapsed:'七个多月后', date:'11月28日', time:'23:47', place:'加班的办公室', art:'scene.svg',
    title:'办公室的灯，开始亮到天明。',
    paragraphs:['第一版顺利交付后，试用用户慢慢多了起来。','入秋，大厂把同类功能放进了免费套餐。你们接连六周加班，修功能、追客户，回复却越来越少。','今晚，罗启明又把大家叫到会议桌前。'],
    next:'先决定有限时间里，真正值得做的两件事。', button:'继续 · 进入第二章'
  },
  handoff: {
    id:'handoff', chapter:'第二章 · 收尾', marker:'NOV 30', elapsed:'两天后', date:'11月30日', time:'16:10', place:'办公室 · 交接时刻', art:'scene-day.svg',
    title:'工作做完了，等来的却不是新需求。',
    paragraphs:['修复通过了，数据导出做好了，最后一轮回归也结束了。取消的订单没有回来。','午后，唐宁请大家核对交接材料。桌边多了几个纸箱。'],
    next:'去找唐宁，把这一段工作认真交接。', button:'继续 · 核对交接'
  },
  dawn: {
    id:'dawn', chapter:'第三章 · 第一节', marker:'DEC 12', elapsed:'十二天后', date:'12月12日', time:'09:10', place:'阳光照进办公室', art:'scene-day.svg',
    title:'这一次，订单真的回来了。',
    paragraphs:['你把产品、前端、后端的工作接到自己手里，把今天要交付的小版本排进清单。','今天早上，付费订单一笔接一笔。老板发来肯定的消息，窗边那盆植物也长出了新叶。','你想把好消息告诉叶青、陈序和顾遥。他们的工位空着，你把话先留在心里。'],
    next:'先把任务转交提醒做好，再整理这次增长。', button:'继续 · 进入第三章'
  },
  analysis: {
    id:'analysis', chapter:'第三章 · 第二节', marker:'18:40', elapsed:'同一天 · 傍晚', date:'12月12日', time:'18:40', place:'数据报表前', art:'scene-day.svg',
    title:'好消息，也值得认真复核。',
    paragraphs:['小版本通过了检查，老板准备把这份增长分享给合作方。','你给自己泡了一杯茶，开始整理金额、订单与统计口径。这本来是很平常的一步。'],
    next:'把汇总报表和原始记录放在一起看。', button:'继续 · 核对增长'
  },
  reconcile: {
    id:'reconcile', chapter:'第三章 · 第三节', marker:'22:15', elapsed:'几个小时后', date:'12月12日', time:'22:15', place:'工位上的档案', art:'scene.svg',
    title:'把不一致的地方，一项项找回来。',
    paragraphs:['单位可以换算，重复记录可以去除，但还有些日期没有对上。','你关掉汇总页面，把项目原件、个人文件和保存的消息摆到桌上。先不下结论，只把顺序还原。'],
    next:'完成最后一次材料核对。', button:'继续 · 查验原件'
  }
};

export function normalizeTransitions(state) {
  const raw=state.sceneTransitions;
  state.sceneTransitions={seen:Array.isArray(raw?.seen)?[...new Set(raw.seen.filter(id=>Object.hasOwn(transitions,id)))]:[],pending:Object.hasOwn(transitions,raw?.pending)?raw.pending:null};
  if(state.sceneTransitions.pending && (state.sceneTransitions.seen.includes(state.sceneTransitions.pending)||!eligible(state,state.sceneTransitions.pending)))state.sceneTransitions.pending=null;
  return state.sceneTransitions;
}
export function hasSeen(state,id){return state.sceneTransitions?.seen?.includes(id)||false;}
export function eligible(state,id){
  if(state.ending)return false;
  if(id==='spring')return state.round===0 && state.clues.length===0 && state.talked.length===0;
  if(id==='november')return state.round===1;
  if(id==='handoff')return state.round===1 && state.solved.includes('r2-c2') && !state.solved.includes('r2-c3');
  if(id==='dawn')return state.round===2;
  if(id==='analysis')return state.round===2 && state.solved.includes('r3-c1') && !state.solved.includes('r3-c2');
  if(id==='reconcile')return state.round===2 && state.solved.includes('r3-c2') && !state.solved.includes('r3-c3');
  return false;
}
export function beginTransition(state,id){
  if(!state.sceneTransitions)normalizeTransitions(state);
  if(!eligible(state,id)||hasSeen(state,id)||state.sceneTransitions.pending)return false;
  state.sceneTransitions.pending=id;
  return true;
}
export function finishTransition(state){
  const id=state.sceneTransitions?.pending;
  if(!id)return false;
  if(!hasSeen(state,id))state.sceneTransitions.seen.push(id);
  state.sceneTransitions.pending=null;
  return true;
}
export function requiresHandoffBridge(state){return eligible(state,'handoff')&&!hasSeen(state,'handoff');}

export function nextStageBridge(state){return ['handoff','analysis','reconcile'].find(id=>eligible(state,id)&&!hasSeen(state,id))||null;}

export function thirdChapterStage(state){return hasSeen(state,'reconcile')||state.talked.includes('2:assistant')||state.solved.includes('r3-c3')?2:hasSeen(state,'analysis')||state.talked.includes('2:boss')||state.solved.includes('r3-c2')?1:0;}
