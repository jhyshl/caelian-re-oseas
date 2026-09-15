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
  {version:2,id:'template.state_spread',name:'积木组合：按种类扩散状态',variables:[],statuses:[],rules:[rule('spread','cast',[
    {type:'foreach_item',value:{op:'unique',key:'type',args:[{op:'statuses',key:'dot',target:'selected_target'}]},steps:[
      {type:'native_status',statusFrom:{op:'item',key:'type'},target:{op:'targets',key:'enemies',excludeSelected:true},value:.35,turns:2,maxStacks:3,chance:100},
    ]},
  ])]},
  {version:2,id:'template.state_detonate',name:'积木组合：读取原伤害并移除状态',variables:[],statuses:[],rules:[rule('detonate','cast',[
    {type:'set',scope:'local',key:'待处理状态',value:{op:'statuses',key:'dot',target:'selected_target'}},
    {type:'foreach_item',value:variable('local','待处理状态'),steps:[
      {type:'damage',mode:'dot',value:{op:'item',key:'damage'},source:{op:'item',key:'sourceId'},sourceLevel:{op:'item',key:'sourceLevel'},target:{op:'item',key:'targetId'}},
    ]},
    {type:'remove_status',selection:variable('local','待处理状态')},
  ])]},
  {version:2,id:'template.lowest_two',name:'积木组合：治疗生命最低的两名队友',variables:[],statuses:[],rules:[rule('heal','cast',[
    {type:'foreach',target:{op:'take',args:[{op:'sort_list',args:[{op:'targets',key:'allies'}],scope:'asc',value:{op:'item',key:'hp'}},2]},steps:[{type:'heal',target:'target',value:50}]},
  ])]},
  {version:2,id:'template.shared_heat',name:'积木组合：跨卡牌共享热量',variables:[{name:'热量',scope:'shared',initial:0}],statuses:[],rules:[rule('heat','cast',[
    {type:'add',scope:'shared',key:'热量',value:1},
    {type:'damage',target:'target',value:math('mul',30,variable('shared','热量')),crit:false},
  ])]},
  {version:2,id:'template.transfer_debuff',name:'积木组合：转移自身减益',variables:[],statuses:[],rules:[rule('transfer','cast',[
    {type:'copy_status',selection:{op:'statuses',key:'debuff',target:'self'},target:'target',operation:'move',preserveSource:true},
    {type:'copy_status',selection:{op:'statuses',key:'dot',target:'self'},target:'target',operation:'move',preserveSource:true},
  ])]},
];

WORKSHOP_RULE_EXAMPLES.push(
  { version:2,id:'template.random_hits',name:'积木组合：每段随机弹射',variables:[],statuses:[],rules:[rule('bounce','cast',[
    {type:'repeat',count:5,steps:[{type:'foreach',target:{op:'sample',args:[{op:'targets',key:'enemies'},1]},steps:[
      {type:'damage',target:'target',value:math('add',10,math('mul',.3,{op:'stat',target:'self',key:'attack'})),hits:1},
    ]}]},
  ])]},
  { version:2,id:'template.dot_statistics',name:'积木组合：持续伤害统计与资源换算',variables:[{name:'DOT总伤害',scope:'shared',initial:0},{name:'DOT结算次数',scope:'shared',initial:0}],statuses:[],rules:[
    {...rule('record','after_damage',[
      {type:'add',scope:'shared',key:'DOT总伤害',value:event('damage')},
      {type:'add',scope:'shared',key:'DOT结算次数',value:event('count')},
    ]),eventScope:'all',condition:event('dot')},
    rule('convert','turn_start',[
      {type:'resource',target:'self',key:'energy',value:math('floor',math('div',variable('shared','DOT总伤害'),100))},
      {type:'set',scope:'shared',key:'DOT总伤害',value:0},
    ]),
  ]},
  { version:2,id:'template.selected_card',name:'积木组合：指定卡牌检索与改费',variables:[],statuses:[],rules:[rule('select','cast',[
    {type:'set',key:'指定牌',value:{op:'card_definition',key:'th_spark_arc'}},
    {type:'set',key:'选中实例',value:{op:'card_items',key:'deck',value:math('eq',{op:'item',key:'cardId'},variable('local','指定牌'))}},
    {type:'card',operation:'draw',selection:variable('local','选中实例'),count:1},
    {type:'card',operation:'cost',selection:variable('local','选中实例'),field:'add',value:-1,count:1},
  ])]},
);
