import {
  caelianWorldbookFamily,
  isCaelianCharacterName,
  isCaelianWorldbookName,
} from '@/content/character-identity';

const CHARACTER_NAME = '凯利安';
const APPLIED_STORAGE_KEY = 'caelian:managed-content:applied:v1';
const CONFLICT_STORAGE_KEY = 'caelian:managed-content:conflicts:v1';
const AUTO_UPDATE_STORAGE_KEY = 'caelian:managed-content:auto:v1';
const ALPHA_MANIFEST_SOURCES = [
  'https://jhyshl.github.io/caelian-re-oseas/managed-content/alpha.json',
  'https://caelian-re-oseas-alpha.jianghailou7.chatgpt.site/managed-content/alpha.json',
] as const;

type CharacterField = 'description' | 'creator_notes';

interface ManagedCharacter {
  description: string;
  creator_notes: string;
  first_messages: string[];
  extensions: {
    tavern_helper?: {
      scripts?: Array<{
        id?: string;
        name?: string;
        content?: string;
        [key: string]: unknown;
      }>;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ManagedWorldbookEntry {
  uid: number | string;
  name: string;
  content: string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ManagedContentApi {
  getCurrentCharacterName?: () => string | null;
  getCharWorldbookNames?: (
    characterName: 'current',
  ) => { primary: string | null; additional: string[] };
  updateCharacterWith?: (
    characterName: 'current',
    updater: (character: ManagedCharacter) => ManagedCharacter,
  ) => Promise<ManagedCharacter>;
  updateWorldbookWith?: (
    worldbookName: string,
    updater: (
      entries: ManagedWorldbookEntry[],
    ) => ManagedWorldbookEntry[],
    options?: { render?: 'debounced' | 'immediate' },
  ) => Promise<ManagedWorldbookEntry[]>;
}

type TextMutation =
  | {
      action: 'replace-entire';
      content: string;
    }
  | {
      action: 'replace-exact';
      before: string;
      after: string;
    }
  | {
      action: 'delete-exact';
      text: string;
    }
  | {
      action: 'insert-before' | 'insert-after';
      anchor: string;
      text: string;
    }
  | {
      action: 'upsert-managed-block';
      blockId: string;
      content: string;
      placement?: 'append' | 'prepend';
      expectedPrevious?: string;
    }
  | {
      action: 'delete-managed-block';
      blockId: string;
      expectedPrevious?: string;
    };

type ManagedContentOperation =
  | {
      id: string;
      target: {
        kind: 'character-field';
        field: CharacterField;
      };
      mutation: TextMutation;
    }
  | {
      id: string;
      target: {
        kind: 'character-first-message';
        index: number;
      };
      mutation: TextMutation;
    }
  | {
      id: string;
      target: {
        kind: 'character-script';
        scriptId: string;
        scriptName?: string;
      };
      mutation: TextMutation;
    }
  | {
      id: string;
      target: {
        kind: 'worldbook-entry';
        entryName: string;
        entryUid?: number | string;
      };
      mutation: TextMutation;
    }
  | {
      id: string;
      target: {
        kind: 'worldbook-upsert-entry';
        entryNames: string[];
      };
      entry: Partial<ManagedWorldbookEntry>;
    }
  | {
      id: string;
      target: {
        kind: 'worldbook-create-entry';
        managedId: string;
      };
      entry: Partial<ManagedWorldbookEntry>;
    }
  | {
      id: string;
      target: {
        kind: 'worldbook-delete-entry';
        managedId: string;
      };
    };

interface ManagedContentManifest {
  schemaVersion: 1;
  channel: 'alpha';
  revision: string;
  target: {
    characterName: '凯利安';
    worldbookNames: string[];
    requirePrimaryBinding: true;
  };
  sourceCard?: {
    url: string;
    sha256: string;
  };
  operations: ManagedContentOperation[];
}

interface AppliedOperation {
  checksum: string;
  revision: string;
  appliedAt: number;
}

export interface ManagedContentSyncResult {
  status:
    | 'applied'
    | 'current'
    | 'disabled'
    | 'unavailable'
    | 'wrong-character'
    | 'wrong-worldbook'
    | 'offline';
  revision?: string;
  applied: number;
  skipped: number;
  conflicts: Array<{ operationId: string; reason: string }>;
}

export class ManagedContentUpdater {
  private syncTask?: Promise<ManagedContentSyncResult>;

  constructor(
    private readonly host: Window,
    private readonly channel: 'alpha' | 'beta' = 'alpha',
    private readonly manifestSources = defaultManifestSources(channel),
  ) {}

  autoUpdateEnabled(): boolean {
    return (
      this.host.localStorage.getItem(
        this.storageKey(AUTO_UPDATE_STORAGE_KEY),
      ) !== 'off'
    );
  }

  setAutoUpdateEnabled(enabled: boolean): void {
    this.host.localStorage.setItem(
      this.storageKey(AUTO_UPDATE_STORAGE_KEY),
      enabled ? 'on' : 'off',
    );
  }

  sync(options: { force?: boolean } = {}): Promise<ManagedContentSyncResult> {
    if (this.syncTask) return this.syncTask;
    this.syncTask = this.performSync(options).finally(() => {
      this.syncTask = undefined;
    });
    return this.syncTask;
  }

  private async performSync(
    options: { force?: boolean },
  ): Promise<ManagedContentSyncResult> {
    if (!options.force && !this.autoUpdateEnabled()) {
      return emptyResult('disabled');
    }

    const api = this.resolveApi();
    if (
      !api.updateCharacterWith ||
      !api.updateWorldbookWith ||
      !api.getCharWorldbookNames
    ) {
      return emptyResult('unavailable');
    }

    const characterName = await this.currentCharacterName(api);
    if (!isCaelianCharacterName(characterName)) {
      return emptyResult('wrong-character');
    }

    const bindings = api.getCharWorldbookNames.call(api, 'current');
    const worldbookName = bindings.primary?.trim() ?? '';
    if (!isCaelianWorldbookName(worldbookName)) {
      return emptyResult('wrong-worldbook');
    }

    const manifest = await this.fetchManifest();
    if (!manifest) return emptyResult('offline');
    this.assertSafeManifest(manifest, worldbookName);

    const appliedState = this.readAppliedState();
    const conflicts: ManagedContentSyncResult['conflicts'] = [];
    let applied = 0;
    let skipped = 0;

    for (const operation of manifest.operations) {
      const checksum = stableHash(operation);
      const previous = appliedState[operation.id];
      if (previous?.checksum === checksum) {
        skipped += 1;
        continue;
      }
      if (previous && previous.checksum !== checksum) {
        conflicts.push({
          operationId: operation.id,
          reason: '管理端重复使用了已经执行过的操作编号',
        });
        continue;
      }

      try {
        await this.applyOperation(api, worldbookName, operation);
        appliedState[operation.id] = {
          checksum,
          revision: manifest.revision,
          appliedAt: Date.now(),
        };
        this.writeAppliedState(appliedState);
        applied += 1;
      } catch (error) {
        conflicts.push({
          operationId: operation.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.writeConflicts(manifest.revision, conflicts);
    return {
      status: applied > 0 ? 'applied' : 'current',
      revision: manifest.revision,
      applied,
      skipped,
      conflicts,
    };
  }

  private async currentCharacterName(
    api: ManagedContentApi,
  ): Promise<string | null> {
    const direct = api.getCurrentCharacterName?.call(api);
    if (typeof direct === 'string') return direct.trim();
    try {
      const context = await Promise.resolve(
        this.host.SillyTavern?.getContext?.(),
      );
      return context?.name2?.trim() ?? null;
    } catch {
      return null;
    }
  }

  private resolveApi(): ManagedContentApi {
    const hostRecord = this.host as unknown as Record<string, unknown>;
    const helper = hostRecord.TavernHelper;
    return (
      typeof helper === 'object' && helper !== null ? helper : hostRecord
    ) as ManagedContentApi;
  }

  private async fetchManifest(): Promise<ManagedContentManifest | null> {
    for (const source of this.manifestSources) {
      try {
        const url = `${source}?managed-content=${Date.now()}`;
        const response = await this.host.fetch(url, {
          cache: 'no-store',
          credentials: 'omit',
        });
        if (!response.ok) continue;
        return validateManifest(await response.json());
      } catch {
        // The next public mirror may still be reachable.
      }
    }
    return null;
  }

  private assertSafeManifest(
    manifest: ManagedContentManifest,
    boundWorldbook: string,
  ): void {
    if (
      manifest.target.characterName !== CHARACTER_NAME ||
      manifest.target.requirePrimaryBinding !== true ||
      !manifest.target.worldbookNames.some(
        (name) =>
          caelianWorldbookFamily(name) ===
          caelianWorldbookFamily(boundWorldbook),
      ) ||
      manifest.target.worldbookNames.some(
        (name) => !isCaelianWorldbookName(name),
      )
    ) {
      throw new Error('远程内容清单的角色卡或世界书目标不在安全白名单中');
    }
  }

  private async applyOperation(
    api: ManagedContentApi,
    worldbookName: string,
    operation: ManagedContentOperation,
  ): Promise<void> {
    if (
      operation.target.kind === 'character-field' ||
      operation.target.kind === 'character-first-message' ||
      operation.target.kind === 'character-script'
    ) {
      await this.applyCharacterOperation(api, operation);
      return;
    }
    await this.applyWorldbookOperation(api, worldbookName, operation);
  }

  private async applyCharacterOperation(
    api: ManagedContentApi,
    operation: ManagedContentOperation,
  ): Promise<void> {
    if (!api.updateCharacterWith) throw new Error('角色卡编辑接口不可用');
    if (!('mutation' in operation)) {
      throw new Error('角色卡更新操作缺少文本命令');
    }
    await api.updateCharacterWith.call(api, 'current', (character) => {
      const target = operation.target;
      if (target.kind === 'character-field') {
        const field = target.field;
        character[field] = applyTextMutation(
          String(character[field] ?? ''),
          operation.mutation,
        );
        return character;
      }

      if (target.kind === 'character-first-message') {
        const index = target.index;
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= character.first_messages.length
        ) {
          throw new Error(`角色卡开场白索引 ${index} 不存在`);
        }
        character.first_messages[index] = applyTextMutation(
          character.first_messages[index] ?? '',
          operation.mutation,
        );
        return character;
      }

      if (target.kind !== 'character-script') {
        throw new Error('角色卡更新目标类型不合法');
      }
      const scripts =
        character.extensions?.tavern_helper?.scripts ?? [];
      const matches = scripts.filter(
        (script) =>
          script.id === target.scriptId &&
          (!target.scriptName || script.name === target.scriptName),
      );
      if (matches.length !== 1) {
        throw new Error(
          `角色卡脚本 ${target.scriptId} 未找到或不唯一`,
        );
      }
      const script = matches[0];
      if (!script) throw new Error('角色卡脚本不存在');
      script.content = applyTextMutation(
        String(script.content ?? ''),
        operation.mutation,
      );
      return character;
    });
  }

  private async applyWorldbookOperation(
    api: ManagedContentApi,
    worldbookName: string,
    operation: ManagedContentOperation,
  ): Promise<void> {
    if (!api.updateWorldbookWith) throw new Error('世界书编辑接口不可用');
    await api.updateWorldbookWith.call(
      api,
      worldbookName,
      (entries) => {
        const target = operation.target;
        if (target.kind === 'worldbook-upsert-entry') {
          if (!('entry' in operation)) {
            throw new Error('重建世界书条目的命令缺少条目内容');
          }
          const names = new Set(target.entryNames);
          const matches = entries.filter((entry) => names.has(entry.name));
          if (matches.length > 1) {
            throw new Error('世界书旧名称与新名称同时存在，无法安全合并');
          }
          const patch = managedWorldbookEntryPatch(operation.entry);
          if (matches.length === 0) {
            entries.push({ uid: 0, name: '', content: '', ...patch });
            return entries;
          }
          const entry = matches[0];
          if (!entry) throw new Error('世界书条目不存在');
          const uid = entry.uid;
          Object.assign(entry, patch, { uid });
          return entries;
        }

        if (target.kind === 'worldbook-create-entry') {
          if (!('entry' in operation)) {
            throw new Error('新增世界书条目的命令缺少条目内容');
          }
          const existing = entries.filter(
            (entry) =>
              entry.extra?.caelianManagedId === target.managedId,
          );
          if (existing.length > 0) {
            if (existing.length === 1) return entries;
            throw new Error('受控世界书条目标记不唯一');
          }
          entries.push({
            uid: operation.entry.uid ?? 0,
            name: String(operation.entry.name ?? ''),
            content: String(operation.entry.content ?? ''),
            ...operation.entry,
            extra: {
              ...(operation.entry.extra ?? {}),
              caelianManagedId: target.managedId,
            },
          });
          return entries;
        }

        if (target.kind === 'worldbook-delete-entry') {
          const indexes = entries.flatMap((entry, index) =>
            entry.extra?.caelianManagedId === target.managedId
              ? [index]
              : [],
          );
          if (indexes.length !== 1) {
            throw new Error('只允许删除唯一的受控世界书条目');
          }
          entries.splice(indexes[0] ?? -1, 1);
          return entries;
        }

        if (target.kind !== 'worldbook-entry' || !('mutation' in operation)) {
          throw new Error('世界书更新目标类型不合法');
        }
        const matches = entries.filter(
          (entry) =>
            entry.name === target.entryName &&
            (target.entryUid === undefined ||
              String(entry.uid) === String(target.entryUid)),
        );
        if (matches.length !== 1) {
          throw new Error(
            `世界书条目“${target.entryName}”未找到或不唯一`,
          );
        }
        const entry = matches[0];
        if (!entry) throw new Error('世界书条目不存在');
        entry.content = applyTextMutation(
          String(entry.content ?? ''),
          operation.mutation,
        );
        return entries;
      },
      { render: 'debounced' },
    );
  }

  private readAppliedState(): Record<string, AppliedOperation> {
    try {
      const value = JSON.parse(
        this.host.localStorage.getItem(
          this.storageKey(APPLIED_STORAGE_KEY),
        ) || '{}',
      );
      return isRecord(value)
        ? (value as Record<string, AppliedOperation>)
        : {};
    } catch {
      return {};
    }
  }

  private writeAppliedState(
    state: Record<string, AppliedOperation>,
  ): void {
    this.host.localStorage.setItem(
      this.storageKey(APPLIED_STORAGE_KEY),
      JSON.stringify(state),
    );
  }

  private writeConflicts(
    revision: string,
    conflicts: ManagedContentSyncResult['conflicts'],
  ): void {
    this.host.localStorage.setItem(
      this.storageKey(CONFLICT_STORAGE_KEY),
      JSON.stringify({ revision, conflicts, checkedAt: Date.now() }),
    );
  }

  private storageKey(base: string): string {
    return this.channel === 'alpha' ? base : `${base}:${this.channel}`;
  }
}

function defaultManifestSources(channel: 'alpha' | 'beta'): readonly string[] {
  if (channel === 'alpha') return ALPHA_MANIFEST_SOURCES;
  return [new URL('../managed-content/alpha.json', import.meta.url).href];
}

export function applyTextMutation(
  source: string,
  mutation: TextMutation,
): string {
  if (mutation.action === 'replace-entire') {
    return mutation.content;
  }
  if (mutation.action === 'replace-exact') {
    if (
      !source.includes(mutation.before) &&
      countOccurrences(source, mutation.after) === 1
    ) {
      return source;
    }
    requireSingleOccurrence(source, mutation.before, '待替换片段');
    return source.replace(mutation.before, mutation.after);
  }
  if (mutation.action === 'delete-exact') {
    if (!source.includes(mutation.text)) return source;
    requireSingleOccurrence(source, mutation.text, '待删除片段');
    return source.replace(mutation.text, '');
  }
  if ('anchor' in mutation) {
    const completed =
      mutation.action === 'insert-before'
        ? `${mutation.text}${mutation.anchor}`
        : `${mutation.anchor}${mutation.text}`;
    if (countOccurrences(source, completed) === 1) return source;
    requireSingleOccurrence(source, mutation.anchor, '插入锚点');
    return mutation.action === 'insert-before'
      ? source.replace(mutation.anchor, `${mutation.text}${mutation.anchor}`)
      : source.replace(mutation.anchor, `${mutation.anchor}${mutation.text}`);
  }

  const markers = managedBlockMarkers(mutation.blockId);
  const startIndex = source.indexOf(markers.start);
  const endIndex = source.indexOf(markers.end);
  if (mutation.action === 'delete-managed-block') {
    if (startIndex < 0 && endIndex < 0) {
      throw new Error(`受控片段 ${mutation.blockId} 不存在`);
    }
    const current = readManagedBlock(source, markers, startIndex, endIndex);
    if (
      mutation.expectedPrevious !== undefined &&
      current.content !== mutation.expectedPrevious
    ) {
      throw new Error(
        `受控片段 ${mutation.blockId} 已被玩家修改，已保留玩家版本`,
      );
    }
    return `${source.slice(0, current.start)}${source.slice(current.end)}`;
  }

  if (startIndex >= 0 || endIndex >= 0) {
    const current = readManagedBlock(source, markers, startIndex, endIndex);
    if (
      mutation.expectedPrevious !== undefined &&
      current.content !== mutation.expectedPrevious
    ) {
      throw new Error(
        `受控片段 ${mutation.blockId} 已被玩家修改，已保留玩家版本`,
      );
    }
    return [
      source.slice(0, current.start),
      markers.start,
      '\n',
      mutation.content,
      '\n',
      markers.end,
      source.slice(current.end),
    ].join('');
  }

  if (mutation.expectedPrevious !== undefined) {
    throw new Error(`受控片段 ${mutation.blockId} 缺失，无法安全升级`);
  }
  const block = `${markers.start}\n${mutation.content}\n${markers.end}`;
  return mutation.placement === 'prepend'
    ? `${block}\n${source}`
    : `${source}${source.endsWith('\n') || !source ? '' : '\n'}${block}`;
}

function readManagedBlock(
  source: string,
  markers: { start: string; end: string },
  startIndex: number,
  endIndex: number,
): { start: number; end: number; content: string } {
  if (
    startIndex < 0 ||
    endIndex < 0 ||
    endIndex < startIndex ||
    source.indexOf(markers.start, startIndex + markers.start.length) >= 0 ||
    source.indexOf(markers.end, endIndex + markers.end.length) >= 0
  ) {
    throw new Error('受控片段标记缺失、重复或顺序错误');
  }
  const contentStart = startIndex + markers.start.length;
  const raw = source.slice(contentStart, endIndex);
  return {
    start: startIndex,
    end: endIndex + markers.end.length,
    content: raw.replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
  };
}

function managedBlockMarkers(blockId: string): {
  start: string;
  end: string;
} {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(blockId)) {
    throw new Error('受控片段编号格式不合法');
  }
  return {
    start: `<!-- CAELIAN-MANAGED:${blockId}:START -->`,
    end: `<!-- CAELIAN-MANAGED:${blockId}:END -->`,
  };
}

function requireSingleOccurrence(
  source: string,
  needle: string,
  label: string,
): void {
  if (!needle) throw new Error(`${label}不能为空`);
  const first = source.indexOf(needle);
  const second =
    first < 0 ? -1 : source.indexOf(needle, first + needle.length);
  if (first < 0 || second >= 0) {
    throw new Error(`${label}不存在或出现多次，已停止以保留玩家修改`);
  }
}

function countOccurrences(source: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= source.length - needle.length) {
    const index = source.indexOf(needle, cursor);
    if (index < 0) break;
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}

function validateManifest(value: unknown): ManagedContentManifest {
  if (!isRecord(value)) throw new Error('内容更新清单不是对象');
  const target = isRecord(value.target) ? value.target : {};
  const operations = Array.isArray(value.operations)
    ? value.operations
    : null;
  if (
    value.schemaVersion !== 1 ||
    value.channel !== 'alpha' ||
    typeof value.revision !== 'string' ||
    target.characterName !== CHARACTER_NAME ||
    target.requirePrimaryBinding !== true ||
    !Array.isArray(target.worldbookNames) ||
    !target.worldbookNames.every((name) => typeof name === 'string') ||
    !operations ||
    operations.length > 200
  ) {
    throw new Error('内容更新清单格式不合法');
  }
  const ids = new Set<string>();
  for (const operation of operations) {
    if (
      !isRecord(operation) ||
      typeof operation.id !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{0,159}$/i.test(operation.id) ||
      ids.has(operation.id) ||
      !isRecord(operation.target) ||
      typeof operation.target.kind !== 'string'
    ) {
      throw new Error('内容更新操作格式或编号不合法');
    }
    validateOperation(operation);
    ids.add(operation.id);
  }
  return value as unknown as ManagedContentManifest;
}

function validateOperation(operation: Record<string, unknown>): void {
  const target = operation.target as Record<string, unknown>;
  const kind = target.kind;
  if (kind === 'character-field') {
    if (
      target.field !== 'description' &&
      target.field !== 'creator_notes'
    ) {
      throw new Error('角色卡文本字段不在允许列表中');
    }
    validateTextMutation(operation.mutation);
    return;
  }
  if (kind === 'character-first-message') {
    if (
      !Number.isInteger(target.index) ||
      Number(target.index) < 0 ||
      Number(target.index) > 99
    ) {
      throw new Error('角色卡开场白索引不合法');
    }
    validateTextMutation(operation.mutation);
    return;
  }
  if (kind === 'character-script') {
    requireBoundedString(target.scriptId, '角色卡脚本编号', 1, 160);
    if (target.scriptName !== undefined) {
      requireBoundedString(target.scriptName, '角色卡脚本名称', 1, 160);
    }
    validateTextMutation(operation.mutation);
    return;
  }
  if (kind === 'worldbook-entry') {
    requireBoundedString(target.entryName, '世界书条目名称', 1, 200);
    if (
      target.entryUid !== undefined &&
      typeof target.entryUid !== 'string' &&
      typeof target.entryUid !== 'number'
    ) {
      throw new Error('世界书条目 UID 格式不合法');
    }
    validateTextMutation(operation.mutation);
    return;
  }
  if (kind === 'worldbook-upsert-entry') {
    if (
      !Array.isArray(target.entryNames) ||
      target.entryNames.length < 1 ||
      target.entryNames.length > 8 ||
      !target.entryNames.every((name) => typeof name === 'string') ||
      new Set(target.entryNames).size !== target.entryNames.length
    ) {
      throw new Error('世界书条目候选名称不合法');
    }
    target.entryNames.forEach((name) =>
      requireBoundedString(name, '世界书条目候选名称', 1, 200),
    );
    validateWorldbookEntryPatch(operation.entry);
    return;
  }
  if (
    kind === 'worldbook-create-entry' ||
    kind === 'worldbook-delete-entry'
  ) {
    requireManagedId(target.managedId);
    if (kind === 'worldbook-create-entry') {
      if (!isRecord(operation.entry)) {
        throw new Error('新增世界书条目缺少条目对象');
      }
      requireBoundedString(
        operation.entry.name ?? '',
        '新增世界书条目名称',
        0,
        200,
      );
      requireBoundedString(
        operation.entry.content ?? '',
        '新增世界书条目内容',
        0,
        200_000,
      );
    }
    return;
  }
  throw new Error('内容更新目标类型不在允许列表中');
}

function validateTextMutation(value: unknown): void {
  if (!isRecord(value) || typeof value.action !== 'string') {
    throw new Error('文本更新命令格式不合法');
  }
  if (value.action === 'replace-entire') {
    requireBoundedString(value.content, '整项替换内容', 0, 200_000);
    return;
  }
  if (value.action === 'replace-exact') {
    requireBoundedString(value.before, '待替换片段', 1, 200_000);
    requireBoundedString(value.after, '替换后片段', 0, 200_000);
    return;
  }
  if (value.action === 'delete-exact') {
    requireBoundedString(value.text, '待删除片段', 1, 200_000);
    return;
  }
  if (
    value.action === 'insert-before' ||
    value.action === 'insert-after'
  ) {
    requireBoundedString(value.anchor, '插入锚点', 1, 200_000);
    requireBoundedString(value.text, '插入内容', 1, 200_000);
    return;
  }
  if (
    value.action === 'upsert-managed-block' ||
    value.action === 'delete-managed-block'
  ) {
    requireManagedId(value.blockId);
    if (value.expectedPrevious !== undefined) {
      requireBoundedString(
        value.expectedPrevious,
        '受控片段旧内容',
        0,
        200_000,
      );
    }
    if (value.action === 'upsert-managed-block') {
      requireBoundedString(
        value.content,
        '受控片段新内容',
        0,
        200_000,
      );
      if (
        value.placement !== undefined &&
        value.placement !== 'append' &&
        value.placement !== 'prepend'
      ) {
        throw new Error('受控片段插入位置不合法');
      }
    }
    return;
  }
  throw new Error('文本更新动作不在允许列表中');
}

function validateWorldbookEntryPatch(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('世界书条目重建内容不是对象');
  }
  const allowed = new Set([
    'uid',
    'name',
    'content',
    'keys',
    'secondary_keys',
    'constant',
    'selective',
    'insertion_order',
    'enabled',
    'position',
    'use_regex',
    'extra',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error('世界书条目重建内容含有不允许的字段');
  }
  requireBoundedString(value.name, '世界书条目名称', 1, 200);
  requireBoundedString(value.content, '世界书条目内容', 0, 200_000);
  if (
    !Array.isArray(value.keys) ||
    !value.keys.every((key) => typeof key === 'string') ||
    !Array.isArray(value.secondary_keys) ||
    !value.secondary_keys.every((key) => typeof key === 'string')
  ) {
    throw new Error('世界书条目关键词格式不合法');
  }
  for (const key of [
    'constant',
    'selective',
    'enabled',
    'use_regex',
  ] as const) {
    if (typeof value[key] !== 'boolean') {
      throw new Error(`世界书条目字段 ${key} 必须是布尔值`);
    }
  }
  if (
    !Number.isInteger(value.insertion_order) ||
    Number(value.insertion_order) < 0 ||
    Number(value.insertion_order) > 10_000 ||
    (value.position !== 'before_char' && value.position !== 'after_char') ||
    !isRecord(value.extra)
  ) {
    throw new Error('世界书条目注入配置不合法');
  }
}

function managedWorldbookEntryPatch(
  value: Partial<ManagedWorldbookEntry>,
): Omit<ManagedWorldbookEntry, 'uid'> {
  return {
    name: String(value.name ?? ''),
    content: String(value.content ?? ''),
    keys: [...((value.keys as string[] | undefined) ?? [])],
    secondary_keys: [
      ...((value.secondary_keys as string[] | undefined) ?? []),
    ],
    constant: value.constant,
    selective: value.selective,
    insertion_order: value.insertion_order,
    enabled: value.enabled,
    position: value.position,
    use_regex: value.use_regex,
    extra: { ...(value.extra ?? {}) },
  };
}

function requireManagedId(value: unknown): void {
  if (
    typeof value !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)
  ) {
    throw new Error('受控内容编号格式不合法');
  }
}

function requireBoundedString(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): void {
  if (
    typeof value !== 'string' ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new Error(`${label}长度或类型不合法`);
  }
}

function stableHash(value: unknown): string {
  const source = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function emptyResult(
  status: ManagedContentSyncResult['status'],
): ManagedContentSyncResult {
  return { status, applied: 0, skipped: 0, conflicts: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
