import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleQuestJudgeClient, QuestJudgeCancelledError } from '@/quests/judge-client';
import { loadQuestJudgePreferences, saveQuestJudgePreferences } from '@/quests/judge-preferences';
import { initialImperialState } from '@/imperial/model';

afterEach(() => { vi.useRealTimers(); localStorage.clear(); sessionStorage.clear(); });
const input = () => ({state:initialImperialState(),currentLocation:'学院',playerName:'玩家',recentMessages:[],worldbook:''});
function client(timeoutMs?: number) {
  const signals: AbortSignal[]=[];
  const judge=new OpenAiCompatibleQuestJudgeClient({endpoint:'https://judge.example',model:'test',timeoutMs}, vi.fn((_url,init) => {
    const signal=init!.signal!; signals.push(signal);
    return new Promise<Response>((_resolve,reject) => signal.addEventListener('abort',() => reject(new DOMException('aborted','AbortError'))));
  }));
  return {judge,signals};
}

describe('副 API 请求等待时间', () => {
  it('默认等待完整响应180秒，超过旧30秒限制仍继续等候', async () => {
    vi.useFakeTimers(); const {judge,signals}=client();
    const outcome=judge.evaluateImperial(input()).catch(error => error);
    await vi.advanceTimersByTimeAsync(30_001); expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(150_000); expect((await outcome).message).toContain('180 秒');
    expect(judge.isEvaluating()).toBe(false);
  });
  it('自定义等待时间生效，手动终止与超时分别提示', async () => {
    vi.useFakeTimers(); const {judge}=client(60_000);
    const timeout=judge.evaluateImperial(input()).catch(error => error);
    await vi.advanceTimersByTimeAsync(60_000); expect((await timeout).message).toContain('60 秒');
    const cancelled=judge.evaluateImperial(input()).catch(error => error);
    expect(judge.cancel()).toBe(true); expect(await cancelled).toBeInstanceOf(QuestJudgeCancelledError);
  });
  it('保存的等待时间在重新加载配置后保留，旧配置继续兼容', () => {
    saveQuestJudgePreferences(window,{endpoint:'https://judge.example',model:'test',timeoutMs:240_000});
    expect(loadQuestJudgePreferences(window)?.timeoutMs).toBe(240_000);
    localStorage.setItem('caelian_quest_judge_preferences_v1',JSON.stringify({endpoint:'https://judge.example',model:'legacy'}));
    expect(loadQuestJudgePreferences(window)?.timeoutMs).toBeUndefined();
    expect(loadQuestJudgePreferences(window)?.model).toBe('legacy');
  });
});
