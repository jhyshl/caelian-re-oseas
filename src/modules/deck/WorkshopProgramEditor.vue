<script setup lang="ts">

import { ref } from 'vue';
import { RULE_SCOPES, normalizeRuleProgram, readRuleTemplates, saveRuleTemplate, type RuleProgram } from '@/workshop-program';
import { WORKSHOP_RULE_EXAMPLES } from '@/workshop-program-templates';
import { WORKSHOP_STATUS_LIBRARY } from '@/workshop-status-library';
import WorkshopFormulaEditor from './WorkshopFormulaEditor.vue';
import WorkshopRulesEditor from './WorkshopRulesEditor.vue';
const model=defineModel<RuleProgram>({required:true});
defineProps<{nested?:boolean}>();
const templates=ref(readRuleTemplates()),notice=ref(''),newDataName=ref('remaining');
function example(id:string):void{const p=[...WORKSHOP_RULE_EXAMPLES,...templates.value].find(x=>x.id===id);if(p)model.value={...JSON.parse(JSON.stringify(p)),id:model.value.id};}
function save():void{try{saveRuleTemplate(model.value);templates.value=readRuleTemplates();notice.value='组合模板已保存';}catch(e){notice.value=e instanceof Error?e.message:String(e);}}
function addStatus():void{model.value.statuses.push({id:'status-'+Date.now().toString(36),name:'自定义状态',polarity:'buff',turns:1,cleanseable:true,dispellable:true,baseChance:100,stacking:'independent',data:{},modifiers:[],rules:[]});}
function check():void{try{normalizeRuleProgram(model.value);notice.value='结构检查通过';}catch(e){notice.value=e instanceof Error?e.message:String(e);}}
</script>
<template>
  <section class="workshop-program-editor">
    <header><strong>{{ nested?'召唤物行为':'组合规则' }}</strong><input v-model="model.name" placeholder="组合名称" /><button type="button" @click="check">检查结构</button></header>
    <div v-if="!nested" class="template-actions"><select value="" @change="example(($event.target as HTMLSelectElement).value);($event.target as HTMLSelectElement).value=''"><option value="">从示例／我的模板开始</option><optgroup label="示例"><option v-for="p in WORKSHOP_RULE_EXAMPLES" :key="p.id" :value="p.id">{{ p.name }}</option></optgroup><optgroup label="我的模板"><option v-for="p in templates" :key="p.id" :value="p.id">{{ p.name }}</option></optgroup></select><button type="button" @click="save">保存组合模板</button></div>
    <p v-if="notice" role="status">{{ notice }}</p>
    <details><summary>数据记录</summary><div v-for="(v,i) in model.variables" :key="i" class="rule-variable"><input v-model="v.name" placeholder="数据名称"><select v-model="v.scope"><option v-for="[key,name] in RULE_SCOPES" :key="key" :value="key">{{ name }}</option></select><WorkshopFormulaEditor v-model="v.initial" label="初始值" /><button type="button" @click="model.variables.splice(i,1)">删除</button></div><button type="button" @click="model.variables.push({name:'value'+model.variables.length,scope:'battle',initial:0})">＋记录</button></details>
    <details :open="model.statuses.length>0">
      <summary>自定义状态</summary>
      <article v-for="(status,i) in model.statuses" :key="i" class="rule-status">
        <header><input v-model="status.name" placeholder="状态名称"><button type="button" @click="model.statuses.splice(i,1)">删除状态</button></header>
        <div class="status-options"><label>显示类别<select v-model="status.polarity"><option value="buff">Buff</option><option value="debuff">Debuff</option></select></label><label>回合数（－1为整场）<input v-model.number="status.turns" type="number" min="-1"></label><label>基础命中％<input v-model.number="status.baseChance" type="number" min="0" max="100"></label></div>
        <div class="status-options"><label><input v-model="status.cleanseable" type="checkbox">可净化</label><label><input v-model="status.dispellable" type="checkbox">可驱散</label><select v-model="status.stacking"><option value="independent">各份独立</option><option value="add">合并额度</option><option value="replace">新状态覆盖</option><option value="strongest">保留更强额度</option></select></div>
        <label>引用编号<input :value="status.id" readonly></label><strong>自身数据</strong><div v-for="(_,key) in status.data" :key="key" class="rule-variable"><span>{{ key }}</span><WorkshopFormulaEditor v-model="status.data[key]!" label="初始值" /><button type="button" @click="delete status.data[key]">删除</button></div><div><input v-model="newDataName" placeholder="数据名称"><button type="button" @click="status.data[newDataName]=0">＋自身数据</button></div>
        <strong>存在期间复用的效果</strong>
        <div v-for="(modifier,index) in status.modifiers" :key="index" class="rule-modifier"><select v-model="modifier.status"><option v-for="option in WORKSHOP_STATUS_LIBRARY" :key="option.id" :value="option.id">{{ option.name }} · {{ option.polarity }}</option></select><select v-model="modifier.unit"><option value="count">数值／层数</option><option value="percent">百分数（20＝20%）</option><option value="ratio">比例（0.2＝20%）</option></select><WorkshopFormulaEditor v-model="modifier.value" label="数值" /><button v-if="modifier.condition===undefined" type="button" @click="modifier.condition=true">添加生效条件</button><WorkshopFormulaEditor v-if="modifier.condition!==undefined" v-model="modifier.condition" label="生效条件" /><button type="button" @click="status.modifiers.splice(index,1)">删除效果</button></div>
        <button type="button" @click="status.modifiers.push({status:'taunt',value:1,unit:'count'})">＋复用状态效果</button>
        <WorkshopRulesEditor v-model="status.rules" :statuses="model.statuses" />
      </article>
      <button type="button" @click="addStatus">＋自定义状态</button>
    </details>
    <WorkshopRulesEditor v-model="model.rules" :statuses="model.statuses" />
  </section>
</template>
<style scoped>
.workshop-program-editor{display:grid;gap:12px;padding:12px;border:1px solid #b89f65;border-radius:10px;background:#111c29;color:#f5e4c4;min-width:0}.workshop-program-editor header,.template-actions,.status-options,.rule-variable{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.workshop-program-editor header strong{margin-right:auto}.rule-status,.rule-modifier{display:grid;gap:9px;padding:10px;margin:10px 0;border:1px solid #a68d5955;border-radius:8px}input,select,button{font:inherit;color:inherit;background:#1d2530;border:1px solid #a68d5960;border-radius:5px;padding:6px;box-sizing:border-box;max-width:100%}input[type=number]{width:85px}summary{cursor:pointer;padding:5px}p{margin:0}
</style>
