import { it } from 'vitest';
import assert from 'node:assert/strict';
import { actor, makeGame, catalog } from '@/battle/rework/runtime/physics.mjs';
import * as api from '@/battle/rework/runtime/api.mjs';
import { installWorkshopDamageHooks, damageOnLiveCore } from '@/battle/rework/runtime/workshop-runtime-hooks.mjs';
import { playCardTransaction, chooseCardTransaction } from '@/battle/rework/runtime/rework-card-transaction.mjs';
it('工坊伤害与选择事务端口', () => {
    function game() { const p: any = actor('player', 'player', 20, { hp: 1000, attack: 100, defense: 50, speed: 100, crit: 0, critDamage: 50, ehr: 0, res: 0 }), enemy: any = actor('enemy', 'enemy', 20, { hp: 10000, attack: 100, defense: 100, speed: 100, crit: 0, critDamage: 50, ehr: 0, res: 0 }); p.star = 3; const g: any = makeGame(p, [enemy], { seed: 4 }); g.beginAction(p, { id: 'sample' }); g.action.outputScale = .7; return g; }
    const baseline: any = game(), test: any = game(), events: any = [], effect: any = { kind: 'damage', flat: 20, atk: .5, hits: 3, crit: false }, options: any = { forceHit: true, scale: .48 };
    const expected: any = baseline.damage(baseline.player, baseline.enemies[0], effect, options);
    installWorkshopDamageHooks(test, { currentCard: () => ({ id: 'sample', name: 'sample', type: 'attack', tags: [] }), emit: (trigger: any, event: any) => { events.push({ trigger, ...event }); if (trigger === 'before_damage')
            event.amount *= 2; return event; } });
    const result: any = test.damage(test.player, test.enemies[0], effect, options);
    assert(Math.abs(result.hpDamage - expected.hpDamage * 2) < 1e-9, 'stars/group/action/DEF must each apply once');
    assert.equal(events.length, 2);
    assert.equal(events[0].trigger, 'before_damage');
    assert.equal(events[1].trigger, 'enemy_damaged');
    assert.equal(events[1].amount, result.hpDamage);
    const cancelled: any = game(), beforeHP: any = cancelled.enemies[0].hp;
    installWorkshopDamageHooks(cancelled, { emit: (trigger: any, event: any) => trigger === 'before_damage' ? { ...event, cancel: true } : event });
    const zero: any = cancelled.damage(cancelled.player, cancelled.enemies[0], effect, options);
    assert.equal(zero.hpDamage, 0);
    assert.equal(cancelled.enemies[0].hp, beforeHP);
    assert.equal(cancelled.action.hitCache.get('player>enemy'), false);
    const nested: any = game(), parent: any = nested.action;
    damageOnLiveCore(nested, 'player', 'enemy', 10, 'nested', { crit: false, secondary: true });
    assert.equal(nested.action, parent);
    assert.equal(nested.action.outputScale, .7);
    const card: any = catalog.cards.find((c: any) => c.profession === 'astrologer' && c.effects.some((e: any) => e.action === 'discover'));
    assert(card, 'astrologer discovery card');
    const monster: any = catalog.monsters[0];
    let state: any = { schemaVersion: 1, status: 'ongoing', phase: 'player', turn: 1, selectedTarget: 0, rewards: null, log: [], animations: [], workshopMechanisms: { ids: [], resources: { token: 0 }, fired: [] }, player: { name: '审计', subclass: 'astrologer', hp: 1000, hpMax: 1000, mp: 0, mpMax: 0, shield: 0, attack: 100, defense: 70, speed: 100, critRate: 25, critDamage: 100, effectHit: 20, effectResist: 20, ap: 10, apMax: 10, initialDraw: 5, drawPerTurn: 5, handLimit: 10, hand: [], drawPile: Array.from({ length: 8 }, (_: any, i: any) => ({ instanceId: 'c' + i, cardId: card.id })), discardPile: [], buffs: {}, debuffs: {}, summons: [], chants: [], gold: 1000 }, enemies: [{ id: 'enemy', definitionId: monster.id, name: monster.name, hp: 100, hpMax: 100, attack: 50, defense: 50, speed: 100, shield: 0, gold: [10, 20], buffs: {}, debuffs: {}, intent: null }] };
    const core: any = api.create(state, { level: 20, explicit: true, seed: 10 });
    api.project(core, state);
    let beforeCalls: any = 0, afterCalls: any = 0;
    const ports: any = { before: (draft: any) => { beforeCalls++; draft.player.shield += 7; draft.workshopMechanisms.resources.token++; return { cardId: card.id }; }, play: (draft: any, request: any) => api.play(draft, request.index, request.targetIndex, request.answers), after: (draft: any) => { afterCalls++; draft.player.shield += 3; api.sync(draft); } };
    const oldAP: any = state.player.ap;
    const pending: any = playCardTransaction(state, { index: 0, targetIndex: 0 }, ports);
    assert.equal(pending.pending, true);
    assert.equal(beforeCalls, 1);
    assert.equal(afterCalls, 0);
    assert.equal(state.player.shield, 0);
    assert.equal(state.workshopMechanisms.resources.token, 0);
    assert.equal(state.player.ap, oldAP);
    state = JSON.parse(JSON.stringify(state));
    let steps: any = 0;
    while (state.player.pendingCardChoice) {
        assert(++steps < 20);
        const d: any = state.player.pendingCardChoice;
        chooseCardTransaction(state, d.choices.findIndex((_: any, i: any) => !d.picked.includes(i)), false, ports);
        state = JSON.parse(JSON.stringify(state));
    }
    assert.equal(beforeCalls, 1);
    assert.equal(afterCalls, 1);
    assert.equal(state.player.shield, 10);
    assert.equal(state.workshopMechanisms.resources.token, 1);
    assert.equal(state.player.ap, oldAP - card.ap);
    assert(!state.reworkTransaction);
});
