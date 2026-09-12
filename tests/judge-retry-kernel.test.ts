import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel } from '@/kernel/create-kernel';
import { CaelianDatabase } from '@/storage/database';
import { IMPERIAL_QUEST_ID } from '@/imperial/constants';
import { initialImperialState } from '@/imperial/model';
import { imperialHistoryContext } from '@/imperial/history';

let kernel: ReturnType<typeof createKernel> | undefined;
let db: CaelianDatabase | undefined;
const originalFetch = window.fetch;
afterEach(async () => {
  await kernel?.shutdown(); kernel = undefined;
  if (db) { db.close(); await db.delete(); db = undefined; }
  window.fetch = originalFetch;
  delete window.SillyTavern; delete window.eventOn; delete window.tavern_events;
  delete (window as unknown as Record<string, unknown>).TavernHelper;
  localStorage.clear(); sessionStorage.clear();
});

async function setup(imperial = false) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  window.eventOn = vi.fn((event, handler) => { handlers.set(String(event), handler); return { stop: () => handlers.delete(String(event)) }; });
  window.tavern_events = { GENERATION_ENDED:'ended', GENERATION_STARTED:'started', MESSAGE_DELETED:'deleted', CHAT_CHANGED:'changed' };
  const chat: Array<{ mes:string; is_user:boolean }> = [];
  const context = { chatId:'retry-chat', name1:'测试玩家', chat, setExtensionPrompt:vi.fn() };
  window.SillyTavern = { getContext: () => context };
  const helper = { setChatMessages: vi.fn(async (messages: Array<{ message_id:number; message:string }>) => {
    for (const item of messages) chat[item.message_id]!.mes = item.message;
  }) };
  (window as unknown as Record<string, unknown>).TavernHelper = helper;
  const calls: Array<{ messages:Array<{ content:string }>; signal?:AbortSignal | null }> = [];
  let mode: 'fail' | 'pass' | 'hold' = 'fail';
  let release: (() => void) | undefined;
  window.fetch = vi.fn(async (url, init) => {
    if (!String(url).startsWith('https://judge.example/')) return new Response(null, {status:404});
    calls.push({ ...JSON.parse(String(init?.body)), signal:init?.signal });
    if (mode === 'fail') return new Response('busy', {status:503});
    if (mode === 'hold') await new Promise<void>(resolve => { release = resolve; });
    const state = initialImperialState();
    state.currentEvent = {text:'议会送来邀请。', known:true, evidence:'议会送来邀请。'};
    const result = imperial
      ? { state, summary:'议会送来邀请。', majorProgress:[], succession:{completed:false, winner:'', winnerIsPlayer:false, confidence:0, evidence:''} }
      : { sceneState:'in_scene', progress:'stay', completionGateSatisfied:false, matchedTransitionId:null, suggestedNodeId:null, confidence:0.8, evidence:['芙萝拉继续整理花束。'], summary:'芙萝拉继续整理花束。' };
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}), {status:200});
  });
  const name = `judge-retry-${crypto.randomUUID()}`;
  kernel = createKernel({channel:'alpha',version:'0.2.0-alpha.test',buildId:'retry-test',databaseName:name,sourceWindow:window});
  db = new CaelianDatabase('alpha',name);
  await kernel.initialize();
  await kernel.api.execute({id:'create',type:'player.create',payload:{name:'测试玩家',classMain:'knight',subclass:'holy_knight'}});
  await kernel.api.execute({id:'level',type:'player.update',payload:{level:6}});
  kernel.api.configureQuestJudge({endpoint:'https://judge.example',model:'test'});
  await kernel.api.acceptManagedQuest(imperial ? IMPERIAL_QUEST_ID : 'side_flora_says');
  chat.push({mes:'我查看消息。',is_user:true},{mes:imperial ? '议会送来邀请。' : '芙萝拉继续整理花束。',is_user:false});
  async function fail() {
    const done = vi.fn(); const off = kernel!.api.on('tavern.changed',done);
    handlers.get('ended')?.();
    await expect.poll(() => done.mock.calls.length).toBeGreaterThan(0); off();
    expect(kernel!.api.getQuestJudgeStatus().lastError).toContain('HTTP 503');
    expect(await db!.questFloorCheckpoints.count()).toBe(0);
  }
  return {api:kernel.api, chat, context, calls, handlers, fail, helper,
    mode:(value:typeof mode) => { mode=value; }, release:() => release?.()};
}

describe('副 API 失败后手动重试', () => {
  it('手动推进后继续正文以新节点判定，旧楼层变化及迟到副 API 不能撤销确认', async () => {
    const h = await setup(); h.mode('pass');
    await h.api.retryQuestJudge();
    const before = (await db!.questTrackerStates.toArray())[0]!;
    expect(await db!.questFloorCheckpoints.count()).toBe(1);
    await h.api.completeTrackedQuestNode({questId:before.questId,expectedNodeId:before.current.currentNodeId,expectedRevision:before.manualRevision??0,transitionId:(await h.api.getTrackedQuest())!.manualChoices![0]!.transitionId});
    const confirmed = (await db!.questTrackerStates.toArray())[0]!;
    expect(confirmed.current.currentNodeId).not.toBe(before.current.currentNodeId);
    expect(confirmed.baseline).toEqual(confirmed.current);
    await h.api.retryQuestJudge();
    expect(h.calls).toHaveLength(1); // Old body cannot judge the next node.
    h.chat[1]!.mes += '\n旧正文的后处理内容。';
    h.handlers.get('started')?.();
    h.chat.push({mes:'我继续和芙萝拉交谈。',is_user:true},{mes:'芙萝拉继续整理花束。',is_user:false});
    h.mode('hold');h.handlers.get('ended')?.();
    await expect.poll(() => h.calls.length).toBe(2);
    expect(h.calls[1]!.messages.map(message=>message.content).join('\n')).toContain(confirmed.current.currentNodeId);
    expect((await db!.questTrackerStates.toArray())[0]!.current.currentNodeId).toBe(confirmed.current.currentNodeId);
    await h.api.completeTrackedQuestNode({questId:confirmed.questId,expectedNodeId:confirmed.current.currentNodeId,expectedRevision:confirmed.manualRevision??0,transitionId:(await h.api.getTrackedQuest())!.manualChoices![0]!.transitionId});
    const second = (await db!.questTrackerStates.toArray())[0]!;
    h.release();
    await expect.poll(() => h.api.getQuestJudgeStatus().evaluating).toBe(false);
    expect((await db!.questTrackerStates.toArray())[0]!.current.currentNodeId).toBe(second.current.currentNodeId);
    h.chat.splice(3,1); h.handlers.get('deleted')?.(3);
    await expect.poll(async () => db!.questFloorCheckpoints.count()).toBe(0);
    expect((await db!.questTrackerStates.toArray())[0]!.current.currentNodeId).toBe(second.current.currentNodeId);
  });

  it('皇权面板可重Roll成功楼层，失败保持原状态，成功替换且删除仍回退到原始基线', async () => {
    const h=await setup(true);h.mode('pass');await h.api.retryQuestJudge();
    const first=(await db!.questFloorCheckpoints.toArray())[0]!;
    const original=h.chat[1]!.mes;
    await expect.poll(() => document.querySelector<HTMLButtonElement>('.imperial-launcher')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.imperial-launcher')!.click();
    await expect.poll(() => document.querySelector<HTMLButtonElement>('.imperial-tools button')).not.toBeNull();
    h.mode('fail');document.querySelector<HTMLButtonElement>('.imperial-tools button')!.click();
    await expect.poll(() => h.calls.length).toBe(2);
    await expect.poll(() => document.querySelector<HTMLButtonElement>('.imperial-tools button')?.disabled).toBe(false);
    expect(h.chat[1]!.mes).toBe(original);expect((await db!.questFloorCheckpoints.toArray())[0]).toEqual(first);
    h.mode('hold');const button=document.querySelector<HTMLButtonElement>('.imperial-tools button')!;button.click();button.click();
    await expect.poll(() => h.calls.length).toBe(3);expect(button.disabled).toBe(true);
    h.release();await expect.poll(async () => (await db!.questFloorCheckpoints.toArray())[0]?.after.imperial?.revision).toBe(2);
    expect(await db!.questFloorCheckpoints.count()).toBe(1);
    expect((await db!.questFloorCheckpoints.toArray())[0]!.before).toEqual(first.before);
    expect(h.calls[2]!.messages[1]!.content).toContain('不存在上一条有效标签记录');
    h.chat.splice(1,1);h.handlers.get('deleted')?.(1);
    await expect.poll(async () => db!.questFloorCheckpoints.count()).toBe(0);
    expect((await db!.questTrackerStates.toArray())[0]!.current.imperial).toBeUndefined();
  });

  it('普通任务失败提示可重试同楼；成功后再次点击不重复判定或新增检查点', async () => {
    const h = await setup(); await h.fail(); h.mode('pass');
    await expect.poll(() => [...document.querySelectorAll<HTMLButtonElement>('.notification-action')].find(button => button.textContent?.includes('重试副 API'))).toBeDefined();
    [...document.querySelectorAll<HTMLButtonElement>('.notification-action')].find(button => button.textContent?.includes('重试副 API'))!.click();
    await expect.poll(async () => db!.questFloorCheckpoints.count()).toBe(1);
    await expect.poll(() => h.api.getQuestJudgeStatus().evaluating).toBe(false);
    expect(h.calls).toHaveLength(2); expect(h.chat[1]!.mes).toBe('芙萝拉继续整理花束。');
    await h.api.retryQuestJudge(); expect(h.calls).toHaveLength(2);
    expect(await db!.questFloorCheckpoints.count()).toBe(1);
  });

  it('皇权状态更新可在设置面板重试，继续读取上一楼标签并只写当前楼一次', async () => {
    const h = await setup(true);
    const previous = initialImperialState(); previous.playerCamp='玩家手动保留的阵营';
    h.chat.unshift({mes:'上一轮。'+imperialHistoryContext(previous),is_user:false});
    await h.fail(); h.mode('pass');
    await h.api.openPanel('settings');
    await expect.poll(() => document.querySelector('[data-caelian-panel="settings"]')?.textContent).toContain('重试本楼副 API');
    [...document.querySelectorAll<HTMLButtonElement>('[data-caelian-panel="settings"] button')].find(button => button.textContent?.includes('重试本楼副 API'))!.click();
    await expect.poll(() => h.chat[2]!.mes).toContain('<caelian-imperial-state>');
    await expect.poll(() => h.api.getQuestJudgeStatus().evaluating).toBe(false);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.messages[1]!.content).toContain('玩家手动保留的阵营');
    expect(h.chat[0]!.mes).toContain('玩家手动保留的阵营');
    expect(await db!.questFloorCheckpoints.count()).toBe(1);
    await h.api.retryQuestJudge(); expect(h.calls).toHaveLength(2);
  });

  it('双击重试只发出一个请求，完成后释放按钮', async () => {
    const h=await setup(); await h.fail(); h.mode('hold');
    const first=h.api.retryQuestJudge(); const second=h.api.retryQuestJudge();
    await expect.poll(() => h.calls.length).toBe(2); await second;
    expect(h.api.getQuestJudgeStatus().evaluating).toBe(true);
    h.release(); await first;
    expect(h.calls).toHaveLength(2); expect(h.api.getQuestJudgeStatus().evaluating).toBe(false);
  });

  it('重试途中删楼会丢弃迟到返回，新楼仍可正常重试', async () => {
    const h=await setup(true); await h.fail(); h.mode('hold');
    const pending=h.api.retryQuestJudge(); await expect.poll(() => h.calls.length).toBe(2);
    h.chat.splice(1,1); h.handlers.get('deleted')?.(1); h.release(); await pending;
    expect(await db!.questFloorCheckpoints.count()).toBe(0);
    h.chat.push({mes:'议会送来邀请，新分支。',is_user:false}); h.mode('pass');
    await h.api.retryQuestJudge();
    expect(h.calls).toHaveLength(3); expect(h.chat[1]!.mes).toContain('<caelian-imperial-state>');
  });

  it('正文生成期间不能发起重试；旧失败按钮不能重试修改后的正文', async () => {
    const h=await setup(); await h.fail();
    h.handlers.get('started')?.(); await h.api.retryQuestJudge(); expect(h.calls).toHaveLength(1);
    h.chat[1]!.mes='新的正文';
    h.mode('pass'); h.handlers.get('ended')?.();
    await expect.poll(async () => db!.questFloorCheckpoints.count()).toBe(1);
    [...document.querySelectorAll<HTMLButtonElement>('.notification-action')].find(button => button.textContent?.includes('重试副 API'))?.click();
    await h.api.retryQuestJudge(); expect(h.calls).toHaveLength(2);
  });

  it('普通任务取消追踪后不能重试旧任务', async () => {
    const h=await setup(); await h.fail(); await h.api.pauseTrackedQuest(); h.mode('pass');
    await h.api.retryQuestJudge(); expect(h.calls).toHaveLength(1);
    expect(await db!.questFloorCheckpoints.count()).toBe(0);
  });
});
