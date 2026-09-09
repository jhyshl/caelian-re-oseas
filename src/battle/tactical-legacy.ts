import type { LocalBattleState } from '@/domain/types';
import type { CardEffect } from '@/content/types';
import { hydrate, syncExternal } from './rework/runtime/api.mjs';
import { legacyTacticalGame } from './rework/runtime/story-party.mjs';
import { bestSkillTarget } from './rework/runtime/tactical-ai.mjs';

/** Evaluate legacy/workshop primitive skills without executing arbitrary scripts. */
export function legacySkillEvaluator(state: LocalBattleState, sourceId: string) {
  const g = state.rework ? hydrate(state.rework) : legacyTacticalGame(state);
  if (state.rework) syncExternal(g,state);
  const source = [...g.allies,...g.enemies].find(a=>a.id===sourceId) ?? g.player;
  return (effects: CardEffect[]) => {
    let unknown = 0;
    const normalized = effects.map(raw => {
      const e:any = {...raw};
      e.kind = ({apply_buff:'buff',apply_debuff:'debuff',lifesteal_damage:'damage',true_damage:'damage'} as Record<string,string>)[e.type] ?? e.type;
      e.status = e.buff ?? e.debuff ?? e.status;
      const support = ['heal','shield','buff','cleanse'].includes(e.kind);
      if (source.side==='enemy') e.target = support ? ['all_enemies','enemy_team','all_allies'].includes(e.target) ? 'all_allies' : 'self' : 'enemy';
      else e.target = e.target==='selected_allies' ? 'ally' : e.target ?? (support?'self':'enemy');
      if (['damage','heal','shield'].includes(e.kind)) {
        e.flat = e.flat ?? Number(e.value ?? e.amount ?? 0);
        e.atk = e.atk ?? (e.scaling?.stat==='attack' ? Number(e.scaling.percent??0)/100 : Number(e.multiplier??0));
      }
      if (!['damage','heal','shield','buff','debuff','dot','cleanse','dispel','shield_damage'].includes(e.kind)) unknown += Math.max(10,source.stats.attack)*.3;
      return e;
    });
    const choice = bestSkillTarget(g,source,{effects:normalized});
    return {value:(choice?.value??0)+unknown,targetId:choice?.target.id};
  };
}
