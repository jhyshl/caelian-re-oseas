<script setup lang="ts">
import type { ImperialFact } from '@/imperial/model';
import { playerText } from '@/imperial/display';
defineProps<{ fact: ImperialFact; playerName: string }>();
</script>

<template>
  <span class="imperial-fact">
    <span class="knowledge-icon" :class="{known:fact.known}" role="img" :aria-label="`${playerName}${fact.known ? '已知' : '尚未知晓'}`" :title="`${playerName}${fact.known ? '已知' : '尚未知晓'}${fact.evidence ? ` · ${playerText(fact.evidence, playerName)}` : ''}`" tabindex="0">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /><path v-if="!fact.known" d="m3 3 18 18" /></svg>
    </span>
    <span>{{ playerText(fact.text, playerName) }}</span>
  </span>
</template>

<style scoped>
.imperial-fact{display:flex;align-items:flex-start;gap:7px}.knowledge-icon{display:inline-flex;flex-shrink:0;margin-top:2px;padding:3px;border:1px solid #ffffff25;border-radius:6px;color:#a9a1b6;background:#ffffff07;cursor:help}.knowledge-icon.known{color:#a8dcca;background:#76c5ab16;border-color:#76c5ab60}.knowledge-icon:focus-visible{outline:2px solid #e9c779;outline-offset:2px}
</style>
