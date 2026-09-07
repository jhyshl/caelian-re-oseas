import { it } from 'vitest';
import assert from 'node:assert/strict';
import { actor, makeGame } from '@/battle/rework/runtime/physics.mjs';
import { snapshot, hydrate } from '@/battle/rework/runtime/api.mjs';
import { installWorkshopStatusHooks, workshopNativeStatusValue } from '@/battle/rework/runtime/workshop-status-hooks.mjs';
it('工坊自定义状态原生端口', () => {
    const guard: any = 'workshop_status:test:guard', rot: any = 'workshop_status:test:rot';
    const manifests: any = [{ id: 'test', statuses: [{ id: 'guard', polarity: 'buff', effects: [{ type: 'damage_bonus', value: 50 }, { type: 'damage_reduction', value: 25 }, { type: 'debuff_immunity', value: 1 }, { type: 'turn_heal', value: 5 }, { type: 'turn_shield', value: 4 }] }, { id: 'rot', polarity: 'debuff', effects: [{ type: 'turn_damage', value: 3 }] }] }];
    function setup() { const p: any = actor('player', 'player', 20, { hp: 1000, attack: 100, defense: 0, speed: 100, crit: 100, critDamage: 250, ehr: 0, res: 0 }), e: any = actor('enemy', 'enemy', 20, { hp: 1000, attack: 100, defense: 0, speed: 100, crit: 100, critDamage: 250, ehr: 0, res: 0 }); p.profession = 'holy_knight'; const g: any = makeGame(p, [e], { seed: 1, trace: true }); g.round = 1; p.phaseCount = 1; e.phaseCount = 1; return g; }
    function ports(events: any = []) { return { value: (a: any, t: any) => workshopNativeStatusValue(a, t, manifests, ['test']), emit: (t: any, e: any) => { events.push(t); return e; } }; }
    const g: any = setup(), p: any = g.player, e: any = g.enemies[0];
    // Existing legacy imports: the repository already handled immunity; don't fire a second hook.
    g.addStatus(p, p, { kind: 'buff', status: guard, value: 2, turns: 3 }, { skipEffectRoll: true });
    g.addStatus(e, p, { kind: 'debuff', status: rot, value: 2, turns: 3 }, { skipEffectRoll: true });
    const events: any = [];
    installWorkshopStatusHooks(g, ports(events));
    assert.equal(g.directBonus(p, e), 1);
    assert.equal(g.incomingReduction(p), .5);
    g.beginAction(p, { id: 'check' });
    const out: any = g.damage(p, e, { kind: 'damage', flat: 100, atk: 0, crit: false }, { forceHit: true });
    assert.equal(out.damage, 160);
    g.endAction();
    assert.equal(g.addStatus(e, p, { kind: 'debuff', status: 'weak', value: .2, turns: 2, baseChance: 100 }), false);
    assert.equal(g.addDot(e, p, { kind: 'dot', status: 'poison', atk: 2, baseChance: 100 }), false);
    assert.equal(events.length, 2);
    p.hp = 50;
    p.shield = 0;
    g.round = 2;
    g.beginPhase(p);
    assert.equal(p.hp, 54);
    assert.equal(p.shield, 8);
    assert.equal(p.buffs.find((x: any) => x.status === guard).expireAtPhase, 4);
    // Original native timers remain responsible for expiry, and custom direct bonuses obey 60% caps.
    g.addStatus(p, p, { kind: 'buff', status: 'direct_damage_reduction', value: .5, valueUnit: 'ratio', turns: 2 });
    assert.equal(g.incomingReduction(p), .6);
    // Sources stack independently rather than silently selecting only the strongest custom status.
    g.addStatus(e, p, { kind: 'buff', status: guard, value: 1, turns: 2 }, { skipEffectRoll: true });
    assert.equal(workshopNativeStatusValue(p, 'turn_heal', manifests, ['test']), 15);
    const before: any = events.length;
    g.addStatus(e, e, { kind: 'debuff', status: 'workshop_status:test:rot', value: 1, turns: 2, legacy: true }, { skipEffectRoll: true });
    assert.equal(events.length, before);
    // Persisted phase state and original source graph survive JSON; reattach callbacks on hydrate.
    p.flags.pc = { catalog: new Map(), extraAP: 0 };
    const restored: any = hydrate(JSON.parse(JSON.stringify(snapshot(g))));
    installWorkshopStatusHooks(restored, ports());
    assert.equal(workshopNativeStatusValue(restored.player, 'damage_bonus', manifests, ['test']), 150);
    restored.critRng = () => { throw Error('DOT must not crit'); };
    restored.enemies[0].dots.push({ sourceActor: restored.player, sourceId: 'player', sourceLevel: 20, snapshotDamage: 10, remaining: 1, firstTickPhase: 1, canonicalStatus: 'poison' });
    const hp: any = restored.enemies[0].hp;
    restored.endPhase(restored.enemies[0]);
    assert.equal(hp - restored.enemies[0].hp, 10);
});
