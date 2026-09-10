import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createKernel } from '@/kernel/create-kernel';
import { CaelianDatabase } from '@/storage/database';
import { initialImperialState, type ImperialResult } from '@/imperial/model';
import { IMPERIAL_QUEST_ID, IMPERIAL_GUIDANCE_ENTRY } from '@/imperial/constants';
import { TavernAdapter } from '@/tavern/adapter';

const originalFetch=window.fetch;
let kernel: ReturnType<typeof createKernel> | undefined;
let db: CaelianDatabase | undefined;
afterEach(async()=>{
  await kernel?.shutdown();kernel=undefined;
  if(db){db.close();await db.delete();db=undefined;}
  window.fetch=originalFetch;delete window.SillyTavern;delete window.eventOn;delete window.tavern_events;
  delete (window as unknown as Record<string,unknown>).TavernHelper;
  localStorage.clear();
});

describe('皇权支线完整酒馆事件链',()=>{
  it('接取/取消追踪/继续追踪/放弃/完成精确控制世界书与浮窗，副 API 按正文更新并写回隐藏历史',async()=>{
    const handlers=new Map<string,(...args:unknown[])=>unknown>();
    window.eventOn=vi.fn((event,handler)=>{handlers.set(String(event),handler);return{stop:()=>handlers.delete(String(event))};});
    window.tavern_events={GENERATION_ENDED:'ended',CHAT_CHANGED:'changed',MESSAGE_DELETED:'deleted'};
    const bookName='孔雀开屏你说你看不见alpha';
    const chat:Array<{mes:string;is_user:boolean}>=[];
    const card={name:'凯利安',avatar:'real-card.png',data:{extensions:{world:bookName}}};
    const context={chatId:'imperial-live-harness',characterId:0,characters:[card],name1:'测试玩家',name2:'凯利安',chat,setExtensionPrompt:vi.fn()};
    window.SillyTavern={getContext:()=>context};
    let entries=[{uid:32,name:IMPERIAL_GUIDANCE_ENTRY,content:'原指导规则，玩家补充也保留',enabled:true},{uid:99,name:'玩家自己的条目',content:'完整保留',enabled:true}];
    const helper={
      getCharWorldbookNames:vi.fn(async()=>({primary:bookName,additional:[]})),
      getWorldbook:vi.fn(async()=>structuredClone(entries)),
      updateWorldbookWith:vi.fn(async(_name:string,updater:(data:typeof entries)=>typeof entries)=>{entries=updater(structuredClone(entries));return structuredClone(entries);}),
      setChatMessages:vi.fn(async(messages:Array<{message_id:number;message:string}>,options:{refresh:string})=>{
        expect(options.refresh).toBe('none');for(const message of messages)chat[message.message_id]!.mes=message.message;
      }),
    };
    (window as unknown as Record<string,unknown>).TavernHelper=helper;
    const apiMessages:Array<Array<{role:string;content:string}>>=[];
    let finish=false;
    window.fetch=vi.fn(async(url,init)=>{
      if(String(url)!=='https://judge.example/v1/chat/completions')return new Response(null,{status:404});
      const request=JSON.parse(String(init?.body));apiMessages.push(request.messages);
      const body=finish?'测试玩家正式登基，成为帝国新皇。':'议会向玩家递交了正式邀请。';
      const result:ImperialResult={state:initialImperialState(),summary:body,majorProgress:[],succession:{completed:finish,winner:finish?'测试玩家':'',winnerIsPlayer:finish,confidence:finish?1:0,evidence:finish?body:''}};
      result.state.currentEvent={text:body,known:true,evidence:body};
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}),{status:200,headers:{'Content-Type':'application/json'}});
    });
    const name=`imperial-kernel-${crypto.randomUUID()}`;
    kernel=createKernel({channel:'alpha',version:'0.2.0-alpha.test',buildId:'imperial-test',databaseName:name,sourceWindow:window});
    db=new CaelianDatabase('alpha',name);
    await kernel.initialize();const profileId=kernel.api.getRuntimeInfo().profileId!;
    await db.playerStates.update(profileId,{created:true,level:6});
    expect(entries[0]!.enabled).toBe(false);expect(document.querySelector('.imperial-launcher')).toBeNull();
    kernel.api.configureQuestJudge({endpoint:'https://judge.example/v1/chat/completions',model:'test',jsonMode:true});
    await kernel.api.acceptManagedQuest(IMPERIAL_QUEST_ID);await nextTick();
    expect(entries[0]!.enabled).toBe(true);expect(document.querySelector('.imperial-launcher')).not.toBeNull();
    chat.push({mes:'我去看看议会的态度。',is_user:true},{mes:'议会向玩家递交了正式邀请。',is_user:false});
    const adapter=new TavernAdapter(window),before=(await adapter.chatFloors())![1];
    handlers.get('ended')?.();
    await expect.poll(()=>chat[1]!.mes).toContain('<caelian-imperial-state>');
    expect((await adapter.chatFloors())![1]).toEqual(before);
    expect(apiMessages).toHaveLength(1);expect(apiMessages[0]![0]!.content).toContain('不输出剧情节拍判定');
    expect(apiMessages[0]![1]!.content).toContain('原指导规则，玩家补充也保留');
    const done=vi.fn();const dispose=kernel.api.on('tavern.changed',done);
    handlers.get('ended')?.();await expect.poll(()=>done.mock.calls.length).toBeGreaterThan(0);dispose();
    expect(apiMessages).toHaveLength(1);
    // Editing the hidden state is authoritative, and a routine UI refresh must not replace it with cached state.
    chat[1]!.mes=chat[1]!.mes.replace('User阵营：尚未表态','User阵营：手动修订阵营');
    await kernel.api.pauseTrackedQuest();await nextTick();
    expect(chat[1]!.mes).toContain('手动修订阵营');
    expect(entries[0]!.enabled).toBe(false);expect(document.querySelector('.imperial-launcher')).toBeNull();
    chat.push({mes:'我暂时去别处。',is_user:true},{mes:'议会向玩家递交了正式邀请。',is_user:false});handlers.get('ended')?.();
    await expect.poll(()=>chat[3]!.mes).toContain('<caelian-imperial-state>');
    expect(apiMessages).toHaveLength(2);expect(entries[0]!.enabled).toBe(false);
    expect(apiMessages[1]![1]!.content).toContain('手动修订阵营');
    const revisionBeforeDelete=(await db.questTrackerStates.toArray())[0]!.current.imperial!.revision;
    chat.splice(3,1);handlers.get('deleted')?.(3);
    await expect.poll(async()=>(await db!.questTrackerStates.toArray())[0]!.current.imperial!.revision).toBe(revisionBeforeDelete-1);
    chat.push({mes:'玩家收到议会第二次邀请，重新生成。',is_user:false});handlers.get('ended')?.();
    await expect.poll(()=>chat[3]!.mes).toContain('<caelian-imperial-state>');
    expect(apiMessages).toHaveLength(3);
    expect(apiMessages[2]![1]!.content).toContain('来源楼层：1');
    expect(apiMessages[2]![1]!.content).toContain('手动修订阵营');
    await kernel.api.resumeTrackedQuest();await nextTick();expect(entries[0]!.enabled).toBe(true);
    const active=(await kernel.api.query('state')).quests.find(q=>q.definitionId===IMPERIAL_QUEST_ID)!;
    expect((await kernel.api.execute({id:'abandon-imperial',type:'quest.abandon',payload:{questId:active.id}})).status).toBe('applied');await nextTick();
    expect(entries[0]!.enabled).toBe(false);expect(document.querySelector('.imperial-launcher')).toBeNull();
    expect(entries[1]).toEqual({uid:99,name:'玩家自己的条目',content:'完整保留',enabled:true});
    await kernel.api.acceptManagedQuest(IMPERIAL_QUEST_ID);finish=true;
    chat.push({mes:'我接受皇位。',is_user:true},{mes:'测试玩家正式登基，成为帝国新皇。',is_user:false});handlers.get('ended')?.();
    await expect.poll(async()=> (await db!.questHistory.toArray()).some(q=>q.definitionId===IMPERIAL_QUEST_ID)).toBe(true);
    await expect.poll(()=>entries[0]!.enabled).toBe(false);await nextTick();
    expect(document.querySelector('.imperial-launcher')).toBeNull();
    expect(chat[5]!.mes).toContain('测试玩家已正式继位');
    const earned=(await db.achievementProgress.toArray()).filter(a=>a.unlocked).map(a=>a.achievementId);
    expect(earned).toContain('ach_imperial_night_and_dawn');expect(earned).toContain('ach_imperial_long_stair');
  },20000);
});
