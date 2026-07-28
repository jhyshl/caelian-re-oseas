import type { CardDefinition } from '@/content/types';

let cardCache: Record<string, CardDefinition> | undefined;

export async function loadCardCatalog(): Promise<
  Record<string, CardDefinition>
> {
  if (!cardCache) {
    const module = await import('@/content/generated/cards/cards.json');
    cardCache = module.default as Record<string, CardDefinition>;
  }
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
