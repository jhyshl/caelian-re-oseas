<script setup lang="ts">
/* global Window, HTMLElement, PointerEvent, KeyboardEvent */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { IMPERIAL_FACTIONS, IMPERIAL_HEIRS } from '@/imperial/constants';
import { type ImperialNotice, type ImperialState } from '@/imperial/model';
import ImperialFact from './ImperialFact.vue';
import { playerText } from '@/imperial/display';
import { clampLauncherPosition } from '@/modules/shell/floating-position';

const props = defineProps<{ host: Window; view: {profileKey:string;visible:boolean;state:ImperialState|null;notices:ImperialNotice[];playerName?:string;busy?:boolean} }>();
const emit = defineEmits<{ dismiss: []; reroll: [] }>();
const playerName = computed(() => props.view.playerName || '玩家');
const expanded = ref(false), sleeping = ref(false), position = ref({ x: 16, y: 160 });
const tab = ref('局势');
const tabs = ['局势', '皇室', '势力', '继承'];
let idle: number | undefined;
let drag: {id:number;x:number;y:number;startX:number;startY:number;moved:boolean;target:HTMLElement} | undefined;
let suppressClick = false;
const currentNotice = computed(() => props.view.notices[0]);
const storageKey = () => `caelian:imperial:launcher:${props.view.profileKey}`;
function clamp() {
  const viewport = props.host.visualViewport;
  position.value = clampLauncherPosition(position.value, {
    width: viewport?.width ?? props.host.innerWidth, height: viewport?.height ?? props.host.innerHeight,
    offsetLeft: viewport?.offsetLeft ?? 0, offsetTop: viewport?.offsetTop ?? 0,
  }, 56);
}
function wake() {
  sleeping.value = false;
  if (idle !== undefined) props.host.clearTimeout(idle);
  idle = props.host.setTimeout(() => { if (!expanded.value && !drag) sleeping.value = true; }, 5000);
}
function down(event: PointerEvent) {
  if (event.button !== 0) return;
  const target = event.currentTarget as HTMLElement;
  drag = { id:event.pointerId,x:event.clientX,y:event.clientY,startX:position.value.x,startY:position.value.y,moved:false,target };
  target.setPointerCapture?.(event.pointerId); wake();
}
function move(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return;
  const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  if (Math.hypot(dx,dy)>5) drag.moved=true;
  if (!drag.moved) return;
  position.value={x:drag.startX+dx,y:drag.startY+dy};clamp();
}
function up(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return;
  suppressClick=drag.moved;
  if (drag.target.hasPointerCapture?.(event.pointerId)) drag.target.releasePointerCapture(event.pointerId);
  drag=undefined;
  try { props.host.localStorage.setItem(storageKey(),JSON.stringify(position.value)); } catch { /* position still works in this session */ }
  wake();
}
function toggle() { if(suppressClick){suppressClick=false;return;} expanded.value=!expanded.value;wake(); }
function close() {expanded.value=false;wake();}
function dismissNotice() {emit('dismiss');}
function keydown(event: KeyboardEvent) { if(event.key==='Escape'){if(currentNotice.value)dismissNotice();else close();} }
watch(() => [props.view.profileKey,props.view.visible], () => {
  expanded.value=false;drag=undefined;suppressClick=false;
  try {const raw=JSON.parse(props.host.localStorage.getItem(storageKey())??'null');position.value=raw&&Number.isFinite(raw.x)&&Number.isFinite(raw.y)?raw:{x:16,y:160};}catch{position.value={x:16,y:160};}
  clamp();wake();
}, {immediate:true});
props.host.addEventListener('resize',clamp);
props.host.visualViewport?.addEventListener('resize',clamp);
props.host.document.addEventListener('keydown',keydown);
onBeforeUnmount(()=>{if(idle!==undefined)props.host.clearTimeout(idle);props.host.removeEventListener('resize',clamp);props.host.visualViewport?.removeEventListener('resize',clamp);props.host.document.removeEventListener('keydown',keydown);});
</script>

<template>
  <button v-if="view.visible" class="imperial-launcher" :class="{sleeping}" :style="{left:`${position.x}px`,top:`${position.y}px`}" type="button" aria-label="皇权局势，拖动可调整位置" :aria-expanded="expanded" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @pointerenter="wake" @focus="wake" @click="toggle">
    <span aria-hidden="true">♛</span><small>皇权局势</small><i v-if="view.state?.revision" class="imperial-live-dot" aria-label="已有局势记录"></i>
  </button>
  <section v-if="view.visible && expanded && view.state" class="imperial-panel" role="dialog" aria-label="动荡的皇权状态栏">
    <header><div><small>IMPERIAL SUCCESSION</small><h2>动荡的皇权</h2></div><button type="button" aria-label="收起皇权状态栏" @click="close">×</button></header>
    <div class="imperial-tools"><span>◉ 已知 · ◉̸ 幕后情报</span><button type="button" :disabled="view.busy" @click="emit('reroll')">{{ view.busy ? '正在更新…' : '↻ 重Roll本楼状态栏' }}</button></div>
    <nav class="imperial-tabs" aria-label="局势板块"><button v-for="name in tabs" :key="name" type="button" :aria-pressed="tab === name" @click="tab = name">{{ name }}</button></nav>
    <div class="imperial-scroll">
      <p class="imperial-caption">{{ view.state.updatedAt ? '局势已更新' : '等待下一轮剧情' }} · 面板中的幕后情报不代表 {{ playerName }} 已知</p>
      <template v-if="tab === '局势'">
        <h3>{{ playerName }}当前势力</h3>
        <div class="imperial-support"><article v-for="name in IMPERIAL_FACTIONS" :key="name"><span>{{ name }}</span><b>{{ view.state.support[name].value ?? '待确认' }}<small v-if="view.state.support[name].value !== null"> / 100</small></b><progress v-if="view.state.support[name].value !== null" :value="view.state.support[name].value ?? 0" max="100" :aria-label="`${name}支持度`"></progress></article></div>
        <h3>当前事件（{{ playerName }}视角）</h3><p><ImperialFact :fact="view.state.currentEvent" :player-name="playerName" /></p>
        <h3>{{ playerName }}阵营</h3><p class="imperial-camp">{{ playerText(view.state.playerCamp, playerName) }}<small v-if="view.state.playerClaimingThrone">争位中</small></p>
        <p v-if="view.state.campEvidence" class="imperial-caption">{{ playerText(view.state.campEvidence, playerName) }}</p>
        <h3>重大进展播报</h3><article v-for="(notice,index) in view.state.majorProgress ?? []" :key="index" class="imperial-card imperial-notice"><b>{{ playerText(notice.title, playerName) }}</b><p>{{ playerText(notice.detail, playerName) }}</p></article><p v-if="!view.state.majorProgress?.length">本轮暂无新增播报</p>
      </template>
      <template v-if="tab === '皇室'">
        <h3>皇室</h3>
        <details v-for="name in IMPERIAL_HEIRS" :key="name" class="imperial-card" open><summary>{{ name }}</summary><dl><dt>当前计划</dt><dd><ImperialFact :fact="view.state.royals[name].plan" :player-name="playerName" /></dd><dt>当前行动</dt><dd><ImperialFact :fact="view.state.royals[name].action" :player-name="playerName" /></dd><dt>下一步措施</dt><dd><ImperialFact :fact="view.state.royals[name].next" :player-name="playerName" /></dd><dt>过往行踪</dt><dd><ul v-if="view.state.royals[name].history.length"><li v-for="(item,index) in view.state.royals[name].history" :key="index">{{ item.at }} · <ImperialFact :fact="item" :player-name="playerName" /></li></ul><span v-else>暂无记录</span></dd></dl></details>
        <details class="imperial-card"><summary>莱奥尼达斯</summary><dl><dt>当前状态</dt><dd><ImperialFact :fact="view.state.emperor.status" :player-name="playerName" /></dd><dt>当前动向</dt><dd><ImperialFact :fact="view.state.emperor.movement" :player-name="playerName" /></dd></dl></details>
      </template>
      <template v-if="tab === '势力'">
        <h3>各势力</h3>
        <details v-for="name in IMPERIAL_FACTIONS" :key="name" class="imperial-card" open><summary>{{ name }}</summary><dl><dt>当前动向</dt><dd><ImperialFact :fact="view.state.factions[name].movement" :player-name="playerName" /></dd><dt>立场倾向</dt><dd><ImperialFact :fact="view.state.factions[name].stance" :player-name="playerName" /></dd><dt>内部成员分歧</dt><dd><ImperialFact :fact="view.state.factions[name].divisions" :player-name="playerName" /></dd></dl></details>
      </template>
      <template v-if="tab === '继承'">
        <h3>当前皇位继承可能性</h3><p class="imperial-caption">当前趋势，不代表必然结局 · 候选人合计 100%</p>
        <article v-for="candidate in view.state.successionLikelihood ?? []" :key="candidate.name" class="imperial-likelihood"><div><b>{{ playerText(candidate.name, playerName) }}</b><strong>{{ candidate.value }}%</strong></div><progress :value="candidate.value" max="100" :aria-label="`${candidate.name}继承可能性`"></progress><p><ImperialFact :fact="candidate.reason" :player-name="playerName" /></p></article>
        <p v-if="!view.state.successionLikelihood?.length">等待副 API 结合当前局势评估</p>
        <h3>皇位继承结果</h3><p>{{ view.state.winner ? `${playerText(view.state.winner, playerName)}已正式继承皇位` : '尚未有人继承皇位' }}</p>
      </template>
    </div>
  </section>
  <div v-if="currentNotice" class="imperial-bulletin-backdrop">
    <section class="imperial-bulletin" role="alertdialog" aria-modal="true" aria-labelledby="imperial-bulletin-title">
      <small>局势快报 · {{ currentNotice.faction }}</small><h2 id="imperial-bulletin-title">{{ playerText(currentNotice.title, playerName) }}</h2><p>{{ playerText(currentNotice.detail, playerName) }}</p><button type="button" @click="dismissNotice">{{ view.notices.length > 1 ? '下一条' : '知晓了' }}</button>
    </section>
  </div>
</template>

<style scoped>
.imperial-tools{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 16px 0;font-size:11px;color:#a9a1b6}.imperial-tools button{background:#b08c5222;color:#f2d89b;border:1px solid #b08c52;border-radius:8px;padding:7px 10px;cursor:pointer}.imperial-tools button:disabled{opacity:.5;cursor:wait}
.imperial-tabs{display:flex;padding:10px 16px 0;gap:6px;flex-shrink:0}.imperial-tabs button{flex:1;border:1px solid #ffffff18;border-radius:9px;padding:8px 0;color:#c3b9ce;background:#ffffff05;cursor:pointer}.imperial-tabs button[aria-pressed=true]{color:#f2d89b;border-color:#b08c52;background:#b08c5222}.imperial-live-dot{position:absolute;right:5px;top:5px;background:#e8bf6b;border-radius:50%;width:7px;height:7px}.imperial-camp{border-left:3px solid #c7a05e;padding-left:12px}.imperial-camp small{margin-left:12px;color:#deb871}.imperial-notice{padding:12px}.imperial-likelihood{padding:14px 0;border-bottom:1px solid #ffffff18}.imperial-likelihood>div{display:flex;justify-content:space-between;font-size:14px}.imperial-likelihood strong{color:#e9c779}.imperial-likelihood progress{width:100%;height:6px;accent-color:#c7a05e}.imperial-scroll{min-height:0}
.imperial-launcher,.imperial-panel,.imperial-bulletin{box-sizing:border-box;color:#f6eddd;font-family:system-ui,"Microsoft YaHei",sans-serif;line-height:1.6}
.imperial-launcher{position:fixed;z-index:2147483646;width:56px;height:56px;border:1px solid #c9a765;border-radius:18px;background:linear-gradient(145deg,#382534,#171521);box-shadow:0 6px 24px #0006;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:grab;touch-action:none;user-select:none;transition:opacity .3s}
.imperial-launcher span{font-size:26px;line-height:1}.imperial-launcher small{font-size:11px}.imperial-launcher.sleeping{opacity:.45}.imperial-launcher:focus-visible{outline:3px solid #e9c779;outline-offset:3px}
.imperial-panel{position:fixed;z-index:2147483647;right:18px;top:max(18px,env(safe-area-inset-top));width:min(440px,calc(100vw - 24px));max-height:calc(100dvh - 36px);background:#191722;border:1px solid #ab8a52;border-radius:20px;box-shadow:0 20px 70px #0009;display:flex;flex-direction:column;overflow:hidden}
.imperial-panel header{padding:18px 20px;background:linear-gradient(120deg,#352533,#232132);display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ffffff18}.imperial-panel header small{font-size:10px;color:#d1b47f;letter-spacing:2px}.imperial-panel h2{font-size:21px;margin:2px 0}.imperial-panel header button{color:inherit;background:none;border:0;font-size:28px;cursor:pointer;padding:0 8px}.imperial-scroll{overflow:auto;overscroll-behavior:contain;padding:6px 20px 24px}.imperial-scroll h3{font-size:14px;color:#d8be8d;margin:22px 0 10px}.imperial-scroll p{font-size:13px;margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}.imperial-caption{color:#a6a0b2;font-size:11px!important}.imperial-support{display:grid;grid-template-columns:1fr 1fr;gap:10px}.imperial-support article{background:#ffffff07;border:1px solid #ffffff13;border-radius:12px;padding:10px 12px;display:flex;flex-wrap:wrap;gap:4px;width:auto}.imperial-support span{width:100%;font-size:12px;color:#bbb4c6}.imperial-support b{font-size:20px;color:#efdcba}.imperial-support b small{font-size:11px;color:#a69fae}.imperial-support progress{width:100%;height:5px;accent-color:#c4a05e}
.imperial-card{border:1px solid #ffffff16;background:#ffffff04;border-radius:10px;margin:8px 0}.imperial-card summary{padding:10px 12px;cursor:pointer;font-size:14px}.imperial-card dl{padding:0 12px 10px;margin:0}.imperial-card dt{font-size:11px;color:#c5ac81;margin-top:10px}.imperial-card dd{margin:3px 0;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}.imperial-card ul{margin:0;padding-left:17px}
.imperial-bulletin-backdrop{position:fixed;inset:0;z-index:2147483647;background:#08071088;display:grid;place-items:center;padding:18px}.imperial-bulletin{width:min(440px,100%);max-height:85dvh;overflow:auto;border:1px solid #c7a05e;border-radius:20px;padding:28px;background:linear-gradient(150deg,#352533,#171622);box-shadow:0 25px 80px #0008}.imperial-bulletin small{color:#cfb279;letter-spacing:1px}.imperial-bulletin h2{font-size:23px;margin:12px 0}.imperial-bulletin p{font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}.imperial-bulletin button{float:right;color:#251c25;background:#d9bc80;border:0;border-radius:10px;padding:10px 22px;font-weight:600;cursor:pointer}
@media(max-width:600px){.imperial-panel{right:12px;top:12px;max-height:calc(100dvh - 24px)}.imperial-scroll{padding:6px 16px 20px}}
</style>
