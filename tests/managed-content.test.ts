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

function createHarness(options: {
  characterName?: string;
  worldbookName?: string;
  operations?: unknown[];
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
      },
    },
  };
  const worldbook = [
    {
      uid: 17,
      name: '变量更新规则',
      content: '旧规则\n玩家新增世界观',
    },
  ];
  const helper = {
    getCurrentCharacterName: () => options.characterName ?? '凯利安',
    getCharWorldbookNames: () => ({
      primary: options.worldbookName ?? '孔雀开屏你说看不见',
      additional: [],
    }),
    updateCharacterWith: vi.fn(
      async (
        _name: 'current',
        updater: (value: typeof character) => typeof character,
      ) => updater(character),
    ),
    updateWorldbookWith: vi.fn(
      async (
        _name: string,
        updater: (value: typeof worldbook) => typeof worldbook,
      ) => updater(worldbook),
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
  const host = {
    TavernHelper: helper,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    fetch: vi.fn(async () => ({
      ok: true,
      json: async () => manifest,
    })),
  } as unknown as Window;
  return { host, helper, character, worldbook, storage };
}

describe('ManagedContentUpdater', () => {
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
      (entry: Record<string, unknown>) => ({
        ...entry,
        uid: entry.id,
        name: entry.comment,
        content: entry.content,
      }),
    );
    const before = JSON.stringify({ character, worldbook });
    const storage = new Map<string, string>();
    const helper = {
      getCurrentCharacterName: () => '凯利安',
      getCharWorldbookNames: () => ({
        primary: '孔雀开屏你说看不见',
        additional: [],
      }),
      updateCharacterWith: async (
        _name: string,
        updater: (value: typeof character) => typeof character,
      ) => updater(character),
      updateWorldbookWith: async (
        _name: string,
        updater: (value: typeof worldbook) => typeof worldbook,
      ) => updater(worldbook),
    };
    const host = {
      TavernHelper: helper,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      fetch: async () => ({ ok: true, json: async () => manifest }),
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
