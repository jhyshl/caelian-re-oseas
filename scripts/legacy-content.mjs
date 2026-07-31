import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const DEFAULT_SOURCE =
  'E:\\jiang\\脚本\\酒馆助手脚本文件夹-Re∞欧西亚斯1-2.json';
const OUTPUT_ROOT = resolve('src/content/generated');

const CARD_FIELDS = {
  'cards/cards.json': 'CARD_DB',
  'cards/starter-decks.json': 'STARTER_DECKS',
  'cards/common-market.json': '$COMMON_MARKET_CARDS',
  'professions/class-names.json': 'CLASS_NAMES',
  'professions/subclass-names.json': 'SUB_NAMES',
  'professions/class-subclasses.json': 'CLASS_SUBS',
  'professions/talents.json': 'PROFESSION_TALENTS',
  'battle/card-type-colors.json': 'CARD_TYPE_COLORS',
  'battle/card-type-names.json': 'CARD_TYPE_NAMES',
  'battle/card-buff-names.json': 'BATTLE_BUFF_NAMES',
  'battle/card-debuff-names.json': 'BATTLE_DEBUFF_NAMES',
  'battle/card-status-descriptions.json': 'BATTLE_STATUS_DESC',
};

const WORLD_FIELDS = {
  'quests/task-pool.json': 'TASK_POOL',
  'world/regions.json': 'REGIONS',
  'world/region-links.json': 'REGION_LINKS',
  'world/region-places.json': 'REGION_PLACES',
  'quests/rank-names.json': 'RANK_NAMES',
  'quests/rank-colors.json': 'RANK_COLORS',
  'quests/difficulty-colors.json': 'DIFF_COLORS',
  'quests/difficulty-names.json': 'DIFF_NAMES',
  'quests/type-icons.json': 'TYPE_ICONS',
  'quests/type-names.json': 'TYPE_NAMES',
  'progression/xp-table.json': 'XP_TABLE',
  'progression/guild-rank-requirements.json': 'GUILD_RANK_REQ',
  'battle/monsters.json': 'BATTLE_MONSTER_DB',
  'battle/passives.json': 'BATTLE_PASSIVE_DB',
  'battle/monster-skills.json': 'MONSTER_SKILLBOOK',
  'battle/world-buff-names.json': 'BATTLE_BUFF_NAMES',
  'battle/world-debuff-names.json': 'BATTLE_DEBUFF_NAMES',
  'battle/world-status-descriptions.json': 'BATTLE_STATUS_DESC',
  'inventory/battle-items.json': 'BATTLE_ITEM_DB',
  'inventory/relics.json': 'BATTLE_RELIC_DB',
  'inventory/level-reward-relic-ids.json': 'LEVEL_REWARD_RELIC_IDS',
  'inventory/market-only-relic-ids.json': 'MARKET_ONLY_RELIC_IDS',
  'inventory/main-quest-only-relic-ids.json': 'MAINQUEST_ONLY_RELIC_IDS',
  'inventory/equipment-rewards.json': 'BATTLE_EQUIPMENT_REWARD_DB',
  'battle/rules.json': 'BATTLE_RULES',
  'inventory/item-prices.json': 'ITEM_PRICE_DB',
  'market/items-by-region.json': 'MARKET_ITEMS',
  'market/preferences.json': 'MARKET_PREFERENCES',
  'crafting/recipes.json': 'CRAFT_RECIPES',
  'inventory/gather-resources.json': 'GATHER_RESOURCE_DB',
  'world/gather-items-by-region.json': 'REGION_GATHER_ITEMS',
  'battle/boss-mechanics.json': 'BATTLE_BOSS_MECHANICS',
  'battle/bosses.json': 'BATTLE_BOSS_DB',
};

const ACHIEVEMENT_FIELDS = {
  'achievements/definitions.json': 'ACHIEVEMENT_DEFS',
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readLegacyFolder(sourcePath) {
  const raw = readFileSync(sourcePath, 'utf8');
  const folder = JSON.parse(raw);
  if (!Array.isArray(folder.scripts)) {
    throw new Error('原文件不是有效的酒馆助手脚本文件夹');
  }
  return { folder, raw };
}

function findScript(folder, namePrefix) {
  const script = folder.scripts.find((entry) =>
    String(entry.name ?? '').startsWith(namePrefix),
  );
  if (!script?.content) {
    throw new Error(`找不到原脚本：${namePrefix}`);
  }
  return script;
}

function parseScript(script) {
  const sourceFile = ts.createSourceFile(
    `${script.name}.js`,
    script.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const details = sourceFile.parseDiagnostics
      .map((item) => item.messageText)
      .join('; ');
    throw new Error(`${script.name} 解析失败：${details}`);
  }
  return sourceFile;
}

function propertyName(node, sourceFile) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return node.getText(sourceFile);
}

function literalValue(node, sourceFile) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node)) {
    const value = literalValue(node.operand, sourceFile);
    if (typeof value !== 'number') {
      throw unsupportedLiteral(node, sourceFile);
    }
    if (node.operator === ts.SyntaxKind.MinusToken) return -value;
    if (node.operator === ts.SyntaxKind.PlusToken) return value;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => literalValue(element, sourceFile));
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw unsupportedLiteral(property, sourceFile);
      }
      result[propertyName(property.name, sourceFile)] = literalValue(
        property.initializer,
        sourceFile,
      );
    }
    return result;
  }
  throw unsupportedLiteral(node, sourceFile);
}

function unsupportedLiteral(node, sourceFile) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return new Error(
    `发现非纯数据表达式 ${ts.SyntaxKind[node.kind]}，位置 ${position.line + 1}:${position.character + 1}`,
  );
}

function findVariableInitializer(sourceFile, variableName) {
  let initializer;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!initializer) throw new Error(`找不到变量 ${variableName}`);
  return initializer;
}

function findContainerField(sourceFile, containerName, fieldName) {
  const container = findVariableInitializer(sourceFile, containerName);
  if (!ts.isObjectLiteralExpression(container)) {
    throw new Error(`${containerName} 不是对象字面量`);
  }
  const property = container.properties.find(
    (entry) =>
      ts.isPropertyAssignment(entry) &&
      propertyName(entry.name, sourceFile) === fieldName,
  );
  if (!property || !ts.isPropertyAssignment(property)) {
    throw new Error(`${containerName}.${fieldName} 不存在`);
  }
  return property.initializer;
}

function extractFields(sourceFile, containerName, mapping) {
  const output = new Map();
  for (const [fileName, fieldName] of Object.entries(mapping)) {
    const initializer = fieldName.startsWith('$')
      ? findVariableInitializer(sourceFile, fieldName.slice(1))
      : findContainerField(sourceFile, containerName, fieldName);
    output.set(fileName, literalValue(initializer, sourceFile));
  }
  return output;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function countEntries(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 1;
}

function buildExtraction(sourcePath) {
  const { folder, raw } = readLegacyFolder(sourcePath);
  const cardScript = findScript(folder, '冒险者面板卡牌数据库');
  const worldScript = findScript(folder, '冒险者面板地图道具数据库');
  const achievementScript = findScript(folder, '冒险者成就系统');
  const cardSource = parseScript(cardScript);
  const worldSource = parseScript(worldScript);
  const achievementSource = parseScript(achievementScript);
  const files = new Map([
    ...extractFields(cardSource, 'CARD_DATA', CARD_FIELDS),
    ...extractFields(worldSource, 'WORLD_DATA', WORLD_FIELDS),
    ...Object.entries(ACHIEVEMENT_FIELDS).map(([fileName, variableName]) => [
      fileName,
      literalValue(
        findVariableInitializer(achievementSource, variableName),
        achievementSource,
      ),
    ]),
  ]);
  const manifest = {
    formatVersion: 1,
    source: {
      fileName: sourcePath.split(/[\\/]/).at(-1),
      sha256: sha256(raw),
      folderName: folder.name,
      cardScriptName: cardScript.name,
      worldScriptName: worldScript.name,
      achievementScriptName: achievementScript.name,
    },
    files: Object.fromEntries(
      [...files.entries()].map(([fileName, value]) => {
        const json = stableJson(value);
        return [
          fileName,
          {
            entries: countEntries(value),
            sha256: sha256(json),
          },
        ];
      }),
    ),
  };
  return { files, manifest };
}

function extract(sourcePath) {
  const { files, manifest } = buildExtraction(sourcePath);
  for (const [fileName, value] of files) {
    const outputPath = join(OUTPUT_ROOT, fileName);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, stableJson(value), 'utf8');
  }
  const manifestPath = join(OUTPUT_ROOT, 'legacy-content-manifest.json');
  writeFileSync(manifestPath, stableJson(manifest), 'utf8');
  console.log(
    `已从 ${manifest.source.fileName} 提取 ${files.size} 个分类数据文件。`,
  );
  printSummary(manifest);
}

function verify(sourcePath) {
  const { files, manifest } = buildExtraction(sourcePath);
  const errors = [];
  for (const [fileName, expected] of files) {
    const outputPath = join(OUTPUT_ROOT, fileName);
    if (!existsSync(outputPath)) {
      errors.push(`${fileName}: 文件缺失`);
      continue;
    }
    const actual = JSON.parse(readFileSync(outputPath, 'utf8'));
    if (stableJson(actual) !== stableJson(expected)) {
      errors.push(`${fileName}: 与原脚本数据不一致`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`原始数据核对失败：\n- ${errors.join('\n- ')}`);
  }
  console.log(`核对通过：${files.size} 个分类数据文件与原脚本完全一致。`);
  printSummary(manifest);
}

function verifyGeneratedContent() {
  const manifestPath = join(
    OUTPUT_ROOT,
    'legacy-content-manifest.json',
  );
  if (!existsSync(manifestPath)) {
    throw new Error('旧版内容清单缺失，无法核对生成数据');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const errors = [];
  for (const [fileName, expected] of Object.entries(
    manifest.files ?? {},
  )) {
    const outputPath = join(OUTPUT_ROOT, fileName);
    if (!existsSync(outputPath)) {
      errors.push(`${fileName}: 文件缺失`);
      continue;
    }
    const actual = JSON.parse(readFileSync(outputPath, 'utf8'));
    const actualJson = stableJson(actual);
    if (sha256(actualJson) !== expected.sha256) {
      errors.push(`${fileName}: 内容哈希与清单不一致`);
    }
    if (countEntries(actual) !== expected.entries) {
      errors.push(`${fileName}: 条目数量与清单不一致`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`生成数据完整性核对失败：\n- ${errors.join('\n- ')}`);
  }
  console.log(
    `核对通过：${Object.keys(manifest.files ?? {}).length} 个分类数据文件与已审计清单完全一致。`,
  );
  printSummary(manifest);
}

function printSummary(manifest) {
  const selected = [
    'cards/cards.json',
    'professions/talents.json',
    'battle/monsters.json',
    'battle/monster-skills.json',
    'inventory/battle-items.json',
    'inventory/relics.json',
    'crafting/recipes.json',
    'achievements/definitions.json',
  ];
  for (const fileName of selected) {
    const entry = manifest.files[fileName];
    console.log(`${fileName}: ${entry.entries} 条`);
  }
}

const mode = process.argv[2] ?? 'verify';
const explicitSource =
  process.argv[3] ?? process.env.CAELIAN_LEGACY_SOURCE;
const sourcePath = resolve(explicitSource ?? DEFAULT_SOURCE);

if (mode === 'extract') {
  extract(sourcePath);
} else if (mode === 'verify') {
  if (explicitSource && !existsSync(sourcePath)) {
    throw new Error(`指定的原脚本不存在：${sourcePath}`);
  }
  if (existsSync(sourcePath)) {
    verify(sourcePath);
  } else {
    verifyGeneratedContent();
  }
} else {
  throw new Error('用法：node scripts/legacy-content.mjs <extract|verify> [原脚本路径]');
}
