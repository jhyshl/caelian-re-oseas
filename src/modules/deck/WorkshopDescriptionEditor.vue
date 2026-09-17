<script setup lang="ts">
/* global HTMLTextAreaElement, HTMLSelectElement, Event */
import { computed, inject, ref, type ComputedRef } from 'vue';
import type { WorkshopStarScaling } from '@/workshop-stars';
import type { CardEffect } from '@/content/types';
import { cardFormulaChoices, renderCardDescription, type CardDescriptionBinding } from '@/card-description';
import { emptyWorkshopObjectCatalog, type WorkshopObjectCatalog } from '@/workshop-object-catalog';
import WorkshopFormulaEditor from './WorkshopFormulaEditor.vue';
import WorkshopObjectSelect from './WorkshopObjectSelect.vue';
const model=defineModel<string>({required:true});
const bindings=defineModel<CardDescriptionBinding[]>('bindings',{default:()=>[]});
const props=defineProps<{effects:CardEffect[];cardType?:string;starScaling?:WorkshopStarScaling}>();
const objects=inject<ComputedRef<WorkshopObjectCatalog>>('workshopObjectCatalog',computed(emptyWorkshopObjectCatalog));
const area=ref<HTMLTextAreaElement>();
const choices=computed(()=>cardFormulaChoices({effects:props.effects,type:props.cardType,starScaling:props.starScaling}));
const preview=computed(()=>renderCardDescription({description:model.value,descriptionBindings:bindings.value},objects.value));
function insert(binding:CardDescriptionBinding) {
  let label=binding.label;let index=2;while(bindings.value.some(b=>b.label===label))label=binding.label+index++;
  bindings.value=[...bindings.value,{...JSON.parse(JSON.stringify(binding)),label}];
  const pos=area.value?.selectionStart??model.value.length,end=area.value?.selectionEnd??pos;
  model.value=model.value.slice(0,pos)+'{{'+label+'}}'+model.value.slice(end);
}
function fromChoice(event:Event) {const select=event.target as HTMLSelectElement;const choice=choices.value[Number(select.value)];if(choice)insert(choice);select.value='';}
</script>
<template>
  <div class="description-editor">
    <label>卡牌说明<textarea ref="area" v-model="model" maxlength="2000" rows="4"></textarea></label>
    <div class="description-tools">
      <select value="" :disabled="bindings.length>=32" @change="fromChoice"><option value="" disabled>插入本卡伤害／治疗／护盾公式</option><option v-for="(choice,i) in choices" :key="i" :value="i">{{ choice.label }}</option></select>
      <button type="button" :disabled="bindings.length>=32" @click="insert({label:'数值',kind:'formula',expression:{op:'stat',key:'attack'}})">＋自定义数值公式</button>
      <button type="button" :disabled="bindings.length>=32" @click="insert({label:'名称',kind:'name',objectKind:'statuses',objectId:''})">＋中文名称引用</button>
    </div>
    <small>在光标处插入引用。战斗中公式显示当前数值；伤害公式为减伤、暴击前的基础值。复制公式后可在下方调整。</small>
    <details v-for="(binding,i) in bindings" :key="i">
      <summary>{{ binding.label }} · {{ binding.kind==='name'?'中文名称':'实时数值' }}</summary>
      <template v-if="binding.kind==='name'"><select v-model="binding.objectKind"><option value="cards">卡牌</option><option value="statuses">状态</option><option value="resources">资源</option></select><WorkshopObjectSelect v-model="binding.objectId" :kind="binding.objectKind??'statuses'" /></template>
      <template v-else><template v-if="binding.starExpressions"><WorkshopFormulaEditor v-for="(_,star) in binding.starExpressions" :key="star" v-model="binding.starExpressions[star]" :label="(star+1)+' 星数值公式'" /></template><WorkshopFormulaEditor v-else v-model="binding.expression" label="数值公式" /><label v-for="(_,star) in binding.stars" :key="star">{{ star+1 }} 星系数<input v-model.number="binding.stars![star]" type="number" step="0.1"></label></template>
      <button type="button" @click="model=model.split('{{'+binding.label+'}}').join('');bindings.splice(i,1)">删除此引用</button>
    </details>
    <p class="description-preview">{{ preview || '说明预览' }}</p>
  </div>
</template>
<style scoped>
.description-editor{display:grid;gap:8px;min-width:0}.description-editor label{display:grid;gap:5px}.description-editor textarea{width:100%;box-sizing:border-box;resize:vertical;font:inherit}.description-tools{display:flex;flex-wrap:wrap;gap:6px}.description-preview{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;border:1px solid #806c4a;border-radius:6px}.description-editor details{padding:6px;border:1px solid #806c4a;border-radius:5px}.description-editor small{opacity:.8}
</style>
