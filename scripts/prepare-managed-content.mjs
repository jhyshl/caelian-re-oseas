import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCard =
  process.env.CAELIAN_CHARACTER_CARD ??
  path.resolve(
    root,
    '..',
    '凯利安-MVU-v3-交付',
    '凯利安-Alpha-MVU-v3.json',
  );
const publicRoot = path.join(root, 'public', 'managed-content');
const publicCard = path.join(
  publicRoot,
  'cards',
  'caelian-alpha-mvu-v3.json',
);
const publicManifest = path.join(publicRoot, 'alpha.json');
const deliveryRoot = path.dirname(sourceCard);
const deliveryWorldbookRoot = path.join(deliveryRoot, '世界书与变量文件');
const characterName = '凯利安';
const primaryWorldbookName = '孔雀开屏你说看不见';
const legacyWorldbookName = '孔雀开屏你说你看不见';

const scriptCommentBefore =
  '  // narrative 是唯一允许 AI 更新的区域，浏览器端会校验后写入 IndexedDB。';
const scriptCommentAfter =
  '  // narrative 是唯一允许 AI 更新的区域；Alpha 只读取、校验并显示，不会自行推进世界状态。';
const scriptWorldAnchor =
  '    storyFlags: z.record(z.string(), z.boolean()).prefault({}),';
const scriptWorldBlock = `    world: z.object({
      region: z.string().max(120).prefault('伊拉亚城'),
      place: z.string().max(120).prefault('宿舍楼'),
      location: z.string().max(180).prefault('圣德里安学院-宿舍楼'),
      gameDate: z.string().max(80).prefault('新圣约历1385-09-01'),
      gameTime: z.string().max(40).prefault('08:00'),
      weather: z.string().max(80).prefault('晴朗'),
      mainStage: z.coerce.number().int().min(0).max(9999).prefault(0),
      mainStep: z.coerce.number().int().min(0).max(9999).prefault(0),
    }).passthrough().prefault({}),
`;

const initWorldAnchor = '    storyFlags: {}';
const initWorldBlock = `    world:
      region: 伊拉亚城
      place: 宿舍楼
      location: 圣德里安学院-宿舍楼
      gameDate: 新圣约历1385-09-01
      gameTime: "08:00"
      weather: 晴朗
      mainStage: 0
      mainStep: 0
`;

const rulesWorldAnchor = '    caelian.narrative.storyFlags:';
const rulesWorldBlock = `    caelian.narrative.world:
      authority: AI
      check:
        - 世界状态必须跟随当前剧情，由 AI 在实际发生变化时更新；Alpha 脚本不得自行推进。
        - region 填当前大地区；place 填地区内地点；location 填面板显示的完整位置。
        - gameDate、gameTime 随剧情中真实经过的时间更新；没有时间推进时保持原值。
        - weather 只在天气确实变化时更新，不要每轮随机改写。
        - mainStage、mainStep 只在主线里程碑或步骤真正推进时更新，范围为0~9999。
        - 不得根据玩家点击地图直接假定已经抵达；必须等正文确认行动完成后再更新。
`;
const rulesConflictBefore =
  '    - 如果 caelian.state 与叙事文本冲突，以 caelian.state 为当前游戏事实；不要尝试用 MVU 修正本地状态。';
const rulesConflictAfter =
  '    - 世界剧情事实以 caelian.narrative.world 为 AI 写入源；caelian.state.world 是 Alpha 读取、校验后的只读显示摘要。其他本地游戏数据仍以 caelian.state 为准。';

const outputForbiddenBefore =
  '    - 禁止创建玩家、世界、协会、战斗、背包、装备、卡牌、任务或成就变量。';
const outputForbiddenAfter =
  '    - 禁止创建玩家、协会、战斗、背包、装备、卡牌、任务或成就变量；世界状态只能写入 /caelian/narrative/world/ 下的既定字段。';
const outputExampleAnchor =
  '      { "op": "insert", "path": "/caelian/narrative/storyFlags/初次共同冒险", "value": true }';
const outputWorldExamples = `      { "op": "replace", "path": "/caelian/narrative/world/region", "value": "伊拉亚城" },
      { "op": "replace", "path": "/caelian/narrative/world/place", "value": "中央广场" },
      { "op": "replace", "path": "/caelian/narrative/world/location", "value": "伊拉亚城-中央广场" },
      { "op": "replace", "path": "/caelian/narrative/world/gameTime", "value": "10:30" },
`;

const operations = [
  {
    id: '2026-07-29.mvu-world.script-comment',
    target: {
      kind: 'character-script',
      scriptId: 'edfcaddc-2475-46e8-a0d9-f14a2e6558b2',
      scriptName: 'Alpha MVU 最小变量结构 v3.0',
    },
    mutation: {
      action: 'replace-exact',
      before: scriptCommentBefore,
      after: scriptCommentAfter,
    },
  },
  {
    id: '2026-07-29.mvu-world.script-schema',
    target: {
      kind: 'character-script',
      scriptId: 'edfcaddc-2475-46e8-a0d9-f14a2e6558b2',
      scriptName: 'Alpha MVU 最小变量结构 v3.0',
    },
    mutation: {
      action: 'insert-before',
      anchor: scriptWorldAnchor,
      text: scriptWorldBlock,
    },
  },
  {
    id: '2026-07-29.mvu-world.initvar',
    target: {
      kind: 'worldbook-entry',
      entryName: 'initvar',
    },
    mutation: {
      action: 'insert-before',
      anchor: initWorldAnchor,
      text: initWorldBlock,
    },
  },
  {
    id: '2026-07-29.mvu-world.rules',
    target: {
      kind: 'worldbook-entry',
      entryName: '变量更新规则',
    },
    mutation: {
      action: 'insert-before',
      anchor: rulesWorldAnchor,
      text: rulesWorldBlock,
    },
  },
  {
    id: '2026-07-29.mvu-world.authority',
    target: {
      kind: 'worldbook-entry',
      entryName: '变量更新规则',
    },
    mutation: {
      action: 'replace-exact',
      before: rulesConflictBefore,
      after: rulesConflictAfter,
    },
  },
  {
    id: '2026-07-29.mvu-world.output-boundary',
    target: {
      kind: 'worldbook-entry',
      entryName: '变量输出格式',
    },
    mutation: {
      action: 'replace-exact',
      before: outputForbiddenBefore,
      after: outputForbiddenAfter,
    },
  },
  {
    id: '2026-07-29.mvu-world.output-example',
    target: {
      kind: 'worldbook-entry',
      entryName: '变量输出格式',
    },
    mutation: {
      action: 'insert-before',
      anchor: outputExampleAnchor,
      text: outputWorldExamples,
    },
  },
];

const card = JSON.parse(await readFile(sourceCard, 'utf8'));
if (card.name !== characterName || card.data?.name !== characterName) {
  throw new Error('Refusing to update a character card not named 凯利安.');
}

const scripts = card.data?.extensions?.tavern_helper?.scripts;
if (!Array.isArray(scripts)) {
  throw new Error('The character card does not contain Tavern Helper scripts.');
}
const schemaScript = scripts.find(
  (script) =>
    script?.id === 'edfcaddc-2475-46e8-a0d9-f14a2e6558b2' &&
    script?.name === 'Alpha MVU 最小变量结构 v3.0',
);
if (!schemaScript || typeof schemaScript.content !== 'string') {
  throw new Error('The Alpha MVU v3 schema script was not found.');
}

const entries = card.data?.character_book?.entries;
if (!Array.isArray(entries)) {
  throw new Error('The bound character book is missing.');
}

for (const operation of operations) {
  const { target, mutation } = operation;
  if (target.kind === 'character-script') {
    schemaScript.content = applyTextMutation(schemaScript.content, mutation);
    continue;
  }
  const matches = entries.filter(
    (entry) => String(entry.comment ?? entry.name ?? '') === target.entryName,
  );
  if (matches.length !== 1) {
    throw new Error(`Worldbook entry "${target.entryName}" is missing or duplicated.`);
  }
  matches[0].content = applyTextMutation(
    String(matches[0].content ?? ''),
    mutation,
  );
}

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
const versionTag = 'MVU世界状态AI同步版';
if (!String(card.data.character_version ?? '').includes(versionTag)) {
  card.data.character_version = `${card.data.character_version} / ${versionTag}`;
}

const cardJson = `${JSON.stringify(card, null, 2)}\n`;
const cardSha256 = createHash('sha256').update(cardJson).digest('hex');
const manifest = {
  schemaVersion: 1,
  channel: 'alpha',
  revision: '2026-07-29.1',
  target: {
    characterName,
    worldbookNames: [primaryWorldbookName, legacyWorldbookName],
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
await writeFile(
  publicManifest,
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

const sidecarEntries = new Map(
  entries.map((entry) => [
    String(entry.comment ?? entry.name ?? ''),
    String(entry.content ?? ''),
  ]),
);
await mkdir(deliveryWorldbookRoot, { recursive: true });
await Promise.all([
  writeFile(
    path.join(deliveryWorldbookRoot, '01-Alpha-MVU-v3-变量结构.js'),
    `${schemaScript.content}\n`,
    'utf8',
  ),
  writeFile(
    path.join(deliveryWorldbookRoot, '02-初始变量.yaml'),
    `${requiredEntry(sidecarEntries, 'initvar')}\n`,
    'utf8',
  ),
  writeFile(
    path.join(deliveryWorldbookRoot, '03-阶段控制器.ejs'),
    `${requiredEntry(sidecarEntries, '阶段控制器')}\n`,
    'utf8',
  ),
  writeFile(
    path.join(deliveryWorldbookRoot, '04-变量更新规则.md'),
    `${requiredEntry(sidecarEntries, '变量更新规则')}\n`,
    'utf8',
  ),
  writeFile(
    path.join(deliveryWorldbookRoot, '05-变量输出格式.md'),
    `${requiredEntry(sidecarEntries, '变量输出格式')}\n`,
    'utf8',
  ),
  writeFile(
    path.join(deliveryWorldbookRoot, '06-采集物系统.md'),
    `${requiredEntry(sidecarEntries, '采集物系统')}\n`,
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

function applyTextMutation(source, mutation) {
  if (mutation.action === 'replace-exact') {
    if (!source.includes(mutation.before) && source.includes(mutation.after)) {
      return source;
    }
    requireSingle(source, mutation.before);
    return source.replace(mutation.before, mutation.after);
  }
  if (mutation.action === 'insert-before') {
    const completed = `${mutation.text}${mutation.anchor}`;
    if (source.includes(completed)) return source;
    requireSingle(source, mutation.anchor);
    return source.replace(mutation.anchor, completed);
  }
  throw new Error(`Unsupported build-time mutation ${mutation.action}.`);
}

function requireSingle(source, needle) {
  const first = source.indexOf(needle);
  const second =
    first < 0 ? -1 : source.indexOf(needle, first + needle.length);
  if (first < 0 || second >= 0) {
    throw new Error('Build-time patch anchor is missing or duplicated.');
  }
}

function requiredEntry(entryMap, name) {
  const content = entryMap.get(name);
  if (content === undefined) {
    throw new Error(`Required delivery entry "${name}" is missing.`);
  }
  return content;
}
