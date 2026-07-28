import classNamesJson from '@/content/generated/professions/class-names.json';
import classSubclassesJson from '@/content/generated/professions/class-subclasses.json';
import starterDecksJson from '@/content/generated/cards/starter-decks.json';
import subclassNamesJson from '@/content/generated/professions/subclass-names.json';
import talentsJson from '@/content/generated/professions/talents.json';
import type {
  MainProfessionPresentation,
  ProfessionTalent,
} from '@/content/types';

export const classNames = classNamesJson as Record<string, string>;
export const subclassNames = subclassNamesJson as Record<string, string>;
export const classSubclasses = classSubclassesJson as Record<string, string[]>;
export const professionTalents = talentsJson as Record<
  string,
  ProfessionTalent
>;
export const starterDecks = starterDecksJson as Record<string, string[]>;

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
  return [...(starterDecks[subclassId] ?? [])];
}

export function mainClassForSubclass(subclassId: string): string {
  return (
    Object.entries(classSubclasses).find(([, subclasses]) =>
      subclasses.includes(subclassId),
    )?.[0] ?? 'none'
  );
}
