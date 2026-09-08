import { cardRecordId, cardStar, CARD_FUSION_COST, grantCard, repairDeckAfterFusion, resolveDeckStars } from '@/battle/card-inventory';
import { reworkCard } from '@/battle/rework/catalog';
import { readWorkshopPacks } from '@/workshop';
import { needsWorkshopStars } from '@/workshop-stars';
import type { CaelianDatabase } from '@/storage/database';
import {
  hasPartySupportCard,
  partySupportCardId,
} from '@/battle/party-support-cards';

export class CardRepository {
  constructor(private readonly db: CaelianDatabase) {}

  async upgrade(profileId: string, cardId: string, requestedStars?: number): Promise<void> {
    const custom = readWorkshopPacks().flatMap(pack => pack.classes).flatMap(profession => profession.cards).find(card => card.id === cardId);
    if ((!reworkCard(cardId) && !custom) || cardId === 'mg_blank_card') throw new Error('这张卡牌不能合成');
    if (custom && needsWorkshopStars(custom)) throw new Error('这张旧版自定义卡牌没有星级数值，请到创意工坊设置一至三星数值后再合成');
    if(await this.db.battleSessions.where('profileId').equals(profileId).filter(s=>s.active).count()) throw new Error('请在战斗结束后合成卡牌');
    const cards=await this.db.ownedCards.where('profileId').equals(profileId).toArray();
    if(requestedStars===undefined && cards.some(c=>c.cardId===cardId) && !cards.some(c=>c.cardId===cardId&&cardStar(c.stars)<3)) throw new Error('卡牌最高三星');
    const stars=requestedStars??cards.filter(c=>c.cardId===cardId&&cardStar(c.stars)<3).sort((a,b)=>cardStar(a.stars)-cardStar(b.stars))[0]?.stars??1;
    if (![1,2].includes(stars)) throw new Error('卡牌最高三星');
    const owned=await this.db.ownedCards.get(cardRecordId(profileId,cardId,stars)),player=await this.db.playerStates.get(profileId);
    if(!owned||owned.quantity<3) throw new Error('合成需要3张同名同星级卡牌');
    if(!player||player.gold<CARD_FUSION_COST) throw new Error('每次合成需要2000金币');
    owned.quantity-=3; owned.updatedAt=Date.now();
    if(owned.quantity) await this.db.ownedCards.put(owned);else await this.db.ownedCards.delete(owned.id);
    await grantCard(this.db,profileId,cardId,1,stars+1,'fusion');
    player.gold-=CARD_FUSION_COST;player.updatedAt=Date.now();await this.db.playerStates.put(player);
    const after=await this.db.ownedCards.where('profileId').equals(profileId).toArray();
    const decks=await this.db.decks.where('profileId').equals(profileId).toArray();
    for(const deck of decks) await this.db.decks.put(repairDeckAfterFusion(deck,after,cardId,stars));
  }

  async ensurePartySupportCard(
    profileId: string,
    subclass: string,
  ): Promise<void> {
    if (!hasPartySupportCard(subclass)) return;
    const cardId = partySupportCardId(subclass);
    const now = Date.now();
    const [owned, activeDeck] = await Promise.all([
      this.db.ownedCards.where('profileId').equals(profileId).filter(c=>c.cardId===cardId&&c.quantity>0).first(),
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
      if(activeDeck.cardStars) activeDeck.cardStars.push(owned?.stars??1);
      activeDeck.updatedAt = now;
      await this.db.decks.put(activeDeck);
    }
  }

  async updateActiveDeck(profileId: string, cardIds: string[], cardStars?: number[]): Promise<void> {
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
    const resolvedStars = resolveDeckStars(cardIds, ownedCards, cardStars);
    const now = Date.now();
    await this.db.decks.put({
      id: activeDeck?.id ?? `${profileId}:active`,
      profileId,
      name: activeDeck?.name ?? '冒险牌组',
      cardIds,
      cardStars: resolvedStars,
      active: true,
      updatedAt: now,
    });
  }
}
