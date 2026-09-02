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

  it("rejects incompatible schema versions", () => {
    expect(() => parseCSharpSemanticFacts({ ...facts, schemaVersion: 2 })).toThrow();
  });

  it("accepts an empty containing method and degrades unknown target kinds", () => {
    const parsed = parseCSharpSemanticFactsJson(JSON.stringify({
      ...facts,
      invocations: [{
        projectFile: "Web/Web.csproj",
        containingType: "Web.HomeController",
        containingMethod: "",
        invocationName: "View",
        symbolName: "Microsoft.AspNetCore.Mvc.Controller.View()",
        filePath: "Web/HomeController.cs",
        lineRange: [5, 5],
        arguments: [],
        targetKind: "dynamic",
        resolved: true,
      }],
    }));

    expect(parsed.invocations).toEqual([
      expect.objectContaining({ containingMethod: "", targetKind: "unresolvable" }),
    ]);
  });

  it("drops malformed records individually and reports their counts", () => {
    const parsed = parseCSharpSemanticFacts({
      ...facts,
      types: [{
        projectFile: "Web/Web.csproj",
        symbolName: "Web.HomeController",
        kind: "class",
        filePath: "Web/HomeController.cs",
        lineRange: [2, 5],
        baseTypes: [],
        attributes: [],
      }, {
        projectFile: "Web/Web.csproj",
        kind: "class",
        filePath: "Web/BrokenController.cs",
        lineRange: [2, 5],
        baseTypes: [],
        attributes: [],
      }],
      methods: [{
        projectFile: "Web/Web.csproj",
        containingType: "Web.HomeController",
        methodName: "Index",
        kind: "method",
        filePath: "Web/HomeController.cs",
        lineRange: [3, 3],
        modifiers: ["public", "instance"],
        isConstructor: false,
        attributes: [],
      }],
      invocations: [{
        projectFile: "Web/Web.csproj",
        containingType: "Web.HomeController",
        containingMethod: "Index",
        invocationName: "View",
        symbolName: "Microsoft.AspNetCore.Mvc.Controller.View()",
        filePath: "Web/HomeController.cs",
        lineRange: [3, 3],
        arguments: [],
        targetKind: "instance-method",
        resolved: true,
      }, {
        projectFile: "Web/Web.csproj",
        containingType: "Web.HomeController",
        containingMethod: "Index",
        symbolName: "",
        filePath: "Web/HomeController.cs",
        lineRange: [4, 4],
        arguments: [],
        targetKind: "unresolvable",
        resolved: false,
      }],
    });

    expect(parsed.types).toHaveLength(1);
    expect(parsed.methods).toHaveLength(1);
    expect(parsed.invocations).toHaveLength(1);
    expect(parsed.warnings).toContain(
      "2 malformed semantic-facts records were dropped (types: 1, methods: 0, invocations: 1)",
    );
  });
});
