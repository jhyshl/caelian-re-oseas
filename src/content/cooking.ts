import type {
  BattleItemDefinition,
  MarketSourceItem,
} from '@/content/types';

export type CookingItemKind = 'material' | 'dish';

export interface CookingItemDefinition extends BattleItemDefinition {
  kind: CookingItemKind;
  basePrice: number;
  rarity: string;
  huntingOnly?: boolean;
  marketOnly?: boolean;
  caelianLiked?: boolean;
  containsPlant?: boolean;
}

export interface CookingRecipeDefinition {
  id: string;
  name: string;
  inputs: Record<string, number>;
  output: string;
  count: number;
  basePrice: number;
  category: '料理';
  effectText: string;
}

export interface HuntingAnimalDefinition {
  id: string;
  name: string;
  description: string;
  primaryMaterialIds: string[];
}

export const COOKING_MATERIALS: Record<string, CookingItemDefinition> = {
  鸡蛋: { name: '鸡蛋', desc: '从野外鸟巢或禽类猎物中取得的新鲜鸡蛋。', category: 'cooking_material', kind: 'material', basePrice: 80, rarity: 'common', huntingOnly: true },
  鸡肉: { name: '鸡肉', desc: '肉质细嫩的料理材料，只能通过打猎获得。', category: 'cooking_material', kind: 'material', basePrice: 160, rarity: 'common', huntingOnly: true },
  野猪肉: { name: '野猪肉', desc: '脂香浓郁的野味，只能通过打猎获得。', category: 'cooking_material', kind: 'material', basePrice: 200, rarity: 'uncommon', huntingOnly: true },
  鱼肉: { name: '鱼肉', desc: '处理干净的鲜鱼肉，只能通过打猎获得。', category: 'cooking_material', kind: 'material', basePrice: 150, rarity: 'common', huntingOnly: true },
  牛奶: { name: '牛奶', desc: '集市每日供应的鲜牛奶。', category: 'cooking_material', kind: 'material', basePrice: 90, rarity: 'common', marketOnly: true },
  面粉: { name: '面粉', desc: '研磨细腻的通用烘焙材料。', category: 'cooking_material', kind: 'material', basePrice: 70, rarity: 'common', marketOnly: true },
  火腿: { name: '火腿', desc: '盐渍风干的肉类料理材料。', category: 'cooking_material', kind: 'material', basePrice: 180, rarity: 'uncommon', marketOnly: true },
  糖: { name: '糖', desc: '甜点与饮品常用的细砂糖。', category: 'cooking_material', kind: 'material', basePrice: 100, rarity: 'common', marketOnly: true },
  盐: { name: '盐', desc: '所有地区集市都能买到的基础调味料。', category: 'cooking_material', kind: 'material', basePrice: 50, rarity: 'common', marketOnly: true },
  奶油: { name: '奶油', desc: '适合制作浓汤和甜点的浓厚奶油。', category: 'cooking_material', kind: 'material', basePrice: 140, rarity: 'uncommon', marketOnly: true },
  黄油: { name: '黄油', desc: '带有奶香的烹饪油脂。', category: 'cooking_material', kind: 'material', basePrice: 130, rarity: 'uncommon', marketOnly: true },
};

const dish = (
  name: string,
  desc: string,
  basePrice: number,
  caelianLiked: boolean,
): CookingItemDefinition => ({
  name,
  desc,
  category: 'dish',
  kind: 'dish',
  basePrice,
  rarity: basePrice >= 900 ? 'rare' : basePrice >= 700 ? 'uncommon' : 'common',
  caelianLiked,
});

export const COOKING_DISHES: Record<string, CookingItemDefinition> = {
  晨露煎蛋: dish('晨露煎蛋', '嫩煎鸡蛋上点缀着一滴清香晨露。', 500, true),
  香煎鸡排: dish('香煎鸡排', '外壳焦香、内里柔嫩的厚切鸡排。', 720, true),
  猎人野猪排: dish('猎人野猪排', '用粗盐锁住野猪肉汁的猎人料理。', 880, true),
  湖畔香煎鱼: dish('湖畔香煎鱼', '黄油煎出的鱼肉带着湖畔的清鲜。', 760, true),
  奶油夜光菇汤: dish('奶油夜光菇汤', '微微发光的浓汤，香气温柔而神秘。', 680, false),
  黄油香草面包: dish('黄油香草面包', '加入学院薄荷的松软黄油面包。', 560, false),
  火腿奶酪卷: dish('火腿奶酪卷', '便于携带的咸香火腿面卷。', 650, true),
  蜜糖松饼: dish('蜜糖松饼', '蓬松面饼淋上晶亮糖浆。', 620, true),
  海盐烤鱼: dish('海盐烤鱼', '粗盐烘烤出的鲜咸鱼料理。', 820, true),
  奶香炖鸡: dish('奶香炖鸡', '牛奶与奶油慢炖出的温暖鸡肉。', 850, true),
  森林肉酱面: dish('森林肉酱面', '野猪肉酱与森林新芽拌成的面食。', 900, false),
  百合蒸蛋: dish('百合蒸蛋', '圣心百合让蒸蛋多了一缕清苦花香。', 640, false),
  月露奶冻: dish('月露奶冻', '月露草浸润的冰凉奶冻。', 700, false),
  蔷薇糖霜饼: dish('蔷薇糖霜饼', '血蔷薇花瓣染出的绯红糖霜。', 780, false),
  古树香草烤肉: dish('古树香草烤肉', '古树新芽包裹的厚切烤肉。', 950, false),
  潮汐鲜鱼浓汤: dish('潮汐鲜鱼浓汤', '珍珠草与鲜鱼熬成的潮汐风味浓汤。', 1000, false),
  学院早餐拼盘: dish('学院早餐拼盘', '鸡蛋、火腿和薄荷面包组成的丰盛早餐。', 880, false),
  炉心黄油肉排: dish('炉心黄油肉排', '以炉心余温煎制的黄油野猪排。', 890, true),
  圣心奶油糕: dish('圣心奶油糕', '点缀圣心百合的华丽奶油糕。', 920, false),
  冒险者丰收炖锅: dish('冒险者丰收炖锅', '肉、蛋与香草汇成的一整锅旅途慰藉。', 980, true),
};

const recipe = (
  id: string,
  output: string,
  inputs: Record<string, number>,
): CookingRecipeDefinition => ({
  id,
  name: output,
  inputs,
  output,
  count: 1,
  basePrice: COOKING_DISHES[output]!.basePrice,
  category: '料理',
  effectText: COOKING_DISHES[output]!.desc,
});

export const COOKING_RECIPES: readonly CookingRecipeDefinition[] = [
  recipe('cook_morning_dew_egg', '晨露煎蛋', { 鸡蛋: 2, 晨露花: 1, 盐: 1 }),
  recipe('cook_pan_fried_chicken', '香煎鸡排', { 鸡肉: 3, 黄油: 1, 盐: 1 }),
  recipe('cook_hunter_boar_steak', '猎人野猪排', { 野猪肉: 3, 盐: 2, 黄油: 1 }),
  recipe('cook_lakeside_fish', '湖畔香煎鱼', { 鱼肉: 3, 黄油: 1, 帕德里湖水珠: 1 }),
  recipe('cook_glow_mushroom_soup', '奶油夜光菇汤', { 夜光菇: 2, 牛奶: 2, 奶油: 1, 盐: 1 }),
  recipe('cook_herb_bread', '黄油香草面包', { 面粉: 3, 黄油: 1, 学院薄荷: 1, 糖: 1 }),
  recipe('cook_ham_roll', '火腿奶酪卷', { 火腿: 2, 面粉: 2, 牛奶: 1 }),
  recipe('cook_honey_pancake', '蜜糖松饼', { 面粉: 3, 鸡蛋: 2, 牛奶: 1, 糖: 2, 黄油: 1 }),
  recipe('cook_seasalt_fish', '海盐烤鱼', { 鱼肉: 4, 盐: 2, 黄油: 1 }),
  recipe('cook_milky_chicken', '奶香炖鸡', { 鸡肉: 3, 牛奶: 2, 奶油: 1, 盐: 1 }),
  recipe('cook_forest_meat_pasta', '森林肉酱面', { 野猪肉: 2, 面粉: 3, 古树新芽: 1, 盐: 1 }),
  recipe('cook_lily_egg', '百合蒸蛋', { 鸡蛋: 3, 圣心百合: 1, 牛奶: 1 }),
  recipe('cook_moon_dew_pudding', '月露奶冻', { 牛奶: 3, 奶油: 1, 糖: 2, 月露草: 1 }),
  recipe('cook_rose_frosting', '蔷薇糖霜饼', { 面粉: 3, 鸡蛋: 2, 糖: 3, 奶油: 1, 血蔷薇花瓣: 1 }),
  recipe('cook_ancient_tree_roast', '古树香草烤肉', { 野猪肉: 4, 古树新芽: 2, 黄油: 1, 盐: 1 }),
  recipe('cook_tidal_fish_soup', '潮汐鲜鱼浓汤', { 鱼肉: 4, 奶油: 2, 海盐珍珠草: 1, 牛奶: 1, 盐: 1 }),
  recipe('cook_academy_breakfast', '学院早餐拼盘', { 鸡蛋: 2, 火腿: 2, 面粉: 2, 学院薄荷: 1, 黄油: 1 }),
  recipe('cook_hearth_steak', '炉心黄油肉排', { 野猪肉: 4, 黄油: 2, 盐: 1, 龙息草: 1 }),
  recipe('cook_sacred_cream_cake', '圣心奶油糕', { 面粉: 3, 奶油: 3, 糖: 3, 鸡蛋: 2, 圣心百合: 1 }),
  recipe('cook_harvest_stew', '冒险者丰收炖锅', { 鸡肉: 2, 野猪肉: 2, 鸡蛋: 1, 城郊药草: 1, 盐: 1, 奶油: 1 }),
] as const;

const PLANT_INGREDIENTS = new Set([
  '晨露花', '夜光菇', '学院薄荷', '古树新芽', '圣心百合',
  '月露草', '血蔷薇花瓣', '海盐珍珠草', '龙息草', '城郊药草',
]);

for (const entry of COOKING_RECIPES) {
  COOKING_DISHES[entry.output]!.containsPlant = Object.keys(entry.inputs).some(
    (ingredient) => PLANT_INGREDIENTS.has(ingredient),
  );
}

export const HUNTING_ANIMALS: readonly HuntingAnimalDefinition[] = [
  { id: 'wild_fowl', name: '林地野禽', description: '追踪鸟巢与野禽，主要获得鸡蛋和鸡肉。', primaryMaterialIds: ['鸡蛋', '鸡肉'] },
  { id: 'moss_boar', name: '苔背野猪', description: '风险较高的林地猎物，主要获得野猪肉。', primaryMaterialIds: ['野猪肉'] },
  { id: 'lake_fish', name: '湖河鱼群', description: '沿水域寻找鱼群，主要获得鱼肉。', primaryMaterialIds: ['鱼肉'] },
  { id: 'mixed_tracks', name: '混合兽踪', description: '跟随不明足迹，可能带回任意狩猎料理材料。', primaryMaterialIds: ['鸡蛋', '鸡肉', '野猪肉', '鱼肉'] },
] as const;

export const HUNTING_MATERIAL_IDS = ['鸡蛋', '鸡肉', '野猪肉', '鱼肉'] as const;

export const DISHES_BY_REGION: Record<string, string[]> = {
  academy: ['晨露煎蛋', '黄油香草面包', '学院早餐拼盘', '蜜糖松饼', '月露奶冻'],
  ilaya: ['晨露煎蛋', '火腿奶酪卷', '奶香炖鸡', '百合蒸蛋', '冒险者丰收炖锅'],
  solavia: ['百合蒸蛋', '圣心奶油糕', '火腿奶酪卷', '蔷薇糖霜饼', '奶香炖鸡'],
  ethera: ['猎人野猪排', '奶油夜光菇汤', '森林肉酱面', '古树香草烤肉', '冒险者丰收炖锅'],
  niyasos: ['湖畔香煎鱼', '海盐烤鱼', '潮汐鲜鱼浓汤', '蜜糖松饼', '奶香炖鸡'],
  abyss_sea: ['海盐烤鱼', '潮汐鲜鱼浓汤', '湖畔香煎鱼', '月露奶冻', '圣心奶油糕'],
  hearth: ['炉心黄油肉排', '猎人野猪排', '香煎鸡排', '火腿奶酪卷', '冒险者丰收炖锅'],
  silvermoon: ['月露奶冻', '蔷薇糖霜饼', '奶油夜光菇汤', '森林肉酱面', '湖畔香煎鱼'],
  holy_mt: ['古树香草烤肉', '圣心奶油糕', '香煎鸡排', '百合蒸蛋', '冒险者丰收炖锅'],
  north: ['猎人野猪排', '奶香炖鸡', '炉心黄油肉排', '黄油香草面包', '潮汐鲜鱼浓汤'],
};

const REGION_NAME_TO_ID: Record<string, string> = {
  圣德里安学院: 'academy', 伊拉亚城: 'ilaya', 索拉维亚: 'solavia',
  艾瑟拉森林: 'ethera', 奈亚索斯城: 'niyasos', 阿必塞海: 'abyss_sea',
  炉心城: 'hearth', 银月之城: 'silvermoon', 远古圣山: 'holy_mt', 极北之地: 'north',
};

export const COOKING_ITEMS: Record<string, CookingItemDefinition> = {
  ...COOKING_MATERIALS,
  ...COOKING_DISHES,
};

export function cookingMarketRows(regionId: string): MarketSourceItem[] {
  const materials = Object.entries(COOKING_MATERIALS)
    .filter(([, item]) => item.marketOnly)
    .map(([id, item]) => ({
      id: `cooking-material:${id}`,
      name: item.name,
      basePrice: item.basePrice,
      rarity: item.rarity,
      stockMin: 100,
      stockMax: 100,
      marketKind: 'item' as const,
      stockLocked: true,
    }));
  const normalizedRegion = REGION_NAME_TO_ID[regionId] ?? regionId;
  const dishes = (DISHES_BY_REGION[normalizedRegion] ?? DISHES_BY_REGION.academy!).map((id) => {
    const item = COOKING_DISHES[id]!;
    return {
      id: `dish:${id}`,
      name: item.name,
      basePrice: item.basePrice,
      rarity: item.rarity,
      stockMin: 5,
      stockMax: 12,
      marketKind: 'item' as const,
    };
  });
  return [...dishes, ...materials];
}

export function isCookingMaterial(itemId: string): boolean {
  return COOKING_MATERIALS[itemId]?.kind === 'material';
}

export function isDish(itemId: string): boolean {
  return COOKING_DISHES[itemId]?.kind === 'dish';
}

export function huntingAnimal(id: string): HuntingAnimalDefinition | undefined {
  return HUNTING_ANIMALS.find((entry) => entry.id === id);
}

export function rollHuntingRewards(
  random: () => number = Math.random,
  preferredIds: readonly string[] = HUNTING_MATERIAL_IDS,
) {
  const huntingIds = new Set<string>(HUNTING_MATERIAL_IDS);
  const preferred = [...new Set(preferredIds)].filter((id) =>
    huntingIds.has(id),
  );
  const rest = HUNTING_MATERIAL_IDS.filter((id) => !preferred.includes(id));
  const pool = [...shuffle(preferred, random), ...shuffle(rest, random)];
  const kinds = 2 + Math.floor(random() * 2);
  return pool.slice(0, kinds).map((itemId) => ({
    itemId,
    name: COOKING_MATERIALS[itemId]!.name,
    quantity: 1 + Math.floor(random() * 10),
  }));
}

function shuffle<T>(entries: readonly T[], random: () => number): T[] {
  const result = [...entries];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}
