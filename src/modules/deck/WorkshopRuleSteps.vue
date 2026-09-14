<script setup lang="ts">
import { ref } from 'vue';
import { RULE_STEPS, RULE_SCOPES, RULE_EVENTS, WORKSHOP_DOT_TYPES, emptyRuleProgram, type RuleStep, type RuleStatus } from '@/workshop-program';
import { WORKSHOP_STATUS_LIBRARY, workshopBuiltinStatus, workshopStatusInput, WORKSHOP_DOT_STACK_HINT } from '@/workshop-status-library';
import WorkshopFormulaEditor from './WorkshopFormulaEditor.vue';
import WorkshopProgramEditor from './WorkshopProgramEditor.vue';
const model=defineModel<RuleStep[]>({required:true});
function duplicate(index:number,step:RuleStep):void {model.value.splice(index+1,0,JSON.parse(JSON.stringify(step)) as RuleStep);}
const props=defineProps<{statuses:RuleStatus[];costs?:boolean}>();
const parameterName=ref('remaining');
function addParameter(step:RuleStep):void {const name=parameterName.value.trim();if(!name||['__proto__','constructor','prototype'].includes(name))return;step.data??={};step.data[name]=0;}
function add(type:string):void {if(!type)return;model.value.push({type,target:props.costs?'self':'target',value:10,...(type==='damage'?{crit:true,mode:'normal',hits:1}:{}),...(type==='delay'?{turns:1,event:'turn_start',mode:'cancel'}:{}),...(type==='card'?{operation:'move',pile:'hand',mode:'hand',count:1}:{}),...(['if','repeat','foreach','delay'].includes(type)?{steps:[],otherwise:[],condition:true}:{}),...(type==='summon'?{program:emptyRuleProgram(),turns:3}:{}),...(type==='native_status'?{status:'taunt',value:1,turns:1,chance:100}:{}),...(type==='dot_spread'?{source:'selected_target',target:{op:'targets',key:'enemies',excludeSelected:true},value:.35,turns:2,maxStacks:3,chance:100,count:1}:{}),...(type==='dot_detonate'?{value:1,mode:'tick',consume:true}:{}),...(type==='apply_status'?{status:'',data:{}}:{}),...(['set','add'].includes(type)?{scope:'local',key:'value'}:{})});}
const costOptions=[['hp','支付生命'],['shield_cost','支付护盾'],['resource_cost','支付资源'],['discard_cost','弃牌代价'],['summon_cost','牺牲召唤物']];
</script>
<template>
  <div class="rule-steps">
    <article v-for="(step,i) in model" :key="i">
      <header><strong>{{ (costs?costOptions:RULE_STEPS).find(([t])=>t===step.type)?.[1]??step.type }}</strong><button v-if="i" type="button" @click="model.splice(i-1,0,model.splice(i,1)[0]!)">上移</button><button type="button" @click="duplicate(i,step)">复制</button><button type="button" @click="model.splice(i,1)">删除</button></header>
      <label v-if="['set','add','resource','resource_cost'].includes(step.type)">数据／资源名<input v-model="step.key" placeholder="例如 remaining；AP填ap"></label>
      <select v-if="['set','add'].includes(step.type)" v-model="step.scope"><option v-for="[k,n] in RULE_SCOPES" :key="k" :value="k">{{ n }}</option></select>
      <label v-if="step.type==='event_set'">事件字段<select v-model="step.field"><option value="amount">当前剩余金额</option><option value="cardCost">本次AP费用</option><option value="count">数量</option><option value="targetId">事件目标</option><option value="cancel">取消事件</option></select></label>
      <WorkshopFormulaEditor v-if="!['set','add','event_set','if','repeat','delay','stop'].includes(step.type)" v-model="step.target!" label="对象" />
      <WorkshopFormulaEditor v-if="!['if','foreach','delay','summon','apply_status','remove_status','stop','remove_unit'].includes(step.type)" v-model="step.value!" :label="step.type==='native_status'?workshopStatusInput(step.status??'').label:'数值'" />
      <WorkshopFormulaEditor v-if="step.type==='if'" v-model="step.condition!" label="条件" />
      <template v-if="['dot_spread','dot_detonate','dot_remove'].includes(step.type)">
        <label>DOT 筛选<select :value="step.dotTypes===undefined?'all':'selected'" @change="step.dotTypes=($event.target as HTMLSelectElement).value==='all'?undefined:[]"><option value="all">全部 DOT</option><option value="selected">指定种类</option></select></label>
        <div v-if="step.dotTypes!==undefined" class="dot-types"><label v-for="dot in WORKSHOP_DOT_TYPES" :key="dot.id"><input v-model="step.dotTypes" type="checkbox" :value="dot.id">{{ dot.name }}</label><p v-if="!step.dotTypes.length">尚未选择种类，此积木不会处理任何 DOT。</p></div>
      </template>
      <template v-if="step.type==='dot_spread'">
        <label v-if="typeof step.source!=='object'">检测来源<select :value="step.source??'selected_target'" @change="step.source=($event.target as HTMLSelectElement).value"><option value="selected_target">本次选中目标</option><option value="target">当前目标（循环中的单位）</option><option value="self">持有者</option><option value="source">施加者</option><option value="event_source">事件发起者</option><option value="event_target">事件目标</option></select></label>
        <WorkshopFormulaEditor v-else v-model="step.source!" label="检测来源" />
        <WorkshopFormulaEditor v-model="step.value!" label="每跳攻击倍率（0.35 = 35%）" />
        <WorkshopFormulaEditor v-model="step.turns!" label="持续回合（正整数，-1 为整场）" />
        <WorkshopFormulaEditor v-model="step.count!" label="每种 DOT 施加层数（正整数）" />
        <WorkshopFormulaEditor v-model="step.maxStacks!" label="可叠加上限（0 为不设上限）" />
        <WorkshopFormulaEditor v-model="step.chance!" label="基础命中率％" />
        <p>只施加检测来源已有且符合筛选的 DOT 种类。按扩散者攻击力和这里的倍率、回合重新施加，各层分别判定命中；原有层保留。倍率不是固定伤害，1 层不等于复制原目标全部层数。</p>
      </template>
      <template v-if="step.type==='dot_detonate'">
        <label>结算方式<select v-model="step.mode"><option value="tick">每层结算一跳</option><option value="remaining">每层结算全部剩余次数</option></select></label>
        <WorkshopFormulaEditor v-model="step.value!" label="原伤害倍率（1 = 100%，不是固定伤害）" />
        <label><input :checked="step.consume!==false" type="checkbox" @change="step.consume=($event.target as HTMLInputElement).checked">清除参与引爆的 DOT</label>
        <p>使用各层保存的原伤害，逐层计算防御和护盾，不暴击、不闪避，也不再次套用卡牌星级。整场 DOT 没有有限的剩余次数，在全部剩余模式下仅结算一跳；保留 DOT 时不扣减原持续回合。</p>
      </template>
      <p v-if="step.type==='dot_remove'">移除符合筛选的所有 DOT 层，包括不可净化的层；其他 Buff 和 Debuff 保留。自定义状态附带的 DOT 被清除后，本份父状态不会自动补回。</p>
      <template v-if="step.type==='native_status'"><label>复用效果<select v-model="step.status" @change="step.value=WORKSHOP_STATUS_LIBRARY.find(s=>s.id===step.status)?.value??1;if(workshopBuiltinStatus(step.status??'')?.kind==='dot')step.maxStacks??=3"><option v-for="s in WORKSHOP_STATUS_LIBRARY" :key="s.id" :value="s.id">{{ s.name }} · {{ s.polarity }}</option></select></label><WorkshopFormulaEditor v-model="step.chance!" label="基础命中率％" /></template>
      <template v-if="step.type==='native_status'">
        <p v-if="workshopStatusInput(step.status??'').hint">{{ workshopStatusInput(step.status??'').hint }}</p>
        <template v-if="workshopBuiltinStatus(step.status??'')?.kind==='dot'">
          <WorkshopFormulaEditor :model-value="step.maxStacks??3" label="可叠加上限（0 为不设上限）" @update:model-value="step.maxStacks=$event" />
          <p>{{ WORKSHOP_DOT_STACK_HINT }}</p>
        </template>
      </template>
      <label v-if="['apply_status','remove_status'].includes(step.type)">状态<select v-model="step.status"><option v-if="step.type==='remove_status'" value="self">此状态自身</option><option v-for="s in statuses" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
      <template v-if="step.type==='apply_status'">
        <label v-for="(_,key) in step.data" :key="key">传入 {{ key }}<WorkshopFormulaEditor v-model="step.data![key]!" /></label>
        <input v-model="parameterName" placeholder="数据名称"><button type="button" @click="addParameter(step)">＋传入数据</button>
      </template>
      <template v-if="['native_status','delay','summon'].includes(step.type)"><WorkshopFormulaEditor v-model="step.turns!" :label="step.type==='native_status'?'持续回合（正整数，-1 为整场）':'回合数'" /></template>
      <template v-if="step.type==='delay'"><label><input v-model="step.snapshot" type="checkbox">锁定安排时的数值</label><select v-model="step.event"><option v-for="[k,n] in RULE_EVENTS" :key="k" :value="k">{{ n }}</option></select><select v-model="step.mode"><option value="cancel">原目标失效时取消</option><option value="retarget">原目标失效时重选</option></select></template>
      <template v-if="['damage','heal','shield'].includes(step.type)">
        <label>伤害处理<select v-model="step.mode"><option value="normal">正常结算</option><option value="recorded">使用已结算金额</option></select></label>
        <WorkshopFormulaEditor v-if="step.type==='damage'" v-model="step.hits!" label="攻击段数" /><label v-if="step.type==='damage'">可以暴击<input v-model="step.crit" type="checkbox"></label>
        <button v-if="!step.stars" type="button" @click="step.stars=[1,1.1,1.2]">设置一至三星系数</button><label v-for="(_,index) in step.stars" :key="index">{{ index+1 }}星<input v-model.number="step.stars![index]" type="number" step="any"></label>
      </template>
      <template v-if="['card','discard'].includes(step.type)">
        <WorkshopFormulaEditor v-if="step.type==='card'" v-model="step.count!" label="卡牌数量" /><label>牌堆<select v-model="step.pile"><option value="hand">手牌</option><option value="deck">抽牌堆</option><option value="discard">弃牌堆</option><option value="exhaust">移出牌</option></select></label><input v-model="step.key" placeholder="卡牌编号／标签（可留空）">
        <select v-if="step.type==='card'" v-model="step.operation"><option value="move">移动</option><option value="copy">复制</option><option value="cost">修改费用</option><option value="transform">变形</option><option value="generate">生成指定卡</option><option value="exhaust">移出循环</option></select>
        <select v-model="step.mode"><option value="hand">放入手牌</option><option value="deck">放入抽牌堆</option><option value="discard">放入弃牌堆</option><option value="exhaust">移出循环</option></select>
      </template>
      <template v-if="step.type==='summon'"><input v-model="step.name" placeholder="召唤物名称"><button v-if="!step.inherit" type="button" @click="step.inherit={hp:.3,attack:.7,defense:.5,speed:1}">设置继承比例</button><label v-for="(_,key) in step.inherit" :key="key">{{ key }} 倍率（0.5 = 50%）<input v-model.number="step.inherit![key]" type="number" step=".1"></label><WorkshopProgramEditor v-if="step.program" v-model="step.program" nested /></template>
      <label v-if="!costs">保存结果为<input v-model="step.saveAs" placeholder="可留空"></label>
      <template v-if="step.steps"><WorkshopRuleSteps v-model="step.steps" :statuses="statuses" /><details v-if="step.otherwise"><summary>否则／目标失效时</summary><WorkshopRuleSteps v-model="step.otherwise" :statuses="statuses" /></details></template>
    </article>
    <select value="" @change="add(($event.target as HTMLSelectElement).value);($event.target as HTMLSelectElement).value=''">
      <option value="">＋添加{{ costs?'代价':'积木' }}</option><option v-for="[k,n] in (costs?costOptions:RULE_STEPS)" :key="k" :value="k">{{ n }}</option>
    </select>
  </div>
</template>
<style scoped>
.rule-steps{display:grid;gap:9px;min-width:0}.rule-steps article{padding:10px;border-left:3px solid #baa476;border-radius:6px;background:#ffffff08;display:grid;gap:8px}.rule-steps header{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.rule-steps header strong{margin-right:auto}input,select,button{font:inherit;color:inherit;background:#1d2530;border:1px solid #a68d5960;border-radius:5px;padding:6px;max-width:100%;box-sizing:border-box}label{display:flex;gap:6px;flex-wrap:wrap}label input[type=number]{width:80px}
</style>
