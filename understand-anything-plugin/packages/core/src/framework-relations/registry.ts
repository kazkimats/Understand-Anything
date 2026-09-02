import type { FrameworkRegistry } from "../languages/framework-registry.js";
import type {
  FrameworkRelationArtifact,
  FrameworkRelationContext,
  FrameworkRelationProvider,
} from "./types.js";
import { validateFrameworkRelationArtifact } from "./types.js";
import { aspnetProvider } from "./providers/index.js";

export class FrameworkRelationRegistry {
  private readonly providers = new Map<string, FrameworkRelationProvider>();

  register(provider: FrameworkRelationProvider): void {
    if (!this.providers.has(provider.frameworkId)) {
      this.providers.set(provider.frameworkId, provider);
    }
  }

  get(frameworkId: string): FrameworkRelationProvider | null {
    return this.providers.get(frameworkId) ?? null;
  }

  getForFrameworks(ids: string[]): FrameworkRelationProvider[] {
    const found: FrameworkRelationProvider[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const provider = this.get(id);
      if (provider) found.push(provider);
    }
    return found;
  }

  static createDefault(): FrameworkRelationRegistry {
    const registry = new FrameworkRelationRegistry();
    registry.register(aspnetProvider);
    return registry;
  }
}

export interface FrameworkProviderRunStats {
  providersDetected: number;
  providersExecuted: number;
  providerFailures: number;
  fileDependenciesAdded: number;
  nodesRequested: number;
  nodesMaterialized: number;
  relationsRequested: number;
  relationsAdded: number;
  missingEndpoint: number;
  invalidRelation: number;
  duplicateRelation: number;
  semanticFactsAvailable: number;
  semanticFactsProjects: number;
  semanticFactsIncomplete: number;
}

export interface FrameworkProviderRunResult {
  artifacts: FrameworkRelationArtifact[];
  warnings: string[];
  stats: FrameworkProviderRunStats;
}

export async function runFrameworkRelationProviders(options: {
  frameworkIds: string[];
  frameworkRegistry: FrameworkRegistry;
  providerRegistry: FrameworkRelationRegistry;
  context: Omit<FrameworkRelationContext, "framework">;
}): Promise<FrameworkProviderRunResult> {
  const providers = options.providerRegistry.getForFrameworks(options.frameworkIds);
  const stats: FrameworkProviderRunStats = {
    providersDetected: providers.length,
    providersExecuted: 0,
    providerFailures: 0,
    fileDependenciesAdded: 0,
    nodesRequested: 0,
    nodesMaterialized: 0,
    relationsRequested: 0,
    relationsAdded: 0,
    missingEndpoint: 0,
    invalidRelation: 0,
    duplicateRelation: 0,
    semanticFactsAvailable: options.context.semanticFacts ? 1 : 0,
    semanticFactsProjects: options.context.semanticFacts?.projects.length ?? 0,
    semanticFactsIncomplete: options.context.semanticFacts?.projects.filter((project) =>
      !project.compilationSucceeded || project.referencesResolved === false).length ?? 0,
  };
  const artifacts: FrameworkRelationArtifact[] = [];
  const warnings: string[] = [];

  for (const provider of providers) {
    const framework = options.frameworkRegistry.getById(provider.frameworkId);
    if (!framework) {
      stats.providerFailures++;
      warnings.push(`${provider.frameworkId}: framework config is not registered`);
      continue;
    }

    stats.providersExecuted++;
    try {
      const result = await provider.analyze({ ...options.context, framework });
      const artifact = validateFrameworkRelationArtifact({
        schemaVersion: 1,
        frameworkId: provider.frameworkId,
        ...result,
      });
      artifacts.push(artifact);
      stats.fileDependenciesAdded += artifact.fileDependencies.length;
      stats.nodesRequested += artifact.nodes.length;
      stats.relationsRequested += artifact.relations.length;
      warnings.push(...artifact.warnings.map((warning) => `${provider.frameworkId}: ${warning}`));
    } catch (error) {
      stats.providerFailures++;
      warnings.push(
        `${provider.frameworkId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { artifacts, warnings, stats };
}
