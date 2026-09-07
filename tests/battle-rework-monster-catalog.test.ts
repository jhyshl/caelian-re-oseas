import { describe, expect, it } from 'vitest';
import rawCatalog from '@/battle/rework/catalog.json';
import legacy from '@/content/generated/battle/monsters.json';
import { applyReworkMonsters, reworkMonsterReferenceStats } from '@/battle/rework/monster-public-catalog';
import type { MonsterDefinition } from '@/content/catalogs/battle';

describe('怪物公开重置目录', () => {
  it('完整覆盖 97 怪物与 8 Boss、所有技能及协作单位，同时保留 ID 与奖励元数据', () => {
    const before = JSON.stringify({ rawCatalog, legacy });
    const result = applyReworkMonsters(legacy as unknown as Record<string, MonsterDefinition>);
    const sources = [...rawCatalog.monsters, ...rawCatalog.bosses];
    expect(sources).toHaveLength(105);
    for (const source of sources) {
      const monster = result[source.id]!;
      const old = (legacy as unknown as Record<string, MonsterDefinition>)[source.id];
      expect(monster).toMatchObject({ id: source.id, name: source.name, rework: true, reworkReferenceLevel: 20 });
      expect(Object.keys(monster.skills!)).toEqual(source.skills.map((skill) => skill.id));
      for (const sourceSkill of source.skills) {
        const skill = monster.skills![sourceSkill.id]!;
        expect(skill.name).toBe(sourceSkill.name);
        expect(skill.effects).toHaveLength(sourceSkill.effects.length);
        expect(skill.effects!.every((effect) => typeof effect.type === 'string')).toBe(true);
        expect(skill.desc).not.toContain('undefined');
      }
      for (const key of ['xp', 'gold', 'loot', 'level_range'] as const) expect(monster[key]).toEqual(old?.[key]);
      expect(monster.patterns).toEqual([]);
    }
    for (const boss of rawCatalog.bosses) {
      const helpers = result[boss.id]!.reworkHelpers as Array<{ id: string; skills: unknown[] }>;
      expect(helpers).toHaveLength(boss.helpers.length);
      helpers.forEach((helper, index) => expect(helper.skills).toHaveLength(boss.helpers[index]!.skills.length));
      expect(result[boss.id]!.mechanics).toContain(boss.mechanic.name);
      expect(result[boss.id]!.reworkContextActions).toEqual(boss.contextActions);
    }
    expect(JSON.stringify({ rawCatalog, legacy })).toBe(before);
  });

  it('公开 v3 护盾反制、弱自强化停用及热核持续两回合，保留全部旧技能身份', () => {
    const result = applyReworkMonsters({});
    let shieldChanges = 0;
    let retired = 0;
    for (const source of rawCatalog.monsters) {
      for (const raw of source.skills) {
        const sourceSkill = raw as unknown as { executeIf?: string };
        const skill = result[source.id]!.skills![raw.id] as unknown as Record<string, unknown>;
        if (sourceSkill.executeIf?.includes('无盾')) {
          shieldChanges++;
          expect(skill.desc).toContain('降低30%');
          expect(skill.reviewedExecuteIf).toBe(sourceSkill.executeIf);
        }
        if (skill.available === false) {
          retired++;
          expect(skill.disabledReason).toContain('不再单独');
        }
      }
    }
    expect(shieldChanges).toBe(92);
    expect(retired).toBe(57);
    const heat = result.mon_heat_core!.skills!.mon_heat_core__skill_2!;
    expect(heat.effects![0]).toMatchObject({ type: 'buff', status: 'attack_up', value: 0.2, turns: 2 });
    expect(heat.desc).toContain('持续2回合');
  });

  it('参考属性覆盖 1–100 级八属性，单体史莱姆 20 级含已审核攻击上调', () => {
    for (const source of [...rawCatalog.monsters, ...rawCatalog.bosses]) {
      for (const level of [1, 10, 20, 40, 60, 100]) {
        const stats = reworkMonsterReferenceStats(source.id, level)!;
        expect(Object.values(stats).every(Number.isFinite)).toBe(true);
        expect(stats.hp).toBeGreaterThan(0);
        expect(stats.attack).toBeGreaterThan(0);
        expect(stats.level).toBe(level);
        if (level === 1) expect(stats.critRate).toBe(0);
      }
    }
    expect(reworkMonsterReferenceStats('mon_slime', 20)).toEqual({
      level: 20, hp: 2912, attack: expect.closeTo(108 * (1 + .5 * 19 / 99), 8), defense: 136, speed: 106,
      critRate: 15, critDamage: 50, effectHit: 20, effectResist: 20,
    });
    expect(reworkMonsterReferenceStats('unknown')).toBeUndefined();
    expect(reworkMonsterReferenceStats('mon_slime', 150)?.level).toBe(100);
  });
});
