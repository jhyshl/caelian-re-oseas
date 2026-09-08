import { describe, expect, it } from 'vitest';
import { actor, catalog, makeGame, makeTurnMetrics, seeded } from '@/battle/rework/runtime/physics.mjs';
import { encounter } from '@/battle/rework/runtime/model.mjs';
import { actEnemy, planEnemy, planEnemies, validateEnemyCatalog, notifyEnemyDamaged } from '@/battle/rework/runtime/enemies.mjs';
import { snapshot, hydrate } from '@/battle/rework/runtime/api.mjs';
function fixture(ids=['mon_slime','mon_stone_golem','mon_goblin']) {
 const p=actor('player','player',20,{hp:10000,attack:100,defense:100,speed:100,crit:0,critDamage:50,ehr:0,res:0});
 const enemies=encounter(ids.map(id=>structuredClone(catalog.monsters.find((m:any)=>m.id===id))),20,{});
 const g=makeGame(p,enemies,{seed:901,trace:true});g.round=1;g.phase='player';g.notifyEnemyDamaged=notifyEnemyDamaged;g.hitRng=()=>1;g.effectRng=()=>0;g.critRng=()=>1;return g;
}
function only(a:any,index:number){const skill=a.definition.skills.find((s:any)=>s.reset.index===index);a.definition.skills=[skill];return skill;}
function buff(g:any,a:any,name:string,value=1){g.addStatus(a,a,{type:'buff',status:name,value,valueUnit:name==='fortitude'?'flat':'ratio',turns:5});}
function next(g:any){g.endSide('enemy');g.round++;g.phase='player';for(const a of [g.player,...g.enemies]){a.lastTurn=a.thisTurn;a.thisTurn=makeTurnMetrics();}}
describe('97种怪物复合技能重置',()=>{
 it('毒藤的条件治疗须本招实际命中，不能从闪避目标汲取生命',()=>{
  const g=fixture(['mon_venom_vine']),a=g.enemies[0];a.hp=a.maxHp*.5;only(a,3);
  g.addDot(a,g.player,{type:'dot',status:'poison',atk:.1,baseChance:100},{skipEffectRoll:true});
  planEnemy(g,a);const hp=a.hp;g.hitRng=()=>0;actEnemy(g,a);expect(a.hp).toBe(hp);
 });
 it('388个动作都有显式执行器，每只两招特色技能，旧ID仅留迁移记录',()=>{
  expect(validateEnemyCatalog(catalog)).toMatchObject({monsters:97,skills:388,unsupported:[]});
  for(const m of catalog.monsters){expect(m.resetVersion).toBe(2);expect(m.skills).toHaveLength(4);expect(m.skills.slice(2).every((s:any)=>s.effects.length>=2)).toBe(true);expect(m.retiredSkills.length).toBeGreaterThan(0);expect(m.skills.some((s:any)=>s.id.includes('__skill_'))).toBe(false);}
 });
 it('逐项构造可达公开状态，388项均可被计划并完成执行',()=>{
  const missing:string[]=[];let count=0;
  for(const m of catalog.monsters)for(const skill of m.skills){
   let ran=false;
   for(const health of [.65,.25]){
    const g=fixture([m.id,'mon_goblin','mon_stone_golem']),a=g.enemies[0];a.definition.skills=[structuredClone(skill)];a.hp=a.maxHp*health;
    for(const friend of g.enemies.slice(1)){friend.hp=friend.maxHp*.3;g.addStatus(g.player,friend,{type:'debuff',status:'armor_break',value:.2,turns:3},{skipEffectRoll:true});}
    g.player.lastTurn.damageCards=5;
    if(planEnemy(g,a).skillId!==skill.id)continue;
    expect(()=>actEnemy(g,a),skill.id).not.toThrow();expect([a.hp,g.player.hp,a.shield].every(Number.isFinite),skill.id).toBe(true);ran=true;count++;break;
   }
   if(!ran)missing.push(skill.id);
  }
  expect(missing).toEqual([]);expect(count).toBe(388);
 });
 it('同一公开状态不受RNG和隐藏手牌影响',()=>{
  for(const m of catalog.monsters){const x=fixture([m.id]),y=fixture([m.id]);x.player.hand=[{id:'secret-one'}];y.player.hand=[{id:'secret-two'}];x.rng=()=>0;y.rng=()=>.99;expect(planEnemy(x,x.enemies[0])).toEqual(planEnemy(y,y.enemies[0]));}
 });
 it('守护一次获得嘲讽和20%基础防御坚韧，没有附赠攻击',()=>{
  const g=fixture(['mon_stone_golem','mon_goblin']),a=g.enemies[0];only(a,2);const hp=g.player.hp;g.enemies[1].hp*=.6;
  planEnemy(g,a);actEnemy(g,a);expect(g.hasStatus(a,'taunt')).toBe(true);expect(g.stat(a,'defense')).toBeCloseTo(a.stats.defense*1.2);expect(g.player.hp).toBe(hp);
  next(g);g.endSide('player');expect(g.hasStatus(a,'taunt')).toBe(false);expect(planEnemy(g,a).skillId).not.toContain('__reset_2');
 });
 it('拆除准备会削弱已锁定突袭并取消DOT，不临时换招',()=>{
  const pair=[fixture(['mon_dire_wolf']),fixture(['mon_dire_wolf'])];
  for(const g of pair){const a=g.enemies[0];only(a,3);buff(g,a,'swift');planEnemy(g,a);}
  pair[1].dispel(pair[1].enemies[0],1);const result=pair.map(g=>actEnemy(g,g.enemies[0]));
  expect(result[0].damage).toBeGreaterThan(result[1].damage);expect(pair[0].player.dots).toHaveLength(1);expect(pair[1].player.dots).toHaveLength(0);expect(pair[1].trace.some((e:any)=>e.type==='enemy_preparation_broken')).toBe(true);
 });
 it('先净化禁疗后治疗同一伤员，治疗总額受预算限制',()=>{
  const g=fixture(['mon_water_sprite','mon_goblin']),a=g.enemies[0],t=g.enemies[1];only(a,2);t.hp=t.maxHp*.25;
  g.addStatus(g.player,t,{type:'debuff',status:'healing_down',value:1,valueUnit:'ratio',turns:10},{skipEffectRoll:true});
  expect(planEnemy(g,a).effectTargets.filter((r:any)=>r.effect.target==='ally').every((r:any)=>r.targetIds[0]===t.id)).toBe(true);
  const hp=t.hp;actEnemy(g,a);expect(g.hasStatus(t,'healing_down')).toBe(false);expect(t.hp).toBeGreaterThan(hp);
  a.healingGiven=a.maxHp;t.hp=t.maxHp*.2;next(g);a.cooldowns={};a.flags.lastEnemyActionGroup='';expect(planEnemy(g,a).skillId).not.toContain('__reset_2');
 });
 it('锁定治疗对象死亡后只公开回退防御，不改治别人',()=>{
  const g=fixture(['mon_water_sprite','mon_goblin','mon_slime']),a=g.enemies[0];only(a,2);g.enemies[1].hp=10;g.enemies[2].hp=100;
  planEnemy(g,a);g.enemies[1].hp=0;const hp=g.enemies[2].hp;actEnemy(g,a);expect(g.enemies[2].hp).toBe(hp);expect(a.shield).toBeGreaterThan(0);
 });
 it('纯减益也遵守嘲讽，但不投速度命中骰',()=>{
  const g=fixture(['mon_giant_spider']),a=g.enemies[0];only(a,2);const ally=actor('companion','player',20,{...g.player.stats});g.allies.push(ally);buff(g,ally,'taunt');
  g.hitRng=()=>{throw Error('纯减益不做速度命中');};planEnemy(g,a);actEnemy(g,a);expect(g.hasStatus(ally,'speed_down')).toBe(true);expect(g.hasStatus(g.player,'speed_down')).toBe(false);
 });
 it('群体多段攻击逐目标逐段独立暴击，嘲讽不压缩范围',()=>{
  const g=fixture(['mon_giant_bat']),a=g.enemies[0],s=only(a,3);s.target='all_enemies';s.effects=s.effects.filter((e:any)=>e.type==='damage').map((e:any)=>({...e,target:'all_enemies',hits:2}));s.reset.breakOn=[];
  const ally=actor('companion','player',20,{...g.player.stats});g.allies.push(ally);buff(g,ally,'taunt');a.stats.crit=50;const rolls=[.1,.9,.9,.9];let n=0;g.critRng=()=>rolls[n++];
  planEnemy(g,a);actEnemy(g,a);expect(n).toBe(4);expect(g.player.hp).toBeLessThan(10000);expect(ally.hp).toBeLessThan(10000);
 });
 it('同回合治疗预约不重复挤占同一份缺血量',()=>{
  const g=fixture(['mon_water_sprite','mon_water_sprite','mon_goblin']);g.enemies[0].id+='a';g.enemies[1].id+='b';only(g.enemies[0],2);only(g.enemies[1],2);g.enemies[2].hp=g.enemies[2].maxHp*.79;
  g.enemies[0].stats.attack=g.enemies[1].stats.attack=100000;
  planEnemies(g);expect(g.enemies.filter((a:any)=>a.intent.skill.effects.some((e:any)=>e.type==='heal')).length).toBe(1);
 });
 it('序列化后意图、准备条件与迅捷层数保留',()=>{
  const g=fixture(['mon_dire_wolf']);buff(g,g.enemies[0],'swift');planEnemy(g,g.enemies[0]);g.player.flags.pc={catalog:new Map()};
  g.hitRng=seeded(1);g.effectRng=seeded(2);g.critRng=seeded(3);
  const saved=hydrate(snapshot(g));expect(saved.enemies[0].intent).toEqual(g.enemies[0].intent);expect(saved.status(saved.enemies[0],'swift')).toBe(1);
 });
});
