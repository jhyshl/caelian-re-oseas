import { subclassNames } from '@/content/catalogs/professions';
import type {
  AiProjection,
  GameSnapshot,
  ReleaseChannel,
} from '@/domain/types';

export function createAiProjection(
  snapshot: GameSnapshot,
  channel: ReleaseChannel,
  revision: number,
): AiProjection {
  return {
    schemaVersion: 2,
    channel,
    revision,
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
    },
    guild: {
      rank: snapshot.guild.rank,
      activeQuests: snapshot.quests
        .filter(
          (quest) => quest.status === 'active' || quest.status === 'ready',
        )
        .map((quest) => ({
          kind: quest.kind,
          title: quest.title,
          objective: quest.objective,
          currentStage: quest.currentStage,
          totalStages: quest.totalStages,
        })),
    },
    battle: {
      active: snapshot.battle?.active ?? false,
      source: snapshot.battle?.source ?? '',
      relatedQuestId: snapshot.battle?.relatedQuestId ?? '',
      turn: snapshot.battle?.turn ?? 0,
    },
  };
}
