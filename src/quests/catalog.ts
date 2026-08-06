import {
  questCatalogSchema,
  type QuestCatalogData,
  type QuestDefinition,
} from '@/quests/schema';
import bundledQuestCatalog from '../../public/managed-content/quests/alpha.json';

export interface QuestAvailabilityInput {
  region: string;
  location?: string;
  level: number;
  completedQuestIds?: ReadonlySet<string>;
  activeQuestIds?: ReadonlySet<string>;
}

export interface QuestListEntry {
  id: string;
  name: string;
  kind: QuestDefinition['kind'];
  region: string;
  publicSummary: string;
  minimumLevel: number;
  rewardExperience: number;
  rewardGold: number;
  rewardGuildExperience: number;
}

export class QuestCatalog {
  private readonly quests: Map<string, QuestDefinition>;

  constructor(readonly data: QuestCatalogData) {
    this.quests = new Map(data.quests.map((quest) => [quest.id, quest]));
  }

  static parse(value: unknown): QuestCatalog {
    return new QuestCatalog(questCatalogSchema.parse(value));
  }

  get(questId: string): QuestDefinition | undefined {
    return this.quests.get(questId);
  }

  available(input: QuestAvailabilityInput): QuestDefinition[] {
    const region = input.region.trim();
    const location = input.location?.trim() ?? '';
    return [...this.quests.values()].filter(
      (quest) =>
        quest.visibility !== 'hidden' &&
        quest.availableRegions.some(
          (candidate) =>
            candidate === region ||
            candidate.includes(region) ||
            region.includes(candidate) ||
            (location.length > 0 &&
              (candidate === location ||
                candidate.includes(location) ||
                location.includes(candidate))),
        ) &&
        quest.minimumLevel <= input.level &&
        quest.prerequisiteQuestIds.every((questId) =>
          input.completedQuestIds?.has(questId),
        ) &&
        !input.completedQuestIds?.has(quest.id) &&
        !input.activeQuestIds?.has(quest.id),
    );
  }

  listAvailable(input: QuestAvailabilityInput): QuestListEntry[] {
    return this.available(input).map(toQuestListEntry);
  }
}

export class QuestCatalogLoader {
  private catalog: QuestCatalog = QuestCatalog.parse(bundledQuestCatalog);
  private loadTask?: Promise<QuestCatalog>;

  constructor(
    private readonly host: Window,
    private readonly sources = defaultQuestCatalogSources(),
  ) {}

  load(options: { force?: boolean } = {}): Promise<QuestCatalog> {
    if (!options.force) return Promise.resolve(this.catalog);
    if (this.loadTask) return this.loadTask;
    this.loadTask = this.fetchCatalog().finally(() => {
      this.loadTask = undefined;
    });
    return this.loadTask;
  }

  private async fetchCatalog(): Promise<QuestCatalog> {
    const errors: string[] = [];
    for (const source of this.sources) {
      try {
        const url = new URL(source);
        url.searchParams.set('quest-content', String(Date.now()));
        const response = await this.host.fetch(url.href, {
          cache: 'no-store',
          credentials: 'omit',
        });
        if (!response.ok) {
          errors.push(`${url.origin}: HTTP ${response.status}`);
          continue;
        }
        const catalog = QuestCatalog.parse(await response.json());
        this.catalog = catalog;
        return catalog;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (this.catalog) return this.catalog;
    throw new Error(`任务目录暂时不可用：${errors.join('；')}`);
  }
}

function defaultQuestCatalogSources(): string[] {
  const moduleUrl = new URL(import.meta.url);
  const relativePath = moduleUrl.pathname.includes('/src/')
    ? '../../managed-content/quests/alpha.json'
    : '../managed-content/quests/alpha.json';
  return [
    new URL(relativePath, moduleUrl).href,
    'https://jhyshl.github.io/caelian-re-oseas/managed-content/quests/alpha.json',
    'https://caelian-re-oseas-alpha.jianghailou7.chatgpt.site/managed-content/quests/alpha.json',
  ];
}

function toQuestListEntry(quest: QuestDefinition): QuestListEntry {
  return {
    id: quest.id,
    name: quest.name,
    kind: quest.kind,
    region: quest.region,
    publicSummary: quest.publicSummary,
    minimumLevel: quest.minimumLevel,
    rewardExperience: quest.rewards.default.experience,
    rewardGold: quest.rewards.default.gold,
    rewardGuildExperience: quest.rewards.default.guildExperience,
  };
}
