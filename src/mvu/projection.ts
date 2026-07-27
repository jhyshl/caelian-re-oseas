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
    schemaVersion: 1,
    channel,
    revision,
    player: {
      name: snapshot.character.name,
      className: snapshot.character.className,
      subclass: snapshot.character.subclass,
      level: snapshot.character.level,
    },
    world: {
      region: snapshot.world.region,
      location: snapshot.world.location,
      gameDate: snapshot.world.gameDate,
      storyFlags: [...snapshot.world.storyFlags],
    },
    guild: {
      activeQuests: snapshot.quests
        .filter((quest) => quest.status === 'active')
        .map((quest) => ({
          kind: quest.kind,
          title: quest.title,
          objective: quest.objective,
        })),
    },
    battle: {
      active: false,
    },
  };
}
