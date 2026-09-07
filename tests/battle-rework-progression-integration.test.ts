import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrate, project, syncExternal } from '@/battle/rework/runtime/api.mjs';
import { scaleReworkEquipment } from '@/battle/rework/equipment';
import { baseAttributes } from '@/battle/rework/attributes';
import { loadEquipmentDefinitions } from '@/content/catalogs/inventory';
import { equipmentRewardEffect } from '@/rewards/reward-display';
import { formatEquipmentStats } from '@/equipment-stats';
import type { DomainCommand } from '@/domain/commands';
import type { BattleSessionRecord } from '@/domain/types';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { MarketRepository } from '@/storage/repositories/market-repository';

const databases: CaelianDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map(async (db) => { db.close(); await db.delete(); }));
});
async function setup(subclass = 'magician') {
  const db = new CaelianDatabase('alpha', 'battle-progression-' + crypto.randomUUID());
  databases.push(db);
  const game = new GameRepository(db, new EventBus(), { random: () => 0 });
  const profile = await game.ensureProfile('progression-' + crypto.randomUUID());
  await game.execute(profile.id, { id: crypto.randomUUID(), type: 'player.create', payload: { name: '成长验证', classMain: 'freelance', subclass } });
  await db.playerStates.update(profile.id, { gold: 10_000 });
  return { db, game, profile };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function start(f: Fixture, cardId = 'mg_card_knife', monsterId = 'mon_slime') {
  await f.game.execute(f.profile.id, { id: crypto.randomUUID(), type: 'battle.start', payload: { monsterId, source: '成长集成验证' } });
  const session = (await f.db.battleSessions.where('profileId').equals(f.profile.id).filter((s) => s.active).first())!;
  const core = hydrate(session.state.rework);
  core.player.hp = core.player.maxHp = 1_000;
  core.player.ap = core.player.apMax = 20;
  core.player.buffs = [];
  core.player.debuffs = [];
  Object.assign(core.player.stats, { hp: 1_000, attack: 100, defense: 100, speed: 1_000, crit: 0 });
  for (const enemy of core.enemies) {
    enemy.hp = enemy.maxHp = 10_000;
    enemy.shield = 0;
    enemy.buffs = [];
    enemy.debuffs = [];
    Object.assign(enemy.stats, { hp: 10_000, defense: 0, speed: 1, crit: 0 });
  }
  project(core, session.state);
  const previous = [...session.state.player.hand, ...session.state.player.drawPile, ...session.state.player.discardPile].find((c) => c.cardId === cardId);
  const stars = (await f.db.playerStates.get(f.profile.id))!.cardStars?.[cardId] ?? 1;
  session.state.player.hand = [previous ?? { instanceId: 'controlled:' + cardId, cardId, stars }];
  session.state.player.drawPile = [];
  session.state.player.discardPile = [];
  for (const enemy of session.state.enemies) { enemy.xp = 0; enemy.gold = [10, 10]; enemy.loot = []; }
  await f.db.battleSessions.put(session);
  return session;
}
async function play(f: Fixture, session: BattleSessionRecord, id: string = crypto.randomUUID()) {
  return f.game.execute(f.profile.id, { id, type: 'battle.play-card', payload: { battleId: session.id, handIndex: 0, targetIndex: 0 } });
}
async function endTurn(f: Fixture, session: BattleSessionRecord, id: string = crypto.randomUUID()) {
  return f.game.execute(f.profile.id, { id, type: 'battle.end-turn', payload: { battleId: session.id } });
}
async function setVictoryTarget(f: Fixture, session: BattleSessionRecord, experience = 0) {
  session.state.enemies.forEach((enemy) => { enemy.hp = 1; enemy.xp = experience; });
  await f.db.battleSessions.put(session);
}
async function current(f: Fixture, session: BattleSessionRecord) {
  return (await f.db.battleSessions.get(session.id))!;
}

describe('重置成长与战斗保存集成', () => {
  it('进行中的战斗拒绝升星、加点、转职，保持战斗和持久数据不变', async () => {
    const f = await setup();
    await f.db.playerStates.update(f.profile.id, { statPoints: 10 });
    const session = await start(f);
    const before = await f.game.snapshot(f.profile.id);
    const commands: DomainCommand[] = [
      { id: 'battle-upgrade', type: 'cards.upgrade', payload: { cardId: 'mg_card_knife' } },
      { id: 'battle-allocate', type: 'player.allocate-stat', payload: { stat: 'attack', direction: 'add' } },
      { id: 'battle-reclass', type: 'player.reclass', payload: { classMain: 'freelance', subclass: 'priest' } },
    ];
    for (const command of commands) {
      await expect(f.game.execute(f.profile.id, command)).rejects.toThrow(/战斗/);
      expect(await f.db.commandInbox.get(command.id)).toBeUndefined();
    }
    const after = await f.game.snapshot(f.profile.id);
    expect(after.player).toEqual(before.player);
    expect(after.cards).toEqual(before.cards);
    expect(after.statAllocations).toEqual(before.statAllocations);
    expect(await current(f, session)).toEqual(before.battle);
  });

  it('回合保存与胜利结算保留战斗外金币变化，升级发10点且胜利状态不被投影改回玩家阶段', async () => {
    const f = await setup();
    let session = await start(f);
    session.state.player.gold = (session.state.player.gold ?? 0) + 25;
    await f.db.battleSessions.put(session);
    await f.game.execute(f.profile.id, { id: 'outside-gold-change', type: 'player.update', payload: { gold: 10_200 } });
    await endTurn(f, session);
    session = await current(f, session);
    expect(session.state.turn).toBe(2);
    expect(session.state.phase).toBe('player');
    expect(session.state.player.gold).toBe(10_225);
    session.state.player.hand = [{ instanceId: 'finish:knife', cardId: 'mg_card_knife', stars: 1 }];
    await setVictoryTarget(f, session, 120);
    const before = (await f.db.playerStates.get(f.profile.id))!;
    await play(f, session, 'finish-victory');
    const after = await current(f, session);
    expect(after.state.status).toBe('victory');
    expect(after.state.phase).toBe('ended');
    expect(after.phase).toBe('ended');
    expect(after.state.rewards!.gold).toBe(50);
    const player = (await f.db.playerStates.get(f.profile.id))!;
    expect(player.gold).toBe(10_275);
    expect(player.level).toBe(before.level + 1);
    expect(player.statPoints).toBe(before.statPoints + 10);
    expect(player.attack).toBe(before.attack + baseAttributes('magician', 2).attack - baseAttributes('magician', 1).attack);
    expect(player.hpMax).toBe(before.hpMax + baseAttributes('magician', 2).hpMax - baseAttributes('magician', 1).hpMax);
    expect((await play(f, session, 'finish-victory')).status).toBe('duplicate');
    await expect(endTurn(f, session)).rejects.toThrow(/结束/);
    expect((await f.db.playerStates.get(f.profile.id))!.gold).toBe(10_275);
    expect(await f.db.battleRewards.where('battleId').equals(session.id).count()).toBe(1);
  });

  it('战斗结算中存储故障回滚伤害、奖励与金币，重试不会产生重复收益', async () => {
    const f = await setup();
    const session = await start(f);
    await setVictoryTarget(f, session);
    const beforePlayer = await f.db.playerStates.get(f.profile.id);
    const beforeBattle = await current(f, session);
    vi.spyOn(f.db.battleRewards, 'put').mockRejectedValueOnce(new Error('simulated-settlement-failure'));
    await expect(play(f, session, 'atomic-victory')).rejects.toThrow('simulated-settlement-failure');
    expect(await f.db.playerStates.get(f.profile.id)).toEqual(beforePlayer);
    expect(await current(f, session)).toEqual(beforeBattle);
    expect(await f.db.commandInbox.get('atomic-victory')).toBeUndefined();
    expect(await f.db.battleRewards.where('battleId').equals(session.id).count()).toBe(0);
    expect((await play(f, session, 'atomic-victory')).status).toBe('applied');
    expect((await f.db.playerStates.get(f.profile.id))!.gold).toBe(10_050);
    expect(await f.db.battleRewards.where('battleId').equals(session.id).count()).toBe(1);
  });

  it('商人买路钱支付确定战利品的150%，保留外部钱包变化且立即结束、不发奖励', async () => {
    const f = await setup('merchant');
    const session = await start(f, 'me_bribe');
    // Fix the advertised encounter quote to a deterministic 50-coin reward.
    const core = hydrate(session.state.rework);
    syncExternal(core, session.state);
    core.encounterGoldReward = 50;
    project(core, session.state);
    await f.db.battleSessions.put(session);
    await f.game.execute(f.profile.id, { id: 'external-spend', type: 'player.update', payload: { gold: 9_700 } });
    const beforeExperience = (await f.db.playerStates.get(f.profile.id))!.experience;
    await play(f, session);
    const after = await current(f, session);
    expect(after.state).toMatchObject({ status: 'surrendered', phase: 'ended', reworkOutcome: 'bribed', rewards: null });
    expect(after.phase).toBe('ended');
    expect((await f.db.playerStates.get(f.profile.id))!.gold).toBe(9_625);
    expect((await f.db.playerStates.get(f.profile.id))!.experience).toBe(beforeExperience);
    expect(await f.db.battleRewards.where('battleId').equals(session.id).count()).toBe(0);
    expect(after.state.enemies.every((enemy) => enemy.hp > 0)).toBe(true);
  });

  it('买路钱原始报价与战斗奖励使用相同金币单位，并公开确切金币费用', async () => {
    const f = await setup('merchant');
    await f.game.execute(f.profile.id, { id: 'quote-new', type: 'battle.start', payload: { monsterId: 'mon_slime', source: '买路钱报价核验' } });
    const session = (await f.db.battleSessions.where('profileId').equals(f.profile.id).filter((s) => s.active).first())!;
    const core = hydrate(session.state.rework);
    const rewardQuote = Math.round(session.state.enemies.reduce((sum, enemy) => sum + (enemy.gold[0] + enemy.gold[1]) / 2, 0)) * 5;
    expect(rewardQuote).toBeGreaterThan(0);
    expect(core.encounterGoldReward).toBe(rewardQuote);
    const bribe = [...session.state.player.hand, ...session.state.player.drawPile, ...session.state.player.discardPile].find((card) => card.cardId === 'me_bribe')!;
    expect(bribe).toBeDefined();
    session.state.player.hand = [bribe];
    syncExternal(core, session.state);
    project(core, session.state);
    expect(session.state.reworkCards?.[bribe.instanceId]).toMatchObject({ goldCost: Math.ceil(rewardQuote * 1.5) });
  });

  it('仓皇逃窜仍让敌人行动一次，存活才结束，保存生命且不发经验和掉落', async () => {
    const f = await setup('merchant');
    const session = await start(f, 'me_panic_escape');
    await play(f, session);
    expect((await current(f, session)).state.status).toBe('ongoing');
    await endTurn(f, session);
    const after = await current(f, session);
    expect(after.state).toMatchObject({ status: 'surrendered', phase: 'ended', reworkOutcome: 'escaped', rewards: null });
    expect(hydrate(after.state.rework).totals.enemyActions).toBe(1);
    expect((await f.db.playerStates.get(f.profile.id))!.hp).toBeCloseTo(after.state.player.hp, 8);
    expect((await f.db.playerStates.get(f.profile.id))!.gold).toBe(10_000);
    expect(await f.db.battleRewards.where('battleId').equals(session.id).count()).toBe(0);
  });

  it('装备迁移前后保持相同市场估价，预览与落地装备预算一致', async () => {
    const f = await setup('merchant');
    await f.db.playerStates.update(f.profile.id, { gold: 100_000, level: 30 });
    const market = new MarketRepository(f.db, () => new Date(2026, 6, 30, 16, 30));
    const view = await market.view(f.profile.id);
    const listing = view.listings.find((entry) => entry.kind === 'equipment')!;
    expect(listing).toBeDefined();
    const definitions = await loadEquipmentDefinitions();
    const definition = definitions[listing.refId!]!;
    const expected = scaleReworkEquipment(definition.stats, listing.stars!, 30, definition.rarity);
    expect(equipmentRewardEffect(definition, listing.stars!, 30)).toBe(formatEquipmentStats(expected));
    await market.buy(f.profile.id, { listingKey: listing.key, quantity: 1 });
    const unmigrated = (await f.db.equipmentInstances.where('profileId').equals(f.profile.id).toArray()).find((entry) => entry.baseId === listing.refId)!;
    const originalQuote = (await market.view(f.profile.id)).sellEquipment.find((entry) => entry.instanceId === unmigrated.id)!.price;
    const snapshot = await f.game.snapshot(f.profile.id);
    const item = snapshot.equipment.find((entry) => entry.baseId === listing.refId)!;
    expect(item).toMatchObject({ itemLevel: 30, equipmentRulesVersion: 1, stats: expected });
    const sell = (await market.view(f.profile.id)).sellEquipment.find((entry) => entry.instanceId === item.id)!;
    expect(sell.price).toBe(originalQuote);
    await market.sellEquipment(f.profile.id, item.id);
    expect((await f.db.playerStates.get(f.profile.id))!.gold).toBe(100_000 - listing.price + originalQuote);
    expect(await f.db.equipmentInstances.get(item.id)).toBeUndefined();
  });

  it('战斗中不能以装备合成绕过装备配置锁，已装备物品和金币保持原状', async () => {
    const f = await setup();
    for (let i = 0; i < 3; i++) await f.db.equipmentInstances.add({
      id: 'guard-gear:' + i, profileId: f.profile.id, baseId: 'eq_iron_sword',
      name: '铁剑', slot: 'weapon', rarity: 'common', stars: 1,
      stats: { attack: 3 }, description: '攻击+3', updatedAt: Date.now(),
    });
    await f.db.equipmentLoadouts.update(f.profile.id, { weaponId: 'guard-gear:0' });
    await start(f);
    const before = await f.game.snapshot(f.profile.id);
    await expect(f.game.execute(f.profile.id, {
      id: 'craft-during-battle', type: 'craft.equipment',
      payload: { baseId: 'eq_iron_sword', stars: 1 },
    })).rejects.toThrow(/战斗/);
    const after = await f.game.snapshot(f.profile.id);
    expect(after.equipment).toEqual(before.equipment);
    expect(after.loadout).toEqual(before.loadout);
    expect(after.player.gold).toBe(before.player.gold);
    expect(await f.db.commandInbox.get('craft-during-battle')).toBeUndefined();
  });

  it('玩家同批次升级后装备预览更新但库存价格不刷新，购买落地与新预览等级相同', async () => {
    const f = await setup('merchant');
    await f.db.playerStates.update(f.profile.id, { level: 30, gold: 100_000 });
    const market = new MarketRepository(f.db, () => new Date(2026, 6, 30, 16, 30));
    const before = (await market.view(f.profile.id)).listings.find((entry) => entry.kind === 'equipment')!;
    expect(before).toBeDefined();
    await f.db.playerStates.update(f.profile.id, { level: 60 });
    const after = (await market.view(f.profile.id)).listings.find((entry) => entry.key === before.key)!;
    expect(after).toMatchObject({ key: before.key, stock: before.stock, price: before.price, stars: before.stars });
    expect(after.detail).not.toBe(before.detail);
    await market.buy(f.profile.id, { listingKey: after.key, quantity: 1 });
    const item = (await f.game.snapshot(f.profile.id)).equipment.find((entry) => entry.baseId === after.refId)!;
    const definition = (await loadEquipmentDefinitions())[after.refId!]!;
    expect(item).toMatchObject({ itemLevel: 60, equipmentRulesVersion: 1 });
    expect(item.stats).toEqual(scaleReworkEquipment(definition.stats, after.stars!, 60, definition.rarity));
  });

  it('死亡结算保持 ended 阶段、保留外部金币并只结算一次30%安慰奖励', async () => {
    const f = await setup();
    const session = await start(f);
    const core = hydrate(session.state.rework);
    syncExternal(core, session.state);
    core.player.hp = 1;
    core.player.shield = 0;
    core.player.stats.speed = 1;
    core.player.stats.defense = 0;
    for (const enemy of core.enemies) { enemy.stats.speed = 1_000; enemy.stats.crit = 0; }
    project(core, session.state);
    await f.db.battleSessions.put(session);
    await f.game.execute(f.profile.id, { id: 'defeat-wallet-change', type: 'player.update', payload: { gold: 9_500 } });
    await endTurn(f, session, 'defeat-round');
    const after = await current(f, session);
    expect(after.state).toMatchObject({ status: 'defeat', phase: 'ended', rewards: { gold: 15, experience: 0, items: [] } });
    expect(after.phase).toBe('ended');
    const player = (await f.db.playerStates.get(f.profile.id))!;
    expect(player.gold).toBe(9_515);
    expect(player.hp).toBe(Math.max(1, Math.round(player.hpMax * 0.3)));
    expect((await endTurn(f, session, 'defeat-round')).status).toBe('duplicate');
    await expect(endTurn(f, session, 'defeat-round-repeat')).rejects.toThrow(/结束/);
    expect((await f.db.playerStates.get(f.profile.id))!.gold).toBe(9_515);
    expect(await f.db.battleRewards.where('battleId').equals(session.id).count()).toBe(1);
  });

});
