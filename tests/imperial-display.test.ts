import {describe, expect, it, vi} from 'vitest';
import {IMPERIAL_DISPLAY_REGEX, ensureImperialDisplayRegex, playerText} from '@/imperial/display';
import {imperialHistoryContext, imperialRecordAuthority, readImperialRecord} from '@/imperial/history';
import {initialImperialState} from '@/imperial/model';
import {hasImperialEvidence} from '@/imperial/service';
import {applyWorldbookDelta, type DeltaEntry, type WorldbookDelta} from '@/content-updates/worldbook-delta';
import guidance from '../public/managed-content/worldbook-deltas/imperial-guidance-2026-09-11.json';

describe('皇权显示与证据边界', () => {
  it('在装饰正则前隐藏原标签或转义标签，提示词保留完整原记录且不吞正文', async () => {
    let rules: Array<Record<string,unknown>> = [{id:'player-decoration',find_regex:'<[^>]+>',replace_string:'',enabled:true}];
    // Tavern Helper normalizes a falsy trim_strings to [] when reading its persisted rules.
    const update = vi.fn(async (fn:(r:typeof rules)=>typeof rules) => {rules=fn(rules).map(rule => ({...rule,trim_strings:rule.trim_strings || []}));});
    const api = {getTavernRegexes:()=>rules,updateTavernRegexesWith:update};
    await ensureImperialDisplayRegex(api); await ensureImperialDisplayRegex(api);
    expect(update).toHaveBeenCalledTimes(1); expect(rules[1]!.id).toBe('player-decoration');
    const pattern=IMPERIAL_DISPLAY_REGEX.find_regex;
    const regex=new RegExp(pattern.slice(1,pattern.lastIndexOf('/')),'gi');
    const raw=imperialHistoryContext(initialImperialState(),'江');
    for (const record of [raw,raw.replaceAll('<','&lt;').replaceAll('>','&gt;')]) {
      expect(('前文'+record+'后文').replace(regex,'')).toBe('前文\n\n后文');
    }
    expect(IMPERIAL_DISPLAY_REGEX.destination).toEqual({display:true,prompt:false});
    expect(readImperialRecord(raw)).toContain('江当前势力');
    expect('正文<!--玩家的注释-->'.replace(regex,'')).toBe('正文<!--玩家的注释-->');
  });

  it('姓名替换保持姓名特殊字符原样，带姓名的记录可以继承阵营', () => {
    const state=initialImperialState();state.playerCamp='自己';state.playerClaimingThrone=true;
    const record=imperialHistoryContext(state,'江');
    expect(record).not.toMatch(/User/i);expect(imperialRecordAuthority(record)).toMatchObject({playerCamp:'自己',playerClaimingThrone:true});
    expect(playerText('User与{{user}}','$&江')).toBe('$&江与$&江');
  });

  it('容忍来源前缀与引号空格，不把概述、未发生的事情或过短证据当作原文', () => {
    expect(hasImperialEvidence('已接取任务 「动荡的皇权」 。','玩家：已接取任务「动荡的皇权」。')).toBe(true);
    expect(hasImperialEvidence('没有接取任务。','已接取任务')).toBe(false);
    expect(hasImperialEvidence('他告知了计划','幕后推演：秘密计划')).toBe(false);
    expect(hasImperialEvidence('玩家向议会问好','议会')).toBe(false);
  });

  it('指导规范两句只插入叙事节奏段，保留配置、玩家改文与新条目，重复更新幂等', () => {
    const delta=guidance as WorldbookDelta; const before=delta.changes[0]!.before;
    const entries: DeltaEntry[]=[{...before,uid:17,enabled:true} as DeltaEntry,{uid:18,name:'玩家自建',content:'我的内容'}];
    const result=applyWorldbookDelta(entries,delta);
    expect(result.entries[0]!.content).toContain('<叙事节奏与逻辑>\n  -势力间与阵营间的行动会互相影响');
    expect(result.entries[0]!.enabled).toBe(true);expect(result.entries[1]).toEqual(entries[1]);
    expect(applyWorldbookDelta(result.entries,delta).applied).toBe(0);
    entries[0]!.content+='玩家修改';
    expect(applyWorldbookDelta(entries,delta).entries).toEqual(entries);
  });
});
