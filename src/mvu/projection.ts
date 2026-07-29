import { subclassNames } from '@/content/catalogs/professions';
import type {
  AiProjection,
  GameSnapshot,
  ReleaseChannel,
} from '@/domain/types';
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
  const narrative = createMvuNarrative(
    snapshot.social,
    snapshot.storyFlags,
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
        hp: snapshot.player.hp,
        hpMax: snapshot.player.hpMax,
        mp: snapshot.player.mp,
        mpMax: snapshot.player.mpMax,
        gold: snapshot.player.gold,
      },
      world: {
        region: snapshot.world.region,
        location: snapshot.world.location,
        gameDate: snapshot.world.gameDate,
        gameTime: snapshot.world.gameTime,
        weather: snapshot.world.weather,
        mainStage: snapshot.world.mainStage,
        mainStep: snapshot.world.mainStep,
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
