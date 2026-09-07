/* global structuredClone */
const clone=value=>structuredClone(value);
function clearPending(state){delete state.player.pendingCardChoice;delete state.reworkChoice;delete state.reworkTransaction;}
function pendingCommit(state,draft,transaction){state.player.pendingCardChoice=clone(draft.player.pendingCardChoice);state.reworkChoice=clone(draft.reworkChoice);state.reworkTransaction=transaction;}
function finishAttempt(state,transaction,ports){
 const draft=clone(transaction.prepared);clearPending(draft);
 const handled=ports.play(draft,transaction.request,transaction.meta);
 if(handled===false)throw Error('本卡不属于重置牌目录');
 if(draft.player.pendingCardChoice){pendingCommit(state,draft,transaction);return {pending:true};}
 ports.after?.(draft,transaction.meta);clearPending(draft);delete draft.reworkCardCostOverride;
 // Keep the LocalBattleState object identity used by BattleSessionRecord.
 Object.assign(state,draft);clearPending(state);return {pending:false};
}
/**
 * ports.before runs only once, against a private state. Return the card identity
 * and resolved cost; set draft.reworkCardCostOverride for the runtime price hook.
 * ports.play must configure damage hooks on the live core against this draft.
 */
export function playCardTransaction(state,request,ports){
 if(state.reworkTransaction)throw Error('请先完成当前卡牌选择');
 const prepared=clone(state);clearPending(prepared);
 const meta=ports.before?.(prepared,request)??{};
 const transaction={prepared,request:{...request,answers:request.answers??[]},meta};
 return finishAttempt(state,transaction,ports);
}
export function chooseCardTransaction(state,index,finish,ports){
 const transaction=state.reworkTransaction,display=state.player.pendingCardChoice;
 if(!transaction||!display)throw Error('没有待完成的卡牌选择');
 if(!finish){if(!Number.isInteger(index)||index<0||index>=display.choices.length||display.picked.includes(index))throw Error('选择无效');display.picked.push(index);}
 if(display.picked.length<display.pick&&!finish)return {pending:true};
 if(display.picked.length<(display.min??display.pick))throw Error('选择数量不足');
 const answers=[...(state.reworkChoice?.answers??transaction.request.answers),[...display.picked]];
 const resumed={...transaction,request:{...transaction.request,answers}};
 return finishAttempt(state,resumed,ports);
}
