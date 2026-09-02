import { describe, expect, it } from "vitest";
import { parseCSharpSemanticFacts, parseCSharpSemanticFactsJson } from "./roslyn.js";

const facts = {
  schemaVersion: 1,
  projects: [{
    projectFile: "Web/Web.csproj",
    compilationSucceeded: true,
    targetFrameworks: ["net8.0"],
    references: ["Microsoft.AspNetCore.Mvc.Core"],
    referencesResolved: true,
  }],
  types: [],
  methods: [],
  invocations: [],
  diagnostics: [],
  warnings: [],
} as const;

describe("CSharpSemanticFactsSchema", () => {
  it("accepts the common Roslyn facts schema", () => {
    expect(parseCSharpSemanticFacts(facts)).toEqual(facts);
    expect(parseCSharpSemanticFactsJson(JSON.stringify(facts))).toEqual(facts);
  });

  it("rejects incompatible schema versions and invocation target kinds", () => {
    expect(() => parseCSharpSemanticFacts({ ...facts, schemaVersion: 2 })).toThrow();
    expect(() => parseCSharpSemanticFacts({
      ...facts,
      invocations: [{
        projectFile: "Web/Web.csproj",
        containingType: "Web.HomeController",
        containingMethod: "Index",
        invocationName: "View",
        symbolName: "Microsoft.AspNetCore.Mvc.Controller.View()",
        filePath: "Web/HomeController.cs",
        lineRange: [5, 5],
        arguments: [],
        targetKind: "dynamic",
        resolved: true,
      }],
    })).toThrow();
  });
});
