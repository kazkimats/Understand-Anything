import { describe, expect, it } from "vitest";
import { FrameworkRegistry } from "../languages/framework-registry.js";
import {
  FrameworkRelationRegistry,
  runFrameworkRelationProviders,
  validateFrameworkRelationArtifact,
} from "../framework-relations/index.js";
import type {
  FrameworkRelationProvider,
  FrameworkRelationResult,
} from "../framework-relations/index.js";

const emptyResult = (): FrameworkRelationResult => ({
  fileDependencies: [],
  nodes: [],
  relations: [],
  stats: {},
  warnings: [],
});

const provider = (frameworkId: string): FrameworkRelationProvider => ({
  frameworkId,
  async analyze() {
    return emptyResult();
  },
});

function frameworkRegistry(...ids: string[]): FrameworkRegistry {
  const registry = new FrameworkRegistry();
  for (const id of ids) {
    registry.register({
      id,
      displayName: id,
      languages: ["typescript"],
      detectionKeywords: [id],
      manifestFiles: ["package.json"],
      promptSnippetPath: `./frameworks/${id}.md`,
    });
  }
  return registry;
}

describe("FrameworkRelationRegistry", () => {
  it("registers and looks up providers without duplicates", () => {
    const registry = new FrameworkRelationRegistry();
    const first = provider("alpha");
    registry.register(first);
    registry.register(provider("alpha"));
    expect(registry.get("alpha")).toBe(first);
    expect(registry.get("missing")).toBeNull();
  });

  it("returns providers for multiple frameworks in requested order", () => {
    const registry = new FrameworkRelationRegistry();
    registry.register(provider("alpha"));
    registry.register(provider("beta"));
    expect(registry.getForFrameworks(["beta", "missing", "alpha", "beta"]))
      .toEqual([registry.get("beta"), registry.get("alpha")]);
  });
});

describe("runFrameworkRelationProviders", () => {
  const context = {
    projectRoot: "/project",
    files: [],
    async readFile() { return null; },
  };

  it("is a no-op when no registered provider matches", async () => {
    const result = await runFrameworkRelationProviders({
      frameworkIds: ["alpha"],
      frameworkRegistry: frameworkRegistry("alpha"),
      providerRegistry: new FrameworkRelationRegistry(),
      context,
    });
    expect(result.artifacts).toEqual([]);
    expect(result.stats.providersDetected).toBe(0);
    expect(result.stats.semanticFactsAvailable).toBe(0);
    expect(result.stats.semanticFactsProjects).toBe(0);
    expect(result.stats.semanticFactsIncomplete).toBe(0);
  });

  it("reports generic semantic fact availability and incomplete projects", async () => {
    const result = await runFrameworkRelationProviders({
      frameworkIds: [],
      frameworkRegistry: frameworkRegistry(),
      providerRegistry: new FrameworkRelationRegistry(),
      context: {
        ...context,
        semanticFacts: {
          schemaVersion: 1,
          projects: [
            {
              projectFile: "Web/Web.csproj",
              compilationSucceeded: true,
              targetFrameworks: ["net8.0"],
              references: [],
              referencesResolved: true,
            },
            {
              projectFile: "Broken/Broken.csproj",
              compilationSucceeded: false,
              targetFrameworks: ["net8.0"],
              references: [],
              referencesResolved: false,
            },
          ],
          types: [],
          methods: [],
          invocations: [],
          diagnostics: [],
          warnings: [],
        },
      },
    });

    expect(result.stats.semanticFactsAvailable).toBe(1);
    expect(result.stats.semanticFactsProjects).toBe(2);
    expect(result.stats.semanticFactsIncomplete).toBe(1);
  });

  it("runs two providers and validates their common artifacts", async () => {
    const providers = new FrameworkRelationRegistry();
    providers.register({
      frameworkId: "alpha",
      async analyze() {
        return {
          fileDependencies: [{ sourcePath: "a.ts", targetPath: "b.ts", kind: "fake" }],
          nodes: [],
          relations: [],
          stats: { analyzed: 1 },
          warnings: [],
        };
      },
    });
    providers.register(provider("beta"));

    const result = await runFrameworkRelationProviders({
      frameworkIds: ["alpha", "beta"],
      frameworkRegistry: frameworkRegistry("alpha", "beta"),
      providerRegistry: providers,
      context,
    });
    expect(result.artifacts.map((artifact) => artifact.frameworkId)).toEqual(["alpha", "beta"]);
    expect(result.stats.providersExecuted).toBe(2);
    expect(result.stats.fileDependenciesAdded).toBe(1);
  });

  it("continues after one provider fails", async () => {
    const providers = new FrameworkRelationRegistry();
    providers.register({
      frameworkId: "alpha",
      async analyze() { throw new Error("boom"); },
    });
    providers.register(provider("beta"));

    const result = await runFrameworkRelationProviders({
      frameworkIds: ["alpha", "beta"],
      frameworkRegistry: frameworkRegistry("alpha", "beta"),
      providerRegistry: providers,
      context,
    });
    expect(result.artifacts.map((artifact) => artifact.frameworkId)).toEqual(["beta"]);
    expect(result.stats.providerFailures).toBe(1);
    expect(result.warnings).toContain("alpha: boom");
  });

  it("rejects an invalid provider artifact without stopping others", async () => {
    const providers = new FrameworkRelationRegistry();
    providers.register({
      frameworkId: "alpha",
      async analyze() {
        return { ...emptyResult(), relations: [{
          kind: "bad",
          source: { nodeId: "a" },
          target: { nodeId: "b" },
          edgeType: "not-an-edge",
        }] } as never;
      },
    });
    providers.register(provider("beta"));

    const result = await runFrameworkRelationProviders({
      frameworkIds: ["alpha", "beta"],
      frameworkRegistry: frameworkRegistry("alpha", "beta"),
      providerRegistry: providers,
      context,
    });
    expect(result.artifacts.map((artifact) => artifact.frameworkId)).toEqual(["beta"]);
    expect(result.stats.providerFailures).toBe(1);
  });
});

describe("validateFrameworkRelationArtifact", () => {
  it("validates node candidates and canonical relations", () => {
    expect(validateFrameworkRelationArtifact({
      schemaVersion: 1,
      frameworkId: "fake",
      fileDependencies: [],
      nodes: [{
        key: "endpoint",
        node: {
          id: "endpoint:GET /fake",
          type: "endpoint",
          name: "GET /fake",
          filePath: "routes.fake",
          summary: "Deterministic fake endpoint",
          tags: ["fake"],
          complexity: "simple",
        },
      }],
      relations: [{
        kind: "fake_route",
        source: { nodeKey: "endpoint" },
        target: { nodeId: "func:handler" },
        edgeType: "routes",
      }],
      stats: {},
      warnings: [],
    }).frameworkId).toBe("fake");
  });
});
