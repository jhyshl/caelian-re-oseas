import { afterEach, describe, expect, it } from 'vitest';
import type { CommandResult } from '@/domain/commands';
import type { GameSnapshot, LocalBattleState } from '@/domain/types';
import {
  activateAssessedWorkshopTestPack,
  assessWorkshopProfession,
  readWorkshopAssessment,
} from '@/workshop-assessment';
import {
  WORKSHOP_TEST_STORAGE_KEY,
  normalizeWorkshopClass,
  readWorkshopPacks,
  readWorkshopTestCandidate,
  saveWorkshopPack,
  saveWorkshopTestPack,
  type WorkshopClass,
} from '@/workshop';
import { saveWorkshopMechanism } from '@/workshop-mechanisms';
import { workshopCombatFingerprint } from '@/workshop-certification';

type AssessmentApi = Parameters<typeof assessWorkshopProfession>[0];

interface RecordedCommand {
  type: string;
  payload: Record<string, unknown>;
}

interface StartContext {
  index: number;
  source: string;
  workshopTest: Record<string, unknown>;
}

interface AssessmentApiOptions {
  pendingChoice?: boolean;
  failFirstPostStartQuery?: boolean;
  failCancel?: boolean;
  loopingCard?: boolean;
  throwPlayCardError?: string;
}

function deckKeyForTest(cards: readonly string[]): string {
  return [...cards].sort().join('|');
}

function profession(mechanismIds: string[] = []): WorkshopClass {
  const cards = Array.from({ length: 8 }, (_, index) => ({
    id: `custom_assessment_card_${index}`,
    name: `评定卡牌${index + 1}`,
    type: 'attack',
    cost: index === 0 ? 0 : index === 1 ? 10 : 1,
    effects: [{ type: 'damage', value: index + 1, target: 'enemy' }],
  }));
  const starterDeck = [
    ...cards.map((card) => card.id),
    ...cards.slice(0, 7).map((card) => card.id),
  ];
  return normalizeWorkshopClass({
    id: 'custom_class_assessment_contract',
    main: 'freelance',
    name: '自动评定测试职业',
    description: '用于验证自动评定协议。',
    talent: {
      name: '测试天赋',
      description: '没有额外效果。',
      effects: [],
    },
    cards,
    cardPool: [...starterDeck, cards[7]!.id],
    starterDeck,
    mechanismIds,
  });
}

function battleState(
  professionValue: WorkshopClass,
  battleIndex: number,
  enemyCount: number,
  enemyKey: string,
  deckIds: string[],
): LocalBattleState {
  return {
    schemaVersion: 1,
    status: 'ongoing',
    phase: 'player',
    turn: 1,
    selectedTarget: 0,
    player: {
      hp: 100,
      hpMax: 100,
      hand: deckIds.map((cardId, index) => ({
        instanceId: `assessment-card-${battleIndex}-${index}`,
        cardId,
      })),
    },
    enemies: Array.from({ length: enemyCount }, (_, index) => ({
      id: `assessment-enemy-${battleIndex}-${index}`,
      name: `评定怪物 ${enemyKey}-${index + 1}`,
      hp: 10,
      hpMax: 10,
    })),
    rewards: null,
    workshopTest: {
      professionId: professionValue.id,
    },
    log: [],
  } as unknown as LocalBattleState;
}

function assessmentApi(
  professionValue: WorkshopClass,
  shouldWin: (context: StartContext) => boolean,
  options: AssessmentApiOptions = {},
): {
  api: AssessmentApi;
  commands: RecordedCommand[];
  startedEnemyNames: string[][];
} {
  const commands: RecordedCommand[] = [];
  const startedEnemyNames: string[][] = [];
  let currentBattle: GameSnapshot['battle'] = null;
  let currentShouldWin = false;
  let started = 0;
  let failedPostStartQuery = false;
  let queryAfterStart = false;

  const applied = (id: string): CommandResult => ({ id, status: 'applied' });
  const rejected = (id: string): CommandResult => ({
    id,
    status: 'rejected',
    message: '测试桩拒绝本次出牌。',
  });

  const api = {
    async execute(raw: unknown): Promise<CommandResult> {
      const command = raw as {
        id: string;
        type: string;
        payload?: Record<string, unknown>;
      };
      commands.push({ type: command.type, payload: command.payload ?? {} });

      if (command.type === 'battle.start') {
        const workshopTest = command.payload?.workshopTest as
          | Record<string, unknown>
          | undefined;
        const enemyCount =
          workshopTest?.opponentMode === 'random-multi' ? 3 : 1;
        currentShouldWin = shouldWin({
          index: started,
          source: String(command.payload?.source ?? ''),
          workshopTest: workshopTest ?? {},
        });
        const id = `assessment-battle-${started}`;
        currentBattle = {
          id,
          profileId: 'assessment-profile',
          active: true,
          source: '创意工坊自动评定',
          storyTriggered: false,
          relatedQuestId: '',
          turn: 1,
          phase: 'player',
          state: battleState(
            professionValue,
            started,
            enemyCount,
            `${workshopTest?.randomTier}:${workshopTest?.opponentMode}:${workshopTest?.randomSeed}`,
            Array.isArray(workshopTest?.deckIds)
              ? (workshopTest.deckIds as string[])
              : [...professionValue.starterDeck],
          ),
          updatedAt: Date.now(),
        };
        startedEnemyNames.push(
          currentBattle.state.enemies.map((enemy) => enemy.name),
        );
        started += 1;
        queryAfterStart = true;
        return applied(command.id);
      }

      if (!currentBattle) return rejected(command.id);

      if (command.type === 'battle.play-card') {
        if (options.throwPlayCardError) {
          throw new Error(options.throwPlayCardError);
        }
        const handIndex = Number(command.payload?.handIndex ?? -1);
        if (!currentBattle.state.player.hand[handIndex]) return rejected(command.id);
        if (!options.loopingCard) {
          currentBattle.state.player.hand.splice(handIndex, 1);
        }
        if (!currentShouldWin) return applied(command.id);
        if (options.pendingChoice) {
          currentBattle.state.player.pendingCardChoice = {
            type: 'astrology',
            title: '自动评定占星选择',
            choices: [professionValue.cards[0]!.id],
            pick: 1,
            picked: [],
          };
          return applied(command.id);
        }
        currentBattle.state.status = 'victory';
        currentBattle.state.phase = 'ended';
        for (const enemy of currentBattle.state.enemies) enemy.hp = 0;
        return applied(command.id);
      }
      if (command.type === 'battle.choose-astrology-card') {
        const pending = currentBattle.state.player.pendingCardChoice;
        if (!pending || command.payload?.choiceIndex !== 0) {
          return rejected(command.id);
        }
        delete currentBattle.state.player.pendingCardChoice;
        currentBattle.state.status = 'victory';
        currentBattle.state.phase = 'ended';
        for (const enemy of currentBattle.state.enemies) enemy.hp = 0;
        return applied(command.id);
      }
      if (command.type === 'battle.end-turn') {
        currentBattle.state.turn += 1;
        currentBattle.turn = currentBattle.state.turn;
        return applied(command.id);
      }
      if (command.type === 'battle.cancel-workshop-test') {
        if (options.failCancel) throw new Error('模拟取消失败');
        currentBattle.state.status = 'surrendered';
        currentBattle.state.phase = 'ended';
        return applied(command.id);
      }
      if (command.type === 'battle.finish') {
        currentBattle = null;
        return applied(command.id);
      }
      return rejected(command.id);
    },
    async query(name: string): Promise<GameSnapshot> {
      if (name !== 'state') throw new Error(`不支持的测试查询：${name}`);
      if (
        queryAfterStart &&
        options.failFirstPostStartQuery &&
        !failedPostStartQuery
      ) {
        failedPostStartQuery = true;
        queryAfterStart = false;
        throw new Error('模拟启动后查询失败');
      }
      queryAfterStart = false;
      return { battle: currentBattle } as unknown as GameSnapshot;
    },
  } as AssessmentApi;

  return { api, commands, startedEnemyNames };
}

function saveHashMechanism(max: number): void {
  saveWorkshopMechanism({
    format: 'caelian_workshop_mechanism',
    version: 1,
    id: 'test.assessment-resource',
    name: '评定资源',
    resources: [
      {
        id: 'charge',
        label: '充能',
        min: 0,
        max,
        initial: 0,
        visible: true,
      },
    ],
    statuses: [],
    rules: [],
  });
}

afterEach(() => localStorage.clear());

describe('创意工坊职业自动评定', () => {
  it('固定三轮题目并覆盖低高、单多、边界属性与有限构筑空间，第三轮三胜判为超标', async () => {
    const candidate = profession();
    localStorage.setItem(WORKSHOP_TEST_STORAGE_KEY, 'player-owned-candidate');
    const { api, commands, startedEnemyNames } = assessmentApi(
      candidate,
      ({ workshopTest }) =>
        !(
          workshopTest.enemyScale === 1.35 &&
          workshopTest.randomTier === 'high' &&
          workshopTest.opponentMode === 'random-multi'
        ),
      { pendingChoice: true },
    );
    const progress: Array<[number, number]> = [];

    const report = await assessWorkshopProfession(
      api,
      candidate,
      (completed, total) => progress.push([completed, total]),
    );

    expect(report.rounds).toHaveLength(3);
    expect(report.rounds.map((round) => round.scenarios.length)).toEqual([
      4, 4, 4,
    ]);
    expect(report.rounds[2]).toMatchObject({ victories: 3, passed: true });
    expect(report).toMatchObject({ status: 'overpowered', passed: false });
    expect(report.strengthRange).toEqual([1.35, 2.5]);
    expect(report.attributeBudget).toBe(990);
    expect(report.attributeProfiles.map((profile) => profile.spent)).toEqual(
      Array.from({ length: 8 }, () => 990),
    );
    expect(report.attributeProfiles.map((profile) => profile.id)).toEqual([
      'balanced',
      'hp-boundary',
      'mp-boundary',
      'attack-boundary',
      'defense-boundary',
      'speed-boundary',
      'ap-boundary',
      'lifesteal-boundary',
    ]);
    expect(report.deckStrategies).toContain('coverage-1');
    expect(report.successfulCardIds).toEqual(
      candidate.cards.map((card) => card.id).sort(),
    );
    expect(localStorage.getItem(WORKSHOP_TEST_STORAGE_KEY)).toBe(
      'player-owned-candidate',
    );
    const starts = commands.filter((command) => command.type === 'battle.start');
    expect(starts.length).toBeGreaterThanOrEqual(32);
    expect(starts.length).toBeLessThanOrEqual(80);
    expect(progress).toHaveLength(starts.length);
    expect(progress.at(-1)).toEqual([starts.length, starts.length]);
    for (const scale of [0.85, 1.1, 1.35]) {
      const atScale = starts.filter((command) => {
        const test = command.payload.workshopTest as Record<string, unknown>;
        return test.enemyScale === scale;
      });
      expect(atScale.length).toBeGreaterThan(0);
      const coverage = new Set(
        atScale.map((command) => {
          const test = command.payload.workshopTest as Record<string, unknown>;
          return `${test.randomTier}:${test.opponentMode}`;
        }),
      );
      expect(coverage).toEqual(
        new Set([
          'low:random-single',
          'high:random-single',
          'low:random-multi',
          'high:random-multi',
        ]),
      );
    }

    const seedsByCase = new Map<string, Set<unknown>>();
    for (const command of starts) {
      const test = command.payload.workshopTest as Record<string, unknown>;
      const key = `${test.randomTier}:${test.opponentMode}`;
      const seeds = seedsByCase.get(key) ?? new Set<unknown>();
      seeds.add(test.randomSeed);
      seedsByCase.set(key, seeds);
      const attributes = test.attributes as Record<string, number>;
      const apCount = attributes.actionPointsPerTurn ?? 0;
      const apCost = Math.min(apCount, 6) * 2 + Math.max(0, apCount - 6) * 3;
      const spent =
        (attributes.hpMax ?? 0) +
        (attributes.mpMax ?? 0) +
        (attributes.attack ?? 0) +
        (attributes.defense ?? 0) +
        (attributes.speed ?? 0) +
        (attributes.lifesteal ?? 0) * 2 +
        apCost;
      expect(spent).toBe(990);
    }
    expect([...seedsByCase.values()].every((seeds) => seeds.size === 1)).toBe(
      true,
    );
    const enemyNamesByCase = new Map<string, Set<string>>();
    starts.forEach((command, index) => {
      const test = command.payload.workshopTest as Record<string, unknown>;
      const key = `${test.randomTier}:${test.opponentMode}`;
      const names = enemyNamesByCase.get(key) ?? new Set<string>();
      names.add(JSON.stringify(startedEnemyNames[index]));
      enemyNamesByCase.set(key, names);
    });
    expect(
      [...enemyNamesByCase.values()].every((names) => names.size === 1),
    ).toBe(true);
    expect(
      new Set(
        starts.map((command) => {
          const test = command.payload.workshopTest as Record<string, unknown>;
          return (test.deckIds as string[]).join('|');
        }),
      ).size,
    ).toBeGreaterThanOrEqual(3);
    const profileByAttributes = new Map(
      report.attributeProfiles.map((profile) => [
        JSON.stringify(profile.attributes),
        profile.id,
      ]),
    );
    const distinctDecks = [
      ...new Set(
        starts.map((command) => {
          const test = command.payload.workshopTest as Record<string, unknown>;
          return deckKeyForTest(test.deckIds as string[]);
        }),
      ),
    ];
    const deckAttributePairs = new Set(
      starts.map((command) => {
        const test = command.payload.workshopTest as Record<string, unknown>;
        return `${deckKeyForTest(test.deckIds as string[])}::${profileByAttributes.get(
          JSON.stringify(test.attributes),
        )}`;
      }),
    );
    for (const deck of distinctDecks) {
      for (const profile of report.attributeProfiles) {
        expect(deckAttributePairs).toContain(`${deck}::${profile.id}`);
      }
    }
    const startsByLogicalScenario = new Map<string, RecordedCommand[]>();
    const factorRows: Array<{
      deck: string;
      attribute: string;
      round: string;
      encounter: string;
    }> = [];
    for (const command of starts) {
      const test = command.payload.workshopTest as Record<string, unknown>;
      const round = String(command.payload.source).match(/第 (\d+) 轮/)?.[1];
      const encounter = `${test.randomTier}:${test.opponentMode}`;
      const key = `${round}:${encounter}`;
      const group = startsByLogicalScenario.get(key) ?? [];
      group.push(command);
      startsByLogicalScenario.set(key, group);
      factorRows.push({
        deck: deckKeyForTest(test.deckIds as string[]),
        attribute: profileByAttributes.get(JSON.stringify(test.attributes))!,
        round: round!,
        encounter,
      });
    }
    expect(startsByLogicalScenario.size).toBe(12);
    for (const group of startsByLogicalScenario.values()) {
      expect(group.length).toBeGreaterThanOrEqual(2);
      expect(group.length).toBeLessThanOrEqual(21);
    }
    const assertPairCoverage = <
      Left extends keyof (typeof factorRows)[number],
      Right extends keyof (typeof factorRows)[number],
    >(
      left: Left,
      right: Right,
      leftValues: string[],
      rightValues: string[],
    ) => {
      const pairs = new Set(
        factorRows.map((row) => `${row[left]}::${row[right]}`),
      );
      for (const leftValue of leftValues) {
        for (const rightValue of rightValues) {
          expect(pairs).toContain(`${leftValue}::${rightValue}`);
        }
      }
    };
    const attributeIds = report.attributeProfiles.map((profile) => profile.id);
    const rounds = ['1', '2', '3'];
    const encounters = [
      'low:random-single',
      'high:random-single',
      'low:random-multi',
      'high:random-multi',
    ];
    assertPairCoverage('deck', 'attribute', distinctDecks, attributeIds);
    assertPairCoverage('deck', 'round', distinctDecks, rounds);
    assertPairCoverage('deck', 'encounter', distinctDecks, encounters);
    assertPairCoverage('attribute', 'round', attributeIds, rounds);
    assertPairCoverage('attribute', 'encounter', attributeIds, encounters);
    assertPairCoverage('round', 'encounter', rounds, encounters);
    const expectedCardIds = candidate.cards.map((card) => card.id).sort();
    for (const attribute of attributeIds) {
      for (const encounter of [
        'high:random-single',
        'high:random-multi',
      ]) {
        const coveredCards = new Set(
          starts
            .filter((command) => {
              const test = command.payload.workshopTest as Record<string, unknown>;
              const round = String(command.payload.source).match(/第 (\d+) 轮/)?.[1];
              return (
                round === '3' &&
                `${test.randomTier}:${test.opponentMode}` === encounter &&
                profileByAttributes.get(JSON.stringify(test.attributes)) ===
                  attribute
              );
            })
            .flatMap((command) => {
              const test = command.payload.workshopTest as Record<string, unknown>;
              return test.deckIds as string[];
            }),
        );
        expect([...coveredCards].sort()).toEqual(expectedCardIds);
      }
    }
    for (const round of report.rounds) {
      for (const scenario of round.scenarios) {
        expect(scenario.testedDeckStrategies.length).toBeGreaterThan(0);
        expect(
          scenario.testedDeckStrategies.every((strategy) =>
            report.deckStrategies.includes(strategy),
          ),
        ).toBe(true);
        expect(scenario.testedDeckStrategies).toContain(scenario.deckStrategy);
        expect(scenario.testedAttributeProfiles.length).toBeGreaterThan(0);
        expect(scenario.testedAttributeProfiles).toContain(
          scenario.attributeProfile,
        );
      }
    }

    const cleanup = commands.filter((command) =>
      [
        'battle.cancel-workshop-test',
        'battle.finish',
        'battle.surrender',
      ].includes(command.type),
    );
    expect(cleanup.every((command) =>
      ['battle.cancel-workshop-test', 'battle.finish'].includes(command.type),
    )).toBe(true);
    expect(
      cleanup.filter((command) => command.type === 'battle.finish'),
    ).toHaveLength(starts.length);
    const losingStarts = starts.filter((command) => {
      const test = command.payload.workshopTest as Record<string, unknown>;
      return (
        test.enemyScale === 1.35 &&
        test.randomTier === 'high' &&
        test.opponentMode === 'random-multi'
      );
    });
    expect(
      cleanup.filter((command) => command.type === 'battle.cancel-workshop-test'),
    ).toHaveLength(losingStarts.length);
    const choices = commands.filter(
      (command) => command.type === 'battle.choose-astrology-card',
    );
    expect(choices).toHaveLength(starts.length - losingStarts.length);
    expect(choices.every((command) => command.payload.choiceIndex === 0)).toBe(
      true,
    );
  });

  it('卡池单卡超过三份时仍构造15张且每种最多三张的合法测试牌组', async () => {
    const base = profession();
    const crowdedCardId = base.cards[7]!.id;
    const candidate = normalizeWorkshopClass({
      ...base,
      cardPool: [
        ...base.cardPool,
        crowdedCardId,
        crowdedCardId,
        crowdedCardId,
        crowdedCardId,
      ],
    });
    const poolCounts = candidate.cardPool.reduce<Record<string, number>>(
      (counts, cardId) => {
        counts[cardId] = (counts[cardId] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(poolCounts[crowdedCardId]).toBeGreaterThan(3);
    const { api, commands } = assessmentApi(candidate, () => false);

    const report = await assessWorkshopProfession(api, candidate);

    expect(report).toMatchObject({ status: 'underpowered', passed: true });
    const starts = commands.filter((command) => command.type === 'battle.start');
    expect(starts.length).toBeGreaterThan(12);
    for (const command of starts) {
      const test = command.payload.workshopTest as Record<string, unknown>;
      const deck = test.deckIds as string[];
      const deckCounts = deck.reduce<Record<string, number>>(
        (counts, cardId) => {
          counts[cardId] = (counts[cardId] ?? 0) + 1;
          return counts;
        },
        {},
      );
      expect(deck).toHaveLength(15);
      expect(Object.values(deckCounts).every((count) => count <= 3)).toBe(true);
      expect(
        Object.entries(deckCounts).every(
          ([cardId, count]) => count <= (poolCounts[cardId] ?? 0),
        ),
      ).toBe(true);
    }
    const rankedStarts = starts.filter((command) =>
      String(command.payload.source).includes('pool-power'),
    );
    expect(rankedStarts.length).toBeGreaterThan(0);
    expect(
      rankedStarts.every((command) => {
        const test = command.payload.workshopTest as Record<string, unknown>;
        return (test.deckIds as string[]).filter(
          (cardId) => cardId === crowdedCardId,
        ).length === 3;
      }),
    ).toBe(true);
  });

  it('16种卡牌使用轮换构筑覆盖每张卡及所有两两共现组合', async () => {
    const cards = Array.from({ length: 16 }, (_, index) => ({
      id: `custom_assessment_pair_card_${String(index).padStart(2, '0')}`,
      name: `组合覆盖卡${index + 1}`,
      type: 'skill',
      cost: 0,
      effects: [{ type: 'damage', value: 1, target: 'enemy' }],
    }));
    const candidate = normalizeWorkshopClass({
      id: 'custom_class_assessment_pair_coverage',
      main: 'freelance',
      name: '组合覆盖测试职业',
      description: '验证有限构筑输入空间。',
      talent: { name: '无', description: '无', effects: [] },
      cards,
      cardPool: cards.map((card) => card.id),
      starterDeck: cards.slice(0, 15).map((card) => card.id),
      mechanismIds: [],
    });
    const { api, commands } = assessmentApi(candidate, () => false);

    const report = await assessWorkshopProfession(api, candidate);

    expect(report.deckStrategies).toEqual(
      expect.arrayContaining(['coverage-1', 'coverage-2', 'coverage-3']),
    );
    expect(report.successfulCardIds).toEqual(
      cards.map((card) => card.id).sort(),
    );
    const testedDecks = [
      ...new Map(
        commands
          .filter((command) => command.type === 'battle.start')
          .map((command) => {
            const deck = [
              ...((command.payload.workshopTest as Record<string, unknown>)
                .deckIds as string[]),
            ];
            return [deckKeyForTest(deck), deck] as const;
          }),
      ).values(),
    ];
    for (let left = 0; left < cards.length; left += 1) {
      for (let right = left + 1; right < cards.length; right += 1) {
        expect(
          testedDecks.some(
            (deck) =>
              deck.includes(cards[left]!.id) && deck.includes(cards[right]!.id),
          ),
        ).toBe(true);
      }
    }
  });

  it('达到单回合动作上限后仍可继续出牌会标记 unsafe', async () => {
    const candidate = profession();
    const { api } = assessmentApi(candidate, () => false, {
      loopingCard: true,
    });

    const report = await assessWorkshopProfession(api, candidate);

    expect(report).toMatchObject({ status: 'unsafe', passed: false });
    expect(report.unsafeReason).toContain('单回合可成功出牌超过32次');
  });

  it('不会把未知的战斗或数据库异常吞成暂时不可出牌', async () => {
    const candidate = profession();
    const { api, commands } = assessmentApi(candidate, () => false, {
      throwPlayCardError: '模拟数据库事务损坏',
    });

    await expect(assessWorkshopProfession(api, candidate)).rejects.toThrow(
      '模拟数据库事务损坏',
    );
    expect(
      commands.filter((command) => command.type === 'battle.finish'),
    ).toHaveLength(1);
  });

  it('职业战斗内容或引用机制变化后不会复用旧评定报告', async () => {
    saveHashMechanism(5);
    const candidate = profession(['test.assessment-resource']);
    const { api } = assessmentApi(candidate, () => false);
    const report = await assessWorkshopProfession(api, candidate);

    expect(readWorkshopAssessment(candidate)).toEqual(report);
    expect(report.combatHash).toMatch(/^[0-9a-f]{64}$/);

    const trimmed = structuredClone(report);
    trimmed.rounds[0]!.scenarios.pop();
    localStorage.setItem(
      'caelian_workshop_assessments_v1',
      JSON.stringify([trimmed]),
    );
    expect(readWorkshopAssessment(candidate)).toBeUndefined();

    const hiddenUnsafe = structuredClone(report);
    hiddenUnsafe.rounds[0]!.scenarios[0]!.unsafeReason = '模拟底层机制错误';
    localStorage.setItem(
      'caelian_workshop_assessments_v1',
      JSON.stringify([hiddenUnsafe]),
    );
    expect(readWorkshopAssessment(candidate)).toBeUndefined();

    const nonMonotonic = structuredClone(report);
    for (const scenario of nonMonotonic.rounds[1]!.scenarios) {
      scenario.victory = true;
      for (const evidence of scenario.runEvidence) evidence.victory = true;
      scenario.victoriousAttributeProfiles = [
        ...scenario.testedAttributeProfiles,
      ];
    }
    nonMonotonic.rounds[1]!.victories = 4;
    nonMonotonic.rounds[1]!.passed = true;
    nonMonotonic.status = 'strong';
    nonMonotonic.passed = true;
    nonMonotonic.strengthRange = [1.1, 1.35];
    localStorage.setItem(
      'caelian_workshop_assessments_v1',
      JSON.stringify([nonMonotonic]),
    );
    expect(readWorkshopAssessment(candidate)).toEqual(nonMonotonic);

    localStorage.setItem(
      'caelian_workshop_assessments_v1',
      JSON.stringify([report]),
    );

    const changedProfession = structuredClone(candidate);
    changedProfession.cards[0]!.effects[0]!.value = 2;
    expect(readWorkshopAssessment(changedProfession)).toBeUndefined();

    saveHashMechanism(6);
    expect(readWorkshopAssessment(candidate)).toBeUndefined();

    localStorage.setItem(
      'caelian_workshop_assessments_v1',
      JSON.stringify([{ ...report, rounds: [] }]),
    );
    expect(readWorkshopAssessment(candidate)).toBeUndefined();
  });

  it('启动后的查询失败也会在 finally 依次尝试取消、结束并验证', async () => {
    const candidate = profession();
    const { api, commands } = assessmentApi(candidate, () => false, {
      failFirstPostStartQuery: true,
      failCancel: true,
    });

    await expect(assessWorkshopProfession(api, candidate)).rejects.toThrow(
      '自动评定战斗清理不完整',
    );
    expect(commands.filter((command) => command.type === 'battle.start')).toHaveLength(1);
    expect(
      commands.filter((command) => command.type === 'battle.cancel-workshop-test'),
    ).toHaveLength(1);
    expect(commands.filter((command) => command.type === 'battle.finish')).toHaveLength(1);
    await expect(api.query('state')).resolves.toMatchObject({ battle: null });
  });

  it('二阶覆盖矩阵的跨轮非单调结果按最高通过倍率记录', async () => {
    const candidate = profession();
    const { api } = assessmentApi(
      candidate,
      ({ workshopTest }) => workshopTest.enemyScale === 1.1,
    );

    const report = await assessWorkshopProfession(api, candidate);

    expect(report).toMatchObject({
      status: 'strong',
      passed: true,
      strengthRange: [1.1, 1.35],
    });
    expect(report.unsafeReason).toBeUndefined();
    expect(readWorkshopAssessment(candidate)).toEqual(report);
  });

  it('只允许有当前内容严格通过报告的测试候选进入可用职业', async () => {
    const mechanismId = 'test.activation-fingerprint-resource';
    const mechanism = (maximum: number) => ({
      format: 'caelian_workshop_mechanism',
      version: 1,
      id: mechanismId,
      name: '发布门禁资源',
      resources: [
        {
          id: 'charge',
          label: '充能',
          min: 0,
          max: maximum,
          initial: 0,
          visible: true,
        },
      ],
      statuses: [],
      rules: [],
    });
    const rawCandidate = profession([mechanismId]);
    saveWorkshopPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '正式旧版门禁测试包',
      author: '测试',
      mechanisms: [mechanism(5)],
      classes: [rawCandidate],
    });
    const publishedHash = workshopCombatFingerprint(
      readWorkshopPacks()[0]!.classes[0]!,
    );
    const testPack = saveWorkshopTestPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '发布门禁测试包',
      author: '测试',
      mechanisms: [mechanism(9)],
      classes: [rawCandidate],
    });
    const candidate = testPack.classes[0]!;
    const candidateHash = workshopCombatFingerprint(candidate);
    expect(candidateHash).not.toBe(publishedHash);

    expect(() => activateAssessedWorkshopTestPack(testPack)).toThrow(
      '没有与当前内容匹配的通过评定',
    );

    const { api } = assessmentApi(
      candidate,
      ({ workshopTest }) => workshopTest.enemyScale !== 1.35,
    );
    const report = await assessWorkshopProfession(api, candidate);
    expect(report).toMatchObject({ status: 'strong', passed: true });

    expect(activateAssessedWorkshopTestPack(testPack).classes[0]?.id).toBe(
      candidate.id,
    );
    expect(readWorkshopPacks().some((pack) =>
      pack.classes.some((entry) => entry.id === candidate.id),
    )).toBe(true);
    expect(
      workshopCombatFingerprint(readWorkshopPacks()[0]!.classes[0]!),
    ).toBe(candidateHash);
    const storedFormal = JSON.parse(
      localStorage.getItem('caelian_custom_workshop_packs_v1') ?? '[]',
    ) as Array<Record<string, unknown>>;
    expect(storedFormal[0]?.certifications).toMatchObject({
      [candidate.id]: {
        evaluatorVersion: report.evaluatorVersion,
        combatHash: candidateHash,
      },
    });

    const storedCandidate = localStorage.getItem(WORKSHOP_TEST_STORAGE_KEY);
    saveWorkshopMechanism(mechanism(10));
    expect(
      readWorkshopPacks().some((pack) =>
        pack.classes.some((entry) => entry.id === candidate.id),
      ),
    ).toBe(false);
    expect(localStorage.getItem(WORKSHOP_TEST_STORAGE_KEY)).toBe(
      storedCandidate,
    );
    localStorage.removeItem(WORKSHOP_TEST_STORAGE_KEY);
    expect(readWorkshopTestCandidate(candidate.id)).toBeUndefined();
    if (storedCandidate !== null) {
      localStorage.setItem(WORKSHOP_TEST_STORAGE_KEY, storedCandidate);
    }

    const unrelated = structuredClone(rawCandidate);
    unrelated.id = 'custom_class_certification_preservation_probe';
    unrelated.name = '认证存储保留探针';
    saveWorkshopPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '认证存储保留探针包',
      author: '测试',
      classes: [unrelated],
    });
    const rawAfterUnrelatedSave = JSON.parse(
      localStorage.getItem('caelian_custom_workshop_packs_v1') ?? '[]',
    ) as Array<{ classes?: Array<{ id?: string }> }>;
    expect(
      rawAfterUnrelatedSave.some((pack) =>
        pack.classes?.some((entry) => entry.id === candidate.id),
      ),
    ).toBe(true);

    saveWorkshopMechanism(mechanism(9));
    expect(
      readWorkshopPacks().some((pack) =>
        pack.classes.some((entry) => entry.id === candidate.id),
      ),
    ).toBe(true);

    const changedPack = structuredClone(testPack);
    changedPack.classes[0]!.cards[0]!.effects[0]!.value = 2;
    expect(() => activateAssessedWorkshopTestPack(changedPack)).toThrow(
      '候选内容已变化',
    );
  });

  it('未捆绑的全局机制变化后，必须重新评定才能恢复认证职业', async () => {
    saveHashMechanism(5);
    const testPack = saveWorkshopTestPack({
      format: 'caelian_workshop_class_pack',
      version: 1,
      packName: '全局机制重评测试包',
      author: '测试',
      classes: [profession(['test.assessment-resource'])],
    });
    const candidate = testPack.classes[0]!;
    const passing = ({ workshopTest }: StartContext) =>
      Number(workshopTest.enemyScale) <= 1.1;

    const firstReport = await assessWorkshopProfession(
      assessmentApi(candidate, passing).api,
      candidate,
    );
    expect(firstReport.passed).toBe(true);
    activateAssessedWorkshopTestPack(testPack);
    expect(readWorkshopPacks().flatMap((pack) => pack.classes)).toHaveLength(1);

    saveHashMechanism(6);
    expect(readWorkshopAssessment(candidate)).toBeUndefined();
    expect(readWorkshopPacks()).toEqual([]);

    const renewedReport = await assessWorkshopProfession(
      assessmentApi(candidate, passing).api,
      candidate,
    );
    expect(renewedReport.passed).toBe(true);
    expect(renewedReport.combatHash).not.toBe(firstReport.combatHash);
    activateAssessedWorkshopTestPack(testPack);
    expect(readWorkshopPacks().flatMap((pack) => pack.classes)).toHaveLength(1);
  });
});
