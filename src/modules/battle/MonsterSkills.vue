<script setup lang="ts">
/* global HTMLButtonElement, HTMLElement, document */
import { onMounted, onUnmounted, ref } from 'vue';
import { cleanCombatCopy } from '@/battle/presentation';
defineProps<{ name: string; skills: Array<{ id: string; name: string; description: string; cooldown: number; apCost?: number }> }>();
const emit = defineEmits<{ close: [] }>();
const closeButton = ref<HTMLButtonElement>();
let previousFocus: HTMLElement | null = null;
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  closeButton.value?.focus();
});
onUnmounted(() => previousFocus?.focus());
</script>

<template>
  <Teleport to="body">
    <div class="monster-skills-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
      <section class="monster-skills-panel" role="dialog" aria-modal="true" :aria-label="`${name}技能模组`" tabindex="-1">
        <header><strong>{{ name }} · 技能模组</strong><button ref="closeButton" type="button" aria-label="关闭技能模组" @click="emit('close')">×</button></header>
        <article v-for="skill in skills" :key="skill.id">
          <h3>{{ skill.name }} <small v-if="skill.apCost !== undefined">{{ skill.apCost }} AP</small><small v-if="skill.cooldown">冷却 {{ skill.cooldown }} 回合</small></h3>
          <p>{{ cleanCombatCopy(skill.description) }}</p>
        </article>
        <p v-if="!skills.length">暂无技能</p>
        <p v-if="skills.some(s => s.apCost !== undefined)">结束回合后，在敌方行动前共用玩家剩余 AP；每个技能每轮最多施放一次。群体伤害、治疗与护盾的总量最多为单体值的 2 倍。</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.monster-skills-backdrop { position:fixed; inset:0; z-index:2147483647; display:grid; place-items:center; padding:16px; background:#0009; color:#f7ead0; }
.monster-skills-panel { width:min(640px,100%); max-height:85dvh; overflow:auto; box-sizing:border-box; padding:20px; border:1px solid #97774a; border-radius:14px; background:#18202b; font-size:14px; }
header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
header button { font-size:24px; color:inherit; background:transparent; border:0; cursor:pointer; }
article { padding:14px 0; border-bottom:1px solid #ffffff20; }
h3 { margin:0 0 8px; font-size:16px; } h3 small { margin-left:8px; font-size:12px; font-weight:normal; color:#c9b488; }
p { margin:0; line-height:1.7; white-space:pre-line; }
</style>
