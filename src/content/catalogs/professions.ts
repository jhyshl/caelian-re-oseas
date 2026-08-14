import classNamesJson from '@/content/generated/professions/class-names.json';
import classSubclassesJson from '@/content/generated/professions/class-subclasses.json';
import starterDecksJson from '@/content/generated/cards/starter-decks.json';
import subclassNamesJson from '@/content/generated/professions/subclass-names.json';
import talentsJson from '@/content/generated/professions/talents.json';
import type {
  MainProfessionPresentation,
  ProfessionTalent,
} from '@/content/types';
import { readWorkshopPacks } from '@/workshop';
import {
  hasPartySupportCard,
  partySupportCardId,
} from '@/battle/party-support-cards';
import {
  MAGICIAN_CARD_POOL,
  MAGICIAN_STARTER_DECK,
  MAGICIAN_SUBCLASS_ID,
  MAGICIAN_TALENT,
} from '@/content/catalogs/magician';

export const classNames = classNamesJson as Record<string, string>;
export const subclassNames = subclassNamesJson as Record<string, string>;
export const classSubclasses = classSubclassesJson as Record<string, string[]>;
export const professionTalents = talentsJson as Record<
  string,
  ProfessionTalent
>;
export const starterDecks = starterDecksJson as Record<string, string[]>;

const freelanceSubclasses = (classSubclasses.freelance ??= []);
if (!freelanceSubclasses.includes(MAGICIAN_SUBCLASS_ID)) {
  freelanceSubclasses.push(MAGICIAN_SUBCLASS_ID);
}
subclassNames[MAGICIAN_SUBCLASS_ID] = MAGICIAN_TALENT.title;
professionTalents[MAGICIAN_SUBCLASS_ID] = MAGICIAN_TALENT;
starterDecks[MAGICIAN_SUBCLASS_ID] = [...MAGICIAN_STARTER_DECK];

const presentation: Record<
  string,
  Pick<MainProfessionPresentation, 'icon' | 'description'>
> = {
  knight: {
    icon: '⚔',
    description: '高护盾、反伤、力量叠加，正面对抗型',
  },
  mage: {
    icon: '🔮',
    description: '元素、奥术、召唤与魔法体系',
  },
  artisan: {
    icon: '🔧',
    description: '炼金、药剂、铸造与机械体系',
  },
  freelance: {
    icon: '✦',
    description:
      '牧师、修女、占星术士、吸血鬼猎人、商人、暗黑牧师；无通用牌库',
  },
};

export const mainProfessions: MainProfessionPresentation[] = Object.entries(
  classSubclasses,
).map(([id, subclassIds]) => ({
  id,
  name: classNames[id] ?? id,
  icon: presentation[id]?.icon ?? '✦',
  description: presentation[id]?.description ?? '',
  subclassIds,
}));

const installedWorkshopClassIds = new Set<string>();

export function refreshWorkshopProfessionCatalogs(): void {
  for (const classId of installedWorkshopClassIds) {
    for (const subclasses of Object.values(classSubclasses)) {
      const index = subclasses.indexOf(classId);
      if (index >= 0) subclasses.splice(index, 1);
    }
    delete subclassNames[classId];
    delete professionTalents[classId];
    delete starterDecks[classId];
  }
  installedWorkshopClassIds.clear();
  for (const pack of readWorkshopPacks()) {
    for (const profession of pack.classes) {
      const subclasses = classSubclasses[profession.main] ?? [];
      if (!classSubclasses[profession.main]) {
        classSubclasses[profession.main] = subclasses;
      }
      if (!subclasses.includes(profession.id)) subclasses.push(profession.id);
      subclassNames[profession.id] = profession.name;
      professionTalents[profession.id] = {
        title: profession.name,
        playstyle: profession.description,
        talent: `${profession.talent.name}：${profession.talent.description}`,
      };
      starterDecks[profession.id] = [...profession.starterDeck];
      installedWorkshopClassIds.add(profession.id);
    }
  }
}

refreshWorkshopProfessionCatalogs();

export function getProfessionTalent(subclassId: string): ProfessionTalent {
  return (
    professionTalents[subclassId] ?? {
      title: subclassNames[subclassId] ?? subclassId,
      playstyle: '',
      talent: '',
    }
  );
}

export function getStarterDeck(subclassId: string): string[] {
  const deck = [...(starterDecks[subclassId] ?? [])];
  if (hasPartySupportCard(subclassId)) deck.push(partySupportCardId(subclassId));
  return deck;
}

export function getProfessionCardPool(subclassId: string): string[] | undefined {
  return subclassId === MAGICIAN_SUBCLASS_ID
    ? [...MAGICIAN_CARD_POOL]
    : undefined;
}

export function mainClassForSubclass(subclassId: string): string {
  return (
    Object.entries(classSubclasses).find(([, subclasses]) =>
      subclasses.includes(subclassId),
    )?.[0] ?? 'none'
  );
}
