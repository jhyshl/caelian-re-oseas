import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { EventBus } from '@/kernel/event-bus';
import { QuestProgressRepository } from '@/storage/repositories/quest-progress-repository';
import { QuestCatalogLoader } from '@/quests/catalog';
import { initialQuestProgress } from '@/quests/state-machine';
import { manualQuestProgress } from '@/quests/manual-progress';
import { imperialQuestDefinition } from '@/imperial/definition';
import { IMPERIAL_QUEST_ID } from '@/imperial/constants';
import { initialImperialState, imperialResultSchema, hasSuccessionEvidence, type ImperialResult } from '@/imperial/model';
import { evaluateImperialTurn } from '@/imperial/service';
import { buildImperialJudgeMessages, imperialHistoryContext, stripImperialContext } from '@/imperial/prompt';
import { mountImperialOverlay, type ImperialOverlay } from '@/modules/imperial/mount';
import { loadRegionPlaces } from '@/content/catalogs/world';
import { imperialRecordAuthority, readImperialRecord } from '@/imperial/history';
import { normalizeRegion } from '@/worldbook/region-switcher';

const databases: CaelianDatabase[] = [];
let overlay: ImperialOverlay | undefined;
afterEach(async () => {
  overlay?.destroy(); overlay=undefined; vi.useRealTimers();
  for(const db of databases.splice(0)){db.close();await db.delete();}
});

async function setup() {
  const db=new CaelianDatabase('alpha',`imperial-test-${crypto.randomUUID()}`);databases.push(db);
  const events=new EventBus(), repository=new GameRepository(db,events);
  const profile=await repository.ensureProfile('imperial-test');
  await db.playerStates.update(profile.id,{created:true,level:6,name:'测试玩家'});
  const progress=new QuestProgressRepository(db);
  const quest=await progress.acceptDefinition(profile.id,imperialQuestDefinition);
  await progress.selectQuest(profile.id,quest.id,initialQuestProgress(imperialQuestDefinition));
  const body='议会正式转向支持塞西莉亚。';
  const response=():ImperialResult=>({state:initialImperialState(),summary:'议会改变了立场。',majorProgress:[],succession:{completed:false,winner:'',winnerIsPlayer:false,confidence:0,evidence:''}});
  const judge={evaluateImperial:vi.fn(async()=>response())};
  const input={profileId:profile.id,quest,progress,judge,
    floor:{index:1,id:'1:body',fingerprint:'body',lineageHash:'lineage-1',role:'assistant' as const,text:body},
    prompt:{playerName:'测试玩家',currentLocation:'炉心城',worldbook:'原世界书内容',recentMessages:[{role:'user' as const,content:'我选择亲自争夺皇位。'},{role:'assistant' as const,content:body}]},
    isCurrent:async()=>true,
  };
  return {db,repository,events,profile,quest,progress,input,judge,response};
}

describe('动荡的皇权',()=>{
  it('升级旧版注释记录时保留支持值与自己争位阵营，只在读取时补齐标签',()=>{
    const old='正文\n\n<!-- CAELIAN_IMPERIAL_STATE:v1 | User当前势力：议会 45/100；圣教会 未知/100；骑士团 12/100；赛梅斯商会 30/100 | User阵营：自己 | -->';
    const record=readImperialRecord(old)!;
    expect(record).toMatch(/^<caelian-imperial-state>/);expect(stripImperialContext(old)).toBe('正文');
    const authority=imperialRecordAuthority(record);
    expect(authority).toMatchObject({playerCamp:'自己',playerClaimingThrone:true,support:{议会:{value:45},圣教会:{value:null},骑士团:{value:12}}});
  });
  it('以正文标签而非数据库缓存为唯一继承基准，完整保留长记录和继承可能性',()=>{
    const previous=initialImperialState(),cached=initialImperialState();
    previous.playerCamp='玩家编辑后的阵营';previous.royals.卢修斯.plan.text='完整长记录'.repeat(3000);
    previous.successionLikelihood=[{name:'瓦勒里乌斯',value:60,reason:{text:'第一顺位',known:true,evidence:'册立为储君'}},{name:'塞西莉亚',value:30,reason:{text:'政治联盟',known:false,evidence:'幕后部署'}},{name:'卢修斯',value:10,reason:{text:'资源较少',known:false,evidence:'既有设定'}}];
    cached.playerCamp='过期缓存阵营';const record=imperialHistoryContext(previous);
    const messages=buildImperialJudgeMessages({state:cached,previousRecord:{index:3,content:record},playerName:'测试玩家',currentLocation:'旅店',worldbook:'原世界书',recentMessages:[]});
    expect(messages[1]!.content).toContain(record);expect(messages[1]!.content).not.toContain('过期缓存阵营');
    expect(record).toContain('瓦勒里乌斯：60%');expect(record).toContain('当前皇位继承可能性');
    const invalid={state:{...initialImperialState(),successionLikelihood:[{name:'卢修斯',value:150,reason:{text:'',known:false,evidence:''}}]},summary:'',majorProgress:[],succession:{completed:false,winner:'',winnerIsPlayer:false,confidence:0,evidence:''}};
    expect(imperialResultSchema.safeParse(invalid).success).toBe(false);
  });

  it('完成楼层删除后恢复皇权任务，再次完成不重复发放奖励',async()=>{
    const h=await setup(),result=h.response(),body='塞西莉亚正式登基。';
    result.succession={completed:true,winner:'塞西莉亚',winnerIsPlayer:false,confidence:1,evidence:body};
    h.input.floor.text=body;h.input.prompt.recentMessages[1]!.content=body;h.judge.evaluateImperial.mockResolvedValue(result);
    await evaluateImperialTurn(h.input);await h.repository.completeQuestDefinition(h.profile.id,imperialQuestDefinition);
    const count=(await h.db.guildStates.get(h.profile.id))!.completedTaskCount;
    await h.progress.rollbackFromFloor(h.profile.id,1);
    expect((await h.db.questRecords.get(h.quest.id))?.status).toBe('active');
    expect(await h.db.questHistory.get(h.quest.id)).toBeUndefined();
    expect((await h.progress.selectedTracker(h.profile.id))?.questId).toBe(h.quest.id);
    await evaluateImperialTurn(h.input);await h.repository.completeQuestDefinition(h.profile.id,imperialQuestDefinition);
    expect((await h.db.guildStates.get(h.profile.id))!.completedTaskCount).toBe(count);
  });
  it('六级任意地区可接取，未达等级不可接取，目录没有剧情节点',async()=>{
    const catalog=await new QuestCatalogLoader(window).load();
    for(const region of ['圣德里安学院','炉心城','未知地区']){
      expect(catalog.available({region,level:5}).some(q=>q.id===IMPERIAL_QUEST_ID)).toBe(false);
      expect(catalog.available({region,level:6}).some(q=>q.id===IMPERIAL_QUEST_ID)).toBe(true);
    }
    expect(imperialQuestDefinition.nodes).toEqual([]);
    expect(()=>manualQuestProgress(imperialQuestDefinition,initialQuestProgress(imperialQuestDefinition))).toThrow('没有可手动完成');
    const h=await setup();
    expect(h.quest.totalStages).toBe(0);
    await expect(h.progress.acceptDefinition(h.profile.id,imperialQuestDefinition)).rejects.toThrow('已经');
  });

  it('取消追踪仍维护已接取的局势，不恢复悬浮窗追踪状态；重复楼层不再次调用',async()=>{
    const h=await setup();await h.progress.setSelectedTrackerState(h.profile.id,'manualPaused');
    const value=h.response();value.state.currentEvent={text:'议会转向',known:true,evidence:'议会正式转向支持塞西莉亚。'};
    value.state.playerClaimingThrone=true;value.state.playerCamp='随意值';value.state.campEvidence='我选择亲自争夺皇位。';
    h.judge.evaluateImperial.mockResolvedValue(value);
    const result=await evaluateImperialTurn(h.input);
    expect(result?.state.playerCamp).toBe('自己');
    expect((await h.progress.getTracker(h.profile.id,h.quest.id))?.current.trackerState).toBe('manualPaused');
    expect(await evaluateImperialTurn(h.input)).toBeNull();expect(h.judge.evaluateImperial).toHaveBeenCalledTimes(1);
    const reloaded=new QuestProgressRepository(h.db);
    expect((await reloaded.getTracker(h.profile.id,h.quest.id))?.current.imperial?.currentEvent.text).toBe('议会转向');
  });

  it('拒绝无证据的支持值和玩家知情标记，仅播报本轮可知且未重复的重大进展',async()=>{
    const h=await setup(),value=h.response();
    value.state.support.议会={value:99,evidence:'没有发生的结盟'};
    value.state.royals.卢修斯.plan={text:'秘密计划',known:true,evidence:'无法引用的秘密'};
    const notice={faction:'议会',title:'议会转向',detail:'正式支持塞西莉亚',known:true,evidence:'议会正式转向支持塞西莉亚。'};
    value.majorProgress=[notice,notice,{...notice,known:false,title:'秘密进展'},{...notice,evidence:'虚构事件'}];
    h.judge.evaluateImperial.mockResolvedValue(value);
    const result=await evaluateImperialTurn(h.input);
    expect(result?.state.support.议会.value).toBeNull();expect(result?.state.royals.卢修斯.plan.known).toBe(false);
    expect(result?.notices).toHaveLength(1);
  });

  it.each(['NPC','player'])('正式继位自动达到完成条件，%s 获得正确成就且不重复奖励',async(who)=>{
    const h=await setup(),value=h.response(),winner=who==='player'?'测试玩家':'塞西莉亚';
    const body=`${winner}正式登基，继承了皇位。`;
    value.succession={completed:true,winner,winnerIsPlayer:who==='player',confidence:0.99,evidence:body};
    h.judge.evaluateImperial.mockResolvedValue(value);
    h.input.floor.text=body;h.input.prompt.recentMessages[1]!.content=body;
    const result=await evaluateImperialTurn(h.input);expect(result?.completed).toBe(true);
    await h.repository.completeQuestDefinition(h.profile.id,imperialQuestDefinition);
    const achievements=await h.db.achievementProgress.toArray();
    expect(achievements.some(a=>a.achievementId==='ach_imperial_night_and_dawn'&&a.unlocked)).toBe(true);
    expect(achievements.some(a=>a.achievementId==='ach_imperial_long_stair'&&a.unlocked)).toBe(who==='player');
    expect((await h.db.questHistory.get(h.quest.id))?.imperial?.winner).toBe(winner);
    const before=await h.db.guildStates.get(h.profile.id);
    await expect(h.repository.completeQuestDefinition(h.profile.id,imperialQuestDefinition)).rejects.toThrow('不存在');
    expect((await h.db.guildStates.get(h.profile.id))?.completedTaskCount).toBe(before?.completedTaskCount);
  });

  it.each(['她计划登基，继承皇位。','他即将继位。','如果玩家登基就会获胜。','传闻塞西莉亚已登基。','册立瓦勒里乌斯为皇太子。','莱奥尼达斯仍是帝国皇帝。'])('不把候选、计划、传闻和原皇帝身份当作完成：%s',async body=>{
    const h=await setup(),value=h.response();value.succession={completed:true,winner:'塞西莉亚',winnerIsPlayer:false,confidence:1,evidence:body};
    expect(hasSuccessionEvidence(value,body)).toBe(false);
  });

  it('低置信度、缺失证据、伪造玩家胜利不会越过最终判定',async()=>{
    const h=await setup(),value=h.response();const body='塞西莉亚正式登基。';
    value.succession={completed:true,winner:'塞西莉亚',winnerIsPlayer:true,confidence:.6,evidence:body};
    expect(hasSuccessionEvidence(value,body)).toBe(false);
    value.succession.confidence=1;expect(hasSuccessionEvidence(value,'没有这个事件')).toBe(false);
    h.input.floor.text=body;h.judge.evaluateImperial.mockResolvedValue(value);
    await evaluateImperialTurn(h.input);expect((await h.progress.getTracker(h.profile.id,h.quest.id))?.current.ending).toBe('other');
  });

  it('切换聊天或放弃后返回的副 API 结果不得写入',async()=>{
    const h=await setup();h.input.isCurrent=async()=>false;
    expect(await evaluateImperialTurn(h.input)).toBeNull();expect(await h.db.questFloorCheckpoints.count()).toBe(0);
    h.input.isCurrent=async()=>true;
    h.judge.evaluateImperial.mockImplementation(async()=>{await h.db.questRecords.delete(h.quest.id);await h.progress.clearQuest(h.profile.id,h.quest.id);return h.response();});
    expect(await evaluateImperialTurn(h.input)).toBeNull();expect(await h.db.questFloorCheckpoints.count()).toBe(0);
  });

  it('副 API 提示词替换剧情判定规则，并保留世界书和最近对话资料',()=>{
    const messages=buildImperialJudgeMessages({state:initialImperialState(),playerName:'测试玩家',currentLocation:'炉心城',worldbook:'未改动的世界书内容',recentMessages:[{role:'user',content:'玩家原文'},{role:'assistant',content:'正文原文'}]});
    expect(messages[0]!.content).toContain('不输出剧情节拍判定');expect(messages[0]!.content).toContain('唯一完成标准');
    expect(messages[1]!.content).toContain('未改动的世界书内容');expect(messages[1]!.content).toContain('正文原文');
    expect(messages[1]!.content).not.toContain('完整路线图');
    expect(()=>imperialResultSchema.parse({state:{}})).toThrow();
  });

  it('隐藏注释包含全部状态分区，转义注释终止符并保持原正文不变',()=>{
    const state=initialImperialState();state.royals.卢修斯.plan.text='秘密--><img src=x> | 内容';
    const body='正文\n包含原来的格式';const text=body+imperialHistoryContext(state);
    const target=document.createElement('div');target.innerHTML=text;
    expect(target.textContent).toBe(body+'\n\n');expect(target.querySelector('img')).toBeNull();
    expect(text).toContain('|\nUser当前势力');expect(text).toContain('莱奥尼达斯');expect(text).toContain('内部成员分歧');
    expect(stripImperialContext(text)).toBe(body);
    expect((stripImperialContext(text)+imperialHistoryContext(state)).match(/<caelian-imperial-state>/g)).toHaveLength(1);
  });

  it('独立浮窗按追踪显示、展开内容、休眠半透明，幕后计划明确标注角色不知情',async()=>{
    vi.useFakeTimers();overlay=mountImperialOverlay(window);const state=initialImperialState();state.royals.卢修斯.plan.text='不可见秘密';
    overlay.update('alpha:test',true,state);await nextTick();
    const launcher=document.querySelector<HTMLButtonElement>('.imperial-launcher')!;expect(launcher).not.toBeNull();
    launcher.click();await nextTick();expect(document.querySelector('.imperial-panel')).not.toBeNull();
    [...document.querySelectorAll<HTMLButtonElement>('.imperial-tabs button')].find(button=>button.textContent==='皇室')!.click();await nextTick();
    expect(document.querySelector('.imperial-panel')!.textContent).toContain('不可见秘密（User不知情）');
    document.querySelector<HTMLButtonElement>('[aria-label="收起皇权状态栏"]')!.click();await nextTick();
    vi.advanceTimersByTime(5100);await nextTick();expect(launcher.classList.contains('sleeping')).toBe(true);
    overlay.update('alpha:test',false,state);await nextTick();expect(document.querySelector('.imperial-launcher')).toBeNull();
    overlay.announce([{faction:'议会',title:'重大进展',detail:'转向已经发生',known:true,evidence:'转向已经发生'}]);await nextTick();expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    overlay.clear();await nextTick();expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('皇权浮窗能自由拖动、避免拖动误展开，并按档案记忆位置',async()=>{
    overlay=mountImperialOverlay(window);overlay.update('alpha:drag-test',true,initialImperialState());await nextTick();
    const launcher=document.querySelector<HTMLButtonElement>('.imperial-launcher')!;
    const pointer=(type:string,x:number,y:number)=>{
      const event=new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});
      Object.defineProperty(event,'pointerId',{value:1});launcher.dispatchEvent(event);
    };
    pointer('pointerdown',30,180);pointer('pointermove',150,250);pointer('pointerup',150,250);await nextTick();
    expect(launcher.style.left).toBe('136px');expect(launcher.style.top).toBe('230px');
    launcher.click();await nextTick();expect(document.querySelector('.imperial-panel')).toBeNull();
    overlay.destroy();overlay=mountImperialOverlay(window);overlay.update('alpha:drag-test',true,initialImperialState());await nextTick();
    expect(document.querySelector<HTMLButtonElement>('.imperial-launcher')!.style.left).toBe('136px');
    overlay.update('alpha:another-profile',true,initialImperialState());await nextTick();
    expect(document.querySelector<HTMLButtonElement>('.imperial-launcher')!.style.left).toBe('16px');
  });

  it('地图节点属于索拉维亚且能正确归一化地点',async()=>{
    const places=await loadRegionPlaces();for(const name of ['金鸢赌场','赛梅斯商会总部']){
      expect(places.solavia?.some(p=>p.name===name)).toBe(true);expect(normalizeRegion(name)).toBe('索拉维亚');
      expect(places.academy?.some(p=>p.name===name)).toBe(false);
    }
  });
});
