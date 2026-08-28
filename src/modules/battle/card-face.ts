import attackFace from '@/assets/battle/cards/card_attack.webp';
import defenseFace from '@/assets/battle/cards/card_defense.webp';
import skillFace from '@/assets/battle/cards/card_skill.webp';
import spellFace from '@/assets/battle/cards/card_spell.webp';
import summonFace from '@/assets/battle/cards/card_summon.webp';
import { loadLocalAssetUrl } from '@/assets/local-asset-cache';

export type BattleCardFaceType =
  | 'attack'
  | 'defense'
  | 'spell'
  | 'skill'
  | 'summon';

export const BATTLE_CARD_FACE_URLS: Readonly<Record<BattleCardFaceType, string>> = {
  attack: attackFace,
  defense: defenseFace,
  spell: spellFace,
  skill: skillFace,
  summon: summonFace,
};

export async function loadBattleCardFaceUrls(
  host: Window,
): Promise<Readonly<Record<BattleCardFaceType, string>>> {
  const entries = await Promise.all(
    Object.entries(BATTLE_CARD_FACE_URLS).map(async ([type, sourceUrl]) => [
      type,
      await loadLocalAssetUrl(sourceUrl, host),
    ] as const),
  );
  return Object.fromEntries(entries) as Record<BattleCardFaceType, string>;
}

export function battleCardFaceType(type: string | undefined): BattleCardFaceType {
  switch (type?.trim().toLowerCase()) {
    case 'attack':
      return 'attack';
    case 'defense':
      return 'defense';
    case 'spell':
      return 'spell';
    case 'summon':
      return 'summon';
    default:
      return 'skill';
  }
}

export function battleCardFaceUrl(
  type: string | undefined,
  urls: Readonly<Record<BattleCardFaceType, string>> = BATTLE_CARD_FACE_URLS,
): string {
  return urls[battleCardFaceType(type)];
}
