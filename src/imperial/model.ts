import { z } from 'zod';
import { IMPERIAL_FACTIONS } from './constants';

const text = z.string().trim().max(800);
export const imperialFactSchema = z.object({ text, known: z.boolean(), evidence: text });
const royalSchema = z.object({
  plan: imperialFactSchema, action: imperialFactSchema, next: imperialFactSchema,
  history: z.array(imperialFactSchema.extend({ at: z.string().max(120) })).max(16),
});
const factionSchema = z.object({ movement: imperialFactSchema, stance: imperialFactSchema, divisions: imperialFactSchema });
const supportSchema = z.object({ value: z.number().min(0).max(100).nullable(), evidence: text });
const likelihoodSchema = z.array(z.object({ name: z.string().min(1).max(160), value: z.number().min(0).max(100), reason: imperialFactSchema }))
  .max(16).refine(items => !items.length || Math.abs(items.reduce((sum, item) => sum + item.value, 0) - 100) < 0.01,
    '继承可能性的总和必须为 100').refine(items => new Set(items.map(item => item.name)).size === items.length, '候选人不能重复');
export const imperialSnapshotSchema = z.object({
  support: z.object({ 议会: supportSchema, 圣教会: supportSchema, 骑士团: supportSchema, 赛梅斯商会: supportSchema }),
  currentEvent: imperialFactSchema,
  playerCamp: text, playerClaimingThrone: z.boolean(), campEvidence: text,
  royals: z.object({ 瓦勒里乌斯: royalSchema, 塞西莉亚: royalSchema, 卢修斯: royalSchema }),
  emperor: z.object({ status: imperialFactSchema, movement: imperialFactSchema }),
  factions: z.object({ 议会: factionSchema, 圣教会: factionSchema, 骑士团: factionSchema, 赛梅斯商会: factionSchema }),
  successionLikelihood: likelihoodSchema.default([]),
});
export const imperialNoticeSchema = z.object({
  faction: z.string().min(1).max(120), title: z.string().min(1).max(120), detail: text,
  known: z.boolean(), evidence: z.string().min(1).max(800),
});
export const imperialResultSchema = z.object({
  state: imperialSnapshotSchema,
  summary: z.string().max(4000),
  majorProgress: z.array(imperialNoticeSchema).max(6),
  succession: z.object({
    completed: z.boolean(), winner: z.string().max(160), winnerIsPlayer: z.boolean(),
    confidence: z.number().min(0).max(1), evidence: z.string().max(800),
  }),
});
export type ImperialFact = z.infer<typeof imperialFactSchema>;
export type ImperialSnapshot = z.infer<typeof imperialSnapshotSchema>;
export type ImperialNotice = z.infer<typeof imperialNoticeSchema>;
export type ImperialResult = z.infer<typeof imperialResultSchema>;
export interface ImperialState extends ImperialSnapshot {
  revision: number;
  updatedAt: number;
  lastFloor?: { index: number; fingerprint: string; lineageHash: string };
  reportedProgress: string[];
  winner?: string;
  majorProgress?: ImperialNotice[];
}

export function initialImperialState(): ImperialState {
  const unknown = (): ImperialFact => ({ text: '尚无可靠情报', known: false, evidence: '' });
  const royal = () => ({ plan: unknown(), action: unknown(), next: unknown(), history: [] });
  return {
    revision: 0, updatedAt: 0, reportedProgress: [], successionLikelihood: [],
    support: Object.fromEntries(IMPERIAL_FACTIONS.map(name => [name, { value: null, evidence: '' }])) as ImperialSnapshot['support'],
    currentEvent: unknown(), playerCamp: '尚未表态', playerClaimingThrone: false, campEvidence: '',
    royals: { 瓦勒里乌斯: royal(), 塞西莉亚: royal(), 卢修斯: royal() },
    emperor: { status: unknown(), movement: unknown() },
    factions: Object.fromEntries(IMPERIAL_FACTIONS.map(name => [name, { movement: unknown(), stance: unknown(), divisions: unknown() }])) as ImperialSnapshot['factions'],
  };
}

export function publicImperialFact(fact: ImperialFact): string {
  return `${fact.text}（User${fact.known ? '知情' : '不知情'}）`;
}

export function imperialNoticeKey(notice: ImperialNotice): string {
  return `${notice.faction}:${notice.evidence}`.normalize('NFKC').replace(/[\s，。！？；：、,.!?;:]/g, '');
}

export function hasSuccessionEvidence(result: ImperialResult, body: string): boolean {
  const outcome = result.succession;
  return outcome.completed && outcome.confidence >= 0.85 && outcome.winner.trim().length > 0 &&
    outcome.evidence.trim().length >= 4 && body.includes(outcome.evidence) &&
    /继承.{0,8}皇位|登基|即位|登上.{0,6}皇位|加冕.{0,8}(?:皇帝|女皇|新皇)|成为.{0,8}(?:新皇|女皇|皇帝)|继位/.test(outcome.evidence) &&
    !/(?:尚未|没有|未能|将要|即将|打算|计划|如果|假如|梦见|传闻|谣言).{0,20}(?:继位|登基|即位|皇位|加冕)/.test(outcome.evidence);
}

export function winnerIsPlayer(result: ImperialResult, playerName: string): boolean {
  const winner = result.succession.winner.trim();
  return result.succession.winnerIsPlayer &&
    [playerName.trim(), '{{user}}', 'user', '玩家'].filter(Boolean).includes(winner);
}
