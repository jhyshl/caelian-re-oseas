
import type { RuleExpression, RuleProgram, RuleStatus, RuleStep, WorkshopRule } from '@/workshop-program';
import { workshopBuiltinStatus } from '@/workshop-status-library';
import { normalizeLegacyStatus } from '@/battle/rework/runtime/legacy-bridge.mjs';
import { effectValue, statusGain } from '@/battle/rework/runtime/tactical-ai.mjs';

type Context={area?:boolean;program:RuleProgram;owner:any;source:any;target:any;event:any;local:Record<string,any>;status?:any;card?:any;star:number};
const attached=new WeakMap<object,WorkshopProgramRuntime>();
const clone=<T>(x:T):T=>structuredClone(x);
const num=(v:any)=>typeof v==='number'&&Number.isFinite(v)?v:0;
const arr=(v:any):any[]=>v==null?[]:Array.isArray(v)?v:[v];
const key=(x:any)=>String(x??'').split('.').filter(s=>s&&!['__proto__','prototype','constructor'].includes(s));
const read=(x:any,path:string)=>key(path).reduce((v,k)=>v?.[k],x);

export function installWorkshopPrograms(g:any,roots:Array<{program:RuleProgram;card?:any}>,ports:{card?:(id:string)=>any}={}):WorkshopProgramRuntime {
  let runtime=attached.get(g);if(!runtime){runtime=new WorkshopProgramRuntime(g,ports);attached.set(g,runtime);runtime.attach();}
  runtime.roots=roots;for(const r of roots)runtime.register(r.program);return runtime;
}
export class WorkshopProgramRuntime {
  roots:Array<{program:RuleProgram;card?:any}>=[];
  private steps=0;private depth=0;private original:any={};private syncing=false;
  constructor(public g:any,private ports:{card?:(id:string)=>any}){}
  private get memory():any{return this.g.player.flags.workshopPrograms??=( {programs:{},variables:{},fired:{},delays:[],trace:[],sequence:0} );}
  register(p:RuleProgram):void{this.memory.programs[p.id]=clone(p);}
  private actors():any[]{return [...this.g.allies,...this.g.enemies];}
  private actor(id:any,c:Context):any {if(id&&typeof id==='object'&&id.id)return id;if(id==='self'||id==='holder')return c.owner;if(id==='source')return c.source;if(id==='target')return c.target;if(id==='event_source')return this.actors().find(a=>a.id===c.event.sourceId);if(id==='event_target')return this.actors().find(a=>a.id===c.event.targetId);if(id==='summoner')return this.actors().find(a=>a.id===c.owner.ownerId);return this.actors().find(a=>a.id===id);}
  private context(program:RuleProgram,owner=this.g.player,event:any={},status?:any,card?:any):Context {return {program,owner,source:this.actors().find(a=>a.id===status?.sourceId)??owner,target:this.actors().find(a=>a.id===event.targetId)??this.g.enemies[this.g.selectedTarget??0]??this.g.enemies.find((a:any)=>a.hp>0),event,local:{},status,card,star:status?.ruleStar??card?.star??1};}
  private storage(c:Context,scope='local'):any {
    if(scope==='local')return c.local;if(scope==='status')return c.status?.ruleData??c.local;
    const suffix=scope==='turn'?':'+this.g.round:scope==='card'?':'+(c.card?.uid??'none'):scope==='unit'?':'+c.owner.id:'';
    const id=c.program.id+':'+scope+suffix;return this.memory.variables[id]??={};
  }
  value(e:RuleExpression|undefined,c:Context):any {
    if(e===undefined)return 0;if(e===null||typeof e!=='object')return e;
    const args=()=>e.args?.map(a=>this.value(a,c))??[];
    if(e.op==='literal')return e.value??0;
    if(e.op==='var')return read(this.storage(c,e.scope),e.key??'')??0;
    if(e.op==='event')return read(c.event,e.key??'')??0;
    if(e.op==='stat'){const a=this.actor(this.value(e.target??'self',c),c);if(!a)return 0;const stat=e.key??'attack';return ['attack','defense','speed','crit','critDamage','ehr','res'].includes(stat)?this.g.stat(a,stat):stat==='hpMax'?a.maxHp:stat==='lostHp'?a.maxHp-a.hp:read(a,stat)??0;}
    if(e.op==='resource'){const a=this.actor(this.value(e.target??'self',c),c);return e.key==='ap'?a?.ap??0:a?.resources?.[e.key??'energy']??0;}
    if(e.op==='status_data'){const a=this.actor(this.value(e.target??'target',c),c),[id,...path]=(e.key??'').split('.');return a?[...a.buffs,...a.debuffs].filter(s=>s.ruleStatus===id||s.ruleLabel===id).reduce((sum,s)=>sum+num(read(s.ruleData,path.join('.'))),0):0;}
    if(e.op==='status'){const a=this.actor(this.value(e.target??'self',c),c);return a?this.g.status(a,e.key):0;}
    if(e.op==='cards'){const pile=this.g.player[e.key??'hand']??[];return pile.map((v:any)=>v.uid);}
    if(e.op==='targets'){
      const selector=e.key??'enemies';let list=selector==='all'?this.actors():selector==='summons'?this.actors().filter(a=>a.isSummon||a.legacySummon):selector==='allies'?this.g.friendTeam(c.owner):this.g.foeTeam(c.owner);
      list=list.filter((a:any)=>a.hp>0);
      if(e.value)list=list.filter((a:any)=>this.value(e.value,{...c,target:a}));
      if(e.scope==='lowest_hp')list=[...list].sort((a:any,b:any)=>a.hp/a.maxHp-b.hp/b.maxHp||a.id.localeCompare(b.id)).slice(0,1);
      return list.map((a:any)=>a.id);
    }
    if(e.op==='and')return (e.args??[]).every(a=>Boolean(this.value(a,c)));if(e.op==='or')return (e.args??[]).some(a=>Boolean(this.value(a,c)));if(e.op==='not')return !this.value(e.args?.[0]??e.value,c);
    const a=args(),n=a.map(num);
    switch(e.op){case 'add':return n.reduce((x,y)=>x+y,0);case 'sub':return n.slice(1).reduce((x,y)=>x-y,n[0]??0);case 'mul':return n.reduce((x,y)=>x*y,1);case 'div':return n[1]?n[0]!/n[1]:0;case 'min':return Math.min(...n);case 'max':return Math.max(...n);case 'floor':return Math.floor(n[0]??0);case 'ceil':return Math.ceil(n[0]??0);case 'count':return arr(a[0]).length;case 'eq':return a[0]===a[1];case 'ne':return a[0]!==a[1];case 'gt':return n[0]!>n[1]!;case 'gte':return n[0]!>=n[1]!;case 'lt':return n[0]!<n[1]!;case 'lte':return n[0]!<=n[1]!;case 'chance':return this.g.rng()<Math.max(0,Math.min(100,n[0]??0))/100;default:throw Error('不支持的公式 '+e.op);}
  }
  private initialize(c:Context):void{for(const v of c.program.variables){const store=this.storage(c,v.scope);if(store[v.name]===undefined)store[v.name]=clone(this.value(v.initial,c));}}
  private trace(c:Context,message:string):void {const log=this.memory.trace;log.push({turn:this.g.round,name:c.status?.ruleLabel??c.program.name,event:c.event.type,message});if(log.length>150)log.splice(0,log.length-150);}
  private budget():void{if(++this.steps>4096)throw new Error('规则连锁超过执行保护范围');}
  private targets(s:RuleStep,c:Context):any[]{const v=this.value(s.target??'target',c);return arr(v).map(id=>this.actor(id,c)).filter(Boolean);}
  private pay(costs:RuleStep[],c:Context):boolean {
    const totals=new Map<string,{actor:any;field:string;value:number}>();const discards:any[]=[];const pets:any[]=[];
    for(const s of costs){const a=this.targets({...s,target:s.target??'self'},c)[0];if(!a)return false;const n=Math.max(0,num(this.value(s.value??1,c)));
      if(s.type==='discard_cost'){const available=this.g.player.hand.filter((x:any)=>x.uid!==c.card?.uid&&!discards.includes(x));if(available.length<n)return false;discards.push(...available.slice(0,n));continue;}
      if(s.type==='summon_cost'){const available=this.g.allies.filter((x:any)=>x.hp>0&&(x.isSummon||x.legacySummon)&&!pets.includes(x));if(available.length<n)return false;pets.push(...available.slice(0,n));continue;}
      const field=s.type==='hp'?'hp':s.type==='shield_cost'?'shield':s.key==='ap'?'ap':'resources.'+(s.key??'energy');const id=a.id+':'+field;const row=totals.get(id)??{actor:a,field,value:0};row.value+=n;totals.set(id,row);
    }
    for(const row of totals.values())if(num(read(row.actor,row.field))-row.value<(row.field==='hp'?1:0))return false;
    let paid=0;for(const row of totals.values()){if(row.field.startsWith('resources.'))row.actor.resources[row.field.slice(10)]-=row.value;else row.actor[row.field]-=row.value;paid+=row.value;}
    for(const card of discards){this.g.player.hand.splice(this.g.player.hand.indexOf(card),1);this.g.player.discard.push(card);this.emit('discard',{sourceId:c.owner.id,targetId:c.owner.id,cardUid:card.uid,cardId:card.id});}
    for(const pet of pets){pet.hp=0;this.emit('summon_removed',{sourceId:c.owner.id,targetId:pet.id});}
    c.local.paid=paid;c.local.discarded=discards.map(x=>x.uid);c.local.sacrificed=pets.map(x=>x.id);return true;
  }
  private run(rule:WorkshopRule,c:Context):boolean {
    this.initialize(c);if(rule.condition!==undefined&&!this.value(rule.condition,c)){this.trace(c,'条件不成立');return false;}
    const id=c.program.id+':'+(c.status?.ruleInstance??c.card?.uid??c.owner.id)+':'+rule.id,stamp=rule.once==='turn'?this.g.round:0;
    if(rule.once!=='never'&&this.memory.fired[id]===stamp)return false;
    if(rule.cooldown&&this.memory.fired[id+':cd']>this.g.round)return false;
    if(c.owner.ruleSummon&&c.event.type==='turn_start'&&!c.status&&!this.usefulAutomaticRule(rule,c)){this.trace(c,'当前目标无需此状态或支援，继续选择其他行动');return false;}
    if(!this.pay(rule.costs,c)){this.trace(c,'资源不足，未支付代价');if(c.event.type==='cast')throw Error('资源不足，无法支付此技能的额外代价');return false;}
    if(rule.once!=='never')this.memory.fired[id]=stamp;if(rule.cooldown)this.memory.fired[id+':cd']=this.g.round+rule.cooldown;
    this.execute(rule.steps,c);return true;
  }
  private usefulAutomaticRule(rule:WorkshopRule,c:Context):boolean {
    const deterministic=(value:unknown):boolean=>!value||typeof value!=='object'||(!('op' in value&&value.op==='chance')&&Object.values(value).every(deterministic));
    // Stateful programs keep their explicit order; inspect only pure primitives.
    if(!rule.steps.length||!deterministic(rule.steps)||rule.steps.some(s=>s.saveAs||!['damage','heal','shield','native_status','cleanse','dispel'].includes(s.type)))return true;
    return rule.steps.some(s=>{
      const targets=this.targets(s,c),value=num(this.value(s.value??0,c));
      if(s.type==='heal'&&targets.some(t=>[...t.buffs,...t.debuffs].some(status=>status.ruleInstance)))return true;
      const effect:any={kind:s.type,flat:value,atk:0,amount:value,turns:num(this.value(s.turns??1,c)),baseChance:num(this.value(s.chance??100,c))};
      if(s.type==='native_status'){
        const def=workshopBuiltinStatus(s.status??'');if(!def)return true;
        Object.assign(effect,{...def.template,kind:def.kind,status:s.status,value,valueUnit:def.unit,atk:def.kind==='dot'?value:0});
      }
      return targets.some(t=>['buff','debuff'].includes(effect.kind)
        ? statusGain(this.g,c.owner,t,effect)>0 && (effect.kind==='buff'||this.g.effectChance(c.owner,t,effect)>0)
        : effectValue(this.g,c.owner,t,effect,{flatScale:1,star:c.star})>0);
    });
  }
  cast(program:RuleProgram,sourceId:string,targetId:string,card?:any):void{
    this.register(program);const owner=this.actors().find(a=>a.id===sourceId)??this.g.player,c=this.context(program,owner,{type:'cast',sourceId,targetId},undefined,card);
    this.withBudget(()=>{for(const r of program.rules.filter(r=>r.event==='cast').sort((a,b)=>b.priority-a.priority))this.run(r,c);});this.syncModifiers();
  }
  private withBudget(fn:()=>void):void {if(this.depth===0)this.steps=0;if(++this.depth>32){this.depth--;throw Error('规则触发递归过深');}try{fn();}finally{this.depth--;}}
  emit(type:string,event:any={}):any {
    event.type=type;const work:Array<{rule:WorkshopRule;c:Context}>=[];
    for(const root of this.roots){const c=this.context(root.program,this.g.player,event,undefined,root.card);for(const rule of root.program.rules)if(rule.event===type&&type!=='cast'&&(!['turn_start','turn_end'].includes(type)||event.targetId==='player')&&(!root.card||!['before_card','after_card'].includes(type)||root.card.uid===event.cardUid))work.push({rule,c});}
    for(const owner of this.actors()){
      for(const status of [...owner.buffs,...owner.debuffs].filter((x:any)=>x.ruleInstance)){
        const program=this.memory.programs[status.ruleProgram],definition:RuleStatus|undefined=program?.statuses.find((s:RuleStatus)=>s.id===status.ruleStatus);if(!definition)continue;
        const c=this.context(program,owner,event,status);for(const rule of definition.rules)if(rule.event===type&&(['before_card','after_card','draw','discard'].includes(type)?event.sourceId===owner.id:['turn_start','turn_end','before_heal','after_heal','before_shield','after_shield','before_damage','after_damage','death','dodge','shield_broken'].includes(type)?event.targetId===owner.id:true))work.push({rule,c});
      }
      if(owner.ruleSummon&&owner.hp>0){const p:RuleProgram=owner.ruleSummon,c=this.context(p,owner,event);for(const rule of p.rules)if(rule.event===type&&(!['turn_start','turn_end'].includes(type)||event.targetId===owner.id))work.push({rule,c});}
    }
    this.withBudget(()=>{
      const due=this.memory.delays.filter((d:any)=>d.event===type&&d.round<=this.g.round&&(!d.ownerTurn||event.targetId===d.ownerId));
      this.memory.delays=this.memory.delays.filter((d:any)=>!due.includes(d));
      for(const d of due){const owner=this.actors().find(a=>a.id===d.ownerId);if(!owner||owner.hp<=0)continue;const c=this.context(d.program,owner,event,undefined,d.card);c.local=d.local;c.target=this.actors().find(a=>a.id===d.targetId);if(!c.target||c.target.hp<=0){if(d.mode==='retarget')c.target=this.g.foeTeam(owner)[0];else if(d.otherwise?.length){this.execute(d.otherwise,c);continue;}else continue;}this.execute(d.steps,c);}
      const acted=new Set<string>();for(const {rule,c} of work.sort((a,b)=>b.rule.priority-a.rule.priority||a.rule.id.localeCompare(b.rule.id))){if(c.status&&!this.actors().some(a=>[...a.buffs,...a.debuffs].includes(c.status)))continue;if(c.owner.ruleSummon&&type==='turn_start'&&acted.has(c.owner.id))continue;if(this.run(rule,c)&&c.owner.ruleSummon&&type==='turn_start')acted.add(c.owner.id);}
    });
    this.nativeEvent(type,event);this.syncModifiers();return event;
  }
  private freeze(steps:RuleStep[],c:Context):RuleStep[]{return steps.map(s=>{const out=clone(s);for(const field of ['value','chance','turns','hits','count'] as const)if(s[field]!==undefined)out[field]=this.value(s[field],c);if(s.steps)out.steps=this.freeze(s.steps,c);if(s.otherwise)out.otherwise=this.freeze(s.otherwise,c);return out;});}
  private execute(steps:RuleStep[],c:Context):void {
    for(const s of steps){this.budget();let result:any;const value=()=>this.value(s.value??0,c),targets=()=>this.targets(s,c);const scaled=()=>num(value())*(s.stars?.[Math.max(0,Math.min(2,c.star-1))]??(1+.1*(c.star-1)));
      if(s.type==='stop')return;
      if(s.type==='set'||s.type==='add'){const store=this.storage(c,s.scope),k=s.key??'result';store[k]=s.type==='add'?num(store[k])+num(value()):clone(value());result=store[k];}
      else if(s.type==='event_set'){const allowed=['amount','cancel','cardCost','count','targetId','ignoreDefense'];if(!allowed.includes(s.field??'amount'))throw Error('此事件字段不可修改');const k=s.field??'amount';c.event[k]=value();result=c.event[k];}
      else if(s.type==='if')this.execute(this.value(s.condition??true,c)?s.steps??[]:s.otherwise??[],c);
      else if(s.type==='repeat'){for(let i=0;i<Math.max(0,Math.floor(num(this.value(s.count??s.value??1,c))));i++){this.budget();c.local.index=i;this.execute(s.steps??[],c);}}
      else if(s.type==='foreach'){for(const target of targets()){this.budget();this.execute(s.steps??[],{...c,target,area:true});}}
      else if(s.type==='delay'){this.memory.delays.push({event:s.event??'turn_start',round:this.g.round+Math.max(1,num(this.value(s.turns??1,c))),ownerTurn:['turn_start','turn_end'].includes(s.event??'turn_start'),ownerId:c.owner.id,targetId:c.target?.id,program:clone(c.program),card:clone(c.card),local:clone(c.local),steps:s.snapshot?this.freeze(s.steps??[],c):clone(s.steps??[]),otherwise:clone(s.otherwise??[]),mode:s.mode??'cancel'});}
      else if(['damage','heal','shield'].includes(s.type)){
        result={damage:0,hpDamage:0,shieldDamage:0,heal:0,shield:0,overflow:0,absorbed:0};const selected=targets().filter(t=>t.hp>0),share=Math.min(1,2/Math.max(1,selected.length));
        for(let target of selected){if(s.type==='damage'&&!c.area&&selected.length===1&&target.side!==c.owner.side)target=this.g.targets(c.owner,{kind:'damage',target:'enemy'},target)[0]??target;
          if(s.type==='damage'){const parent=this.g.action;this.g.action=null;try{this.g.beginAction(c.owner,{id:c.program.id,name:s.name??c.program.name});const hitCount=Math.max(1,Math.floor(num(this.value(s.hits??1,c))));if(this.steps+hitCount>4096)throw Error('攻击段数超过单次执行保护范围');this.steps+=hitCount;const out=this.g.damage(c.owner,target,{kind:'damage',flat:scaled()*share,atk:0,hits:hitCount,crit:s.mode==='recorded'?false:s.crit!==false},{star:1,flatScale:1,forceHit:s.mode==='recorded'?true:undefined,ignoreDefense:s.mode==='recorded'?1:0,ignoreDirectBonuses:s.mode==='recorded',origin:'workshop'});for(const k of ['damage','hpDamage','shieldDamage'])result[k]+=num(out[k]);}finally{this.g.endAction();this.g.action=parent;}}
          else {const amount=this.g[s.type](c.owner,target,scaled()*share,{finalAmount:s.mode==='recorded'});result[s.type]+=num(amount);if(s.type==='heal'){result.overflow+=num(this.g.lastHealResult?.overflow);result.absorbed+=num(this.g.lastHealResult?.absorbed);}}
        }
      }
      else if(s.type==='native_status'){result=0;for(const target of targets())result+=Number(this.nativeStatus(c.owner,target,s.status??'taunt',num(value()),num(this.value(s.turns??1,c)),num(this.value(s.chance??100,c)),c.star));}
      else if(s.type==='apply_status'){result=[];for(const target of targets()){const added=this.applyStatus(c.program,s.status??'',c.owner,target,c,s);if(added)result.push(added.ruleInstance);}}
      else if(s.type==='remove_status'){result=0;for(const a of targets()){for(const status of [...a.buffs,...a.debuffs].filter(x=>x.ruleInstance&&(s.status==='self'?x===c.status:x.ruleStatus===s.status||x.ruleInstance===s.status))){this.removeStatus(a,status,'rule');result++;}}}
      else if(s.type==='cleanse'||s.type==='dispel'){result=targets().reduce((sum,t)=>sum+this.g[s.type](t,num(value())||1),0);}
      else if(s.type==='resource'){for(const a of targets()){const k=s.key??'energy',before=k==='ap'?a.ap:a.resources[k]??0,after=s.operation==='set'?num(value()):before+num(value());if(after<0)throw Error('资源不足');if(k==='ap'&&a===this.g.player)this.g.controller.makeContext(this.g).resource('AP',after-before);else if(k==='ap')a.ap=after;else a.resources[k]=after;result=k==='ap'?a.ap:after;this.emit('resource_changed',{sourceId:c.owner.id,targetId:a.id,key:k,before,after});}}
      else if(s.type==='draw'){const before=this.g.player.hand.map((x:any)=>x.uid);this.g.controller.draw(this.g,Math.max(0,Math.floor(num(value()))),true);result=this.g.player.hand.filter((x:any)=>!before.includes(x.uid)).map((x:any)=>x.uid);}
      else if(s.type==='discard'){const cards=this.cards(s,c).slice(0,Math.max(0,Math.floor(num(value())||1)));for(const card of cards){this.moveCard(card,'discard');this.emit('discard',{sourceId:c.owner.id,targetId:c.owner.id,cardUid:card.uid,cardId:card.id});}result=cards.map(x=>x.uid);}
      else if(s.type==='card')result=this.cardAction(s,c);
      else if(s.type==='summon')result=this.summon(s,c);
      else if(s.type==='remove_unit'){result=[];for(const a of targets())if(a.isSummon||a.legacySummon){a.hp=0;result.push(a.id);this.emit('summon_removed',{sourceId:c.owner.id,targetId:a.id});}}
      else throw Error('未实现的积木 '+s.type);
      if(result!==undefined){c.local.last=clone(result);if(s.saveAs)c.local[s.saveAs]=clone(result);}this.trace(c,(s.name??s.type)+(result===undefined?'':'：'+JSON.stringify(result).slice(0,160)));
    }
  }
  private cards(s:RuleStep,c:Context):any[]{let list=[...(this.g.player[s.pile??'hand']??[])].filter((x:any)=>x.uid!==c.card?.uid);if(s.key)list=list.filter((x:any)=>x.id===s.key||x.uid===s.key||x.tags?.includes(s.key));if(s.filter)list=list.filter((x:any)=>this.value(s.filter,{...c,event:{...c.event,card:x}}));if(s.order==='random')for(let i=list.length-1;i>0;i--){const j=Math.floor(this.g.rng()*(i+1));[list[i],list[j]]=[list[j],list[i]];}return list;}
  private moveCard(card:any,to:string):void{for(const pile of ['hand','deck','discard','exhaust'])this.g.player[pile]=this.g.player[pile].filter((x:any)=>x.uid!==card.uid);if(!['hand','deck','discard','exhaust'].includes(to))throw Error('无效牌堆');if(to==='hand'&&this.g.player.hand.length>=this.g.player.handLimit)to='discard';this.g.player[to].push(card);}
  private cardAction(s:RuleStep,c:Context):any {
    const count=Math.max(1,Math.floor(num(this.value(s.count??1,c)))),cards=this.cards(s,c).slice(0,count),results=[];
    if(s.operation==='generate'){const native=this.g.cardCatalog?.get(s.key),def=native??this.ports.card?.(s.key??'');if(!def)throw Error('卡牌不存在');for(let i=0;i<count;i++){this.budget();const card={...clone(def),id:s.key,uid:'rule-card:'+ ++this.memory.sequence,ap:def.ap??def.cost??1,star:c.star,legacy:!native};this.moveCard(card,s.mode??'hand');results.push(card.uid);}return results;}
    for(let card of cards){if(s.operation==='copy'){card={...clone(card),uid:'rule-card:'+ ++this.memory.sequence,generated:true};this.moveCard(card,s.mode??'hand');}
      else if(s.operation==='cost'){card.ap=Math.max(0,num(this.value(s.value,c)));card.ruleCost=card.ap;}
      else if(s.operation==='transform'){const native=this.g.cardCatalog?.get(String(this.value(s.value,c))),def=native??this.ports.card?.(String(this.value(s.value,c)));if(!def)throw Error('变形卡牌不存在');Object.assign(card,clone(def),{id:String(this.value(s.value,c)),ap:def.ap??def.cost??1,legacy:!native});delete card.ruleCost;}
      else this.moveCard(card,s.operation==='exhaust'?'exhaust':s.mode??'hand');results.push(card.uid);
    }return results;
  }
  private summon(s:RuleStep,c:Context):string {
    const live=this.g.allies.filter((a:any)=>a.hp>0&&(a.isSummon||a.legacySummon));if(live.length>=2){const old=[...live].sort((a,b)=>a.expiresRound-b.expiresRound)[0];old.hp=0;this.emit('summon_removed',{sourceId:c.owner.id,targetId:old.id});}
    const inherit=s.inherit??{hp:.3,attack:.7,defense:.5,speed:1},id='rule-summon:'+ ++this.memory.sequence;
    const pet={id,name:s.name??'自定义召唤物',side:c.owner.side,level:c.owner.level,ownerId:c.owner.id,ruleSummon:clone(s.program??{...c.program,rules:[]}),isSummon:true,slot:live.length%2,bornRound:this.g.round,expiresRound:this.g.round+Math.max(1,num(this.value(s.turns??3,c))),hp:Math.max(1,c.owner.maxHp*(inherit.hp??.3)),maxHp:Math.max(1,c.owner.maxHp*(inherit.hp??.3)),shield:0,stats:Object.fromEntries(['attack','defense','speed','crit','critDamage','ehr','res'].map(k=>[k,this.g.stat(c.owner,k)*(inherit[k]??1)])),buffs:[],debuffs:[],dots:[],resources:{},flags:{},cooldowns:{},skills:[],star:c.star};this.g.ensureActor(pet);this.g.allies.push(pet);this.register(pet.ruleSummon);this.emit('summon_created',{sourceId:c.owner.id,targetId:id});return id;
  }
  nativeStatus(source:any,target:any,id:string,value:number,turns=1,chance=100,star=1,extra:any={}):boolean {
    const def=workshopBuiltinStatus(id);if(!def)throw Error('未知状态效果：'+id);
    const translated=normalizeLegacyStatus(id,{value});const template={...def.template};delete template.condition;delete template.target;const canonical=String(template.canonicalStatus??translated.key);
    if(canonical==='swift'){const count=Math.max(1,Math.floor(value));if(!Number.isSafeInteger(count)||this.steps+count>4096)throw Error('本次施加层数超过执行保护范围');this.steps+=count;}
    const opts={star,skipEffectRoll:extra.skipEffectRoll,skillId:extra.ruleModifier};
    if(def.kind==='dot')return this.g.addDot(source,target,{...template,kind:'dot',status:id,canonicalStatus:canonical,atk:value,stacks:1,baseChance:chance,...extra},opts);
    const resolved=extra.valueUnit??def.unit;return this.g.addStatus(source,target,{...template,kind:def.kind,status:id,canonicalStatus:canonical,ruleNative:true,value:resolved==='percent'?translated.value:value,valueUnit:resolved,turns:turns<0?Infinity:turns,stacks:translated.key==='swift'?Math.max(1,Math.floor(value)):undefined,baseChance:chance,legacy:true,legacyKey:id,...extra},opts);
  }
  applyStatus(program:RuleProgram,id:string,source:any,target:any,c?:Context,step?:RuleStep):any {
    this.register(program);const def=program.statuses.find(x=>x.id===id);if(!def)throw Error('自定义状态不存在：'+id);
    const context=c??this.context(program,source,{targetId:target.id}),hostile=source.side!==target.side;
    if(hostile&&!this.g.effectSucceeds(source,target,{status:program.id+':'+id,baseChance:step?.chance===undefined?def.baseChance:num(this.value(step.chance,context))}))return null;
    const data=Object.fromEntries(Object.entries({...def.data,...step?.data}).map(([k,v])=>[k,clone(this.value(v,context))]));
    const same=[...target.buffs,...target.debuffs].filter((x:any)=>x.ruleProgram===program.id&&x.ruleStatus===id);
    if(def.stacking==='add'&&same.length){for(const [k,v] of Object.entries(data))same[0].ruleData[k]=typeof v==='number'?num(same[0].ruleData[k])+v:clone(v);this.syncModifiers();return same[0];}
    if(def.stacking==='strongest'&&same.some((x:any)=>num(x.ruleData.value??x.ruleData.remaining)>=num(data.value??data.remaining)))return same[0];
    if(def.stacking==='replace'||def.stacking==='strongest')for(const old of same)this.removeStatus(target,old,'replace');
    const turns=step?.turns===undefined?def.turns:num(this.value(step.turns,context)),instance='rule-status:'+ ++this.memory.sequence;
    const status={kind:def.polarity,status:'workshop_rule:'+program.id+':'+id+':'+instance,canonicalStatus:'workshop_rule:'+program.id+':'+id+':'+instance,ruleProgram:program.id,ruleStatus:id,ruleInstance:instance,ruleLabel:def.name,ruleData:data,ruleStar:context.star,sourceId:source.id,sourceActor:source,value:1,valueUnit:'count',turns,expireMode:'end',expireAtPhase:turns<0?Infinity:target.phaseCount+Math.max(1,turns),cleanseable:def.cleanseable,dispellable:def.dispellable};
    const control=def.modifiers.find(m=>['freeze','petrify','stun','sleep','hard_control'].includes(String(workshopBuiltinStatus(m.status)?.template?.canonicalStatus??normalizeLegacyStatus(m.status,{}).key)));
    if(control&&target.phaseCount+1<=(target.flags.controlImmuneUntil??-1))return null;
    if(def.polarity==='buff'&&!control){status.expireMode='start';if(source.side===target.side&&target!==source&&target.flags.phaseRound!==this.g.round&&turns>=0)status.expireAtPhase++;}
    (def.polarity==='buff'?target.buffs:target.debuffs).push(status);this.syncModifiers();this.emit('status_added',{sourceId:source.id,targetId:target.id,statusId:id,statusInstance:instance});return status;
  }
  private removeStatus(owner:any,status:any,reason:string):void{for(const pool of ['buffs','debuffs','dots'])owner[pool]=owner[pool].filter((x:any)=>x!==status&&x.ruleParent!==status.ruleInstance);const p=this.memory.programs[status.ruleProgram];if(p){const c=this.context(p,owner,{type:'status_removed',sourceId:status.sourceId,targetId:owner.id,statusId:status.ruleStatus,reason},status);for(const r of p.statuses.find((s:RuleStatus)=>s.id===status.ruleStatus)?.rules??[])if(r.event==='status_removed')this.run(r,c);}}
  private syncModifiers():void {
    if(this.syncing)return;this.syncing=true;try{for(const owner of this.actors()){
      const parents=[...owner.buffs,...owner.debuffs].filter((s:any)=>s.ruleInstance),ids=new Set(parents.map((s:any)=>s.ruleInstance));
      for(const pool of ['buffs','debuffs','dots'])owner[pool]=owner[pool].filter((x:any)=>!x.ruleParent||ids.has(x.ruleParent));
      for(const status of parents){const p=this.memory.programs[status.ruleProgram],def=p?.statuses.find((s:RuleStatus)=>s.id===status.ruleStatus);if(!def)continue;const c=this.context(p,owner,{},status);def.modifiers.forEach((m:RuleStatus['modifiers'][number],index:number)=>{
        const token=status.ruleInstance+':'+index,child=[...owner.buffs,...owner.debuffs,...owner.dots].find((x:any)=>x.ruleModifier===token),active=m.condition===undefined||this.value(m.condition,c);
        if(!active){status.ruleApplied=(status.ruleApplied??[]).filter((x:string)=>x!==token);for(const pool of ['buffs','debuffs','dots'])owner[pool]=owner[pool].filter((x:any)=>x.ruleModifier!==token);return;}
        if(child){child.value=num(this.value(m.value,c));child.expireAtPhase=status.expireAtPhase;return;}
        const applied=status.ruleApplied??=([]);if(applied.includes(token))return;applied.push(token);
        const all=[...owner.buffs,...owner.debuffs,...owner.dots];this.nativeStatus(c.source,owner,m.status,num(this.value(m.value,c)),status.turns,100,status.ruleStar,{skipEffectRoll:true,ruleParent:status.ruleInstance,ruleModifier:token,ruleHidden:true,cleanseable:false,dispellable:false,valueUnit:m.unit});
        for(const x of [...owner.buffs,...owner.debuffs,...owner.dots])if(!all.includes(x)){x.ruleParent=status.ruleInstance;x.ruleModifier=token;x.ruleHidden=true;if(x.kind!=='dot')x.expireAtPhase=status.expireAtPhase;}
      });}
    }}finally{this.syncing=false;}
  }
  private nativeEvent(type:string,event:any):void {
    const g=this.g,owner=this.actors().find(a=>a.id===event.targetId);if(!owner)return;
    for(const status of [...owner.buffs,...owner.debuffs].filter((s:any)=>s.ruleNative)){
      if(type==='turn_start'){
        const value=num(status.value);
        if(status.legacyKey==='ap_regen'){if(owner===g.player)g.controller.makeContext(g).resource('AP',value);else owner.ap=(owner.ap??0)+value;}
        if(status.legacyKey==='draw_regen'&&owner===g.player)g.controller.draw(g,value,true);
        if(status.legacyKey==='mp_regen')owner.resources.mp=(owner.resources.mp??0)+value;
      }
      if(type!=='after_damage'||event.dot||event.secondary||num(event.damage)<=0)continue;
      const source=this.actors().find(a=>a.id===event.sourceId);if(!source||source.hp<=0||source.side===owner.side)continue;
      if(status.effects?.length&&status.trigger&&status.ruleFiredRound!==g.round){status.ruleFiredRound=g.round;const parent=g.action;g.action=null;try{g.beginAction(owner,{id:status.ruleModifier??status.status,name:status.status});for(const effect of status.effects){g.applyEffects([{...effect,condition:undefined,target:'enemy'}],owner,source,{secondary:true,star:status.ruleStar??1});}}finally{g.endAction();g.action=parent;}}
      if(status.legacyKey==='on_hit_draw'&&owner===g.player)g.controller.draw(g,Math.max(1,num(status.value)),true);
      if(['thorns','defense_reflect','counterattack'].includes(status.legacyKey)&&this.depth<4){const fixed=status.legacyKey!=='counterattack',amount=status.legacyKey==='thorns'?num(status.value):status.legacyKey==='defense_reflect'?Math.round(num(event.preHitShield)*.8*Math.min(150,g.stat(owner,'defense'))/100):Math.round(g.stat(owner,'attack')*.1);if(amount>0)this.withBudget(()=>g.damage(owner,source,{kind:'damage',flat:amount,crit:!fixed},{secondary:true,forceHit:fixed?true:undefined,ignoreDefense:fixed?1:0,ignoreDirectBonuses:fixed,flatScale:1,star:1,origin:'workshop_response'}));}
    }
  }
  attach():void {
    const g=this.g;this.original={rawHit:g.rawHit,damage:g.damage,shield:g.shield,beginPhase:g.beginPhase,endPhase:g.endPhase,endSide:g.endSide,cleanse:g.cleanse,dispel:g.dispel};
    g.workshopProgramEvent=(type:string,event:any)=>this.emit(type,event);
    g.damage=(source:any,target:any,e:any,opts:any={})=>{this.syncModifiers();const before:any={sourceId:source.id,targetId:target.id,amount:g.calcBase(source,target,e,opts),originalAmount:g.calcBase(source,target,e,opts),origin:opts.origin??'attack'};this.emit('before_damage',before);if(before.cancel||num(before.amount)<=0)return {damage:0,hpDamage:0,shieldDamage:0,hit:!before.cancel,crits:0};const out=this.original.damage(source,this.actors().find(a=>a.id===before.targetId)??target,{...e,flat:num(before.amount),atk:0,def:0,maxHp:0,maxHpRatio:0,hpRatio:0},{...opts,star:1,flatScale:1,scale:1,workshopBaseOverride:num(before.amount)});if(!out.hit)this.emit('dodge',{sourceId:source.id,targetId:target.id});if(out.crits)this.emit('critical',{sourceId:source.id,targetId:target.id,...out});return out;};
    g.rawHit=(source:any,target:any,amount:number,opts:any={})=>{const hp=target.hp,shield=target.shield;const out=this.original.rawHit(source,target,amount,opts);this.emit('after_damage',{sourceId:source.id,targetId:target.id,amount:out.hpDamage,...out,preHitShield:shield,dot:Boolean(opts.dot)});if(shield>0&&target.shield<=0)this.emit('shield_broken',{sourceId:source.id,targetId:target.id,amount:shield});if(hp>0&&target.hp<=0){this.emit('death',{sourceId:source.id,targetId:target.id});if(target.isSummon||target.legacySummon)this.emit('summon_removed',{sourceId:source.id,targetId:target.id});}return out;};
    g.shield=(source:any,target:any,e:any,opts:any={})=>{const amount=typeof e==='number'?e:g.calcBase(source,target,e,opts),event=this.emit('before_shield',{sourceId:source.id,targetId:target.id,amount});if(event.cancel)return 0;const destination=this.actors().find(a=>a.id===event.targetId)??target;const shieldEffect=typeof e==='number'?Math.max(0,num(event.amount)):{...e,flat:Math.max(0,num(event.amount)),atk:0,def:0,maxHp:0,maxHpRatio:0,hpRatio:0};const got=this.original.shield(source,destination,shieldEffect,{...opts,star:1,flatScale:1,scale:1});this.emit('after_shield',{sourceId:source.id,targetId:target.id,amount:got});return got;};
    const capture=()=>this.actors().flatMap(a=>[...a.buffs,...a.debuffs].filter(s=>s.ruleInstance).map(s=>({a,s})));
    const finish=(before:any[],reason:string)=>{for(const {a,s} of before)if(![...a.buffs,...a.debuffs].includes(s))this.removeStatus(a,s,reason);this.syncModifiers();};
    for(const operation of ['cleanse','dispel'])g[operation]=(target:any,n:any)=>{const before=capture(),out=this.original[operation](target,n);finish(before,operation);return out;};
    g.beginPhase=(a:any)=>{const before=capture();this.syncModifiers();const allowed=this.original.beginPhase(a);finish(before,'expired');if(allowed&&!g.workshopStartingPlayer)this.emit('turn_start',{sourceId:a.id,targetId:a.id});return allowed;};
    g.endPhase=(a:any)=>{this.emit('turn_end',{sourceId:a.id,targetId:a.id});const before=capture(),out=this.original.endPhase(a);finish(before,'expired');return out;};
    g.endSide=(side:string)=>{const before=capture(),out=this.original.endSide(side);finish(before,'expired');return out;};
    const draw=g.controller.draw;g.controller.draw=(game:any,n:number,...rest:any[])=>{const before=new Set(game.player.hand.map((c:any)=>c.uid)),out=draw(game,n,...rest);for(const card of game.player.hand.filter((c:any)=>!before.has(c.uid)))this.emit('draw',{sourceId:game.player.id,targetId:game.player.id,cardUid:card.uid,cardId:card.id});return out;};
  }
}
