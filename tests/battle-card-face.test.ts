import { describe, expect, it } from 'vitest';
import {
  BATTLE_CARD_FACE_URLS,
  battleCardFaceType,
  battleCardFaceUrl,
} from '@/modules/battle/card-face';

describe('battle card faces', () => {
  it('maps every supported card type to its dedicated face slot', () => {
    expect(battleCardFaceType('attack')).toBe('attack');
    expect(battleCardFaceType('defense')).toBe('defense');
    expect(battleCardFaceType('spell')).toBe('spell');
    expect(battleCardFaceType('skill')).toBe('skill');
    expect(battleCardFaceType('summon')).toBe('summon');
  });

  it('normalizes type casing and falls back to the skill face', () => {
    expect(battleCardFaceType(' SUMMON ')).toBe('summon');
    expect(battleCardFaceType('chant')).toBe('skill');
    expect(battleCardFaceType(undefined)).toBe('skill');
  });

  it('provides a build-managed WebP URL for every face', () => {
    for (const url of Object.values(BATTLE_CARD_FACE_URLS)) {
      expect(url).toBeTruthy();
      expect(url).toContain('.webp');
    }
    expect(battleCardFaceUrl('unknown')).toBe(BATTLE_CARD_FACE_URLS.skill);
  });
});
