import { describe, expect, it } from 'vitest';
import * as api from '@/battle/rework/runtime/api.mjs';
import rawCatalog from '@/battle/rework/catalog.json';
const catalog=rawCatalog as any;
function fixture(){
 const state:any={status:'ongoing',phase:'player',turn:1,selectedTarget:0,log:[],animations:[],player:{name:'compat',subclass:'holy_knight',hp:1000,hpMax:1000,shield:0,attack:100,defense:50,speed:100,critRate:0,critDamage:50,effectHit:0,effectResist:0,ap:5,apMax:5,drawPerTurn:3,hand:[],drawPile:Array.from({length:10},(_,i)=>({instanceId:String(i),cardId:'kn_heavy_slash'})),discardPile:[],buffs:{},debuffs:{},summons:[{id:'legacy:turret',name:'工坊机关',duration:3,hp:1,hpMax:1,shield:0,attack:5,defense:0,speed:100,attackable:false,mechanical:true,buffs:{},debuffs:{},skills:[{name:'first-hit-then-self-buff',effects:[]}]}],chants:[],gold:0},enemies:[{id:'enemy',definitionId:catalog.monsters[0].id,name:'test',hp:100,hpMax:100,shield:0,attack:20,defense:0,speed:100,buffs:{},debuffs:{},gold:[1,1]}]};
 const core=api.create(state,{level:20,explicit:true,seed:1});api.project(core,state);return {state,core};
}
describe('live core 与旧工坊召唤兼容',()=>{
 it('live hook 投影保留同 ID 召唤 DTO 身份，后续自身状态不会写到孤立对象',()=>{
  const {state,core}=fixture(),activeSummon=state.player.summons[0];
  api.project(core,state,{checkpoint:false});
  expect(state.player.summons[0]).toBe(activeSummon);
  activeSummon.buffs['workshop_status:test:after-hit']={value:2,turns:3};
  api.syncExternal(core,state);api.project(core,state);
  expect(state.player.summons[0].buffs['workshop_status:test:after-hit']?.value).toBe(2);
 });
 it('不可攻击机关留在友方 buff 池，排除在敌方单体及群体攻击池',()=>{
  const {core}=fixture(),turret=core.allies.find((a:any)=>a.legacySummon);
  expect(core.friendTeam(core.player)).toContain(turret);
  expect(core.foeTeam(core.enemies[0])).not.toContain(turret);
  expect(core.targets(core.enemies[0],{kind:'damage',target:'all_enemies'},core.player)).not.toContain(turret);
 });
});
