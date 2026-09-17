import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createKernel } from '@/kernel/create-kernel';
import { CaelianDatabase } from '@/storage/database';
import { nativeCardDescription, reworkCard } from '@/battle/rework/catalog';
import { renderCardDescription } from '@/card-description';
import { workshopObjectCatalog } from '@/workshop-object-catalog';
let kernel:ReturnType<typeof createKernel>|undefined;
let db:CaelianDatabase|undefined;
const originalFetch=window.fetch;
afterEach(async()=>{await kernel?.shutdown();kernel=undefined;if(db){db.close();await db.delete();db=undefined;}window.fetch=originalFetch;delete window.SillyTavern;localStorage.clear();});
it('username 覆盖旧冒险名称及创建输入，改名同步活跃战斗且不改成长数据',async()=>{
 const context={chatId:'username-test',characterId:0,characters:[{name:'凯利安alpha',avatar:'caelian-alpha.png'}],name1:'当前用户',name2:'凯利安alpha',chat:[]};
 window.SillyTavern={getContext:()=>context};window.fetch=vi.fn(async()=>new Response(null,{status:404}));
 const name='username-'+crypto.randomUUID();kernel=createKernel({channel:'alpha',version:'test',buildId:'username',databaseName:name,sourceWindow:window});db=new CaelianDatabase('alpha',name);
 await kernel.initialize();const api=kernel.api,profile=api.getRuntimeInfo().profileId!;
 const result=await api.execute({id:'create',type:'player.create',payload:{name:'旧名字',classMain:'knight',subclass:'holy_knight'}});expect(result.status).toBe('applied');
 expect((await api.query('state')).player.name).toBe('当前用户');
 await api.openPanel('character');await expect.poll(()=>document.querySelector('[data-caelian-panel=character]')?.textContent).toContain('当前用户');
 await api.closePanel('character');context.name1='重开面板新名';await api.openPanel('character');await expect.poll(()=>document.querySelector('[data-caelian-panel=character]')?.textContent).toContain('重开面板新名');await api.closePanel('character');
 await db.playerStates.update(profile,{level:20,gold:12345});
 expect((await api.execute({id:'battle',type:'battle.start',payload:{monsterId:'mon_slime',count:1}})).status).toBe('applied');
 const inventory=await db.inventoryStacks.toArray();context.name1='新用户';
 const state=await api.query('state');expect(state.player).toMatchObject({name:'新用户',level:20,gold:12345});expect(state.battle?.state.player.name).toBe('新用户');expect(await db.inventoryStacks.toArray()).toEqual(inventory);
});
it('交付卡真实特莱奥脚本注册三个角色别名，重复运行仍只有一个扩展',()=>{
 const card=JSON.parse(fs.readFileSync('public/managed-content/cards/caelian-alpha-mvu-v3.json','utf8'));
 const script=card.data.extensions.tavern_helper.scripts.find((s:{id:string})=>s.id==='a6c1f90d-1d78-4afb-8703-0cfd5cc380a9');
 const host:Record<string,any>={};host.parent=host;const sandbox={window:host,console:{info:vi.fn(),error:vi.fn()}};
 vm.runInNewContext(script.content,sandbox);vm.runInNewContext(script.content,sandbox);
 const bus=host.__PIXEL_TAMAGOTCHI_PET_EXTENSION_BUS_V1__;expect(bus.definitions).toHaveLength(1);expect(bus.pending).toHaveLength(1);expect(bus.definitions[0].match.characterNames).toEqual(['凯利安','凯利安alpha','凯利安beta']);
 const manifest=JSON.parse(fs.readFileSync('public/managed-content/alpha.json','utf8'));expect(manifest.operations).toEqual([]);expect(manifest.revision).toBe('2026-09-11.imperial-guidance.2');
});
it('官方生命比例治疗保留实时值，官方卡引用显示中文',()=>{
 expect(nativeCardDescription(reworkCard('hk_holy_heal')!,2,{attack:100,defense:50,hpMax:1000,targetHpMax:50})).toContain('回复128.5');
 expect(renderCardDescription({description:'获得{{牌名}}',descriptionBindings:[{label:'牌名',kind:'name',objectKind:'cards',objectId:'hk_consecration'}]},workshopObjectCatalog({},[]))).toBe('获得祝圣领域');
});
