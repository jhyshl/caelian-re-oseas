<script setup lang="ts">
import { computed, inject, useId, type ComputedRef } from 'vue';
import { RULE_OPS, RULE_SCOPES, WORKSHOP_STATE_FIELDS, WORKSHOP_EVENT_FIELDS, type RuleExpression } from '@/workshop-program';
import { WORKSHOP_STATUS_LIBRARY } from '@/workshop-status-library';
const model=defineModel<RuleExpression>({default:0});
defineProps<{label?:string}>();
const catalog=inject<ComputedRef<{records:Array<{scope:string;key:string;label:string}>;statuses:Array<{id:string;name:string}>;dataKeys:string[]}>>('workshopFormulaChoices',computed(()=>({records:[],statuses:[],dataKeys:[]})));
const listId=useId();
const formula=computed(()=>typeof model.value==='object'?model.value:null),op=computed(()=>formula.value?.op??'literal');
const reads=['var','event','stat','status','status_data','resource','cards','card_items'];
const stats=[['id','单位编号'],['level','等级'],['hp','当前生命'],['hpMax','生命上限'],['lostHp','已损生命'],['attack','攻击力'],['defense','防御'],['speed','速度'],['crit','暴击率'],['critDamage','暴击伤害'],['ehr','效果命中'],['res','效果抵抗'],['shield','护盾'],['ap','AP']];
const units=[['self','持有者'],['target','当前目标'],['selected_target','本次选中目标'],['source','施加者'],['summoner','召唤者'],['event_source','事件发起者'],['event_target','事件目标']];
const allStatuses=computed(()=>[...WORKSHOP_STATUS_LIBRARY,...catalog.value.statuses]);
const records=computed(()=>catalog.value.records.filter(v=>v.scope===(formula.value?.scope??'local')));
function setOp(value:string):void {
 if(value==='literal'){model.value=0;return;}
 const targets:RuleExpression={op:'targets',key:'enemies'},states:RuleExpression={op:'statuses',key:'dot',target:'selected_target'};
 const defaults:Record<string,object>={statuses:{key:'dot',target:'selected_target'},item:{key:'damage'},unique:{key:'type',args:[states]},filter_list:{args:[targets],value:{op:'gt',args:[{op:'item',key:'hp'},0]}},sort_list:{args:[targets],value:{op:'item',key:'hp'},scope:'asc'},take:{args:[targets,1]},sample:{args:[targets,1]},sum_list:{args:[states],value:{op:'item',key:'damage'}},min_list:{args:[states],value:{op:'item',key:'damage'}},max_list:{args:[states],value:{op:'item',key:'damage'}}};
 model.value={op:value,...(defaults[value]??(reads.includes(value)?{key:value==='stat'?'attack':value==='event'?'amount':['cards','card_items'].includes(value)?'hand':'value',...(value==='var'?{scope:'local'}:{})}:value==='targets'?{key:'enemies'}:{args:[0,0]}))};
}
</script>
<template>
  <div class="rule-formula">
    <span v-if="label">{{ label }}</span>
    <select :value="op" @change="setOp(($event.target as HTMLSelectElement).value)"><option v-for="[key,name] in RULE_OPS" :key="key" :value="key">{{ name }}</option></select>
    <template v-if="!formula">
      <input v-if="typeof model==='boolean'" :checked="model" type="checkbox" @change="model=($event.target as HTMLInputElement).checked">
      <input v-else :value="model" :type="typeof model==='number'?'number':'text'" step="any" @input="model=typeof model==='number'?Number(($event.target as HTMLInputElement).value):($event.target as HTMLInputElement).value">
      <button type="button" @click="model=typeof model==='number'?'self':0">{{ typeof model==='number'?'改用对象／文字':'改用数字' }}</button>
      <button v-if="typeof model!=='boolean'" type="button" @click="model=true">改用是／否</button>
    </template>
    <template v-else>
      <WorkshopFormulaEditor v-if="op==='literal'" v-model="formula.value" label="常数值" />
      <select v-if="op==='var'" v-model="formula.scope"><option v-for="[key,name] in RULE_SCOPES" :key="key" :value="key">{{ name }}</option></select>
      <select v-if="op==='stat'" v-model="formula.key"><option v-for="[key,name] in stats" :key="key" :value="key">{{ name }}</option></select>
      <select v-else-if="op==='event'" v-model="formula.key"><option v-for="[key,name] in WORKSHOP_EVENT_FIELDS" :key="key" :value="key">{{ name }}</option></select>
      <template v-else-if="['item','unique'].includes(op)"><select v-model="formula.key"><option v-for="[key,name] in WORKSHOP_STATE_FIELDS" :key="key" :value="key">{{ name }}</option><option v-for="key in catalog.dataKeys" :key="key" :value="'data.'+key">状态数据 · {{ key }}</option></select><p v-if="op==='item'">在逐项执行、列表筛选或统计中，读取正在处理的那一项。</p></template>
      <template v-else-if="op==='var'"><select v-if="records.length" :value="formula.key" @change="formula.key=($event.target as HTMLSelectElement).value"><option value="">选择已定义数据</option><option v-for="r in records" :key="r.key" :value="r.key">{{ r.label }}</option></select><input v-model="formula.key" placeholder="数据名称或结果字段"></template>
      <template v-else-if="['status','status_data'].includes(op)"><input v-model="formula.key" :list="listId" :placeholder="op==='status'?'选择状态':'选择状态数据'"><datalist :id="listId"><template v-if="op==='status'"><option v-for="s in allStatuses" :key="s.id" :value="s.id">{{ s.name }}</option></template><template v-else><option v-for="r in catalog.records.filter(r=>r.scope==='status_data')" :key="r.key" :value="r.key">{{ r.label }}</option></template></datalist></template>
      <select v-else-if="['cards','card_items'].includes(op)" v-model="formula.key"><option value="hand">手牌</option><option value="deck">抽牌堆</option><option value="discard">弃牌堆</option><option value="exhaust">移出牌</option></select>
      <input v-else-if="reads.includes(op)" v-model="formula.key" placeholder="数据名称／资源">
      <select v-if="['stat','status','status_data','resource','statuses'].includes(op)" v-model="formula.target"><option v-for="[key,name] in units" :key="key" :value="key">{{ name }}</option></select>
      <template v-if="op==='statuses'">
        <select v-model="formula.key"><option value="all">全部状态</option><option value="buff">Buff</option><option value="debuff">Debuff</option><option value="dot">DOT</option></select>
        <label>种类筛选<select :value="formula.types===undefined?'all':'selected'" @change="formula.types=($event.target as HTMLSelectElement).value==='all'?undefined:[]"><option value="all">全部种类</option><option value="selected">指定种类</option></select></label>
        <div v-if="formula.types!==undefined" class="state-types"><label v-for="s in allStatuses.filter(s=>formula!.key==='all'||('kind' in s?s.kind===formula!.key:formula!.key!=='dot'))" :key="s.id"><input v-model="formula.types" type="checkbox" :value="s.id">{{ s.name }}</label><p v-if="!formula.types.length">未选择任何种类，返回空列表。</p></div>
        <button v-if="formula.value===undefined" type="button" @click="formula.value={op:'gt',args:[{op:'item',key:'remaining'},0]}">添加状态条件</button>
        <WorkshopFormulaEditor v-if="formula.value!==undefined" v-model="formula.value" label="状态条件" />
      </template>
      <template v-if="op==='targets'">
        <select v-model="formula.key"><option value="enemies">敌方存活单位</option><option value="allies">友方存活单位</option><option value="summons">召唤物</option><option value="all">全部存活单位</option></select>
        <select v-model="formula.scope"><option value="">全部符合者</option><option value="lowest_hp">生命比例最低者</option></select>
        <label><input v-model="formula.excludeSelected" type="checkbox">除选中目标外</label>
        <button v-if="!formula.value" type="button" @click="formula.value={op:'gt',args:[{op:'stat',target:'target',key:'hp'},0]}">添加筛选条件</button>
        <WorkshopFormulaEditor v-if="formula.value" v-model="formula.value" label="目标条件" />
      </template>
      <select v-if="op==='sort_list'" v-model="formula.scope"><option value="asc">从小到大</option><option value="desc">从大到小</option></select>
      <WorkshopFormulaEditor v-if="['filter_list','sort_list','sum_list','min_list','max_list'].includes(op)" v-model="formula.value!" :label="op==='filter_list'?'保留条件':'每项取值'" />
      <div v-if="formula.args" class="rule-arguments"><WorkshopFormulaEditor v-for="(_,i) in formula.args" :key="i" v-model="formula.args[i]!" :label="['unique','filter_list','sort_list','sum_list','min_list','max_list','take','sample'].includes(op)?(i===0?'输入列表':'数量'):`参数 ${i+1}`" /><template v-if="!['unique','filter_list','sort_list','sum_list','min_list','max_list','take','sample'].includes(op)"><button type="button" @click="formula.args.push(0)">＋参数</button><button v-if="formula.args.length" type="button" @click="formula.args.pop()">－参数</button></template></div>
    </template>
  </div>
</template>
<style scoped>
.rule-formula{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:7px;border:1px solid #a68d5940;border-radius:7px;min-width:0}.rule-formula input{width:110px;min-width:65px}.rule-formula select{max-width:100%}.rule-arguments{display:grid;gap:5px;width:100%;padding-left:8px;box-sizing:border-box}button,input,select{font:inherit;color:inherit;background:#1d2530;border:1px solid #a68d5960;border-radius:5px;padding:5px}
</style>
