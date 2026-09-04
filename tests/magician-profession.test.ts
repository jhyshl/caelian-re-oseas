import { describe, expect, it } from 'vitest';
import { loadCardCatalog } from '@/content/catalogs/cards';
import {
  MAGICIAN_BLANK_CARD_ID,
  MAGICIAN_CARD_IDS,
  MAGICIAN_CARD_POOL,
  MAGICIAN_STARTER_DECK,
  MAGICIAN_SUBCLASS_ID,
} from '@/content/catalogs/magician';
import {
  classSubclasses,
  getProfessionCardPool,
  getProfessionTalent,
  getStarterDeck,
  subclassNames,
} from '@/content/catalogs/professions';

describe('正式职业魔术师', () => {
  it('按官方数量规则注册职业、完整卡池和初始牌组', async () => {
    expect(classSubclasses.freelance).toContain(MAGICIAN_SUBCLASS_ID);
    expect(subclassNames[MAGICIAN_SUBCLASS_ID]).toBe('魔术师');
    expect(getProfessionTalent(MAGICIAN_SUBCLASS_ID).talent).toContain(
      '手牌上限提高 5',
    );
    expect(MAGICIAN_CARD_IDS).toHaveLength(13);
    expect(MAGICIAN_CARD_POOL).toHaveLength(26);
    expect(new Set(MAGICIAN_CARD_POOL)).toEqual(new Set(MAGICIAN_CARD_IDS));
    expect(getProfessionCardPool(MAGICIAN_SUBCLASS_ID)).toEqual(
      MAGICIAN_CARD_POOL,
    );
    expect(MAGICIAN_STARTER_DECK).toHaveLength(15);
    expect(getStarterDeck(MAGICIAN_SUBCLASS_ID)).toEqual(
      MAGICIAN_STARTER_DECK,
    );
    expect(MAGICIAN_CARD_POOL).not.toContain(MAGICIAN_BLANK_CARD_ID);
    expect(MAGICIAN_STARTER_DECK).not.toContain(MAGICIAN_BLANK_CARD_ID);

    const catalog = await loadCardCatalog();
    for (const cardId of MAGICIAN_CARD_IDS) {
      expect(catalog[cardId]?.cls).toBe(MAGICIAN_SUBCLASS_ID);
    }
    expect(catalog[MAGICIAN_BLANK_CARD_ID]).toMatchObject({
      unplayable: true,
      ephemeral: true,
      protectedFromDiscard: true,
      rewardable: false,
    });
  });
});
