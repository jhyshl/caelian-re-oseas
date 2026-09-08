<script setup lang="ts">

import { computed } from 'vue';
import { RULE_OPS, RULE_SCOPES, type RuleExpression } from '@/workshop-program';
const model=defineModel<RuleExpression>({default:0});
defineProps<{label?:string}>();
const formula=computed(()=>typeof model.value==='object'?model.value:null);
const op=computed(()=>formula.value?.op??'literal');
const reads=['var','event','stat','status','status_data','resource','cards'];
const stats=[['hp','当前生命'],['hpMax','生命上限'],['lostHp','已损生命'],['attack','攻击力'],['defense','防御'],['speed','速度'],['crit','暴击率'],['critDamage','暴击伤害'],['ehr','效果命中'],['res','效果抵抗'],['shield','护盾'],['ap','AP']];
const events=[['amount','本次剩余金额'],['originalAmount','原始金额'],['hpDamage','实际扣除生命'],['shieldDamage','护盾吸收'],['overflow','溢出治疗'],['absorbed','抵扣金额'],['sourceId','事件发起者'],['targetId','事件目标'],['cardId','卡牌名称编号'],['cardUid','卡牌实例'],['cardCost','卡牌AP费用'],['statusId','状态编号'],['before','变化前'],['after','变化后']];
function setOp(value:string):void{model.value=value==='literal'?0:{op:value,...(reads.includes(value)?{key:value==='stat'?'attack':value==='event'?'amount':'value',...(value==='var'?{scope:'local'}:{})}:value==='targets'?{key:'enemies'}:{args:[0,0]})};}
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
      <select v-else-if="op==='event'" v-model="formula.key"><option v-for="[key,name] in events" :key="key" :value="key">{{ name }}</option></select>
      <input v-else-if="reads.includes(op)" v-model="formula.key" placeholder="数据名称／牌堆">
      <select v-if="['stat','status','status_data','resource'].includes(op)" v-model="formula.target"><option value="self">持有者</option><option value="target">当前目标</option><option value="source">施加者</option><option value="summoner">召唤者</option><option value="event_source">事件发起者</option><option value="event_target">事件目标</option></select>
      <template v-if="op==='targets'">
        <select v-model="formula.key"><option value="enemies">敌方存活单位</option><option value="allies">友方存活单位</option><option value="summons">召唤物</option><option value="all">全部存活单位</option></select>
        <select v-model="formula.scope"><option value="">全部符合者</option><option value="lowest_hp">生命比例最低者</option></select>
        <button v-if="!formula.value" type="button" @click="formula.value={op:'gt',args:[{op:'stat',target:'target',key:'hp'},0]}">添加筛选条件</button>
        <WorkshopFormulaEditor v-if="formula.value" v-model="formula.value" label="目标条件" />
      </template>
      <div v-if="formula.args" class="rule-arguments"><WorkshopFormulaEditor v-for="(_,i) in formula.args" :key="i" v-model="formula.args[i]!" :label="`参数 ${i+1}`" /><button type="button" @click="formula.args.push(0)">＋参数</button><button v-if="formula.args.length" type="button" @click="formula.args.pop()">－参数</button></div>
    </template>
  </div>
</template>
<style scoped>
.rule-formula{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:7px;border:1px solid #a68d5940;border-radius:7px;min-width:0}.rule-formula input{width:110px;min-width:65px}.rule-formula select{max-width:100%}.rule-arguments{display:grid;gap:5px;width:100%;padding-left:8px;box-sizing:border-box}button,input,select{font:inherit;color:inherit;background:#1d2530;border:1px solid #a68d5960;border-radius:5px;padding:5px}
</style>
