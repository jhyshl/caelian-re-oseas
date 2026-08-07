import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initvarContent,
  MVU_SCHEMA_SCRIPT_ID,
  mvuSchemaContent,
  phaseControllerContent,
  variableListContent,
  variableOutputContent,
  variableRulesContent,
} from './mvu-core-content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCard =
  process.env.CAELIAN_CHARACTER_CARD ??
  path.resolve(root, '..', '凯利安-MVU-v3-交付', '凯利安-Alpha-MVU-v3.json');
const publicRoot = path.join(root, 'public', 'managed-content');
const publicCard = path.join(publicRoot, 'cards', 'caelian-alpha-mvu-v3.json');
const publicManifest = path.join(publicRoot, 'alpha.json');
const deliveryRoot = path.dirname(sourceCard);
const deliveryWorldbookRoot = path.join(deliveryRoot, '世界书与变量文件');
const characterName = '凯利安';
const primaryWorldbookName = '孔雀开屏你说看不见';
const legacyWorldbookName = '孔雀开屏你说你看不见';
const channelWorldbookNames = [
  `${primaryWorldbookName}alpha`,
  `${primaryWorldbookName}beta`,
  `${legacyWorldbookName}alpha`,
  `${legacyWorldbookName}beta`,
];
const legacyQuestWorldbookIds = new Set([
  42,
  ...integerRange(85, 145),
  ...integerRange(168, 176),
  ...integerRange(184, 188),
  'ae5e5d48-fd68-4b91-9d26-df7808270437',
  'cot-universal-task-guard-v1',
]);

const card = JSON.parse(await readFile(sourceCard, 'utf8'));
if (card.name !== characterName || card.data?.name !== characterName) {
  throw new Error('Refusing to update a character card not named 凯利安.');
}

const scripts = card.data?.extensions?.tavern_helper?.scripts;
if (!Array.isArray(scripts)) {
  throw new Error('The character card does not contain Tavern Helper scripts.');
}
const schemaScript = scripts.find(
  (script) => script?.id === MVU_SCHEMA_SCRIPT_ID,
);
if (!schemaScript) {
  throw new Error('The MVU v3 schema script was not found.');
}
schemaScript.content = mvuSchemaContent;
schemaScript.info =
  'MVU v3：仅投影 AI 必需的只读摘要与叙事字段；完整游戏数据保存在玩家浏览器 IndexedDB。';

const entries = card.data?.character_book?.entries;
if (!Array.isArray(entries)) {
  throw new Error('The bound character book is missing.');
}
const retainedEntries = entries.filter(
  (entry) => !legacyQuestWorldbookIds.has(entry.uid ?? entry.id),
);
entries.splice(0, entries.length, ...retainedEntries);

const canonicalEntries = [
  normalizeEntry({
    aliases: ['initvar', '[initvar]变量初始化勿开'],
    name: '[initvar]变量初始化勿开',
    content: initvarContent,
    enabled: false,
    order: 200,
    position: 'after_char',
    extensionPosition: 4,
    depth: 0,
    displayIndex: 49,
  }),
  normalizeEntry({
    aliases: ['阶段控制器'],
    name: '阶段控制器',
    content: phaseControllerContent,
    enabled: true,
    order: 100,
    position: 'before_char',
    extensionPosition: 0,
    depth: 4,
    displayIndex: 1,
  }),
  normalizeEntry({
    aliases: ['变量更新规则', '[mvu_update]变量更新规则'],
    name: '[mvu_update]变量更新规则',
    content: variableRulesContent,
    enabled: true,
    order: 200,
    position: 'after_char',
    extensionPosition: 4,
    depth: 0,
    displayIndex: 58,
  }),
  normalizeEntry({
    aliases: ['变量列表'],
    name: '变量列表',
    content: variableListContent,
    enabled: true,
    order: 200,
    position: 'after_char',
    extensionPosition: 4,
    depth: 0,
    displayIndex: 59,
  }),
  normalizeEntry({
    aliases: ['变量输出格式', '[mvu_update]变量输出格式'],
    name: '[mvu_update]变量输出格式',
    content: variableOutputContent,
    enabled: true,
    order: 200,
    position: 'after_char',
    extensionPosition: 4,
    depth: 0,
    displayIndex: 60,
  }),
];

card.first_mes = stripLegacyQuestBlocks(card.first_mes);
card.data.first_mes = stripLegacyQuestBlocks(card.data.first_mes);
card.mes_example = stripLegacyQuestBlocks(card.mes_example);
card.data.mes_example = stripLegacyQuestBlocks(card.data.mes_example);
card.data.alternate_greetings = (card.data.alternate_greetings ?? []).map(
  stripLegacyQuestBlocks,
);

card.data.character_book.name = primaryWorldbookName;
card.data.extensions.world = primaryWorldbookName;
card.data.extensions.caelian_alpha = {
  ...(card.data.extensions.caelian_alpha ?? {}),
  mvuSchemaVersion: 3,
  projectionPath: 'stat_data.caelian',
  writablePath: 'stat_data.caelian.narrative',
  worldAuthority: 'ai-mvu',
  managedContentProtocol: 1,
  managedWorldbook: primaryWorldbookName,
};
const versionTag = 'MVU规范化重建版';
if (!String(card.data.character_version ?? '').includes(versionTag)) {
  card.data.character_version = `${card.data.character_version} / ${versionTag}`;
}

const operations = [
  {
    id: '2026-08-07.mvu-guidance.schema-rebuild',
    target: { kind: 'character-script', scriptId: MVU_SCHEMA_SCRIPT_ID },
    mutation: { action: 'replace-entire', content: mvuSchemaContent },
  },
  ...canonicalEntries.map(({ aliases, entry }, index) => ({
    id: `2026-08-07.mvu-guidance.entry-${index + 1}`,
    target: { kind: 'worldbook-upsert-entry', entryNames: aliases },
    entry: toManagedEntry(entry),
  })),
];

const cardJson = `${JSON.stringify(card, null, 2)}\n`;
const cardSha256 = createHash('sha256').update(cardJson).digest('hex');
const manifest = {
  schemaVersion: 1,
  channel: 'alpha',
  revision: '2026-08-07.3',
  target: {
    characterName,
    worldbookNames: [
      primaryWorldbookName,
      legacyWorldbookName,
      ...channelWorldbookNames,
    ],
    requirePrimaryBinding: true,
  },
  sourceCard: {
    url:
      'https://jhyshl.github.io/caelian-re-oseas/managed-content/cards/caelian-alpha-mvu-v3.json',
    sha256: cardSha256,
  },
  operations,
};

await mkdir(path.dirname(publicCard), { recursive: true });
await writeFile(sourceCard, cardJson, 'utf8');
await writeFile(publicCard, cardJson, 'utf8');
await writeFile(publicManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

await mkdir(deliveryWorldbookRoot, { recursive: true });
await Promise.all([
  writeFile(
    path.join(deliveryWorldbookRoot, '01-Alpha-MVU-v3-变量结构.js'),
    `${mvuSchemaContent}\n`,
    'utf8',
  ),
  writeFile(
    path.join(deliveryWorldbookRoot, '02-初始变量.yaml'),
    `${initvarContent}\n`,
    'utf8',
  ),
  writeFile(
    path.join(deliveryWorldbookRoot, '03-阶段控制器.ejs'),
    `${phaseControllerContent}\n`,
    'utf8',
  ),
  writeFile(
    path.join(deliveryWorldbookRoot, '04-变量更新规则.md'),
    `${variableRulesContent}\n`,
    'utf8',
  ),
  writeFile(
    path.join(deliveryWorldbookRoot, '05-变量列表.md'),
    `${variableListContent}\n`,
    'utf8',
  ),
  writeFile(
    path.join(deliveryWorldbookRoot, '06-变量输出格式.md'),
    `${variableOutputContent}\n`,
    'utf8',
  ),
]);

console.log(
  JSON.stringify(
    {
      sourceCard,
      publicCard,
      publicManifest,
      cardSha256,
      operations: operations.length,
      worldbook: primaryWorldbookName,
    },
    null,
    2,
  ),
);

function normalizeEntry(config) {
  const matches = entries.filter((entry) =>
    config.aliases.includes(String(entry.comment ?? entry.name ?? '')),
  );
  if (matches.length > 1) {
    throw new Error(`Worldbook aliases are duplicated: ${config.aliases.join(', ')}`);
  }
  const entry = matches[0] ?? createEntry(nextEntryId());
  if (!matches[0]) entries.push(entry);
  entry.keys = [];
  entry.secondary_keys = [];
  entry.comment = config.name;
  entry.content = config.content;
  entry.constant = true;
  entry.selective = false;
  entry.insertion_order = config.order;
  entry.enabled = config.enabled;
  entry.position = config.position;
  entry.use_regex = false;
  entry.extensions = {
    ...(entry.extensions ?? {}),
    position: config.extensionPosition,
    display_index: config.displayIndex,
    probability: 100,
    useProbability: true,
    depth: config.depth,
    role: 0,
  };
  return { aliases: config.aliases, entry };
}

function createEntry(id) {
  return {
    id,
    keys: [],
    secondary_keys: [],
    comment: '',
    content: '',
    constant: true,
    selective: false,
    insertion_order: 200,
    enabled: true,
    position: 'after_char',
    use_regex: false,
    extensions: {
      position: 4,
      exclude_recursion: false,
      display_index: id,
      probability: 100,
      useProbability: true,
      depth: 0,
      selectiveLogic: 0,
      outlet_name: '',
      group: '',
      group_override: false,
      group_weight: 100,
      prevent_recursion: false,
      delay_until_recursion: false,
      scan_depth: null,
      match_whole_words: null,
      use_group_scoring: false,
      case_sensitive: null,
      automation_id: '',
      role: 0,
      vectorized: false,
      sticky: null,
      cooldown: null,
      delay: null,
      match_persona_description: false,
      match_character_description: false,
      match_character_personality: false,
      match_character_depth_prompt: false,
      match_scenario: false,
      match_creator_notes: false,
      triggers: [],
      ignore_budget: false,
    },
  };
}

function nextEntryId() {
  const used = new Set(
    entries
      .map((entry) => Number(entry.id ?? entry.uid))
      .filter(Number.isSafeInteger),
  );
  let id = 1;
  while (used.has(id) || legacyQuestWorldbookIds.has(id)) id += 1;
  return id;
}

function toManagedEntry(entry) {
  return {
    uid: 0,
    name: entry.comment,
    content: entry.content,
    keys: [],
    secondary_keys: [],
    constant: entry.constant,
    selective: entry.selective,
    insertion_order: entry.insertion_order,
    enabled: entry.enabled,
    position: entry.position,
    use_regex: entry.use_regex,
    extra: entry.extensions,
  };
}

function stripLegacyQuestBlocks(value) {
  if (typeof value !== 'string') return value;
  const stripped = value
    .replace(
      /<(MainQuestOffer|MainQuestUpdate|MainQuestDiscover|MainQuestParallelOffer|MainQuestParallelUpdate|MainQuestNodeUpdate|SideQuestOffer|SideQuestUpdate|SideQuestDiscover|QuestInteraction)>[\s\S]*?<\/\1>/g,
      '',
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const guidance =
    '如要参与周年庆筹备，请在冒险者面板的任务列表中接取“圣德里安周年庆筹备日”。';
  if (
    stripped.includes('【首次游玩专用开场：圣德里安周年庆筹备日】') &&
    !stripped.includes(guidance)
  ) {
    return `${stripped}\n\n${guidance}`;
  }
  return stripped;
}

function integerRange(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}
