<script setup lang="ts">
/* global setInterval, clearInterval */
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import type {PanelContext} from '@/kernel/public-api';
import {commandId} from '@/kernel/ids';
import {CARRIAGES, type CarriageTier, type FreightView} from '@/market-freight';
const props=defineProps<{context:PanelContext}>();
const emit=defineEmits<{updated:[]}>();
const data=ref<FreightView>(), region=ref(''), direction=ref<'buy'|'sell'>('buy'), search=ref(''), compareSearch=ref('');
const quantities=ref<Record<string,number>>({}), fleet=ref<string[]>([]), selectedCarriages=ref<string[]>([]);
const busy=ref(false),notice=ref(''),now=ref(Date.now()),showPrices=ref(false);
let mounted=false;
let timer:ReturnType<typeof setInterval>|undefined,dispose:(()=>void)|undefined,refreshing:Promise<void>|undefined;
const quote=computed(()=>data.value?.regions.find(r=>r.regionId===region.value));
const occupied=computed(()=>new Set(data.value?.state.jobs.filter(j=>!j.deliveredAt).flatMap(j=>j.carriageIds)??[]));
const available=computed(()=>data.value?.state.carriages.filter(c=>data.value?.state.equippedIds.includes(c.id)&&!occupied.value.has(c.id))??[]);
const capacity=computed(()=>available.value.filter(c=>selectedCarriages.value.includes(c.id)).reduce((n,c)=>n+CARRIAGES[c.tier].capacity,0));
const rows=computed(()=>{
  if(!quote.value) return [];
  return direction.value==='buy'?quote.value.listings.filter(l=>l.stock>0).map(l=>({key:l.key,name:l.name,price:l.price,max:l.kind==='item'?l.stock:1,detail:l.detail})):
    [...quote.value.sellItems.map(i=>({key:'item:'+i.itemId,name:i.name,price:i.price,max:i.quantity,detail:i.detail})),...quote.value.sellEquipment.map(i=>({key:'equipment:'+i.instanceId,name:i.name,price:i.price,max:1,detail:i.description}))];
});
const visibleRows=computed(()=>rows.value.filter(r=>r.name.includes(search.value.trim())));
const basket=computed(()=>rows.value.filter(r=>(quantities.value[r.key]??0)>0).map(r=>({...r,quantity:quantities.value[r.key]??0})));
const units=computed(()=>basket.value.reduce((n,r)=>n+r.quantity,0));
const value=computed(()=>basket.value.reduce((n,r)=>n+r.price*r.quantity,0));
const payable=computed(()=>(data.value?.nextFee??0)+(direction.value==='buy'?value.value:0));
const priceRows=computed(()=>data.value?.regions.flatMap(r=>r.prices.filter(p=>p.name.includes(compareSearch.value.trim())).map(p=>({...p,region:r.regionId})))??[]);
watch([region,direction],()=>{quantities.value={};});
function refresh():Promise<void> {
  if(refreshing) return refreshing;
  refreshing=(async()=>{
    try {
      const next=await props.context.api.query('freight'); if(!mounted) return; data.value=next;
      if(!region.value) region.value=next.regions.find(r=>r.regionId!==next.regionId)?.regionId??'';
      fleet.value=[...next.state.equippedIds];
      const free=next.state.carriages.filter(c=>next.state.equippedIds.includes(c.id)&&!next.state.jobs.some(j=>!j.deliveredAt&&j.carriageIds.includes(c.id)));
      selectedCarriages.value=free.map(c=>c.id);
      emit('updated');
    } catch(e) {notice.value=e instanceof Error?e.message:String(e);}
  })().finally(()=>{refreshing=undefined;});
  return refreshing;
}
async function act(type:string,payload:unknown,message:string) {
  if(busy.value) return;
  busy.value=true;notice.value='';
  try {
    const result=await props.context.api.execute({id:commandId(type),type,payload});
    if(result.status==='rejected') throw new Error(result.message);
    quantities.value={};await refresh();notice.value=message;
  } catch(e) {notice.value=e instanceof Error?e.message:String(e);await refresh();}
  finally {busy.value=false;}
}
function buyCarriage(tier:CarriageTier) {return act('market.carriage-buy',{tier},'已购入'+CARRIAGES[tier].name);}
function saveFleet() {return act('market.freight-fleet',{carriageIds:fleet.value},'马车编队已保存。');}
function dispatch() {
  if(!quote.value) return;
  return act('market.freight-dispatch',{regionId:region.value,direction:direction.value,refreshKey:quote.value.refreshKey,carriageIds:selectedCarriages.value,rows:basket.value.map(r=>({key:r.key,quantity:r.quantity}))},'货运已出发，10分钟后自动交付。');
}
function remaining(at:number) {const seconds=Math.max(0,Math.ceil((at-now.value)/1000));return Math.floor(seconds/60)+'分'+seconds%60+'秒';}
onMounted(async()=>{
  mounted=true;await refresh();if(!mounted) return;
  dispose=props.context.api.on('state.changed',()=>{void refresh();});
  timer=setInterval(()=>{
    now.value=Date.now();
    if(data.value&&(now.value>=data.value.nextResetAt||data.value.state.jobs.some(j=>!j.deliveredAt&&j.arrivesAt<=now.value)||now.value>=(data.value.regions[0]?.nextRefreshAt??Infinity))) void refresh();
  },1000);
});
onUnmounted(()=>{mounted=false;if(timer) clearInterval(timer);dispose?.();});
</script>
<template>
  <section class="freight">
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="!data">正在读取跨城报价和马车……</p>
    <template v-else>
      <header>
        <h2>跨城货运</h2><p>今日已发车 {{ data.state.dispatchCount }} 次 · 下次运费 {{ data.nextFee }} 金币 · 持有 {{ data.gold }} 金币</p>
        <p>每日前三次免费，第四次500、第五次1000、第六次起2000金币。按设备时区零点重置；每次运输10分钟，关闭页面继续计时。</p>
      </header>
      <details>
        <summary>马车与编队 · 已装配 {{ data.state.equippedIds.length }}/6 辆</summary>
        <div class="carriage-shop">
          <button v-for="(spec,tier) in CARRIAGES" :key="tier" class="ca-button" :disabled="busy || data.gold < spec.price" @click="buyCarriage(tier)">
            购买{{ spec.name }} · 容量{{ spec.capacity }} · {{ spec.price }}金币
          </button>
        </div>
        <div class="fleet">
          <label v-for="(carriage,index) in data.state.carriages" :key="carriage.id">
            <input v-model="fleet" type="checkbox" :value="carriage.id" :disabled="busy || occupied.has(carriage.id) || (!fleet.includes(carriage.id) && fleet.length >= 6)" />
            {{ index + 1 }}号 {{ CARRIAGES[carriage.tier].name }} · {{ CARRIAGES[carriage.tier].capacity }}件 {{ occupied.has(carriage.id) ? '（运输中）' : '' }}
          </label>
        </div><button class="ca-button" :disabled="busy" @click="saveFleet">保存编队</button>
      </details>
      <details :open="showPrices" @toggle="showPrices = ($event.target as HTMLDetailsElement).open">
        <summary>查看所有地区当前买价与售价</summary>
        <input v-model="compareSearch" placeholder="按物品名字比较各城价格" aria-label="搜索全地区报价" />
        <p>买价为玩家购入价，售价为玩家售出价；“—”表示当前不出售或不支持回收。库存随集市刷新。</p>
        <div v-if="showPrices" class="table-scroll">
          <table>
            <thead><tr><th>地区</th><th>物品</th><th>买价</th><th>售价</th><th>库存</th></tr></thead>
            <tbody><tr v-for="row in priceRows" :key="row.region + row.key"><td>{{ row.region }}</td><td>{{ row.name }}</td><td>{{ row.buy ?? '—' }}</td><td>{{ row.sell ?? '—' }}</td><td>{{ row.stock }}</td></tr></tbody>
          </table>
        </div>
      </details>
      <div class="controls">
        <label>交易地区<select v-model="region" :disabled="busy"><option v-for="r in data.regions" :key="r.regionId" :value="r.regionId">{{ r.regionId }}{{ r.regionId === data.regionId ? '（当前地区）' : '' }}</option></select></label>
        <label>货运类型<select v-model="direction" :disabled="busy"><option value="buy">跨城购买</option><option value="sell">跨城出售</option></select></label>
        <input v-model="search" placeholder="搜索本次货物" aria-label="搜索货运商品" />
      </div>
      <div class="fleet"><label v-for="c in available" :key="c.id"><input v-model="selectedCarriages" type="checkbox" :value="c.id" :disabled="busy" />{{ (data.state.carriages.findIndex(x=>x.id===c.id))+1 }}号{{ CARRIAGES[c.tier].name }} · {{ CARRIAGES[c.tier].capacity }}件</label></div>
      <p v-if="!available.length">没有空闲的已装配马车，请等待到货或调整编队。</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>货物</th><th>单价</th><th>{{ direction === 'buy' ? '库存' : '持有' }}</th><th>装车数量</th></tr></thead>
          <tbody><tr v-for="r in visibleRows" :key="r.key"><td :title="r.detail">{{ r.name }}</td><td>{{ r.price }}</td><td>{{ r.max }}</td><td><input v-model.number="quantities[r.key]" type="number" min="0" :max="r.max" step="1" :disabled="busy" :aria-label="r.name + '装车数量'" placeholder="0" /></td></tr></tbody>
        </table><p v-if="!visibleRows.length">没有符合条件的货物</p>
      </div>
      <div class="order">
        <p>混装货物 {{ units }}/{{ capacity }} 件 · {{ direction === 'buy' ? '货款' : '到货后获得' }} {{ value }} 金币 · 运费 {{ data.nextFee }} 金币</p>
        <p v-if="basket.length">货单：{{ basket.map(r=>r.name+' ×'+r.quantity).join('、') }}</p>
        <button class="ca-button primary" :disabled="busy || units < 1 || units > capacity || !selectedCarriages.length || payable > data.gold || region === data.regionId || basket.some(r=>!Number.isInteger(r.quantity) || r.quantity > r.max)" @click="dispatch">
          {{ busy ? '处理中……' : '支付' + payable + '金币并发车' }}
        </button><span v-if="region === data.regionId">跨城货运需选择其他地区。</span>
      </div>
      <h3>运输记录</h3><p v-if="!data.state.jobs.length">暂无货运记录</p>
      <article v-for="job in [...data.state.jobs].reverse()" :key="job.id" class="job">
        <strong>{{ job.direction === 'buy' ? '购自' : '售往' }}{{ job.regionId }} · {{ job.cargo.reduce((n,c)=>n+c.quantity,0) }}件</strong>
        <span>{{ job.deliveredAt ? '已交付' : '运输中 · '+remaining(job.arrivesAt) }}</span>
        <small>{{ job.cargo.map(c=>c.listing.name+' ×'+c.quantity).join('、') }} · 运费{{ job.fee }}金币{{ job.direction === 'sell' ? ' · 货款'+job.saleGold+'金币' : '' }}{{ job.refund ? ' · 已拥有的藏品已退还'+job.refund+'金币' : '' }}</small>
      </article>
    </template>
  </section>
</template>
<style scoped>
.freight {display:grid;gap:14px;color:var(--ca-text);}
h2,h3 {margin:0;color:var(--ca-gold-light);} p {font-size:12px;line-height:1.7;margin:6px 0;}
details,.order,.job {padding:14px;border:1px solid var(--ca-border);border-radius:10px;background:var(--ca-surface);}
summary {cursor:pointer;color:var(--ca-gold-light);margin-bottom:8px;}
.controls,.fleet,.carriage-shop {display:flex;flex-wrap:wrap;gap:10px;align-items:center;}
.controls label {display:grid;gap:5px;flex:1;} .fleet label {display:flex;gap:5px;align-items:center;font-size:12px;}
input:not([type=checkbox]),select {box-sizing:border-box;max-width:100%;padding:8px;border:1px solid var(--ca-border);border-radius:7px;background:var(--ca-surface);color:var(--ca-text);}
.table-scroll {max-height:430px;overflow:auto;border:1px solid var(--ca-border);border-radius:8px;}
table {width:100%;border-collapse:collapse;font-size:12px;} th,td {text-align:left;padding:9px;border-bottom:1px solid var(--ca-border);}
th {position:sticky;top:0;background:var(--ca-surface);} td input {width:72px;}
.job {display:grid;gap:6px;} .job small {color:var(--ca-muted);} .notice {padding:10px;border:1px solid var(--ca-gold);}
</style>
