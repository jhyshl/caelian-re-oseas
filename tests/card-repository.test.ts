import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';

const databases: CaelianDatabase[] = [];

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe('牌组构筑规则', () => {
  it('普通构筑接受 10–20 张并允许同一卡牌超过持有数量重复入组', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-deck-rules-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('chat:deck-rules');
    await repository.execute(profile.id, {
      id: 'deck-rules-player-create',
      type: 'player.create',
      payload: {
        name: '构筑测试员',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const firstOwned = (await repository.snapshot(profile.id)).cards[0]!;
    const repeated = Array.from({ length: 20 }, () => firstOwned.cardId);

    await expect(
      repository.execute(profile.id, {
        id: 'deck-rules-repeat-one-card',
        type: 'deck.update',
        payload: { cardIds: repeated },
      }),
    ).resolves.toMatchObject({ status: 'applied' });
    expect(
      (await repository.snapshot(profile.id)).decks.find((deck) => deck.active)
        ?.cardIds,
    ).toEqual(repeated);
  });
});
