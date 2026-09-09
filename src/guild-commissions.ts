import regions from '@/content/generated/world/regions.json';
import type { GuildTaskDefinition } from '@/content/catalogs/guild';
import type { RegionAccessRecord, QuestRecord } from '@/domain/types';
import { normalizeRegion } from '@/worldbook/region-switcher';
import type { CommissionSources } from '@/content/catalogs/commissions';
import { localDayKey } from '@/daily-refresh';

function randomFor(seed: string) {
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ value >>> 15, 1 | value);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function dailyCommissionBoard(sources: CommissionSources, access: RegionAccessRecord[], day = localDayKey()): GuildTaskDefinition[] {
  const unlocked = regions.filter(r => access.some(a => a.regionId === r.id && a.accessible)).map(r => r.name);
  const inputs = new Set(sources.recipes.flatMap(r => Object.keys(r.inputs)));
  return regions.flatMap(region => {
    const random = randomFor(`commissions-v3:${day}:${region.id}`);
    const integer = (min: number, max: number) => min + Math.floor(random() * (max-min+1));
    const pick = <T>(rows: readonly T[]): T => rows[integer(0,rows.length-1)]!;
    const destinations = escortDestinations(region.name, access);
    const localNames = new Set([...unlocked, region.name].map(normalizeRegion));
    const markets = Object.entries(sources.markets).filter(([name]) => localNames.has(normalizeRegion(name))).flatMap(([,rows]) => rows);
    const marketNames = new Set(markets.map(row => row.name));
    const gathered = Object.entries(sources.gather).filter(([name]) => localNames.has(normalizeRegion(name))).flatMap(([,names]) => names);
    const ordinary = [...new Set([...marketNames].filter(name => inputs.has(name)).concat(gathered))].sort();
    const obtainable = new Set([...marketNames, ...gathered]);
    // Resolve chains only from real, obtainable ingredients; hunting/loot-only
    // materials cannot silently turn an ordinary delivery into a battle task.
    const hasMarketInput = new Set<string>();
    for (let pass=0; pass<sources.recipes.length; pass++) {
      let changed = false;
      for (const recipe of sources.recipes) {
        const ingredients = Object.keys(recipe.inputs);
        if (ingredients.length && ingredients.every(id => obtainable.has(id))) {
          if (!obtainable.has(recipe.output)) { obtainable.add(recipe.output); changed = true; }
          if (ingredients.some(id => marketNames.has(id) || hasMarketInput.has(id))) hasMarketInput.add(recipe.output);
        }
      }
      if (!changed) break;
    }
    const products = [...new Set(sources.recipes.filter(r => Object.keys(r.inputs).every(id => obtainable.has(id)) && hasMarketInput.has(r.output)).map(r => r.output))].sort();
    const monsters = Object.entries(sources.monsters).filter(([id,m]) => !id.startsWith('boss_') && m.difficulty !== 'boss' && m.regions?.some(name => normalizeRegion(name) === normalizeRegion(region.name)));
    const lootMonsters = monsters.filter(([,m]) => m.loot?.some(item => (item.name || item.id) && (item.chance ?? 1) > 0));
    const types = ['gather', ...(monsters.length ? ['combat'] : []), ...(destinations.length ? ['escort'] : [])];
    const slots = [...types];
    while (slots.length < 4) slots.push(pick(types));
    for (let i=slots.length-1; i>0; i--) { const j=integer(0,i); [slots[i],slots[j]]=[slots[j]!,slots[i]!]; }
    const combatTargets = new Set<string>(), combatObjectives = new Set<string>(), escortRoutes = new Set<string>();
    return slots.map((type, slot) => {
      const task: GuildTaskDefinition = {id:`daily-v3:${day}:${region.id}:${slot}`,region:region.name,name:'',type,difficulty:'normal',desc:'',lvl:region.minLevel,xp:60+region.minLevel*12,gold:100+region.minLevel*25,gxp:15+region.minLevel*2};
      if (type === 'escort') {
        const routes = destinations.flatMap(destination => ['商队','学者','补给队'].map(person => ({destination,person})));
        const route = pick(routes.filter(r=>!escortRoutes.has(`${r.person}:${r.destination}`)));
        escortRoutes.add(`${route.person}:${route.destination}`);
        task.destination = route.destination; task.count = 1;
        task.name = `护送${route.person}前往${task.destination}`;
        task.desc = `从${region.name}护送至「${task.destination}」，抵达后交付。`;
      } else if (type === 'combat') {
        const unused = monsters.filter(([id])=>!combatTargets.has(id));
        const choices = (unused.length ? unused : monsters).flatMap(([id,monster])=>[2,3,4,5,6].map(count=>({id,monster,count}))).filter(row=>!combatObjectives.has(`${row.id}:${row.count}`));
        const chosen = pick(choices),monster = chosen.monster;
        combatTargets.add(chosen.id);combatObjectives.add(`${chosen.id}:${chosen.count}`);
        task.target = monster.name; task.count = chosen.count;
        task.name = `讨伐${monster.name}`; task.desc = `在接取委托后击败${monster.name} ×${task.count}。`;
      } else {
        const loot = lootMonsters.length && random() < .18 ? pick(lootMonsters)[1] : undefined;
        let pool = loot ? [...new Set(loot.loot!.filter(item => (item.chance ?? 1)>0).map(item => item.name || item.id!).filter(Boolean))] : products.length && random() < .85 ? [...products] : [...ordinary];
        if (!pool.length) pool = [...products, ...ordinary];
        if (!pool.length) throw new Error(`${region.name}没有可用的数据库物品委托`);
        task.items = [];
        const count = integer(1, Math.min(3, pool.length));
        for (let i=0; i<count; i++) {
          const index = integer(0,pool.length-1), itemId = pool.splice(index,1)[0]!;
          task.items.push({itemId,count:integer(5,20)});
        }
        task.count = 1;
        task.name = `${loot ? '战利品征集' : '物资筹备'}：${task.items.map(item => item.itemId).join('、')}`;
        task.desc = `提交${task.items.map(item => `${item.itemId} ×${item.count}`).join('、')}。`;
        if (loot) { task.type = 'combat_gather'; task.target = loot.name; task.count = integer(2,5); task.desc = `接取后击败${loot.name} ×${task.count}，并${task.desc}`; }
        else task.desc += task.items.every(item => products.includes(item.itemId)) ? '请购买或采集配方材料，在合成台制作。' : '所需物品可从集市购买或采集取得。';
        task.gold += Math.round(task.items.reduce((sum,item) => sum + (sources.prices[item.itemId] ?? markets.find(row => row.name === item.itemId)?.basePrice ?? 0)*item.count,0)*1.15);
      }
      return task;
    });
  });
}

export function escortDestinations(origin: string, access: RegionAccessRecord[]): string[] {
  const unlocked = new Set(access.filter(row => row.accessible).map(row => row.regionId));
  return regions.filter(row => unlocked.has(row.id) && normalizeRegion(row.name) !== normalizeRegion(origin)).map(row => normalizeRegion(row.name));
}

export function commissionCatalog(tasks: GuildTaskDefinition[]): GuildTaskDefinition[] {
  return tasks.map(raw => {
    const task = { ...raw, id: `${raw.name}:${raw.region}` };
    if (raw.type !== 'investigate') return task;
    const moon = normalizeRegion(raw.region) === '银月之城';
    return { ...task, type: 'combat_gather', target: moon ? '银血蝠' : '林间潜伏者', count: 2,
      items: [{ itemId: moon ? '怨念残留' : '食人花花粉', count: 3 }],
      desc: moon ? '击败银血蝠 ×2，并提交怨念残留 ×3。' : '击败林间潜伏者 ×2，并提交食人花花粉 ×3，完成搜救委托。' };
  });
}

export function commissionBoard(tasks: GuildTaskDefinition[], access: RegionAccessRecord[], day = new Date().toLocaleDateString('sv-SE')): GuildTaskDefinition[] {
  return tasks.flatMap(task => {
    if (task.type !== 'escort') return [task];
    const choices = escortDestinations(task.region, access);
    if (!choices.length) return [];
    let hash = 0;
    for (const char of `${task.id ?? task.name}:${day}`) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    const destination = choices[hash % choices.length]!;
    return [{ ...task, destination, name: `护送${task.name.includes('学者') ? '学者' : '商队'}前往${destination}`,
      desc: `从${normalizeRegion(task.region)}出发，护送至已解锁地区「${destination}」后交付。`, count: 1 }];
  });
}

export function commissionCombatPending(quest: QuestRecord): boolean {
  return ['combat', 'combat_gather'].includes(quest.commissionType ?? '') && (quest.commissionKills ?? quest.currentStage) < quest.totalStages;
}

export function commissionGoalsMet(quest: QuestRecord): boolean {
  if (quest.commissionVersion !== 2) return false;
  if (quest.commissionType === 'combat') return !commissionCombatPending(quest);
  if (quest.commissionType === 'gather') return quest.commissionItemsSubmitted === true;
  if (quest.commissionType === 'combat_gather') return !commissionCombatPending(quest) && quest.commissionItemsSubmitted === true;
  if (quest.commissionType === 'escort') return Boolean(quest.escortArrived && quest.escortDestination && normalizeRegion(quest.escortDestination) !== normalizeRegion(quest.region));
  return false;
}
