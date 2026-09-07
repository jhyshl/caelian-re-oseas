import { afterEach, describe, expect, it } from 'vitest';
import { buildWorkshopTestAttributes, workshopAttributePointCost, WORKSHOP_TEST_ATTRIBUTE_BUDGET } from '@/battle/rework/workshop-attributes';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { saveWorkshopPack } from '@/workshop';
import { hydrate } from '@/battle/rework/runtime/api.mjs';

const databases: CaelianDatabase[] = [];
afterEach(async () => {
  localStorage.clear();
  await Promise.all(databases.splice(0).map(async (db) => { db.close(); await db.delete(); }));
});
const zero = { hpMax: 0, attack: 0, defense: 0, speed: 0, actionPointsPerTurn: 0 };
async function fixture() {
  const cards = Array.from({ length: 8 }, (_, i) => ({ id: `custom_attribute_probe_${i}`, name: `属性试验 ${i}`, type: 'attack', cost: 1, effects: [{ type: 'damage', value: 123456, target: 'enemy' }] }));
  saveWorkshopPack({ format: 'caelian_workshop_class_pack', version: 1, packName: '八属性测试', classes: [{ id: 'custom_class_attribute_probe', main: 'freelance', name: '八属性测试', talent: { name: '无天赋', description: '独立测试', effects: [] }, cards, cardPool: [...cards, ...cards].map(c => c.id), starterDeck: Array.from({ length: 15 }, (_, i) => cards[i % 8]!.id) }] });
  const db = new CaelianDatabase('alpha', `workshop-attributes-${crypto.randomUUID()}`); databases.push(db);
  const game = new GameRepository(db, new EventBus(), { random: () => 0.5 });
  const profile = await game.ensureProfile(`chat:${crypto.randomUUID()}`);
  expect((await game.execute(profile.id, { id: 'create', type: 'player.create', payload: { name: '属性测试', classMain: 'knight', subclass: 'holy_knight' } })).status).toBe('applied');
  await db.playerStates.update(profile.id, { hp: 11, critRate: 99, critDamage: 230, effectHit: 78, effectResist: 76, statPoints: 33, gold: 1234 });
  const before = await db.playerStates.get(profile.id);
  const start = (attributes: Record<string, number>, id = 'start') => game.execute(profile.id, { id, type: 'battle.start', payload: { workshopTest: { professionId: 'custom_class_attribute_probe', mechanismIds: [], dummyCount: 1, dummyHp: 1_000_000, dummyAttack: 0, dummyDefense: 0, dummyInvincible: false, dummyAttackEnabled: false, autoRespawn: false, playerInvincible: false, attributes: { ...zero, ...attributes } } } });
  return { db, game, profile, before, start };
}

describe('工坊测试场使用正式八属性成长与990点预算', () => {
  it('AP第5次是2点、第6次是3点，抽牌每次5点；默认配置正好990点', () => {
    expect(workshopAttributePointCost({ actionPointsPerTurn: 5 })).toBe(10);
    expect(workshopAttributePointCost({ actionPointsPerTurn: 6 })).toBe(13);
    expect(workshopAttributePointCost({ drawPerTurn: 2 })).toBe(10);
    const result = buildWorkshopTestAttributes({ hpMax: 320, attack: 220, defense: 120, speed: 60, critRate: 70, critDamage: 100, effectHit: 40, effectResist: 40, actionPointsPerTurn: 5, drawPerTurn: 2 });
    expect(result.spent).toBe(WORKSHOP_TEST_ATTRIBUTE_BUDGET);
    expect(result.remaining).toBe(0);
  });
  it.each([
    { critRate: 96 }, { critDamage: 101 }, { effectHit: 41 }, { effectResist: 41 }, { drawPerTurn: 3 },
    { hpMax: 991 }, { hpMax: 0.5 }, { attack: -1 }, { defense: Number.NaN },
  ])('拒绝无效投入而不悄悄消耗点数：%j', (attributes) => {
    expect(() => buildWorkshopTestAttributes(attributes)).toThrow();
  });
  it('满上限允许且不会超出面板；331次AP仍在点数预算内', () => {
    expect(buildWorkshopTestAttributes({ critRate: 95, critDamage: 100, effectHit: 40, effectResist: 40, drawPerTurn: 2 }).attributes).toMatchObject({ critRate: 100, critDamage: 250, effectHit: 80, effectResist: 80, drawPerTurn: 5 });
    expect(buildWorkshopTestAttributes({ actionPointsPerTurn: 331 })).toMatchObject({ attributes: { actionPointsPerTurn: 336 }, spent: 988, remaining: 2 });
    expect(() => buildWorkshopTestAttributes({ actionPointsPerTurn: 332 })).toThrow(/990/);
  });
  it('通过真实指令创建独立Lv100测试角色，八属性及AP/抽牌准确且不改存档', async () => {
    const f = await fixture();
    const result = await f.start({ hpMax: 3, attack: 4, defense: 5, speed: 6, critRate: 7, critDamage: 8, effectHit: 9, effectResist: 10, actionPointsPerTurn: 6, drawPerTurn: 2 });
    expect(result.status, JSON.stringify(result)).toBe('applied');
    const battle = (await f.db.battleSessions.where('profileId').equals(f.profile.id).first())!;
    expect(battle.state.player).toMatchObject({ hp: 2310, hpMax: 2310, attack: 345, defense: 253, speed: 106, critRate: 12, critDamage: 66, effectHit: 18, effectResist: 20, ap: 11, apMax: 11, drawPerTurn: 5, lifesteal: 0 });
    expect(hydrate(battle.state.rework).player.level).toBe(100);
    expect(battle.state.workshopTest).toMatchObject({ attributeBudget: 990, attributeSpent: 75 });
    expect(await f.db.playerStates.get(f.profile.id)).toEqual(f.before);
  });
  it('旧mp/吸血请求可读，角色不继承存档双暴命抗，抽牌从3张开始', async () => {
    const f = await fixture();
    expect((await f.start({ mpMax: 990, lifesteal: 30 })).status).toBe('applied');
    const battle = (await f.db.battleSessions.where('profileId').equals(f.profile.id).first())!;
    expect(battle.state.player).toMatchObject({ hpMax: 2280, attack: 337, defense: 228, speed: 100, critRate: 5, critDamage: 50, effectHit: 0, effectResist: 0, apMax: 5, drawPerTurn: 3, mp: 30, mpMax: 30, lifesteal: 0 });
    expect(await f.db.playerStates.get(f.profile.id)).toEqual(f.before);
  });
  it('合法字段合计超990也会原子拒绝，无战斗或指令收据残留', async () => {
    const f = await fixture();
    await expect(f.start({ hpMax: 990, attack: 1 }, 'overspent')).rejects.toThrow(/990/);
    expect(await f.db.battleSessions.where('profileId').equals(f.profile.id).count()).toBe(0);
    expect(await f.db.commandInbox.get('overspent')).toBeUndefined();
    expect(await f.db.playerStates.get(f.profile.id)).toEqual(f.before);
  });
});
