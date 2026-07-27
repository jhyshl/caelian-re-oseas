<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { GameSnapshot } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';

const props = defineProps<{ context: PanelContext }>();
const snapshot = ref<GameSnapshot>();
const busy = ref(false);
const message = ref('');

const name = ref('');
const className = ref('');
const subclass = ref('');
const level = ref(1);
const region = ref('');
const location = ref('');

async function refresh() {
  snapshot.value = await props.context.api.query('state');
  name.value = snapshot.value.character.name;
  className.value = snapshot.value.character.className;
  subclass.value = snapshot.value.character.subclass;
  level.value = snapshot.value.character.level;
  region.value = snapshot.value.world.region;
  location.value = snapshot.value.world.location;
}

async function save() {
  busy.value = true;
  message.value = '';
  try {
    const characterResult = await props.context.api.execute({
      id: commandId('character'),
      type: 'character.update',
      payload: {
        name: name.value,
        className: className.value,
        subclass: subclass.value,
        level: Number(level.value),
      },
    });
    if (characterResult.status === 'rejected') {
      throw new Error(characterResult.message);
    }

    const worldResult = await props.context.api.execute({
      id: commandId('world'),
      type: 'world.move',
      payload: {
        region: region.value,
        location: location.value,
      },
    });
    if (worldResult.status === 'rejected') {
      throw new Error(worldResult.message);
    }
    await refresh();
    message.value = '已保存到 Alpha 本地档案，并刷新 AI 精简投影。';
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

onMounted(() => void refresh());
</script>

<template>
  <section class="panel">
    <header>
      <div>
        <small>独立 Vue 应用</small>
        <h2>人物与世界摘要</h2>
      </div>
      <button
        type="button"
        class="close"
        aria-label="关闭人物面板"
        @click="context.api.closePanel('character')"
      >
        ×
      </button>
    </header>

    <div class="grid">
      <label>
        <span>名字</span>
        <input v-model="name" maxlength="80" />
      </label>
      <label>
        <span>职业</span>
        <input v-model="className" maxlength="80" />
      </label>
      <label>
        <span>子职业</span>
        <input v-model="subclass" maxlength="80" />
      </label>
      <label>
        <span>等级</span>
        <input v-model.number="level" type="number" min="1" max="999" />
      </label>
      <label>
        <span>地区</span>
        <input v-model="region" maxlength="120" />
      </label>
      <label>
        <span>位置</span>
        <input v-model="location" maxlength="120" />
      </label>
    </div>

    <p class="boundary">
      这些摘要会进入 MVU；牌组、背包明细、装备实例和 UI 设置不会进入 MVU。
    </p>
    <p v-if="message" class="message">{{ message }}</p>
    <button type="button" class="primary" :disabled="busy" @click="save">
      {{ busy ? '保存中…' : '保存摘要' }}
    </button>
  </section>
</template>

<style scoped>
.panel {
  width: min(620px, calc(100vw - 32px));
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
small,
label span {
  color: #bba9c9;
}
.close {
  border: 0;
  color: #d9cce6;
  background: transparent;
  font-size: 28px;
  cursor: pointer;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
input {
  padding: 11px 12px;
  border: 1px solid #4d3b60;
  border-radius: 10px;
  color: #fff;
  background: #110d18;
}
.boundary {
  margin: 18px 0 12px;
  padding: 12px;
  border-left: 3px solid #a977df;
  color: #d8cbe3;
  background: rgba(104, 76, 132, 0.18);
  font-size: 13px;
}
.message {
  color: #bce8cd;
  font-size: 13px;
}
.primary {
  width: 100%;
  padding: 12px;
  border: 0;
  border-radius: 12px;
  color: #160f20;
  background: #d5b4f5;
  font-weight: 700;
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.6;
}
@media (max-width: 580px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
