import type { BattleCompanionState, BattlePlayerState } from '@/domain/types';
import { CAELIAN_SKILLS, TRELIO_SKILLS } from './rework/runtime/story-party.mjs';
export { CAELIAN_SKILLS, TRELIO_SKILLS };

export function syncCompanionTactics(companion: BattleCompanionState, player: BattlePlayerState): void {
  const fresh = createCaelianCompanion(companion.level,player);
  if (companion.tacticsVersion !== 2) {
    const inherit = (current: BattleCompanionState | BattleCompanionState['summons'][number], next: typeof current) => {
      const hp = current.hp <= 0 ? 0 : Math.min(next.hpMax,Math.max(1,Math.round(current.hp/Math.max(1,current.hpMax)*next.hpMax)));
      Object.assign(current,{hp,hpMax:next.hpMax,attack:next.attack,defense:next.defense,speed:next.speed,critRate:next.critRate,critDamage:next.critDamage,effectHit:next.effectHit,effectResist:next.effectResist});
      current.shield=Math.min(current.shield,next.hpMax*.6);
    };
    inherit(companion,fresh);
    if (companion.injured) companion.hp=0;
    for (const summon of companion.summons) inherit(summon,fresh.summons[0]!);
    companion.tacticsVersion=2;
  }
  companion.lifesteal=0;companion.actionSequence=fresh.actionSequence;companion.actionIndex=0;
  for (const summon of companion.summons) { summon.lifesteal=0;summon.skills=fresh.summons[0]!.skills; }
}

export function createCaelianCompanion(playerLevel: number, player: BattlePlayerState): BattleCompanionState {
  const level = Math.max(1, Math.floor(playerLevel));
  const inherit = (ratio: number, secondary = ratio) => ({
    hp: Math.max(1, Math.round(player.hpMax * ratio)),
    hpMax: Math.max(1, Math.round(player.hpMax * ratio)),
    shield: 0,
    attack: Math.round(player.attack * ratio),
    defense: Math.round(player.defense * ratio),
    speed: player.speed * secondary,
    critRate: (player.critRate ?? 5) * secondary,
    critDamage: (player.critDamage ?? 50) * secondary,
    effectHit: (player.effectHit ?? 0) * secondary,
    effectResist: (player.effectResist ?? 0) * secondary,
    lifesteal: 0,
    buffs: {}, debuffs: {},
  });
  const describe = (skills: typeof CAELIAN_SKILLS) => skills.map(({id,name,apCost,description}) => ({id,name,apCost,description}));
  return {
    id:'caelian', name:'凯利安', profession:'圣辉龙骑', level,
    ...inherit(1.2, 1), injured:false, tacticsVersion:2,
    actionSequence:describe(CAELIAN_SKILLS), actionIndex:0,
    summons:[{id:'trelio', name:'特莱奥', ...inherit(.8), skills:describe(TRELIO_SKILLS)}],
  };
}
