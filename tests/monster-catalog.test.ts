import { describe, expect, it } from 'vitest';
import { loadMonsterCatalog } from '@/content/catalogs/battle';

const BOSS_IDS = [
  'boss_academy_arcane_golem',
  'boss_ilaya_grave_warden',
  'boss_solavia_hollow_saint',
  'boss_naiathos_tide_queen',
  'boss_aethera_dream_stag',
  'boss_silvermoon_mirror_duchess',
  'boss_hearthforge_overcore',
  'boss_abyssal_leviathan_fragment',
];

describe('monster catalog', () => {
  it('normalizes every monster skill collection into executable named records', async () => {
    const catalog = await loadMonsterCatalog();

    expect(Object.keys(catalog)).toHaveLength(105);
    for (const [monsterId, monster] of Object.entries(catalog)) {
      const skills = monster.skills ?? {};
      expect(Object.keys(skills).length, monsterId).toBeGreaterThan(0);
      expect(Object.keys(skills), monsterId).not.toContain('actions');
      for (const [skillId, skill] of Object.entries(skills)) {
        expect(skillId, monsterId).not.toBe('actions');
        expect(skill.name.trim().length, `${monsterId}.${skillId}`).toBeGreaterThan(
          0,
        );
        expect(Array.isArray(skill.effects), `${monsterId}.${skillId}`).toBe(true);
      }
    }
  });

  it('gives action-list bosses deterministic skill ids without losing their data', async () => {
    const catalog = await loadMonsterCatalog();

    for (const bossId of BOSS_IDS) {
      const skills = catalog[bossId]?.skills ?? {};
      expect(Object.keys(skills)[0], bossId).toBe('action_1');
      expect(skills.action_1?.name.trim().length, bossId).toBeGreaterThan(0);
      expect(skills.action_1?.effects?.length, bossId).toBeGreaterThan(0);
    }
    expect(catalog.boss_academy_arcane_golem?.skills?.action_1).toMatchObject({
      name: '符文冲拳',
      weight: 35,
      effects: [{ type: 'damage', attack_ratio: 0.525 }],
    });
    expect(
      catalog.boss_abyssal_leviathan_fragment?.skills?.action_1,
    ).toMatchObject({
      name: '深渊咬合',
      weight: 1,
      effects: [{ type: 'damage', attack_ratio: 1.18 }],
    });
  });
});
