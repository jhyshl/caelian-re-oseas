import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyWorldbookDelta, type DeltaEntry, type WorldbookDelta } from '@/content-updates/worldbook-delta';
import source from '../public/managed-content/worldbook-deltas/imperial-2026-09-10.json';

const delta=source as WorldbookDelta;
const original=()=>[...delta.removals,...delta.changes.map(c=>c.before)].map((entry,uid)=>({uid,...structuredClone(entry)}) as DeltaEntry);

describe('作者世界书差量',()=>{
  it('以两份实际原文件为依据，新增6条、删除2条、正文修改1条',()=>{
    const rawBeta=Object.values(JSON.parse(readFileSync('docs/imperial-succession/source/beta.json','utf8')).entries) as Array<{comment:string;content:string}>;
    expect(delta.additions).toHaveLength(6);expect(delta.removals).toHaveLength(2);expect(delta.changes.filter(c=>c.before.content!==c.after.content)).toHaveLength(1);
    for(const addition of delta.additions)expect(addition.content).toBe(rawBeta.find(e=>e.comment===addition.name)?.content);
    expect(delta.additions.find(e=>e.name==='皇权斗争指导规范')?.enabled).toBe(false);
    const result=applyWorldbookDelta(original(),delta);expect(result.conflicts).toEqual([]);
    for(const change of delta.changes)expect(result.entries.find(e=>e.name===change.after.name)?.content).toBe(change.after.content);
    expect(result.entries.some(e=>e.name==='🗡️凯利安：元素法师')).toBe(false);
    expect(applyWorldbookDelta(result.entries,delta).applied).toBe(0);
  });
  it('助手省略默认配置、补空 extra、换行规范化不会误报两个待删除条目', () => {
    const entries = original();
    for (const entry of entries.slice(0, 2)) {
      delete entry.addMemo;
      delete entry.matchPersonaDescription;
      delete entry.characterFilter;
      entry.extra = {};
      entry.displayIndex = 999;
      entry.content = entry.content.replaceAll('\n', '\r\n');
      (entry.effect as Record<string, unknown>).sticky = 0;
    }
    const result = applyWorldbookDelta(entries, delta);
    expect(result.conflicts).toEqual([]);
    expect(result.entries.some(entry => delta.removals.some(old => old.name === entry.name))).toBe(false);
  });
  it('玩家改写原文、同名自建、改名、改配置及 UID 复用均不能被误覆盖或误删',()=>{
    const entries=original();
    entries[0]!.extra={playerMemo:'玩家自定义字段'};
    entries[1]!.name='玩家改名后的职业';
    const city=entries.find(e=>e.name.includes('皇城索拉姆'))!;
    city.content+='\n玩家自定义';
    const custom={uid:32,name:'皇权斗争指导规范',content:'玩家自己的指导规则',enabled:false};
    entries.push(custom,{uid:10,name:'玩家新增的地点',content:'不应因 UID=10 被改成家族'});
    const before=structuredClone(entries);const result=applyWorldbookDelta(entries,delta);
    for(const entry of [before[0]!,before[1]!,city,custom,before.at(-1)!])expect(result.entries.find(e=>e.uid===entry.uid)).toEqual(entry);
    expect(entries).toEqual(before);expect(result.conflicts.length).toBeGreaterThan(0);
  });
  it('玩家单独修改关键词时保留关键词，未改写的正文可安全升级',()=>{
    const entries=original(),city=entries.find(e=>e.name.includes('皇城索拉姆'))!;
    (city.strategy as {keys:string[]}).keys=['玩家自定义关键词'];
    const result=applyWorldbookDelta(entries,delta),updated=result.entries.find(e=>e.uid===city.uid)!;
    expect((updated.strategy as {keys:string[]}).keys).toEqual(['玩家自定义关键词']);
    expect(updated.content).toContain('金鸢赌场');
  });
  it('待删除条目的嵌套配置新增字段也视为玩家修改',()=>{
    const entries=original();
    (entries[0]!.strategy as Record<string,unknown>).playerOption='保留';
    expect(applyWorldbookDelta(entries,delta).entries.find(entry=>entry.uid===entries[0]!.uid)).toEqual(entries[0]);
  });
});
