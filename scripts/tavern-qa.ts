// Explicit, disposable test fixture. Load only inside the independent test Tavern.
// Uses the running release API and real Tavern Helper / IndexedDB persistence.
import { CaelianDatabase } from '@/storage/database';
import { saveWorkshopPack } from '@/workshop';
import { DEFAULT_STAR_SCALING } from '@/workshop-stars';
import { loadCardCatalog } from '@/content/catalogs/cards';
import { previewBattleCard } from '@/battle/card-preview';
import { battleCardText } from '@/battle/presentation';
import * as rework from '@/battle/rework/runtime/api.mjs';
import { applyWorldbookDelta } from '@/content-updates/worldbook-delta';
import { TavernAdapter } from '@/tavern/adapter';
import { saveWorkshopMechanism, deleteWorkshopMechanism } from '@/workshop-mechanisms';

const root = window.parent as any;
const api = root.Caelian;
root.document.querySelector('#caelian-real-qa')?.remove();
const helper = root.TavernHelper ?? (window as any).TavernHelper ?? window;
const db = new CaelianDatabase('alpha');
const adapter = new TavernAdapter(window);
const box = root.document.createElement('details');
box.id='caelian-real-qa';box.open=true;
box.style.cssText='position:fixed;z-index:2147483646;left:12px;top:12px;width:440px;max-height:70vh;overflow:auto;padding:12px;background:#111a2a;color:white;font:14px sans-serif;border:2px solid #77c9ff;border-radius:8px';
box.innerHTML='<summary>Alpha 实机回归 · 合成数据 / 模拟副 API</summary><div></div><pre style="white-space:pre-wrap"></pre>';
root.document.body.append(box);
const output=box.querySelector('pre')!;
const report: unknown[]=[];
const log=(item:unknown)=>{report.push(item);output.textContent=JSON.stringify(report,null,2);};
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
let seq=0;
async function run(type:string,payload:unknown) {
  const result=await api.execute({id:`real-qa:${Date.now()}:${seq++}`,type,payload});
  assert(result.status==='applied',JSON.stringify(result));return result;
}
function pack(hits=1) {
  const cards=Array.from({length:9},(_,i)=>({id:`real_qa_card_${i}`,name:i===0?'单段公式验证':'回归测试卡'+i,type:'skill',cost:0,starScaling:DEFAULT_STAR_SCALING,
    effects:i===0?[{type:'damage',value:100,hits,scaling:{stat:'attack',percent:100},target:'enemy'}]:[{type:'shield',value:1,target:'self'}]}));
  return {format:'caelian_workshop_class_pack',version:1,classes:[{id:'custom_class_real_qa',main:'freelance',name:'实机回归职业',
    talent:{name:'无额外伤害',effects:[]},cards,cardPool:[...cards,...cards].map(c=>c.id),starterDeck:Array.from({length:15},(_,i)=>cards[i%9]!.id)}]};
}
async function initialize() {
  assert(api?.version==='0.2.0-alpha.80'||api?.version==='0.2.0-alpha.81','没有加载支持的 Alpha 测试版本');
  saveWorkshopPack(pack());
  const state=await api.query('state');
  if(!state.player.created) await run('player.create',{name:'实机回归员',classMain:'freelance',subclass:'custom_class_real_qa'});
  log({startup:api.getRuntimeInfo(),helperWorldbook:typeof helper.getWorldbook,helperChat:typeof helper.createChatMessages});
}
async function prepareDamage(crit=0,hits=1,shield=0) {
  saveWorkshopPack(pack(hits));
  const snapshot=await api.query('state');
  // Fixture cleanup is confined to this synthetic profile's battles.
  await db.battleSessions.where('profileId').equals(snapshot.profile.id).modify({active:false});
  await run('battle.start',{monsterId:'mon_slime'});
  const session=(await db.battleSessions.where('profileId').equals(snapshot.profile.id).filter(x=>x.active).first())!;
  const g=rework.hydrate(session.state.rework);
  Object.assign(g.player.stats,{attack:300,speed:10000,crit,critDamage:50});g.player.buffs=[];g.player.debuffs=[];g.player.ap=10;
  Object.assign(g.enemies[0].stats,{defense:3*(100+5*g.player.level),speed:1});
  g.enemies[0].hp=g.enemies[0].maxHp=10000;g.enemies[0].shield=shield;g.enemies[0].buffs=[];g.enemies[0].debuffs=[];
  g.player.hand=[{id:'real_qa_card_0',uid:'real-qa-single',legacy:true,ap:0,star:1,effects:[]}];
  rework.project(g,session.state);session.state.log=[];session.state.animations=[];await db.battleSessions.put(session);
  return {session,g};
}
async function damage() {
  for(const [crit,hits,shield] of [[0,1,0],[100,1,0],[0,1,60],[100,1,60],[0,2,60]]) {
    const {session,g}=await prepareDamage(crit,hits,shield);
    const card=(await loadCardCatalog()).real_qa_card_0!;
    const before=JSON.stringify(session.state);const preview=previewBattleCard(session.state,card,0);
    assert(JSON.stringify(session.state)===before,'预览改变了战斗');
    await run('battle.play-card',{battleId:session.id,handIndex:0,targetIndex:0});
    const result=(await db.battleSessions.get(session.id))!.state;
    const events=result.animations!.filter(e=>e.kind==='damage'&&e.targetId===g.enemies[0].id);
    const hpLost=10000-result.enemies[0]!.hp;
    assert(events.length===hits,'伤害次数错误');assert(hpLost===(crit?150:100)*hits!-shield!,'实际扣血错误');
    assert(preview.enemyDamage[0]===100*hits!-shield!,'预览错误');
    log({case:'伤害',crit,hits,shield,preview:preview.enemyDamage[0],hpLost,events:events.map(e=>({amount:e.amount,critical:e.critical,label:e.label})),pass:true});
  }
  await prepareDamage(0,1,60); await api.openPanel('battle');box.open=false;
}
// Optional local fixture: never include a player's uploaded pack in public builds.
async function uploadedShieldDamage() {
  const response=await fetch(root.location.origin+'/caelian-qa/uploaded-pack.json');
  assert(response.ok,'请先在独立测试酒馆放置 uploaded-pack.json');
  const saved=saveWorkshopPack(await response.json());
  const profession=saved.classes[0]!;
  const cards=profession.cards.filter(card=>card.effects.some(e=>e.type==='damage_from_shield'));
  assert(cards.length>0,'该上传卡组没有直接护盾伤害卡');
  const snapshot=await api.query('state');
  async function prepare(cardId:string) {
    await db.battleSessions.where('profileId').equals(snapshot.profile.id).modify({active:false});
    await run('battle.start',{workshopTest:{professionId:profession.id,attributes:{hpMax:0,attack:0,defense:0,speed:0,actionPointsPerTurn:0},dummyCount:1,dummyHp:10000,dummyAttack:0,dummyDefense:0,dummyInvincible:false,dummyAttackEnabled:false,autoRespawn:false,playerInvincible:false}});
    const session=(await db.battleSessions.where('profileId').equals(snapshot.profile.id).filter(x=>x.active).first())!;
    const g=rework.hydrate(session.state.rework);
    g.player.hp=g.player.maxHp=1000;g.player.shield=400;g.player.ap=10;g.player.buffs=[];g.player.debuffs=[];
    Object.assign(g.player.stats,{attack:100,speed:10000,crit:50,critDamage:50});g.critRng.setState(1);
    Object.assign(g.enemies[0].stats,{defense:3*(100+5*g.player.level),speed:1});
    g.enemies[0].hp=g.enemies[0].maxHp=10000;g.enemies[0].shield=0;g.enemies[0].buffs=[];g.enemies[0].debuffs=[];
    g.player.hand=[{id:cardId,uid:'uploaded-shield-probe',legacy:true,ap:1,star:1,effects:[]}];
    rework.project(g,session.state);session.state.log=[];session.state.animations=[];await db.battleSessions.put(session);
    return {session,g};
  }
  for(const original of cards) {
    const {session,g}=await prepare(original.id);
    const card=(await loadCardCatalog())[original.id]!;
    const preview=previewBattleCard(session.state,card,0);
    const text=battleCardText(card,1,session.state,{attack:100,defense:20,hpMax:1000,targetHpMax:10000});
    await run('battle.play-card',{battleId:session.id,handIndex:0,targetIndex:0});
    const result=(await db.battleSessions.get(session.id))!.state;
    const events=result.animations!.filter(e=>e.kind==='damage'&&e.targetId===g.enemies[0].id);
    assert(events.length===original.effects.filter(e=>['damage','damage_from_shield'].includes(e.type)).length,'伤害效果与实际命中次数不符');
    assert(text.includes('造成200总伤害'),'卡面未按护盾比例显示伤害');
    assert(events.at(-1)?.label?.includes('按护盾造成伤害'),'护盾伤害缺少来源');
    log({case:'上传卡组护盾伤害',name:card.name,text,preview:preview.enemyDamage[0],hpLost:10000-result.enemies[0]!.hp,events:events.map(e=>({amount:e.amount,critical:e.critical,label:e.label})),pass:true});
  }
  await prepare(cards[0]!.id);await api.openPanel('battle');box.open=false;
}
async function inspectUploadedWorkshop() {
  const snapshot=await api.query('state');
  await db.battleSessions.where('profileId').equals(snapshot.profile.id).modify({active:false});
  await api.openPanel('deck');box.open=false;
}
async function deletion() {
  const p=pack();const removed=p.classes[0]!.cards.pop()!.id;
  p.classes[0]!.cardPool=p.classes[0]!.cardPool.filter(id=>id!==removed);p.classes[0]!.cardPool.push('real_qa_card_0');
  p.classes[0]!.starterDeck=p.classes[0]!.starterDeck.map(id=>id===removed?'real_qa_card_0':id);
  saveWorkshopPack(p);
  const state=await api.query('state');await db.battleSessions.where('profileId').equals(state.profile.id).modify({active:false});
  await run('battle.start',{});const result=await api.query('state');
  assert(!result.decks.some((d:any)=>d.cardIds.includes(removed)),'牌组仍含已删卡');
  assert(!result.cards.some((c:any)=>c.cardId===removed),'快照仍含已删卡');
  log({case:'当前职业删除技能后直接开战',removed,pass:true});
}
async function mechanisms() {
  const m=saveWorkshopMechanism({format:'caelian_workshop_mechanism',version:1,id:'test.real-qa',name:'待删除测试机制',resources:[{id:'charge',label:'测试充能',min:0,max:10,initial:0,visible:true}],statuses:[],rules:[]});
  const p:any=pack();p.classes[0].mechanismIds=[m.id];saveWorkshopPack(p);
  deleteWorkshopMechanism(m.id);p.classes[0].description='删除后继续保存';
  const saved=saveWorkshopPack(p);assert(!saved.classes[0]!.mechanismIds.includes(m.id),'未使用的已删状态仍阻止保存');
  log({case:'删除已勾选未使用机制后保存职业',pass:true});
}
async function attributes() {
  const p:any=pack();const effects=[
    [{type:'apply_buff',nativeStatus:true,buff:'strength',value:5,scaling:{stat:'hpMax',percent:10},turns:2,target:'self'}],
    [{type:'apply_buff',nativeStatus:true,buff:'fortitude',value:0,scaling:{stat:'attack',percent:50},turns:2,target:'self'}],
    [{type:'apply_buff',nativeStatus:true,buff:'speed_flat',value:0,scaling:{stat:'defense',percent:100},turns:2,target:'self'}],
    [{type:'apply_buff',nativeStatus:true,buff:'crit_up',value:100,turns:1,target:'self'},{type:'apply_buff',nativeStatus:true,buff:'crit_damage_up',value:100,turns:1,target:'self'}],
    [{type:'conditional_group',operator:'and',conditions:[{type:'self_has_specific_buff',buff:'crit_up'}],then_effects:[{type:'shield',value:19,target:'self'}],else_effects:[{type:'shield',value:1,target:'self'}]}],
    [{type:'apply_debuff',nativeStatus:true,debuff:'armor_break',value:.2,turns:2,target:'enemy',baseChance:100},{type:'conditional_group',operator:'and',conditions:[{type:'enemy_has_specific_debuff',debuff:'armor_break'}],then_effects:[{type:'shield',value:13,target:'self'}],else_effects:[{type:'shield',value:1,target:'self'}]}],
  ];effects.forEach((effects,i)=>p.classes[0].cards[i].effects=effects);saveWorkshopPack(p);
  const state=await api.query('state');await db.battleSessions.where('profileId').equals(state.profile.id).modify({active:false});
  await run('battle.start',{workshopTest:{professionId:'custom_class_real_qa',attributes:{hpMax:0,attack:0,defense:0,speed:0,actionPointsPerTurn:0},dummyCount:1,dummyHp:10000,dummyAttack:0,dummyDefense:0,dummyInvincible:false,dummyAttackEnabled:false,autoRespawn:false,playerInvincible:false}});
  const session=(await db.battleSessions.where('profileId').equals(state.profile.id).filter(x=>x.active).first())!;
  let g=rework.hydrate(session.state.rework);g.player.hp=g.player.maxHp=1000;g.player.shield=0;
  Object.assign(g.player.stats,{attack:100,defense:20,speed:100,crit:0,critDamage:50,ehr:80});g.enemies[0].stats.res=0;g.player.ap=g.player.apMax=10;
  g.player.hand=effects.map((_,i)=>({id:`real_qa_card_${i}`,uid:`real-qa-attribute:${i}`,legacy:true,ap:0,star:1,effects:[]}));g.player.deck=[];g.player.discard=[];
  rework.project(g,session.state);await db.battleSessions.put(session);
  const values=[];for(let i=0;i<6;i++){await run('battle.play-card',{battleId:session.id,handIndex:0,targetIndex:0});g=rework.hydrate((await db.battleSessions.get(session.id))!.state.rework);values.push([g.stat(g.player,'attack'),g.stat(g.player,'defense'),g.stat(g.player,'speed'),g.stat(g.player,'crit'),g.stat(g.player,'critDamage'),g.player.shield]);}
  assert(values[0]![0]===205&&values[1]![1]===123&&values[2]![2]===223&&values[3]![3]===100&&values[3]![4]===150&&values[4]![5]===19&&values[5]![5]===32,'属性转换或 IF 条件错误');
  await run('battle.end-turn',{battleId:session.id});g=rework.hydrate((await db.battleSessions.get(session.id))!.state.rework);
  assert(g.stat(g.player,'crit')===0&&g.stat(g.player,'critDamage')===50,'暴击增益没有到期');
  log({case:'属性公式、Buff/Debuff条件与暴击增益到期',values,expiredCrit:g.stat(g.player,'crit'),expiredCritDamage:g.stat(g.player,'critDamage'),pass:true});
}
async function worldbook() {
  const delta=await (await fetch(root.location.origin+'/caelian-candidate/managed-content/worldbook-deltas/imperial-2026-09-10.json')).json();
  const name='Caelian Alpha80 QA delta';
  await helper.createWorldbook(name);
  await helper.replaceWorldbook(name,delta.removals.map((x:any,i:number)=>({...x,uid:i})));
  const read=await helper.getWorldbook(name);
  const clean=applyWorldbookDelta(read,{...delta,additions:[],changes:[]});
  assert(clean.conflicts.length===0,'助手回读默认字段被误判：'+clean.conflicts.join(';'));
  assert(clean.entries.length===0,'两个旧条目未移除');
  const changed=structuredClone(read);changed[0].content+='\n玩家自己增加的内容';
  await helper.replaceWorldbook(name,changed);
  const conflict=applyWorldbookDelta(await helper.getWorldbook(name),{...delta,additions:[],changes:[]});
  assert(conflict.conflicts.length===1&&conflict.conflicts[0]!.includes(changed[0].name),'冲突未暴露条目名');
  await helper.replaceWorldbook(name,clean.entries);
  log({case:'真实助手保存/回读两个旧条目及玩家修改保护',names:read.map((x:any)=>x.name),conflicts:conflict.conflicts,pass:true});
}
async function updater() {
  const original=adapter.host.fetch;
  const manifest={schemaVersion:1,channel:'alpha',revision:'real-qa-update',target:{characterName:'凯利安',worldbookNames:['孔雀开屏你说看不见'],requirePrimaryBinding:true},operations:[{id:'real-qa-missing-entry',target:{kind:'worldbook-entry',entryName:'实机测试：不存在的更新条目'},mutation:{action:'replace-exact',before:'旧测试正文',after:'新测试正文'}}]};
  adapter.host.fetch=(async(url:any,init:any)=>String(url).includes('/managed-content/alpha.json')?new Response(JSON.stringify(manifest),{status:200}):original.call(adapter.host,url,init)) as typeof fetch;
  try {
    const result=await api.syncManagedContent({force:true});
    assert(result.conflicts.length===1&&result.conflicts[0].reason.includes('实机测试：不存在的更新条目'),JSON.stringify(result));
    log({case:'真实更新器失败条目与设置面板明细',result,pass:true});await api.openPanel('settings');box.open=false;
  } finally {adapter.host.fetch=original;}
}
async function quest() {
  const state=await api.query('state');await db.battleSessions.where('profileId').equals(state.profile.id).modify({active:false});
  await run('player.update',{level:6});
  if(!(await api.getTrackedQuest())) await api.acceptManagedQuest('side_flora_says');
  let calls=0;let lastPrompt='';const original=adapter.host.fetch;
  adapter.host.fetch=(async (url:any,init:any)=>{
    if(!String(url).includes('/caelian-qa-judge'))return original.call(adapter.host,url,init);
    calls++;lastPrompt=String(init?.body);
    const result={sceneState:'in_scene',progress:'stay',completionGateSatisfied:false,matchedTransitionId:null,suggestedNodeId:null,confidence:.8,evidence:['芙萝拉整理花束。'],summary:'芙萝拉整理花束。'};
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}),{status:200});
  }) as typeof fetch;
  try {
    api.configureQuestJudge({endpoint:root.location.origin+'/caelian-qa-judge',model:'synthetic-stay'});
    const ctx=await adapter.context();
    const event=(name:string)=>(ctx as any).eventSource.emit((ctx as any).eventTypes[name]);
    await event('GENERATION_STARTED');
    await helper.createChatMessages([{role:'user',message:'我和芙萝拉交谈。'},{role:'assistant',message:'芙萝拉整理花束。'}]);
    await event('GENERATION_ENDED');
    await waitUntil(()=>calls===1&&!api.getQuestJudgeStatus().evaluating);
    const tracked=await api.getTrackedQuest();const originalNode=tracked.tracker.current.currentNodeId;
    await api.completeTrackedQuestNode({questId:tracked.quest.id,expectedNodeId:originalNode,expectedRevision:tracked.tracker.manualRevision??0,transitionId:tracked.manualChoices[0].transitionId});
    const confirmed=(await api.getTrackedQuest()).tracker.current.currentNodeId;
    await event('GENERATION_STARTED');
    await helper.createChatMessages([{role:'user',message:'我继续交谈。'},{role:'assistant',message:'芙萝拉继续整理花束。'}]);
    await event('GENERATION_ENDED');
    await waitUntil(()=>calls===2&&!api.getQuestJudgeStatus().evaluating);
    assert((await api.getTrackedQuest()).tracker.current.currentNodeId===confirmed,'副 API 回退了手动节点');
    assert(lastPrompt.includes(confirmed),'副 API 没使用当前节点');
    log({case:'真实酒馆消息/生成事件 + 模拟副 API 不推进 → 手动推进 → 新正文',originalNode,confirmed,calls,pass:true});
    await api.openPanel('guild');
  } catch(error) {log({calls,status:api.getQuestJudgeStatus()});throw error;}
  finally {adapter.host.fetch=original;}
}
async function waitUntil(check:()=>boolean){for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,100));}throw new Error('等待副 API 完成超时');}
for(const [name,action] of [['安装测试职业（首次后刷新）',()=>{saveWorkshopPack(pack());log({installed:true,next:'刷新酒馆并打开测试聊天，再初始化测试。'});}],['初始化测试',initialize],['运行伤害回归',damage],['上传卡组护盾伤害',uploadedShieldDamage],['结束测试并查看工坊',inspectUploadedWorkshop],['删除技能回归',deletion],['删除状态回归',mechanisms],['属性与条件回归',attributes],['世界书回读回归',worldbook],['更新明细回归',updater],['手动剧情回归',quest],['查看设置',()=>api.openPanel('settings')],['查看工坊',()=>api.openPanel('deck')]] as const){
  const button=root.document.createElement('button');button.textContent=name;button.style.cssText='margin:5px;padding:7px;background:#203f60;color:white;border:1px solid #76cfff';
  button.addEventListener('click',async()=>{log({started:name});button.disabled=true;try{await action();}catch(error){log({case:name,pass:false,error:String(error),stack:(error as Error).stack});}finally{button.disabled=false;}});
  box.querySelector('div')!.append(button);
}
log({ready:true,version:api?.version,buildId:api?.buildId});
