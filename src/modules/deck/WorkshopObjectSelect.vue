<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue';
import { emptyWorkshopObjectCatalog, type WorkshopObjectCatalog, type WorkshopObjectChoice } from '@/workshop-object-catalog';
const model = defineModel<string | undefined>();
const props = defineProps<{ kind: keyof WorkshopObjectCatalog; extra?: WorkshopObjectChoice[]; allowEmpty?: boolean }>();
const catalog = inject<ComputedRef<WorkshopObjectCatalog>>('workshopObjectCatalog', computed(emptyWorkshopObjectCatalog));
const choices = computed(() => [...new Map([...catalog.value[props.kind], ...(props.extra ?? [])].map(item => [item.id, item])).values()]);
const groups = computed(() => [...new Set(choices.value.map(item => item.group))]);
</script>
<template>
  <select v-model="model">
    <option v-if="allowEmpty || !model" value="">请选择对象</option>
    <option v-if="model && !choices.some(c => c.id === model)" :value="model">{{ model }}（当前引用）</option>
    <optgroup v-for="group in groups" :key="group" :label="group">
      <option v-for="choice in choices.filter(c => c.group === group)" :key="choice.id" :value="choice.id">{{ choice.name }} · {{ choice.id }}</option>
    </optgroup>
  </select>
</template>
<style scoped>select{font:inherit;color:inherit;background:#1d2530;border:1px solid #a68d5960;border-radius:5px;padding:6px;max-width:100%}</style>
