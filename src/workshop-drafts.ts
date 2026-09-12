import { emptyRuleProgram } from '@/workshop-program';

/** Workshop drafts are JSON data; this also copies nested Vue proxies and old WebViews. */
export function cloneWorkshopData<T>(value:T):T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type DraftObject = Record<string, any>;
function object(value:unknown,path:string):DraftObject {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${path}的数据不完整，请检查这一项`);
  return value as DraftObject;
}
function list(value:unknown,path:string):unknown[] {
  if(value==null)return [];
  if(!Array.isArray(value))throw Error(`${path}应为列表，请检查这一项`);
  return value;
}

/** Restore editable containers only. Do not validate unfinished gameplay values or discard effects. */
export function prepareWorkshopDraft(value:unknown):DraftObject {
  const source=object(cloneWorkshopData(value),'草稿内容');
  let nodes=0;
  function visit(path:string,depth:number):void {
    if(++nodes>10000||depth>40)throw Error(`${path}嵌套过深或项目过多，无法打开`);
  }
  function expressions(value:unknown,path:string,depth:number):void {
    if(!value||typeof value!=='object')return;
    visit(path,depth);const entry=object(value,path);
    if(entry.args!=null)list(entry.args,path+'的公式参数').forEach((arg,i)=>expressions(arg,`${path}的参数${i+1}`,depth+1));
    for(const key of ['value','target'])if(entry[key]!==undefined)expressions(entry[key],path+'的'+key,depth+1);
  }
  function steps(value:unknown,path:string,depth:number):DraftObject[] {
    return list(value,path).map((item,i)=>{
      const label=`${path}第${i+1}项`,step=object(item,label);visit(label,depth);
      for(const key of ['steps','otherwise'])if(step[key]!=null||['if','foreach','repeat','delay'].includes(step.type))step[key]=steps(step[key],label+'的'+key,depth+1);
      if(step.type==='summon')step.program=program(step.program,label+'的召唤物规则',depth+1);
      for(const key of ['data','inherit'])if(step[key]!=null)object(step[key],label+'的'+key);
      for(const key of ['value','target','turns','maxStacks','chance','hits','condition','count','filter'])expressions(step[key],label+'的'+key,depth+1);
      return step;
    });
  }
  function rules(value:unknown,path:string,depth:number):DraftObject[] {
    return list(value,path).map((item,i)=>{
      const label=`${path}第${i+1}项`,rule=object(item,label);visit(label,depth);
      rule.costs=steps(rule.costs,label+'的代价',depth+1);rule.steps=steps(rule.steps,label+'的积木',depth+1);
      expressions(rule.condition,label+'的条件',depth+1);return rule;
    });
  }
  function program(value:unknown,path:string,depth:number):DraftObject {
    const p:DraftObject=value==null?emptyRuleProgram():object(value,path);visit(path,depth);
    p.version??=2;p.id??=emptyRuleProgram().id;p.name??='自定义规则';
    p.variables=list(p.variables,path+'的数据记录').map((item,i)=>object(item,`${path}的数据记录第${i+1}项`));
    p.statuses=list(p.statuses,path+'的状态').map((item,i)=>{
      const label=`${path}的状态第${i+1}项`,status=object(item,label);visit(label,depth+1);
      status.data=status.data==null?{}:object(status.data,label+'的数据');
      status.modifiers=list(status.modifiers,label+'的复用效果').map((item,j)=>{
        const modifier=object(item,`${label}的复用效果第${j+1}项`);expressions(modifier.value,label+'的复用公式',depth+1);expressions(modifier.condition,label+'的生效条件',depth+1);return modifier;
      });
      status.rules=rules(status.rules,label+'的规则',depth+1);return status;
    });
    p.rules=rules(p.rules,path+'的规则',depth+1);return p;
  }
  function effects(value:unknown,path:string,depth=0):DraftObject[] {
    return list(value,path).map((item,i)=>{
      const label=`${path}第${i+1}项`,effect=object(item,label);visit(label,depth);
      if(typeof effect.type!=='string'||!effect.type)throw Error(`${label}缺少效果类型`);
      if(effect.type==='rule_program')effect.program=program(effect.program,label+'的组合规则',depth+1);
      if(effect.type==='conditional_group') {
        effect.conditions=list(effect.conditions,label+'的条件').map((item,j)=>object(item,`${label}的条件第${j+1}项`));
        effect.then_effects=effects(effect.then_effects,label+'的则效果',depth+1);effect.else_effects=effects(effect.else_effects,label+'的否则效果',depth+1);
      }
      if(effect.type==='summon')effect.skills=list(effect.skills,label+'的召唤技能').map((item,j)=>{
        const skill=object(item,`${label}的召唤技能第${j+1}项`);skill.effects=effects(skill.effects,`${label}的召唤技能第${j+1}项效果`,depth+1);return skill;
      });
      return effect;
    });
  }
  if(source.talent!=null){source.talent=object(source.talent,'天赋');source.talent.effects=effects(source.talent.effects,'天赋效果');}
  source.cards=list(source.cards,'卡牌').map((item,i)=>{
    const card=object(item,`第${i+1}张卡牌`),label=`卡牌「${String(card.name??i+1)}」`;
    card.effects=effects(card.effects,label+'的效果');
    if(card.starScaling!=null){const stars=object(card.starScaling,label+'的星级配置');stars.levels=list(stars.levels,label+'的星级系数').map((item,j)=>object(item,`${label}第${j+1}星系数`));}
    return card;
  });
  return source;
}
