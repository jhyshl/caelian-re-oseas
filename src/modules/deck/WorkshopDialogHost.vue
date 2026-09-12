<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';
import type { PanelContext } from '@/kernel/public-api';
import WorkshopDialog from './WorkshopDialog.vue';

defineProps<{context:PanelContext;initialCardId?:string}>();
const emit=defineEmits<{close:[];saved:[]}>();
const failure=ref(''),recovering=ref(false);
onErrorCaptured(error=>{
  failure.value=error instanceof Error?error.message:String(error);
  return false;
});
function recover():void {recovering.value=true;failure.value='';}
</script>
<template>
  <WorkshopDialog v-if="!failure" :context="context" :initial-card-id="recovering?undefined:initialCardId" :initial-tab="recovering?'drafts':undefined" @close="emit('close')" @saved="emit('saved')" />
  <Teleport v-else :to="context.document.body">
    <div class="workshop-recovery-backdrop" @click.self="emit('close')">
      <section class="workshop-recovery" role="dialog" aria-modal="true" aria-labelledby="workshop-recovery-title">
        <h2 id="workshop-recovery-title">创意工坊暂时无法显示</h2>
        <p role="alert">原草稿仍保留在此浏览器中。可以返回草稿列表，或关闭后重新打开。</p>
        <details><summary>错误详情</summary><p>{{ failure }}</p></details>
        <div><button type="button" @click="recover">返回草稿列表</button><button type="button" @click="emit('close')">关闭创意工坊</button></div>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.workshop-recovery-backdrop{position:fixed;inset:0;z-index:2147483645;display:grid;place-items:center;padding:16px;background:#050504d1}.workshop-recovery{box-sizing:border-box;width:min(520px,100%);padding:24px;border:1px solid #d4a84360;border-radius:16px;background:#15120e;color:#e7ddcd;font:16px/1.6 sans-serif;max-height:90vh;overflow:auto}.workshop-recovery h2{font-size:20px;margin:0 0 12px}.workshop-recovery p{overflow-wrap:anywhere}.workshop-recovery summary{cursor:pointer}.workshop-recovery>div{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}.workshop-recovery button{cursor:pointer;font:inherit;border:1px solid #d4a84380;border-radius:8px;background:#302817;color:#f5e4c4;padding:8px 14px}
</style>
