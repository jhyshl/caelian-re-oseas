import type { CaelianDatabase } from '@/storage/database';
import {
  hasPartySupportCard,
  partySupportCardId,
} from '@/battle/party-support-cards';

export class CardRepository {
  constructor(private readonly db: CaelianDatabase) {}

  async ensurePartySupportCard(
    profileId: string,
    subclass: string,
  ): Promise<void> {
    if (!hasPartySupportCard(subclass)) return;
    const cardId = partySupportCardId(subclass);
    const now = Date.now();
    const [owned, activeDeck] = await Promise.all([
      this.db.ownedCards.get(`${profileId}:${cardId}`),
      this.db.decks
        .where('profileId')
        .equals(profileId)
        .filter((deck) => deck.active)
        .first(),
    ]);
    if (!owned) {
      await this.db.ownedCards.put({
        id: `${profileId}:${cardId}`,
        profileId,
        cardId,
        quantity: 1,
        source: 'party-support',
        updatedAt: now,
      });
    }
    if (
      activeDeck &&
      !activeDeck.cardIds.includes(cardId) &&
      activeDeck.cardIds.length < 20
    ) {
      activeDeck.cardIds.push(cardId);
      activeDeck.updatedAt = now;
      await this.db.decks.put(activeDeck);
    }
  }

  async updateActiveDeck(profileId: string, cardIds: string[]): Promise<void> {
    if (cardIds.length < 10 || cardIds.length > 20) {
      throw new Error('牌组构筑必须为 10–20 张');
    }
    const [ownedCards, activeDeck] = await Promise.all([
      this.db.ownedCards.where('profileId').equals(profileId).toArray(),
      this.db.decks
        .where('profileId')
        .equals(profileId)
        .filter((deck) => deck.active)
        .first(),
    ]);
    const ownedCounts = ownedCards.reduce<Map<string, number>>((counts, entry) => {
      counts.set(entry.cardId, (counts.get(entry.cardId) ?? 0) + entry.quantity);
      return counts;
    }, new Map());
    const requestedCounts = cardIds.reduce<Map<string, number>>((counts, cardId) => {
      counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
      return counts;
    }, new Map());
    for (const [cardId, requested] of requestedCounts) {
      const owned = Math.max(0, ownedCounts.get(cardId) ?? 0);
      if (requested > owned) {
        throw new Error(
          owned > 0
            ? `牌组中的 ${cardId} 需要 ${requested} 张，当前仅持有 ${owned} 张`
            : `尚未拥有牌组中的 ${cardId}`,
        );
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
