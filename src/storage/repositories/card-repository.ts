import type { CaelianDatabase } from '@/storage/database';

export class CardRepository {
  constructor(private readonly db: CaelianDatabase) {}

  async updateActiveDeck(profileId: string, cardIds: string[]): Promise<void> {
    const [ownedCards, activeDeck] = await Promise.all([
      this.db.ownedCards.where('profileId').equals(profileId).toArray(),
      this.db.decks
        .where('profileId')
        .equals(profileId)
        .filter((deck) => deck.active)
        .first(),
    ]);
    const ownedCounts = Object.fromEntries(
      ownedCards.map((entry) => [entry.cardId, entry.quantity]),
    );
    const requestedCounts = cardIds.reduce<Record<string, number>>(
      (result, cardId) => {
        result[cardId] = (result[cardId] ?? 0) + 1;
        return result;
      },
      {},
    );
    for (const [cardId, quantity] of Object.entries(requestedCounts)) {
      if ((ownedCounts[cardId] ?? 0) < quantity) {
        throw new Error(`牌组中的 ${cardId} 超过已拥有数量`);
      }
    }
    const now = Date.now();
    await this.db.decks.put({
      id: activeDeck?.id ?? `${profileId}:active`,
      profileId,
      name: activeDeck?.name ?? '冒险牌组',
      cardIds,
      active: true,
      updatedAt: now,
    });
  }
}
