import { ruleEvent as event, ruleVar as variable, ruleMath as math, type RuleProgram, type RuleStatus, type WorkshopRule } from '@/workshop-program';
const rule=(id:string,eventName:string,steps:WorkshopRule['steps']):WorkshopRule=>({id,event:eventName,priority:0,once:'never',costs:[],steps});
const status=(id:string,name:string):RuleStatus=>({id,name,polarity:'buff',turns:-1,cleanseable:true,dispellable:true,baseChance:100,stacking:'independent',data:{},modifiers:[],rules:[]});
const program=(id:string,name:string,definition:RuleStatus,target='target'):RuleProgram=>({version:2,id:'template.'+id,name,variables:[],statuses:[definition],rules:[rule('apply','cast',[{type:'apply_status',status:definition.id,target}])]});

const contract=status('contract','生命之契');contract.cleanseable=false;contract.data={remaining:200};
contract.modifiers=[{status:'vulnerable',value:.2,unit:'ratio'}];
contract.rules=[rule('absorb','before_heal',[
  {type:'set',key:'before',value:variable('status','remaining')},
  {type:'set',key:'incoming',value:event('amount')},
  {type:'set',key:'absorbed',value:math('min',event('amount'),variable('status','remaining'))},
  {type:'add',scope:'status',key:'remaining',value:math('mul',-1,variable('local','absorbed'))},
  {type:'event_set',field:'amount',value:math('sub',event('amount'),variable('local','absorbed'))},
  {type:'if',condition:math('gt',variable('local','incoming'),variable('local','before')),steps:[{type:'remove_status',status:'self',target:'self'}]},
])];
const stored=status('stored','蓄伤护符');stored.data={stored:0};stored.rules=[
  rule('store','after_damage',[{type:'add',scope:'status',key:'stored',value:math('mul',event('hpDamage'),.3)}]),
  rule('release','turn_start',[{type:'shield',target:'self',value:variable('status','stored')},{type:'set',scope:'status',key:'stored',value:0}]),
];
const overflow=status('overflow','余辉结界');overflow.rules=[rule('convert','after_heal',[{type:'shield',target:'self',value:event('overflow')}])];
const transfer=status('transfer','传递印记');transfer.polarity='debuff';transfer.data={remaining:3};transfer.modifiers=[{status:'vulnerable',value:.1,unit:'ratio'}];
transfer.rules=[rule('transfer','death',[{type:'foreach',target:{op:'targets',key:'allies',scope:'lowest_hp'},steps:[{type:'apply_status',status:'transfer',target:'target',data:{remaining:variable('status','remaining')}}]}])];
const posture=status('posture','守护姿态');posture.turns=2;posture.modifiers=[{status:'defense_up',value:.3,unit:'ratio'}];
posture.rules=[rule('guard','before_damage',[{type:'event_set',field:'amount',value:math('mul',event('amount'),.8)}])];
const stone=status('stone','石化');stone.turns=1;stone.modifiers=[{status:'freeze',value:1,unit:'count'}];
const guardian:RuleProgram={version:2,id:'template.guardian',name:'守护傀儡',variables:[],statuses:[],rules:[
  {...rule('protect','turn_start',[{type:'native_status',target:'self',status:'taunt',value:1,turns:1},{type:'native_status',target:'self',status:'direct_damage_reduction',value:.2,turns:1}]),priority:100,cooldown:3,condition:math('lt',{op:'stat',target:'summoner',key:'hp'},math('mul',{op:'stat',target:'summoner',key:'hpMax'},.5))},
  rule('attack','turn_start',[{type:'damage',target:{op:'targets',key:'enemies',scope:'lowest_hp'},value:math('add',10,{op:'stat',target:'self',key:'attack'})}]),
]};
export const WORKSHOP_RULE_EXAMPLES:RuleProgram[]=[
  program('contract','生命之契',contract),program('stored','蓄伤护符',stored,'self'),program('overflow','治疗转护盾',overflow,'self'),
  program('transfer','死亡传递印记',transfer),program('posture','守护姿态',posture,'self'),program('stone','石化：复用冻结效果',stone),
  {version:2,id:'template.summon',name:'守护傀儡协作',variables:[],statuses:[],rules:[rule('summon','cast',[{type:'summon',name:'守护傀儡',turns:3,inherit:{hp:.4,attack:.7,defense:.7,speed:1},program:guardian}])]},
];
