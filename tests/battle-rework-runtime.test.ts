import { describe, expect, it } from 'vitest';
import assert from 'node:assert/strict';
import * as api from '@/battle/rework/runtime/api.mjs';
import rawCatalog from '@/battle/rework/catalog.json';

type Card = { id: string; name: string; profession: string; ap: number; effects: any[]; [key: string]: any };
type Profession = { id: string; name: string; baseStatsProposal: Record<string, any> };
const catalog = rawCatalog as unknown as { cards: Card[]; professions: Profession[]; monsters: any[]; bosses: any[] };
const cardMap = new Map(catalog.cards.map((card) => [card.id, card]));
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const walk = (effects: any[]): any[] => effects.flatMap((effect) => [effect, ...walk(effect.effects ?? []), ...walk(effect.entry ?? []), ...walk(effect.options ?? []), ...(effect.skills ?? []).flatMap((skill: any) => walk(skill.effects ?? []))]);

/** Deterministic legal point allocation; this fixture is not a balance policy or win-rate assertion. */
function playerStats(profession: Profession, level: number) {
  const base = profession.baseStatsProposal;
  const multiplier = (key: string) => Number(String(base[key]).match(/\*([0-9.]+)$/)?.[1] ?? 1);
  const stats: Record<string, number> = { hp: Math.round((300 + 20 * (level - 1)) * multiplier('hp')), attack: Math.round((40 + 3 * (level - 1)) * multiplier('attack')), defense: Math.round((30 + 2 * (level - 1)) * multiplier('defense')), speed: base.speed, crit: 5, critDamage: 50, ehr: 0, res: 0, ap: 5, draw: 3 };
  let points = 10 * (level - 1);
  while (points >= 5 && stats.draw! < 5) { stats.draw!++; points -= 5; }
  while (points >= 2 && stats.ap! < 8) { stats.ap!++; points -= 2; }
  const order = ['hp', 'defense', 'attack', 'attack', 'speed', 'crit', 'ehr', 'res'];
  const gains: Record<string, number> = { hp: 10, defense: 5, attack: 2, speed: 1, crit: 1, ehr: 2, res: 2 };
  const caps: Record<string, number> = { crit: 100, ehr: 80, res: 80 };
  let index = 0;
  while (points > 0) { let key = order[index++ % order.length]!; if (stats[key]! >= (caps[key] ?? Infinity)) key = 'attack'; stats[key]! += gains[key]!; points--; }
  return stats;
}

function createFixture(professionId: string, level = 20, enemyIds?: string[], deckIds?: string[], seed = 42) {
  const profession = catalog.professions.find((entry) => entry.id === professionId)!;
  const stats = playerStats(profession, level);
  const cards = deckIds ?? catalog.cards.filter((card) => card.profession === professionId && card.id !== 'mg_blank_card').map((card) => card.id);
  const state: any = { schemaVersion: 1, status: 'ongoing', phase: 'player', turn: 1, selectedTarget: 0, rewards: null, log: [], animations: [],
    player: { name: '运行时测试角色', subclass: professionId, hp: stats.hp, hpMax: stats.hp, mp: 0, mpMax: 0, shield: 0, attack: stats.attack, defense: stats.defense, speed: stats.speed, critRate: stats.crit, critDamage: stats.critDamage, effectHit: stats.ehr, effectResist: stats.res, ap: stats.ap, apMax: stats.ap, initialDraw: 5, drawPerTurn: stats.draw, handLimit: 10, drawPile: cards.map((id, i) => ({ instanceId: `owned:${i}`, cardId: id })), discardPile: [], hand: [], buffs: {}, debuffs: {}, summons: [], chants: [], gold: 10000, classResources: {} },
    enemies: (enemyIds ?? [catalog.monsters[0]!.id]).map((id, index) => ({ id: `enemy:${index}`, definitionId: id, name: id, level, hp: 100, hpMax: 100, shield: 0, attack: 50, defense: 50, speed: 100, difficulty: 'normal', tags: [], xp: 1, gold: [10, 20], loot: [], buffs: {}, debuffs: {}, intent: null })),
  };
  const game = api.create(state, { level, explicit: true, seed, stars: Object.fromEntries(catalog.cards.map((card) => [card.id, 2])) });
  return { state, game };
}
function resolveChoices(state: any) {
  let steps = 0;
  while (state.player.pendingCardChoice) {
    assert(++steps <= 30, 'manual choice loop exceeded');
    const display = state.player.pendingCardChoice;
    if (display.picked.length >= (display.min ?? display.pick) && (display.min ?? display.pick) < display.pick) { api.choose(state, 0, true); continue; }
    const index = display.choices.findIndex((_: any, i: number) => !display.picked.includes(i));
    assert(index >= 0, 'no legal manual choice');
    api.choose(state, index);
  }
}
function finiteState(state: any) {
  for (const actor of [state.player, ...state.enemies]) for (const field of ['hp', 'hpMax', 'shield', 'attack', 'defense', 'speed']) expect(Number.isFinite(actor[field]), `${actor.id ?? 'player'}.${field}`).toBe(true);
  expect(state.player.ap).toBeGreaterThanOrEqual(0);
}
function advanceTurn(game: any, restoreBetweenPhases = false) {
  api.endPlayer(game);
  if (restoreBetweenPhases) game = api.hydrate(json(api.snapshot(game)));
  api.enemiesTurn(game);
  if (restoreBetweenPhases) game = api.hydrate(json(api.snapshot(game)));
  api.nextTurn(game);
  return game;
}
function primeCard(card: Card) {
  const profession = card.profession === 'common' ? 'merchant' : card.profession;
  const { state, game } = createFixture(profession, 20, undefined, undefined, 9001);
  const player = game.player, runtime = player.flags.pc;
  player.ap = 50; player.apMax = 50; player.hp = player.maxHp * .55; player.shield = player.maxHp * .1; player.gold = 100000;
  const fillers = catalog.cards.filter((entry) => entry.profession === profession && entry.id !== card.id && entry.id !== 'mg_blank_card').slice(0, 5);
  player.hand = [card, ...fillers].map((entry, index) => ({ ...structuredClone(entry), star: 2, uid: `audit-card:${index}` }));
  player.deck = fillers.map((entry, index) => ({ ...structuredClone(entry), star: 2, uid: `audit-deck:${index}` }));
  player.discard = fillers.map((entry, index) => ({ ...structuredClone(entry), star: 2, uid: `audit-discard:${index}` }));
  if (card.id === 'mg_truth_revealed') player.hand.push({ ...structuredClone(cardMap.get('mg_blank_card')!), uid: 'audit-blank', star: 1 });
  for (const key of Object.keys(player.resources)) player.resources[key] = player.resourceCaps?.[key] ?? runtime.resourceCaps[key] ?? 100;
  for (const effect of walk(card.effects)) if (effect.resource && String(effect.resource).toLowerCase() !== 'ap') player.resources[effect.resource] = player.resourceCaps?.[effect.resource] ?? runtime.resourceCaps[effect.resource] ?? 100;
  for (const enemy of game.enemies) {
    enemy.hp = enemy.maxHp * .7;
    game.addStatus(player, enemy, { kind: 'debuff', status: '虚弱', canonicalStatus: 'weak', value: .1, valueUnit: 'ratio', turns: 2 }, { skipEffectRoll: true });
    game.addStatus(enemy, enemy, { kind: 'buff', status: '攻击力增加', canonicalStatus: 'attack_up', value: .1, valueUnit: 'ratio', turns: 2 }, { skipEffectRoll: true });
    game.addDot(player, enemy, { kind: 'dot', status: '中毒', canonicalStatus: 'poison', atk: .1, baseChance: 100 });
    game.addDot(player, enemy, { kind: 'dot', status: '灼烧', canonicalStatus: 'burn', atk: .1, baseChance: 100 });
  }
  if (player.flags.mage) Object.assign(player.flags.mage, { elementsThisRound: new Set(['火', '冰']), burnApplied: true, enemyKilledSummons: 1, echoBatches: [{ amount: player.resources['深渊回声'] ?? 0, expiresAfterRound: 2 }] });
  if (profession === 'arcane_mage') player.chants = [{ id: 'audit-chant', cardId: 'ar_audit', remaining: 2, bornRound: 0, advancedRound: null, targetId: game.enemies[0].id, effects: [{ kind: 'damage', flat: 20, atk: 1, target: 'enemy', hits: 1, crit: true }], snapshot: { attack: player.stats.attack, crit: player.stats.crit, critDamage: player.stats.critDamage }, star: 2, scalar: 1, copy: false }];
  const needsSummon = walk(card.effects).some((effect) => /召唤|summon/.test(String(effect.action ?? ''))) || ['summoner', 'mechanic', 'blacksmith'].includes(profession);
  if (needsSummon && card.id !== 'wood_seed_rebirth') {
    const summon = walk(catalog.cards.filter((entry) => entry.profession === profession).flatMap((entry) => entry.effects)).find((effect) => effect.kind === 'summon') ?? walk(cardMap.get('hk_sun_banner')!.effects).find((effect) => effect.kind === 'summon');
    game.controller.makeContext(game, card, game.enemies[0]).summon(summon);
  }
  api.project(game, state);
  return state;
}

describe('重置战斗核心：目录覆盖、手动操作与JSON恢复', () => {
  it('保留嵌套action/events、Map/Set、Infinity与actor引用身份', () => {
    const player: any = { id: 'player', flags: { events: { once: true } }, effects: [{ kind: 'utility', action: 'cleanse' }], set: new Set(['fire']), map: new Map([['q', 2]]), infinite: Infinity };
    player.self = player;
    const restored = api.decode(json(api.encode({ player, allies: [player], events: [], action: null })));
    expect(restored.player.effects[0].action).toBe('cleanse'); expect(restored.player.flags.events).toEqual({ once: true });
    expect(restored.player.self).toBe(restored.player); expect(restored.allies[0]).toBe(restored.player); expect(restored.player.set).toBeInstanceOf(Set); expect(restored.player.map).toBeInstanceOf(Map); expect(restored.player.infinite).toBe(Infinity);
  });
  it('正式运行时目录包含25职业、546卡，并采用六卡最终调整值', () => {
    expect(catalog.professions).toHaveLength(25); expect(catalog.cards).toHaveLength(546);
    for (const [id, index, flat, coefficient] of [['ap_bitter_toxin', 0, 20, .4], ['ap_needle_injection', 0, 25, .75], ['pr_smite', 0, 30, .9], ['pr_judgement', 0, 55, 1.65], ['mg_smoke_and_mirrors', 1, 20, .65]] as const) {
      const effect = cardMap.get(id)!.effects[index]; expect(effect.flat, id).toBe(flat); expect(effect.atk ?? effect.def, id).toBe(coefficient);
    }
    expect(cardMap.get('pr_sacred_ground')!.effects[0].ticks).toBe(2);
  });
  it.each(catalog.professions)('$name：1/20/60级正常手动出牌，逐阶段JSON恢复结果相同', (profession) => {
    for (const level of [1, 20, 60]) {
      const enemies = level === 1 ? [catalog.monsters[0].id] : catalog.monsters.filter((enemy) => enemy.tier === 'normal').slice(0, 3).map((enemy) => enemy.id);
      const { state: left, game: initial } = createFixture(profession.id, level, enemies, undefined, 123 + level);
      api.project(initial, left); let right = json(left);
      for (let round = 0; round < 5; round++) {
        for (let action = 0; action < 8; action++) {
          const index = left.player.hand.findIndex((card: any) => left.reworkCards[card.instanceId]?.available && left.reworkCards[card.instanceId]?.cost !== null);
          if (index < 0) break;
          api.play(left, index, 0); resolveChoices(left); api.play(right, index, 0); resolveChoices(right); right = json(right);
          expect(json(left.rework)).toEqual(json(right.rework)); finiteState(left);
          if (left.player.hp <= 0 || left.enemies.every((enemy: any) => enemy.hp <= 0)) break;
        }
        if (left.player.hp <= 0 || left.enemies.every((enemy: any) => enemy.hp <= 0)) break;
        let continuous = api.hydrate(left.rework), restored = api.hydrate(right.rework);
        api.syncExternal(continuous, left); api.syncExternal(restored, right);
        continuous = advanceTurn(continuous); restored = advanceTurn(restored, true);
        assert.deepStrictEqual(api.decode(json(api.snapshot(continuous))), api.decode(json(api.snapshot(restored))));
        api.project(continuous, left); api.project(restored, right); right = json(right); finiteState(left);
      }
    }
  });
  it.each(catalog.cards)('$id：满足真实机制前置后可执行，并可恢复后继续一轮', (card) => {
    const state = primeCard(card), available = state.reworkCards[state.player.hand[0].instanceId]?.available;
    if (card.id === 'mg_blank_card') { expect(available).toBe(false); return; }
    expect(available, '测试前置已提供资源、目标状态、弃牌、吟诵或召唤物；不能用跳过掩盖未覆盖').toBe(true);
    expect(api.play(state, 0, 0)).toBe(true); resolveChoices(state); finiteState(state);
    const restored = api.hydrate(json(state.rework)); api.endPlayer(restored); api.enemiesTurn(restored); api.nextTurn(restored); api.project(restored, state); finiteState(state);
  });
  it.each(catalog.bosses)('$id：创建、三轮行动与JSON恢复可完成', (boss) => {
    const { state, game } = createFixture('holy_knight', 20, [boss.id]); api.project(game, state);
    let current = api.hydrate(json(state.rework));
    for (let round = 0; round < 3; round++) { current = advanceTurn(current, true); if (current.player.hp <= 0) break; }
    api.project(current, state); finiteState(state);
  });
  it('三目标三段群攻进行九次独立暴击判定，总倍率不逐段复制', () => {
    const ids = catalog.monsters.filter((enemy) => enemy.tier === 'normal').slice(0, 3).map((enemy) => enemy.id);
    const { game } = createFixture('holy_knight', 20, ids); game.player.stats.crit = 50; game.player.stats.critDamage = 100; game.player.star = 1;
    let rolls = 0; game.critRng = () => ++rolls % 2 ? .1 : .9;
    game.beginAction(game.player, { id: 'independent-critical' });
    const result = game.applyEffects([{ kind: 'damage', flat: 90, atk: 0, hits: 3, target: 'all_enemies', crit: true }], game.player, game.enemies[0], { forceHit: true, ignoreDefense: 1 });
    expect(rolls).toBe(9); expect(result.crits).toBe(5); expect(result.damage).toBeCloseTo(280, 8);
  });
  it('DOT快照不吃双暴、直接增伤与易伤，仍计算目标防御', () => {
    const { game } = createFixture('holy_knight'); const player = game.player, target = game.enemies[0];
    player.stats.attack = 100; player.stats.crit = 100; player.stats.critDamage = 250; player.star = 1; target.stats.defense = 100; target.stats.res = 0; target.hp = 1000; target.maxHp = 1000;
    game.addStatus(player, player, { kind: 'buff', status: 'direct_damage_up', value: .6, valueUnit: 'ratio', turns: 3 }, { skipEffectRoll: true });
    game.addStatus(player, target, { kind: 'debuff', status: 'vulnerable', value: .4, valueUnit: 'ratio', turns: 3 }, { skipEffectRoll: true });
    game.effectRng = () => 0; game.critRng = () => { throw Error('DOT不得调用暴击随机数'); };
    expect(game.addDot(player, target, { kind: 'dot', status: 'poison', atk: .5, baseChance: 100 })).toBe(true);
    player.stats.attack = 999; const before = target.hp; game.beginPhase(target); game.endPhase(target);
    expect(before - target.hp).toBeCloseTo(50 * 200 / 300, 8);
  });
});
