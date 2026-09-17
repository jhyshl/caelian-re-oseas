import type { CardDefinition, CardEffect } from '@/content/types';
import { normalizeRuleProgram, describeRuleExpression, type RuleExpression, type RuleProgram } from '@/workshop-program';
import type { WorkshopObjectCatalog } from '@/workshop-object-catalog';
import { scaleWorkshopCard, type WorkshopStarScaling } from '@/workshop-stars';
import { formatNumber } from '@/ui/format-number';

export interface CardDescriptionBinding {
  label: string;
  expression?: RuleExpression;
  starExpressions?: RuleExpression[];
  programId?: string;
  stars?: number[];
  kind: 'formula' | 'name';
  objectKind?: keyof WorkshopObjectCatalog;
  objectId?: string;
}
export function normalizeDescriptionBindings(raw: unknown): CardDescriptionBinding[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 32) throw new Error('每张卡牌最多配置 32 个说明引用');
  const labels = new Set<string>();
  return raw.map(value => {
    const row = value as CardDescriptionBinding;
    const label = String(row?.label ?? '').trim();
    if (!label || label.length > 40 || /[{}]/.test(label) || labels.has(label)) throw new Error('说明引用名称须唯一，长度 1–40 字，不能含花括号');
    labels.add(label);
    if (row.kind === 'name') {
      if (!['cards','statuses','resources'].includes(row.objectKind ?? '') || !row.objectId) throw new Error('请选择说明中要引用的对象');
      return {label, kind: 'name', objectKind: row.objectKind, objectId: String(row.objectId).slice(0,240)};
    }
    const program = normalizeRuleProgram({version:2,id:'description',name:'说明',variables:[],statuses:[],rules:[{id:'preview',event:'cast',priority:0,once:'never',costs:[],steps:[{type:'set',key:'value',value:row.expression ?? 0}]}]});
    const starExpressions=row.starExpressions?.slice(0,3).map(expression=>normalizeDescriptionBindings([{label:'值',kind:'formula',expression}])[0]!.expression!);
    return {label,kind:'formula',...(starExpressions?{starExpressions}:{}),expression:program.rules[0]!.steps[0]!.value,programId:String(row.programId ?? '').slice(0,100),...(row.stars ? {stars:row.stars.slice(0,3).map(n => Number.isFinite(n) ? n : 1)} : {})};
  });
}
export function cardFormulaChoices(card: Pick<CardDefinition, 'effects'> & { starScaling?:WorkshopStarScaling; type?:string }): CardDescriptionBinding[] {
  const choices: CardDescriptionBinding[] = [];
  const add = (expression: RuleExpression, label: string, programId?: string, stars?: number[]) => choices.push({kind:'formula',label:label + (choices.length+1),expression,programId,stars});
  const scanSteps = (steps: Array<Record<string, any>>, program: RuleProgram) => {
    for (const step of steps) {
      if (['damage','heal','shield'].includes(step.type)) add(step.value ?? 0, ({damage:'伤害',heal:'治疗',shield:'护盾'} as Record<string,string>)[step.type]!,program.id,step.mode==='dot'||step.mode==='recorded'?[1,1,1]:step.stars ?? [1,1.1,1.2]);
      scanSteps(step.steps ?? [],program); scanSteps(step.otherwise ?? [],program);
    }
  };
  const basicFormula=(effect:CardEffect,ratio=1):RuleExpression=>{
    const scaling=effect.scaling as {stat:string;percent:number}|undefined;
    const terms:RuleExpression[]=[Number(effect.value??0),{op:'mul',args:[{op:'stat',key:scaling?.stat??'attack'},Number(scaling?.percent??0)/100]}];
    if(effect.type==='damage'&&card.type==='attack'&&(!card.starScaling||!scaling))terms.push({op:'floor',args:[{op:'mul',args:[{op:'stat',key:'attack'},.35*ratio]}]});
    return {op:'add',args:terms};
  };
  const scan = (effects: CardEffect[]) => effects.forEach(effect => {
    if (effect.type === 'rule_program') {const p=effect.program as RuleProgram; p.rules.forEach(rule=>scanSteps(rule.steps,p));}
    if (['damage','heal','shield','damage_from_shield'].includes(effect.type)) {
      const e:RuleExpression=effect.type==='damage_from_shield'?{op:'mul',args:[{op:'stat',key:'shield'},Number(effect.ratio??0)]}:basicFormula(effect);
      add(e,({damage:'伤害',heal:'治疗',shield:'护盾',damage_from_shield:'护盾伤害'} as Record<string,string>)[effect.type]!);
      if(card.starScaling&&effect.type!=='damage_from_shield')choices[choices.length-1]!.starExpressions=[1,2,3].map(star=>{
        const scaled=scaleWorkshopCard({name:'',type:'skill',cost:0,rarity:'common',description:'',custom:true,effects:[effect],starScaling:card.starScaling},star).effects[0]!;
        return basicFormula(scaled,card.starScaling!.levels[star-1]!.ratio);
      });
    }
    for(const key of ['effects','then_effects','else_effects']) if(Array.isArray(effect[key]))scan(effect[key] as CardEffect[]);
  });
  scan(card.effects);return choices;
}
export function descriptionObjectName(id: string, objects: WorkshopObjectCatalog): string {
  return [...objects.cards,...objects.statuses,...objects.resources].find(o=>o.id===id)?.name ?? '未命名对象';
}
export function renderCardDescription(card: Pick<CardDefinition,'description'|'descriptionBindings'>, objects: WorkshopObjectCatalog, evaluate?: (binding:CardDescriptionBinding)=>unknown, stars=1): string {
  const bindings=card.descriptionBindings??[];
  let text=card.description??'';
  text=text.replace(/\{\{([^{}]+)\}\}/g,(_match,label:string)=>{
    const b=bindings.find(row=>row.label===label.trim());if(!b)return '［引用未配置］';
    if(b.kind==='name')return objects[b.objectKind??'cards'].find(o=>o.id===b.objectId)?.name??'未命名对象';
    const resolved={...b,expression:b.starExpressions?.[Math.min(2,Math.max(0,stars-1))]??b.expression};
    const raw=evaluate?.(resolved);
    if(typeof raw==='number'&&Number.isFinite(raw))return formatNumber(raw * (b.stars?.[Math.min(2,Math.max(0,stars-1))]??1));
    const formula=String(describeRuleExpression(resolved.expression));
    return formula.replace(/「([^」]+)」/g,(_m,id:string)=>'「'+descriptionObjectName(id,objects)+'」');
  });
  // Old descriptions may already contain editor-generated identifiers.
  for(const object of [...objects.cards,...objects.statuses,...objects.resources].sort((a,b)=>b.id.length-a.id.length)) if(object.id.length>3)text=text.split(object.id).join(object.name);
  return text;
}
