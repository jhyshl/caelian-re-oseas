import { z } from 'zod';

const shortText = z.string().trim().min(1).max(240);
const longText = z.string().trim().min(1).max(8_000);
const sourceText = z.string().trim().min(1).max(20_000);

const questItemSchema = z.object({
  itemId: z.string().trim().min(1).max(160),
  itemName: z.string().trim().min(1).max(160),
  count: z.number().int().min(1).max(999_999),
});

const questJudgeGiftSchema = z.object({
  itemId: z.string().trim().min(1).max(160),
  count: z.number().int().min(1).max(999_999),
});

const questEquipmentSchema = z.object({
  baseId: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160),
  slot: z.enum(['weapon', 'armor', 'accessory']),
  rarity: z.string().trim().min(1).max(80),
  stars: z.number().int().min(1).max(5),
  count: z.number().int().min(1).max(20),
  stats: z.record(z.string(), z.number()).default({}),
  description: z.string().trim().min(1).max(1_000),
});

const localQuestTriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('inventory_at_least'),
    ...questItemSchema.shape,
  }),
  z.object({
    type: z.literal('submit_item'),
    ...questItemSchema.shape,
  }),
  z.object({
    type: z.literal('claim_items'),
    items: z.array(questItemSchema).min(1).max(20),
  }),
  z.object({
    type: z.literal('claim_equipment'),
    equipment: questEquipmentSchema,
  }),
  z.object({
    type: z.literal('parallel_scenes_complete'),
    sceneIds: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  }),
  z.object({
    type: z.literal('battle_won'),
    monsterId: z.string().trim().min(1).max(160),
  }),
  z.object({
    type: z.literal('confirm'),
  }),
]);

export const questTransitionSchema = z.object({
  id: z.string().trim().min(1).max(160),
  to: z.string().trim().min(1).max(160),
  authority: z.enum(['judge', 'local']),
  condition: z.string().trim().min(1).max(1_500),
  minConfidence: z.number().min(0).max(1).default(0.82),
  localTrigger: localQuestTriggerSchema.optional(),
  effects: z
    .object({
      completeSceneId: z.string().trim().min(1).max(120).optional(),
      ending: z.string().trim().min(1).max(40).optional(),
    })
    .optional(),
  guards: z
    .object({
      incompleteSceneId: z.string().trim().min(1).max(120).optional(),
      completedSceneIds: z
        .array(z.string().trim().min(1).max(120))
        .max(20)
        .optional(),
    })
    .optional(),
});

const questRequiredActionSchema = z.object({
  type: z.enum([
    'submit_item',
    'claim_items',
    'claim_equipment',
    'confirm',
    'start_battle',
  ]),
  label: z.string().trim().min(1).max(120),
  transitionId: z.string().trim().min(1).max(160).optional(),
  itemId: z.string().trim().min(1).max(160).optional(),
  itemName: z.string().trim().min(1).max(160).optional(),
  count: z.number().int().min(1).max(999_999).optional(),
  items: z.array(questItemSchema).min(1).max(20).optional(),
  equipment: questEquipmentSchema.optional(),
  monsterId: z.string().trim().min(1).max(160).optional(),
  battleCount: z.number().int().min(1).max(12).optional(),
  battleReason: z.string().trim().min(1).max(600).optional(),
  openPanel: z.enum(['deck', 'inventory', 'battle', 'market']).optional(),
});

export const questNodeSchema = z.object({
  id: z.string().trim().min(1).max(160),
  stage: z.number().int().min(0).max(9_999),
  stageId: z.string().trim().min(1).max(120),
  stageTitle: shortText,
  sceneId: z.string().trim().min(1).max(120),
  sceneTitle: shortText,
  beatIndex: z.number().int().min(0).max(9_999),
  title: shortText,
  roadmapSummary: z.string().trim().min(1).max(500),
  objective: z.string().trim().min(1).max(800),
  purpose: longText,
  completionGate: z.string().trim().min(1).max(2_000),
  locations: z.array(shortText).max(20).default([]),
  sceneContext: longText,
  sourceMaterial: sourceText,
  availableClues: z.array(z.string().trim().min(1).max(1_000)).max(50),
  forbiddenFacts: z.array(z.string().trim().min(1).max(1_000)).max(50),
  transitions: z.array(questTransitionSchema).max(30),
  status: z.enum(['active', 'ready', 'failed']).default('active'),
  ending: z.string().trim().min(1).max(40).optional(),
  requiredAction: questRequiredActionSchema.optional(),
  parallelGroupId: z.string().trim().min(1).max(120).optional(),
});

const questRewardSchema = z.object({
  experience: z.number().int().min(0),
  gold: z.number().int().min(0),
  guildExperience: z.number().int().min(0),
  collectibles: z.array(shortText).max(20).default([]),
});

const pacingPolicySchema = z.object({
  fullRoadmapVisible: z.boolean().default(true),
  currentBeatDetail: z.literal('full').default('full'),
  futureBeatDetail: z.literal('summary_locked').default('summary_locked'),
  defaultAdvance: z.literal(0).default(0),
  maxBeatAdvance: z.literal(1).default(1),
  maxSceneAdvance: z.literal(0).default(0),
  maxStageAdvance: z.literal(0).default(0),
});

const questDefinitionBaseSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['main', 'side', 'commission']),
  region: z.string().trim().min(1).max(120),
  availableRegions: z.array(shortText).min(1).max(20),
  visibility: z.enum(['public', 'rumor', 'hidden']),
  publicSummary: z.string().trim().min(1).max(500),
  minimumLevel: z.number().int().min(1).max(999),
  prerequisiteQuestIds: z
    .array(z.string().trim().min(1).max(160))
    .max(20)
    .default([]),
  rewards: z.object({
    default: questRewardSchema,
    endings: z.record(z.string().trim().min(1).max(40), questRewardSchema),
  }),
  pacing: pacingPolicySchema,
  nodeAliases: z.record(z.string(), z.string()).default({}),
});

export const questDefinitionSchema = questDefinitionBaseSchema
  .extend({
    startNodeId: z.string().trim().min(1).max(160),
    nodes: z.array(questNodeSchema).min(1).max(1_000),
  })
  .superRefine((quest, context) => {
    const nodeIds = new Set<string>();
    for (const [nodeIndex, node] of quest.nodes.entries()) {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: 'custom',
          message: `任务 ${quest.id} 存在重复节拍 ${node.id}`,
          path: ['nodes', nodeIndex, 'id'],
        });
      }
      nodeIds.add(node.id);
    }
    if (!nodeIds.has(quest.startNodeId)) {
      context.addIssue({
        code: 'custom',
        message: `任务 ${quest.id} 的起始节拍不存在`,
        path: ['startNodeId'],
      });
    }
    for (const [alias, target] of Object.entries(quest.nodeAliases)) {
      if (!alias.trim() || !nodeIds.has(target)) {
        context.addIssue({
          code: 'custom',
          message: `任务 ${quest.id} 的旧节点别名 ${alias} 指向不存在的节拍 ${target}`,
          path: ['nodeAliases', alias],
        });
      }
    }
    for (const [nodeIndex, node] of quest.nodes.entries()) {
      const transitionIds = new Set<string>();
      for (const [transitionIndex, transition] of node.transitions.entries()) {
        if (transitionIds.has(transition.id)) {
          context.addIssue({
            code: 'custom',
            message: `节拍 ${node.id} 存在重复跳转 ${transition.id}`,
            path: ['nodes', nodeIndex, 'transitions', transitionIndex, 'id'],
          });
        }
        transitionIds.add(transition.id);
        if (!nodeIds.has(transition.to)) {
          context.addIssue({
            code: 'custom',
            message: `跳转 ${transition.id} 指向不存在的节拍 ${transition.to}`,
            path: ['nodes', nodeIndex, 'transitions', transitionIndex, 'to'],
          });
        }
        if (transition.authority === 'local' && !transition.localTrigger) {
          context.addIssue({
            code: 'custom',
            message: `本地跳转 ${transition.id} 缺少结构化触发条件`,
            path: ['nodes', nodeIndex, 'transitions', transitionIndex],
          });
        }
        if (transition.authority === 'judge' && transition.localTrigger) {
          context.addIssue({
            code: 'custom',
            message: `判定器跳转 ${transition.id} 不能声明本地触发条件`,
            path: ['nodes', nodeIndex, 'transitions', transitionIndex],
          });
        }
      }
      if (node.requiredAction?.type !== 'start_battle') {
        if (
          node.requiredAction &&
          !node.requiredAction.transitionId
        ) {
          context.addIssue({
            code: 'custom',
            message: `节拍 ${node.id} 的本地动作缺少跳转编号`,
            path: ['nodes', nodeIndex, 'requiredAction', 'transitionId'],
          });
        }
      }
      if (node.requiredAction?.transitionId) {
        const transition = node.transitions.find(
          (candidate) => candidate.id === node.requiredAction?.transitionId,
        );
        if (!transition || transition.authority !== 'local') {
          context.addIssue({
            code: 'custom',
            message: `节拍 ${node.id} 的交互动作没有对应本地跳转`,
            path: ['nodes', nodeIndex, 'requiredAction', 'transitionId'],
          });
        }
      }
    }
    if (!quest.nodes.some((node) => node.status !== 'active')) {
      context.addIssue({
        code: 'custom',
        message: `任务 ${quest.id} 缺少结束或待结算节拍`,
        path: ['nodes'],
      });
    }
  });

const authoredBeatSchema = z.object({
  id: z.string().trim().min(1).max(160),
  title: shortText,
  roadmapSummary: z.string().trim().min(1).max(500).optional(),
  objective: z.string().trim().min(1).max(800).optional(),
  purpose: longText,
  completionGate: z.string().trim().min(1).max(2_000),
  locations: z.array(shortText).max(20).optional(),
  sceneContext: longText.optional(),
  sourceMaterial: sourceText.optional(),
  availableClues: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  forbiddenFacts: z.array(z.string().trim().min(1).max(1_000)).max(50).default([]),
  transitions: z.array(questTransitionSchema).max(30).default([]),
  status: z.enum(['active', 'ready', 'failed']).default('active'),
  ending: z.string().trim().min(1).max(40).optional(),
  requiredAction: questRequiredActionSchema.optional(),
});

const authoredSceneSchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: shortText,
  locations: z.array(shortText).max(20).default([]),
  sourceMaterial: sourceText.optional(),
  parallelGroupId: z.string().trim().min(1).max(120).optional(),
  beats: z.array(authoredBeatSchema).min(1).max(500),
});

const authoredStageSchema = z.object({
  number: z.number().int().min(0).max(9_999),
  id: z.string().trim().min(1).max(120),
  title: shortText,
  mode: z.enum(['linear', 'parallel']).default('linear'),
  scenes: z.array(authoredSceneSchema).min(1).max(100),
});

const authoredQuestDefinitionSchema = questDefinitionBaseSchema.extend({
  startBeatId: z.string().trim().min(1).max(160),
  stages: z.array(authoredStageSchema).min(1).max(100),
});

const authoredCatalogSchema = z.object({
  schemaVersion: z.literal(2),
  channel: z.literal('alpha'),
  revision: z.string().trim().min(1).max(120),
  quests: z.array(authoredQuestDefinitionSchema).max(2_000),
});

const legacyNodeSchema = z.object({
  id: z.string().trim().min(1).max(160),
  stage: z.number().int().min(0).max(9_999),
  title: shortText,
  objective: z.string().trim().min(1).max(800),
  locations: z.array(shortText).max(20).default([]),
  sceneContext: longText,
  availableClues: z.array(z.string().trim().min(1).max(1_000)).max(50),
  forbiddenFacts: z.array(z.string().trim().min(1).max(1_000)).max(50),
  transitions: z.array(questTransitionSchema).max(30),
  status: z.enum(['active', 'ready', 'failed']).default('active'),
  ending: z.string().trim().min(1).max(40).optional(),
  requiredAction: z
    .object({
      type: z.enum(['submit_item', 'confirm']),
      transitionId: z.string().trim().min(1).max(160),
      itemId: z.string().trim().min(1).max(160).optional(),
      itemName: z.string().trim().min(1).max(160).optional(),
      count: z.number().int().min(1).max(999_999).optional(),
    })
    .optional(),
});

const legacyCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  channel: z.literal('alpha'),
  revision: z.string().trim().min(1).max(120),
  quests: z.array(
    z.object({
      id: z.string().trim().min(1).max(160),
      name: z.string().trim().min(1).max(160),
      kind: z.enum(['main', 'side', 'commission']),
      region: z.string().trim().min(1).max(120),
      visibility: z.enum(['public', 'rumor', 'hidden']),
      publicSummary: z.string().trim().min(1).max(500),
      minimumLevel: z.number().int().min(1).max(999),
      startNodeId: z.string().trim().min(1).max(160),
      rewards: z.object({
        default: questRewardSchema,
        endings: z.record(z.string().trim().min(1).max(40), questRewardSchema),
      }),
      nodes: z.array(legacyNodeSchema).min(1).max(1_000),
    }),
  ),
});

const runtimeCatalogSchema = z.object({
  schemaVersion: z.literal(2),
  channel: z.literal('alpha'),
  revision: z.string().trim().min(1).max(120),
  quests: z.array(questDefinitionSchema).max(2_000),
});

export const questCatalogSchema = z
  .union([authoredCatalogSchema, legacyCatalogSchema])
  .transform((catalog) => {
    if (catalog.schemaVersion === 1) {
      return {
        schemaVersion: 2 as const,
        channel: catalog.channel,
        revision: catalog.revision,
        quests: catalog.quests.map((quest) => ({
          ...quest,
          availableRegions: [quest.region],
          prerequisiteQuestIds: [],
          pacing: defaultPacing(),
          nodeAliases: {},
          nodes: quest.nodes.map((node, beatIndex) => ({
            ...node,
            stageId: `stage-${node.stage}`,
            stageTitle: `阶段 ${node.stage}`,
            sceneId: `legacy-${node.id}`,
            sceneTitle: node.title,
            beatIndex,
            roadmapSummary: node.title,
            purpose: node.sceneContext,
            sourceMaterial: node.sceneContext,
            completionGate:
              node.transitions.map((transition) => transition.condition).join('；') ||
              '当前节拍为结束状态。',
            requiredAction: node.requiredAction
              ? { ...node.requiredAction, label: '确认任务动作' }
              : undefined,
          })),
        })),
      };
    }
    return {
      schemaVersion: 2 as const,
      channel: catalog.channel,
      revision: catalog.revision,
      quests: catalog.quests.map((quest) => ({
        id: quest.id,
        name: quest.name,
        kind: quest.kind,
        region: quest.region,
        availableRegions: quest.availableRegions,
        prerequisiteQuestIds: quest.prerequisiteQuestIds,
        visibility: quest.visibility,
        publicSummary: quest.publicSummary,
        minimumLevel: quest.minimumLevel,
        startNodeId: quest.startBeatId,
        rewards: quest.rewards,
        pacing: quest.pacing,
        nodeAliases: quest.nodeAliases,
        nodes: quest.stages.flatMap((stage) =>
          stage.scenes.flatMap((scene) =>
            scene.beats.map((beat, beatIndex) => ({
              id: beat.id,
              stage: stage.number,
              stageId: stage.id,
              stageTitle: stage.title,
              sceneId: scene.id,
              sceneTitle: scene.title,
              beatIndex,
              title: beat.title,
              roadmapSummary: beat.roadmapSummary ?? beat.title,
              objective: beat.objective ?? beat.purpose,
              purpose: beat.purpose,
              completionGate: beat.completionGate,
              locations: beat.locations ?? scene.locations,
              sceneContext: beat.sceneContext ?? beat.purpose,
              sourceMaterial:
                beat.sourceMaterial ?? scene.sourceMaterial ?? beat.purpose,
              availableClues: beat.availableClues,
              forbiddenFacts: beat.forbiddenFacts,
              transitions: beat.transitions,
              status: beat.status,
              ending: beat.ending,
              requiredAction: beat.requiredAction,
              parallelGroupId: scene.parallelGroupId,
            })),
          ),
        ),
      })),
    };
  })
  .transform((catalog) => runtimeCatalogSchema.parse(catalog));

export const questJudgeResultSchema = z
  .object({
    sceneState: z.enum([
      'in_scene',
      'temporary_detour',
      'left_scene',
      'drifted',
      'uncertain',
      'candidate_complete',
      'candidate_failed',
    ]),
    progress: z.enum(['stay', 'transition']),
    completionGateSatisfied: z.boolean().default(false),
    matchedTransitionId: z.string().trim().min(1).max(160).nullable(),
    suggestedNodeId: z.string().trim().min(1).max(160).nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string().trim().min(1).max(500)).max(8),
    summary: z.string().trim().min(1).max(2_000),
    giftItems: z.array(questJudgeGiftSchema).max(20).optional(),
    requiredItemSubmission: questJudgeGiftSchema.nullable().optional(),
  })
  .superRefine((result, context) => {
    if (
      result.progress === 'transition' &&
      (!result.matchedTransitionId || !result.suggestedNodeId)
    ) {
      context.addIssue({
        code: 'custom',
        message: '推进任务时必须提供跳转编号和目标节拍',
        path: ['progress'],
      });
    }
    if (
      result.progress === 'stay' &&
      (result.matchedTransitionId || result.suggestedNodeId)
    ) {
      context.addIssue({
        code: 'custom',
        message: '保持节拍时不能伪造跳转目标',
        path: ['progress'],
      });
    }
    if (result.requiredItemSubmission && result.progress !== 'transition') {
      context.addIssue({
        code: 'custom',
        message: '要求玩家提交物品时必须同时提供一个合法的剧情跳转',
        path: ['requiredItemSubmission'],
      });
    }
  });

export type QuestTransitionDefinition = z.infer<
  typeof questTransitionSchema
>;
export type QuestNodeDefinition = z.infer<typeof questNodeSchema>;
export type QuestDefinition = z.infer<typeof questDefinitionSchema>;
export type QuestCatalogData = z.infer<typeof questCatalogSchema>;
export type QuestJudgeResult = z.infer<typeof questJudgeResultSchema>;

export interface QuestRoadmapEntry {
  stage: number;
  stageTitle: string;
  sceneId: string;
  sceneTitle: string;
  beatId: string;
  summary: string;
}

export function questNode(
  quest: QuestDefinition,
  nodeId: string,
): QuestNodeDefinition {
  const resolved = quest.nodeAliases[nodeId] ?? nodeId;
  const node = quest.nodes.find((candidate) => candidate.id === resolved);
  if (!node) throw new Error(`任务 ${quest.id} 不存在节拍 ${nodeId}`);
  return node;
}

export function questRoadmap(quest: QuestDefinition): QuestRoadmapEntry[] {
  return quest.nodes.map((node) => ({
    stage: node.stage,
    stageTitle: node.stageTitle,
    sceneId: node.sceneId,
    sceneTitle: node.sceneTitle,
    beatId: node.id,
    summary: node.roadmapSummary,
  }));
}

function defaultPacing() {
  return {
    fullRoadmapVisible: true as const,
    currentBeatDetail: 'full' as const,
    futureBeatDetail: 'summary_locked' as const,
    defaultAdvance: 0 as const,
    maxBeatAdvance: 1 as const,
    maxSceneAdvance: 0 as const,
    maxStageAdvance: 0 as const,
  };
}
