import { afterEach, describe, expect, it, vi } from 'vitest';
import catalog from '@/battle/rework/catalog.json';
import {
  allocatedCombatPoints, baseAttributes, COMBAT_PANEL_CAPS,
  COMBAT_RULES_VERSION, freshCombatAllocations, legacyAllocationRefund,
  migrateCombatAttributes, mutateAllocation, recomputePlayer,
  type CombatAllocatableStat,
} from '@/battle/rework/attributes';
import type { BattleSessionRecord } from '@/domain/types';
import { EventBus } from '@/kernel/event-bus';
import { grantPlayerExperience } from '@/player/progression';
import { CaelianDatabase } from '@/storage/database';
import { defaultPlayer } from '@/storage/defaults';
import { GameRepository } from '@/storage/repository';

const databases: CaelianDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map(async (db) => {
    db.close();
    await db.delete();
  }));
});

async function fixture() {
  const db = new CaelianDatabase('alpha', `combat-attributes-${crypto.randomUUID()}`);
  databases.push(db);
  const repository = new GameRepository(db, new EventBus());
  const profile = await repository.ensureProfile(`chat:${crypto.randomUUID()}`);
  return { db, repository, profileId: profile.id };
}
function playerAt(level = 20, subclass = 'holy_knight') {
  const player = defaultPlayer('p', '测试冒险者', Date.now());
  player.subclass = subclass;
  player.level = level;
  player.statPoints = 10 * (level - 1);
  const allocations = freshCombatAllocations('p');
  recomputePlayer(player, allocations);
  return { player, allocations };
}
async function legacyFixture() {
  const context = await fixture();
  const old = (await context.db.playerStates.get(context.profileId))!;
  Object.assign(old, {
    created: true, classMain: 'knight', subclass: 'holy_knight', level: 20,
    hp: 40, hpMax: 80, attack: 8, defense: 5, speed: 5,
    drawPerTurn: 5, actionPointsPerTurn: 12, statPoints: 250, lifesteal: 4,
  });
  delete old.combatRulesVersion;
  await context.db.playerStates.put(old);
  await context.db.statAllocations.put({
    ...freshCombatAllocations(context.profileId),
    hpMax: 2, mpMax: 4, attack: 3, defense: 2, speed: 1,
    lifesteal: 4, actionPointsPerTurn: 7, actionPointCosts: [2, 2, 2, 2, 2, 2, 3],
  });
  await context.db.ownedCards.put({
    id: `${context.profileId}:hk_strike`, profileId: context.profileId,
    cardId: 'hk_strike', quantity: 2, source: 'starter', updatedAt: 1,
  });
  return { ...context, old };
}

describe('战斗重构的基础属性和加点', () => {
  it('25职业的20级基础值匹配批准的职业表', () => {
    for (const profession of catalog.professions) {
      const expected = profession.baseStatsAt20;
      expect(baseAttributes(profession.id, 20)).toMatchObject({
        hpMax: expected.hp, attack: expected.attack, defense: expected.defense,
        speed: expected.speed, critRate: expected.crit, critDamage: expected.critDamage,
        effectHit: expected.ehr, effectResist: expected.res,
        actionPointsPerTurn: 5, drawPerTurn: 3,
      });
    }
  });

  it('AP跨10点阈值收3点，反复退点不会增加余额', () => {
    const { player, allocations } = playerAt();
    const initial = player.statPoints;
    for (let repeat = 0; repeat < 4; repeat += 1) {
      for (let index = 0; index < 7; index += 1) mutateAllocation(player, allocations, 'actionPointsPerTurn', 'add');
      expect(player.actionPointsPerTurn).toBe(12);
      expect(allocations.actionPointCosts).toEqual([2, 2, 2, 2, 2, 3, 3]);
      expect(player.statPoints).toBe(initial - 16);
      for (let index = 0; index < 7; index += 1) mutateAllocation(player, allocations, 'actionPointsPerTurn', 'remove');
      expect(player.actionPointsPerTurn).toBe(5);
      expect(player.statPoints).toBe(initial);
    }
  });

  it('抽牌最高5张且满级拒绝不扣点，退点按5点返还', () => {
    const { player, allocations } = playerAt();
    mutateAllocation(player, allocations, 'drawPerTurn', 'add');
    mutateAllocation(player, allocations, 'drawPerTurn', 'add');
    expect(player.drawPerTurn).toBe(5);
    expect(player.statPoints).toBe(180);
    expect(() => mutateAllocation(player, allocations, 'drawPerTurn', 'add')).toThrow('上限');
    expect(player.statPoints).toBe(180);
    mutateAllocation(player, allocations, 'drawPerTurn', 'remove');
    expect(player.drawPerTurn).toBe(4);
    expect(player.statPoints).toBe(185);
  });

  it('双暴和效果属性封顶，装备造成溢出后仍可按原价退回投入', () => {
    for (const stat of ['critRate', 'critDamage', 'effectHit', 'effectResist'] as const) {
      const { player, allocations } = playerAt(100);
      const initial = player.statPoints;
      const cap = COMBAT_PANEL_CAPS[stat]!;
      while ((player[stat] ?? 0) < cap) mutateAllocation(player, allocations, stat, 'add');
      const spent = initial - player.statPoints;
      expect(player[stat]).toBe(cap);
      expect(() => mutateAllocation(player, allocations, stat, 'add', { [stat]: 20 })).toThrow('上限');
      for (let index = 0; index < spent; index += 1) mutateAllocation(player, allocations, stat, 'remove', { [stat]: 20 });
      expect(player.statPoints).toBe(initial);
      expect(allocations[stat]).toBe(0);
      expect(() => mutateAllocation(player, allocations, stat, 'remove')).toThrow('没有可返还');
    }
  });

  it('混合加点、退款和职业重算保持总点数恒定', () => {
    const { player, allocations } = playerAt(60);
    const sequence: CombatAllocatableStat[] = [
      'hpMax', 'attack', 'defense', 'speed', 'critRate', 'critDamage',
      'effectHit', 'effectResist', 'actionPointsPerTurn', 'drawPerTurn',
    ];
    for (const stat of sequence) mutateAllocation(player, allocations, stat, 'add');
    expect(player.statPoints + allocatedCombatPoints(allocations)).toBe(590);
    player.subclass = 'fire_mage';
    recomputePlayer(player, allocations);
    expect(player.attack).toBe(baseAttributes('fire_mage', 60).attack + 2);
    expect(player.statPoints + allocatedCombatPoints(allocations)).toBe(590);
    for (const stat of [...sequence].reverse()) mutateAllocation(player, allocations, stat, 'remove');
    expect(player.statPoints).toBe(590);
  });

  it('濒死后退还并重新投入生命点不能恢复生命', () => {
    const { player, allocations } = playerAt();
    for (let index = 0; index < 20; index += 1) mutateAllocation(player, allocations, 'hpMax', 'add');
    player.hp = 1;
    for (let index = 0; index < 20; index += 1) mutateAllocation(player, allocations, 'hpMax', 'remove');
    for (let index = 0; index < 20; index += 1) mutateAllocation(player, allocations, 'hpMax', 'add');
    expect(player.hp).toBe(1);
    expect(player.statPoints + allocatedCombatPoints(allocations)).toBe(190);
  });

  it('升级成长只增加职业基础差值，不倍增既有投入', () => {
    for (const profession of catalog.professions) {
      const { player, allocations } = playerAt(20, profession.id);
      mutateAllocation(player, allocations, 'attack', 'add');
      mutateAllocation(player, allocations, 'defense', 'add');
      mutateAllocation(player, allocations, 'hpMax', 'add');
      player.hp = 80;
      const previous = { ...player };
      const gained = grantPlayerExperience(player, player.experienceToNext);
      const baseBefore = baseAttributes(profession.id, 20);
      const baseAfter = baseAttributes(profession.id, 21);
      expect(gained).toBe(1);
      expect(player.attack).toBe(baseAfter.attack + 2);
      expect(player.defense).toBe(baseAfter.defense + 5);
      expect(player.hpMax).toBe(baseAfter.hpMax + 10);
      expect(player.hp).toBe(80 + baseAfter.hpMax - baseBefore.hpMax);
      expect(player.statPoints).toBe(previous.statPoints + 10);
      expect(allocations.attack).toBe(1);
    }
  });
});

describe('战斗重构存档迁移和实际仓库命令', () => {
  it('新建但尚未选职业的档案使用新默认值，不产生多余迁移退款', async () => {
    const { db, repository, profileId } = await fixture();
    expect(await migrateCombatAttributes(db, profileId)).toBe(false);
    expect((await repository.snapshot(profileId)).player).toMatchObject({
      created: false, hpMax: 300, attack: 40, defense: 30,
      speed: 100, drawPerTurn: 3, statPoints: 0, combatRulesVersion: COMBAT_RULES_VERSION,
    });
    expect(await db.rollbackSnapshots.count()).toBe(0);
    await repository.execute(profileId, {
      id: 'initial-profession', type: 'player.create',
      payload: { name: '新手', classMain: 'mage', subclass: 'fire_mage' },
    });
    expect((await repository.snapshot(profileId)).player).toMatchObject({
      ...baseAttributes('fire_mage', 1), created: true, statPoints: 0,
    });
  });

  it('旧未创建角色也能先迁移再选职业，命令不会触发嵌套事务异常', async () => {
    const { db, repository, profileId } = await fixture();
    const old = (await db.playerStates.get(profileId))!;
    delete old.combatRulesVersion;
    Object.assign(old, { hp: 80, hpMax: 80, attack: 8, defense: 5, speed: 5, drawPerTurn: 5 });
    await db.playerStates.put(old);
    await expect(repository.execute(profileId, {
      id: 'legacy-initial-profession', type: 'player.create',
      payload: { name: '旧新手', classMain: 'mage', subclass: 'fire_mage' },
    })).resolves.toMatchObject({ status: 'applied' });
    expect((await repository.snapshot(profileId)).player).toMatchObject({
      ...baseAttributes('fire_mage', 1), created: true, statPoints: 0,
    });
    expect(await db.rollbackSnapshots.count()).toBe(1);
  });

  it('旧点数按历史价格退款、保存完整备份、重复迁移无额外收益', async () => {
    const { db, repository, profileId, old } = await legacyFixture();
    const allocations = (await db.statAllocations.get(profileId))!;
    const refund = legacyAllocationRefund(allocations);
    expect(refund).toBe(35);
    await db.battleSessions.put({
      id: 'legacy-active', profileId, active: true, updatedAt: 1,
    } as BattleSessionRecord);
    await repository.snapshot(profileId);
    expect(await db.playerStates.get(profileId)).toMatchObject({
      hpMax: 680, hp: 340, statPoints: old.statPoints + refund,
      combatRulesVersion: COMBAT_RULES_VERSION, lifesteal: 0,
    });
    expect((await db.ownedCards.get(`${profileId}:hk_strike`))!).toMatchObject({ quantity: 2, stars: 1 });
    expect((await db.battleSessions.get('legacy-active'))!.active).toBe(false);
    expect(await db.battleRewards.count()).toBe(0);
    const backups = (await db.rollbackSnapshots.toArray()).filter(b=>b.reason!=='card-fusion-migration');
    expect(backups).toHaveLength(1);
    expect(backups[0]!.snapshot).toMatchObject({ player: old, statAllocations: allocations });
    await repository.snapshot(profileId);
    expect((await db.playerStates.get(profileId))!.statPoints).toBe(285);
    expect(await db.rollbackSnapshots.count()).toBe(2);
  });

  it('迁移中途写卡失败必须同时回滚玩家、退款、标记与备份', async () => {
    const { db, profileId, old } = await legacyFixture();
    const fail = () => { throw new Error('模拟卡牌存储失败'); };
    db.ownedCards.hook('updating', fail);
    try {
      await expect(migrateCombatAttributes(db, profileId)).rejects.toThrow('模拟卡牌存储失败');
    } finally {
      db.ownedCards.hook('updating').unsubscribe(fail);
    }
    expect(await db.playerStates.get(profileId)).toEqual(old);
    expect(await db.rollbackSnapshots.count()).toBe(0);
    expect((await db.statAllocations.get(profileId))!.actionPointsPerTurn).toBe(7);
    expect(await migrateCombatAttributes(db, profileId)).toBe(true);
  });

  it('命令去重不会重复加点，移除新规则废弃的可分配属性', async () => {
    const { db, repository, profileId } = await fixture();
    await db.playerStates.update(profileId, { statPoints: 10 });
    const command = { id: 'once', type: 'player.allocate-stat', payload: { stat: 'attack', direction: 'add' } };
    expect(await repository.execute(profileId, command)).toMatchObject({ status: 'applied' });
    expect(await repository.execute(profileId, command)).toMatchObject({ status: 'duplicate' });
    expect((await db.playerStates.get(profileId))!).toMatchObject({ attack: 42, statPoints: 9 });
    for (const stat of ['mpMax', 'lifesteal']) {
      expect(await repository.execute(profileId, {
        id: `old-stat-${stat}`, type: 'player.allocate-stat', payload: { stat, direction: 'add' },
      })).toMatchObject({ status: 'rejected' });
    }
  });

  it('跨职业再转回时恢复三星，装备提供的满生命不凭空丢失', async () => {
    const { db, repository, profileId } = await fixture();
    await repository.execute(profileId, {
      id: 'create-holy', type: 'player.create',
      payload: { name: '骑士', classMain: 'knight', subclass: 'holy_knight' },
    });
    const first = (await db.ownedCards.where('profileId').equals(profileId).toArray())[0]!;
    await db.ownedCards.update(first.id, { stars: 3 });
    const equipmentId = `${profileId}:hp-armor`;
    await db.equipmentInstances.put({
      id: equipmentId, profileId, baseId: 'custom-hp-armor', name: '生命测试甲',
      slot: 'armor', rarity: 'rare', stars: 1, stats: { hp_max: 150 }, description: '', updatedAt: 1,
      ...{ equipmentRulesVersion: 1, itemLevel: 1 },
    });
    await db.equipmentLoadouts.update(profileId, { armorId: equipmentId });
    await db.playerStates.update(profileId, { hp: 450, gold: 5000 });
    await repository.execute(profileId, {
      id: 'switch-fire', type: 'player.reclass', payload: { classMain: 'mage', subclass: 'fire_mage' },
    });
    let player = (await db.playerStates.get(profileId))!;
    expect(player.hp).toBe(player.hpMax + 150);
    expect(player.professionCardArchives?.holy_knight?.cards.find(c=>c.cardId===first.cardId)?.stars).toBe(3);
    await repository.execute(profileId, {
      id: 'switch-holy', type: 'player.reclass', payload: { classMain: 'knight', subclass: 'holy_knight' },
    });
    player = (await db.playerStates.get(profileId))!;
    expect((await db.ownedCards.get(first.id))!.stars).toBe(3);
    expect(player.hp).toBe(player.hpMax + 150);
  });
});
