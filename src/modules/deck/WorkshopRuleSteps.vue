<script setup lang="ts">
import WorkshopObjectSelect from './WorkshopObjectSelect.vue';
import { ref } from 'vue';
import { RULE_STEPS, RULE_SCOPES, RULE_EVENTS, emptyRuleProgram, type RuleStep, type RuleStatus } from '@/workshop-program';
import { WORKSHOP_STATUS_LIBRARY, workshopBuiltinStatus, workshopStatusInput, WORKSHOP_DOT_STACK_HINT } from '@/workshop-status-library';
import WorkshopFormulaEditor from './WorkshopFormulaEditor.vue';
import WorkshopProgramEditor from './WorkshopProgramEditor.vue';
const model=defineModel<RuleStep[]>({required:true});
function duplicate(index:number,step:RuleStep):void {model.value.splice(index+1,0,JSON.parse(JSON.stringify(step)) as RuleStep);}
const props=defineProps<{statuses:RuleStatus[];costs?:boolean}>();
const parameterName=ref('remaining');
function addParameter(step:RuleStep):void {const name=parameterName.value.trim();if(!name||['__proto__','constructor','prototype'].includes(name))return;step.data??={};step.data[name]=0;}
function add(type:string):void {if(!type)return;model.value.push({type,target:props.costs?'self':'target',value:10,...(type==='damage'?{crit:true,mode:'normal',hits:1}:{}),...(type==='delay'?{turns:1,event:'turn_start',mode:'cancel'}:{}),...(type==='card'?{operation:'move',pile:'hand',mode:'hand',count:1}:{}),...(['if','repeat','foreach','foreach_item','delay'].includes(type)?{steps:[],otherwise:[],condition:true}:{}),...(type==='summon'?{program:emptyRuleProgram(),turns:3}:{}),...(type==='native_status'?{status:'taunt',value:1,turns:1,chance:100}:{}),...(type==='foreach_item'?{value:{op:'statuses',key:'dot',target:'selected_target'}}:{}),...(['modify_status','copy_status'].includes(type)?{selection:{op:'statuses',key:'dot',target:'selected_target'}}:{}),...(type==='modify_status'?{field:'remaining',operation:'add',value:1}:{}),...(type==='copy_status'?{operation:'copy',preserveSource:true}:{}),...(type==='apply_status'?{status:'',data:{}}:{}),...(['set','add'].includes(type)?{scope:'local',key:'value'}:{})});}
const costOptions=[['hp','支付生命'],['shield_cost','支付护盾'],['resource_cost','支付资源'],['discard_cost','弃牌代价'],['summon_cost','牺牲召唤物']];
</script>
<template>
  <div class="rule-steps">
    <article v-for="(step,i) in model" :key="i">
      <header><strong>{{ (costs?costOptions:RULE_STEPS).find(([t])=>t===step.type)?.[1]??step.type }}</strong><button v-if="i" type="button" @click="model.splice(i-1,0,model.splice(i,1)[0]!)">上移</button><button type="button" @click="duplicate(i,step)">复制</button><button type="button" @click="model.splice(i,1)">删除</button></header>
      <label v-if="['set','add'].includes(step.type)">数据名<input v-model="step.key" placeholder="例如 remaining"></label><label v-if="['resource','resource_cost'].includes(step.type)">资源<WorkshopObjectSelect v-model="step.key" kind="resources" /></label>
      <select v-if="['set','add'].includes(step.type)" v-model="step.scope"><option v-for="[k,n] in RULE_SCOPES" :key="k" :value="k">{{ n }}</option></select>
      <label v-if="step.type==='event_set'">事件字段<select v-model="step.field"><option value="amount">当前剩余金额</option><option value="cardCost">本次AP费用</option><option value="count">数量</option><option value="targetId">事件目标</option><option value="cancel">取消事件</option></select></label>
      <WorkshopFormulaEditor v-if="!['set','add','event_set','if','repeat','foreach_item','delay','modify_status','stop'].includes(step.type)" v-model="step.target!" label="对象" />
      <WorkshopFormulaEditor v-if="!['if','foreach','delay','summon','apply_status','remove_status','stop','remove_unit','copy_status'].includes(step.type)" v-model="step.value!" :label="step.type==='foreach_item'?'遍历列表':step.type==='native_status'?(step.statusFrom===undefined?workshopStatusInput(step.status??'').label:'效果数值（DOT 为攻击倍率，例如 0.35 = 35%）'):'数值'" />
      <WorkshopFormulaEditor v-if="step.type==='if'" v-model="step.condition!" label="条件" />
      <template v-if="step.type==='native_status'"><label><input :checked="step.statusFrom!==undefined" type="checkbox" @change="step.statusFrom=($event.target as HTMLInputElement).checked?{op:'item',key:'type'}:undefined">按公式选择效果种类</label><WorkshopFormulaEditor v-if="step.statusFrom!==undefined" v-model="step.statusFrom" label="效果种类" /><label v-else>复用效果<select v-model="step.status" @change="step.value=WORKSHOP_STATUS_LIBRARY.find(s=>s.id===step.status)?.value??1;if(workshopBuiltinStatus(step.status??'')?.kind==='dot')step.maxStacks??=3"><option v-for="s in WORKSHOP_STATUS_LIBRARY" :key="s.id" :value="s.id">{{ s.name }} · {{ s.id }} · {{ s.polarity }}</option></select></label><WorkshopFormulaEditor v-model="step.chance!" label="基础命中率％" /></template>
      <template v-if="step.type==='native_status'">
        <p v-if="workshopStatusInput(step.status??'').hint">{{ workshopStatusInput(step.status??'').hint }}</p>
        <template v-if="step.statusFrom!==undefined||workshopBuiltinStatus(step.status??'')?.kind==='dot'">
          <WorkshopFormulaEditor :model-value="step.maxStacks??3" label="可叠加上限（0 为不设上限）" @update:model-value="step.maxStacks=$event" />
          <p>{{ WORKSHOP_DOT_STACK_HINT }}</p>
        </template>
      </template>
      <label v-if="['apply_status','remove_status'].includes(step.type)&&step.selection===undefined">状态<WorkshopObjectSelect v-model="step.status" kind="statuses" :extra="[...statuses.map(s=>({...s,group:'本组合状态'})),...(step.type==='remove_status'?[{id:'self',name:'此状态自身',group:'当前状态'}]:[])]" /></label>
      <label v-if="step.type==='remove_status'"><input :checked="step.selection!==undefined" type="checkbox" @change="step.selection=($event.target as HTMLInputElement).checked?{op:'statuses',key:'dot',target:'selected_target'}:undefined">从状态列表选择实例</label>
      <WorkshopFormulaEditor v-if="['modify_status','copy_status','remove_status'].includes(step.type)&&step.selection!==undefined" v-model="step.selection" label="状态列表／当前项" />
      <template v-if="step.type==='modify_status'">
        <label>修改字段<select v-model="step.field"><option value="remaining">剩余回合</option><option value="value">状态数值</option><option value="layers">层数／份数</option><option value="damage">DOT 每跳原伤害</option><option value="data.value">自定义状态数据</option></select></label>
        <input v-if="step.field?.startsWith('data.')" v-model="step.field" placeholder="data.数据名称">
        <label>修改方式<select v-model="step.operation"><option value="set">设置为</option><option value="add">增加（负数为减少）</option><option value="mul">乘以倍率</option></select></label>
        <p>剩余回合 0 表示移除，-1 为整场；延长不会缩短整场状态。独立 DOT 修改份数会复制或移除该层；自定义状态写入自身数据 layers，可供效果公式读取，伤害字段是每跳原伤害数值。</p>
      </template>
      <template v-if="step.type==='copy_status'">
        <label>操作<select v-model="step.operation"><option value="copy">复制，保留原状态</option><option value="move">转移，成功后移除原状态</option></select></label>
        <label><input :checked="step.preserveSource!==false" type="checkbox" @change="step.preserveSource=($event.target as HTMLInputElement).checked">保留原施加者与原伤害</label>
        <label><input :checked="step.turns!==undefined" type="checkbox" @change="step.turns=($event.target as HTMLInputElement).checked?2:undefined">重设持续回合</label>
        <WorkshopFormulaEditor v-if="step.turns!==undefined" v-model="step.turns" label="持续回合（-1 为整场）" />
        <p>默认保留状态数据和剩余回合；转移到原持有者不会删除原状态。自定义状态复用效果随父状态一起复制。</p>
      </template>
      <p v-if="step.type==='remove_status'&&step.selection!==undefined">仅移除列表引用的实例，包括不可净化状态；其他状态保留。自定义状态附带效果随父状态移除。</p>
      <template v-if="step.type==='apply_status'">
        <label v-for="(_,key) in step.data" :key="key">传入 {{ key }}<WorkshopFormulaEditor v-model="step.data![key]!" /></label>
        <input v-model="parameterName" placeholder="数据名称"><button type="button" @click="addParameter(step)">＋传入数据</button>
      </template>
      <template v-if="['native_status','delay','summon'].includes(step.type)"><WorkshopFormulaEditor v-model="step.turns!" :label="step.type==='native_status'?'持续回合（正整数，-1 为整场）':'回合数'" /></template>
      <template v-if="step.type==='delay'"><label><input v-model="step.snapshot" type="checkbox">锁定安排时的数值</label><select v-model="step.event"><option v-for="[k,n] in RULE_EVENTS" :key="k" :value="k">{{ n }}</option></select><select v-model="step.mode"><option value="cancel">原目标失效时取消</option><option value="retarget">原目标失效时重选</option></select></template>
      <template v-if="['damage','heal','shield'].includes(step.type)">
        <label>伤害处理<select v-model="step.mode"><option value="normal">正常结算</option><option value="recorded">使用已结算金额</option><option v-if="step.type==='damage'" value="dot">按持续伤害结算</option></select></label>
        <WorkshopFormulaEditor v-if="step.type==='damage'&&step.mode!=='dot'" v-model="step.hits!" label="攻击段数" /><label v-if="step.type==='damage'&&step.mode!=='dot'">可以暴击<input v-model="step.crit" type="checkbox"></label>
        <button v-if="!step.stars&&step.mode!=='dot'" type="button" @click="step.stars=[1,1.1,1.2]">设置一至三星系数</button><label v-for="(_,index) in step.stars" :key="index">{{ index+1 }}星<input v-model.number="step.stars![index]" type="number" step="any"></label>
      </template>
      <template v-if="step.type==='damage'&&step.mode==='dot'">
        <WorkshopFormulaEditor :model-value="step.source??'self'" label="伤害来源" @update:model-value="step.source=$event" />
        <label><input :checked="step.sourceLevel!==undefined" type="checkbox" @change="step.sourceLevel=($event.target as HTMLInputElement).checked?{op:'item',key:'sourceLevel'}:undefined">指定来源等级（默认使用伤害来源单位等级）</label><WorkshopFormulaEditor v-if="step.sourceLevel!==undefined" v-model="step.sourceLevel" label="来源等级" />
        <p>数值按基础伤害处理，计算目标防御与护盾，不暴击、不闪避、不额外乘星级。读取当前状态项的每跳原伤害即可结算该层；是否移除、重复几次由其他积木决定。</p>
      </template>
      <template v-if="['card','discard','discard_cost'].includes(step.type)">
        <label><input :checked="step.selection!==undefined" type="checkbox" @change="step.selection=($event.target as HTMLInputElement).checked?{op:'card_items',key:step.pile??'hand'}:undefined">从卡牌列表选择实例</label><WorkshopFormulaEditor v-if="step.selection!==undefined" v-model="step.selection" label="卡牌列表／当前项" /><WorkshopFormulaEditor :model-value="step.source??{op:'card_definition',key:step.key??''}" label="指定卡牌（未选时匹配所有牌）" @update:model-value="step.source=$event;step.key=undefined" />
        <WorkshopFormulaEditor v-if="step.type==='card'" v-model="step.count!" label="卡牌数量" /><label>牌堆<select v-model="step.pile"><option value="hand">手牌</option><option value="deck">抽牌堆</option><option value="discard">弃牌堆</option><option value="exhaust">移出牌</option></select></label><label v-if="step.type==='card'&&step.operation==='cost'">费用修改<select v-model="step.field"><option :value="undefined">设为数值</option><option value="add">增加数值（负数为减少）</option><option value="mul">乘以倍率</option></select></label>
        <select v-if="step.type==='card'" v-model="step.operation"><option value="move">移动</option><option value="copy">复制</option><option value="cost">修改费用</option><option value="transform">变形</option><option value="generate">生成指定卡</option><option value="exhaust">移出循环</option><option value="consume">消耗（从战斗中删除）</option><option value="draw">定向检索到手牌</option><option value="discard">定向弃牌</option></select>
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
