<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { MailboxEntry, MailboxState } from '@/domain/types';
import { commandId } from '@/kernel/ids';
import type { PanelContext } from '@/kernel/public-api';
import AdventurerFrame from '@/ui/adventurer/AdventurerFrame.vue';

const props = defineProps<{ context: PanelContext }>();
const mailbox = ref<MailboxState>();
const selectedId = ref('');
const busy = ref(false);
const error = ref('');
const disposers: Array<() => void> = [];

const selected = computed(
  () =>
    mailbox.value?.entries.find((entry) => entry.id === selectedId.value) ??
    null,
);

const selectedNeedsClaim = computed(
  () => Boolean(selected.value?.unread && !selected.value.rewardClaimedAt),
);

function dateLabel(timestamp: number): string {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(timestamp);
}

async function refresh(): Promise<void> {
  mailbox.value = await props.context.api.query('mailbox');
  if (
    !selectedId.value ||
    !mailbox.value.entries.some((entry) => entry.id === selectedId.value)
  ) {
    selectedId.value =
      mailbox.value.entries.find((entry) => entry.unread)?.id ??
      mailbox.value.entries[0]?.id ??
      '';
  }
}

async function selectMail(entry: MailboxEntry): Promise<void> {
  selectedId.value = entry.id;
  if (!entry.unread || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await props.context.api.execute({
      id: commandId('mail-open'),
      type: 'mail.open',
      payload: { mailId: entry.id },
    });
    if (result.status === 'rejected') {
      throw new Error(result.message || '邮件开启失败');
    }
    await refresh();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    busy.value = false;
  }
}

async function openSelected(): Promise<void> {
  if (selected.value) await selectMail(selected.value);
}

onMounted(async () => {
  await refresh();
  for (const event of [
    'state.changed',
    'tavern.changed',
    'achievement.unlocked',
  ] as const) {
    disposers.push(props.context.api.on(event, refresh));
  }
});

onUnmounted(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
</script>

<template>
  <AdventurerFrame :context="context" active="mailbox">
    <section class="mail-heading">
      <div>
        <span>OSEAS POST</span>
        <h1>冒险者邮箱</h1>
        <p>已拥有并读过的信件会永久保存在玩家浏览器中，可以随时重读。</p>
      </div>
      <strong>{{ mailbox?.unreadCount ?? 0 }} 封未读</strong>
    </section>

    <div v-if="!mailbox" class="ca-empty">正在整理信件……</div>
    <div v-else-if="mailbox.entries.length === 0" class="mail-empty">
      <div>✉</div>
      <strong>邮箱还是空的</strong>
      <p>特殊成就补丁送达后，信件会自动出现在这里。</p>
    </div>
    <section v-else class="mail-layout">
      <aside class="mail-list" aria-label="邮件列表">
        <button
          v-for="entry in mailbox.entries"
          :key="entry.id"
          type="button"
          :class="{
            active: selectedId === entry.id,
            unread: entry.unread,
          }"
          @click="selectMail(entry)"
        >
          <i>{{ entry.unread ? '●' : '○' }}</i>
          <span>
            <b>{{ entry.title }}</b>
            <small>{{ entry.preview }}</small>
          </span>
          <time>{{ dateLabel(entry.receivedAt) }}</time>
        </button>
      </aside>

      <article v-if="selected" class="letter">
        <header>
          <div>
            <span>LETTER ARCHIVE</span>
            <h2>{{ selected.title }}</h2>
          </div>
          <dl>
            <div>
              <dt>寄件人</dt>
              <dd>{{ selected.sender }}</dd>
            </div>
            <div>
              <dt>收件日期</dt>
              <dd>{{ dateLabel(selected.receivedAt) }}</dd>
            </div>
          </dl>
        </header>
        <div class="letter-paper">
          <p
            v-for="(paragraph, index) in selected.body"
            :key="`${selected.id}:${index}`"
            :class="{ greeting: index === 0 }"
          >
            {{ paragraph }}
          </p>
          <p v-if="selected.signature" class="signature">
            {{ selected.signature }}
          </p>
          <p class="reward">{{ selected.rewardText }}</p>
          <button
            v-if="selected.unread"
            class="mail-open"
            type="button"
            :disabled="busy"
            @click="openSelected"
          >
            {{
              busy
                ? '正在开启……'
                : selectedNeedsClaim
                  ? '打开信件并领取奖励'
                  : '打开信件'
            }}
          </button>
          <small v-if="selected.rewardClaimedAt">
            {{
              selected.unread
                ? '奖励已同步；打开后可永久重读。'
                : '奖励已结算；再次阅读不会重复发放。'
            }}
          </small>
          <small v-else-if="busy">正在开启信件并结算奖励……</small>
        </div>
      </article>
    </section>
    <p v-if="error" class="mail-error">{{ error }}</p>
  </AdventurerFrame>
</template>

<style scoped>
.mail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 14px;
  padding: 17px 19px;
  border: 1px solid var(--ca-border);
  border-radius: 14px;
  background:
    radial-gradient(circle at 0 50%, rgba(212, 168, 67, 0.12), transparent 31%),
    var(--ca-surface);
}

.mail-heading span,
.letter header span {
  color: var(--ca-gold);
  font-size: 9px;
  letter-spacing: 0.17em;
}

.mail-heading h1 {
  margin: 4px 0;
  color: var(--ca-text-bright);
  font: 700 23px var(--ca-serif);
}

.mail-heading p {
  margin: 0;
  color: var(--ca-muted);
  font-size: 11px;
}

.mail-heading > strong {
  flex: 0 0 auto;
  padding: 8px 12px;
  border: 1px solid rgba(212, 168, 67, 0.36);
  border-radius: 999px;
  color: var(--ca-gold-light);
  background: rgba(212, 168, 67, 0.07);
  font-size: 11px;
}

.mail-layout {
  min-height: 490px;
  display: grid;
  grid-template-columns: minmax(220px, 0.34fr) minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--ca-border);
  border-radius: 14px;
  background: #101319;
}

.mail-list {
  overflow: auto;
  border-right: 1px solid var(--ca-border);
  background: #11141b;
}

.mail-list button {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 9px;
  padding: 14px 13px;
  border: 0;
  border-bottom: 1px solid var(--ca-border);
  color: var(--ca-muted);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.mail-list button:hover,
.mail-list button.active {
  color: var(--ca-text);
  background: rgba(212, 168, 67, 0.07);
}

.mail-list button.active {
  box-shadow: inset 3px 0 var(--ca-gold);
}

.mail-list i {
  grid-row: 1 / span 2;
  align-self: center;
  color: #59606f;
  font-size: 9px;
  font-style: normal;
}

.mail-list button.unread i,
.mail-list button.unread b {
  color: var(--ca-gold-light);
}

.mail-list span {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.mail-list b,
.mail-list small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mail-list b {
  color: currentColor;
  font: 700 14px var(--ca-serif);
}

.mail-list small,
.mail-list time {
  color: var(--ca-muted);
  font-size: 9px;
}

.mail-list time {
  grid-column: 2;
}

.letter {
  min-width: 0;
  overflow: auto;
  padding: 20px;
  background:
    radial-gradient(circle at 100% 0, rgba(212, 168, 67, 0.08), transparent 34%),
    #151820;
}

.letter > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
}

.letter h2 {
  margin: 4px 0 0;
  color: var(--ca-text-bright);
  font: 700 22px var(--ca-serif);
}

.letter dl {
  display: flex;
  gap: 14px;
  margin: 0;
  text-align: right;
}

.letter dt {
  color: var(--ca-muted);
  font-size: 8px;
}

.letter dd {
  margin: 3px 0 0;
  color: var(--ca-text);
  font-size: 10px;
}

.letter-paper {
  min-height: 380px;
  padding: clamp(22px, 5vw, 42px);
  border: 1px solid rgba(212, 168, 67, 0.42);
  border-radius: 12px;
  color: #4b2b15;
  background:
    linear-gradient(rgba(106, 67, 29, 0.035) 1px, transparent 1px)
      0 0 / 100% 27px,
    #fffaf2;
  box-shadow:
    0 18px 42px rgba(0, 0, 0, 0.24),
    inset 0 0 40px rgba(143, 93, 35, 0.05);
  font: 14px/1.9 "Noto Serif SC", Georgia, serif;
}

.letter-paper p {
  margin: 0 0 14px;
  text-indent: 2em;
}

.letter-paper p.greeting,
.letter-paper p.signature,
.letter-paper p.reward {
  text-indent: 0;
}

.letter-paper .signature {
  text-align: right;
}

.letter-paper .reward {
  margin-top: 24px;
  padding: 10px 12px;
  border: 1px solid rgba(157, 117, 40, 0.34);
  border-radius: 9px;
  color: #7b4b16;
  background: rgba(212, 168, 67, 0.1);
  text-align: center;
  font-weight: 700;
}

.letter-paper > small {
  display: block;
  color: #8a735d;
  text-align: center;
  font-size: 10px;
}

.mail-open {
  display: block;
  margin: 18px auto 9px;
  padding: 9px 18px;
  border: 1px solid rgba(123, 75, 22, 0.48);
  border-radius: 999px;
  color: #fffaf2;
  background: #7b4b16;
  font: 700 12px "Noto Serif SC", Georgia, serif;
  cursor: pointer;
}

.mail-open:disabled {
  cursor: wait;
  opacity: 0.62;
}

.mail-empty {
  min-height: 430px;
  display: grid;
  place-content: center;
  gap: 7px;
  color: var(--ca-muted);
  text-align: center;
}

.mail-empty div {
  color: var(--ca-gold-dark);
  font-size: 42px;
}

.mail-empty strong {
  color: var(--ca-text);
  font: 700 17px var(--ca-serif);
}

.mail-empty p,
.mail-error {
  margin: 0;
  font-size: 11px;
}

.mail-error {
  margin-top: 10px;
  color: #ffb7a8;
}

@media (max-width: 759px) {
  .mail-heading {
    padding: 13px;
  }

  .mail-heading h1 {
    font-size: 18px;
  }

  .mail-heading p {
    display: none;
  }

  .mail-layout {
    min-height: 0;
    display: block;
    overflow: visible;
    border: 0;
    background: transparent;
  }

  .mail-list {
    display: flex;
    gap: 7px;
    padding-bottom: 9px;
    overflow-x: auto;
    border: 0;
    background: transparent;
  }

  .mail-list button {
    min-width: 190px;
    border: 1px solid var(--ca-border);
    border-radius: 10px;
    background: var(--ca-surface);
  }

  .mail-list button.active {
    border-color: var(--ca-gold-dark);
    box-shadow: none;
  }

  .letter {
    padding: 12px 0 0;
    overflow: visible;
    background: transparent;
  }

  .letter > header {
    display: block;
  }

  .letter h2 {
    font-size: 18px;
  }

  .letter dl {
    margin-top: 8px;
    text-align: left;
  }

  .letter-paper {
    min-height: 0;
    padding: 24px 18px;
    font-size: 13px;
  }
}
</style>
