import type { BattleCompanionSkillState } from '@/domain/types';
export const CAELIAN_SKILLS: readonly BattleCompanionSkillState[];
export const TRELIO_SKILLS: readonly BattleCompanionSkillState[];
export function partyTurn(game:any):void;
export function legacyPartyTurn(state:import('@/domain/types').LocalBattleState):any;
export function legacyTacticalGame(state:import('@/domain/types').LocalBattleState):any;
