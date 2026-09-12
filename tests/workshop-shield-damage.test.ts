import { it, expect } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { saveWorkshopPack } from '@/workshop';
import { refreshWorkshopProfessionCatalogs } from '@/content/catalogs/professions';
import { loadCardCatalog } from '@/content/catalogs/cards';
import { previewBattleCard } from '@/battle/card-preview';
import { battleCardText } from '@/battle/presentation';
import * as coreApi from '@/battle/rework/runtime/api.mjs';

it('单个混合公式只命中一次，两个伤害积木独立暴击且预览按未暴击计算', async () => {
  const cards=Array.from({length:8},(_,i)=>({id:`custom_shield_regression_${i}`,name:i===0?'单公式':i===1?'双积木':`占位卡${i}`,type:'skill',cost:0,
    effects:i===0?[{type:'damage',value:40,scaling:{stat:'shield',percent:50},target:'enemy'}]:[
      {type:'damage',value:40,scaling:{stat:'hp',percent:50},target:'enemy'},
      {type:'damage_from_shield',ratio:.5,value:20,scaling:{stat:'shield',percent:20},target:'enemy'},
    ]}));
  const saved=saveWorkshopPack({format:'caelian_workshop_class_pack',version:1,classes:[{id:'custom_class_shield_regression',main:'knight',name:'护盾回归',talent:{name:'无',effects:[]},cards,cardPool:[...cards,...cards].map(c=>c.id),starterDeck:Array.from({length:15},(_,i)=>cards[i%8]!.id)}]});
  refreshWorkshopProfessionCatalogs();
  const db=new CaelianDatabase('alpha','shield-damage-regression');const game=new GameRepository(db,new EventBus());const p=await game.ensureProfile('shield-probe');let seq=0;
  const run=async(type:string,payload:unknown)=>{const result=await game.execute(p.id,{id:`probe:${seq++}`,type,payload} as any);expect(result.status,JSON.stringify(result)).toBe('applied');};
  try {
    await run('player.create',{name:'测试',classMain:'knight',subclass:saved.classes[0]!.id});
    for(const [name,crit] of [['单公式',100],['双积木',0],['双积木',50]] as const) {
      await db.battleSessions.where('profileId').equals(p.id).modify({active:false});
      await run('battle.start',{monsterId:'mon_slime'});
      const session=(await db.battleSessions.where('profileId').equals(p.id).filter(x=>x.active).first())!;
      const g=coreApi.hydrate(session.state.rework);g.player.hp=g.player.maxHp=400;g.player.shield=400;g.player.ap=10;g.player.buffs=[];g.player.debuffs=[];
      Object.assign(g.player.stats,{attack:100,speed:10000,crit,critDamage:50});g.critRng.setState(1);
      Object.assign(g.enemies[0].stats,{defense:3*(100+5*g.player.level),speed:1});g.enemies[0].hp=g.enemies[0].maxHp=10000;g.enemies[0].shield=0;g.enemies[0].buffs=[];g.enemies[0].debuffs=[];
      const id=saved.classes[0]!.cards.find(c=>c.name===name)!.id;
      g.player.hand=[{id,uid:'probe-card',legacy:true,ap:1,star:1,effects:[]}];coreApi.project(g,session.state);session.state.animations=[];session.state.log=[];await db.battleSessions.put(session);
      const card=(await loadCardCatalog())[id]!;const preview=previewBattleCard(session.state,card,0);const text=battleCardText(card,1,session.state,{attack:100,defense:20,hpMax:400,targetHpMax:10000});
      await run('battle.play-card',{battleId:session.id,handIndex:0,targetIndex:0});
      const after=(await db.battleSessions.get(session.id))!.state;const events=after.animations?.filter(e=>e.kind==='damage'&&e.targetId===g.enemies[0].id);
      expect(events).toHaveLength(name==='单公式'?1:2);
      expect(events?.map(e=>e.amount)).toEqual(name==='单公式'?[90]:crit?[60,75]:[60,50]);
      expect(events?.map(e=>e.critical)).toEqual(name==='单公式'?[true]:crit?[false,true]:[false,false]);
      expect(preview.enemyDamage[0]).toBe(name==='单公式'?60:110);
      expect(10000-after.enemies[0]!.hp).toBe(name==='单公式'?90:crit?135:110);
      expect(text).toContain('240总伤害');
      if(name==='双积木') {
        expect(text).toContain('200总伤害');
        expect(events?.[1]?.label).toContain('按护盾造成伤害');
      }

    }
  } finally {db.close();await db.delete();localStorage.clear();}
});
