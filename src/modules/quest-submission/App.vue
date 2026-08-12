<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type {
  PanelContext,
  PendingQuestSubmissionView,
} from '@/kernel/public-api';

const props = defineProps<{ context: PanelContext }>();
const pending = ref<PendingQuestSubmissionView | null>(null);
const busy = ref(false);
const error = ref('');
let disposeState: (() => void) | undefined;

async function refresh(): Promise<void> {
  pending.value = await props.context.api.getPendingQuestSubmission();
  if (!pending.value) void props.context.api.closePanel('quest-submission');
}

async function submit(): Promise<void> {
  if (!pending.value || busy.value) return;
  error.value = '';
  if (!pending.value.available) {
    error.value = `${pending.value.itemName}数量不足：需要 ${pending.value.count}，当前 ${pending.value.ownedCount}`;
    return;
  }
  busy.value = true;
  try {
    await props.context.api.submitPendingQuestItem();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
    await refresh();
  } finally {
    busy.value = false;
  }
}

function minimize(): void {
  void props.context.api.closePanel('quest-submission');
}

onMounted(async () => {
  await refresh();
  disposeState = props.context.api.on('state.changed', refresh);
});

onUnmounted(() => disposeState?.());
</script>

<template>
  <div class="submission-overlay">
    <section
      v-if="pending"
      class="submission-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="submission-title"
    >
      <header>
        <div>
          <span>QUEST MATERIAL</span>
          <h1 id="submission-title">剧情材料提交</h1>
        </div>
        <button type="button" aria-label="最小化" title="最小化" @click="minimize">—</button>
      </header>
      <main>
        <p>任务「{{ pending.questName }}」需要你提交材料后才能继续推进。</p>
        <div class="material">
          <div class="material-icon">◇</div>
          <div>
            <strong>{{ pending.itemName }} × {{ pending.count }}</strong>
            <span>背包现有：{{ pending.ownedCount }}</span>
          </div>
        </div>
        <p v-if="!pending.available" class="warning">
          材料数量不足，当前无法提交。任务会停留在本节点。
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </main>
      <footer>
        <button type="button" class="secondary" @click="minimize">稍后提交</button>
        <button type="button" class="primary" :disabled="busy || !pending.available" @click="submit">
          {{ busy ? '正在提交……' : '提交并继续任务' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.submission-overlay { position: fixed; inset: 0; z-index: 1; display: grid; place-items: center; padding: max(14px, env(safe-area-inset-top)) max(14px, env(safe-area-inset-right)) max(14px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left)); color: #e8e0d4; background: rgba(4, 6, 10, .76); backdrop-filter: blur(7px); font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif; }
.submission-dialog { width: min(520px, 100%); overflow: hidden; border: 1px solid rgba(212,168,67,.48); border-radius: 18px; background: linear-gradient(145deg, #181c26, #0e1118); box-shadow: 0 30px 90px rgba(0,0,0,.72); }
header { display: flex; align-items: center; justify-content: space-between; padding: 20px 22px; border-bottom: 1px solid #2b303e; }
header span { color: #d4a843; font-size: 10px; letter-spacing: .2em; } h1 { margin: 4px 0 0; font: 600 23px/1.2 Georgia, "Noto Serif SC", serif; }
header button { width: 34px; height: 30px; border: 1px solid #3b4151; border-radius: 9px; color: #e8e0d4; background: #202532; cursor: pointer; }
main { padding: 24px 22px; } main > p { margin: 0 0 18px; color: #aaa397; line-height: 1.7; }
.material { display: flex; align-items: center; gap: 15px; padding: 18px; border: 1px solid rgba(212,168,67,.3); border-radius: 14px; background: rgba(212,168,67,.07); }
.material-icon { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; color: #f0d68a; background: #292415; font-size: 24px; }
.material strong, .material span { display: block; } .material strong { color: #fff3d0; font-size: 17px; } .material span { margin-top: 6px; color: #9e978b; font-size: 13px; }
.warning, .error { margin: 16px 0 0 !important; padding: 11px 13px; border-radius: 10px; color: #f2c7a4 !important; background: rgba(177,82,42,.16); }
footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 22px 22px; } footer button { min-height: 42px; padding: 0 17px; border-radius: 10px; cursor: pointer; } footer button:disabled { opacity: .42; cursor: not-allowed; }
.secondary { border: 1px solid #3a4050; color: #bcb5a9; background: #1b202b; } .primary { border: 1px solid #c69c3c; color: #171209; background: linear-gradient(#efd27e, #c99d3c); font-weight: 700; }
@media (max-width: 560px) { .submission-overlay { align-items: end; padding: 0; } .submission-dialog { width: 100%; border-radius: 18px 18px 0 0; } footer { flex-direction: column-reverse; } footer button { width: 100%; } }
</style>
