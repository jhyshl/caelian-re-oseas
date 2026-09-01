import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyTextMutation,
  ManagedContentUpdater,
} from '@/content-updates/managed-content';
import {
  isLegacyQuestWorldbookEntry,
  type RegionWorldbookEntry,
} from '@/worldbook/region-switcher';

interface TestWorldbookEntry {
  uid: number | string;
  name: string;
  content: string;
  enabled: boolean;
  strategy: {
    type: 'constant' | 'selective' | 'vectorized';
    keys: string[];
    keys_secondary: {
      logic: 'and_any' | 'not_all' | 'not_any' | 'and_all';
      keys: string[];
    };
    scan_depth: number | 'same_as_global';
  };
  position: {
    type:
      | 'before_character_definition'
      | 'after_character_definition'
      | 'before_example_messages'
      | 'after_example_messages'
      | 'before_author_note'
      | 'after_author_note'
      | 'at_depth'
      | 'outlet';
    role: 'system' | 'user' | 'assistant';
    depth: number;
    order: number;
  };
  probability: number;
  recursion: {
    prevent_incoming: boolean;
    prevent_outgoing: boolean;
    delay_until: number | null;
  };
  effect: {
    sticky: number | null;
    cooldown: number | null;
    delay: number | null;
  };
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

function normalizeWorldbookEntry(
  entry: Record<string, unknown>,
): TestWorldbookEntry {
  const extra = isRecord(entry.extensions)
    ? entry.extensions
    : isRecord(entry.extra)
      ? entry.extra
      : {};
  const positionTypes = {
    0: 'before_character_definition',
    1: 'after_character_definition',
    2: 'before_author_note',
    3: 'after_author_note',
    4: 'at_depth',
    5: 'before_example_messages',
    6: 'after_example_messages',
    7: 'outlet',
  } as const;
  const roleTypes = { 0: 'system', 1: 'user', 2: 'assistant' } as const;
  const secondaryLogic = {
    0: 'and_any',
    1: 'not_all',
    2: 'not_any',
    3: 'and_all',
  } as const;
  const numericPosition =
    typeof extra.position === 'number' ? extra.position : Number.NaN;
  const numericRole =
    typeof extra.role === 'number' ? extra.role : Number.NaN;
  const numericLogic =
    typeof extra.selectiveLogic === 'number'
      ? extra.selectiveLogic
      : Number.NaN;
  const normalized: TestWorldbookEntry = {
    uid: (entry.id ?? entry.uid ?? 0) as number | string,
    name: String(entry.comment ?? entry.name ?? ''),
    content: String(entry.content ?? ''),
    enabled: entry.enabled !== false,
    strategy: {
      type:
        entry.constant === true
          ? 'constant'
          : extra.vectorized === true
            ? 'vectorized'
            : 'selective',
      keys: Array.isArray(entry.keys)
        ? entry.keys.map((key) => String(key))
        : [],
      keys_secondary: {
        logic:
          secondaryLogic[numericLogic as keyof typeof secondaryLogic] ??
          'and_any',
        keys: Array.isArray(entry.secondary_keys)
          ? entry.secondary_keys.map((key) => String(key))
          : [],
      },
      scan_depth:
        typeof extra.scan_depth === 'number'
          ? extra.scan_depth
          : 'same_as_global',
    },
    position: {
      type:
        positionTypes[numericPosition as keyof typeof positionTypes] ??
        (entry.position === 'before_char'
          ? 'before_character_definition'
          : 'after_character_definition'),
      role:
        roleTypes[numericRole as keyof typeof roleTypes] ?? 'system',
      depth:
        typeof extra.depth === 'number' && Number.isFinite(extra.depth)
          ? extra.depth
          : 4,
      order:
        typeof entry.insertion_order === 'number'
          ? entry.insertion_order
          : 100,
    },
    probability:
      extra.useProbability === false
        ? 100
        : typeof extra.probability === 'number'
          ? extra.probability
          : 100,
    recursion: {
      prevent_incoming: Boolean(extra.exclude_recursion),
      prevent_outgoing: Boolean(extra.prevent_recursion),
      delay_until: positiveNumberOrNull(extra.delay_until_recursion),
    },
    effect: {
      sticky: positiveNumberOrNull(extra.sticky),
      cooldown: positiveNumberOrNull(extra.cooldown),
      delay: positiveNumberOrNull(extra.delay),
    },
  };
  const optionMappings = {
    addMemo: 'addMemo',
    match_persona_description: 'matchPersonaDescription',
    match_character_description: 'matchCharacterDescription',
    match_character_personality: 'matchCharacterPersonality',
    match_character_depth_prompt: 'matchCharacterDepthPrompt',
    match_scenario: 'matchScenario',
    match_creator_notes: 'matchCreatorNotes',
    group: 'group',
    group_override: 'groupOverride',
    group_weight: 'groupWeight',
    case_sensitive: 'caseSensitive',
    match_whole_words: 'matchWholeWords',
    use_group_scoring: 'useGroupScoring',
    automation_id: 'automationId',
    ignore_budget: 'ignoreBudget',
    outlet_name: 'outletName',
    triggers: 'triggers',
    character_filter: 'characterFilter',
  } as const;
  for (const [legacyKey, normalizedKey] of Object.entries(optionMappings)) {
    if (Object.prototype.hasOwnProperty.call(extra, legacyKey)) {
      normalized[normalizedKey] = clone(extra[legacyKey]);
    }
  }
  const knownExtraKeys = new Set([
    'position',
    'exclude_recursion',
    'display_index',
    'probability',
    'useProbability',
    'depth',
    'selectiveLogic',
    'prevent_recursion',
    'delay_until_recursion',
    'scan_depth',
    'role',
    'vectorized',
    'sticky',
    'cooldown',
    'delay',
    ...Object.keys(optionMappings),
  ]);
  const passthroughExtra = Object.fromEntries(
    Object.entries(extra).filter(([key]) => !knownExtraKeys.has(key)),
  );
  if (Object.keys(passthroughExtra).length > 0) {
    normalized.extra = clone(passthroughExtra);
  }
  return normalized;
}

function createHarness(options: {
  characterName?: string;
  characterAvatar?: string;
  characterId?: number;
  characters?: Array<{ name: string; avatar: string }>;
  worldbookName?: string;
  operations?: unknown[];
  persistCharacterWrites?: boolean;
  iframeSrcdoc?: string;
}) {
  const storage = new Map<string, string>();
  const character = {
    description: '官方设定：旧段落\n玩家新增：保留我',
    creator_notes: '',
    first_messages: ['你好'],
    extensions: {
      tavern_helper: {
        scripts: [
          {
            id: 'schema-script',
            name: '变量结构',
            content: 'const oldSchema = true;\n// 玩家注释',
          },
        ],
        variables: { existing: 'keep' },
      },
    },
  };
  const worldbook: TestWorldbookEntry[] = [
    normalizeWorldbookEntry({
      id: 17,
      comment: '变量更新规则',
      content: '旧规则\n玩家新增世界观',
      keys: [],
      secondary_keys: [],
      constant: false,
      selective: true,
      insertion_order: 100,
      enabled: true,
      position: 'after_char',
      extensions: {
        position: 1,
        role: 0,
        depth: 4,
        selectiveLogic: 0,
        exclude_recursion: false,
        prevent_recursion: false,
      },
    }),
  ];
  const characterName = options.characterName ?? '凯利安';
  const characterAvatar =
    options.characterAvatar ?? `${characterName}.png`;
  const characters = (options.characters ?? [
    { name: characterName, avatar: characterAvatar },
  ]).map((item) => ({
    ...item,
    data: {
      name: item.name,
      description: character.description,
      creator_notes: character.creator_notes,
      first_mes: character.first_messages[0] ?? '',
      alternate_greetings: character.first_messages.slice(1),
      extensions: clone(character.extensions) as Record<string, unknown>,
    },
    json_data: '',
  }));
  const persistedCharacters = new Map(
    characters.map((item) => [
      item.avatar,
      {
        name: item.name,
        avatar: item.avatar,
        data: clone(item.data),
      },
    ]),
  );
  const syncCharacterView = (avatar: string) => {
    if (avatar !== characterAvatar) return;
    const payload = persistedCharacters.get(avatar);
    if (!payload) return;
    character.description = String(payload.data.description ?? '');
    character.creator_notes = String(payload.data.creator_notes ?? '');
    character.first_messages = [
      String(payload.data.first_mes ?? ''),
      ...(Array.isArray(payload.data.alternate_greetings)
        ? payload.data.alternate_greetings.map((value) => String(value))
        : []),
    ];
    character.extensions = clone(
      payload.data.extensions,
    ) as typeof character.extensions;
  };
  const extensionWriteAvatars: string[] = [];
  const writeExtensionField = vi.fn(
    async (characterIndex: number | string, key: string, value: unknown) => {
      const current = characters[Number(characterIndex)];
      if (!current) return;
      extensionWriteAvatars.push(current.avatar);
      current.data.extensions[key] = clone(value);
      current.json_data = JSON.stringify({ data: current.data });
      if (current.avatar === characterAvatar) {
        character.extensions = clone(
          current.data.extensions,
        ) as typeof character.extensions;
      }
      if (options.persistCharacterWrites === false) return;
      const persisted = persistedCharacters.get(current.avatar);
      if (!persisted) return;
      persisted.data.extensions[key] = clone(value);
      syncCharacterView(current.avatar);
    },
  );
  const getOneCharacter = vi.fn(async (avatar: string) => {
    const persisted = persistedCharacters.get(avatar);
    const index = characters.findIndex((item) => item.avatar === avatar);
    if (!persisted || index < 0) return;
    const current = characters[index];
    if (!current) return;
    current.data = clone(persisted.data);
    current.json_data = JSON.stringify(persisted);
    syncCharacterView(avatar);
  });
  let scriptTrees = character.extensions.tavern_helper.scripts.map(
    (script) => ({ type: 'script' as const, ...script }),
  );
  const characterVariables = clone(
    character.extensions.tavern_helper.variables,
  );
  const unsafeHelperWriteAvatars: string[] = [];
  const helper = {
    getCurrentCharacterName: () => characterName,
    getCurrentCharacterId: () => characterAvatar,
    getCharWorldbookNames: vi.fn(() => ({
      primary: options.worldbookName ?? '孔雀开屏你说看不见',
      additional: [],
    })),
    getCharacter: vi.fn(async () => clone(character)),
    getWorldbook: vi.fn(async () => clone(worldbook)),
    getScriptTrees: vi.fn(() =>
      clone(scriptTrees),
    ),
    getVariables: vi.fn(() => clone(characterVariables)),
    replaceScriptTrees: vi.fn((trees: typeof scriptTrees) => {
      scriptTrees = clone(trees);
      const current = characters[Number(options.characterId ?? 0)];
      if (!current) return;
      const desiredSettings = {
        scripts: clone(scriptTrees),
        variables: clone(characterVariables),
      };
      if (
        JSON.stringify(current.data.extensions.tavern_helper) !==
        JSON.stringify(desiredSettings)
      ) {
        unsafeHelperWriteAvatars.push(`${current.name}.png`);
      }
    }),
    updateScriptTreesWith: vi.fn(
      async (
        updater: (value: typeof scriptTrees) => typeof scriptTrees,
      ) => {
        scriptTrees = updater(clone(scriptTrees));
        character.extensions.tavern_helper.scripts = scriptTrees.map(
          (script) => ({
            id: script.id,
            name: script.name,
            content: script.content,
          }),
        );
        return clone(scriptTrees);
      },
    ),
    updateCharacterWith: vi.fn(
      async (
        _name: string,
        updater: (value: typeof character) => typeof character,
      ) => {
        const updated = await updater(character);
        const persisted = persistedCharacters.get(characterAvatar);
        if (persisted) {
          persisted.data.description = updated.description;
          persisted.data.creator_notes = updated.creator_notes;
          persisted.data.first_mes = updated.first_messages[0] ?? '';
          persisted.data.alternate_greetings =
            updated.first_messages.slice(1);
          persisted.data.extensions = clone(updated.extensions);
        }
        return updated;
      },
    ),
    updateWorldbookWith: vi.fn(
      async (
        _name: string,
        updater: (value: typeof worldbook) => typeof worldbook,
      ) => {
        const updated = updater(clone(worldbook));
        worldbook.splice(0, worldbook.length, ...clone(updated));
        return clone(worldbook);
      },
    ),
  };
  const manifest = {
    schemaVersion: 1,
    channel: 'alpha',
    revision: 'test.1',
    target: {
      characterName: '凯利安',
      worldbookNames: [
        '孔雀开屏你说看不见',
        '孔雀开屏你说你看不见',
      ],
      requirePrimaryBinding: true,
    },
    operations: options.operations ?? [],
  };
  document
    .querySelectorAll('iframe[data-managed-content-test]')
    .forEach((element) => element.remove());
  let frame: HTMLIFrameElement | null = null;
  if (options.iframeSrcdoc !== undefined) {
    frame = document.createElement('iframe');
    frame.dataset.managedContentTest = 'true';
    frame.id = 'TH-script--变量结构--schema-script';
    frame.srcdoc = options.iframeSrcdoc;
    document.body.append(frame);
  }
  const host = {
    TavernHelper: helper,
    SillyTavern: {
      getContext: () => ({
        characterId: options.characterId ?? 0,
        name2: characterName,
        characters,
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
        writeExtensionField,
        getOneCharacter,
      }),
    },
    document,
    DOMParser,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    fetch: vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(input) === '/api/characters/get') {
        const request = JSON.parse(String(init?.body ?? '{}')) as {
          avatar_url?: string;
        };
        const payload = request.avatar_url
          ? persistedCharacters.get(request.avatar_url)
          : undefined;
        return {
          ok: Boolean(payload),
          status: payload ? 200 : 404,
          json: async () => clone(payload ?? {}),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => manifest,
      };
    }),
  } as unknown as Window;
  return {
    host,
    helper,
    character,
    worldbook,
    storage,
    manifest,
    characters,
    persistedCharacters,
    extensionWriteAvatars,
    unsafeHelperWriteAvatars,
    writeExtensionField,
    getOneCharacter,
    frame,
  };
}

describe('ManagedContentUpdater', () => {
  it.each(['凯利安alpha', '凯利安beta', '凯利安 Beta'])(
    '角色名为“%s”时允许同步官方受管内容',
    async (characterName) => {
      const harness = createHarness({ characterName });
      const result = await new ManagedContentUpdater(harness.host).sync({
        force: true,
      });

      expect(result.status).toBe('current');
      expect(harness.host.fetch).toHaveBeenCalled();
    },
  );

  it.each([
    '孔雀开屏你说你看不见alpha',
    '孔雀开屏你说你看不见beta',
  ])('绑定通道世界书“%s”时允许同步官方受管内容', async (worldbookName) => {
    const harness = createHarness({ worldbookName });
    const result = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });

    expect(result.status).toBe('current');
    expect(harness.host.fetch).toHaveBeenCalled();
  });

  it('发布角色卡不含旧剧情条目，并保留地区自动切换资料', () => {
    const card = JSON.parse(
      readFileSync(
        path.resolve(
          'public/managed-content/cards/caelian-alpha-mvu-v3.json',
        ),
        'utf8',
      ),
    );
    const entries = card.data.character_book.entries as Array<
      Record<string, unknown>
    >;
    const normalized: RegionWorldbookEntry[] = entries.map((entry) => ({
      ...entry,
      uid: entry.id as number | string | undefined,
      name: String(entry.comment ?? ''),
    }));
    expect(normalized.filter(isLegacyQuestWorldbookEntry)).toEqual([]);
    expect(
      normalized.filter((entry) =>
        String(entry.name).includes('[AUTO_REGION:'),
      ),
    ).toHaveLength(27);
    expect(
      normalized.filter((entry) =>
        String(entry.name).includes('[AUTO_GLOBAL]'),
      ),
    ).toHaveLength(4);
    const battleRules = normalized.find((entry) =>
      String(entry.name).includes('战斗判定 [AUTO_GLOBAL]'),
    )?.content;
    expect(battleRules).toContain('user_involved: true');
    expect(battleRules).toContain('caelian_present: true');
    expect(battleRules).toContain('若仅凯利安、特莱奥、其他NPC或远处角色遭遇/参加战斗');

    const schema = card.data.extensions.tavern_helper.scripts.find(
      (script: Record<string, unknown>) =>
        script.id === 'edfcaddc-2475-46e8-a0d9-f14a2e6558b2',
    )?.content as string;
    expect(schema).toContain('export const Schema = z.looseObject({');
    expect(schema).not.toContain('.passthrough(');
    expect(schema).not.toContain('.strict(');
    expect(schema).toContain('registerMvuSchema(Schema);');
    expect(schema).toContain('_.clamp(Math.round(value * 2) / 2, 0, 500)');

    const initvar = normalized.find(
      (entry) => entry.name === '[initvar]变量初始化勿开',
    );
    expect(initvar).toMatchObject({ enabled: false, insertion_order: 200 });

    const rules = normalized.find(
      (entry) => entry.name === '[mvu_update]变量更新规则',
    )?.content;
    expect(rules).toContain('stat_data.caelian.narrative');
    expect(rules).toContain('range: 0~500');
    expect(rules).toContain('调整 ±1~5');
    expect(rules).toContain('重大情感事件可以调整 ±6~10');
    for (const legacyRule of [
      '变量更新规则 v2.6',
      '主线任务更新规则',
      '支线任务更新规则',
      '玩家.背包',
      '玩家.装备背包',
      '协会.主线任务',
      '采集与消耗品规则',
      '成就系统规则',
      '世界.地区等级限制',
    ]) {
      expect(rules).not.toContain(legacyRule);
    }

    const phaseController = normalized.find(
      (entry) => entry.name === '阶段控制器',
    )?.content;
    expect(phaseController).toContain('kailianFavor >= 500');
    expect(phaseController).toContain('kailianFavor >= 401');
    expect(phaseController).toContain('kailianFavor >= 251');
    expect(phaseController).toContain('kailianFavor >= 101');

    for (const [name, range] of [
      ['凯利安_阶段01_陌生人', '好感度0-100'],
      ['凯利安_阶段02_伙伴', '好感度101-250'],
      ['凯利安_阶段03_暧昧对象', '好感度251-400'],
      ['凯利安_阶段04_恋人', '好感度401-499'],
      ['凯利安_阶段05_伴侣', '好感度500'],
    ]) {
      expect(normalized.find((entry) => entry.name === name)?.content).toContain(
        range,
      );
    }
    expect(
      normalized.find(
        (entry) =>
          entry.name === '💞禁止默认浪漫倾向（防万人迷和一见钟情）',
      )?.content,
    ).toContain('好感度低于251');

    const variableList = normalized.find(
      (entry) => entry.name === '变量列表',
    );
    expect(variableList?.content).toBe(
      '---\n<status_current_variables>\n{{format_message_variable::stat_data}}\n</status_current_variables>',
    );
    expect(variableList).toMatchObject({
      enabled: true,
      insertion_order: 200,
    });

    const output = normalized.find(
      (entry) => entry.name === '[mvu_update]变量输出格式',
    );
    expect(output?.content).toContain('<Analysis>');
    expect(output?.content).toContain('<JSONPatch>');
    expect(output?.content).toContain('/caelian/narrative/');
    expect(output).toMatchObject({ enabled: true, insertion_order: 200 });

    const gathering = normalized.find(
      (entry) => entry.name === '采集物系统',
    );
    expect(gathering?.content).toContain('本地脚本会直接打开采集页面');
    expect(gathering?.content).toContain(
      '无追踪任务的日常对话不会为采集额外调用副 API',
    );
    expect(gathering?.content).toContain('禁止创造新采集物');
    expect(gathering?.content).not.toContain('每次建议获得1~3个物品');

    const manifest = JSON.parse(
      readFileSync(
        path.resolve('public/managed-content/alpha.json'),
        'utf8',
      ),
    ) as {
      revision: string;
      target: { worldbookNames: string[] };
      operations: Array<{
        id: string;
        target: { kind: string };
        mutation?: { action: string };
      }>;
    };
    expect(manifest.revision).toBe('2026-08-31.2');
    expect(manifest.target.worldbookNames).toEqual(
      expect.arrayContaining([
        '孔雀开屏你说你看不见alpha',
        '孔雀开屏你说你看不见beta',
      ]),
    );
    expect(manifest.operations).toHaveLength(14);
    expect(new Set(manifest.operations.map((operation) => operation.id)).size).toBe(
      manifest.operations.length,
    );
    expect(manifest.operations.map((operation) => operation.id)).toEqual(
      expect.arrayContaining([
        '2026-08-31.affinity-500.schema-rebuild-v2-11',
        '2026-08-31.affinity-500.phase-controller',
        '2026-08-31.affinity-500.variable-rules',
      ]),
    );
    expect(
      manifest.operations.filter(
        (operation) => operation.target.kind === 'character-script',
      ),
    ).toEqual([
      expect.objectContaining({
        mutation: expect.objectContaining({ action: 'replace-entire' }),
      }),
    ]);
    expect(
      manifest.operations.filter(
        (operation) => operation.target.kind === 'worldbook-upsert-entry',
      ),
    ).toHaveLength(13);
  });

  it('发布清单可在最新版角色卡上幂等执行且不产生额外改动', async () => {
    const manifest = JSON.parse(
      readFileSync(
        path.resolve('public/managed-content/alpha.json'),
        'utf8',
      ),
    );
    const card = JSON.parse(
      readFileSync(
        path.resolve(
          'public/managed-content/cards/caelian-alpha-mvu-v3.json',
        ),
        'utf8',
      ),
    );
    const character = {
      description: card.data.description,
      creator_notes: card.data.creator_notes,
      first_messages: [
        card.data.first_mes,
        ...(card.data.alternate_greetings ?? []),
      ],
      extensions: card.data.extensions,
    };
    const worldbook = card.data.character_book.entries.map(
      (entry: Record<string, unknown>) => normalizeWorldbookEntry(entry),
    );
    const before = JSON.stringify({ character, worldbook });
    const storage = new Map<string, string>();
    const helper = {
      getCurrentCharacterName: () => '凯利安',
      getCurrentCharacterId: () => '凯利安.png',
      getCharWorldbookNames: () => ({
        primary: '孔雀开屏你说看不见',
        additional: [],
      }),
      getCharacter: async () => clone(character),
      getWorldbook: async () => clone(worldbook),
      getScriptTrees: vi.fn(() =>
        clone(character.extensions.tavern_helper.scripts),
      ),
      getVariables: vi.fn(() =>
        clone(character.extensions.tavern_helper.variables ?? {}),
      ),
      replaceScriptTrees: vi.fn((trees) => {
        character.extensions.tavern_helper.scripts = clone(trees);
      }),
      updateScriptTreesWith: vi.fn(),
      updateCharacterWith: async (
        _name: string,
        updater: (value: typeof character) => typeof character,
      ) => updater(character),
      updateWorldbookWith: async (
        _name: string,
        updater: (value: typeof worldbook) => typeof worldbook,
      ) => {
        const updated = updater(clone(worldbook));
        worldbook.splice(0, worldbook.length, ...clone(updated));
        return clone(worldbook);
      },
    };
    const contextCharacter = {
      name: '凯利安',
      avatar: '凯利安.png',
      data: {
        name: '凯利安',
        description: character.description,
        creator_notes: character.creator_notes,
        first_mes: character.first_messages[0],
        alternate_greetings: character.first_messages.slice(1),
        extensions: character.extensions,
      },
    };
    const writeExtensionField = vi.fn(
      async (_id: number | string, key: string, value: unknown) => {
        contextCharacter.data.extensions = {
          ...contextCharacter.data.extensions,
          [key]: clone(value),
        };
        character.extensions = clone(contextCharacter.data.extensions);
      },
    );
    const getOneCharacter = vi.fn(async () => undefined);
    const host = {
      TavernHelper: helper,
      SillyTavern: {
        getContext: () => ({
          characterId: 0,
          name2: '凯利安',
          characters: [contextCharacter],
          getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
          writeExtensionField,
          getOneCharacter,
        }),
      },
      document,
      DOMParser,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      fetch: async (input: string | URL | Request) => {
        if (String(input) === '/api/characters/get') {
          return {
            ok: true,
            status: 200,
            json: async () => clone(contextCharacter),
          };
        }
        return { ok: true, status: 200, json: async () => manifest };
      },
    } as unknown as Window;

    const result = await new ManagedContentUpdater(host).sync({
      force: true,
    });

    expect(result.conflicts).toEqual([]);
    expect(result.applied).toBe(manifest.operations.length);
    expect(JSON.stringify({ character, worldbook })).toBe(before);
  });

  it('只修改精确目标片段并保留玩家新增内容', async () => {
    const harness = createHarness({
      operations: [
        {
          id: 'test.character.description',
          target: {
            kind: 'character-field',
            field: 'description',
          },
          mutation: {
            action: 'replace-exact',
            before: '官方设定：旧段落',
            after: '官方设定：新段落',
          },
        },
        {
          id: 'test.worldbook.rule',
          target: {
            kind: 'worldbook-entry',
            entryName: '变量更新规则',
          },
          mutation: {
            action: 'insert-after',
            anchor: '旧规则',
            text: '\n新增官方规则',
          },
        },
      ],
    });

    const result = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });

    expect(result).toMatchObject({
      status: 'applied',
      applied: 2,
      conflicts: [],
    });
    expect(harness.character.description).toBe(
      '官方设定：新段落\n玩家新增：保留我',
    );
    expect(harness.worldbook[0]?.content).toBe(
      '旧规则\n新增官方规则\n玩家新增世界观',
    );
  });

  it('整项重建官方核心条目，不保留旧版变量规则', async () => {
    const harness = createHarness({
      operations: [
        {
          id: 'test.schema.rebuild',
          target: {
            kind: 'character-script',
            scriptId: 'schema-script',
          },
          mutation: {
            action: 'replace-entire',
            content: 'const Schema = newSchema;',
          },
        },
        {
          id: 'test.rules.rebuild',
          target: {
            kind: 'worldbook-entry',
            entryName: '变量更新规则',
          },
          mutation: {
            action: 'replace-entire',
            content: '欧西亚斯 MVU v3 变量规则:\n  只允许写 narrative',
          },
        },
      ],
    });

    const result = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });

    expect(result).toMatchObject({
      status: 'applied',
      applied: 2,
      conflicts: [],
    });
    expect(
      harness.character.extensions.tavern_helper.scripts[0]?.content,
    ).toBe('const Schema = newSchema;');
    expect(harness.worldbook[0]?.content).toBe(
      '欧西亚斯 MVU v3 变量规则:\n  只允许写 narrative',
    );
    expect(harness.worldbook[0]?.content).not.toContain('玩家新增世界观');
  });

  it('同名角色卡精确写入 _1 头像并安全同步 helper store', async () => {
    const harness = createHarness({
      characterName: '凯利安alpha',
      characterAvatar: '凯利安alpha_1.png',
      characterId: 1,
      characters: [
        { name: '凯利安alpha', avatar: '凯利安alpha.png' },
        { name: '凯利安alpha', avatar: '凯利安alpha_1.png' },
      ],
      operations: [
        {
          id: 'test.schema.real-character-name',
          target: {
            kind: 'character-script',
            scriptId: 'schema-script',
          },
          mutation: {
            action: 'replace-entire',
            content: 'const Schema = verifiedSchema;',
          },
        },
      ],
    });

    const result = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });

    expect(result).toMatchObject({ applied: 1, conflicts: [] });
    expect(harness.writeExtensionField).toHaveBeenCalledWith(
      1,
      'tavern_helper',
      expect.any(Object),
    );
    expect(harness.extensionWriteAvatars).toEqual(['凯利安alpha_1.png']);
    expect(harness.helper.replaceScriptTrees).toHaveBeenCalledTimes(1);
    expect(harness.unsafeHelperWriteAvatars).toEqual([]);
    expect(harness.helper.updateScriptTreesWith).not.toHaveBeenCalled();
    expect(harness.helper.updateCharacterWith).not.toHaveBeenCalled();
    expect(harness.helper.getCharWorldbookNames).toHaveBeenCalledWith(
      'current',
    );
    expect(harness.host.fetch).toHaveBeenCalledWith(
      '/api/characters/get',
      expect.objectContaining({
        body: JSON.stringify({ avatar_url: '凯利安alpha_1.png' }),
      }),
    );
    expect(
      harness.character.extensions.tavern_helper.scripts[0]?.content,
    ).toBe('const Schema = verifiedSchema;');
    expect(
      JSON.stringify(
        harness.persistedCharacters.get('凯利安alpha_1.png'),
      ),
    ).toContain('verifiedSchema');
    expect(
      JSON.stringify(harness.persistedCharacters.get('凯利安alpha.png')),
    ).not.toContain('verifiedSchema');
    expect(harness.getOneCharacter).toHaveBeenCalledWith(
      '凯利安alpha_1.png',
    );
    expect(
      [...harness.storage.keys()].some((key) =>
        key.startsWith('caelian:managed-content:applied:v1:card:'),
      ),
    ).toBe(true);
  });

  it('即时激活同步 helper store 且不直接破坏完整 iframe srcdoc', async () => {
    const srcdoc = [
      '<!DOCTYPE html>',
      '<html><head>',
      '<meta name="fixture" content="keep-me">',
      '<script src="blob:http://127.0.0.1:8000/bootstrap"></script>',
      '<script src="https://example.test/log.js"></script>',
      '</head><body>',
      '<script type="module">const oldSchema = true;\n// 玩家注释</script>',
      '</body></html>',
    ].join('\n');
    const harness = createHarness({
      iframeSrcdoc: srcdoc,
      operations: [
        {
          id: 'test.schema.iframe-module-only',
          target: {
            kind: 'character-script',
            scriptId: 'schema-script',
            scriptName: '变量结构',
          },
          mutation: {
            action: 'replace-entire',
            content: 'const Schema = liveSchema;\nregisterMvuSchema(Schema);',
          },
        },
      ],
    });

    const result = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });

    expect(result).toMatchObject({ applied: 1, conflicts: [] });
    expect(harness.frame).not.toBeNull();
    expect(
      harness.helper.replaceScriptTrees,
    ).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'schema-script',
          content:
            'const Schema = liveSchema;\nregisterMvuSchema(Schema);',
        }),
      ],
      { type: 'character' },
    );
    expect(harness.frame?.srcdoc).toBe(srcdoc);
  });

  it('角色卡脚本未实际保存时不写入已应用 ledger', async () => {
    const harness = createHarness({
      persistCharacterWrites: false,
      operations: [
        {
          id: 'test.schema.persisted-readback',
          target: {
            kind: 'character-script',
            scriptId: 'schema-script',
          },
          mutation: {
            action: 'replace-entire',
            content: 'const Schema = shouldPersist;',
          },
        },
      ],
    });
    vi.useFakeTimers();
    let result!: Awaited<ReturnType<ManagedContentUpdater['sync']>>;
    try {
      const pending = new ManagedContentUpdater(harness.host).sync({
        force: true,
      });
      await vi.advanceTimersByTimeAsync(2_000);
      result = await pending;
    } finally {
      vi.useRealTimers();
    }

    expect(result.applied).toBe(0);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        operationId: 'test.schema.persisted-readback',
        reason: expect.stringContaining('回读校验失败'),
      }),
    ]);
    expect(harness.character.extensions.tavern_helper.scripts[0]?.content)
      .not.toContain('shouldPersist');
    expect(harness.getOneCharacter).toHaveBeenCalledWith('凯利安.png');
    expect(
      [...harness.storage.keys()].some((key) =>
        key.startsWith('caelian:managed-content:applied:v1:card:'),
      ),
    ).toBe(false);
  });

  it('旧卡或重导卡内容回退后不因已有 ledger 跳过更新', async () => {
    const harness = createHarness({
      operations: [
        {
          id: 'test.reimport.character',
          target: {
            kind: 'character-field',
            field: 'description',
          },
          mutation: {
            action: 'replace-exact',
            before: '官方设定：旧段落',
            after: '官方设定：新段落',
          },
        },
        {
          id: 'test.reimport.worldbook',
          target: {
            kind: 'worldbook-entry',
            entryName: '变量更新规则',
          },
          mutation: {
            action: 'replace-exact',
            before: '旧规则',
            after: '新规则',
          },
        },
      ],
    });

    const first = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });
    expect(first).toMatchObject({ applied: 2, skipped: 0, conflicts: [] });

    harness.character.description = '官方设定：旧段落\n玩家新增：保留我';
    const persistedCharacter = harness.persistedCharacters.get('凯利安.png');
    if (persistedCharacter) {
      persistedCharacter.data.description =
        '官方设定：旧段落\n玩家新增：保留我';
    }
    if (harness.worldbook[0]) {
      harness.worldbook[0].content = '旧规则\n玩家新增世界观';
    }

    const second = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });

    expect(second).toMatchObject({ applied: 2, skipped: 0, conflicts: [] });
    expect(harness.character.description).toContain('官方设定：新段落');
    expect(harness.worldbook[0]?.content).toContain('新规则');
  });

  it('已应用 ledger 的复检只调用纯读接口', async () => {
    const harness = createHarness({
      operations: [
        {
          id: 'test.readonly.character',
          target: {
            kind: 'character-script',
            scriptId: 'schema-script',
          },
          mutation: {
            action: 'replace-entire',
            content: 'const Schema = persistedSchema;',
          },
        },
        {
          id: 'test.readonly.worldbook',
          target: {
            kind: 'worldbook-entry',
            entryName: '变量更新规则',
          },
          mutation: {
            action: 'replace-entire',
            content: '已持久化规则',
          },
        },
      ],
    });
    const updater = new ManagedContentUpdater(harness.host);
    expect(await updater.sync({ force: true })).toMatchObject({
      applied: 2,
      conflicts: [],
    });

    harness.helper.updateScriptTreesWith.mockClear();
    harness.helper.replaceScriptTrees.mockClear();
    harness.helper.updateCharacterWith.mockClear();
    harness.helper.updateWorldbookWith.mockClear();
    harness.helper.getCharacter.mockClear();
    harness.helper.getWorldbook.mockClear();
    harness.writeExtensionField.mockClear();
    harness.getOneCharacter.mockClear();

    const second = await updater.sync({ force: true });

    expect(second).toMatchObject({ applied: 0, skipped: 2, conflicts: [] });
    expect(harness.helper.getCharacter).not.toHaveBeenCalled();
    expect(harness.helper.getWorldbook).toHaveBeenCalled();
    expect(harness.helper.updateScriptTreesWith).not.toHaveBeenCalled();
    expect(harness.helper.replaceScriptTrees).not.toHaveBeenCalled();
    expect(harness.helper.updateCharacterWith).not.toHaveBeenCalled();
    expect(harness.helper.updateWorldbookWith).not.toHaveBeenCalled();
    expect(harness.writeExtensionField).not.toHaveBeenCalled();
    expect(harness.getOneCharacter).not.toHaveBeenCalled();
  });

  it('新的变量结构操作编号会覆盖已经执行过的旧上限更新', async () => {
    const harness = createHarness({
      operations: [
        {
          id: '2026-08-31.affinity-500.schema-rebuild',
          target: {
            kind: 'character-script',
            scriptId: 'schema-script',
          },
          mutation: {
            action: 'replace-entire',
            content: 'const affinity = _.clamp(value, 0, 100);',
          },
        },
      ],
    });

    const first = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });
    expect(first).toMatchObject({ applied: 1, skipped: 0, conflicts: [] });
    expect(
      harness.character.extensions.tavern_helper.scripts[0]?.content,
    ).toContain('0, 100');

    harness.manifest.revision = 'test.2';
    harness.manifest.operations = [
      {
        id: '2026-08-31.affinity-500.schema-rebuild-v2-11',
        target: {
          kind: 'character-script',
          scriptId: 'schema-script',
        },
        mutation: {
          action: 'replace-entire',
          content: 'const affinity = _.clamp(value, 0, 500);',
        },
      },
    ];

    const second = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });
    expect(second).toMatchObject({ applied: 1, skipped: 0, conflicts: [] });
    expect(
      harness.character.extensions.tavern_helper.scripts[0]?.content,
    ).toContain('0, 500');
  });

  it('按旧名称迁移 MVU 条目并补建缺失条目', async () => {
    const harness = createHarness({
      operations: [
        {
          id: 'test.rules.upsert',
          target: {
            kind: 'worldbook-upsert-entry',
            entryNames: ['变量更新规则', '[mvu_update]变量更新规则'],
          },
          entry: {
            uid: 0,
            name: '[mvu_update]变量更新规则',
            content: '全新规则',
            keys: ['规则'],
            secondary_keys: ['变量'],
            constant: false,
            selective: true,
            insertion_order: 208,
            enabled: true,
            position: 'after_char',
            use_regex: false,
            extra: {
              position: 4,
              depth: 2,
              role: 2,
              selectiveLogic: 3,
              scan_depth: 5,
              exclude_recursion: true,
              prevent_recursion: true,
              delay_until_recursion: 2,
            },
          },
        },
        {
          id: 'test.list.upsert',
          target: {
            kind: 'worldbook-upsert-entry',
            entryNames: ['变量列表'],
          },
          entry: {
            uid: 0,
            name: '变量列表',
            content: '{{format_message_variable::stat_data}}',
            keys: [],
            secondary_keys: [],
            constant: true,
            selective: false,
            insertion_order: 200,
            enabled: true,
            position: 'after_char',
            use_regex: false,
            extra: { position: 4, depth: 0, role: 0 },
          },
        },
      ],
    });

    const result = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });

    expect(result.conflicts).toEqual([]);
    expect(harness.worldbook).toHaveLength(2);
    expect(harness.worldbook[0]).toMatchObject({
      uid: 17,
      name: '[mvu_update]变量更新规则',
      content: '全新规则',
      strategy: {
        type: 'selective',
        keys: ['规则'],
        keys_secondary: { logic: 'and_all', keys: ['变量'] },
        scan_depth: 5,
      },
      position: {
        type: 'at_depth',
        role: 'assistant',
        depth: 2,
        order: 208,
      },
      recursion: {
        prevent_incoming: true,
        prevent_outgoing: true,
        delay_until: 2,
      },
    });
    expect(harness.worldbook[1]).toMatchObject({
      name: '变量列表',
      content: '{{format_message_variable::stat_data}}',
    });
  });

  it('受控 create-entry 连续同步两次只创建一个 normalized 条目', async () => {
    const harness = createHarness({
      operations: [
        {
          id: 'test.create-entry.idempotent',
          target: {
            kind: 'worldbook-create-entry',
            managedId: 'test.created.entry',
          },
          entry: {
            uid: 0,
            name: '受控新增条目',
            content: '受控内容',
            keys: ['新增'],
            secondary_keys: ['测试'],
            constant: false,
            selective: true,
            insertion_order: 321,
            enabled: true,
            position: 'after_char',
            use_regex: false,
            extra: {
              position: 4,
              role: 1,
              depth: 1,
              selectiveLogic: 3,
              exclude_recursion: true,
              prevent_recursion: true,
            },
          },
        },
      ],
    });

    const first = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });
    const second = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });

    expect(first).toMatchObject({ applied: 1, skipped: 0, conflicts: [] });
    expect(second).toMatchObject({ applied: 0, skipped: 1, conflicts: [] });
    expect(
      harness.worldbook.filter(
        (entry) => entry.extra?.caelianManagedId === 'test.created.entry',
      ),
    ).toEqual([
      expect.objectContaining({
        name: '受控新增条目',
        strategy: {
          type: 'selective',
          keys: ['新增'],
          keys_secondary: { logic: 'and_all', keys: ['测试'] },
          scan_depth: 'same_as_global',
        },
        position: {
          type: 'at_depth',
          role: 'user',
          depth: 1,
          order: 321,
        },
        recursion: {
          prevent_incoming: true,
          prevent_outgoing: true,
          delay_until: null,
        },
      }),
    ]);
    expect(harness.helper.updateWorldbookWith).toHaveBeenCalledTimes(1);
  });

  it('create-entry 配置被破坏后原地修复并保留 uid 与玩家 extra', async () => {
    const harness = createHarness({
      operations: [
        {
          id: 'test.create-entry.repair-normalized-config',
          target: {
            kind: 'worldbook-create-entry',
            managedId: 'test.created.repair',
          },
          entry: {
            uid: 73,
            name: '受控修复条目',
            content: '受控内容',
            keys: ['修复'],
            secondary_keys: ['配置'],
            constant: false,
            selective: true,
            insertion_order: 512,
            enabled: true,
            position: 'after_char',
            use_regex: false,
            extra: {
              position: 4,
              role: 2,
              depth: 2,
              selectiveLogic: 3,
              scan_depth: 7,
              exclude_recursion: true,
              prevent_recursion: true,
              delay_until_recursion: 3,
              sticky: 2,
              cooldown: 4,
              delay: 1,
              officialFlag: 'keep-official',
            },
          },
        },
      ],
    });

    expect(
      await new ManagedContentUpdater(harness.host).sync({ force: true }),
    ).toMatchObject({ applied: 1, skipped: 0, conflicts: [] });
    const created = harness.worldbook.find(
      (entry) =>
        entry.extra?.caelianManagedId === 'test.created.repair',
    );
    if (!created) throw new Error('受控测试条目不存在');
    created.strategy.type = 'constant';
    created.position.type = 'before_character_definition';
    created.position.order = 1;
    created.recursion.prevent_incoming = false;
    created.effect.sticky = 99;
    created.extra = {
      ...created.extra,
      caelianManagedId: 'test.created.repair',
      playerNote: '保留玩家附加信息',
    };

    const repaired = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });

    expect(repaired).toMatchObject({
      applied: 1,
      skipped: 0,
      conflicts: [],
    });
    const matches = harness.worldbook.filter(
      (entry) =>
        entry.extra?.caelianManagedId === 'test.created.repair',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      uid: 73,
      strategy: {
        type: 'selective',
        keys: ['修复'],
        keys_secondary: { logic: 'and_all', keys: ['配置'] },
        scan_depth: 7,
      },
      position: {
        type: 'at_depth',
        role: 'assistant',
        depth: 2,
        order: 512,
      },
      recursion: {
        prevent_incoming: true,
        prevent_outgoing: true,
        delay_until: 3,
      },
      effect: { sticky: 2, cooldown: 4, delay: 1 },
      extra: {
        caelianManagedId: 'test.created.repair',
        officialFlag: 'keep-official',
        playerNote: '保留玩家附加信息',
      },
    });
    expect(harness.helper.updateWorldbookWith).toHaveBeenCalledTimes(2);
  });

  it('已有 ledger 但 normalized 世界书配置被破坏时会重新施加', async () => {
    const harness = createHarness({
      operations: [
        {
          id: 'test.upsert.repair-normalized-config',
          target: {
            kind: 'worldbook-upsert-entry',
            entryNames: ['变量更新规则'],
          },
          entry: {
            uid: 0,
            name: '变量更新规则',
            content: '受控规则',
            keys: ['规则'],
            secondary_keys: ['变量'],
            constant: false,
            selective: true,
            insertion_order: 410,
            enabled: true,
            position: 'after_char',
            use_regex: false,
            extra: {
              position: 4,
              role: 2,
              depth: 3,
              selectiveLogic: 3,
              scan_depth: 6,
              exclude_recursion: true,
              prevent_recursion: true,
              delay_until_recursion: 4,
            },
          },
        },
      ],
    });

    const first = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });
    expect(first).toMatchObject({ applied: 1, skipped: 0, conflicts: [] });
    expect(
      [...harness.storage.keys()].some((key) =>
        key.startsWith('caelian:managed-content:applied:v1:card:'),
      ),
    ).toBe(true);

    const entry = harness.worldbook[0];
    if (!entry) throw new Error('测试条目不存在');
    entry.strategy.keys_secondary.logic = 'and_any';
    entry.position.depth = 99;
    entry.recursion.prevent_outgoing = false;

    const second = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });

    expect(second).toMatchObject({ applied: 1, skipped: 0, conflicts: [] });
    expect(harness.worldbook[0]).toMatchObject({
      strategy: {
        type: 'selective',
        keys: ['规则'],
        keys_secondary: { logic: 'and_all', keys: ['变量'] },
        scan_depth: 6,
      },
      position: {
        type: 'at_depth',
        role: 'assistant',
        depth: 3,
        order: 410,
      },
      recursion: {
        prevent_incoming: true,
        prevent_outgoing: true,
        delay_until: 4,
      },
    });
    expect(harness.helper.updateWorldbookWith).toHaveBeenCalledTimes(2);
  });

  it('角色或绑定世界书不匹配时不读取也不修改', async () => {
    const wrongCharacter = createHarness({ characterName: '其他角色' });
    const characterResult = await new ManagedContentUpdater(
      wrongCharacter.host,
    ).sync({ force: true });
    expect(characterResult.status).toBe('wrong-character');
    expect(wrongCharacter.host.fetch).not.toHaveBeenCalled();

    const wrongBook = createHarness({ worldbookName: '玩家自己的世界书' });
    const bookResult = await new ManagedContentUpdater(wrongBook.host).sync({
      force: true,
    });
    expect(bookResult.status).toBe('wrong-worldbook');
    expect(wrongBook.host.fetch).not.toHaveBeenCalled();
  });

  it('目标片段被玩家改写时记录冲突并保留玩家版本', async () => {
    const harness = createHarness({
      operations: [
        {
          id: 'test.conflict',
          target: {
            kind: 'character-field',
            field: 'description',
          },
          mutation: {
            action: 'replace-exact',
            before: '已经不存在的官方旧段落',
            after: '官方新段落',
          },
        },
      ],
    });

    const result = await new ManagedContentUpdater(harness.host).sync({
      force: true,
    });

    expect(result.applied).toBe(0);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ operationId: 'test.conflict' }),
    ]);
    expect(harness.character.description).toContain('玩家新增：保留我');
  });

  it('受控片段被玩家修改后拒绝覆盖', () => {
    const initial = applyTextMutation('玩家正文', {
      action: 'upsert-managed-block',
      blockId: 'official.rules',
      content: '官方 v1',
    });
    const playerEdited = initial.replace('官方 v1', '玩家修改的 v1');

    expect(() =>
      applyTextMutation(playerEdited, {
        action: 'upsert-managed-block',
        blockId: 'official.rules',
        content: '官方 v2',
        expectedPrevious: '官方 v1',
      }),
    ).toThrow('已被玩家修改');
    expect(playerEdited).toContain('玩家修改的 v1');
  });
});
