import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = new URL(
  '../docs/quest-drafts/all_storylines.v2.review.json',
  import.meta.url,
);
const outputPath = new URL(
  '../public/managed-content/quests/alpha.json',
  import.meta.url,
);

const review = JSON.parse(await readFile(sourcePath, 'utf8'));

const metadata = {
  main_silvermoon_moonlit_invitation: {
    minimumLevel: 14,
    availableRegions: ['银月之城'],
    publicSummary: '从西西里的追杀与神秘血浆开始，调查银月城月宴背后的黑潮。',
  },
  main_niyasos_failed_sacrifice: {
    minimumLevel: 10,
    availableRegions: ['奈亚索斯城'],
    publicSummary: '追查四桩彼此牵连的案件，并走入笼罩奈亚索斯的集体梦境。',
    collectible: '海妖的眼泪',
  },
  main_abyss_atlantis_echo: {
    minimumLevel: 10,
    availableRegions: ['阿必塞海'],
    publicSummary: '深入沉没的亚特兰蒂斯，在旧日遗迹中寻找深海真相。',
    collectible: '诡异的蛇蛋碎片',
    prerequisiteQuestIds: ['main_niyasos_failed_sacrifice'],
  },
  main_solavia_sacred_underground: {
    minimumLevel: 6,
    availableRegions: ['索拉维亚', '索拉姆'],
    publicSummary: '从沃西微失踪案追入圣心大教堂地下，揭开被信仰掩埋的真相。',
    collectible: '虚假的天羽',
  },
  main_ethera_ashen_ancient_tree: {
    minimumLevel: 8,
    availableRegions: ['艾瑟拉森林'],
    publicSummary: '调查焦木林与古树根系的异变，帮助森林度过灰烬之后的危机。',
    collectible: '琥珀之精',
  },
  main_hearth_embers: {
    minimumLevel: 12,
    availableRegions: ['炉心城'],
    publicSummary: '沿着旧酒馆、封存档案与意识核心，复原炉心城百年前的事故。',
    collectible: '拟造核心',
  },
  main_academy_anniversary_preparation: {
    minimumLevel: 1,
    availableRegions: ['圣德里安学院'],
    publicSummary: '与凯利安完成三项周年庆巡查，并处理无为广场的失控教学魔像。',
    collectible: '校庆打卡册',
    rewards: [180, 260, 50],
  },
  side_flora_says: {
    minimumLevel: 1,
    availableRegions: ['伊拉亚城'],
    publicSummary: '帮助中央商业区的卖花女孩芙萝拉完成今天的心愿。',
    rewards: [120, 240, 45],
  },
};

const catalog = {
  schemaVersion: 2,
  channel: 'alpha',
  revision: '2026-08-06.1',
  quests: review.storylines.map(buildQuest),
};

await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

const count = catalog.quests.reduce(
  (total, quest) =>
    total +
    quest.stages.reduce(
      (stageTotal, stage) =>
        stageTotal +
        stage.scenes.reduce(
          (sceneTotal, scene) => sceneTotal + scene.beats.length,
          0,
        ),
      0,
    ),
  0,
);
console.log(`Built ${catalog.quests.length} quests with ${count} runtime beats.`);

function buildQuest(storyline) {
  const meta = metadata[storyline.id];
  if (!meta) throw new Error(`Missing quest metadata: ${storyline.id}`);
  const quest = {
    id: storyline.id,
    name: storyline.name,
    kind: storyline.kind,
    region: storyline.region,
    availableRegions: meta.availableRegions,
    prerequisiteQuestIds: meta.prerequisiteQuestIds ?? [],
    visibility: 'public',
    publicSummary: meta.publicSummary,
    minimumLevel: meta.minimumLevel,
    startBeatId: storyline.stages[0].scenes[0].beats[0].id,
    rewards: buildRewards(storyline.id, meta),
    pacing: {
      fullRoadmapVisible: true,
      currentBeatDetail: 'full',
      futureBeatDetail: 'summary_locked',
      defaultAdvance: 0,
      maxBeatAdvance: 1,
      maxSceneAdvance: 0,
      maxStageAdvance: 0,
    },
    nodeAliases: {},
    stages: storyline.stages.map((stage) => ({
      number: stage.number,
      id: stage.id,
      title: stage.title,
      mode: stage.scenes.length > 1 ? 'parallel' : 'linear',
      scenes: stage.scenes.map((scene, sceneIndex) => ({
        id: scene.id,
        title: scene.title,
        locations: scene.locations,
        sourceMaterial: buildSceneSource(storyline, stage, sceneIndex),
        beats: scene.beats.map((beat) => authorBeat(beat, stage, scene)),
      })),
    })),
  };

  if (storyline.id === 'main_academy_anniversary_preparation') {
    configureAcademy(quest);
  } else if (storyline.id === 'side_flora_says') {
    configureFlora(quest);
  } else {
    linkLinearly(quest);
  }
  return quest;
}

function buildRewards(questId, meta) {
  const [experience, gold, guildExperience] = meta.rewards ?? [300, 600, 80];
  const base = {
    experience,
    gold,
    guildExperience,
    collectibles: meta.collectible ? [meta.collectible] : [],
  };
  if (questId !== 'side_flora_says') {
    return { default: base, endings: {} };
  }
  return {
    default: { ...base, collectibles: [] },
    endings: {
      A: { ...base, collectibles: ['盛放的百合'] },
      B: {
        experience: 80,
        gold: 180,
        guildExperience: 25,
        collectibles: [],
      },
    },
  };
}

function authorBeat(beat, stage, scene) {
  return {
    id: beat.id,
    title: beat.title,
    roadmapSummary: beat.title,
    objective: beat.purpose,
    purpose: beat.purpose,
    completionGate: beat.completionGate,
    sceneContext: `当前阶段“${stage.title}”，当前场景“${scene.title}”。${beat.purpose}`,
    availableClues: [beat.purpose],
    forbiddenFacts: ['不得提前展开路线图中尚未解锁的后续节拍。', '不得替玩家决定行动、交付物品或战斗结果。'],
    transitions: [],
    status: 'active',
  };
}

function linkLinearly(quest) {
  const beats = allBeats(quest);
  for (let index = 0; index < beats.length - 1; index += 1) {
    linkJudge(beats[index], beats[index + 1]);
  }
  markReady(beats.at(-1));
}

function linkJudge(from, to, options = {}) {
  from.transitions.push({
    id: options.id ?? `advance-${from.id}`,
    to: to.id,
    authority: 'judge',
    condition: options.condition ?? from.completionGate,
    minConfidence: options.minConfidence ?? 0.84,
    ...(options.guards ? { guards: options.guards } : {}),
    ...(options.effects ? { effects: options.effects } : {}),
  });
}

function linkLocal(from, to, id, condition, localTrigger, effects) {
  from.transitions.push({
    id,
    to: to.id,
    authority: 'local',
    condition,
    minConfidence: 1,
    localTrigger,
    ...(effects ? { effects } : {}),
  });
}

function markReady(beat, ending) {
  beat.status = 'ready';
  beat.transitions = [];
  if (ending) beat.ending = ending;
}

function configureAcademy(quest) {
  const firstStage = quest.stages[0];
  const parallelStage = quest.stages[1];
  const finalStage = quest.stages[2];
  const branchScenes = [...parallelStage.scenes];
  const completedSceneIds = branchScenes.map((scene) => scene.id);
  const hub = {
    id: 'parallel-preparations-hub',
    title: '周年庆巡查清单',
    locations: ['中央广场', '魔药课教室', '炼金课教室', '餐厅'],
    parallelGroupId: 'academy-anniversary-preparations',
    beats: [
      {
        id: 'academy-parallel-hub',
        title: '选择下一项筹备工作',
        roadmapSummary: '从尚未完成的三项筹备工作中自由选择',
        objective: '查看尚未完成的周年庆筹备事项，并由玩家决定下一站。',
        purpose: '保留三项筹备的自由顺序；只引导玩家选择目的地，不替玩家作决定。',
        completionGate: '玩家明确选择了一个尚未完成的筹备场景，或三个场景已经全部由本地动作标为完成。',
        sceneContext: '玩家与凯利安持有周年庆巡查清单，可自由前往魔药课教室、炼金课教室或餐厅。已完成的事项不会重复开放。',
        availableClues: branchScenes.map((scene) => `${scene.title}：${scene.locations.join('、')}`),
        forbiddenFacts: ['不得替玩家选择下一站。', '不得重复进入已经完成的筹备场景。', '三个场景未全部完成前不得进入无为广场事故。'],
        transitions: [],
        status: 'active',
      },
    ],
  };
  parallelStage.scenes = [hub, ...branchScenes];
  parallelStage.mode = 'parallel';
  for (const scene of branchScenes) scene.parallelGroupId = 'academy-anniversary-preparations';

  const stageZeroBeats = firstStage.scenes.flatMap((scene) => scene.beats);
  linkJudge(stageZeroBeats[0], stageZeroBeats[1]);
  linkJudge(stageZeroBeats[1], hub.beats[0]);

  const hubBeat = hub.beats[0];
  for (const scene of branchScenes) {
    linkJudge(hubBeat, scene.beats[0], {
      id: `choose-${scene.id}`,
      condition: `玩家明确决定前往“${scene.title}”对应地点。`,
      minConfidence: 0.86,
      guards: { incompleteSceneId: scene.id },
    });
    for (let index = 0; index < scene.beats.length - 1; index += 1) {
      linkJudge(scene.beats[index], scene.beats[index + 1]);
    }
  }

  const [alice, ariel, lucius] = branchScenes;
  const aliceLast = alice.beats.at(-1);
  linkLocal(
    aliceLast,
    hubBeat,
    'claim-alice-materials',
    '玩家点击领取按钮，由本地系统发放三类安全材料。',
    {
      type: 'claim_items',
      items: [
        { itemId: '城郊药草', itemName: '城郊药草', count: 2 },
        { itemId: '治愈苔', itemName: '治愈苔', count: 1 },
        { itemId: '空玻璃瓶', itemName: '空玻璃瓶', count: 1 },
      ],
    },
    { completeSceneId: alice.id },
  );
  aliceLast.requiredAction = {
    type: 'claim_items',
    label: '收下材料',
    transitionId: 'claim-alice-materials',
    items: aliceLast.transitions[0].localTrigger.items,
    openPanel: 'inventory',
  };

  const arielLast = ariel.beats.at(-1);
  const equipment = {
    baseId: 'eq_amulet_hp',
    name: '生命护符',
    slot: 'accessory',
    rarity: 'common',
    stars: 1,
    count: 3,
    stats: { hp_max: 15 },
    description: '生命上限+15',
  };
  linkLocal(
    arielLast,
    hubBeat,
    'claim-ariel-charms',
    '玩家点击领取按钮，由本地系统发放三件一星生命护符。',
    { type: 'claim_equipment', equipment },
    { completeSceneId: ariel.id },
  );
  arielLast.requiredAction = {
    type: 'claim_equipment',
    label: '收下装备',
    transitionId: 'claim-ariel-charms',
    equipment,
    openPanel: 'inventory',
  };

  const luciusLast = lucius.beats.at(-1);
  linkLocal(
    luciusLast,
    hubBeat,
    'feed-teo-bread',
    '玩家点击投喂按钮，本地背包确认并扣除精制面包一份。',
    { type: 'submit_item', itemId: '精制面包', itemName: '精制面包', count: 1 },
    { completeSceneId: lucius.id },
  );
  luciusLast.requiredAction = {
    type: 'submit_item',
    label: '投喂精制面包',
    transitionId: 'feed-teo-bread',
    itemId: '精制面包',
    itemName: '精制面包',
    count: 1,
    openPanel: 'market',
  };

  const finalBeats = finalStage.scenes[0].beats;
  linkLocal(
    hubBeat,
    finalBeats[0],
    'all-preparations-complete',
    '三个并行筹备场景全部由本地动作标为完成。',
    { type: 'parallel_scenes_complete', sceneIds: completedSceneIds },
  );
  for (let index = 0; index < 3; index += 1) {
    linkJudge(finalBeats[index], finalBeats[index + 1]);
  }
  linkLocal(
    finalBeats[3],
    finalBeats[4],
    'confirm-preboss-deck',
    '玩家点击按钮确认已经完成首领战前卡牌准备。',
    { type: 'confirm' },
  );
  finalBeats[3].requiredAction = {
    type: 'confirm',
    label: '选择战前卡牌',
    transitionId: 'confirm-preboss-deck',
    openPanel: 'deck',
  };
  linkLocal(
    finalBeats[4],
    finalBeats[5],
    'defeat-academy-golem',
    '本地战斗记录确认失控教学魔像已经被击败。',
    { type: 'battle_won', monsterId: 'boss_academy_arcane_golem' },
  );
  finalBeats[4].requiredAction = {
    type: 'start_battle',
    label: '迎战失控教学魔像',
    monsterId: 'boss_academy_arcane_golem',
    battleCount: 1,
    battleReason: '学院周年庆预演中，表演用教学魔像被错误切换成攻击形态。',
    openPanel: 'battle',
  };
  markReady(finalBeats.at(-1));
}

function configureFlora(quest) {
  const beats = Object.fromEntries(allBeats(quest).map((beat) => [beat.id, beat]));
  const ordered = allBeats(quest);
  for (let index = 0; index < ordered.length - 1; index += 1) {
    linkJudge(ordered[index], ordered[index + 1]);
  }

  const earlyEnding = endingBeat(
    'flora-ending-b-early-ready',
    '提前结束的相遇',
    '玩家明确拒绝了芙萝拉的关键请求，这段相遇自然结束，等待面板结算。',
    'B',
  );
  const lateEnding = endingBeat(
    'flora-ending-b-late-ready',
    '在墓园前告别',
    '玩家在后期明确拒绝同行或献花，这段相遇自然结束，等待面板结算。',
    'B',
  );
  quest.stages[0].scenes.push({
    id: 'flora-early-goodbye',
    title: '提前告别',
    locations: ['中央商业区', '城郊'],
    beats: [earlyEnding],
  });
  quest.stages[2].scenes.push({
    id: 'flora-late-goodbye',
    title: '墓园前的告别',
    locations: ['城郊', '城郊墓园'],
    beats: [lateEnding],
  });

  addRefusal(beats['flora-encounter'], earlyEnding, '玩家明确拒绝买花、无视芙萝拉或直接离开。');
  addRefusal(beats['flora-selling-flowers'], earlyEnding, '玩家明确拒绝帮助卖花或明确结束这段相遇。');
  addRefusal(beats['flora-lily-invitation'], earlyEnding, '玩家明确拒绝陪芙萝拉去城郊采集百合。');
  addRefusal(beats['flora-memorial-invitation'], lateEnding, '玩家明确拒绝同行去墓园，或把花交给父女后离开。');

  beats['flora-gather-eight-lilies'].transitions = [];
  linkLocal(
    beats['flora-gather-eight-lilies'],
    beats['flora-neil-arrives'],
    'inventory-has-eight-lilies',
    '本地背包确认玩家持有圣心百合至少八朵。',
    { type: 'inventory_at_least', itemId: '圣心百合', itemName: '圣心百合', count: 8 },
  );
  beats['flora-await-offering'].transitions = [];
  linkLocal(
    beats['flora-await-offering'],
    beats['flora-offering-reaction'],
    'submit-eight-lilies',
    '玩家点击提交按钮，本地背包成功扣除八朵圣心百合。',
    { type: 'submit_item', itemId: '圣心百合', itemName: '圣心百合', count: 8 },
  );
  beats['flora-await-offering'].requiredAction = {
    type: 'submit_item',
    label: '提交圣心百合×8',
    transitionId: 'submit-eight-lilies',
    itemId: '圣心百合',
    itemName: '圣心百合',
    count: 8,
    openPanel: 'inventory',
  };
  markReady(beats['flora-ending-ready'], 'A');
  quest.nodeAliases = {
    'selling-flowers': 'flora-encounter',
    'gathering-lilies': 'flora-gather-eight-lilies',
    'grave-visit': 'flora-travel-cemetery',
    'ending-a-ready': 'flora-ending-ready',
    'ending-b-early-ready': 'flora-ending-b-early-ready',
    'ending-b-late-ready': 'flora-ending-b-late-ready',
  };
}

function addRefusal(from, to, condition) {
  from.completionGate = `${from.completionGate}；或者玩家明确拒绝并结束当前任务请求。`;
  linkJudge(from, to, {
    id: `refuse-${from.id}`,
    condition,
    minConfidence: 0.9,
  });
}

function endingBeat(id, title, purpose, ending) {
  return {
    id,
    title,
    roadmapSummary: title,
    objective: purpose,
    purpose,
    completionGate: '该分支已结束，可以由玩家在任务面板确认结算。',
    sceneContext: purpose,
    availableClues: [],
    forbiddenFacts: ['玩家确认结算前不得宣称奖励已经到账。'],
    transitions: [],
    status: 'ready',
    ending,
  };
}

function buildSceneSource(storyline, stage, sceneIndex) {
  let primaryIds = stage.primarySourceEntries ?? [];
  if (
    storyline.id === 'main_academy_anniversary_preparation' &&
    stage.id === 'parallel-preparations'
  ) {
    primaryIds = primaryIds.slice(sceneIndex * 3, sceneIndex * 3 + 3);
  }
  const sourceIds = [
    ...primaryIds,
    ...(stage.supplementSourceEntries ?? []),
  ];
  const archives = new Map(
    storyline.sourceArchive.map((entry) => [entry.entry, entry]),
  );
  const material = sourceIds
    .map((sourceId) => {
      const archive = archives.get(sourceId);
      if (!archive) {
        throw new Error(
          `Missing source entry ${sourceId} for ${storyline.id}/${stage.id}`,
        );
      }
      return `【旧版条目 ${sourceId}｜${cleanLegacySource(archive.comment)}】\n${cleanLegacySource(archive.exactText)}`;
    })
    .join('\n\n');
  if (!material.trim()) {
    throw new Error(`Empty story source for ${storyline.id}/${stage.id}`);
  }
  if (material.length > 20_000) {
    throw new Error(
      `Story source exceeds 20000 chars for ${storyline.id}/${stage.id}`,
    );
  }
  return material;
}

function cleanLegacySource(source) {
  return source
    .replace(
      /\[(?:AUTO_(?:MAINQUEST|SIDEQUEST|REGION|GLOBAL)|ONBOARDING_ONLY_MAINQUEST_OFFER|LOCK_MAINQUEST_INTERACTION)[^\]]*\]\s*/g,
      '',
    )
    .replace(
      /<(MainQuestOffer|MainQuestUpdate|MainQuestDiscover|MainQuestParallelOffer|MainQuestParallelUpdate|MainQuestNodeUpdate|SideQuestOffer|SideQuestUpdate|SideQuestDiscover|QuestInteraction|BattleStart)>[\s\S]*?<\/\1>/g,
      '',
    )
    .split('\n')
    .filter(
      (line) =>
        !/(?:MainQuest|SideQuest|QuestInteraction|BattleStart|AUTO_MAINQUEST|AUTO_SIDEQUEST)/.test(
          line,
        ) &&
        !/(?:首次触发时输出|推进时输出|完成阶段\d*时输出|结局B更新格式|强制连续输出)/.test(
          line,
        ),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function allBeats(quest) {
  return quest.stages.flatMap((stage) =>
    stage.scenes.flatMap((scene) => scene.beats),
  );
}
