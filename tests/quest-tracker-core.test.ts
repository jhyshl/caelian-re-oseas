import { afterEach, describe, expect, it, vi } from 'vitest';
import questCatalogJson from '../public/managed-content/quests/alpha.json';
import type {
  QuestProgressSnapshot,
  QuestRecord,
  TavernFloorReference,
} from '@/domain/types';
import { QuestCatalog } from '@/quests/catalog';
import {
  deriveModelsEndpoint,
  fetchOpenAiCompatibleModels,
  OpenAiCompatibleQuestJudgeClient,
  type QuestJudgeClient,
} from '@/quests/judge-client';
import {
  clearQuestJudgePreferences,
  loadQuestJudgePreferences,
  saveQuestJudgePreferences,
} from '@/quests/judge-preferences';
import {
  buildCurrentNodeContext,
  buildQuestJudgeMessages,
} from '@/quests/prompt-builder';
import type { QuestJudgeResult } from '@/quests/schema';
import {
  applyJudgeResult,
  initialQuestProgress,
} from '@/quests/state-machine';
import { QuestTrackerService } from '@/quests/tracker-service';
import { EventBus } from '@/kernel/event-bus';
import { CaelianDatabase } from '@/storage/database';
import { GameRepository } from '@/storage/repository';
import { QuestProgressRepository } from '@/storage/repositories/quest-progress-repository';

const databases: CaelianDatabase[] = [];
const catalog = QuestCatalog.parse(questCatalogJson);
const floraDefinition = catalog.get('side_flora_says');
if (!floraDefinition) throw new Error('测试任务未加载');
const flora = floraDefinition;
const academyDefinition = catalog.get(
  'main_academy_anniversary_preparation',
);
if (!academyDefinition) throw new Error('学院测试任务未加载');
const academy = academyDefinition;

function floraProgressAt(nodeId: string): QuestProgressSnapshot {
  const node = flora.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`测试节拍不存在：${nodeId}`);
  return {
    ...initialQuestProgress(flora),
    status: node.status,
    trackerState: node.status === 'active' ? 'tracking' : 'ended',
    currentStage: node.stage,
    currentNodeId: node.id,
    currentStageId: node.stageId,
    currentSceneId: node.sceneId,
    currentBeatId: node.id,
    objective: node.objective,
    summary: '',
    ...(node.ending ? { ending: node.ending } : {}),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  clearQuestJudgePreferences(window);
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe('任务定义与提示词', () => {
  it('把芙萝拉说解析为合法节点图并按地区和等级筛选', () => {
    expect(catalog.data.quests).toHaveLength(8);
    expect(
      catalog.data.quests.reduce(
        (total, quest) => total + quest.nodes.length,
        0,
      ),
    ).toBe(209);
    expect(flora.nodes).toHaveLength(21);
    expect(
      catalog.data.quests.every((quest) =>
        quest.nodes.every(
          (node) =>
            node.sourceMaterial.length > 0 &&
            !/(?:MainQuest|SideQuest|QuestInteraction|BattleStart)/.test(
              node.sourceMaterial,
            ),
        ),
      ),
    ).toBe(true);
    expect(
      catalog.available({ region: '伊拉亚城', level: 1 }),
    ).toEqual([flora]);
    expect(catalog.available({ region: '沃西微', level: 99 })).toEqual([
      catalog.get('main_solavia_sacred_underground'),
    ]);
    expect(catalog.available({ region: '阿必塞海', level: 99 })).toEqual([]);
    expect(
      catalog.available({
        region: '阿必塞海',
        level: 99,
        completedQuestIds: new Set(['main_niyasos_failed_sacrifice']),
      }),
    ).toEqual([
      catalog.get('main_abyss_atlantis_echo'),
    ]);

    for (const quest of catalog.data.quests) {
      const available = catalog.available({
        region: quest.availableRegions[0] ?? quest.region,
        level: quest.minimumLevel,
        completedQuestIds: new Set(quest.prerequisiteQuestIds),
      });
      expect(
        available.some((candidate) => candidate.id === quest.id),
      ).toBe(true);
    }
  });

  it('学院主线使用本地动作门槛和可重复返回的并行入口', () => {
    const hub = academy.nodes.find(
      (node) => node.id === 'academy-parallel-hub',
    );
    expect(hub?.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'choose-alice-firework-materials',
          authority: 'judge',
          guards: { incompleteSceneId: 'alice-firework-materials' },
        }),
        expect.objectContaining({
          id: 'all-preparations-complete',
          authority: 'local',
          localTrigger: expect.objectContaining({
            type: 'parallel_scenes_complete',
          }),
        }),
      ]),
    );
    expect(
      academy.nodes.find(
        (node) => node.id === 'academy-alice-claim-materials',
      )?.requiredAction,
    ).toMatchObject({ type: 'claim_items', label: '收下材料' });
    expect(
      academy.nodes.find(
        (node) => node.id === 'academy-ariel-claim-charms',
      )?.requiredAction,
    ).toMatchObject({ type: 'claim_equipment', label: '收下装备' });
    expect(
      academy.nodes.find((node) => node.id === 'academy-feed-teo')
        ?.requiredAction,
    ).toMatchObject({ type: 'submit_item', itemName: '精制面包' });
  });

  it('只把当前节点交给主 API 和剧情判定器', () => {
    const progress = initialQuestProgress(flora);
    const context = buildCurrentNodeContext(flora, progress);
    const judgeMessages = buildQuestJudgeMessages({
      quest: flora,
      progress,
      currentLocation: '中央商业区',
      recentMessages: [{ role: 'user', content: '我帮她一起卖花。' }],
    });

    expect(context).toContain('今天的花');
    expect(context).not.toContain('深渊暗潮');
    expect(judgeMessages[1]?.content).toContain('advance-flora-encounter');
    expect(judgeMessages[1]?.content).not.toContain(
      'inventory-has-eight-lilies',
    );
  });
});

describe('任务跳转保护器', () => {
  it('只接受当前节点声明、目标一致且置信度足够的跳转', () => {
    const progress = initialQuestProgress(flora);
    const accepted = applyJudgeResult(flora, progress, {
      sceneState: 'in_scene',
      progress: 'transition',
      completionGateSatisfied: true,
      matchedTransitionId: 'advance-flora-encounter',
      suggestedNodeId: 'flora-selling-flowers',
      confidence: 0.92,
      evidence: ['玩家明确答应陪同。'],
      summary: '花已卖完，玩家答应陪芙萝拉去城郊。',
    });
    const rejected = applyJudgeResult(flora, progress, {
      sceneState: 'in_scene',
      progress: 'transition',
      completionGateSatisfied: true,
      matchedTransitionId: 'advance-flora-encounter',
      suggestedNodeId: 'flora-selling-flowers',
      confidence: 0.4,
      evidence: ['玩家似乎有些犹豫。'],
      summary: '玩家尚未明确答应。',
    });

    expect(accepted).toMatchObject({
      accepted: true,
      next: { currentNodeId: 'flora-selling-flowers', currentStage: 1 },
    });
    expect(rejected).toMatchObject({
      accepted: false,
      reason: 'low-confidence',
      next: { currentNodeId: 'flora-encounter', currentStage: 1 },
    });
  });

  it('拒绝让副 API 触发只能由背包或按钮确认的节点', () => {
    const gathering = floraProgressAt('flora-gather-eight-lilies');
    const result = applyJudgeResult(flora, gathering, {
      sceneState: 'candidate_complete',
      progress: 'transition',
      completionGateSatisfied: true,
      matchedTransitionId: 'inventory-has-eight-lilies',
      suggestedNodeId: 'flora-neil-arrives',
      confidence: 1,
      evidence: ['主 API 声称已经采够八朵。'],
      summary: '文字声称采集完成，但背包尚未确认。',
    });

    expect(result).toMatchObject({
      accepted: false,
      reason: 'local-authority-required',
      next: { currentNodeId: 'flora-gather-eight-lilies' },
    });
  });

  it('即使跳转编号正确，完成门槛没有证据也不推进', () => {
    const result = applyJudgeResult(flora, initialQuestProgress(flora), {
      sceneState: 'uncertain',
      progress: 'transition',
      completionGateSatisfied: false,
      matchedTransitionId: 'advance-flora-encounter',
      suggestedNodeId: 'flora-selling-flowers',
      confidence: 0.99,
      evidence: [],
      summary: '玩家尚未回应芙萝拉。',
    });

    expect(result).toMatchObject({
      accepted: false,
      reason: 'completion-gate-not-satisfied',
      next: { currentNodeId: 'flora-encounter' },
    });
  });
});

describe('副 API 与楼层编排', () => {
  it('从聊天接口推导模型列表地址', () => {
    expect(
      deriveModelsEndpoint(
        'https://api.example/v1/chat/completions?ignored=true',
      ),
    ).toBe('https://api.example/v1/models');
    expect(
      deriveModelsEndpoint('https://api.example/openai/v1/responses'),
    ).toBe('https://api.example/openai/v1/models');
    expect(deriveModelsEndpoint('https://api.example/v1')).toBe(
      'https://api.example/v1/models',
    );
  });

  it('由本地背包推进、提交物品，并在楼层回退时返还物品后完成结算', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-tracker-local-actions-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const repository = new GameRepository(database, new EventBus());
    const profile = await repository.ensureProfile('local-action-profile');
    await repository.execute(profile.id, {
      id: 'create-local-action-adventurer',
      type: 'player.create',
      payload: {
        name: '本地推进测试者',
        classMain: 'knight',
        subclass: 'holy_knight',
      },
    });
    const quest = await repository.acceptQuestDefinition(profile.id, flora);
    await repository.selectTrackedQuest(
      profile.id,
      quest.id,
      initialQuestProgress(flora),
    );

    const gatheringProgress = floraProgressAt('flora-gather-eight-lilies');
    const { summary, ...next } = gatheringProgress;
    await repository.bindQuestFloor(profile.id, {
      questId: quest.id,
      floor: {
        id: '2:gathering-eight',
        index: 2,
        role: 'assistant',
        fingerprint: 'gathering-eight',
        lineageHash: 'through-gathering-eight',
      },
      judgeResult: { transitionAccepted: true },
      summary,
      next,
    });
    await repository.execute(profile.id, {
      id: 'grant-eight-lilies',
      type: 'inventory.adjust',
      payload: { itemId: '圣心百合', name: '圣心百合', delta: 8 },
    });

    const grave = await repository.applyLocalQuestTransition(profile.id, {
      questId: quest.id,
      definition: flora,
      transitionId: 'inventory-has-eight-lilies',
      floor: {
        id: '4:inventory-confirmed',
        index: 4,
        role: 'assistant',
        fingerprint: 'inventory-confirmed',
        lineageHash: 'through-inventory-confirmed',
      },
      mode: 'automatic',
    });
    expect(grave.current).toMatchObject({
      currentNodeId: 'flora-neil-arrives',
      status: 'active',
    });

    const offeringProgress = floraProgressAt('flora-await-offering');
    const { summary: offeringSummary, ...offeringNext } = offeringProgress;
    await repository.bindQuestFloor(profile.id, {
      questId: quest.id,
      floor: {
        id: '5:at-grave',
        index: 5,
        role: 'assistant',
        fingerprint: 'at-grave',
        lineageHash: 'through-at-grave',
      },
      judgeResult: { transitionAccepted: true },
      summary: offeringSummary,
      next: offeringNext,
    });

    const ready = await repository.applyLocalQuestTransition(profile.id, {
      questId: quest.id,
      definition: flora,
      transitionId: 'submit-eight-lilies',
      floor: {
        id: '6:submitted',
        index: 6,
        role: 'assistant',
        fingerprint: 'submitted',
        lineageHash: 'through-submitted',
      },
      mode: 'submit',
    });
    expect(ready.current).toMatchObject({
      currentNodeId: 'flora-offering-reaction',
      status: 'active',
      rewardExperience: 120,
      rewardGold: 240,
    });
    expect((await repository.snapshot(profile.id)).inventory).toEqual([]);

    await repository.rollbackQuestProgressFromFloor(profile.id, 6);
    expect(await repository.selectedQuestTracker(profile.id)).toMatchObject({
      current: { currentNodeId: 'flora-await-offering', status: 'active' },
    });
    expect((await repository.snapshot(profile.id)).inventory).toEqual([
      expect.objectContaining({ itemId: '圣心百合', quantity: 8 }),
    ]);

    await repository.applyLocalQuestTransition(profile.id, {
      questId: quest.id,
      definition: flora,
      transitionId: 'submit-eight-lilies',
      floor: {
        id: '8:submitted-again',
        index: 8,
        role: 'assistant',
        fingerprint: 'submitted-again',
        lineageHash: 'through-submitted-again',
      },
      mode: 'submit',
    });
    const endingProgress = floraProgressAt('flora-ending-ready');
    const { summary: endingSummary, ...endingNext } = endingProgress;
    await repository.bindQuestFloor(profile.id, {
      questId: quest.id,
      floor: {
        id: '9:ending-ready',
        index: 9,
        role: 'assistant',
        fingerprint: 'ending-ready',
        lineageHash: 'through-ending-ready',
      },
      judgeResult: { transitionAccepted: true },
      summary: endingSummary,
      next: endingNext,
    });
    const beforeSettlement = await repository.snapshot(profile.id);
    const result = await repository.completeQuestDefinition(
      profile.id,
      flora,
    );
    const settled = await repository.snapshot(profile.id);

    expect(result).toMatchObject({
      definitionId: flora.id,
      ending: 'A',
      experience: 120,
      gold: 240,
      guildExperience: 45,
      collectibles: ['盛放的百合'],
    });
    expect(settled.player.gold).toBe(beforeSettlement.player.gold + 240);
    expect(settled.guild.experience).toBe(
      beforeSettlement.guild.experience + 45,
    );
    expect(settled.guild.completedTaskCount).toBe(
      beforeSettlement.guild.completedTaskCount + 1,
    );
    expect(settled.quests).toEqual([]);
    expect(settled.questHistory).toEqual([
      expect.objectContaining({
        definitionId: flora.id,
        ending: 'A',
        rewardExperience: 120,
        rewardGold: 240,
      }),
    ]);
    expect(settled.relics).toEqual([
      expect.objectContaining({ relicId: 'quest:side_flora_says:盛放的百合' }),
    ]);
    expect(await repository.selectedQuestTracker(profile.id)).toBeUndefined();
  });

  it('拉取、去重并排序 OpenAI 兼容模型列表', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'judge-z', owned_by: 'provider' },
            { id: 'judge-a' },
            { id: 'judge-z', owned_by: 'provider' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      fetchOpenAiCompatibleModels(
        {
          endpoint: 'https://api.example/v1/chat/completions',
          apiKey: 'model-list-secret',
        },
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toEqual([
      { id: 'judge-a' },
      { id: 'judge-z', ownedBy: 'provider' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer model-list-secret',
        }),
      }),
    );
  });

  it('长期保存地址和模型，但只把密钥放在当前会话', () => {
    saveQuestJudgePreferences(window, {
      endpoint: 'https://api.example/v1/chat/completions',
      modelsEndpoint: 'https://api.example/v1/models',
      model: 'judge-a',
      apiKey: 'session-secret',
      jsonMode: true,
    });

    expect(
      localStorage.getItem('caelian_quest_judge_preferences_v1'),
    ).not.toContain('session-secret');
    expect(
      sessionStorage.getItem('caelian_quest_judge_api_key_session_v1'),
    ).toBe('session-secret');
    expect(loadQuestJudgePreferences(window)).toEqual({
      endpoint: 'https://api.example/v1/chat/completions',
      modelsEndpoint: 'https://api.example/v1/models',
      model: 'judge-a',
      apiKey: 'session-secret',
      jsonMode: true,
    });

    clearQuestJudgePreferences(window);
  });

  it('解析 OpenAI 兼容接口的固定 JSON 返回', async () => {
    const judgeResult: QuestJudgeResult = {
      sceneState: 'in_scene',
      progress: 'stay',
      completionGateSatisfied: false,
      matchedTransitionId: null,
      suggestedNodeId: null,
      confidence: 0.88,
      evidence: ['玩家仍在帮助卖花。'],
      summary: '玩家继续帮助芙萝拉卖花。',
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: `\`\`\`json\n${JSON.stringify(judgeResult)}\n\`\`\``,
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    );
    const fetcher = fetchMock as unknown as typeof fetch;
    const client = new OpenAiCompatibleQuestJudgeClient(
      {
        endpoint: 'https://judge.example/v1/chat/completions',
        model: 'judge-model',
        apiKey: 'runtime-only',
        jsonMode: true,
      },
      fetcher,
    );

    const evaluation = await client.evaluate({
      quest: flora,
      progress: initialQuestProgress(flora),
      currentLocation: '中央商业区',
      recentMessages: [],
    });

    expect(evaluation.result).toEqual(judgeResult);
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: 'judge-model',
      temperature: 0,
      response_format: { type: 'json_object' },
    });
  });

  it('使用 Responses 端点时发送对应请求体并解析 output_text', async () => {
    const judgeResult: QuestJudgeResult = {
      sceneState: 'in_scene',
      progress: 'stay',
      completionGateSatisfied: false,
      matchedTransitionId: null,
      suggestedNodeId: null,
      confidence: 0.9,
      evidence: ['玩家仍在当前场景。'],
      summary: '玩家仍在当前任务场景中。',
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(
          JSON.stringify({ output_text: JSON.stringify(judgeResult) }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    );
    const client = new OpenAiCompatibleQuestJudgeClient(
      {
        endpoint: 'https://judge.example/v1/responses',
        model: 'judge-model',
        jsonMode: true,
      },
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      client.evaluate({
        quest: flora,
        progress: initialQuestProgress(flora),
        currentLocation: '中央商业区',
        recentMessages: [],
      }),
    ).resolves.toMatchObject({ result: judgeResult });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      model: 'judge-model',
      temperature: 0,
      text: { format: { type: 'json_object' } },
    });
    expect(body.input).toEqual(expect.any(Array));
    expect(body).not.toHaveProperty('messages');
    expect(body).not.toHaveProperty('response_format');
  });

  it('兼容聊天补全返回的分段文本内容', async () => {
    const judgeResult: QuestJudgeResult = {
      sceneState: 'uncertain',
      progress: 'stay',
      completionGateSatisfied: false,
      matchedTransitionId: null,
      suggestedNodeId: null,
      confidence: 0.6,
      evidence: ['证据不足。'],
      summary: '本轮没有确认新的任务进度。',
    };
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: 'text', text: JSON.stringify(judgeResult) },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new OpenAiCompatibleQuestJudgeClient(
      {
        endpoint: 'https://judge.example/v1/chat/completions',
        model: 'judge-model',
      },
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      client.evaluate({
        quest: flora,
        progress: initialQuestProgress(flora),
        currentLocation: '中央商业区',
        recentMessages: [],
      }),
    ).resolves.toMatchObject({ result: judgeResult });
  });

  it('把通过保护器的判定结果和原始返回绑定到当前楼层', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-tracker-service-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const questRecord: QuestRecord = {
      id: 'profile:side:side_flora_says',
      profileId: 'profile',
      definitionId: flora.id,
      kind: 'side',
      title: flora.name,
      region: flora.region,
      objective: flora.nodes[0]?.objective ?? '',
      status: 'active',
      currentStage: 1,
      totalStages: 3,
      rewardExperience: 120,
      rewardGold: 240,
      rewardGuildExperience: 45,
      updatedAt: 1,
    };
    await database.questRecords.put(questRecord);
    const result: QuestJudgeResult = {
      sceneState: 'in_scene',
      progress: 'transition',
      completionGateSatisfied: true,
      matchedTransitionId: 'advance-flora-encounter',
      suggestedNodeId: 'flora-selling-flowers',
      confidence: 0.94,
      evidence: ['玩家明确答应陪同。'],
      summary: '花已经卖完，玩家答应陪芙萝拉前往城郊。',
    };
    const judge: QuestJudgeClient = {
      evaluate: vi.fn(async () => ({
        result,
        rawResponse: JSON.stringify(result),
      })),
    };
    const progress = new QuestProgressRepository(database);
    const service = new QuestTrackerService(progress, judge);
    const floor: TavernFloorReference = {
      id: '4:assistant-reply',
      index: 4,
      role: 'assistant',
      fingerprint: 'assistant-reply',
      lineageHash: 'lineage-through-4',
    };

    const evaluated = await service.evaluateAssistantTurn({
      profileId: 'profile',
      questRecord,
      quest: flora,
      floor,
      currentLocation: '伊拉亚城·中央商业区',
      recentMessages: [
        { role: 'user', content: '好，我陪你去采花。' },
        { role: 'assistant', content: '芙萝拉开心地点了点头。' },
      ],
    });

    expect(evaluated).toMatchObject({
      status: 'evaluated',
      decision: {
        accepted: true,
        next: { currentNodeId: 'flora-selling-flowers' },
      },
    });
    expect(await database.questRecords.get(questRecord.id)).toMatchObject({
      currentStage: 1,
      objective: '允许买花、吆喝、介绍花束或陪伴等方式帮她卖完。',
    });
    const checkpoints = await progress.listCheckpoints(
      'profile',
      questRecord.id,
    );
    expect(checkpoints[0]).toMatchObject({
      floorId: floor.id,
      judgeResult: {
        rawResponse: JSON.stringify(result),
        transitionAccepted: true,
        transitionDecision: 'accepted',
      },
    });

    const duplicate = await service.evaluateAssistantTurn({
      profileId: 'profile',
      questRecord: {
        ...questRecord,
        currentStage: 1,
        objective: '允许买花、吆喝、介绍花束或陪伴等方式帮她卖完。',
      },
      quest: flora,
      floor,
      currentLocation: '伊拉亚城·城郊',
      recentMessages: [],
    });
    expect(duplicate).toEqual({
      status: 'skipped',
      reason: 'already-evaluated',
    });
    expect(judge.evaluate).toHaveBeenCalledOnce();
  });

  it('尚未到场时不开判定，进入剧情后允许判断离场', async () => {
    const database = new CaelianDatabase(
      'alpha',
      `caelian-tracker-location-${crypto.randomUUID()}`,
    );
    databases.push(database);
    const questRecord: QuestRecord = {
      id: 'profile:side:side_flora_says',
      profileId: 'profile',
      definitionId: flora.id,
      kind: 'side',
      title: flora.name,
      region: flora.region,
      objective: flora.nodes[0]?.objective ?? '',
      status: 'active',
      currentStage: 1,
      totalStages: 3,
      rewardExperience: 120,
      rewardGold: 240,
      rewardGuildExperience: 45,
      updatedAt: 1,
    };
    await database.questRecords.put(questRecord);
    const leftSceneResult: QuestJudgeResult = {
      sceneState: 'left_scene',
      progress: 'stay',
      completionGateSatisfied: false,
      matchedTransitionId: null,
      suggestedNodeId: null,
      confidence: 0.92,
      evidence: ['玩家已经返回旅店并开始休息。'],
      summary: '玩家离开了卖花场景。',
    };
    const judge: QuestJudgeClient = {
      evaluate: vi.fn(async () => ({
        result: leftSceneResult,
        rawResponse: '{"sceneState":"left_scene"}',
      })),
    };
    const progress = new QuestProgressRepository(database);
    const service = new QuestTrackerService(progress, judge);
    const outside = await service.evaluateAssistantTurn({
      profileId: 'profile',
      questRecord,
      quest: flora,
      floor: {
        id: '1:outside',
        index: 1,
        role: 'assistant',
        fingerprint: 'outside',
        lineageHash: 'outside-lineage',
      },
      currentLocation: '旅店',
      recentMessages: [],
    });
    expect(outside).toEqual({
      status: 'skipped',
      reason: 'outside-node-location',
    });

    await progress.selectQuest(
      'profile',
      questRecord.id,
      initialQuestProgress(flora),
    );
    await database.questTrackerStates.update(
      `profile:quest-tracker:${encodeURIComponent(questRecord.id)}`,
      {
        current: {
          ...initialQuestProgress(flora),
          trackerState: 'tracking',
        },
      },
    );
    const left = await service.evaluateAssistantTurn({
      profileId: 'profile',
      questRecord,
      quest: flora,
      floor: {
        id: '2:left',
        index: 2,
        role: 'assistant',
        fingerprint: 'left',
        lineageHash: 'left-lineage',
      },
      currentLocation: '旅店',
      recentMessages: [],
    });

    expect(left).toMatchObject({
      status: 'evaluated',
      tracker: { current: { trackerState: 'suspended' } },
    });
    expect(judge.evaluate).toHaveBeenCalledOnce();
  });
});
