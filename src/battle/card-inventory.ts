import type { DeckRecord, OwnedCardRecord } from '@/domain/types';
import type { CaelianDatabase } from '@/storage/database';

export const CARD_FUSION_COST = 2000;
export const cardStar = (value?: number) => Math.max(1, Math.min(3, Math.floor(value ?? 1)));
export const cardStackKey = (id: string, stars = 1) => id + '::' + cardStar(stars);
export const cardRecordId = (profileId: string, id: string, stars = 1) => profileId + ':' + id + (cardStar(stars) === 1 ? '' : ':s' + cardStar(stars));

export function resolveDeckStars(ids: string[], owned: OwnedCardRecord[], requested?: number[]): number[] {
  if (requested && requested.length !== ids.length) throw new Error('牌组星级数量与卡牌数量不一致');
  const remaining = new Map<string, number>();
  for (const card of owned) remaining.set(cardStackKey(card.cardId, card.stars), (remaining.get(cardStackKey(card.cardId, card.stars)) ?? 0) + card.quantity);
  return ids.map((id, index) => {
    const stars = requested?.[index] ?? [1, 2, 3].find(s => (remaining.get(cardStackKey(id, s)) ?? 0) > 0);
    if (!stars || ![1, 2, 3].includes(stars) || (remaining.get(cardStackKey(id, stars)) ?? 0) < 1) throw new Error('尚未拥有足够的同名同星卡牌：' + id + ' ' + (stars ?? '') + '★，当前仅持有相应星级的实际数量');
    const key = cardStackKey(id, stars); remaining.set(key, remaining.get(key)! - 1);
    return stars;
  });
}
export async function grantCard(db: CaelianDatabase, profileId: string, cardId: string, quantity = 1, stars = 1, source = 'reward') {
  const id = cardRecordId(profileId, cardId, stars), old = await db.ownedCards.get(id);
  await db.ownedCards.put({id, profileId, cardId, stars: cardStar(stars), quantity: (old?.quantity ?? 0) + quantity, source: old?.source ?? source, updatedAt: Date.now()});
}
export async function migrateCardInventory(db: CaelianDatabase, profileId: string) {
  return db.transaction('rw', [db.playerStates, db.ownedCards, db.decks, db.rollbackSnapshots], async () => {
    const player = await db.playerStates.get(profileId); if (!player || player.cardFusionVersion === 1) return;
    const cards = await db.ownedCards.where('profileId').equals(profileId).toArray();
    const decks = await db.decks.where('profileId').equals(profileId).toArray();
    const backupId = profileId + ':card-fusion-v1';
    if ((cards.length || decks.length) && !(await db.rollbackSnapshots.get(backupId))) await db.rollbackSnapshots.put({id: backupId, profileId, reason:'card-fusion-migration', createdAt: Date.now(), snapshot:{cards,decks,cardStars:player.cardStars}});
    const normalized = new Map<string, OwnedCardRecord>();
    for (const card of cards) {
      const stars = Math.max(cardStar(card.stars), cardStar(player.cardStars?.[card.cardId])), id = cardRecordId(profileId, card.cardId, stars);
      const previous = normalized.get(id); normalized.set(id, {...card,id,stars,quantity:(previous?.quantity ?? 0)+card.quantity});
    }
    await db.ownedCards.where('profileId').equals(profileId).delete();
    await db.ownedCards.bulkPut([...normalized.values()]);
    for (const deck of decks) {
      deck.cardStars ??= deck.cardIds.map(id => Math.max(cardStar(cards.find(c=>c.cardId===id)?.stars),cardStar(player.cardStars?.[id])));
      await db.decks.put(deck);
    }
    player.cardFusionVersion = 1; await db.playerStates.put(player);
  });
}
export function repairDeckAfterFusion(deck: DeckRecord, owned: OwnedCardRecord[], cardId: string, stars: number) {
  const remaining = new Map(owned.map(c=>[cardStackKey(c.cardId,c.stars), c.quantity]));
  const ids: string[] = [], levels: number[] = []; let removed = false;
  deck.cardIds.forEach((id,i)=>{
    const star = cardStar(deck.cardStars?.[i]), key=cardStackKey(id,star), left=remaining.get(key)??0;
    if(left>0){ids.push(id);levels.push(star);remaining.set(key,left-1);}
    else if(id===cardId && star===stars) removed=true;
  });
  const upgraded=cardStackKey(cardId,stars+1);
  if(removed && (remaining.get(upgraded)??0)>0){ids.push(cardId);levels.push(stars+1);}
  return {...deck,cardIds:ids,cardStars:levels,updatedAt:Date.now()};
}
