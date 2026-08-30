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
const gatheringItemsByRegion = JSON.parse(
  await readFile(
    path.join(
      root,
      'src',
      'content',
      'generated',
      'world',
      'gather-items-by-region.json',
    ),
    'utf8',
  ),
);
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
const battleEntryAliases = [
  'DLC｜Combat｜战斗判定 [AUTO_GLOBAL]',
  'DLC|Combat|战斗判定 [AUTO_GLOBAL]',
];
const battleEntry = entries.find((entry) =>
  battleEntryAliases.includes(String(entry.comment ?? entry.name ?? '')),
);
if (!battleEntry) throw new Error('The managed story battle rule was not found.');
battleEntry.content = updateStoryBattleRules(String(battleEntry.content ?? ''));

const gatheringGuidanceContent = [
  '---',
  '采集物系统:',
  '  说明: 区域特产、每日库存与玩家背包全部由浏览器本地采集页面管理，不写入 MVU。',
  '  规则:',
  '    - 玩家本轮明确进行采集、采药、挖矿、打捞、搜寻或拾取区域特产时，正文只描写开始行动、寻找采集点或发现可交互资源，不得宣布已经获得物品或数量。',
  '    - 只有当前存在追踪中的剧情任务、且本轮原本就会进行任务副 API 判定时，副 API 才会同时判断本轮是否属于采集行动；判断成立时本地脚本会直接打开采集页面，由玩家亲自选择并领取。无追踪任务的日常对话不会为采集额外调用副 API。',
  '    - 实际物品只能来自当前地区的下列现有数据库条目；禁止创造新采集物、改写名称、跨地区发放，或把采集物作为剧情赠礼直接加入背包。',
  '    - 每种区域特产的本地库存每日零点刷新为10~20个；同一种特产可以合理分布在多个地区，具体剩余数量只以本地页面为准。',
  '    - 玩家只是路过、提及、观察、回忆或计划以后采集，或只有 NPC 在采集时，不得视为玩家本轮采集。',
  '    - 不要创建或更新 玩家.背包、caelian.state.player.inventory 或其他替代背包变量。实际入库、使用、合成和交易均由本地系统执行。',
  '  地区采集物:',
  ...Object.entries(gatheringItemsByRegion).map(
    ([region, itemIds]) => `    ${region}: ${itemIds.join('、')}`,
  ),
].join('\n');

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
  normalizeEntry({
    aliases: ['采集物系统'],
    name: '采集物系统',
    content: gatheringGuidanceContent,
    enabled: true,
    order: 100,
    position: 'after_char',
    extensionPosition: 4,
    depth: 0,
    displayIndex: 61,
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
  {
    id: '2026-08-13.story-battle.user-and-caelian-party',
    target: {
      kind: 'worldbook-upsert-entry',
      entryNames: battleEntryAliases,
    },
    entry: toManagedEntry(battleEntry),
  },
];

const cardJson = `${JSON.stringify(card, null, 2)}\n`;
const cardSha256 = createHash('sha256').update(cardJson).digest('hex');
const manifest = {
  schemaVersion: 1,
  channel: 'alpha',
  revision: '2026-08-30.1',
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

function updateStoryBattleRules(content) {
  let result = content;
  if (!result.includes('user_involved: true')) {
    result = result.replace(
      'reason: 郊外遭遇\n</BattleStart>',
      'reason: 郊外遭遇\nuser_involved: true\ncaelian_present: true\n</BattleStart>',
    );
  }
  if (!result.includes('- user_involved：必填')) {
    result = result.replace(
      '- reason：可选，简短写明触发原因或地点，例如“郊外遭遇”“任务目标出现”“下水道伏击”。',
      [
        '- reason：可选，简短写明触发原因或地点，例如“郊外遭遇”“任务目标出现”“下水道伏击”。',
        '- user_involved：必填。只有user本人实际处于这场战斗中时填写 true；其他情况不得输出 BattleStart。',
        '- caelian_present：必填。凯利安与user在同一现场并会并肩作战时填写 true，否则填写 false。',
      ].join('\n'),
    );
  }
  result = result.replace(
    '- 只有当怪物已经实际现身、袭击、拦路、伏击、玩家主动挑战/讨伐、任务目标进入战斗时，才输出 BattleStart。',
    '- 只有当怪物已经对user实际现身、袭击、拦路、伏击，或user主动挑战/讨伐、user本人进入任务战斗时，才输出 BattleStart。',
  );
  if (!result.includes('【v3.8玩家参战与凯利安同行规则】')) {
    result = result.replace(
      '</本地战斗触发规则>',
      [
        '【v3.8玩家参战与凯利安同行规则】',
        '- BattleStart只代表user本人即将进入的战斗。若仅凯利安、特莱奥、其他NPC或远处角色遭遇/参加战斗，而user不在战斗现场，严禁输出BattleStart。',
        '- 不能因为叙事主角凯利安受袭、凯利安单独迎敌、凯利安在别处作战，就把user_involved写为true。',
        '- 当user本人参战时，user_involved必须写true；缺少该字段、写false或语义不确定时，本地脚本都不会触发战斗。',
        '- 仅当凯利安就在user身边且会共同进入本场战斗时，caelian_present写true。凯利安离场、分头行动、失联或只在远处时写false。',
        '- caelian_present为true时，本地战斗会让凯利安以圣辉龙骑职业参战，并将纯血光明圣龙特莱奥作为可受击召唤物加入。战斗数值、AP消耗、行动序列与结算均由本地脚本负责，AI不得代算。',
        '- BattleResult中的caelian、caelian_hp与trelio_hp是本地真实结算；caelian为injured时必须按凯利安重伤、无法继续战斗处理，不得擅自治愈或改写。',
        '',
        '</本地战斗触发规则>',
      ].join('\n'),
    );
  }
  const resultFieldsRule =
    '- BattleResult中的caelian、caelian_hp与trelio_hp是本地真实结算；caelian为injured时必须按凯利安重伤、无法继续战斗处理，不得擅自治愈或改写。';
  if (!result.includes(resultFieldsRule)) {
    result = result.replace(
      '</本地战斗触发规则>',
      `${resultFieldsRule}\n\n</本地战斗触发规则>`,
    );
  }
  return result;
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
