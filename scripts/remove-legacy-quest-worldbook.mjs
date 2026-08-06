import { readFile, writeFile } from 'node:fs/promises';

const cardPath = new URL(
  '../public/managed-content/cards/caelian-alpha-mvu-v3.json',
  import.meta.url,
);
const card = JSON.parse(await readFile(cardPath, 'utf8'));
const entries = card.data?.character_book?.entries;
if (!Array.isArray(entries)) {
  throw new Error('Managed card does not contain a character book entry list.');
}

const removedIds = new Set([
  42,
  ...integerRange(85, 145),
  169,
  170,
  171,
  172,
  173,
  174,
  176,
  184,
  185,
  186,
  187,
  188,
  'ae5e5d48-fd68-4b91-9d26-df7808270437',
  'cot-universal-task-guard-v1',
]);
const retained = entries.filter(
  (entry) => !removedIds.has(entry.id ?? entry.uid),
);
const removedCount = entries.length - retained.length;
card.data.character_book.entries = retained;

card.first_mes = stripLegacyQuestBlocks(card.first_mes);
card.data.first_mes = stripLegacyQuestBlocks(card.data.first_mes);
card.mes_example = stripLegacyQuestBlocks(card.mes_example);
card.data.mes_example = stripLegacyQuestBlocks(card.data.mes_example);
card.data.alternate_greetings = (card.data.alternate_greetings ?? []).map(
  stripLegacyQuestBlocks,
);

await writeFile(cardPath, `${JSON.stringify(card, null, 2)}\n`, 'utf8');
console.log(
  `Removed ${removedCount} legacy quest world-book entries; retained ${retained.length}.`,
);

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
