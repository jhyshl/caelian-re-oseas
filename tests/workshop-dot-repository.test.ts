import { it, expect } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { saveWorkshopPack } from '@/workshop';
import { DEFAULT_STAR_SCALING } from '@/workshop-stars';
import { refreshWorkshopProfessionCatalogs } from '@/content/catalogs/professions';
import { loadCardCatalog } from '@/content/catalogs/cards';
import { battleCardText } from '@/battle/presentation';
import * as coreApi from '@/battle/rework/runtime/api.mjs';

it.each([[true,true],[false,true],[true,false],[false,false]])('卡牌命令与回合结算保留 DOT 配置（倍率 %s，木桩 %s）',async(nativeStatus,dummy)=>{
  const cards=Array.from({length:8},(_,i)=>({id:`custom_dot_regression_${i}`,name:`DOT回归${i}`,type:'skill',cost:0,starScaling:DEFAULT_STAR_SCALING,
    effects:[{type:'apply_debuff',nativeStatus,debuff:'burn',value:nativeStatus?.2:20,turns:4,maxStacks:5,target:'enemy'}]}));
  const saved=saveWorkshopPack({format:'caelian_workshop_class_pack',version:1,classes:[{id:'custom_class_dot_regression',main:'knight',name:'DOT回归',talent:{name:'无',effects:[]},cards,cardPool:[...cards,...cards].map(c=>c.id),starterDeck:Array.from({length:15},(_,i)=>cards[i%8]!.id)}]});
  refreshWorkshopProfessionCatalogs();
  const db=new CaelianDatabase('alpha','dot-regression-'+nativeStatus),game=new GameRepository(db,new EventBus()),profile=await game.ensureProfile('dot-probe');let seq=0;
  const run=async(type:string,payload:unknown)=>{const result=await game.execute(profile.id,{id:`dot:${seq++}`,type,payload} as any);expect(result.status,JSON.stringify(result)).toBe('applied');};
  try {
    await run('player.create',{name:'测试',classMain:'knight',subclass:saved.classes[0]!.id});
    await run('battle.start',dummy?{workshopTest:{professionId:saved.classes[0]!.id,attributes:{hpMax:0,attack:0,defense:0,speed:0,actionPointsPerTurn:0},dummyCount:1,dummyHp:10000,dummyAttack:0,dummyDefense:0,dummyInvincible:false,dummyAttackEnabled:false,autoRespawn:false,playerInvincible:false}}:{monsterId:'mon_slime'});
    const session=(await db.battleSessions.where('profileId').equals(profile.id).filter(x=>x.active).first())!,g=coreApi.hydrate(session.state.rework);
    Object.assign(g.player.stats,{attack:100,speed:10000,crit:100,critDamage:250});g.player.hp=g.player.maxHp=10000;g.player.stats.defense=10000;g.player.ap=g.player.apMax=10;g.player.buffs=[];g.player.debuffs=[];g.allies=[g.player];
    const enemy=g.enemies[0];Object.assign(enemy.stats,{defense:0,speed:1,res:0});enemy.hp=enemy.maxHp=10000;enemy.shield=0;enemy.buffs=[];enemy.debuffs=[];
    const id=saved.classes[0]!.cards[0]!.id;g.player.hand=Array.from({length:6},(_,i)=>({id,uid:'dot-card-'+i,legacy:true,ap:0,star:2,effects:[]}));
    coreApi.project(g,session.state);session.state.animations=[];session.state.log=[];await db.battleSessions.put(session);
    const card=(await loadCardCatalog())[id]!,text=battleCardText(card,2,session.state,{attack:100,defense:0,hpMax:g.player.maxHp,targetHpMax:10000});
    expect(text).toContain('每层每跳22伤害');expect(text).toContain('持续4回合');expect(text).toContain('同类最多5层');
    for(let i=0;i<6;i++)await run('battle.play-card',{battleId:session.id,handIndex:0,targetIndex:0});
    let state=(await db.battleSessions.get(session.id))!.state;
    expect(coreApi.hydrate(state.rework).enemies[0].dots).toHaveLength(5);
    // Read/write the actual exported battle graph between commands.
    await db.battleSessions.update(session.id,{state:JSON.parse(JSON.stringify(state))});
    for(let turn=1;turn<=4;turn++) {
      await run('battle.end-turn',{battleId:session.id});state=(await db.battleSessions.get(session.id))!.state;
      const restored=coreApi.hydrate(state.rework),live=restored.enemies[0];
      expect(restored.totals.playerDamage).toBeCloseTo(110*turn);if(dummy)expect(live.hp).toBe(10000-110*turn);else expect(live.hp).toBeLessThan(10000);expect(live.dots).toHaveLength(turn===4?0:5);
    }
  } finally {db.close();await db.delete();localStorage.clear();refreshWorkshopProfessionCatalogs();}
});
