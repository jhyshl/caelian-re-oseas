import type {QuestProgressSnapshot} from '@/domain/types';
import {questNode,type QuestDefinition} from '@/quests/schema';
export function manualQuestChoices(definition:QuestDefinition,current:QuestProgressSnapshot) {
  if (definition.trackingMode === 'imperial') return [];
  const node=questNode(definition,current.currentNodeId),completed=new Set(current.completedSceneIds??[]);
  return node.transitions.filter(t=>t.to!==node.id&&questNode(definition,t.to).status!=='failed'&&
    (!t.guards?.incompleteSceneId||!completed.has(t.guards.incompleteSceneId))&&
    (!t.guards?.completedSceneIds||t.guards.completedSceneIds.every(id=>completed.has(id))))
    .map(t=>({transitionId:t.id,label:questNode(definition,t.to).title,terminal:questNode(definition,t.to).status==='ready'}));
}
export function manualQuestProgress(definition:QuestDefinition,current:QuestProgressSnapshot,transitionId?:string):QuestProgressSnapshot {
  if (definition.trackingMode === 'imperial') throw new Error('皇权支线只根据正式继位事实自动完成，没有可手动完成的剧情节点');
  const node=questNode(definition,current.currentNodeId),choices=manualQuestChoices(definition,current);
  if(choices.length>1&&!transitionId) throw new Error('请选择要推进的下一节点');
  const choice=choices.find(c=>c.transitionId===(transitionId??choices[0]?.transitionId));
  if(transitionId&&!choice) throw new Error('当前节点不存在这个可选分支');
  if(!choice&&node.transitions.length) throw new Error('请先完成尚未完成的并行节点');
  const transition=node.transitions.find(t=>t.id===choice?.transitionId),target=transition?questNode(definition,transition.to):node;
  const terminal=target.status==='ready'||(!choice&&!node.transitions.length);
  const ending=target.ending??transition?.effects?.ending;
  const reward=(ending?definition.rewards.endings[ending]:undefined)??definition.rewards.default;
  return {
    status:terminal?'ready':'active',trackerState:terminal?'ended':'tracking',
    currentStage:target.stage,currentNodeId:target.id,currentStageId:target.stageId,currentSceneId:target.sceneId,currentBeatId:target.id,
    completedSceneIds:[...new Set([...(current.completedSceneIds??[]),...(transition?.effects?.completeSceneId?[transition.effects.completeSceneId]:[])])],
    objective:target.objective,summary:(current.summary+'\n玩家手动完成节点「'+node.title+'」。').trim().slice(-8000),
    completionConfirmed:terminal,...(ending?{ending}:{}),rewardExperience:reward.experience,rewardGold:reward.gold,rewardGuildExperience:reward.guildExperience,
  };
}
