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
    const ownedIds = new Set(
      ownedCards
        .filter((entry) => entry.quantity > 0)
        .map((entry) => entry.cardId),
    );
    for (const cardId of new Set(cardIds)) {
      if (!ownedIds.has(cardId)) {
        throw new Error(`尚未拥有牌组中的 ${cardId}`);
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
