import { subclassNames } from '@/content/catalogs/professions';
import type {
  AiProjection,
  GameSnapshot,
  ReleaseChannel,
} from '@/domain/types';
import { aggregateEquipmentStats } from '@/equipment-stats';
import {
  createMvuNarrative,
  MVU_OWNER,
  MVU_SCHEMA_VERSION,
  relationshipStage,
} from '@/mvu/contracts';

export function createAiProjection(
  snapshot: GameSnapshot,
  channel: ReleaseChannel,
): AiProjection {
  const equippedIds = new Set(
    [
      snapshot.loadout.weaponId,
      snapshot.loadout.armorId,
      snapshot.loadout.accessoryId,
    ].filter((id): id is string => Boolean(id)),
  );
  const equipmentStats = aggregateEquipmentStats(
    snapshot.equipment.filter((item) => equippedIds.has(item.id)),
  );
  const effectiveHpMax = Math.max(
    1,
    snapshot.player.hpMax + equipmentStats.hpMax,
  );
  const effectiveMpMax = Math.max(
    0,
    snapshot.player.mpMax + equipmentStats.mpMax,
  );
  const narrative = createMvuNarrative(
    snapshot.social,
    snapshot.storyFlags,
    snapshot.world,
  );
  const battleState = snapshot.battle?.state;
  return {
    _meta: {
      schemaVersion: MVU_SCHEMA_VERSION,
      owner: MVU_OWNER,
      channel,
      revision: snapshot.profile.updatedAt,
    },
    state: {
      player: {
        name: snapshot.player.name,
        profession:
          subclassNames[snapshot.player.subclass] ?? snapshot.player.subclass,
        level: snapshot.player.level,
        hp: Math.min(effectiveHpMax, snapshot.player.hp),
        hpMax: effectiveHpMax,
        mp: Math.min(effectiveMpMax, snapshot.player.mp),
        mpMax: effectiveMpMax,
        gold: snapshot.player.gold,
      },
      world: {
        region: snapshot.world.region,
        location: snapshot.world.location,
        gameDate: snapshot.world.gameDate,
        gameTime: snapshot.world.gameTime,
        weather: snapshot.world.weather,
        accessibleRegions: snapshot.regionAccess
          .filter((region) => region.accessible)
          .map((region) => region.regionId),
      },
      guild: {
        rank: snapshot.guild.rank,
        activeQuests: snapshot.quests
          .filter(
            (quest) => quest.status === 'active' || quest.status === 'ready',
          )
          .map((quest) => ({
            id: quest.id,
            kind: quest.kind,
            title: quest.title,
            region: quest.region,
            objective: quest.objective,
            status: quest.status,
            currentStage: quest.currentStage,
            totalStages: quest.totalStages,
          })),
      },
      battle: {
        active: snapshot.battle?.active ?? false,
        status: battleState?.status ?? 'none',
        phase: battleState?.phase ?? 'none',
        source: snapshot.battle?.source ?? '',
        relatedQuestId: snapshot.battle?.relatedQuestId ?? '',
        turn: snapshot.battle?.turn ?? 0,
        enemies:
          battleState?.enemies.map((enemy) => ({
            name: enemy.name,
            hp: enemy.hp,
            hpMax: enemy.hpMax,
          })) ?? [],
        result: battleState?.rewards
          ? {
              experience: battleState.rewards.experience,
              gold: battleState.rewards.gold,
              items: battleState.rewards.items.map((item) => item.name),
            }
          : null,
      },
      companion: {
        relationshipStage: relationshipStage(
          narrative.companion.affinity,
        ),
      },
    },
    narrative,
  };
}
