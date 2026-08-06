const CHARACTER_NAME = '凯利安';
const ALLOWED_WORLDBOOK_NAMES = new Set([
  '孔雀开屏你说看不见',
  '孔雀开屏你说你看不见',
]);

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

const MOVE_WORDS = [
  '前往',
  '移动到',
  '进入',
  '抵达',
  '来到',
  '传送到',
  '赶往',
  '走向',
  '返回',
  '到达',
  '去往',
  '动身去',
  '出发去',
  '回到',
] as const;
const EXPLORATION_MOVE_WORDS = ['探索', '调查'] as const;

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
  disable?: boolean;
  keys?: string[] | string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RegionWorldbookApi {
  getCurrentCharacterName?: () => string | null;
  getCharWorldbookNames?: (
    characterName: 'current',
  ) => { primary: string | null; additional: string[] };
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

export function inferRegionFromTravelText(raw: unknown): string {
  const text = String(raw ?? '').trim();
  const pivot = travelIntentEnd(text);
  if (!text || pivot < 0) return '';
  const matched = ALIAS_INDEX.map(({ region, alias }) => ({
    region,
    alias,
    index: text.indexOf(alias, pivot),
  }))
    .filter(({ index }) => index >= pivot)
    .sort(
      (left, right) =>
        left.index - right.index || right.alias.length - left.alias.length,
    )[0];
  return matched?.region ?? '';
}

export function entryRegionState(
  entry: RegionWorldbookEntry,
  region: string,
): boolean | null {
  const label = entryLabel(entry);
  if (/\[AUTO_GLOBAL\]/i.test(label)) return true;
  if (/\[AUTO_MANUAL\]/i.test(label)) return false;
  const match = label.match(/\[AUTO_REGION:([^\]]+)\]/i);
  if (!match?.[1]) return null;
  const activeRegion = normalizeRegion(region);
  return match[1]
    .split(/[,，]/)
    .map((value) => normalizeRegion(value))
    .filter(Boolean)
    .some((value) => value === activeRegion);
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
  private lastRegion = '';
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly resolveApi: () => RegionWorldbookApi,
    private readonly currentCharacterName: () => Promise<string | null>,
  ) {}

  sync(
    rawRegion: string,
    options: { force?: boolean } = {},
  ): Promise<RegionWorldbookSyncResult> {
    const region = normalizeRegion(rawRegion);
    const task = this.queue
      .catch(() => ({
        status: 'failed' as const,
        region,
        touched: 0,
        changed: 0,
      }))
      .then(() => this.performSync(region, options.force === true));
    this.queue = task;
    return task;
  }

  cleanupLegacyQuestEntries(): Promise<LegacyQuestWorldbookCleanupResult> {
    const task = this.queue
      .catch(() => undefined)
      .then(() => this.performLegacyQuestCleanup());
    this.queue = task;
    return task;
  }

  reset(): void {
    this.lastRegion = '';
  }

  private async performSync(
    region: string,
    force: boolean,
  ): Promise<RegionWorldbookSyncResult> {
    if (!region) return emptyResult('invalid-region', region);
    if (!force && region === this.lastRegion) {
      return emptyResult('skipped', region);
    }

    const api = this.resolveApi();
    if (!api.getCharWorldbookNames || !api.updateWorldbookWith) {
      return emptyResult('unavailable', region);
    }

    const directName = api.getCurrentCharacterName?.call(api)?.trim();
    const characterName = directName || (await this.currentCharacterName());
    if (characterName?.trim() !== CHARACTER_NAME) {
      return emptyResult('wrong-character', region);
    }

    const bindings = api.getCharWorldbookNames.call(api, 'current');
    const worldbookName = bindings.primary?.trim() ?? '';
    if (!ALLOWED_WORLDBOOK_NAMES.has(worldbookName)) {
      return emptyResult('wrong-worldbook', region);
    }

    let touched = 0;
    let changed = 0;
    try {
      await api.updateWorldbookWith.call(
        api,
        worldbookName,
        (entries) =>
          entries.map((entry) => {
            const enabled = entryRegionState(entry, region);
            if (enabled === null) return entry;
            touched += 1;
            if (
              entry.enabled === enabled &&
              entry.disable === !enabled
            ) {
              return entry;
            }
            changed += 1;
            return { ...entry, enabled, disable: !enabled };
          }),
        { render: 'debounced' },
      );
    } catch (error) {
      return {
        ...emptyResult('failed', region),
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (touched === 0) {
      return emptyResult('no-tagged-entries', region);
    }
    this.lastRegion = region;
    return {
      status: changed > 0 ? 'applied' : 'current',
      region,
      touched,
      changed,
    };
  }

  private async performLegacyQuestCleanup(): Promise<LegacyQuestWorldbookCleanupResult> {
    const api = this.resolveApi();
    if (!api.getCharWorldbookNames || !api.updateWorldbookWith) {
      return cleanupResult('unavailable');
    }

    const directName = api.getCurrentCharacterName?.call(api)?.trim();
    const characterName = directName || (await this.currentCharacterName());
    if (characterName?.trim() !== CHARACTER_NAME) {
      return cleanupResult('wrong-character');
    }

    const bindings = api.getCharWorldbookNames.call(api, 'current');
    const worldbookName = bindings.primary?.trim() ?? '';
    if (!ALLOWED_WORLDBOOK_NAMES.has(worldbookName)) {
      return cleanupResult('wrong-worldbook');
    }

    let removed = 0;
    try {
      await api.updateWorldbookWith.call(
        api,
        worldbookName,
        (entries) =>
          entries.filter((entry) => {
            if (!isLegacyQuestWorldbookEntry(entry)) return true;
            removed += 1;
            return false;
          }),
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

function emptyResult(
  status: RegionWorldbookSyncResult['status'],
  region: string,
): RegionWorldbookSyncResult {
  return { status, region, touched: 0, changed: 0 };
}

function cleanupResult(
  status: LegacyQuestWorldbookCleanupResult['status'],
): LegacyQuestWorldbookCleanupResult {
  return { status, removed: 0 };
}

function travelIntentEnd(text: string): number {
  let end = -1;
  for (const word of MOVE_WORDS) {
    const index = text.lastIndexOf(word);
    if (index >= 0) end = Math.max(end, index + word.length);
  }
  const goPattern =
    /(?:^|[，,。！？!?\s]|我(?:们)?(?:想|要|准备|打算)?|带我|一起|现在|立刻|然后|接着)去(?:往|到)?/g;
  for (const match of text.matchAll(goPattern)) {
    const goOffset = match[0].lastIndexOf('去');
    end = Math.max(end, (match.index ?? 0) + goOffset + 1);
  }
  if (end < 0) {
    for (const word of EXPLORATION_MOVE_WORDS) {
      const index = text.lastIndexOf(word);
      if (index >= 0) end = Math.max(end, index + word.length);
    }
  }
  return end;
}

function integerRange(first: number, last: number): number[] {
  return Array.from(
    { length: last - first + 1 },
    (_, index) => first + index,
  );
}
