import type { CardDefinition } from '@/content/types';
import { readWorkshopPacks } from '@/workshop';
import { PARTY_SUPPORT_CARDS } from '@/battle/party-support-cards';
import { MAGICIAN_CARDS } from '@/content/catalogs/magician';

let cardCache: Record<string, CardDefinition> | undefined;
let commonMarketCache: Record<string, CardDefinition> | undefined;
const installedWorkshopCardIds = new Set<string>();

const POISON_DOUBLE_CARD_IDS = new Set([
  'wood_poison_bloom',
  'al_catalyst',
  'ap_poison_amplifier',
]);

function applyLegacyCardCompatibility(
  catalog: Record<string, CardDefinition>,
): Record<string, CardDefinition> {
  const compatible = { ...catalog };
  for (const cardId of POISON_DOUBLE_CARD_IDS) {
    const card = compatible[cardId];
    if (!card) continue;
    compatible[cardId] = {
      ...card,
      effects: (card.effects ?? []).map((effect) =>
        effect.type === 'apply_debuff' &&
        effect.debuff === 'poison' &&
        Number(effect.value) === 2
          ? {
              ...effect,
              type: 'double_debuff',
              debuff: 'poison',
              target: effect.target ?? 'enemy',
            }
          : effect,
      ),
    };
  }
  return compatible;
}

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
      ...applyLegacyCardCompatibility(
        module.default as Record<string, CardDefinition>,
      ),
      ...commonMarket,
      ...PARTY_SUPPORT_CARDS,
      ...MAGICIAN_CARDS,
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
