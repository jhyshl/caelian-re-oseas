import { IMPERIAL_FACTIONS, IMPERIAL_HEIRS } from './constants';
import { initialImperialState, type ImperialFact, type ImperialState } from './model';

const tagged = /<caelian-imperial-state\b[^>]*>[\s\S]*?<\/caelian-imperial-state>/g;
const legacy = /<!-- CAELIAN_IMPERIAL_STATE:v1\b[\s\S]*?-->/g;
export function readImperialRecord(text: string): string | null {
  const current = text.match(tagged)?.at(-1);
  if (current) return current;
  const old = text.match(legacy)?.at(-1);
  return old ? `<caelian-imperial-state>${old}</caelian-imperial-state>` : null;
}
export function decodeImperialRecord(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

/** Read only fields that need local authority guards; the AI receives the complete original record. */
export function imperialRecordAuthority(record: string) {
  const initial = initialImperialState();
  const decoded = decodeImperialRecord(record);
  const support = initial.support;
  for (const name of IMPERIAL_FACTIONS) {
    const match = decoded.match(new RegExp(`(?:^|\\n)${name}：([^\\n/]+)/100；依据：([^\\n]*)`));
    if (match) support[name] = { value: /^\d+(\.\d+)?$/.test(match[1]!) ? Number(match[1]) : null, evidence: match[2]! };
    else {
      const old = decoded.match(new RegExp(`${name} ([0-9.]+|未知)/100`));
      if (old) support[name] = { value: old[1] === '未知' ? null : Number(old[1]), evidence: '' };
    }
  }
  return { support, playerCamp: decoded.match(/User阵营：([^\n|]*)/)?.[1]?.trim() || '尚未表态',
    playerClaimingThrone: /User是否争位：是/.test(decoded) || /User阵营：自己(?:\s|\||$)/.test(decoded),
    campEvidence: decoded.match(/表态依据：([^\n]*)/)?.[1] ?? '' };
}
/** Only our own records are removed; unrelated player tags/comments remain intact. */
export function stripImperialContext(text: string): string {
  return text.replace(/\n{0,2}<caelian-imperial-state\b[^>]*>[\s\S]*?<\/caelian-imperial-state>/g, '')
    .replace(/\n{0,2}<!-- CAELIAN_IMPERIAL_STATE:v1\b[\s\S]*?-->/g, '');
}
export function imperialHistoryContext(state: ImperialState): string {
  const safe = (value: string) => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','｜').replaceAll('--','—');
  const fact = (value: ImperialFact) => `${safe(value.text)}（User${value.known ? '知情' : '不知情'}；依据：${safe(value.evidence || '待确认')}）`;
  const parts = [
    '连续性记录：只以最新有效楼层为准；User不知情的幕后信息仅维持故事连续性，不使角色自动知情，不在正文复述此栏。',
    `User当前势力：\n${IMPERIAL_FACTIONS.map(name=>`${name}：${state.support[name].value ?? '待评估'}/100；依据：${safe(state.support[name].evidence || '待确认')}`).join('\n')}`,
    `当前事件（User视角）：${fact(state.currentEvent)}`,
    `User阵营：${safe(state.playerCamp)}\nUser是否争位：${state.playerClaimingThrone ? '是' : '否'}；表态依据：${safe(state.campEvidence || '尚无明确表态')}`,
    `皇室：\n${IMPERIAL_HEIRS.map(name=>{const royal=state.royals[name];return `${name}\n当前计划：${fact(royal.plan)}\n当前行动：${fact(royal.action)}\n下一步措施：${fact(royal.next)}\n过往行踪：${royal.history.map(item=>`${safe(item.at)} ${fact(item)}`).join('；') || '暂无记录'}`;}).join('\n\n')}\n\n莱奥尼达斯\n当前状态：${fact(state.emperor.status)}\n当前动向：${fact(state.emperor.movement)}`,
    `各势力：\n${IMPERIAL_FACTIONS.map(name=>{const faction=state.factions[name];return `${name}\n当前动向：${fact(faction.movement)}\n立场倾向：${fact(faction.stance)}\n内部成员分歧：${fact(faction.divisions)}`;}).join('\n\n')}`,
    `当前皇位继承可能性：\n${(state.successionLikelihood ?? []).map(item => `${safe(item.name)}：${item.value}%；${fact(item.reason)}`).join('\n') || '待评估'}`,
    `重大进展播报：${state.majorProgress?.map(item => `${safe(item.faction)}／${safe(item.title)}：${safe(item.detail)}（User知情；依据：${safe(item.evidence)}）`).join('；') || '无新增播报'}`,
    `皇位继承结果：${state.winner ? `${safe(state.winner)}已正式继位` : '尚未有人继承皇位'}`,
  ];
  // Comment hides content even when the host sanitizes the custom element. Raw history still sends it to AI.
  return `\n\n<caelian-imperial-state><!--\n${parts.join('\n|\n')}\n--></caelian-imperial-state>`;
}
