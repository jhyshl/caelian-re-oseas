<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { InventoryStackRecord } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';

const props = defineProps<{ context: PanelContext }>();
const items = ref<InventoryStackRecord[]>([]);
const itemId = ref('alpha_supply');
const itemName = ref('Alpha 测试补给');
const delta = ref(1);
const message = ref('');

async function refresh() {
  items.value = await props.context.api.query('inventory');
}

async function adjust(
  targetId = itemId.value,
  targetName = itemName.value,
  amount = Number(delta.value),
) {
  const result = await props.context.api.execute({
    id: commandId('inventory'),
    type: 'inventory.adjust',
    payload: {
      itemId: targetId,
      name: targetName,
      delta: amount,
    },
  });
  message.value =
    result.status === 'rejected'
      ? result.message || '命令被拒绝'
      : result.status === 'duplicate'
        ? '重复命令已忽略'
        : '本地背包已更新';
  await refresh();
}

onMounted(() => void refresh());
</script>

<template>
  <section class="panel">
    <header>
      <div>
        <small>独立 Vue 应用 · IndexedDB only</small>
        <h2>本地背包</h2>
      </div>
      <button
        type="button"
        class="close"
        aria-label="关闭背包面板"
        @click="context.api.closePanel('inventory')"
      >
        ×
      </button>
    </header>

    <div class="composer">
      <input v-model="itemId" aria-label="物品 ID" placeholder="物品 ID" />
      <input v-model="itemName" aria-label="物品名称" placeholder="物品名称" />
      <input
        v-model.number="delta"
        aria-label="数量变化"
        type="number"
        step="1"
      />
      <button type="button" @click="adjust()">执行命令</button>
    </div>

    <p class="boundary">
      下列完整堆叠只存在浏览器的 <code>caelian-alpha</code> 数据库，不写入 MVU。
    </p>

    <ul v-if="items.length">
      <li v-for="item in items" :key="item.id">
        <div>
          <strong>{{ item.name }}</strong>
          <small>{{ item.itemId }}</small>
        </div>
        <span>× {{ item.quantity }}</span>
        <button
          type="button"
          aria-label="减少一件"
          @click="adjust(item.itemId, item.name, -1)"
        >
          −1
        </button>
      </li>
    </ul>
    <p v-else class="empty">背包为空。</p>
    <p v-if="message" class="message">{{ message }}</p>
  </section>
</template>

<style scoped>
.panel {
  width: min(660px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 24px;
  border: 1px solid rgba(199, 165, 240, 0.45);
  border-radius: 22px;
  color: #f8f2ff;
  background: #191323;
  box-shadow: 0 28px 80px rgba(7, 3, 13, 0.58);
  font-family: Inter, "Microsoft YaHei", system-ui, sans-serif;
}
header {
  display: flex;
  align-items: start;
  justify-content: space-between;
}
h2 {
  margin: 2px 0 20px;
}
small {
  display: block;
  color: #bba9c9;
}
.close {
  border: 0;
  color: #d9cce6;
  background: transparent;
  font-size: 28px;
  cursor: pointer;
}
.composer {
  display: grid;
  grid-template-columns: 1fr 1.25fr 88px auto;
  gap: 8px;
}
input,
.composer button,
li button {
  padding: 10px;
  border: 1px solid #4d3b60;
  border-radius: 10px;
  color: #fff;
  background: #110d18;
}
button {
  cursor: pointer;
}
.composer button {
  color: #160f20;
  background: #d5b4f5;
  font-weight: 700;
}
.boundary {
  margin: 16px 0;
  padding: 11px;
  border-left: 3px solid #69c6a0;
  color: #d6e9df;
  background: rgba(58, 128, 94, 0.15);
  font-size: 13px;
}
ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border-radius: 12px;
  background: rgba(102, 75, 128, 0.16);
}
.empty,
.message {
  color: #bba9c9;
}
@media (max-width: 620px) {
  .composer {
    grid-template-columns: 1fr;
  }
}
</style>
