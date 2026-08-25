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
  it('普通构筑只允许同名卡牌按实际持有数量重复入组', async () => {
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
    const initial = await repository.snapshot(profile.id);
    const firstOwned = initial.cards[0]!;
    const activeDeck = initial.decks.find((deck) => deck.active)!;

    await expect(
      repository.execute(profile.id, {
        id: 'deck-rules-valid-owned-counts',
        type: 'deck.update',
        payload: { cardIds: [...activeDeck.cardIds] },
      }),
    ).resolves.toMatchObject({ status: 'applied' });

    const repeated = Array.from(
      { length: Math.max(10, firstOwned.quantity + 1) },
      () => firstOwned.cardId,
    );
    expect(firstOwned.quantity).toBeLessThan(20);
    expect(repeated.length).toBeLessThanOrEqual(20);
    await expect(
      repository.execute(profile.id, {
        id: 'deck-rules-over-owned-count',
        type: 'deck.update',
        payload: { cardIds: repeated },
      }),
    ).rejects.toThrow('当前仅持有');
    expect(
      (await repository.snapshot(profile.id)).decks.find((deck) => deck.active)
        ?.cardIds,
    ).toEqual(activeDeck.cardIds);
  });
});
