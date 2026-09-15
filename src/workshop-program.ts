import { randomUuid } from '@/kernel/random-uuid';
import { formatNumber } from '@/ui/format-number';
import { workshopBuiltinStatus, workshopTurns, workshopMaxStacks } from '@/workshop-status-library';

export type RuleValue = number | string | boolean | null | RuleValue[] | { [key: string]: RuleValue };
export type RuleExpression = number | string | boolean | { op: string; key?: string; scope?: string; target?: RuleExpression; args?: RuleExpression[]; value?: RuleExpression; excludeSelected?: boolean; types?: string[] };
export interface RuleStep {
  type: string; source?: RuleExpression; selection?: RuleExpression; statusFrom?: RuleExpression; sourceLevel?: RuleExpression; target?: RuleExpression; value?: RuleExpression; key?: string; scope?: string;
  field?: string; operation?: string; saveAs?: string; status?: string; name?: string;
  turns?: RuleExpression; maxStacks?: RuleExpression; chance?: RuleExpression; hits?: RuleExpression; condition?: RuleExpression;
  steps?: RuleStep[]; otherwise?: RuleStep[]; event?: string; stat?: string; pile?: string;
  filter?: RuleExpression; order?: string; count?: RuleExpression; program?: RuleProgram;
  inherit?: Record<string, number>; data?: Record<string, RuleExpression>;
  stars?: [number, number, number]; crit?: boolean; mode?: string; snapshot?: boolean; preserveSource?: boolean;
}
export interface WorkshopRule {
  id: string; event: string; priority: number; once: 'never' | 'turn' | 'battle';
  eventScope?: 'holder' | 'all'; condition?: RuleExpression; costs: RuleStep[]; steps: RuleStep[]; cooldown?: number;
}
export interface RuleStatus {
  id: string; name: string; polarity: 'buff' | 'debuff'; turns: number;
  cleanseable: boolean; dispellable: boolean; baseChance: number;
  stacking: 'independent' | 'add' | 'replace' | 'strongest'; refresh?: 'keep' | 'refresh' | 'extend'; maxStacks?: number;
  data: Record<string, RuleExpression>;
  modifiers: Array<{ status: string; value: RuleExpression; unit: 'ratio' | 'percent' | 'count'; condition?: RuleExpression }>;
  rules: WorkshopRule[];
}
export interface RuleProgram {
  version: 2; id: string; name: string;
  variables: Array<{ name: string; scope: string; initial: RuleExpression }>;
  statuses: RuleStatus[]; rules: WorkshopRule[];
}
export const RULE_EVENTS = [
  ['cast','使用此技能'], ['battle_start','战斗开始'], ['turn_start','持有者行动开始'], ['turn_end','持有者行动结束'],
  ['before_card','使用卡牌前'], ['after_card','使用卡牌后'], ['before_damage','伤害结算前'], ['after_damage','伤害结算后'],
  ['before_heal','治疗结算前'], ['after_heal','治疗结算后'], ['before_shield','获得护盾前'], ['after_shield','获得护盾后'],
  ['critical','暴击后'], ['dodge','闪避后'], ['shield_broken','护盾破裂'], ['death','单位死亡'],
  ['status_added','状态施加后'], ['status_removed','状态移除后'], ['draw','抽牌后'], ['discard','弃牌后'],
  ['summon_created','召唤物登场'], ['summon_removed','召唤物离场'], ['resource_changed','资源改变'],
  ['battle_victory','战斗胜利'], ['battle_defeat','战斗失败'],
] as const;
export const RULE_SCOPES = [['local','本次执行'],['card','此卡牌实例'],['status','此状态实例'],['unit','此单位'],['turn','本回合'],['battle','本场战斗'],['shared','同队共享（跨卡牌）'],['shared_turn','同队本回合共享'],['target','按目标记录（跨卡牌）'],['target_turn','按目标本回合记录']] as const;
export const RULE_STEPS = [
  ['set','记录数据'],['add','增减数据'],['event_set','改写本次事件'],['if','如果／否则'],['repeat','重复'],['foreach','逐个目标执行'],['foreach_item','逐项执行'],['modify_status','修改状态'],['copy_status','复制／转移状态'],['delay','延迟执行'],
  ['damage','造成伤害'],['heal','治疗'],['shield','提供护盾'],['native_status','使用已有状态效果'],['apply_status','施加自定义状态'],['remove_status','移除状态'],
  ['cleanse','净化'],['dispel','驱散'],['resource','改变资源'],['draw','抽牌'],['discard','弃牌'],['card','操作卡牌'],['summon','召唤单位'],['remove_unit','移除召唤物'],['stop','结束当前规则'],
] as const;
export const RULE_OPS = [
  ['card_definition','指定卡牌'],['literal','常数'],['var','读取记录'],['event','读取事件'],['stat','读取属性'],['resource','读取单位资源'],['status_data','读取状态数据'],['targets','筛选目标'],['status','读取状态层数'],['count','数量'],['cards','读取牌堆'],
  ['statuses','读取状态列表'],['item','读取当前项'],['unique','列表去重'],['filter_list','筛选列表'],['sort_list','列表排序'],['take','取前 N 项'],['sample','随机取 N 项'],['sum_list','列表求和'],['min_list','列表最小值'],['max_list','列表最大值'],['card_items','读取卡牌列表'],
  ['add','相加'],['sub','相减'],['mul','相乘'],['div','相除'],['min','较小值'],['max','较大值'],['floor','向下取整'],['ceil','向上取整'],
  ['eq','等于'],['ne','不等于'],['gt','大于'],['gte','大于等于'],['lt','小于'],['lte','小于等于'],['and','且'],['or','或'],['not','非'],['chance','概率成立'],
] as const;
export const WORKSHOP_STATE_FIELDS = [
  ['self','当前项整体'],['id','状态实例编号'],['type','状态种类'],['kind','状态类别'],['targetId','状态持有者编号'],
  ['sourceId','原施加者编号'],['sourceLevel','原施加者等级'],['damage','每跳原伤害'],
  ['remaining','剩余回合（-1 为整场）'],['value','状态数值'],['layers','层数'],['hp','当前生命'],['hpMax','生命上限'],['attack','攻击力'],['defense','防御'],['speed','速度'],['cost','卡牌费用'],['star','卡牌星级'],['cardId','卡牌编号'],['pile','所在牌堆'],['battleOnly','是否战斗专用牌'],['name','名称'],
] as const;
export const WORKSHOP_EVENT_FIELDS = [
  ['type','事件类型'],['amount','本次数值'],['originalAmount','原始数值'],['damage','实际伤害合计'],['hpDamage','实际扣除生命'],['shieldDamage','护盾吸收'],['overflow','溢出治疗'],['absorbed','抵扣数值'],
  ['sourceId','事件发起者'],['targetId','事件目标'],['cardId','来源卡牌编号'],['cardUid','来源卡牌实例'],['cardCost','卡牌费用'],['skillId','来源技能编号'],['origin','伤害来源标记'],['dot','是否持续伤害'],['secondary','是否追加／反应伤害'],['crit','是否暴击'],['crits','暴击段数'],['hit','是否命中'],['count','数量'],
  ['statusId','状态种类编号'],['statusInstance','状态实例编号'],['reason','移除原因'],['key','资源名称'],['before','变化前'],['after','变化后'],['cancel','是否取消'],['preHitShield','受伤前护盾'],
] as const;
const banned = new Set(['__proto__','constructor','prototype']);
export function ruleKey(value: unknown, fallback = ''): string {
  const s = String(value ?? fallback).trim().slice(0,256);
  if (!s || banned.has(s) || s.split('.').some(k=>banned.has(k))) throw new Error('请填写有效的数据名称');
  return s;
}
function finite(value: unknown, fallback = 0): number { const n=Number(value??fallback);if(!Number.isFinite(n))throw new Error('积木数值必须有限');return n; }
export function normalizeRuleProgram(raw: unknown): RuleProgram {
  let nodes=0;
  const object=(v:any)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('积木结构无效');if(++nodes>4096)throw new Error('积木数量超过单个作品的执行保护范围');return v;};
  function expression(v:any,depth=0):RuleExpression {
    if(++nodes>4096)throw new Error('公式数量超过单个作品的执行保护范围');
    if(depth>24)throw new Error('公式嵌套过深');
    if(['number','string','boolean'].includes(typeof v)){if(typeof v==='number')finite(v);return v;}
    const x=object(v);if(!RULE_OPS.some(([op])=>op===x.op))throw new Error('未知公式积木：'+x.op);
    return {op:x.op,...(x.key!==undefined?{key:ruleKey(x.key)}:{}),...(x.scope?{scope:ruleKey(x.scope)}:{}),...(x.excludeSelected!==undefined?{excludeSelected:Boolean(x.excludeSelected)}:{}),...(Array.isArray(x.types)?{types:[...new Set<string>(x.types.map((v:unknown)=>ruleKey(v)))]}:{}),...(x.target!==undefined?{target:expression(x.target,depth+1)}:{}),...(x.value!==undefined?{value:expression(x.value,depth+1)}:{}),...(Array.isArray(x.args)?{args:x.args.map((a:any)=>expression(a,depth+1))}:{})};
  }
  function steps(v:any,depth=0):RuleStep[]{
    if(depth>16)throw new Error('规则嵌套过深');if(!Array.isArray(v))return [];
    return v.map(raw=>{const x=object(raw);if(!RULE_STEPS.some(([t])=>t===x.type)&&!['hp','shield_cost','resource_cost','discard_cost','summon_cost'].includes(x.type))throw new Error('未知效果积木：'+x.type);
      const result:RuleStep={type:x.type};
      for(const k of ['source','sourceLevel','selection','statusFrom','target','value','turns','maxStacks','chance','hits','condition','filter','count'] as const)if(x[k]!==undefined)result[k]=expression(x[k]);
      for(const k of ['key','scope','field','operation','saveAs','status','name','event','stat','pile','order','mode'] as const)if(x[k]!==undefined&&x[k]!=='')result[k]=ruleKey(x[k]);
      if(x.steps)result.steps=steps(x.steps,depth+1);if(x.otherwise)result.otherwise=steps(x.otherwise,depth+1);
      if(x.data)result.data=Object.fromEntries(Object.entries(object(x.data)).map(([k,v])=>[ruleKey(k),expression(v)]));
      if(x.inherit)result.inherit=Object.fromEntries(Object.entries(object(x.inherit)).map(([k,v])=>[ruleKey(k),finite(v)]));
      if(x.program)result.program=program(x.program,depth+1);
      if(x.stars){if(!Array.isArray(x.stars)||x.stars.length!==3)throw new Error('需要完整的一至三星数值');result.stars=x.stars.map((n:any)=>finite(n)) as [number,number,number];}
      if(x.preserveSource!==undefined)result.preserveSource=Boolean(x.preserveSource);if(x.snapshot!==undefined)result.snapshot=Boolean(x.snapshot);if(x.crit!==undefined)result.crit=Boolean(x.crit);return result;
    });
  }
  function rules(v:any,depth=0):WorkshopRule[]{return (Array.isArray(v)?v:[]).map((raw:any,index:number)=>{const x=object(raw);if(!RULE_EVENTS.some(([e])=>e===x.event))throw new Error('未知触发时机：'+x.event);return {id:ruleKey(x.id,'rule-'+index),event:x.event,priority:finite(x.priority),...(x.eventScope==='all'?{eventScope:'all' as const}:{}),once:['turn','battle'].includes(x.once)?x.once:'never',...(x.condition!==undefined?{condition:expression(x.condition)}:{}),costs:steps(x.costs,depth),steps:steps(x.steps,depth),cooldown:Math.max(0,Math.floor(finite(x.cooldown)))};});}
  function program(raw:any,depth=0):RuleProgram {if(depth>16)throw new Error('嵌套作品过深');const x=object(raw);if(x.version!==2)throw new Error('规则作品版本无效');return {version:2,id:ruleKey(x.id),name:String(x.name??'自定义规则').slice(0,80),variables:(Array.isArray(x.variables)?x.variables:[]).map((v:any)=>({name:ruleKey(v.name),scope:ruleKey(v.scope,'battle'),initial:expression(v.initial??0)})),statuses:(Array.isArray(x.statuses)?x.statuses:[]).map((v:any)=>({id:ruleKey(v.id),name:String(v.name??v.id).slice(0,80),polarity:v.polarity==='debuff'?'debuff':'buff',turns:workshopTurns(v.turns,-1),maxStacks:workshopMaxStacks(v.maxStacks,0),cleanseable:v.cleanseable!==false,dispellable:v.dispellable!==false,baseChance:Math.max(0,Math.min(100,finite(v.baseChance,100))),stacking:['add','replace','strongest'].includes(v.stacking)?v.stacking:'independent',refresh:['refresh','extend'].includes(v.refresh)?v.refresh:'keep',data:Object.fromEntries(Object.entries(v.data??{}).map(([k,val])=>[ruleKey(k),expression(val)])),modifiers:(v.modifiers??[]).map((m:any)=>({status:ruleKey(m.status),value:expression(m.value??1),unit:['ratio','percent'].includes(m.unit)?m.unit:'count',...(m.condition!==undefined?{condition:expression(m.condition)}:{})})),rules:rules(v.rules,depth)})),rules:rules(x.rules,depth)};}
  const result=program(raw);
  const scope=(s?:string)=>{if(s&&!RULE_SCOPES.some(([id])=>id===s))throw Error('未知数据范围：'+s);};
  function validate(p:RuleProgram):void {
    if(new Set(p.statuses.map(s=>s.id)).size!==p.statuses.length)throw new Error('状态编号重复');
    const names=new Set<string>();for(const v of p.variables){scope(v.scope);const id=v.scope+':'+v.name;if(names.has(id))throw Error('同一范围的数据名称重复');names.add(id);}
    const checkExpression=(e:RuleExpression|undefined):void=>{if(!e||typeof e!=='object')return;if(e.op==='statuses'&&!['all','buff','debuff','dot'].includes(e.key??'all'))throw Error('状态列表类别无效');if(e.op==='item'&&!WORKSHOP_STATE_FIELDS.some(([key])=>key===e.key)&&!e.key?.startsWith('data.'))throw Error('请选择当前项字段');if(e.op==='var')scope(e.scope);e.args?.forEach(checkExpression);checkExpression(e.target);checkExpression(e.value);};
    const checkSteps=(list:RuleStep[]):void=>{for(const s of list){scope(s.scope);for(const e of [s.value,s.source,s.sourceLevel,s.selection,s.statusFrom,s.target,s.condition,s.chance,s.turns,s.maxStacks,s.count,s.hits,s.filter])checkExpression(e);
      if(s.type==='native_status'){
        if(s.statusFrom===undefined&&!workshopBuiltinStatus(s.status??''))throw Error('请选择已有状态效果');
        if(typeof s.turns==='number')workshopTurns(s.turns);
        if(typeof s.maxStacks==='number')workshopMaxStacks(s.maxStacks);
      }
      if(['apply_status','remove_status'].includes(s.type)&&s.selection===undefined&&s.statusFrom===undefined&&s.status!=='self'&&!workshopBuiltinStatus(s.status??'')&&!s.status?.startsWith('program_status:')&&!s.status?.startsWith('workshop_status:')&&!p.statuses.some(x=>x.id===s.status))throw Error('引用的自定义状态不存在');
      if(s.type==='modify_status'&&(!['remaining','value','layers','damage'].includes(s.field??'')&&!s.field?.startsWith('data.')))throw Error('请选择可修改的状态字段');
      if(s.type==='modify_status'&&s.operation&&!['set','add','mul'].includes(s.operation))throw Error('状态修改方式无效');
      if(s.type==='copy_status'&&s.operation&&!['copy','move'].includes(s.operation))throw Error('状态复制方式无效');
      if(s.type==='event_set'&&!['amount','cancel','cardCost','count','targetId'].includes(s.field??'amount'))throw Error('不支持修改此事件字段');
      if(s.pile&&!['hand','deck','discard','exhaust'].includes(s.pile))throw Error('牌堆无效');
      if(s.type==='card'&&s.operation&&!['generate','copy','cost','transform','move','exhaust','consume','discard','draw'].includes(s.operation))throw Error('卡牌操作无效');
      if(s.type==='delay'&&!RULE_EVENTS.some(([id])=>id===(s.event??'turn_start')))throw Error('延迟触发事件无效');
      checkSteps(s.steps??[]);checkSteps(s.otherwise??[]);if(s.program)validate(s.program);
    }};
    for(const list of [p.rules,...p.statuses.map(s=>s.rules)]){const ids=new Set<string>();for(const r of list){if(ids.has(r.id))throw Error('事件规则编号重复');ids.add(r.id);checkExpression(r.condition);if(r.costs.some(s=>!['hp','shield_cost','resource_cost','discard_cost','summon_cost'].includes(s.type)))throw Error('代价区只能使用支付积木');checkSteps(r.costs);checkSteps(r.steps);}}
    for(const s of p.statuses)for(const m of s.modifiers){if(!workshopBuiltinStatus(m.status))throw Error('引用的状态效果不存在');checkExpression(m.value);checkExpression(m.condition);}
  }
  validate(result);
  return result;
}
export function emptyRuleProgram():RuleProgram {return {version:2,id:'program-'+randomUuid(),name:'自定义规则',variables:[],statuses:[],rules:[{id:'cast',event:'cast',priority:0,once:'never',costs:[],steps:[]}]};}
export const ruleVar=(scope:string,key:string):RuleExpression=>({op:'var',scope,key});
export const ruleEvent=(key:string):RuleExpression=>({op:'event',key});
export const ruleMath=(op:string,...args:RuleExpression[]):RuleExpression=>({op,args});
export interface RulePreviewContext { self:Record<string,number>; target?:Record<string,number>; star?:number }
const statLabels:Record<string,string>={attack:'攻击力',defense:'防御',speed:'速度',hp:'当前生命',hpMax:'生命上限',shield:'护盾',crit:'暴击率',critDamage:'暴击伤害'};
export function describeRuleExpression(e:RuleExpression|undefined,context?:RulePreviewContext):string|number|boolean {
  if(e===undefined)return 0;if(typeof e!=='object')return e;
  if(e.op==='literal')return describeRuleExpression(e.value,context);
  if(e.op==='stat'){const actor=e.target==='target'?context?.target:context?.self;return actor?.[e.key??'attack']??((e.target==='target'?'目标':'自身')+(statLabels[e.key??'']??e.key));}
  if(e.op==='resource')return '资源「'+e.key+'」';if(e.op==='status_data')return '状态数据「'+e.key+'」';if(e.op==='var')return '记录「'+e.key+'」';if(e.op==='event')return '本次「'+e.key+'」';if(e.op==='status')return '「'+e.key+'」层数';
  if(['filter_list','sort_list','sum_list','min_list','max_list'].includes(e.op))return (RULE_OPS.find(([id])=>id===e.op)?.[1]??e.op)+'（'+describeRuleExpression(e.args?.[0],context)+'；'+(e.op==='filter_list'?'条件：':'每项：')+describeRuleExpression(e.value,context)+(e.op==='sort_list'?(e.scope==='desc'?'；降序':'；升序'):'')+'）';
  if(e.op==='statuses')return (e.key==='dot'?'DOT':e.key==='buff'?'Buff':e.key==='debuff'?'Debuff':'全部状态')+'列表'+(e.types?'（指定 '+e.types.join('、')+'）':'');
  if(e.op==='item')return '当前项·'+(WORKSHOP_STATE_FIELDS.find(([key])=>key===e.key)?.[1]??e.key);
  if(e.op==='unique')return `按${WORKSHOP_STATE_FIELDS.find(([key])=>key===(e.key??'type'))?.[1]??e.key}去重（${describeRuleExpression(e.args?.[0],context)}）`;
  if(e.op==='targets')return (e.key==='allies'?'友方单位':e.key==='all'?'所有单位':e.key==='summons'?'召唤物':'敌方单位')+(e.excludeSelected?'（除选中目标外）':'');
  const values=(e.args??[]).map(v=>describeRuleExpression(v,context));
  if(context&&values.length&&values.every(x=>typeof x==='number')){const n=values as number[];switch(e.op){case'add':return n.reduce((a,b)=>a+b,0);case'sub':return n.slice(1).reduce((a,b)=>a-b,n[0]!);case'mul':return n.reduce((a,b)=>a*b,1);case'div':return n[1]?n[0]!/n[1]:0;case'min':return Math.min(...n);case'max':return Math.max(...n);case'floor':return Math.floor(n[0]!);case'ceil':return Math.ceil(n[0]!);}}
  const symbols:Record<string,string>={add:'＋',sub:'－',mul:'×',div:'÷',eq:'＝',ne:'≠',gt:'＞',gte:'≥',lt:'＜',lte:'≤',and:'且',or:'或'};
  const label=symbols[e.op];return label?'（'+values.map(v=>typeof v==='number'?formatNumber(v):v).join(label)+'）':(RULE_OPS.find(([id])=>id===e.op)?.[1]??e.op)+'（'+values.join('、')+'）';
}
export function describeRuleProgram(program:RuleProgram,context?:RulePreviewContext):string {
  const val=(e:RuleExpression|undefined)=>{const v=describeRuleExpression(e,context);return typeof v==='number'?formatNumber(v):String(v);};
  const describe=(s:RuleStep):string=>{
    const label=RULE_STEPS.find(([t])=>t===s.type)?.[1]??s.type;
    if(s.type==='modify_status')return `修改状态列表 ${val(s.selection)}：${WORKSHOP_STATE_FIELDS.find(([key])=>key===s.field)?.[1]??s.field}，${s.operation==='add'?'增加':s.operation==='mul'?'乘以':'设为'} ${val(s.value)}`;
    if(s.type==='copy_status')return `${s.operation==='move'?'转移':'复制'}状态列表 ${val(s.selection)}，${s.preserveSource===false?'改用当前施加者':'保留原施加者与数值'}，${s.turns===undefined?'保留剩余回合':`持续${val(s.turns)}回合`}`;
    if(s.type==='foreach_item')return `逐项执行：${val(s.value)}（${(s.steps??[]).map(describe).join('；')}）`;
    if(s.type==='remove_status'&&s.selection!==undefined)return `移除状态列表中的指定实例：${val(s.selection)}，其他状态保留`;
    if(s.type==='damage'&&s.mode==='dot')return `按持续伤害结算 ${val(s.value)}，使用${val(s.source??'self')}的等级计算防御和护盾，不暴击、不闪避、不再套用星级`;
    let value=s.value===undefined?'':val(s.value);if(context&&['damage','heal','shield'].includes(s.type)){const raw=describeRuleExpression(s.value,context);if(typeof raw==='number')value=formatNumber(raw*(s.stars?.[Math.max(0,Math.min(2,(context.star??1)-1))]??(1+.1*((context.star??1)-1))));}
    if(s.type==='native_status'&&s.statusFrom!==undefined)return `施加${val(s.statusFrom)}，数值 ${val(s.value)}，持续${val(s.turns??1)}回合，DOT 同类上限 ${val(s.maxStacks??3)}（0 为不限）`;
    if(s.type==='native_status'){
      const def=workshopBuiltinStatus(s.status??'');
      if(def?.kind==='dot'&&context){const raw=describeRuleExpression(s.value,context);if(typeof raw==='number')value=formatNumber(raw*(1+.1*((context.star??1)-1)));}
      if(def?.kind==='dot')return `施加「${def.name}」，每层每跳施加时攻击力 × ${value}，${val(s.turns??1)==='-1'?'持续整场战斗':`持续${val(s.turns??1)}回合`}，${val(s.maxStacks??3)==='0'?'叠加不设上限':`同类最多${val(s.maxStacks??3)}层`}`;
      if(def?.unit==='ratio')value+=' 倍';
    }
    return (s.name??label)+(s.status?'「'+(program.statuses.find(x=>x.id===s.status)?.name??s.status)+'」':'')+(s.type==='if'?' '+val(s.condition):value?' '+value:'')+(s.turns!==undefined?'，'+val(s.turns)+'回合':'')+(s.steps?.length?'（'+s.steps.map(describe).join('；')+'）':'')+(s.otherwise?.length?'；否则：'+s.otherwise.map(describe).join('；'):'');
  };
  return program.rules.map(r=>(RULE_EVENTS.find(([id])=>id===r.event)?.[1]??r.event)+'：'+r.steps.map(describe).join('；')).join('\n');
}
const TEMPLATE_KEY='caelian_workshop_rule_templates_v2';
export function readRuleTemplates():RuleProgram[]{try{return JSON.parse(localStorage.getItem(TEMPLATE_KEY)??'[]').flatMap((x:unknown)=>{try{return [normalizeRuleProgram(x)];}catch{return [];}});}catch{return [];}}
export function saveRuleTemplate(program:RuleProgram):void {const p=normalizeRuleProgram(program);localStorage.setItem(TEMPLATE_KEY,JSON.stringify([...readRuleTemplates().filter(x=>x.name!==p.name),p]));}
