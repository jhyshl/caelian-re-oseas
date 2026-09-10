import {
  isCaelianCharacterName,
  isCaelianWorldbookName,
} from '@/content/character-identity';
import {
  CharacterTargetError,
  captureCharacterGuard,
  primaryWorldbook,
  readCharacterTarget,
  type CharacterTarget,
} from '@/tavern/character-target';

export const REGION_ALIASES = {
  圣德里安学院: [
    '圣德里安学院',
    '学院',
    '正门',
    '中央广场',
    '宿舍',
    '宿舍楼',
    '餐厅',
    '普通教学楼',
    '实验教学楼',
    '魔药课教室',
    '炼金课教室',
    '实战教学楼',
    '实战教室',
    '图书馆',
    '卡拉尔树林',
    '无为广场',
    '任务大厅',
    '训练场',
    '冒险者协会分部',
  ],
  伊拉亚城: [
    '伊拉亚城',
    '伊利亚城',
    '伊利亚',
    '伊拉亚',
    '中央商业区',
    '下城区',
    '冒险者协会总部',
    '集市',
    '城门区',
    '永恒之都酒馆',
    '永恒之都',
    '地下黑市',
    '幽光森林',
    '帕德里湖',
    '城郊',
    '城郊墓园',
    '墓园',
    '花店',
    '圣心百合采集地',
  ],
  索拉维亚: [
    '索拉维亚',
    '索拉维亚(皇都)',
    '皇都',
    '索拉姆',
    '索拉姆城',
    '皇城',
    '皇宫',
    '玛利亚教堂',
    '沃西微',
    '赛梅斯商会总部',
    '金鸢赌场',
    '圣教会',
    '圣心大教堂',
    '圣心大教堂地下室',
    '圣心大教堂地下建筑',
    '圣教会地下室',
    '实验室',
    '安眠处',
    '皇宫外城区',
    '贵族街区',
    '皇家骑士团驻地',
    '古墓入口',
    '远古遗迹',
  ],
  奈亚索斯城: [
    '奈亚索斯城',
    '奈亚索斯',
    '潮汐广场',
    '珊瑚宫歌剧院',
    '娜贝儿大饭店',
    '荧光海湾步道',
    '珍珠之心',
    '声声不息大酒店',
    '白沙滩',
    '潮间带岩礁区',
  ],
  阿必塞海: [
    '阿必塞海',
    '亚特兰蒂斯',
    '残破的宫殿',
    '曾经繁华的都城',
    '神秘的石室',
    '海渊祭坛',
    '深水区',
    '礁石区',
  ],
  艾瑟拉森林: [
    '艾瑟拉森林',
    '艾瑟拉',
    '焦木林',
    '蓝眼泪湖',
    '林心地',
    '光明祭台',
    '古树根庭',
    '古树之根',
    '古树',
  ],
  炉心城: ['炉心城', '研究制造所', '岩采矿洞', '迪克酒馆', '武器工坊'],
  远古圣山: [
    '远古圣山',
    '圣山',
    '圣山山脚',
    '龙族古道',
    '云顶祭坛',
    '圣所',
  ],
  银月之城: [
    '银月之城',
    '银月城',
    '银月',
    '维兰瑟庄园',
    '希维里酒店',
    '蒙莱',
    '西西里',
    '红蔷薇据点',
  ],
  极北之地: [
    '极北之地',
    '极北',
    '极北边境',
    '黑潮裂隙',
    '废弃哨站',
    '渊底之地',
    '深渊',
    '墨摩利亚',
    '墨摩利亚魔王城',
    '多洛瑞亚',
    '多洛瑞亚魔王城',
    '普罗菲娜',
    '普罗菲娜魔王城',
    '卢曼',
    '卢曼魔王城',
    '沃拉戈',
    '沃拉戈魔王城',
    '尤兰杜姆',
    '尤兰杜姆魔王城',
    '忒米努斯',
    '忒米努斯魔王城',
  ],
} as const;

const ALIAS_INDEX = Object.entries(REGION_ALIASES)
  .flatMap(([region, aliases]) =>
    aliases.map((alias) => ({ region, alias })),
  )
  .sort((left, right) => right.alias.length - left.alias.length);

export interface RegionWorldbookEntry {
  id?: number | string;
  uid?: number | string;
  name?: string;
  comment?: string;
  content?: string;
  enabled?: boolean;
  keys?: string[] | string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RegionWorldbookApi {
  getCurrentCharacterName?: () => string | null;
  getCharWorldbookNames?: (
    characterName: 'current',
  ) => { primary: string | null; additional: string[] } | Promise<{ primary: string | null; additional: string[] }>;
  getWorldbook?: (
    worldbookName: string,
  ) => Promise<RegionWorldbookEntry[]>;
  updateWorldbookWith?: (
    worldbookName: string,
    updater: (entries: RegionWorldbookEntry[]) => RegionWorldbookEntry[],
    options?: { render?: 'debounced' | 'immediate' },
  ) => Promise<RegionWorldbookEntry[]>;
}

export interface RegionWorldbookSyncResult {
  status:
    | 'applied'
    | 'current'
    | 'skipped'
    | 'invalid-region'
    | 'unavailable'
    | 'wrong-character'
    | 'wrong-worldbook'
    | 'no-tagged-entries'
    | 'failed';
  region: string;
  touched: number;
  changed: number;
  message?: string;
}

export interface RegionWorldbookRegionStatus {
  region: string;
  total: number;
  enabled: number;
  state: 'on' | 'off' | 'mixed';
}

export interface RegionWorldbookOverview {
  status:
    | 'current'
    | 'unavailable'
    | 'wrong-character'
    | 'wrong-worldbook'
    | 'failed';
  regions: RegionWorldbookRegionStatus[];
  message?: string;
}

export interface LegacyQuestWorldbookCleanupResult {
  status:
    | 'applied'
    | 'current'
    | 'unavailable'
    | 'wrong-character'
    | 'wrong-worldbook'
    | 'failed';
  removed: number;
  message?: string;
}

const LEGACY_QUEST_NUMERIC_IDS = new Set([
  42,
  ...integerRange(85, 145),
  ...integerRange(168, 176),
  ...integerRange(184, 188),
]);
const LEGACY_QUEST_STRING_IDS = new Set([
  'ae5e5d48-fd68-4b91-9d26-df7808270437',
  'cot-universal-task-guard-v1',
]);
const LEGACY_QUEST_EXACT_NAMES = new Set([
  '支线任务系统',
  '主线任务系统',
  'cot',
  '系统｜主线完成奖励与成就结算规则',
]);
const LEGACY_QUEST_NAME_PATTERNS = [
  /\[(?:AUTO_(?:MAINQUEST|SIDEQUEST)|ONBOARDING_ONLY_MAINQUEST|LOCK_MAINQUEST_INTERACTION)/i,
  /^主线｜总控\b/,
  /^学院主线｜周年庆筹备日｜/,
  /^DLC｜(?:银月|奈亚索斯|阿必塞海|索拉维亚|艾瑟拉森林|炉心城)主线｜/,
  /^DLC｜伊拉亚支线｜/,
  /^原版DLC补全｜DLC\.Niyasos＆Abyssian Sea 2\.0 \(1\)｜(?:🧡|🆘DLC食用指南|💙亚特兰蒂斯相关)/,
  /^原版DLC补全｜DLC\.Augustun2\.0 \(2\)｜支线-圣教会/,
] as const;

export function normalizeRegion(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const matched = ALIAS_INDEX.find(
    ({ alias }) => text === alias || text.includes(alias),
  );
  return matched?.region ?? text.replace(/\(.+?\)/g, '').trim();
}

export function isLegacyQuestWorldbookEntry(
  entry: RegionWorldbookEntry,
): boolean {
  const id = entry.uid ?? entry.id;
  const names = [entry.name, entry.comment, entry.extra?.comment]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  const matchesOfficialName = names.some(
    (name) =>
      LEGACY_QUEST_EXACT_NAMES.has(name) ||
      LEGACY_QUEST_NAME_PATTERNS.some((pattern) => pattern.test(name)),
  );
  if (matchesOfficialName) return true;
  if (typeof id === 'string' && LEGACY_QUEST_STRING_IDS.has(id)) return true;
  if (names.length > 0) return false;
  return (
    (typeof id === 'number' && LEGACY_QUEST_NUMERIC_IDS.has(id)) ||
    (typeof id === 'string' &&
      /^\d+$/.test(id) &&
      LEGACY_QUEST_NUMERIC_IDS.has(Number(id)))
  );
}

export class RegionWorldbookSwitcher {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly resolveApi: () => RegionWorldbookApi,
    private readonly currentCharacterName: () => Promise<string | null>,
    private readonly host?: Window,
  ) {}

  cleanupLegacyQuestEntries(): Promise<LegacyQuestWorldbookCleanupResult> {
    const guard = this.host && captureCharacterGuard(this.host);
    const task = this.queue
      .catch(() => undefined)
      .then(() => this.performLegacyQuestCleanup(guard));
    this.queue = task;
    return task;
  }

  inspect(): Promise<RegionWorldbookOverview> {
    const guard = this.host && captureCharacterGuard(this.host);
    const task = this.queue
      .catch(() => undefined)
      .then(() => this.performInspect(guard));
    this.queue = task;
    return task;
  }

  setRegionEnabled(
    rawRegion: string,
    enabled: boolean,
  ): Promise<RegionWorldbookSyncResult> {
    const region = normalizeRegion(rawRegion);
    const guard = this.host && captureCharacterGuard(this.host);
    const task = this.queue
      .catch(() => undefined)
      .then(() => this.performRegionUpdate(region, enabled, guard));
    this.queue = task;
    return task;
  }

  switchRegion(
    rawPreviousRegion: string,
    rawNextRegion: string,
  ): Promise<RegionWorldbookSyncResult> {
    const previousRegion = normalizeRegion(rawPreviousRegion);
    const nextRegion = normalizeRegion(rawNextRegion);
    const guard = this.host && captureCharacterGuard(this.host);
    const task = this.queue
      .catch(() => undefined)
      .then(() => this.performRegionSwitch(previousRegion, nextRegion, guard));
    this.queue = task;
    return task;
  }

  private async performInspect(guard?: () => void): Promise<RegionWorldbookOverview> {
    const target = await this.resolveWorldbook(guard);
    if ('status' in target) {
      return { status: target.status, regions: [], message: target.message };
    }
    const getWorldbook = target.api.getWorldbook;
    if (!getWorldbook) return { status: 'unavailable', regions: [] };
    const counts = new Map<string, { total: number; enabled: number }>();
    try {
      const entries = target.entries ?? await getWorldbook.call(target.api, target.worldbookName);
      target.assertCurrent?.();
      for (const entry of entries) {
        for (const region of entryRegions(entry)) {
          const current = counts.get(region) ?? { total: 0, enabled: 0 };
          current.total += 1;
          if (entry.enabled === true) {
            current.enabled += 1;
          }
          counts.set(region, current);
        }
      }
    } catch (error) {
      return {
        status: 'failed',
        regions: [],
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      status: 'current',
      regions: [...counts.entries()]
        .map(([region, count]) => ({
          region,
          ...count,
          state:
            count.enabled === 0
              ? ('off' as const)
              : count.enabled === count.total
                ? ('on' as const)
                : ('mixed' as const),
        }))
        .sort((left, right) => left.region.localeCompare(right.region, 'zh-CN')),
    };
  }

  private async performRegionUpdate(
    region: string,
    enabled: boolean,
    guard?: () => void,
  ): Promise<RegionWorldbookSyncResult> {
    if (!region) return emptyResult('invalid-region', region);
    const target = await this.resolveWorldbook(guard);
    if ('status' in target) return emptyResult(target.status, region, target.message);
    const updateWorldbookWith = target.api.updateWorldbookWith;
    const getWorldbook = target.api.getWorldbook;
    if (!updateWorldbookWith || !getWorldbook) {
      return emptyResult('unavailable', region);
    }
    let touched = 0;
    let changed = 0;
    try {
      await updateWorldbookWith.call(
        target.api,
        target.worldbookName,
        (entries) => {
          target.assertCurrent?.();
          return entries.map((entry) => {
            if (!entryRegions(entry).includes(region)) return entry;
            touched += 1;
            if (entry.enabled === enabled) return entry;
            changed += 1;
            return { ...entry, enabled };
          });
        },
        { render: 'immediate' },
      );
      if (touched === 0) return emptyResult('no-tagged-entries', region);
      const persisted = await getWorldbook.call(
        target.api,
        target.worldbookName,
      );
      target.assertCurrent?.();
      const persistedTargets = persisted.filter((entry) =>
        entryRegions(entry).includes(region),
      );
      if (
        persistedTargets.length !== touched ||
        persistedTargets.some((entry) => entry.enabled !== enabled)
      ) {
        return verificationFailure(region, touched, changed);
      }
    } catch (error) {
      return {
        status: 'failed',
        region,
        touched,
        changed,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      status: changed > 0 ? 'applied' : 'current',
      region,
      touched,
      changed,
    };
  }

  private async performRegionSwitch(
    previousRegion: string,
    nextRegion: string,
    guard?: () => void,
  ): Promise<RegionWorldbookSyncResult> {
    if (!nextRegion) return emptyResult('invalid-region', nextRegion);
    const target = await this.resolveWorldbook(guard);
    if ('status' in target) return emptyResult(target.status, nextRegion, target.message);
    const updateWorldbookWith = target.api.updateWorldbookWith;
    const getWorldbook = target.api.getWorldbook;
    if (!updateWorldbookWith || !getWorldbook) {
      return emptyResult('unavailable', nextRegion);
    }
    let touched = 0;
    let changed = 0;
    let nextTagged = 0;
    try {
      await updateWorldbookWith.call(
        target.api,
        target.worldbookName,
        (entries) => {
          target.assertCurrent?.();
          if (!entries.some((entry) => entryRegions(entry).includes(nextRegion))) return entries;
          return entries.map((entry) => {
            const regions = entryRegions(entry);
            if (regions.includes(nextRegion)) nextTagged += 1;
            const shouldEnable = regions.includes(nextRegion)
              ? true
              : previousRegion && regions.includes(previousRegion)
                ? false
                : null;
            if (shouldEnable === null) return entry;
            touched += 1;
            if (entry.enabled === shouldEnable) return entry;
            changed += 1;
            return { ...entry, enabled: shouldEnable };
          });
        },
        { render: 'immediate' },
      );
      if (nextTagged === 0) {
        return emptyResult('no-tagged-entries', nextRegion);
      }
      const persisted = await getWorldbook.call(
        target.api,
        target.worldbookName,
      );
      const persistedTargets = persisted
        // Do not report success to a map panel belonging to a different card.
        .map((entry) => ({
          entry,
          enabled: switchedRegionState(entry, previousRegion, nextRegion),
        }))
        .filter(
          (candidate): candidate is {
            entry: RegionWorldbookEntry;
            enabled: boolean;
          } => candidate.enabled !== null,
        );
      target.assertCurrent?.();
      if (
        persistedTargets.length !== touched ||
        persistedTargets.some(
          ({ entry, enabled }) => entry.enabled !== enabled,
        )
      ) {
        return verificationFailure(nextRegion, touched, changed);
      }
    } catch (error) {
      return {
        status: 'failed',
        region: nextRegion,
        touched,
        changed,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      status: changed > 0 ? 'applied' : 'current',
      region: nextRegion,
      touched,
      changed,
    };
  }

  private async resolveWorldbook(guard?: () => void): Promise<
    | { api: RegionWorldbookApi; worldbookName: string; entries?: RegionWorldbookEntry[]; assertCurrent?: () => void }
    | {
        status: 'unavailable' | 'wrong-character' | 'wrong-worldbook';
        message?: string;
      }
  > {
    let result: Awaited<ReturnType<RegionWorldbookSwitcher['resolveWorldbookOnce']>>;
    for (let attempt = 0; ; attempt += 1) {
      try {
        guard?.();
        if (!guard && this.host) guard = captureCharacterGuard(this.host);
      } catch (error) {
        return { status: 'unavailable', message: error instanceof Error ? error.message : String(error) };
      }
      result = await this.resolveWorldbookOnce(attempt > 0);
      try {
        guard?.();
      } catch (error) {
        return { status: 'unavailable', message: error instanceof Error ? error.message : String(error) };
      }
      if (!this.host || !('status' in result) || result.status === 'wrong-character' || attempt >= 2) return result;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }

  private async resolveWorldbookOnce(hydrate: boolean): Promise<
    | { api: RegionWorldbookApi; worldbookName: string; entries?: RegionWorldbookEntry[]; assertCurrent?: () => void }
    | { status: 'unavailable' | 'wrong-character' | 'wrong-worldbook'; message?: string }
  > {
    const api = this.resolveApi();
    if (!api.getWorldbook || !api.updateWorldbookWith) {
      return { status: 'unavailable', message: '酒馆世界书接口尚未准备好，请重试本次操作。' };
    }
    let target: CharacterTarget | undefined;
    try {
      if (this.host) {
        target = await readCharacterTarget(this.host, { hydrate });
        if (!target.isCaelian) {
          return { status: 'wrong-character', message: `当前角色“${target.name}”未识别为凯利安角色卡，未修改世界书。` };
        }
      } else {
        const name = await this.currentCharacterName();
        const fallbackName = await api.getCurrentCharacterName?.call(api);
        if (!isCaelianCharacterName(name || fallbackName)) return { status: 'wrong-character' };
      }
      let bindings: { primary: string | null; additional: string[] } = { primary: null, additional: [] };
      let bindingError: unknown;
      try {
        bindings = await api.getCharWorldbookNames?.call(api, 'current') ?? bindings;
      } catch (error) {
        bindingError = error;
      }
      target?.assertCurrent();
      const worldValue = target?.character.data?.extensions?.world;
      const primary = target && typeof worldValue === 'string'
        ? primaryWorldbook(target)
        : bindings.primary?.trim() ?? '';
      const additional = [...new Set((bindings.additional ?? []).filter((name) => typeof name === 'string').map((name) => name.trim()).filter(Boolean))];
      const readErrors: string[] = [];
      const candidateEntries = new Map<string, RegionWorldbookEntry[]>();
      const inspectCandidate = async (name: string): Promise<boolean> => {
        try {
          const entries = await api.getWorldbook!.call(api, name);
          target?.assertCurrent();
          candidateEntries.set(name, entries);
          return isCaelianWorldbookName(name) || hasCaelianWorldbookContent(entries);
        } catch (error) {
          if (error instanceof CharacterTargetError) throw error;
          readErrors.push(`${name}：${error instanceof Error ? error.message : String(error)}`);
          return false;
        }
      };
      if (primary && await inspectCandidate(primary)) {
        return { api, worldbookName: primary, entries: candidateEntries.get(primary), assertCurrent: target?.assertCurrent };
      }
      // A failing official primary must not silently redirect a write to another book.
      if (primary && isCaelianWorldbookName(primary) && readErrors.length) {
        return { status: 'unavailable', message: `世界书读取失败：${readErrors.join('；')}` };
      }
      const candidates: string[] = [];
      for (const name of additional.filter((name) => name !== primary)) {
        if (await inspectCandidate(name)) candidates.push(name);
      }
      if (candidates.length === 1 && !readErrors.length) {
        return { api, worldbookName: candidates[0]!, entries: candidateEntries.get(candidates[0]!), assertCurrent: target?.assertCurrent };
      }
      if (candidates.length > 1) {
        return { status: 'wrong-worldbook', message: `绑定了多本凯利安世界书（${candidates.join('、')}），请将要使用的一本设为主世界书。` };
      }
      if (readErrors.length || (bindingError && !primary)) {
        return { status: 'unavailable', message: `暂时无法读取角色绑定的世界书：${readErrors.join('；') || String(bindingError)}。请重试。` };
      }
      return {
        status: 'wrong-worldbook',
        message: primary || additional.length
          ? `已绑定世界书“${[primary, ...additional].filter(Boolean).join('、')}”，但未找到可确认的凯利安地区资料。`
          : '当前角色尚未绑定世界书，请在角色设置中绑定凯利安世界书。',
      };
    } catch (error) {
      return { status: 'unavailable', message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async performLegacyQuestCleanup(guard?: () => void): Promise<LegacyQuestWorldbookCleanupResult> {
    const target = await this.resolveWorldbook(guard);
    if ('status' in target) return { ...cleanupResult(target.status), message: target.message };
    const { api, worldbookName } = target;
    if (!api.updateWorldbookWith) return cleanupResult('unavailable');

    let removed = 0;
    try {
      await api.updateWorldbookWith.call(
        api,
        worldbookName,
        (entries) => {
          target.assertCurrent?.();
          return entries.filter((entry) => {
            if (!isLegacyQuestWorldbookEntry(entry)) return true;
            removed += 1;
            return false;
          });
        },
        { render: 'debounced' },
      );
    } catch (error) {
      return {
        ...cleanupResult('failed'),
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return { status: removed > 0 ? 'applied' : 'current', removed };
  }
}

function entryLabel(entry: RegionWorldbookEntry): string {
  const extra = entry.extra ?? {};
  const keys = Array.isArray(entry.keys)
    ? entry.keys.join(' ')
    : String(entry.keys ?? '');
  return [
    entry.comment,
    entry.name,
    extra.comment,
    extra.displayName,
    keys,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ');
}

export function entryRegions(entry: RegionWorldbookEntry): string[] {
  const match = entryLabel(entry).match(/\[AUTO_REGION:([^\]]+)\]/i);
  if (!match?.[1]) return [];
  return [
    ...new Set(
      match[1]
        .split(/[,，]/)
        .map((value) => normalizeRegion(value))
        .filter(Boolean),
    ),
  ];
}

function hasCaelianWorldbookContent(entries: RegionWorldbookEntry[]): boolean {
  const labels = entries.map((entry) => entryLabel(entry));
  const hasCharacter = labels.some((label) => label.includes('凯利安_阶段01_陌生人'));
  const hasCompanion = labels.some((label) => label.includes('特莱奥，最好的伙伴'));
  const regions = new Set(entries.flatMap(entryRegions));
  return hasCharacter && hasCompanion && regions.size >= 2;
}

function emptyResult(
  status: RegionWorldbookSyncResult['status'],
  region: string,
  message?: string,
): RegionWorldbookSyncResult {
  return { status, region, touched: 0, changed: 0, message };
}

function switchedRegionState(
  entry: RegionWorldbookEntry,
  previousRegion: string,
  nextRegion: string,
): boolean | null {
  const regions = entryRegions(entry);
  if (regions.includes(nextRegion)) return true;
  if (previousRegion && regions.includes(previousRegion)) return false;
  return null;
}

function verificationFailure(
  region: string,
  touched: number,
  changed: number,
): RegionWorldbookSyncResult {
  return {
    status: 'failed',
    region,
    touched,
    changed,
    message: '世界书写入后回读不一致，条目启用状态未被酒馆保存。',
  };
}

function cleanupResult(
  status: LegacyQuestWorldbookCleanupResult['status'],
): LegacyQuestWorldbookCleanupResult {
  return { status, removed: 0 };
}

function integerRange(first: number, last: number): number[] {
  return Array.from(
    { length: last - first + 1 },
    (_, index) => first + index,
  );
}
