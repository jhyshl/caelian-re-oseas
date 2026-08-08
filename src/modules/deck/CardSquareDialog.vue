<script setup lang="ts">
/* global Blob, Event, HTMLInputElement, URL, Window, document, structuredClone, window */
import { computed, onMounted, ref, toRaw, watch } from 'vue';
import {
  CARD_SQUARE_TAGS,
  DECK_BUILD_FORMAT,
  exportCardSquareReceipt,
  importCardSquareReceipt,
  listCardSquareEntries,
  loadCardSquareSubmissionForEdit,
  readCardSquareFavorites,
  readCardSquareReceipts,
  refreshCardSquareReceipt,
  submitCardSquareEntry,
  toggleCardSquareFavorite,
  updateCardSquareSubmission,
  type CardSquareEditableSubmission,
  type CardSquareEntry,
  type CardSquareKind,
  type CardSquareStatus,
  type CardSquareSubmissionReceipt,
  type SquareDeckBuild,
} from '@/card-square';
import { refreshWorkshopPassiveCatalog } from '@/content/catalogs/battle';
import { loadCardCatalog, refreshWorkshopCardCatalog } from '@/content/catalogs/cards';
import { refreshWorkshopProfessionCatalogs } from '@/content/catalogs/professions';
import type { GameSnapshot } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import { readSavedDeckBuilds, saveNamedDeckBuild } from '@/saved-decks';
import {
  exportWorkshopPack,
  normalizeWorkshopPack,
  readWorkshopPacks,
  saveWorkshopPack,
} from '@/workshop';
import {
  isWorkshopScriptMechanism,
  normalizeWorkshopMechanism,
  readWorkshopMechanisms,
  saveWorkshopMechanism,
  type WorkshopMechanismManifest,
} from '@/workshop-mechanisms';
import {
  prepareWorkshopScriptRuntime,
  validateWorkshopScriptMechanism,
} from '@/workshop-script-runtime';

const props = defineProps<{ context: PanelContext }>();
const emit = defineEmits<{ close: []; changed: [] }>();

const tab = ref<'browse' | 'favorites' | 'receipts' | 'submit'>('browse');
const entries = ref<CardSquareEntry[]>([]);
const receipts = ref<CardSquareSubmissionReceipt[]>([]);
const snapshot = ref<GameSnapshot>();
const favorites = ref(new Set(readCardSquareFavorites()));
const loading = ref(false);
const busy = ref(false);
const refreshingReceiptId = ref('');
const error = ref('');
const notice = ref('');
const search = ref('');
const kindFilter = ref<'all' | CardSquareKind>('all');
const tagFilter = ref('');
const selectedId = ref('');

const submitKind = ref<CardSquareKind>('deck_build');
const submitTitle = ref('');
const submitSummary = ref('');
const submitTags = ref<string[]>([]);
const anonymous = ref(true);
const authorName = ref('');
const selectedClassId = ref('');
const selectedMechanismId = ref('');
const selectedSavedDeckId = ref('');
const editingReceipt = ref<CardSquareSubmissionReceipt>();
const editingSubmission = ref<CardSquareEditableSubmission>();

const localClasses = computed(() =>
  readWorkshopPacks().flatMap((pack) => pack.classes),
);
const localMechanisms = computed(() => readWorkshopMechanisms());
const savedOfficialDecks = computed(() =>
  readSavedDeckBuilds(sourceWindow()).filter(
    (build) => !build.professionId.startsWith('custom_class_'),
  ),
);
const selected = computed(() =>
  entries.value.find((entry) => entry.id === selectedId.value),
);
const filteredEntries = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('zh-CN');
  return entries.value.filter((entry) => {
    if (tab.value === 'favorites' && !favorites.value.has(entry.id)) return false;
    if (kindFilter.value !== 'all' && entry.kind !== kindFilter.value) return false;
    if (tagFilter.value && !entry.tags.includes(tagFilter.value)) return false;
    if (!term) return true;
    return [
      entry.title,
      entry.authorName ?? '匿名冒险者',
      entry.summary,
      entry.professionName,
      ...entry.tags,
    ].some((value) => value.toLocaleLowerCase('zh-CN').includes(term));
  });
});

const kindNames: Record<CardSquareKind, string> = {
  deck_build: '卡组构筑',
  custom_class: '自制职业',
  mechanism: '底层机制',
};
const statusNames: Record<CardSquareStatus, string> = {
  pending: '待审核',
  published: '已公开',
  rejected: '已驳回',
  unpublished: '已下架',
};

function sourceWindow(): Window {
  return props.context.document.defaultView ?? window;
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'caelian-work';
}

function downloadJson(value: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFilename(name)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toggleFavorite(entry: CardSquareEntry): void {
  const enabled = toggleCardSquareFavorite(entry.id);
  favorites.value = new Set(readCardSquareFavorites());
  notice.value = enabled ? `已收藏「${entry.title}」。` : `已取消收藏「${entry.title}」。`;
}

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    [entries.value, snapshot.value] = await Promise.all([
      listCardSquareEntries(sourceWindow()),
      props.context.api.query('state'),
    ]);
    if (!selectedId.value || !entries.value.some((entry) => entry.id === selectedId.value)) {
      selectedId.value = entries.value[0]?.id ?? '';
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loading.value = false;
  }
}

async function refreshReceipts(): Promise<void> {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const local = readCardSquareReceipts(sourceWindow());
    if (!local.length) {
      receipts.value = [];
      return;
    }
    const results = await Promise.allSettled(
      local.map((receipt) => refreshCardSquareReceipt(receipt, sourceWindow())),
    );
    receipts.value = readCardSquareReceipts(sourceWindow());
    const failed = results.filter((result) => result.status === 'rejected').length;
    notice.value = failed
      ? `已更新 ${results.length - failed} 份投稿，${failed} 份暂时无法查询。你也可以在对应投稿上单独重试。`
      : `已更新 ${results.length} 份投稿状态。`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}

async function refreshOneReceipt(
  receipt: CardSquareSubmissionReceipt,
): Promise<void> {
  refreshingReceiptId.value = receipt.id;
  error.value = '';
  notice.value = '';
  try {
    const updated = await refreshCardSquareReceipt(receipt, sourceWindow());
    receipts.value = readCardSquareReceipts(sourceWindow());
    notice.value = `《${updated.title}》的审核状态已更新为“${statusNames[updated.status]}”。`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    refreshingReceiptId.value = '';
  }
}

function resetSubmissionForm(): void {
  editingReceipt.value = undefined;
  editingSubmission.value = undefined;
  submitKind.value = 'deck_build';
  submitTitle.value = '';
  submitSummary.value = '';
  submitTags.value = [];
  anonymous.value = true;
  authorName.value = '';
  selectedClassId.value = '';
  selectedMechanismId.value = '';
  selectedSavedDeckId.value = '';
}

function openNewSubmission(): void {
  resetSubmissionForm();
  error.value = '';
  notice.value = '';
  tab.value = 'submit';
}

function cancelSubmission(): void {
  const wasEditing = Boolean(editingReceipt.value);
  resetSubmissionForm();
  tab.value = wasEditing ? 'receipts' : 'browse';
}

async function startEditing(
  receipt: CardSquareSubmissionReceipt,
): Promise<void> {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const current = await loadCardSquareSubmissionForEdit(
      receipt,
      sourceWindow(),
    );
    editingReceipt.value = receipt;
    editingSubmission.value = current;
    submitKind.value = current.kind;
    submitTitle.value = current.title;
    submitSummary.value = current.summary;
    submitTags.value = [...current.tags];
    anonymous.value = current.anonymous;
    authorName.value = current.authorName;
    selectedClassId.value = '';
    selectedMechanismId.value = '';
    selectedSavedDeckId.value = '';
    tab.value = 'submit';
    notice.value =
      '已载入当前投稿。若不重新选择本地构筑、职业或机制，将保留服务器上的现有作品内容。';
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}

async function importReceiptFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  error.value = '';
  try {
    const imported = importCardSquareReceipt(
      JSON.parse(await file.text()) as unknown,
      sourceWindow(),
    );
    receipts.value = readCardSquareReceipts(sourceWindow());
    tab.value = 'receipts';
    notice.value = `已导入《${imported.title}》的投稿回执。`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function refreshWorkshopCatalogs(): Promise<void> {
  refreshWorkshopProfessionCatalogs();
  await loadCardCatalog();
  refreshWorkshopCardCatalog();
  refreshWorkshopPassiveCatalog();
  emit('changed');
}

async function applyDeck(build: SquareDeckBuild): Promise<void> {
  const player = snapshot.value?.player;
  if (!player) return;
  if (player.subclass !== build.professionId) {
    const confirmed = window.confirm(
      `该构筑属于「${build.professionName}」，当前职业不符。是否先支付转职费用并转职？`,
    );
    if (!confirmed) {
      notice.value = '已保留收藏，你可以稍后转职后使用。';
      return;
    }
    const result = await props.context.api.execute({
      id: commandId('player.reclass'),
      type: 'player.reclass',
      payload: {
        classMain: build.mainClass,
        subclass: build.professionId,
      },
    });
    if (result.status === 'rejected') throw new Error(result.message);
  }
  const result = await props.context.api.execute({
    id: commandId('deck.update'),
    type: 'deck.update',
    payload: { cardIds: [...build.cardIds] },
  });
  if (result.status === 'rejected') {
    throw new Error(
      `${result.message ?? '构筑应用失败'}。构筑不会赠送未拥有的卡牌，请先收集缺少的卡牌。`,
    );
  }
  const existing = readSavedDeckBuilds(sourceWindow()).find(
    (entry) =>
      entry.name === build.name && entry.professionId === build.professionId,
  );
  saveNamedDeckBuild(
    {
      id: existing?.id ?? commandId('square-saved-deck'),
      name: build.name,
      professionId: build.professionId,
      professionName: build.professionName,
      mainClass: build.mainClass,
      cardIds: [...build.cardIds],
      createdAt: existing?.createdAt,
    },
    sourceWindow(),
  );
  snapshot.value = await props.context.api.query('state');
  notice.value = `已应用并保存构筑「${build.name}」。`;
  emit('changed');
}

async function installProfession(
  entry: CardSquareEntry,
  reclass: boolean,
): Promise<void> {
  const normalized = normalizeWorkshopPack(entry.payload);
  if (!(await approveCodeMechanisms(normalized.mechanisms ?? []))) return;
  const pack = saveWorkshopPack(normalized);
  await refreshWorkshopCatalogs();
  const profession = pack.classes[0];
  if (!profession) throw new Error('职业包中没有可用职业。');
  const mechanismNotice = pack.mechanisms?.length
    ? `，并同步安装 ${pack.mechanisms.length} 个底层机制`
    : '';
  if (!reclass) {
    notice.value = `职业「${profession.name}」已安装${mechanismNotice}，可在转职列表中选择。`;
    return;
  }
  const result = await props.context.api.execute({
    id: commandId('player.reclass'),
    type: 'player.reclass',
    payload: { classMain: profession.main, subclass: profession.id },
  });
  if (result.status === 'rejected') throw new Error(result.message);
  snapshot.value = await props.context.api.query('state');
  notice.value = `已安装并转职为「${profession.name}」${mechanismNotice}。`;
  emit('changed');
}

async function approveCodeMechanisms(
  mechanisms: WorkshopMechanismManifest[],
): Promise<boolean> {
  const scripts = mechanisms.filter(isWorkshopScriptMechanism);
  if (!scripts.length) return true;
  if (
    !window.confirm(
      `该作品包含 ${scripts.length} 个可执行代码机制。代码会在隔离且限时的战斗沙箱中运行，但仍可能改变战斗平衡或造成短暂卡顿。是否继续校验并安装？`,
    )
  ) {
    return false;
  }
  await prepareWorkshopScriptRuntime();
  for (const mechanism of scripts) {
    await validateWorkshopScriptMechanism(mechanism);
  }
  return true;
}

async function useEntry(entry: CardSquareEntry, reclass = false): Promise<void> {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    if (entry.kind === 'deck_build') {
      await applyDeck(entry.payload as SquareDeckBuild);
    } else if (entry.kind === 'custom_class') {
      await installProfession(entry, reclass);
    } else {
      const normalized = normalizeWorkshopMechanism(entry.payload);
      if (!(await approveCodeMechanisms([normalized]))) return;
      const mechanism = saveWorkshopMechanism(normalized);
      notice.value = `底层机制「${mechanism.name}」已安装。只有声明依赖它的职业会在战斗中启用。`;
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}

function deckPayload(): SquareDeckBuild {
  const deck = savedOfficialDecks.value.find(
    (entry) => entry.id === selectedSavedDeckId.value,
  );
  if (!deck) throw new Error('请先选择一份已保存的官方职业构筑。');
  return {
    format: DECK_BUILD_FORMAT,
    version: 1,
    name: deck.name,
    professionId: deck.professionId,
    professionName: deck.professionName,
    mainClass: deck.mainClass,
    cardIds: [...deck.cardIds],
    exportedAt: new Date().toISOString(),
  };
}

function classPayload(): unknown {
  const profession = localClasses.value.find(
    (entry) => entry.id === selectedClassId.value,
  );
  if (!profession) throw new Error('请选择一个本地自制职业。');
  return exportWorkshopPack({
    packName: `${profession.name}职业包`,
    author: anonymous.value ? '匿名冒险者' : authorName.value.trim(),
    classes: [structuredClone(toRaw(profession))],
  });
}

function mechanismPayload(): WorkshopMechanismManifest {
  const mechanism = localMechanisms.value.find(
    (entry) => entry.id === selectedMechanismId.value,
  );
  if (!mechanism) throw new Error('请选择一个本地底层机制。');
  return structuredClone(toRaw(mechanism));
}

function submissionPayload(): unknown {
  const existing = editingSubmission.value;
  if (submitKind.value === 'deck_build') {
    if (selectedSavedDeckId.value) return deckPayload();
  } else if (submitKind.value === 'custom_class') {
    if (selectedClassId.value) return classPayload();
  } else if (selectedMechanismId.value) {
    return mechanismPayload();
  }
  if (existing && existing.kind === submitKind.value) return existing.payload;
  return submitKind.value === 'deck_build'
    ? deckPayload()
    : submitKind.value === 'custom_class'
      ? classPayload()
      : mechanismPayload();
}

function toggleSubmitTag(tag: string): void {
  if (submitTags.value.includes(tag)) {
    submitTags.value = submitTags.value.filter((entry) => entry !== tag);
    return;
  }
  if (submitTags.value.length >= 8) {
    notice.value = '搜索标签最多选择 8 个。';
    return;
  }
  submitTags.value = [...submitTags.value, tag];
}

async function submit(): Promise<void> {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const draft = {
      kind: submitKind.value,
      title: submitTitle.value,
      anonymous: anonymous.value,
      authorName: authorName.value,
      summary: submitSummary.value,
      tags: [...submitTags.value],
      payload: submissionPayload(),
    };
    const currentReceipt = editingReceipt.value;
    const result = currentReceipt
      ? await updateCardSquareSubmission(
          currentReceipt,
          draft,
          props.context.api.getRuntimeInfo(),
          sourceWindow(),
        )
      : await submitCardSquareEntry(
          draft,
          props.context.api.getRuntimeInfo(),
          sourceWindow(),
        );
    notice.value =
      currentReceipt
        ? '投稿修改已保存，旧审核结果已清空，作品已重新进入待审核队列。'
        : result.status === 'published'
        ? '构筑已公开发布到卡牌广场，并已保存本机投稿回执。'
        : '投稿已进入作者审核队列；可在“我的投稿”查看审核结果。';
    receipts.value = readCardSquareReceipts(sourceWindow());
    resetSubmissionForm();
    if (!currentReceipt && result.status === 'published') {
      await refresh();
      tab.value = 'browse';
    } else {
      tab.value = 'receipts';
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  receipts.value = readCardSquareReceipts(sourceWindow());
  void refresh();
});

watch(tab, (next) => {
  if (next !== 'receipts') return;
  receipts.value = readCardSquareReceipts(sourceWindow());
  if (receipts.value.length) void refreshReceipts();
});
</script>

<template>
  <Teleport :to="context.document.body">
    <div class="square-backdrop" @click.self="emit('close')">
      <section class="square-dialog" role="dialog" aria-modal="true" aria-labelledby="square-title">
        <header class="square-header">
          <div>
            <small>COMMUNITY CARD SQUARE</small>
            <h2 id="square-title">卡牌广场</h2>
            <p>发现构筑、职业与机制。自制内容公开前均经过作者审核。</p>
          </div>
          <button type="button" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <nav class="square-tabs">
          <button :class="{ active: tab === 'browse' }" @click="tab = 'browse'">全部作品</button>
          <button :class="{ active: tab === 'favorites' }" @click="tab = 'favorites'">我的收藏 {{ favorites.size }}</button>
          <button :class="{ active: tab === 'receipts' }" @click="tab = 'receipts'">我的投稿 {{ receipts.length }}</button>
          <button :class="{ active: tab === 'submit' }" @click="openNewSubmission">上传作品</button>
        </nav>

        <main v-if="tab === 'browse' || tab === 'favorites'" class="square-browser">
          <div class="square-toolbar">
            <input v-model="search" placeholder="搜索作品名、职业、作者、简介或标签" />
            <select v-model="kindFilter">
              <option value="all">全部类型</option>
              <option value="deck_build">卡组构筑</option>
              <option value="custom_class">自制职业</option>
              <option value="mechanism">底层机制</option>
            </select>
            <button type="button" class="ca-button" :disabled="loading" @click="refresh">刷新</button>
          </div>
          <div class="filter-tags" aria-label="按标签筛选">
            <button
              type="button"
              :class="{ active: tagFilter === '' }"
              @click="tagFilter = ''"
            >
              全部标签
            </button>
            <button
              v-for="tag in CARD_SQUARE_TAGS"
              :key="tag"
              type="button"
              :class="{ active: tagFilter === tag }"
              @click="tagFilter = tagFilter === tag ? '' : tag"
            >
              {{ tag }}
            </button>
          </div>
          <div v-if="loading" class="square-empty">正在读取卡牌广场……</div>
          <div v-else-if="filteredEntries.length === 0" class="square-empty">没有符合条件的作品。</div>
          <div v-else class="square-layout">
            <aside class="square-list">
              <button
                v-for="entry in filteredEntries"
                :key="entry.id"
                type="button"
                :class="{ selected: selectedId === entry.id }"
                @click="selectedId = entry.id"
              >
                <span>{{ kindNames[entry.kind] }}</span>
                <strong>{{ entry.title }}</strong>
                <small>{{ entry.professionName }} · {{ entry.authorName || '匿名冒险者' }}</small>
              </button>
            </aside>
            <article v-if="selected" class="square-detail">
              <div class="detail-meta">
                <span>{{ kindNames[selected.kind] }}</span>
                <time>{{ new Date(selected.publishedAt || selected.createdAt).toLocaleDateString('zh-CN') }}</time>
              </div>
              <h3>{{ selected.title }}</h3>
              <p class="author">作者：{{ selected.authorName || '匿名冒险者' }}</p>
              <p>{{ selected.summary }}</p>
              <div class="tag-row">
                <button
                  v-for="tag in selected.tags"
                  :key="tag"
                  type="button"
                  @click="tagFilter = tag; tab = 'browse'"
                >
                  # {{ tag }}
                </button>
              </div>
              <dl>
                <div><dt>适用职业</dt><dd>{{ selected.professionName || '通用机制' }}</dd></div>
                <div><dt>兼容版本</dt><dd>{{ selected.appVersion }}</dd></div>
              </dl>
              <footer>
                <button type="button" class="ca-button" @click="toggleFavorite(selected)">
                  {{ favorites.has(selected.id) ? '取消收藏' : '收藏' }}
                </button>
                <button type="button" class="ca-button" @click="downloadJson(selected.payload, selected.title)">下载 JSON</button>
                <template v-if="selected.kind === 'custom_class'">
                  <button type="button" class="ca-button" :disabled="busy" @click="useEntry(selected, false)">安装职业</button>
                  <button type="button" class="ca-button primary" :disabled="busy" @click="useEntry(selected, true)">转职并使用</button>
                </template>
                <button
                  v-else
                  type="button"
                  class="ca-button primary"
                  :disabled="busy"
                  @click="useEntry(selected)"
                >
                  {{ selected.kind === 'deck_build' ? '使用构筑' : '安装机制' }}
                </button>
              </footer>
            </article>
          </div>
        </main>

        <main v-else-if="tab === 'receipts'" class="square-receipts">
          <div class="receipt-toolbar">
            <div>
              <strong>仅此终端持有投稿回执</strong>
              <p>公开、驳回和下架结果不会广播给其他玩家。建议下载回执备份，换设备时可重新导入。</p>
            </div>
            <div>
              <label class="ca-button receipt-import">
                导入回执
                <input type="file" accept="application/json,.json" @change="importReceiptFile" />
              </label>
              <button type="button" class="ca-button primary" :disabled="busy || receipts.length === 0" @click="refreshReceipts">
                {{ busy ? '正在查询……' : '查询审核结果' }}
              </button>
            </div>
          </div>
          <div v-if="receipts.length === 0" class="square-empty">此终端还没有投稿回执。投稿后会自动保存在这里。</div>
          <div v-else class="receipt-list">
            <article v-for="receipt in receipts" :key="receipt.id" :class="`status-${receipt.status}`">
              <header>
                <div>
                  <small>{{ kindNames[receipt.kind] }}</small>
                  <h3>{{ receipt.title }}</h3>
                </div>
                <strong>{{ statusNames[receipt.status] }}</strong>
              </header>
              <p v-if="receipt.reviewNote" class="review-note"><b>审核说明：</b>{{ receipt.reviewNote }}</p>
              <dl>
                <div><dt>投稿时间</dt><dd>{{ new Date(receipt.createdAt).toLocaleString('zh-CN') }}</dd></div>
                <div><dt>最后查询</dt><dd>{{ new Date(receipt.lastCheckedAt).toLocaleString('zh-CN') }}</dd></div>
              </dl>
              <footer>
                <button
                  type="button"
                  class="ca-button"
                  :disabled="busy || Boolean(refreshingReceiptId)"
                  @click="startEditing(receipt)"
                >
                  修改投稿
                </button>
                <button
                  type="button"
                  class="ca-button primary"
                  :disabled="busy || Boolean(refreshingReceiptId)"
                  @click="refreshOneReceipt(receipt)"
                >
                  {{ refreshingReceiptId === receipt.id ? '正在查询……' : '查询此投稿' }}
                </button>
                <button type="button" class="ca-button" @click="downloadJson(exportCardSquareReceipt(receipt), `${receipt.title}-投稿回执`)">下载回执</button>
              </footer>
            </article>
          </div>
        </main>

        <main v-else class="square-submit">
          <section class="submit-explainer">
            <strong>{{ editingReceipt ? '修改投稿并重新送审' : '投稿规则' }}</strong>
            <p v-if="editingReceipt">保存任何修改后，作品都会先从公开列表撤下，清空旧审核意见并重新进入作者审核队列。投稿类型不可更换。</p>
            <p v-else>官方职业卡组构筑通过格式校验后直接公开；自制职业和底层机制必须先由作者审核。作品名称为必填项，可选择匿名发布。</p>
          </section>
          <div class="submit-grid">
            <label><span>投稿类型</span><select v-model="submitKind" :disabled="Boolean(editingReceipt)"><option value="deck_build">已保存的官方职业构筑</option><option value="custom_class">本地自制职业</option><option value="mechanism">本地底层机制</option></select></label>
            <label><span>作品名称</span><input v-model="submitTitle" maxlength="50" placeholder="用于卡牌广场搜索" /></label>
            <label v-if="submitKind === 'deck_build'" class="wide">
              <span>选择已保存构筑</span>
              <select v-model="selectedSavedDeckId">
                <option value="">请选择</option>
                <option v-for="build in savedOfficialDecks" :key="build.id" :value="build.id">
                  {{ build.name }} · {{ build.professionName }} · {{ build.cardIds.length }} 张
                </option>
              </select>
              <small v-if="editingReceipt && !selectedSavedDeckId">不选择时保留当前投稿里的构筑内容。</small>
              <small v-if="savedOfficialDecks.length === 0">请先在牌组面板的“我的构筑预设”中保存一份官方职业构筑。</small>
            </label>
            <label v-if="submitKind === 'custom_class'"><span>选择职业</span><select v-model="selectedClassId"><option value="">{{ editingReceipt ? '保留当前投稿内容' : '请选择' }}</option><option v-for="profession in localClasses" :key="profession.id" :value="profession.id">{{ profession.name }}</option></select></label>
            <label v-if="submitKind === 'mechanism'"><span>选择机制</span><select v-model="selectedMechanismId"><option value="">{{ editingReceipt ? '保留当前投稿内容' : '请选择' }}</option><option v-for="mechanism in localMechanisms" :key="mechanism.id" :value="mechanism.id">{{ mechanism.name }}</option></select></label>
            <label class="wide"><span>作品简介</span><textarea v-model="submitSummary" maxlength="240" placeholder="玩法思路、核心循环、适合的战斗场景"></textarea></label>
            <fieldset class="wide submit-tags">
              <legend>搜索标签（最多 8 个）</legend>
              <button
                v-for="tag in CARD_SQUARE_TAGS"
                :key="tag"
                type="button"
                :class="{ selected: submitTags.includes(tag) }"
                :aria-pressed="submitTags.includes(tag)"
                @click="toggleSubmitTag(tag)"
              >
                {{ tag }}
              </button>
            </fieldset>
            <label class="anonymous-toggle"><input v-model="anonymous" type="checkbox" /><span>匿名发布，不上传作者署名</span></label>
            <label v-if="!anonymous"><span>公开署名</span><input v-model="authorName" maxlength="30" placeholder="卡牌广场显示的作者名" /></label>
          </div>
          <footer class="submit-actions">
            <button type="button" class="ca-button" @click="cancelSubmission">{{ editingReceipt ? '取消修改' : '返回广场' }}</button>
            <button type="button" class="ca-button primary" :disabled="busy" @click="submit">{{ busy ? '正在提交……' : editingReceipt ? '保存修改并重新送审' : '提交作品' }}</button>
          </footer>
        </main>

        <p v-if="notice" class="square-notice">{{ notice }}</p>
        <p v-if="error" class="square-error">{{ error }}</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.square-backdrop { position: fixed; z-index: 2147483000; inset: 0; display: grid; place-items: center; padding: 18px; background: rgba(2, 4, 8, .84); backdrop-filter: blur(8px); font-family: var(--ca-ui); }
.square-dialog { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; width: min(980px, 100%); height: min(780px, calc(100dvh - 36px)); overflow: hidden; border: 1px solid rgba(212, 168, 67, .42); border-radius: 18px; color: var(--ca-text); background: #11141a; box-shadow: 0 32px 100px rgba(0,0,0,.78); }
.square-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 22px 25px 17px; border-bottom: 1px solid #282d36; background: radial-gradient(circle at 12% 0, rgba(212,168,67,.12), transparent 45%); }
.square-header small { color: var(--ca-gold); font-size: 9px; letter-spacing: .2em; }
.square-header h2 { margin: 4px 0; color: var(--ca-text-bright); font: 700 25px/1.1 var(--ca-serif); }
.square-header p { margin: 0; color: var(--ca-muted); font-size: 11px; }
.square-header > button { border: 0; color: var(--ca-muted); background: transparent; font-size: 28px; cursor: pointer; }
.square-tabs { display: flex; gap: 4px; padding: 8px 16px; border-bottom: 1px solid #282d36; }
.square-tabs button { padding: 8px 13px; border: 0; border-radius: 8px; color: var(--ca-muted); background: transparent; font: 700 11px var(--ca-ui); cursor: pointer; }
.square-tabs button.active { color: var(--ca-gold-light); background: rgba(212,168,67,.11); }
.square-browser, .square-submit, .square-receipts { min-height: 0; overflow: auto; }
.square-toolbar { display: flex; gap: 8px; padding: 13px 16px; border-bottom: 1px solid #252a32; }
.square-toolbar input { min-width: 0; flex: 1; }
.square-toolbar input, .square-toolbar select, .submit-grid input, .submit-grid select, .submit-grid textarea { padding: 9px 11px; border: 1px solid #343a45; border-radius: 8px; color: #ebe4d9; background: #0d1015; font: inherit; }
.filter-tags { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 16px 12px; border-bottom: 1px solid #252a32; }
.filter-tags button, .tag-row button { padding: 5px 8px; border: 1px solid #343a45; border-radius: 999px; color: #bdb6aa; background: transparent; font: 9px var(--ca-ui); cursor: pointer; }
.filter-tags button.active, .tag-row button:hover { border-color: var(--ca-gold); color: var(--ca-gold-light); background: rgba(212,168,67,.1); }
.square-layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); min-height: 100%; }
.square-list { overflow-y: auto; padding: 10px; border-right: 1px solid #282d36; }
.square-list button { display: grid; width: 100%; gap: 4px; margin-bottom: 7px; padding: 11px; border: 1px solid #2d333d; border-radius: 10px; color: inherit; background: rgba(255,255,255,.02); text-align: left; cursor: pointer; }
.square-list button.selected { border-color: rgba(212,168,67,.6); background: rgba(212,168,67,.09); }
.square-list span, .detail-meta span { color: var(--ca-gold); font-size: 9px; letter-spacing: .12em; }
.square-list strong { color: var(--ca-text-bright); font-size: 13px; }
.square-list small { color: var(--ca-muted); font-size: 10px; }
.square-detail { overflow-y: auto; padding: 26px clamp(20px, 4vw, 42px); }
.detail-meta { display: flex; justify-content: space-between; color: var(--ca-muted); font-size: 10px; }
.square-detail h3 { margin: 9px 0 4px; color: var(--ca-text-bright); font: 700 28px/1.15 var(--ca-serif); }
.square-detail p { color: var(--ca-muted); font-size: 12px; line-height: 1.7; }
.square-detail .author { color: var(--ca-gold-light); }
.tag-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 17px 0; }
.square-detail dl { display: grid; gap: 7px; padding: 13px; border: 1px solid #2d333d; border-radius: 10px; background: rgba(255,255,255,.02); }
.square-detail dl div { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; }
.square-detail dt { color: var(--ca-muted); }.square-detail dd { margin: 0; color: var(--ca-text-bright); }
.square-detail footer, .submit-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; margin-top: 22px; }
.square-submit { padding: 22px clamp(18px, 4vw, 38px) 32px; }
.submit-explainer { padding: 13px; border: 1px solid rgba(212,168,67,.28); border-radius: 11px; background: rgba(212,168,67,.06); }
.submit-explainer strong { color: var(--ca-gold-light); }.submit-explainer p { margin: 5px 0 0; color: var(--ca-muted); font-size: 11px; line-height: 1.6; }
.submit-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; margin-top: 18px; }
.submit-grid label { display: grid; gap: 6px; }.submit-grid label > span { color: var(--ca-gold); font-size: 10px; font-weight: 700; }.submit-grid .wide { grid-column: 1 / -1; }.submit-grid textarea { min-height: 85px; resize: vertical; }
.submit-grid .anonymous-toggle { display: flex; align-items: center; align-self: end; grid-template: none; min-height: 40px; }.anonymous-toggle input { width: auto; }
.submit-grid label > small { color: var(--ca-muted); font-size: 9px; line-height: 1.5; }
.submit-tags { display: flex; flex-wrap: wrap; gap: 7px; margin: 0; padding: 11px; border: 1px solid #343a45; border-radius: 9px; }
.submit-tags legend { padding: 0 5px; color: var(--ca-gold); font-size: 10px; font-weight: 700; }
.submit-tags button { padding: 6px 10px; border: 1px solid #303640; border-radius: 999px; color: #cfc7bb; background: rgba(255,255,255,.02); font: 700 9px var(--ca-ui); cursor: pointer; touch-action: manipulation; }
.submit-tags button:hover, .submit-tags button.selected { border-color: var(--ca-gold); color: var(--ca-gold-light); background: rgba(212,168,67,.13); }
.receipt-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 17px 20px; border-bottom: 1px solid #282d36; background: rgba(212,168,67,.045); }
.receipt-toolbar strong { color: var(--ca-gold-light); font-size: 12px; }.receipt-toolbar p { max-width: 620px; margin: 5px 0 0; color: var(--ca-muted); font-size: 10px; line-height: 1.55; }.receipt-toolbar > div:last-child { display: flex; flex: 0 0 auto; gap: 7px; }
.receipt-import { position: relative; overflow: hidden; cursor: pointer; }.receipt-import input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.receipt-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 12px; padding: 16px; }
.receipt-list article { padding: 15px; border: 1px solid #343a45; border-left: 3px solid #7d8797; border-radius: 11px; background: rgba(255,255,255,.025); }.receipt-list article.status-published { border-left-color: #64bd86; }.receipt-list article.status-rejected { border-left-color: #d86f68; }.receipt-list article.status-unpublished { border-left-color: #b7885d; }
.receipt-list header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }.receipt-list small { color: var(--ca-gold); font-size: 9px; letter-spacing: .12em; }.receipt-list h3 { margin: 4px 0 0; color: var(--ca-text-bright); font: 700 17px/1.2 var(--ca-serif); }.receipt-list header > strong { flex: 0 0 auto; padding: 5px 8px; border-radius: 999px; color: #d8d1c5; background: #2a3039; font-size: 9px; }
.receipt-list .review-note { padding: 10px; border-radius: 8px; color: #d9d0c1; background: rgba(255,255,255,.035); font-size: 11px; line-height: 1.6; }.receipt-list dl { display: grid; gap: 4px; margin: 12px 0 0; }.receipt-list dl div { display: flex; justify-content: space-between; gap: 8px; font-size: 9px; }.receipt-list dt { color: var(--ca-muted); }.receipt-list dd { margin: 0; color: #cfc7bb; }.receipt-list footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; margin-top: 12px; }
.square-empty { padding: 60px 20px; color: var(--ca-muted); text-align: center; }
.square-notice, .square-error { margin: 0; padding: 10px 16px; border-top: 1px solid #282d36; font-size: 11px; text-align: center; }.square-notice { color: #8ed4aa; }.square-error { color: #ed8d86; }
@media (max-width: 680px) { .square-backdrop { padding: 0; }.square-dialog { width: 100%; height: 100%; border: 0; border-radius: 0; }.square-header { padding: 15px 16px; }.square-tabs { overflow-x: auto; }.square-tabs button { flex: 0 0 auto; }.square-layout { grid-template-columns: 1fr; }.square-list { display: flex; gap: 7px; overflow-x: auto; border-right: 0; border-bottom: 1px solid #282d36; }.square-list button { flex: 0 0 210px; margin: 0; }.square-detail { padding: 20px 16px 30px; }.square-toolbar { flex-wrap: wrap; }.square-toolbar input { flex-basis: 100%; }.submit-grid { grid-template-columns: 1fr; }.submit-grid .wide { grid-column: auto; }.receipt-toolbar { align-items: stretch; flex-direction: column; }.receipt-toolbar > div:last-child { flex-wrap: wrap; }.receipt-list { grid-template-columns: 1fr; } }
</style>
