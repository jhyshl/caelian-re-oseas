import type { CardDefinition } from '@/content/types';
import type { GameSnapshot, LocalBattleState } from '@/domain/types';
import { EventBus } from '@/kernel/event-bus';
import { commandId } from '@/kernel/ids';
import type { PanelApi } from '@/kernel/public-api';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repositories/game-repository';
import {
  cardLimit,
  normalizeWorkshopPack,
  readWorkshopTestPacks,
  saveWorkshopPack,
  type WorkshopClass,
  type WorkshopPack,
} from '@/workshop';
import {
  WORKSHOP_ASSESSMENT_STORAGE_KEY,
  WORKSHOP_ASSESSMENT_VERSION,
  registerWorkshopFingerprintContext,
  workshopCombatFingerprint,
} from '@/workshop-certification';

export {
  WORKSHOP_ASSESSMENT_STORAGE_KEY,
  WORKSHOP_ASSESSMENT_VERSION,
} from '@/workshop-certification';
export const WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET = 990;

export type WorkshopAssessmentStatus =
  | 'underpowered'
  | 'balanced'
  | 'strong'
  | 'overpowered'
  | 'unsafe';

export type WorkshopAssessmentDeckStrategy =
  | 'starter'
  | 'pool-power'
  | 'pool-efficiency'
  | `coverage-${number}`;

export type WorkshopAssessmentAttributeProfileId =
  | 'balanced'
  | 'hp-boundary'
  | 'mp-boundary'
  | 'attack-boundary'
  | 'defense-boundary'
  | 'speed-boundary'
  | 'ap-boundary'
  | 'lifesteal-boundary';

interface WorkshopAssessmentAttributes {
  hpMax: number;
  mpMax: number;
  attack: number;
  defense: number;
  speed: number;
  actionPointsPerTurn: number;
  lifesteal: number;
}

export interface WorkshopAssessmentAttributeProfile {
  id: WorkshopAssessmentAttributeProfileId;
  label: string;
  attributes: WorkshopAssessmentAttributes;
  spent: number;
  explanation: string;
}

export interface WorkshopAssessmentScenario {
  id: string;
  round: number;
  mode: 'random-single' | 'random-multi';
  tier: 'low' | 'high';
  enemyScale: number;
  seed: number;
  victory: boolean;
  turns: number;
  enemyNames: string[];
  remainingPlayerHpRatio: number;
  damageRatio: number;
  deckStrategy: WorkshopAssessmentDeckStrategy;
  attributeProfile: WorkshopAssessmentAttributeProfileId;
  testedDeckStrategies: WorkshopAssessmentDeckStrategy[];
  testedAttributeProfiles: WorkshopAssessmentAttributeProfileId[];
  victoriousAttributeProfiles: WorkshopAssessmentAttributeProfileId[];
  burstVictoriousAttributeProfiles: WorkshopAssessmentAttributeProfileId[];
  runEvidence: WorkshopAssessmentRunEvidence[];
  successfulCardIds: string[];
  unsafeReason?: string;
}

export interface WorkshopAssessmentRunEvidence {
  deckStrategy: WorkshopAssessmentDeckStrategy;
  attributeProfile: WorkshopAssessmentAttributeProfileId;
  horizon: 3 | 10;
  victory: boolean;
  burstVictory: boolean;
  turns: number;
}

export interface WorkshopAssessmentRound {
  round: number;
  enemyScale: number;
  victories: number;
  passed: boolean;
  scenarios: WorkshopAssessmentScenario[];
}

export interface WorkshopAssessmentReport {
  schemaVersion: 1;
  evaluatorVersion: typeof WORKSHOP_ASSESSMENT_VERSION;
  professionId: string;
  combatHash: string;
  status: WorkshopAssessmentStatus;
  passed: boolean;
  /** Objective enemy-stat multiplier interval bracketed by fixed scenarios. */
  strengthRange: [number, number];
  attributeBudget: number;
  attributeProfiles: WorkshopAssessmentAttributeProfile[];
  deckStrategies: WorkshopAssessmentDeckStrategy[];
  successfulCardIds: string[];
  rounds: WorkshopAssessmentRound[];
  testedAt: number;
  unsafeReason?: string;
}

interface AssessmentApi {
  execute: PanelApi['execute'];
  query(name: 'state'): Promise<GameSnapshot>;
  getRuntimeInfo?: PanelApi['getRuntimeInfo'];
}

interface ScenarioSpec {
  key: string;
  mode: 'random-single' | 'random-multi';
  tier: 'low' | 'high';
  seed: number;
}

interface DeckCandidate {
  strategy: WorkshopAssessmentDeckStrategy;
  representedStrategies: WorkshopAssessmentDeckStrategy[];
  cards: string[];
}

interface DeckPlan {
  candidates: DeckCandidate[];
  strategies: WorkshopAssessmentDeckStrategy[];
}

interface PhysicalAssessmentRun {
  roundIndex: number;
  scenarioIndex: number;
  deckCandidate: DeckCandidate;
  attributeProfile: WorkshopAssessmentAttributeProfile;
  horizon: 3 | 10;
}

interface ScenarioCoveragePlan {
  deckStrategies: WorkshopAssessmentDeckStrategy[];
  attributeProfiles: WorkshopAssessmentAttributeProfileId[];
  runs: Array<{
    deckStrategy: WorkshopAssessmentDeckStrategy;
    attributeProfile: WorkshopAssessmentAttributeProfileId;
    horizon: 3 | 10;
  }>;
}

interface IsolatedAssessmentHarness {
  apiForSeed(seed: number): AssessmentApi;
  dispose(): Promise<void>;
}

const ROUND_SCALES = [0.85, 1.1, 1.35] as const;
const FIXED_SCENARIOS: readonly ScenarioSpec[] = [
  { key: 'low-random-single', mode: 'random-single', tier: 'low', seed: 173_123 },
  { key: 'high-random-single', mode: 'random-single', tier: 'high', seed: 174_120 },
  { key: 'low-random-multi', mode: 'random-multi', tier: 'low', seed: 175_117 },
  { key: 'high-random-multi', mode: 'random-multi', tier: 'high', seed: 176_114 },
] as const;
const BASE_DECK_STRATEGIES: readonly WorkshopAssessmentDeckStrategy[] = [
  'starter',
  'pool-power',
  'pool-efficiency',
] as const;
const ATTRIBUTE_PROFILE_IDS: readonly WorkshopAssessmentAttributeProfileId[] = [
  'balanced',
  'hp-boundary',
  'mp-boundary',
  'attack-boundary',
  'defense-boundary',
  'speed-boundary',
  'ap-boundary',
  'lifesteal-boundary',
] as const;
const MAX_TURNS = 10;
const BURST_PROBE_TURNS = 3;
const MAX_ACTIONS_PER_TURN = 32;
const MAX_PENDING_CHOICES = 21;
// This is a fail-safe for a genuinely stalled assessment, not part of the
// strength result. Keep it generous so the same profession is not accepted on
// a fast desktop but marked unsafe on a slower phone or CI runner.
const MAX_ASSESSMENT_MS = 300_000;
// Exhaustively checked for every deduplicated deck count D=1..6. Together
// with scenario=(3*row+attribute)%4, this keeps every pair among deck,
// attribute, round and encounter covered, gives every logical cell at least
// two 10-turn runs, and reuses more top-round high-tier runs as burst probes.
const PAIRWISE_ROUND_INDEX: readonly (readonly number[])[] = [
  [0, 0, 1, 1, 2, 2, 0, 1],
  [2, 1, 0, 1, 0, 1, 2, 0],
  [2, 2, 1, 2, 1, 0, 1, 2],
  [1, 2, 2, 0, 1, 2, 2, 2],
  [0, 1, 1, 0, 2, 0, 2, 2],
  [2, 2, 1, 1, 1, 2, 0, 1],
] as const;

function attributeSpent(attributes: WorkshopAssessmentAttributes): number {
  const apCount = Math.max(0, Math.floor(attributes.actionPointsPerTurn));
  const apCost = Math.min(apCount, 6) * 2 + Math.max(0, apCount - 6) * 3;
  return (
    Math.max(0, attributes.hpMax) +
    Math.max(0, attributes.mpMax) +
    Math.max(0, attributes.attack) +
    Math.max(0, attributes.defense) +
    Math.max(0, attributes.speed) +
    Math.max(0, attributes.lifesteal) * 2 +
    apCost
  );
}

const ATTRIBUTE_PROFILES: readonly WorkshopAssessmentAttributeProfile[] = [
  {
    id: 'balanced',
    label: '均衡满级模板',
    attributes: {
      hpMax: 170,
      mpMax: 120,
      attack: 250,
      defense: 220,
      speed: 198,
      actionPointsPerTurn: 6,
      lifesteal: 10,
    },
    spent: WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET,
    explanation:
      '生命170＋魔力120＋攻击250＋防御220＋速度198＋行动点提升6次（12点）＋吸血10%（20点）＝990点，用于覆盖常规生存、资源与输出轴。',
  },
  {
    id: 'hp-boundary',
    label: '生命单轴边界模板',
    attributes: {
      hpMax: 990,
      mpMax: 0,
      attack: 0,
      defense: 0,
      speed: 0,
      actionPointsPerTurn: 0,
      lifesteal: 0,
    },
    spent: WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET,
    explanation: '生命投入990点，其余轴为0，用于覆盖生命单轴合法上界。',
  },
  {
    id: 'mp-boundary',
    label: '魔力单轴边界模板',
    attributes: {
      hpMax: 0,
      mpMax: 990,
      attack: 0,
      defense: 0,
      speed: 0,
      actionPointsPerTurn: 0,
      lifesteal: 0,
    },
    spent: WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET,
    explanation: '魔力投入990点，其余轴为0，用于覆盖魔力单轴合法上界。',
  },
  {
    id: 'attack-boundary',
    label: '攻击单轴边界模板',
    attributes: {
      hpMax: 0,
      mpMax: 0,
      attack: 990,
      defense: 0,
      speed: 0,
      actionPointsPerTurn: 0,
      lifesteal: 0,
    },
    spent: WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET,
    explanation: '攻击投入990点，其余轴为0，用于覆盖攻击单轴合法上界。',
  },
  {
    id: 'defense-boundary',
    label: '防御单轴边界模板',
    attributes: {
      hpMax: 0,
      mpMax: 0,
      attack: 0,
      defense: 990,
      speed: 0,
      actionPointsPerTurn: 0,
      lifesteal: 0,
    },
    spent: WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET,
    explanation: '防御投入990点，其余轴为0，用于覆盖防御单轴合法上界。',
  },
  {
    id: 'speed-boundary',
    label: '速度单轴边界模板',
    attributes: {
      hpMax: 0,
      mpMax: 0,
      attack: 0,
      defense: 0,
      speed: 990,
      actionPointsPerTurn: 0,
      lifesteal: 0,
    },
    spent: WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET,
    explanation: '速度投入990点，其余轴为0，用于覆盖速度单轴合法上界。',
  },
  {
    id: 'ap-boundary',
    label: '行动点提升边界模板',
    attributes: {
      hpMax: 0,
      mpMax: 0,
      attack: 696,
      defense: 0,
      speed: 0,
      actionPointsPerTurn: 100,
      lifesteal: 0,
    },
    spent: WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET,
    explanation:
      '行动点提升100次达到输入合法上界（294点），剩余696点投入攻击，总计990点。',
  },
  {
    id: 'lifesteal-boundary',
    label: '吸血边界模板',
    attributes: {
      hpMax: 0,
      mpMax: 0,
      attack: 930,
      defense: 0,
      speed: 0,
      actionPointsPerTurn: 0,
      lifesteal: 30,
    },
    spent: WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET,
    explanation:
      '吸血30%达到合法上界（60点），剩余930点投入攻击，总计990点。',
  },
] as const;

for (const profile of ATTRIBUTE_PROFILES) {
  if (
    profile.spent !== WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET ||
    attributeSpent(profile.attributes) !== WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET
  ) {
    throw new Error(`自动评定属性模板 ${profile.id} 未使用完整的 990 点预算`);
  }
}

export function workshopCombatHash(profession: WorkshopClass): string {
  return workshopCombatFingerprint(profession);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validRatio(value: unknown): value is number {
  return finiteNumber(value) && value >= 0 && value <= 1;
}

function isDeckStrategy(value: unknown): value is WorkshopAssessmentDeckStrategy {
  return (
    BASE_DECK_STRATEGIES.includes(value as WorkshopAssessmentDeckStrategy) ||
    (typeof value === 'string' && /^coverage-[1-9]\d*$/.test(value))
  );
}

function sameOrderedValues(
  actual: readonly unknown[],
  expected: readonly unknown[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])
  );
}

function validUniqueStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && Boolean(entry.trim())) &&
    new Set(value).size === value.length
  );
}

function validSortedUniqueStrings(value: unknown): value is string[] {
  return validUniqueStrings(value) && sameOrderedValues(value, [...value].sort());
}

function isAttributeProfileId(
  value: unknown,
): value is WorkshopAssessmentAttributeProfileId {
  return ATTRIBUTE_PROFILE_IDS.includes(
    value as WorkshopAssessmentAttributeProfileId,
  );
}

function validAttributeProfile(
  value: unknown,
  expected: WorkshopAssessmentAttributeProfile,
): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['id', 'label', 'attributes', 'spent', 'explanation']) ||
    value.id !== expected.id ||
    value.label !== expected.label ||
    value.spent !== WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET ||
    value.explanation !== expected.explanation ||
    !isRecord(value.attributes)
  ) {
    return false;
  }
  const attributes = value.attributes;
  if (
    !hasOnlyKeys(attributes, [
      'hpMax',
      'mpMax',
      'attack',
      'defense',
      'speed',
      'actionPointsPerTurn',
      'lifesteal',
    ]) ||
    !Object.entries(expected.attributes).every(
      ([key, expectedValue]) => attributes[key] === expectedValue,
    )
  ) {
    return false;
  }
  return (
    attributeSpent(attributes as unknown as WorkshopAssessmentAttributes) ===
    WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET
  );
}

function validRunEvidence(value: unknown): value is WorkshopAssessmentRunEvidence {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'deckStrategy',
      'attributeProfile',
      'horizon',
      'victory',
      'burstVictory',
      'turns',
    ])
  ) {
    return false;
  }
  return (
    isDeckStrategy(value.deckStrategy) &&
    isAttributeProfileId(value.attributeProfile) &&
    (value.horizon === BURST_PROBE_TURNS || value.horizon === MAX_TURNS) &&
    typeof value.victory === 'boolean' &&
    typeof value.burstVictory === 'boolean' &&
    Number.isInteger(value.turns) &&
    (value.turns as number) >= 1 &&
    (value.turns as number) <= (value.horizon as number) + 1 &&
    value.burstVictory ===
      (value.victory === true && (value.turns as number) <= BURST_PROBE_TURNS)
  );
}

function validScenario(
  value: unknown,
  round: number,
  scale: number,
  spec: ScenarioSpec,
  reportDeckStrategies: readonly WorkshopAssessmentDeckStrategy[],
  expectedCoverage?: ScenarioCoveragePlan,
): value is WorkshopAssessmentScenario {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      [
        'id',
        'round',
        'mode',
        'tier',
        'enemyScale',
        'seed',
        'victory',
        'turns',
        'enemyNames',
        'remainingPlayerHpRatio',
        'damageRatio',
        'deckStrategy',
        'attributeProfile',
        'testedDeckStrategies',
        'testedAttributeProfiles',
        'victoriousAttributeProfiles',
        'burstVictoriousAttributeProfiles',
        'runEvidence',
        'successfulCardIds',
      ],
      ['unsafeReason'],
    )
  ) {
    return false;
  }
  const decks = value.testedDeckStrategies;
  const attributes = value.testedAttributeProfiles;
  const victoriousAttributes = value.victoriousAttributeProfiles;
  const burstVictoriousAttributes = value.burstVictoriousAttributeProfiles;
  const runEvidence = value.runEvidence;
  const successfulCardIds = value.successfulCardIds;
  return (
    value.id === `r${round}-${spec.key}` &&
    value.round === round &&
    value.mode === spec.mode &&
    value.tier === spec.tier &&
    value.enemyScale === scale &&
    value.seed === spec.seed &&
    typeof value.victory === 'boolean' &&
    Number.isInteger(value.turns) &&
    (value.turns as number) >= 1 &&
    (value.turns as number) <= MAX_TURNS + 1 &&
    Array.isArray(value.enemyNames) &&
    value.enemyNames.length >= (spec.mode === 'random-multi' ? 2 : 1) &&
    value.enemyNames.every((entry) => typeof entry === 'string') &&
    validRatio(value.remainingPlayerHpRatio) &&
    validRatio(value.damageRatio) &&
    isDeckStrategy(value.deckStrategy) &&
    isAttributeProfileId(value.attributeProfile) &&
    Array.isArray(decks) &&
    decks.length >= 1 &&
    decks.every(isDeckStrategy) &&
    sameOrderedValues(
      decks,
      reportDeckStrategies.filter((strategy) => decks.includes(strategy)),
    ) &&
    (!expectedCoverage ||
      sameOrderedValues(decks, expectedCoverage.deckStrategies)) &&
    decks.includes(value.deckStrategy) &&
    Array.isArray(attributes) &&
    attributes.length >= 1 &&
    attributes.every(isAttributeProfileId) &&
    sameOrderedValues(
      attributes,
      ATTRIBUTE_PROFILE_IDS.filter((profile) => attributes.includes(profile)),
    ) &&
    (!expectedCoverage ||
      sameOrderedValues(attributes, expectedCoverage.attributeProfiles)) &&
    attributes.includes(value.attributeProfile) &&
    Array.isArray(victoriousAttributes) &&
    victoriousAttributes.every(isAttributeProfileId) &&
    sameOrderedValues(
      victoriousAttributes,
      ATTRIBUTE_PROFILE_IDS.filter((profile) =>
        victoriousAttributes.includes(profile),
      ),
    ) &&
    victoriousAttributes.every((profile) => attributes.includes(profile)) &&
    Array.isArray(burstVictoriousAttributes) &&
    burstVictoriousAttributes.every(isAttributeProfileId) &&
    sameOrderedValues(
      burstVictoriousAttributes,
      ATTRIBUTE_PROFILE_IDS.filter((profile) =>
        burstVictoriousAttributes.includes(profile),
      ),
    ) &&
    burstVictoriousAttributes.every((profile) =>
      victoriousAttributes.includes(profile),
    ) &&
    Array.isArray(runEvidence) &&
    runEvidence.length >= 1 &&
    runEvidence.every(validRunEvidence) &&
    (!expectedCoverage ||
      (runEvidence.length === expectedCoverage.runs.length &&
        runEvidence.every((entry, index) => {
          const expected = expectedCoverage.runs[index];
          return (
            expected !== undefined &&
            entry.deckStrategy === expected.deckStrategy &&
            entry.attributeProfile === expected.attributeProfile &&
            entry.horizon === expected.horizon
          );
        }))) &&
    sameOrderedValues(
      victoriousAttributes,
      ATTRIBUTE_PROFILE_IDS.filter((profile) =>
        runEvidence.some(
          (entry) => entry.victory && entry.attributeProfile === profile,
        ),
      ),
    ) &&
    sameOrderedValues(
      burstVictoriousAttributes,
      ATTRIBUTE_PROFILE_IDS.filter((profile) =>
        runEvidence.some(
          (entry) =>
            entry.burstVictory &&
            entry.attributeProfile === profile,
        ),
      ),
    ) &&
    (value.unsafeReason !== undefined ||
      value.victory === runEvidence.some((entry) => entry.victory)) &&
    (!value.victory || victoriousAttributes.includes(value.attributeProfile)) &&
    validUniqueStrings(successfulCardIds) &&
    [...successfulCardIds].sort().every((entry, index) => entry === successfulCardIds[index]) &&
    (value.unsafeReason === undefined ||
      (typeof value.unsafeReason === 'string' && Boolean(value.unsafeReason.trim())))
  );
}

function validRound(
  value: unknown,
  index: number,
  reportDeckStrategies: readonly WorkshopAssessmentDeckStrategy[],
  expectedCoverage?: readonly ScenarioCoveragePlan[],
): value is WorkshopAssessmentRound {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['round', 'enemyScale', 'victories', 'passed', 'scenarios'])
  ) {
    return false;
  }
  const scale = ROUND_SCALES[index];
  if (
    scale === undefined ||
    value.round !== index + 1 ||
    value.enemyScale !== scale ||
    !Number.isInteger(value.victories) ||
    typeof value.passed !== 'boolean' ||
    !Array.isArray(value.scenarios) ||
    value.scenarios.length !== FIXED_SCENARIOS.length
  ) {
    return false;
  }
  if (
    !value.scenarios.every((scenario, scenarioIndex) =>
      validScenario(
        scenario,
        index + 1,
        scale,
        FIXED_SCENARIOS[scenarioIndex]!,
        reportDeckStrategies,
        expectedCoverage?.[scenarioIndex],
      ),
    )
  ) {
    return false;
  }
  const victories = value.scenarios.filter(
    (scenario) => isRecord(scenario) && scenario.victory === true,
  ).length;
  return (
    value.victories === victories &&
    value.passed ===
      (value.scenarios.length === FIXED_SCENARIOS.length && victories >= 3)
  );
}

function validReport(
  value: unknown,
  profession?: WorkshopClass,
): value is WorkshopAssessmentReport {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      [
        'schemaVersion',
        'evaluatorVersion',
        'professionId',
        'combatHash',
        'status',
        'passed',
        'strengthRange',
        'attributeBudget',
        'attributeProfiles',
        'deckStrategies',
        'successfulCardIds',
        'rounds',
        'testedAt',
      ],
      ['unsafeReason'],
    )
  ) {
    return false;
  }
  if (
    value.schemaVersion !== 1 ||
    value.evaluatorVersion !== WORKSHOP_ASSESSMENT_VERSION ||
    typeof value.professionId !== 'string' ||
    !value.professionId.trim() ||
    typeof value.combatHash !== 'string' ||
    !/^[0-9a-f]{32,128}$/.test(value.combatHash) ||
    !['underpowered', 'balanced', 'strong', 'overpowered', 'unsafe'].includes(
      String(value.status),
    ) ||
    typeof value.passed !== 'boolean' ||
    value.attributeBudget !== WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET ||
    !Array.isArray(value.attributeProfiles) ||
    value.attributeProfiles.length !== ATTRIBUTE_PROFILES.length ||
    !Array.isArray(value.deckStrategies) ||
    value.deckStrategies.length < 1 ||
    !value.deckStrategies.every(isDeckStrategy) ||
    new Set(value.deckStrategies).size !== value.deckStrategies.length ||
    !validSortedUniqueStrings(value.successfulCardIds) ||
    !Array.isArray(value.rounds) ||
    value.rounds.length < 1 ||
    value.rounds.length > ROUND_SCALES.length ||
    !finiteNumber(value.testedAt) ||
    value.testedAt <= 0 ||
    !Array.isArray(value.strengthRange) ||
    value.strengthRange.length !== 2 ||
    !finiteNumber(value.strengthRange[0]) ||
    !finiteNumber(value.strengthRange[1])
  ) {
    return false;
  }
  const attributeProfiles = value.attributeProfiles as unknown[];
  const deckStrategies = value.deckStrategies as WorkshopAssessmentDeckStrategy[];
  const reportRounds = value.rounds as unknown[];
  let expectedCoverage: ScenarioCoveragePlan[][] | undefined;
  if (profession) {
    try {
      const expectedDeckPlan = makeDeckPlan(profession);
      if (!sameOrderedValues(deckStrategies, expectedDeckPlan.strategies)) {
        return false;
      }
      expectedCoverage = scenarioCoveragePlan(
        makePhysicalAssessmentRuns(expectedDeckPlan.candidates),
        expectedDeckPlan.strategies,
      );
    } catch {
      return false;
    }
  }
  if (
    !ATTRIBUTE_PROFILES.every((profile, index) =>
      validAttributeProfile(attributeProfiles[index], profile),
    ) ||
    !reportRounds.every((round, index) =>
      validRound(round, index, deckStrategies, expectedCoverage?.[index]),
    )
  ) {
    return false;
  }
  const unsafe =
    typeof value.unsafeReason === 'string' && Boolean(value.unsafeReason.trim());
  const scenarioUnsafe = reportRounds.some(
    (round) =>
      isRecord(round) &&
      Array.isArray(round.scenarios) &&
      round.scenarios.some(
        (scenario) => isRecord(scenario) && scenario.unsafeReason !== undefined,
      ),
  );
  const scenarioSuccessfulCardIds = [
    ...new Set(
      reportRounds.flatMap((round) =>
        isRecord(round) && Array.isArray(round.scenarios)
          ? round.scenarios.flatMap((scenario) =>
              isRecord(scenario) && Array.isArray(scenario.successfulCardIds)
                ? scenario.successfulCardIds.filter(
                    (entry): entry is string => typeof entry === 'string',
                  )
                : [],
            )
          : [],
      ),
    ),
  ].sort();
  if (!sameOrderedValues(value.successfulCardIds, scenarioSuccessfulCardIds)) {
    return false;
  }
  if (profession) {
    const expectedCardIds = [
      ...new Set(profession.cards.map((card) => card.id)),
    ].sort();
    if (
      value.professionId !== profession.id ||
      value.combatHash !== workshopCombatHash(profession) ||
      value.successfulCardIds.some((cardId) => !expectedCardIds.includes(cardId)) ||
      (!unsafe && !sameOrderedValues(value.successfulCardIds, expectedCardIds))
    ) {
      return false;
    }
  }
  if (
    (!unsafe && reportRounds.length !== ROUND_SCALES.length) ||
    (!unsafe &&
      reportRounds.some(
        (round) =>
          !isRecord(round) ||
          !Array.isArray(round.scenarios) ||
          round.scenarios.length !== FIXED_SCENARIOS.length,
      )) ||
    (scenarioUnsafe && !unsafe)
  ) {
    return false;
  }
  if (
    value.unsafeReason !== undefined &&
    (typeof value.unsafeReason !== 'string' || !value.unsafeReason.trim())
  ) {
    return false;
  }
  const rounds = reportRounds as WorkshopAssessmentRound[];
  const expectedStatus = reportStatus(
    rounds,
    unsafe ? (value.unsafeReason as string) : undefined,
  );
  const expectedRange = resultRange(rounds);
  return (
    value.status === expectedStatus &&
    value.passed === (!unsafe && expectedStatus !== 'overpowered') &&
    value.strengthRange[0] === expectedRange[0] &&
    value.strengthRange[1] === expectedRange[1]
  );
}

function readReports(): WorkshopAssessmentReport[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(WORKSHOP_ASSESSMENT_STORAGE_KEY) ?? '[]',
    ) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry) => validReport(entry))
      : [];
  } catch {
    return [];
  }
}

export function saveWorkshopAssessment(
  report: WorkshopAssessmentReport,
  profession: WorkshopClass,
): WorkshopAssessmentReport {
  if (!validReport(report, profession)) {
    throw new Error('自动评定报告结构无效，已拒绝保存');
  }
  const kept = readReports().filter(
    (entry) => entry.professionId !== report.professionId,
  );
  localStorage.setItem(
    WORKSHOP_ASSESSMENT_STORAGE_KEY,
    JSON.stringify([...kept, report]),
  );
  return report;
}

function deckKey(cards: readonly string[]): string {
  return [...cards].sort().join('\u0000');
}

function strategyOrder(
  left: WorkshopAssessmentDeckStrategy,
  right: WorkshopAssessmentDeckStrategy,
): number {
  const baseLeft = BASE_DECK_STRATEGIES.indexOf(left);
  const baseRight = BASE_DECK_STRATEGIES.indexOf(right);
  if (baseLeft >= 0 || baseRight >= 0) {
    if (baseLeft < 0) return 1;
    if (baseRight < 0) return -1;
    return baseLeft - baseRight;
  }
  return Number(left.slice('coverage-'.length)) - Number(right.slice('coverage-'.length));
}

function coverageRequirements(cardIds: readonly string[]): string[][] {
  if (cardIds.length <= 15) return [[...cardIds]];
  if (cardIds.length === 16) {
    // Three 15-of-16 rotations are sufficient for complete pairwise coverage:
    // every pair is together in at least one deck, including pairs among the
    // three individually omitted cards.
    return [0, 1, 2].map((omitted) =>
      cardIds.filter((_cardId, index) => index !== omitted),
    );
  }
  throw new Error('自动评定仅支持最多16种职业卡牌的有限输入空间覆盖');
}

function makeDeckPlan(profession: WorkshopClass): DeckPlan {
  const byId = new Map(profession.cards.map((card) => [card.id, card]));
  const copies = profession.cardPool.filter((cardId) => byId.has(cardId));
  const poolCounts = copies.reduce<Map<string, number>>((counts, cardId) => {
    counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
    return counts;
  }, new Map());
  const legalDeck = (rankedCopies: readonly string[]): string[] => {
    const counts = new Map<string, number>();
    const deck: string[] = [];
    for (const cardId of rankedCopies) {
      const count = counts.get(cardId) ?? 0;
      if (count >= 3) continue;
      counts.set(cardId, count + 1);
      deck.push(cardId);
      if (deck.length === 15) break;
    }
    return deck;
  };
  const coverageDeck = (
    requiredCardIds: readonly string[],
    rotation: number,
  ): string[] => {
    const counts = new Map<string, number>();
    const deck: string[] = [];
    for (const cardId of requiredCardIds) {
      if (!byId.has(cardId) || (poolCounts.get(cardId) ?? 0) < 1) {
        throw new Error(`自动评定卡牌覆盖缺少卡池资源：${cardId}`);
      }
      counts.set(cardId, 1);
      deck.push(cardId);
    }
    const sortedCopies = [...copies].sort((left, right) =>
      left.localeCompare(right),
    );
    const offset = sortedCopies.length ? rotation % sortedCopies.length : 0;
    const rotatedCopies = [
      ...sortedCopies.slice(offset),
      ...sortedCopies.slice(0, offset),
    ];
    for (const cardId of rotatedCopies) {
      if (deck.length === 15) break;
      const count = counts.get(cardId) ?? 0;
      if (count >= 3 || count >= (poolCounts.get(cardId) ?? 0)) continue;
      counts.set(cardId, count + 1);
      deck.push(cardId);
    }
    return deck;
  };
  const power = (cardId: string): number =>
    Math.max(0, Number(byId.get(cardId)?.powerScore ?? 0));
  const cost = (cardId: string): number =>
    Math.max(0, Number(byId.get(cardId)?.cost ?? 0));
  const ranked = (
    strategy: WorkshopAssessmentDeckStrategy,
    compare: (left: string, right: string) => number,
  ): DeckCandidate => ({
    strategy,
    representedStrategies: [strategy],
    cards: legalDeck([...copies].sort(compare)),
  });
  const coverageCardIds = [...byId.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
  const coverageCandidates = coverageRequirements(coverageCardIds).map(
    (requiredCardIds, index): DeckCandidate => ({
      strategy: `coverage-${index + 1}`,
      representedStrategies: [`coverage-${index + 1}`],
      cards: coverageDeck(requiredCardIds, index),
    }),
  );
  const candidates: DeckCandidate[] = [
    {
      strategy: 'starter',
      representedStrategies: ['starter'],
      cards: [...profession.starterDeck],
    },
    ranked('pool-power', (left, right) =>
      power(right) - power(left) ||
      power(right) / Math.max(1, cardLimit(cost(right))) -
        power(left) / Math.max(1, cardLimit(cost(left))) ||
      cost(left) - cost(right) ||
      left.localeCompare(right),
    ),
    ranked('pool-efficiency', (left, right) =>
      power(right) / (cost(right) + 1) - power(left) / (cost(left) + 1) ||
      power(right) - power(left) ||
      cost(left) - cost(right) ||
      left.localeCompare(right),
    ),
    ...coverageCandidates,
  ];
  const unique = new Map<string, DeckCandidate>();
  for (const candidate of candidates) {
    if (candidate.cards.length !== 15) continue;
    const key = deckKey(candidate.cards);
    const existing = unique.get(key);
    if (existing) existing.representedStrategies.push(candidate.strategy);
    else unique.set(key, candidate);
  }
  const deduped = [...unique.values()];
  const strategies = [
    ...new Set(deduped.flatMap((candidate) => candidate.representedStrategies)),
  ].sort(strategyOrder);
  const coveredCards = new Set(deduped.flatMap((candidate) => candidate.cards));
  if (coverageCardIds.some((cardId) => !coveredCards.has(cardId))) {
    throw new Error('自动评定无法让每张职业卡牌进入测试构筑');
  }
  for (let left = 0; left < coverageCardIds.length; left += 1) {
    for (let right = left + 1; right < coverageCardIds.length; right += 1) {
      const leftId = coverageCardIds[left]!;
      const rightId = coverageCardIds[right]!;
      if (
        !deduped.some(
          (candidate) =>
            candidate.cards.includes(leftId) && candidate.cards.includes(rightId),
        )
      ) {
        throw new Error(`自动评定无法覆盖卡牌组合：${leftId}＋${rightId}`);
      }
    }
  }
  return { candidates: deduped, strategies };
}

function makePhysicalAssessmentRuns(
  deckCandidates: DeckCandidate[],
): PhysicalAssessmentRun[] {
  if (deckCandidates.length < 1 || deckCandidates.length > 6) {
    throw new Error('自动评定构筑因子必须为1至6组');
  }
  const runs: PhysicalAssessmentRun[] = [];
  const rows = Math.max(deckCandidates.length, FIXED_SCENARIOS.length);
  for (let row = 0; row < rows; row += 1) {
    for (
      let attributeIndex = 0;
      attributeIndex < ATTRIBUTE_PROFILES.length;
      attributeIndex += 1
    ) {
      runs.push({
        deckCandidate: deckCandidates[row % deckCandidates.length]!,
        attributeProfile: ATTRIBUTE_PROFILES[attributeIndex]!,
        roundIndex: PAIRWISE_ROUND_INDEX[row]![attributeIndex]!,
        scenarioIndex:
          (3 * row + attributeIndex) % FIXED_SCENARIOS.length,
        horizon: MAX_TURNS,
      });
    }
  }

  const allCardIds = [
    ...new Set(deckCandidates.flatMap((candidate) => candidate.cards)),
  ].sort();
  for (const attributeProfile of ATTRIBUTE_PROFILES) {
    for (const scenarioIndex of [1, 3] as const) {
      const alreadyCovered = new Set(
        runs
          .filter(
            (run) =>
              run.roundIndex === ROUND_SCALES.length - 1 &&
              run.scenarioIndex === scenarioIndex &&
              run.attributeProfile.id === attributeProfile.id,
          )
          .flatMap((run) => run.deckCandidate.cards),
      );
      const missingCardIds = allCardIds.filter(
        (cardId) => !alreadyCovered.has(cardId),
      );
      for (const deckCandidate of minimumDeckCover(
        deckCandidates,
        missingCardIds,
      )) {
        runs.push({
          deckCandidate,
          attributeProfile,
          roundIndex: ROUND_SCALES.length - 1,
          scenarioIndex,
          horizon: BURST_PROBE_TURNS,
        });
      }
    }
  }

  const uniqueRuns = new Map<string, PhysicalAssessmentRun>();
  for (const run of runs) {
    const key = [
      run.roundIndex,
      run.scenarioIndex,
      run.attributeProfile.id,
      deckKey(run.deckCandidate.cards),
      run.horizon,
    ].join('\u0001');
    uniqueRuns.set(key, run);
  }
  const deduped = [...uniqueRuns.values()];
  for (const attributeProfile of ATTRIBUTE_PROFILES) {
    for (const scenarioIndex of [1, 3] as const) {
      const covered = new Set(
        deduped
          .filter(
            (run) =>
              run.roundIndex === ROUND_SCALES.length - 1 &&
              run.scenarioIndex === scenarioIndex &&
              run.attributeProfile.id === attributeProfile.id,
          )
          .flatMap((run) => run.deckCandidate.cards),
      );
      if (allCardIds.some((cardId) => !covered.has(cardId))) {
        throw new Error(
          `顶轮风险探针未覆盖${attributeProfile.label}的全部职业卡牌`,
        );
      }
    }
  }
  return deduped;
}

function minimumDeckCover(
  deckCandidates: readonly DeckCandidate[],
  cardIds: readonly string[],
): DeckCandidate[] {
  if (cardIds.length === 0) return [];
  const coversAll = (selection: readonly DeckCandidate[]): boolean => {
    const covered = new Set(selection.flatMap((candidate) => candidate.cards));
    return cardIds.every((cardId) => covered.has(cardId));
  };
  const search = (
    size: number,
    start: number,
    selection: DeckCandidate[],
  ): DeckCandidate[] | undefined => {
    if (selection.length === size) {
      return coversAll(selection) ? [...selection] : undefined;
    }
    for (
      let index = start;
      index <= deckCandidates.length - (size - selection.length);
      index += 1
    ) {
      selection.push(deckCandidates[index]!);
      const found = search(size, index + 1, selection);
      selection.pop();
      if (found) return found;
    }
    return undefined;
  };
  for (let size = 1; size <= deckCandidates.length; size += 1) {
    const found = search(size, 0, []);
    if (found) return found;
  }
  throw new Error('自动评定无法构造覆盖全部职业卡的顶轮风险探针');
}

function scenarioCoveragePlan(
  runs: readonly PhysicalAssessmentRun[],
  deckStrategies: readonly WorkshopAssessmentDeckStrategy[],
): ScenarioCoveragePlan[][] {
  return ROUND_SCALES.map((_scale, roundIndex) =>
    FIXED_SCENARIOS.map((_spec, scenarioIndex) => {
      const matching = runs.filter(
        (run) =>
          run.roundIndex === roundIndex && run.scenarioIndex === scenarioIndex,
      );
      return {
        deckStrategies: deckStrategies.filter((strategy) =>
          matching.some((run) =>
            run.deckCandidate.representedStrategies.includes(strategy),
          ),
        ),
        attributeProfiles: ATTRIBUTE_PROFILE_IDS.filter((profile) =>
          matching.some((run) => run.attributeProfile.id === profile),
        ),
        runs: matching.map((run) => ({
          deckStrategy: run.deckCandidate.strategy,
          attributeProfile: run.attributeProfile.id,
          horizon: run.horizon,
        })),
      };
    }),
  );
}

export function readWorkshopAssessment(
  profession: WorkshopClass,
): WorkshopAssessmentReport | undefined {
  const hash = workshopCombatHash(profession);
  return readReports().find(
    (entry) =>
      entry.professionId === profession.id &&
      entry.evaluatorVersion === WORKSHOP_ASSESSMENT_VERSION &&
      entry.combatHash === hash &&
      validReport(entry, profession),
  );
}

/**
 * Central activation gate. Only the exact saved candidate represented by a
 * structurally valid, current assessment report may replace an installed pack.
 */
export function activateAssessedWorkshopTestPack(value: unknown): WorkshopPack {
  const normalized = normalizeWorkshopPack(value);
  const testPacks = readWorkshopTestPacks();
  const certifications: NonNullable<WorkshopPack['certifications']> = {};
  for (const profession of normalized.classes) {
    const storedPack = testPacks.find((pack) =>
      pack.classes.some((entry) => entry.id === profession.id),
    );
    const storedProfession = storedPack?.classes.find(
      (entry) => entry.id === profession.id,
    );
    if (!storedPack || !storedProfession) {
      throw new Error(`职业「${profession.name}」不是已保存的测试候选。`);
    }
    registerWorkshopFingerprintContext(
      profession,
      (normalized.mechanisms ?? []).filter((entry) =>
        (profession.mechanismIds ?? []).includes(entry.id),
      ),
    );
    registerWorkshopFingerprintContext(
      storedProfession,
      (storedPack.mechanisms ?? []).filter((entry) =>
        (storedProfession.mechanismIds ?? []).includes(entry.id),
      ),
    );
    if (
      workshopCombatHash(profession) !==
      workshopCombatHash(storedProfession)
    ) {
      throw new Error(`职业「${profession.name}」的候选内容已变化，请重新评定。`);
    }
    const report = readWorkshopAssessment(profession);
    if (!report?.passed) {
      throw new Error(
        `职业「${profession.name}」没有与当前内容匹配的通过评定，暂不能启用。`,
      );
    }
    certifications[profession.id] = {
      evaluatorVersion: WORKSHOP_ASSESSMENT_VERSION,
      combatHash: workshopCombatHash(profession),
    };
  }
  return saveWorkshopPack({ ...normalized, certifications });
}

function cardOrder(
  state: LocalBattleState,
  cards: Map<string, CardDefinition>,
  successfulCardIds: ReadonlySet<string>,
): number[] {
  return state.player.hand
    .map((entry, index) => {
      const card = cards.get(entry.cardId);
      return {
        index,
        id: entry.cardId,
        alreadySuccessful: successfulCardIds.has(entry.cardId),
        cost: Math.max(0, Number(card?.cost ?? 0)),
        power: Math.max(0, Number(card?.powerScore ?? 0)),
      };
    })
    .sort(
      (left, right) =>
        Number(left.alreadySuccessful) - Number(right.alreadySuccessful) ||
        right.power / (right.cost + 1) - left.power / (left.cost + 1) ||
        right.power - left.power ||
        left.cost - right.cost ||
        left.id.localeCompare(right.id),
    )
    .map((entry) => entry.index);
}

function unsafeReason(state: LocalBattleState): string | undefined {
  const mechanisms = state.workshopMechanisms;
  if (mechanisms?.disabled?.length) {
    return `底层机制在测试中被停用：${mechanisms.disabled.join('、')}`;
  }
  const failed = Object.entries(mechanisms?.errors ?? {}).filter(
    ([, count]) => count > 0,
  );
  if (failed.length) {
    return `底层机制执行报错：${failed.map(([id]) => id).join('、')}`;
  }
  return undefined;
}

function accepted(result: { status: string }): boolean {
  return result.status === 'applied' || result.status === 'duplicate';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const EXPECTED_UNPLAYABLE_CARD_ERRORS: readonly RegExp[] = [
  /^行动点不足$/,
  /^魔力不足$/,
  /^空白牌无法打出/,
  /^冰冻中：只能使用净化类卡牌$/,
  /^缠绕中：无法使用攻击类卡牌$/,
  /^吟诵队列已满/,
  /^「.+」需要 \d+ 张可弃置的非空白手牌$/,
  /^没有圣印/,
  /^雷荷充能不足/,
  /^生长不足/,
  /^零件不足/,
  /^没有零件/,
  /^场上没有可摧毁的(?:机械)?召唤物$/,
  /^生命值不足：烧血结算后必须至少保留 1HP/,
  /^请先完成当前占星选牌$/,
];

function isExpectedUnplayableCardError(error: unknown): boolean {
  const message = errorText(error);
  return EXPECTED_UNPLAYABLE_CARD_ERRORS.some((pattern) => pattern.test(message));
}

async function finishAssessmentBattle(
  api: AssessmentApi,
  knownBattleId?: string,
  knownStatus?: LocalBattleState['status'],
): Promise<void> {
  const failures: string[] = [];
  let battleId = knownBattleId;
  let status = knownStatus;
  try {
    const snapshot = await api.query('state');
    if (snapshot.battle && (!battleId || snapshot.battle.id === battleId)) {
      battleId = snapshot.battle.id;
      status = snapshot.battle.state.status;
    }
  } catch (error) {
    failures.push(`读取待清理战斗失败：${errorText(error)}`);
  }
  if (!battleId) {
    throw new Error(
      `自动评定战斗已启动但无法取得会话编号；${failures.join('；')}`,
    );
  }

  if (status === undefined || status === 'ongoing') {
    try {
      const cancelled = await api.execute({
        id: commandId('workshop-assessment-cancel'),
        type: 'battle.cancel-workshop-test',
        payload: { battleId },
      });
      if (!accepted(cancelled)) {
        failures.push(`取消测试战斗失败：${cancelled.message ?? cancelled.status}`);
      }
    } catch (error) {
      failures.push(`取消测试战斗失败：${errorText(error)}`);
    }
  }
  try {
    const finished = await api.execute({
      id: commandId('workshop-assessment-finish'),
      type: 'battle.finish',
      payload: { battleId },
    });
    if (!accepted(finished)) {
      failures.push(`结束测试战斗失败：${finished.message ?? finished.status}`);
    }
  } catch (error) {
    failures.push(`结束测试战斗失败：${errorText(error)}`);
  }
  try {
    const verified = await api.query('state');
    if (verified.battle?.id === battleId) {
      failures.push('清理验证失败：测试战斗仍处于活动状态');
    }
  } catch (error) {
    failures.push(`清理验证查询失败：${errorText(error)}`);
  }
  if (failures.length) {
    throw new Error(`自动评定战斗清理不完整：${failures.join('；')}`);
  }
}

async function resolvePendingCardChoices(
  api: AssessmentApi,
  snapshot: GameSnapshot,
  battleId: string,
  scenarioId: string,
): Promise<GameSnapshot> {
  let resolved = 0;
  while (
    snapshot.battle?.id === battleId &&
    snapshot.battle.state.status === 'ongoing' &&
    snapshot.battle.state.player.pendingCardChoice
  ) {
    if (resolved >= MAX_PENDING_CHOICES) {
      throw new Error('自动评定的战斗选牌超过安全上限');
    }
    const pending = snapshot.battle.state.player.pendingCardChoice;
    const choiceIndex = pending.choices.findIndex(
      (_cardId, index) => !pending.picked.includes(index),
    );
    if (choiceIndex < 0) throw new Error('自动评定无法找到尚未选择的占星候选牌');
    const chosen = await api.execute({
      id: commandId(`workshop-assessment-choice-${scenarioId}`),
      type: 'battle.choose-astrology-card',
      payload: { battleId, choiceIndex },
    });
    if (!accepted(chosen)) {
      throw new Error(chosen.message ?? '自动评定无法完成占星选牌');
    }
    snapshot = await api.query('state');
    resolved += 1;
  }
  return snapshot;
}

async function runScenario(
  api: AssessmentApi,
  profession: WorkshopClass,
  input: {
    id: string;
    round: number;
    mode: 'random-single' | 'random-multi';
    tier: 'low' | 'high';
    scale: number;
    seed: number;
    deadline: number;
    deckStrategy: WorkshopAssessmentDeckStrategy;
    deckIds: string[];
    attributeProfile: WorkshopAssessmentAttributeProfile;
    horizon: 3 | 10;
    successfulCardIds: Set<string>;
  },
): Promise<WorkshopAssessmentScenario> {
  let battleStarted = false;
  let snapshot: GameSnapshot | undefined;
  try {
    const started = await api.execute({
      id: commandId(`workshop-assessment-start-${input.id}`),
      type: 'battle.start',
      payload: {
        source: `创意工坊自动评定 · 第 ${input.round} 轮 · ${input.deckStrategy} · ${input.attributeProfile.id}`,
        workshopTest: {
          professionId: profession.id,
          deckIds: [...input.deckIds],
          mechanismIds: [...(profession.mechanismIds ?? [])],
          opponentMode: input.mode,
          randomTier: input.tier,
          randomSeed: input.seed,
          enemyScale: input.scale,
          dummyCount: input.mode === 'random-multi' ? 3 : 1,
          dummyHp: 1,
          dummyAttack: 0,
          dummyDefense: 0,
          dummyInvincible: false,
          dummyAttackEnabled: true,
          autoRespawn: false,
          playerInvincible: false,
          attributes: { ...input.attributeProfile.attributes },
        },
      },
    });
    if (!accepted(started)) {
      throw new Error(started.message ?? '自动评定战斗启动失败');
    }
    battleStarted = true;

    snapshot = await api.query('state');
    const initial = snapshot.battle?.state;
    if (!initial?.workshopTest) throw new Error('自动评定未能建立隔离战斗');
    const battleId = snapshot.battle!.id;
    snapshot = await resolvePendingCardChoices(api, snapshot, battleId, input.id);
    const initialEnemyHp = initial.enemies.reduce(
      (sum, enemy) => sum + Math.max(1, enemy.hpMax),
      0,
    );
    const enemyNames = initial.enemies.map((enemy) => enemy.name);
    const cards = new Map(
      Object.entries(initial.workshopTest.candidateCards ?? {}).map(
        ([cardId, card]) => [cardId, card as CardDefinition],
      ),
    );
    let detectedUnsafe: string | undefined;

    while (
      snapshot.battle?.state.status === 'ongoing' &&
      snapshot.battle.state.turn <= input.horizon
    ) {
      if (Date.now() > input.deadline) {
        detectedUnsafe = `自动评定超过 ${MAX_ASSESSMENT_MS / 1000} 秒安全时限`;
        break;
      }
      snapshot = await resolvePendingCardChoices(
        api,
        snapshot,
        battleId,
        input.id,
      );
      let actions = 0;
      while (
        snapshot.battle?.state.status === 'ongoing' &&
        snapshot.battle.state.phase === 'player' &&
        actions <= MAX_ACTIONS_PER_TURN
      ) {
        const state = snapshot.battle.state;
        detectedUnsafe = unsafeReason(state);
        if (detectedUnsafe) break;
        const targets = state.enemies
          .map((enemy, index) => ({ enemy, index }))
          .filter(({ enemy }) => enemy.hp > 0)
          .map(({ index }) => index);
        let played = false;
        for (const handIndex of cardOrder(state, cards, input.successfulCardIds)) {
          const cardId = state.player.hand[handIndex]?.cardId;
          if (!cardId) continue;
          for (const targetIndex of targets.length ? targets : [0]) {
            let result: Awaited<ReturnType<AssessmentApi['execute']>>;
            try {
              result = await api.execute({
                id: commandId(`workshop-assessment-play-${input.id}`),
                type: 'battle.play-card',
                payload: { battleId, handIndex, targetIndex },
              });
            } catch (error) {
              // A temporarily illegal card (AP/MP, discard, summon or status
              // prerequisite) is explored again after other cards/turns.
              if (isExpectedUnplayableCardError(error)) continue;
              throw error;
            }
            if (!accepted(result)) {
              if (isExpectedUnplayableCardError(result.message)) continue;
              throw new Error(result.message ?? '自动评定出牌命令被未知原因拒绝');
            }
            played = true;
            actions += 1;
            input.successfulCardIds.add(cardId);
            snapshot = await api.query('state');
            snapshot = await resolvePendingCardChoices(
              api,
              snapshot,
              battleId,
              input.id,
            );
            if (actions > MAX_ACTIONS_PER_TURN) {
              detectedUnsafe = `单回合可成功出牌超过${MAX_ACTIONS_PER_TURN}次，已触发行动循环安全上限`;
            }
            break;
          }
          if (played) break;
        }
        if (!played || detectedUnsafe) break;
      }
      if (detectedUnsafe || snapshot.battle?.state.status !== 'ongoing') break;
      snapshot = await resolvePendingCardChoices(
        api,
        snapshot,
        battleId,
        input.id,
      );
      const ended = await api.execute({
        id: commandId(`workshop-assessment-end-${input.id}`),
        type: 'battle.end-turn',
        payload: { battleId },
      });
      if (!accepted(ended)) {
        throw new Error(ended.message ?? '自动评定无法结束回合');
      }
      snapshot = await api.query('state');
      snapshot = await resolvePendingCardChoices(
        api,
        snapshot,
        battleId,
        input.id,
      );
      detectedUnsafe = snapshot.battle
        ? unsafeReason(snapshot.battle.state)
        : undefined;
      if (detectedUnsafe) break;
    }

    const state = snapshot.battle?.state;
    if (!state) throw new Error('自动评定战斗状态丢失');
    const remainingEnemyHp = state.enemies.reduce(
      (sum, enemy) => sum + Math.max(0, enemy.hp),
      0,
    );
    return {
      id: input.id,
      round: input.round,
      mode: input.mode,
      tier: input.tier,
      enemyScale: input.scale,
      seed: input.seed,
      victory: state.status === 'victory',
      turns: state.turn,
      enemyNames,
      remainingPlayerHpRatio:
        state.player.hpMax > 0
          ? Math.max(0, Math.min(1, state.player.hp / state.player.hpMax))
          : 0,
      damageRatio: Math.max(
        0,
        Math.min(1, 1 - remainingEnemyHp / Math.max(1, initialEnemyHp)),
      ),
      deckStrategy: input.deckStrategy,
      attributeProfile: input.attributeProfile.id,
      testedDeckStrategies: [input.deckStrategy],
      testedAttributeProfiles: [input.attributeProfile.id],
      victoriousAttributeProfiles:
        state.status === 'victory' ? [input.attributeProfile.id] : [],
      burstVictoriousAttributeProfiles:
        state.status === 'victory' && state.turn <= BURST_PROBE_TURNS
          ? [input.attributeProfile.id]
          : [],
      runEvidence: [
        {
          deckStrategy: input.deckStrategy,
          attributeProfile: input.attributeProfile.id,
          horizon: input.horizon,
          victory: state.status === 'victory',
          burstVictory:
            state.status === 'victory' && state.turn <= BURST_PROBE_TURNS,
          turns: state.turn,
        },
      ],
      successfulCardIds: [...input.successfulCardIds].sort(),
      ...(detectedUnsafe ? { unsafeReason: detectedUnsafe } : {}),
    };
  } finally {
    if (battleStarted) {
      await finishAssessmentBattle(
        api,
        snapshot?.battle?.id,
        snapshot?.battle?.state.status,
      );
    }
  }
}

function topRoundRiskProfile(
  rounds: WorkshopAssessmentRound[],
): WorkshopAssessmentAttributeProfileId | undefined {
  const topRound = rounds[2];
  const highSingle = topRound?.scenarios.find(
    (scenario) => scenario.tier === 'high' && scenario.mode === 'random-single',
  );
  const highMulti = topRound?.scenarios.find(
    (scenario) => scenario.tier === 'high' && scenario.mode === 'random-multi',
  );
  return ATTRIBUTE_PROFILE_IDS.find(
    (profile) =>
      highSingle?.burstVictoriousAttributeProfiles.includes(profile) &&
      highMulti?.burstVictoriousAttributeProfiles.includes(profile),
  );
}

function resultRange(rounds: WorkshopAssessmentRound[]): [number, number] {
  if (rounds[2]?.passed || topRoundRiskProfile(rounds)) return [1.35, 2.5];
  if (rounds[1]?.passed) return [1.1, 1.35];
  if (rounds[0]?.passed) return [0.85, 1.1];
  return [0.5, 0.85];
}

function reportStatus(
  rounds: WorkshopAssessmentRound[],
  unsafeReason?: string,
): WorkshopAssessmentStatus {
  if (unsafeReason) return 'unsafe';
  if (rounds[2]?.passed || topRoundRiskProfile(rounds)) return 'overpowered';
  if (rounds[1]?.passed) return 'strong';
  if (rounds[0]?.passed) return 'balanced';
  return 'underpowered';
}

function betterScenario(
  candidate: WorkshopAssessmentScenario,
  current: WorkshopAssessmentScenario | undefined,
): boolean {
  if (!current) return true;
  if (candidate.victory !== current.victory) return candidate.victory;
  if (candidate.victory && candidate.turns !== current.turns) {
    return candidate.turns < current.turns;
  }
  if (candidate.damageRatio !== current.damageRatio) {
    return candidate.damageRatio > current.damageRatio;
  }
  if (candidate.remainingPlayerHpRatio !== current.remainingPlayerHpRatio) {
    return candidate.remainingPlayerHpRatio > current.remainingPlayerHpRatio;
  }
  return candidate.turns < current.turns;
}

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

async function createIsolatedHarness(
  api: AssessmentApi,
  scenarioKey: string,
): Promise<IsolatedAssessmentHarness | undefined> {
  if (typeof api.getRuntimeInfo !== 'function') return undefined;
  const runtime = api.getRuntimeInfo();
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${scenarioKey.replace(/[^a-z0-9-]/gi, '-')}`;
  const database = new CaelianDatabase(
    runtime.channel,
    `caelian-workshop-assessment-${runtime.channel}-${suffix}`,
  );
  const setup = new GameRepository(database, new EventBus(), {
    random: deterministicRandom(1),
  });
  try {
    const profile = await setup.ensureProfile(`workshop-assessment:${suffix}`);
    const created = await setup.execute(profile.id, {
      id: commandId('workshop-assessment-create-player'),
      type: 'player.create',
      payload: {
        name: '创意工坊自动评定',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    if (!accepted(created)) {
      throw new Error(created.message ?? '无法初始化自动评定角色');
    }
    return {
      apiForSeed(seed: number): AssessmentApi {
        const repository = new GameRepository(database, new EventBus(), {
          random: deterministicRandom(seed),
        });
        return {
          execute: (command: unknown) => repository.execute(profile.id, command),
          query: async (name: 'state') => {
            if (name !== 'state') throw new Error(`不支持的测试查询：${name}`);
            return repository.snapshot(profile.id);
          },
        };
      },
      async dispose(): Promise<void> {
        database.close();
        await database.delete();
      },
    };
  } catch (error) {
    database.close();
    await database.delete();
    throw error;
  }
}

async function evaluateScenario(
  api: AssessmentApi,
  profession: WorkshopClass,
  physicalRuns: PhysicalAssessmentRun[],
  deckStrategies: WorkshopAssessmentDeckStrategy[],
  spec: ScenarioSpec,
  round: number,
  scale: number,
  deadline: number,
  onRunComplete: () => void,
): Promise<WorkshopAssessmentScenario> {
  const id = `r${round}-${spec.key}`;
  const isolated = await createIsolatedHarness(api, id);
  let best: WorkshopAssessmentScenario | undefined;
  let unsafeResult: WorkshopAssessmentScenario | undefined;
  const testedDecks: WorkshopAssessmentDeckStrategy[] = [];
  const testedAttributes: WorkshopAssessmentAttributeProfileId[] = [];
  const victoriousAttributes = new Set<WorkshopAssessmentAttributeProfileId>();
  const burstVictoriousAttributes =
    new Set<WorkshopAssessmentAttributeProfileId>();
  const runEvidence: WorkshopAssessmentRunEvidence[] = [];
  const successfulCardIds = new Set<string>();
  try {
    for (const physicalRun of physicalRuns) {
      if (Date.now() > deadline) {
        throw new Error(
          `自动评定超过 ${MAX_ASSESSMENT_MS / 1000} 秒安全时限，已停止后续场次`,
        );
      }
      const { attributeProfile, deckCandidate } = physicalRun;
      const scenarioApi = isolated?.apiForSeed(spec.seed) ?? api;
      const candidate = await runScenario(scenarioApi, profession, {
        ...spec,
        id,
        round,
        scale,
        deadline,
        deckStrategy: deckCandidate.strategy,
        deckIds: deckCandidate.cards,
        attributeProfile,
        horizon: physicalRun.horizon,
        successfulCardIds,
      });
      runEvidence.push(...candidate.runEvidence);
      for (const strategy of deckCandidate.representedStrategies) {
        if (!testedDecks.includes(strategy)) testedDecks.push(strategy);
      }
      if (!testedAttributes.includes(attributeProfile.id)) {
        testedAttributes.push(attributeProfile.id);
      }
      if (candidate.victory) victoriousAttributes.add(attributeProfile.id);
      if (
        candidate.runEvidence.some((evidence) => evidence.burstVictory)
      ) {
        burstVictoriousAttributes.add(attributeProfile.id);
      }
      onRunComplete();
      if (candidate.unsafeReason) unsafeResult ??= candidate;
      else if (betterScenario(candidate, best)) best = candidate;
    }
  } finally {
    await isolated?.dispose();
  }
  const selected = unsafeResult ?? best;
  if (!selected) throw new Error('自动评定没有产生有效的实战结果');
  return {
    ...selected,
    testedDeckStrategies: deckStrategies.filter((strategy) =>
      testedDecks.includes(strategy),
    ),
    testedAttributeProfiles: ATTRIBUTE_PROFILE_IDS.filter((profile) =>
      testedAttributes.includes(profile),
    ),
    victoriousAttributeProfiles: ATTRIBUTE_PROFILE_IDS.filter((profile) =>
      victoriousAttributes.has(profile),
    ),
    burstVictoriousAttributeProfiles: ATTRIBUTE_PROFILE_IDS.filter((profile) =>
      burstVictoriousAttributes.has(profile),
    ),
    runEvidence,
    successfulCardIds: [...successfulCardIds].sort(),
  };
}

async function runScenarioBatch(
  tasks: Array<() => Promise<WorkshopAssessmentScenario>>,
  parallel: boolean,
): Promise<WorkshopAssessmentScenario[]> {
  if (!parallel) {
    const scenarios: WorkshopAssessmentScenario[] = [];
    for (const task of tasks) scenarios.push(await task());
    return scenarios;
  }
  const settled = await Promise.allSettled(tasks.map((task) => task()));
  const failure = settled.find(
    (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
  );
  if (failure) throw failure.reason;
  return settled.map(
    (entry) =>
      (entry as PromiseFulfilledResult<WorkshopAssessmentScenario>).value,
  );
}

export async function assessWorkshopProfession(
  api: AssessmentApi,
  profession: WorkshopClass,
  onProgress?: (completed: number, total: number) => void,
): Promise<WorkshopAssessmentReport> {
  const existing = await api.query('state');
  if (existing.battle) {
    throw new Error('请先结束并关闭当前战斗，再进行职业自动评定。');
  }
  const deckPlan = makeDeckPlan(profession);
  const deckCandidates = deckPlan.candidates;
  if (!deckCandidates.some((candidate) => candidate.strategy === 'starter')) {
    throw new Error('自动评定无法构造合法的 15 张测试牌组');
  }
  const physicalRuns = makePhysicalAssessmentRuns(deckCandidates);
  const total = physicalRuns.length;
  const deadline = Date.now() + MAX_ASSESSMENT_MS;
  const rounds: WorkshopAssessmentRound[] = [];
  let completed = 0;
  let detectedUnsafe: string | undefined;
  const canRunIsolatedScenariosInParallel =
    typeof api.getRuntimeInfo === 'function';
  const scenarioResults = await runScenarioBatch(
    ROUND_SCALES.flatMap((scale, roundIndex) =>
      FIXED_SCENARIOS.map((spec, scenarioIndex) => {
        const round = roundIndex + 1;
        const logicalRuns = physicalRuns.filter(
          (run) =>
            run.roundIndex === roundIndex &&
            run.scenarioIndex === scenarioIndex,
        );
        return () =>
          evaluateScenario(
            api,
            profession,
            logicalRuns,
            deckPlan.strategies,
            spec,
            round,
            scale,
            deadline,
            () => {
              completed += 1;
              onProgress?.(completed, total);
            },
          );
      }),
    ),
    canRunIsolatedScenariosInParallel,
  );
  for (let roundIndex = 0; roundIndex < ROUND_SCALES.length; roundIndex += 1) {
    const round = roundIndex + 1;
    const scale = ROUND_SCALES[roundIndex]!;
    const scenarios = scenarioResults.slice(
      roundIndex * FIXED_SCENARIOS.length,
      (roundIndex + 1) * FIXED_SCENARIOS.length,
    );
    detectedUnsafe ??= scenarios.find((scenario) => scenario.unsafeReason)
      ?.unsafeReason;
    const victories = scenarios.filter((scenario) => scenario.victory).length;
    rounds.push({
      round,
      enemyScale: scale,
      victories,
      passed: scenarios.length === FIXED_SCENARIOS.length && victories >= 3,
      scenarios,
    });
  }

  const strengthRange = resultRange(rounds);
  const successfulCardIds = [
    ...new Set(
      rounds.flatMap((round) =>
        round.scenarios.flatMap((scenario) => scenario.successfulCardIds),
      ),
    ),
  ].sort();
  const missingCardIds = profession.cards
    .map((card) => card.id)
    .filter((cardId) => !successfulCardIds.includes(cardId));
  if (missingCardIds.length) {
    const missingNames = missingCardIds.map(
      (cardId) => profession.cards.find((card) => card.id === cardId)?.name ?? cardId,
    );
    detectedUnsafe ??= `以下职业卡未能在有限输入空间测试中成功执行：${missingNames.join('、')}`;
  }
  const status = reportStatus(rounds, detectedUnsafe);
  return saveWorkshopAssessment({
    schemaVersion: 1,
    evaluatorVersion: WORKSHOP_ASSESSMENT_VERSION,
    professionId: profession.id,
    combatHash: workshopCombatHash(profession),
    status,
    passed: !detectedUnsafe && status !== 'overpowered',
    strengthRange,
    attributeBudget: WORKSHOP_ASSESSMENT_ATTRIBUTE_BUDGET,
    attributeProfiles: ATTRIBUTE_PROFILES.map((profile) => ({
      ...profile,
      attributes: { ...profile.attributes },
    })),
    deckStrategies: [...deckPlan.strategies],
    successfulCardIds,
    rounds,
    testedAt: Date.now(),
    ...(detectedUnsafe ? { unsafeReason: detectedUnsafe } : {}),
  }, profession);
}
