import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'docs/imperial-succession/source');
const [alpha, beta] = await Promise.all(['alpha', 'beta'].map(async channel =>
  Object.values(JSON.parse(await readFile(path.join(source, `${channel}.json`), 'utf8')).entries)));
const positions = ['before_character_definition', 'after_character_definition', 'before_author_note', 'after_author_note', 'at_depth', 'before_example_messages', 'after_example_messages', 'outlet'];
const roles = ['system', 'user', 'assistant'];
const normalize = e => ({
  name: e.comment, content: e.content, enabled: e.comment === '皇权斗争指导规范' ? false : !e.disable,
  strategy: { type: e.constant ? 'constant' : e.vectorized ? 'vectorized' : 'selective', keys: e.key ?? [], keys_secondary: {logic: ['and_any', 'not_all', 'not_any', 'and_all'][e.selectiveLogic ?? 0], keys: e.keysecondary ?? []}, scan_depth: e.scanDepth ?? 'same_as_global' },
  position: { type: positions[e.position] ?? positions[0], role: roles[e.role ?? 0], depth: e.depth ?? 4, order: e.order ?? 100 },
  probability: e.useProbability === false ? 100 : (e.probability ?? 100),
  recursion: { prevent_incoming: !!e.excludeRecursion, prevent_outgoing: !!e.preventRecursion, delay_until: e.delayUntilRecursion > 0 ? e.delayUntilRecursion : null },
  effect: { sticky: e.sticky > 0 ? e.sticky : null, cooldown: e.cooldown > 0 ? e.cooldown : null, delay: e.delay > 0 ? e.delay : null },
  ...Object.fromEntries(Object.entries(e).filter(([k]) => ['addMemo','matchPersonaDescription','matchCharacterDescription','matchCharacterPersonality','matchCharacterDepthPrompt','matchScenario','matchCreatorNotes','group','groupOverride','groupWeight','caseSensitive','matchWholeWords','useGroupScoring','automationId','ignoreBudget','outletName','triggers','characterFilter','extra'].includes(k))),
});
const delta = { revision: '2026-09-10.imperial-worldbook.1', additions: [], removals: [], changes: [] };
for (const old of alpha) {
  const next = beta.find(e => e.comment === old.comment);
  if (!next) delta.removals.push(normalize(old));
  else if (JSON.stringify(normalize(old)) !== JSON.stringify(normalize(next))) delta.changes.push({ before: normalize(old), after: normalize(next) });
}
for (const next of beta) if (!alpha.some(e => e.comment === next.comment)) delta.additions.push(normalize(next));
const output = path.join(root, 'public/managed-content/worldbook-deltas/imperial-2026-09-10.json');
await mkdir(path.dirname(output), {recursive:true});
await writeFile(output, JSON.stringify(delta, null, 2) + '\n');
const textChanges = delta.changes.filter(e => e.before.content !== e.after.content);
const report = ['# 世界书 Alpha → Beta 差异', '', '按条目名称匹配；源 UID 仅供审计，不能作为玩家终端定位依据。', '',
  `新增 ${delta.additions.length} 条；删除 ${delta.removals.length} 条；正文修改 ${textChanges.length} 条。另有 ${delta.changes.length - textChanges.length} 条仅配置变化。`, '',
  '## 新增', ...delta.additions.map(e => `- ${e.name}`), '', '## 删除', ...delta.removals.map(e=>`- ${e.name}`), '',
  '## 修改', ...delta.changes.map(e=>`- ${e.before.name}：${Object.keys(e.after).filter(k=>JSON.stringify(e.before[k])!==JSON.stringify(e.after[k])).join('、')}`), '',
  '仅 displayIndex 改变的条目不移动玩家排序；selective 与 constant 的旧冗余组合按酒馆助手语义处理。',
  '皇权斗争指导规范的初始启用状态由支线追踪状态控制，默认关闭；正文按 Beta 原文保留。',
  '玩家终端不全量替换世界书。修改只在原值吻合时执行；玩家改写的正文、同名自建条目、缺失/重命名条目均保留并记录冲突。删除须完整原条目匹配。已执行的迁移不会重放。', '',
  '开场白只将全部“朱利安”替换为“卢修斯”，保留玩家其余文字和开场白顺序。', ''];
await writeFile(path.join(root,'docs/imperial-succession/worldbook-diff.md'), report.join('\n'));

// Update the downloadable author card by individual delta entries, never a player's book.
const cardPath = path.join(root,'public/managed-content/cards/caelian-alpha-mvu-v3.json');
const card = JSON.parse(await readFile(cardPath,'utf8'));
const rename = value => typeof value === 'string' ? value.replaceAll('朱利安','卢修斯') : value;
for(const data of [card,card.data]) {
  if(!data) continue;
  if(typeof data.first_mes==='string')data.first_mes=rename(data.first_mes);
  if(Array.isArray(data.alternate_greetings))data.alternate_greetings=data.alternate_greetings.map(rename);
}
const entries=card.data.character_book.entries;
for(const removed of delta.removals) {
  const i=entries.findIndex(e=>(e.comment??e.name)===removed.name&&e.content===removed.content);
  if(i>=0)entries.splice(i,1);
}
const toCard=e=>({id:e.uid,uid:e.uid,keys:e.key??[],secondary_keys:e.keysecondary??[],comment:e.comment,content:e.content,constant:e.constant,selective:e.selective,insertion_order:e.order,enabled:e.comment==='皇权斗争指导规范'?false:!e.disable,position:e.position===0?'before_char':'after_char',use_regex:false,extensions:{...e,display_index:e.displayIndex}});
for(const change of delta.changes){
  const e=entries.find(e=>(e.comment??e.name)===change.before.name);if(!e)continue;
  if(e.content===change.before.content)e.content=change.after.content;
  if(change.before.enabled!==change.after.enabled)e.enabled=change.after.enabled;
  if(JSON.stringify(change.before.strategy.keys)!==JSON.stringify(change.after.strategy.keys))e.keys=change.after.strategy.keys;
}
for(const addition of delta.additions){if(entries.some(e=>(e.comment??e.name)===addition.name))continue; const raw=beta.find(e=>e.comment===addition.name);const used=new Set(entries.map(e=>e.uid??e.id));let uid=0;while(used.has(uid))uid++;entries.push(toCard({...raw,uid}));}
const cardText=JSON.stringify(card,null,2)+'\n';
await writeFile(cardPath,cardText);
const manifestPath=path.join(root,'public/managed-content/alpha.json');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
manifest.revision=delta.revision;
// Old runtimes can read this manifest before their script reloads. They must not
// replay historical whole-entry upserts against player edits. New runtimes use
// the bundled three-way delta selected by this exact revision.
manifest.operations=[];
manifest.sourceCard.sha256=createHash('sha256').update(cardText).digest('hex');
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({additions:delta.additions.length,removals:delta.removals.length,textChanges:textChanges.length,configurationChanges:delta.changes.length-textChanges.length}));
