<script setup lang="ts">
import { ref } from 'vue';
import { DEFAULT_STAR_SCALING, readStarTemplates, saveStarTemplate, type WorkshopStarScaling } from '@/workshop-stars';
import { cloneWorkshopData } from '@/workshop-drafts';
const props = defineProps<{ modelValue?: WorkshopStarScaling }>();
const emit = defineEmits<{ 'update:modelValue': [value: WorkshopStarScaling] }>();
const templates = ref(readStarTemplates());
const selected = ref('default');
const templateName = ref('');
const notice = ref('');
function apply() {
  const value = selected.value === 'default' ? DEFAULT_STAR_SCALING : templates.value.find(t => t.id === selected.value)?.scaling;
  if (value) emit('update:modelValue', cloneWorkshopData(value));
}
function update(index: number, key: 'flat' | 'ratio', value: string) {
  const next = cloneWorkshopData(props.modelValue ?? DEFAULT_STAR_SCALING);
  next.levels[index]![key] = Number(value); emit('update:modelValue', next);
}
function save() {
  try { saveStarTemplate(templateName.value, props.modelValue ?? DEFAULT_STAR_SCALING); templates.value = readStarTemplates(); notice.value = '模板已保存，可用于其他卡牌。'; }
  catch (error) { notice.value = error instanceof Error ? error.message : String(error); }
}
</script>

<template>
  <section class="star-editor" aria-label="卡牌星级数值">
    <strong>一至三星数值</strong>
    <p v-if="!modelValue">这张旧版卡牌尚未设置升星数值。选择模板后点击一键填写，再保存职业。</p>
    <div class="template-picker">
      <select v-model="selected" aria-label="星级倍率模板">
        <option value="default">标准成长：1 / 1.1 / 1.2</option>
        <option v-for="item in templates" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
      <button type="button" class="ca-button" @click="apply">一键填写</button>
    </div>
    <div v-if="modelValue" class="star-values">
      <label v-for="(row, index) in modelValue.levels" :key="index">
        <span>{{ index + 1 }}★</span>
        <span>固定值系数<input :value="row.flat" type="number" min="0.01" max="100" step="0.01" :aria-label="`${index + 1}星固定值系数`" @input="update(index, 'flat', ($event.target as HTMLInputElement).value)" /></span>
        <span>属性倍率系数<input :value="row.ratio" type="number" min="0.01" max="100" step="0.01" :aria-label="`${index + 1}星属性倍率系数`" @input="update(index, 'ratio', ($event.target as HTMLInputElement).value)" /></span>
      </label>
    </div>
    <small>系数乘以下方卡牌效果的基础值与属性倍率。例如20＋100%攻击，标准三星为24＋120%攻击。AP、概率、回合数、抽牌和资源数量不随模板增长。</small>
    <div class="template-picker">
      <input v-model="templateName" placeholder="我的倍率模板名称" maxlength="40" aria-label="自定义星级模板名称" />
      <button type="button" class="ca-button" :disabled="!modelValue" @click="save">保存为模板</button>
    </div>
    <small v-if="notice">{{ notice }}</small>
  </section>
</template>

<style scoped>
.star-editor { display:grid; gap:12px; padding:14px; border:1px solid var(--ca-border); border-radius:10px; margin:12px 0; font-size:14px; }
.star-editor p { margin:0; color:var(--ca-muted); }
.star-editor small { line-height:1.6; font-size:13px; }
.template-picker { display:flex; flex-wrap:wrap; gap:8px; }
.star-values { display:grid; gap:8px; }
.star-values label { display:grid; grid-template-columns:32px 1fr 1fr; gap:8px; align-items:center; }
.star-values span { min-width:0; }
input, select { width:100%; min-width:0; padding:8px; border:1px solid var(--ca-border); background:var(--ca-bg); color:var(--ca-text); border-radius:6px; font:inherit; }
.template-picker input, .template-picker select { flex:1; min-width:140px; }
</style>
