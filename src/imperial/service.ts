import type { QuestRecord, TavernFloorReference } from '@/domain/types';
import type { QuestProgressRepository } from '@/storage/repositories/quest-progress-repository';
import { initialQuestProgress } from '@/quests/state-machine';
import { imperialQuestDefinition } from './definition';
import { hasSuccessionEvidence, imperialNoticeKey, initialImperialState, winnerIsPlayer,
  type ImperialFact, type ImperialNotice, type ImperialResult, type ImperialState } from './model';
import { stripImperialContext, type ImperialPromptInput } from './prompt';
import { IMPERIAL_FACTIONS, IMPERIAL_HEIRS } from './constants';
import { decodeImperialRecord, imperialRecordAuthority } from './history';

/** Ignore quote typography and speaker labels, but still require an actual contiguous quotation. */
export function hasImperialEvidence(source: string, evidence: string): boolean {
  const normalize = (text: string) => text.replace(/^(?:玩家|主API|User)\s*[：:]\s*/i, '')
    .replace(/[\s“”‘’「」『』"'，,。.!！?？；;：:]/g, '');
  const quote = normalize(evidence);
  return quote.length >= 4 && normalize(source).includes(quote);
}

export async function evaluateImperialTurn(input: {
  profileId: string; quest: QuestRecord; floor: TavernFloorReference;
  progress: QuestProgressRepository;
  judge: { evaluateImperial(input: ImperialPromptInput): Promise<ImperialResult> };
  prompt: Omit<ImperialPromptInput, 'state'>;
  isCurrent: () => Promise<boolean>;
  reroll?: boolean;
}): Promise<{ state: ImperialState; notices: ImperialNotice[]; completed: boolean } | null> {
  if (input.quest.status !== 'active' || input.floor.role !== 'assistant') return null;
  if (!input.reroll && await input.progress.hasCheckpointForFloor(input.profileId, input.quest.id, input.floor)) return null;
  const tracker = await input.progress.getTracker(input.profileId, input.quest.id);
  if (!tracker) return null;
  const previous = tracker.current.imperial ?? initialImperialState();
  const result = await input.judge.evaluateImperial({ ...input.prompt, state: previous });
  if (!(await input.isCurrent())) return null;
  const latest = await input.progress.getTracker(input.profileId, input.quest.id);
  if (!latest || (latest.current.imperial?.revision ?? 0) !== previous.revision) return null;
  const body = stripImperialContext(input.floor.text ?? '');
  const conversation = input.prompt.recentMessages.map(message => stripImperialContext(message.content)).join('\n');
  const playerWords = input.prompt.recentMessages.filter(message => message.role === 'user').map(message => message.content).join('\n');
  const priorRecord = decodeImperialRecord(input.prompt.previousRecord?.content ?? '');
  const authority = imperialRecordAuthority(priorRecord);
  const preserveKnowledge = (next: ImperialFact) => {
    const inherited = ['User', '玩家', input.prompt.playerName].some(name => priorRecord.includes(`${next.text}（${name}知情`));
    if (next.known && !inherited && !hasImperialEvidence(conversation, next.evidence)) {
      next.known = false;
    }
  };
  // The player's own stated action is known even when the model accidentally returns false.
  if (hasImperialEvidence(playerWords, result.state.currentEvent.evidence)) result.state.currentEvent.known = true;
  preserveKnowledge(result.state.currentEvent);
  if (!result.state.currentEvent.known) result.state.currentEvent = {text:'尚无新的可知事件',known:false,evidence:''};
  for (const name of IMPERIAL_HEIRS) {
    const next = result.state.royals[name];
    for (const key of ['plan', 'action', 'next'] as const) preserveKnowledge(next[key]);
    for (const fact of next.history) preserveKnowledge(fact);
  }
  for (const key of ['status', 'movement'] as const) preserveKnowledge(result.state.emperor[key]);
  for (const name of IMPERIAL_FACTIONS) {
    for (const key of ['movement', 'stance', 'divisions'] as const) preserveKnowledge(result.state.factions[name][key]);
    const score = result.state.support[name];
    if (!score.evidence || !(conversation.includes(score.evidence) || priorRecord.includes(score.evidence) || score.evidence.startsWith('幕后推演：'))) {
      result.state.support[name] = authority.support[name];
    }
  }
  for (const candidate of result.state.successionLikelihood) preserveKnowledge(candidate.reason);
  if ((result.state.playerCamp !== authority.playerCamp || result.state.playerClaimingThrone !== authority.playerClaimingThrone) &&
    (!result.state.campEvidence || !(playerWords.includes(result.state.campEvidence) || priorRecord.includes(result.state.campEvidence)))) {
    result.state.playerCamp = authority.playerCamp;
    result.state.playerClaimingThrone = authority.playerClaimingThrone;
    result.state.campEvidence = authority.campEvidence;
  }
  if (result.state.playerClaimingThrone) result.state.playerCamp = '自己';
  const reported = new Set(previous.reportedProgress);
  const notices = result.majorProgress.filter(notice => {
    const key = imperialNoticeKey(notice);
    if (!notice.known || !hasImperialEvidence(conversation, notice.evidence) || reported.has(key)) return false;
    reported.add(key); return true;
  });
  const completed = hasSuccessionEvidence(result, body);
  const state: ImperialState = {
    ...result.state, revision: previous.revision + 1, updatedAt: Date.now(),
    lastFloor: { index: input.floor.index, fingerprint: input.floor.fingerprint, lineageHash: input.floor.lineageHash },
    reportedProgress: [...reported], majorProgress: notices, ...(completed ? { winner: result.succession.winner } : {}),
  };
  const current = latest.current;
  const updated = await input.progress.bindFloor(input.profileId, {
    questId: input.quest.id, floor: input.floor, summary: result.summary,
    baseline: initialQuestProgress(imperialQuestDefinition), expectedNodeId: current.currentNodeId,
    expectedAcceptedAt: input.quest.acceptedAt, expectedImperialRevision: previous.revision,
    expectedManualRevision: latest.manualRevision ?? 0,
    replaceImperialFloor: input.reroll,
    judgeResult: { mode: 'imperial', succession: result.succession, completionAccepted: completed },
    next: { ...current, imperial: state,
      ...(completed ? { status: 'ready', trackerState: 'ended', currentNodeId: 'imperial:ready', completionConfirmed: true,
        ending: winnerIsPlayer(result, input.prompt.playerName) ? 'player' : 'other' } :
        { trackerState: current.trackerState === 'armed' ? 'tracking' : current.trackerState }),
    },
  });
  if (updated.current.imperial?.revision !== state.revision || updated.current.imperial.lastFloor?.fingerprint !== input.floor.fingerprint) return null;
  return { state, notices, completed };
}
