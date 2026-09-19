import { describe, expect, it } from 'vitest';
import { actor, catalog, makeGame } from '@/battle/rework/runtime/physics.mjs';
import { encounter } from '@/battle/rework/runtime/model.mjs';
import { hydrate, snapshot } from '@/battle/rework/runtime/api.mjs';
import { actEnemy, planEnemies } from '@/battle/rework/runtime/enemies.mjs';
import { projectLegacyTimed, syncLegacyActors } from '@/battle/rework/runtime/legacy-bridge.mjs';

const ids = ['mon_giant_rat', 'mon_potion_slime', 'mon_clockwork_spider', 'mon_library_mimic'];
function fixture(count = 4, patch = {}) {
  const player = actor('player', 'player', 18, { hp: 10000, attack: 100, defense: 129, speed: 100, crit: 0, critDamage: 50, ehr: 0, res: 0 });
  const enemies = encounter(ids.slice(0, count).map(id => catalog.monsters.find((m: any) => m.id === id)), 18, patch);
  const game = makeGame(player, enemies, { seed: 3, trace: true, patch });
  game.round = 1;
  game.phase = 'player';
  game.enemyAI = { entranceCount: count };
  return game;
}
const roundtrip = (g: any) => hydrate(JSON.parse(JSON.stringify(snapshot(g))));

describe('四敌遭遇伤害与旧战斗恢复', () => {
  it.each([[1, 1], [2, .62], [3, .48], [4, .48]])('%i 个敌人的直伤与毒伤使用合法系数 %s', (count, scale) => {
    const g = fixture(count), source = g.enemies[0], target = g.player;
    expect(source.damageScale).toBe(scale);
    expect(source.offenseGroupFactor).toBe(1);
    const K = 100 + 5 * source.level;
    const expected = g.stat(source, 'attack') * scale * K / (K + g.stat(target, 'defense'));
    expect(g.damage(source, target, { atk: 1, crit: false }, { scale, forceHit: true }).damage).toBeCloseTo(expected);
    g.addDot(source, target, { type: 'dot', status: 'poison', atk: .3, baseChance: 100 }, { scale, skipEffectRoll: true });
    target.phaseCount = target.dots[0].firstTickPhase;
    const hp = target.hp;
    g.endPhase(target);
    expect(hp - target.hp).toBeCloseTo(expected * .3);
    expect(target.dots[0].remaining).toBe(1);
  });

  it('四敌按锁定技能完成行动，第二回合毒伤正常且非零', () => {
    const g = fixture();
    planEnemies(g);
    for (const enemy of g.enemies) actEnemy(g, enemy);
    expect(g.player.dots.length).toBeGreaterThan(0);
    expect(g.player.dots.every((d: any) => Number.isFinite(d.snapshotDamage) && d.snapshotDamage > 0)).toBe(true);
    const restored = roundtrip(g);
    restored.player.phaseCount = 2;
    const hp = restored.player.hp;
    expect(() => restored.endPhase(restored.player)).not.toThrow();
    expect(restored.player.hp).toBeLessThan(hp);
  });

  it.each([NaN, null, Infinity])('恢复旧存档中损坏的四敌系数与 DOT %s，不重抽意图或刷新持续时间', invalid => {
    const g = fixture(4, { groupOffense: { 4: .4 } }), source = g.enemies[0];
    planEnemies(g);
    const locked = { skill: source.intent.skillId, targets: source.intent.effectTargets.map((r: any) => r.targetIds) };
    g.addDot(source, g.player, { type: 'dot', status: 'poison', atk: .3 }, { scale: .4, skipEffectRoll: true });
    const dot = g.player.dots[0];
    dot.snapshotDamage = invalid;
    dot.remaining = 1;
    g.player.phaseCount = dot.firstTickPhase;
    const staleDto = { player: { debuffs: projectLegacyTimed(g.player, g.player.dots) }, enemies: [] };
    staleDto.player.debuffs.poison.value = invalid;
    // Simulate the old table lookup and a dead source; entrance count remains four.
    for (const enemy of g.enemies) {
      enemy.damageScale = enemy.encounterScale = enemy.skillScale = enemy.flags.entryScale = undefined;
      enemy.offenseGroupFactor = invalid;
      enemy.intent.damageEstimate = [invalid, invalid];
    }
    source.hp = 0;
    const restored = roundtrip(g), repaired = restored.enemies[0], savedDot = restored.player.dots[0];
    expect(repaired.damageScale).toBe(.48);
    expect(repaired.offenseGroupFactor).toBeCloseTo(.4 / .48);
    expect(repaired.intent.skillId).toBe(locked.skill);
    expect(repaired.intent.effectTargets.map((r: any) => r.targetIds)).toEqual(locked.targets);
    expect(repaired.intent.damageEstimate.every(Number.isFinite)).toBe(true);
    expect(savedDot.sourceActor).toBe(repaired);
    expect(savedDot.remaining).toBe(1);
    expect(savedDot.snapshotDamage).toBeCloseTo(restored.stat(repaired, 'attack') * .3 * .4);
    syncLegacyActors(restored, staleDto);
    expect(savedDot.snapshotDamage).toBeCloseTo(restored.stat(repaired, 'attack') * .3 * .4);
    expect(restored.trace.some((e: any) => e.type === 'numeric_recovery')).toBe(true);
    const again = roundtrip(restored);
    expect(again.trace.some((e: any) => e.type === 'numeric_recovery')).toBe(false);
    const hp = again.player.hp;
    const expected = savedDot.snapshotDamage * 190 / (190 + again.stat(again.player, 'defense'));
    again.endPhase(again.player);
    expect(hp - again.player.hp).toBeCloseTo(expected);
    expect(again.player.dots).toHaveLength(0);
  });

  it('迁移保留合法 DOT 快照、零伤害、来源与剩余回合', () => {
    const g = fixture();
    g.addDot(g.enemies[0], g.player, { type: 'dot', status: 'poison', atk: .3 }, { scale: .48, skipEffectRoll: true });
    g.addDot(g.enemies[1], g.player, { type: 'dot', status: 'burn', atk: 0 }, { scale: .48, skipEffectRoll: true });
    const before = g.player.dots.map((d: any) => ({ damage: d.snapshotDamage, source: d.sourceId, remaining: d.remaining }));
    g.enemies[0].offenseGroupFactor = NaN;
    const restored = roundtrip(g);
    expect(restored.player.dots.map((d: any) => ({ damage: d.snapshotDamage, source: d.sourceId, remaining: d.remaining }))).toEqual(before);
    syncLegacyActors(restored, { player: { debuffs: { ...projectLegacyTimed(restored.player, restored.player.dots), poison: { value: 0, turns: 2, stacks: 1 } } }, enemies: [] });
    expect(restored.player.dots[0].snapshotDamage).toBe(0);
  });
});
