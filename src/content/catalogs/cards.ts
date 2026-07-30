import type { CardDefinition } from '@/content/types';
import { readWorkshopPacks } from '@/workshop';

let cardCache: Record<string, CardDefinition> | undefined;
let commonMarketCache: Record<string, CardDefinition> | undefined;
const installedWorkshopCardIds = new Set<string>();

export function refreshWorkshopCardCatalog(): void {
  if (!cardCache) return;
  for (const cardId of installedWorkshopCardIds) delete cardCache[cardId];
  installedWorkshopCardIds.clear();
  for (const pack of readWorkshopPacks()) {
    for (const profession of pack.classes) {
      for (const card of profession.cards) {
        cardCache[card.id] = card;
        installedWorkshopCardIds.add(card.id);
      }
    }
  }
}

export async function loadCommonMarketCards(): Promise<
  Record<string, CardDefinition>
> {
  if (!commonMarketCache) {
    const module = await import(
      '@/content/generated/cards/common-market.json'
    );
    commonMarketCache = module.default as Record<string, CardDefinition>;
  }
  return commonMarketCache;
}

export async function loadCardCatalog(): Promise<
  Record<string, CardDefinition>
> {
  if (!cardCache) {
    const [module, commonMarket] = await Promise.all([
      import('@/content/generated/cards/cards.json'),
      loadCommonMarketCards(),
    ]);
    cardCache = {
      ...(module.default as Record<string, CardDefinition>),
      ...commonMarket,
    };
  }
  refreshWorkshopCardCatalog();
  return cardCache;
}

export async function loadCards(
  cardIds: string[],
): Promise<Array<{ id: string; definition: CardDefinition }>> {
  const catalog = await loadCardCatalog();
  return cardIds.flatMap((id) => {
    const definition = catalog[id];
    return definition ? [{ id, definition }] : [];
  });
}
