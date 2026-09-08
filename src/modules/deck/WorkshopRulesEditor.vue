<script setup lang="ts">
import { RULE_EVENTS, type WorkshopRule, type RuleStatus } from '@/workshop-program';
import WorkshopFormulaEditor from './WorkshopFormulaEditor.vue';
import WorkshopRuleSteps from './WorkshopRuleSteps.vue';
const model=defineModel<WorkshopRule[]>({required:true});
defineProps<{statuses:RuleStatus[]}>();
function add():void {model.value.push({id:'rule-'+Date.now().toString(36),event:'cast',priority:0,once:'never',costs:[],steps:[]});}
</script>
<template>
  <div class="rules-list">
    <section v-for="(rule,i) in model" :key="i">
      <header><select v-model="rule.event"><option v-for="[key,name] in RULE_EVENTS" :key="key" :value="key">{{ name }}</option></select><button type="button" @click="model.splice(i,1)">删除规则</button></header>
      <div class="rule-settings"><label>优先级<input v-model.number="rule.priority" type="number"></label><label>冷却回合<input v-model.number="rule.cooldown" type="number" min="0"></label><select v-model="rule.once"><option value="never">每次符合时触发</option><option value="turn">每回合一次</option><option value="battle">每场战斗一次</option></select></div>
      <button v-if="rule.condition===undefined" type="button" @click="rule.condition={op:'gt',args:[1,0]}">＋触发条件</button>
      <template v-else><WorkshopFormulaEditor v-model="rule.condition" label="触发条件" /><button type="button" @click="delete rule.condition">移除条件</button></template>
      <details :open="rule.costs.length>0"><summary>支付代价</summary><WorkshopRuleSteps v-model="rule.costs" :statuses="statuses" costs /></details>
      <WorkshopRuleSteps v-model="rule.steps" :statuses="statuses" />
    </section>
    <button type="button" @click="add">＋事件规则</button>
  </div>
</template>
<style scoped>
.rules-list{display:grid;gap:12px}.rules-list section{display:grid;gap:9px;padding:10px;border:1px solid #b4a07960;border-radius:9px}header,.rule-settings{display:flex;gap:8px;flex-wrap:wrap}header select{flex:1}.rule-settings input{width:65px}input,select,button{font:inherit;color:inherit;background:#1d2530;border:1px solid #a68d5960;border-radius:5px;padding:6px}summary{cursor:pointer;margin-bottom:8px}
</style>
