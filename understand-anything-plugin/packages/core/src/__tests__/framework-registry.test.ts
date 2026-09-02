import { describe, it, expect } from "vitest";
import {
  FrameworkRegistry,
  matchesManifestPattern,
} from "../languages/framework-registry.js";
import { djangoConfig } from "../languages/frameworks/django.js";
import { reactConfig } from "../languages/frameworks/react.js";

describe("FrameworkRegistry", () => {
  describe("matchesManifestPattern", () => {
    it.each([
      "Foo.csproj",
      "src/Foo.csproj",
      "src/Admin.Web.csproj",
      "src\\Admin.Web.csproj",
    ])("matches wildcard basenames for %s", (filePath) => {
      expect(matchesManifestPattern(filePath, "*.csproj")).toBe(true);
    });

    it.each(["Foo.csproj.bak", "Foo.props"])(
      "rejects non-matching wildcard basenames for %s",
      (filePath) => {
        expect(matchesManifestPattern(filePath, "*.csproj")).toBe(false);
      },
    );

    it("matches slash-containing patterns against normalized relative paths", () => {
      expect(matchesManifestPattern("src/Web/Web.csproj", "src/*/Web.csproj")).toBe(true);
      expect(matchesManifestPattern("other/Web/Web.csproj", "src/*/Web.csproj")).toBe(false);
    });

    it.each([
      ["Gemfile", "Gemfile"],
      ["apps/web/pom.xml", "pom.xml"],
      ["packages/ui/package.json", "package.json"],
    ])("preserves exact manifest matching for %s", (filePath, pattern) => {
      expect(matchesManifestPattern(filePath, pattern)).toBe(true);
    });
  });

  it("registers and retrieves a framework config by id", () => {
    const registry = new FrameworkRegistry();
    registry.register(djangoConfig);
    expect(registry.getById("django")?.displayName).toBe("Django");
  });

  it("retrieves frameworks for a language", () => {
    const registry = new FrameworkRegistry();
    registry.register(djangoConfig);
    registry.register(reactConfig);
    const pythonFrameworks = registry.getForLanguage("python");
    expect(pythonFrameworks).toHaveLength(1);
    expect(pythonFrameworks[0].id).toBe("django");
  });

  it("returns empty array for unknown language", () => {
    const registry = new FrameworkRegistry();
    registry.register(djangoConfig);
    expect(registry.getForLanguage("haskell")).toEqual([]);
  });

  describe("detectFrameworks", () => {
    it("detects Django from requirements.txt", () => {
      const registry = new FrameworkRegistry();
      registry.register(djangoConfig);
      const detected = registry.detectFrameworks({
        "requirements.txt": "django==4.2\ncelery==5.3\n",
      });
      expect(detected).toHaveLength(1);
      expect(detected[0].id).toBe("django");
    });

    it("detects React from package.json", () => {
      const registry = new FrameworkRegistry();
      registry.register(reactConfig);
      const detected = registry.detectFrameworks({
        "package.json": '{"dependencies": {"react": "^18.2.0", "react-dom": "^18.2.0"}}',
      });
      expect(detected).toHaveLength(1);
      expect(detected[0].id).toBe("react");
    });

    it("detection is case-insensitive", () => {
      const registry = new FrameworkRegistry();
      registry.register(djangoConfig);
      const detected = registry.detectFrameworks({
        "requirements.txt": "Django==4.2\n",
      });
      expect(detected).toHaveLength(1);
    });

    it("returns empty array when no frameworks match", () => {
      const registry = new FrameworkRegistry();
      registry.register(djangoConfig);
      const detected = registry.detectFrameworks({
        "requirements.txt": "requests==2.31\n",
      });
      expect(detected).toEqual([]);
    });

    it("returns empty array for empty manifests", () => {
      const registry = new FrameworkRegistry();
      registry.register(djangoConfig);
      expect(registry.detectFrameworks({})).toEqual([]);
    });

    it("does not duplicate detected frameworks", () => {
      const registry = new FrameworkRegistry();
      registry.register(djangoConfig);
      const detected = registry.detectFrameworks({
        "requirements.txt": "django==4.2\ndjango==4.2\n",
        "pyproject.toml": '[project]\ndependencies = ["django>=4.0"]',
      });
      expect(detected).toHaveLength(1);
    });

    it("detects a framework through a wildcard manifest pattern", () => {
      const registry = new FrameworkRegistry();
      registry.register({
        id: "web-sdk",
        displayName: "Web SDK",
        languages: ["csharp"],
        detectionKeywords: ["Microsoft.NET.Sdk.Web"],
        manifestFiles: ["*.csproj"],
        promptSnippetPath: "./frameworks/web-sdk.md",
      });

      expect(
        registry.detectFrameworks({
          "src/Admin.Web/Admin.Web.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web" />',
        }).map((framework) => framework.id),
      ).toEqual(["web-sdk"]);
    });
  });

  it("returns frameworks for all listed languages (cross-language)", () => {
    const registry = FrameworkRegistry.createDefault();
    // React lists both typescript and javascript
    const tsFrameworks = registry.getForLanguage("typescript");
    const jsFrameworks = registry.getForLanguage("javascript");
    expect(tsFrameworks.some((f) => f.id === "react")).toBe(true);
    expect(jsFrameworks.some((f) => f.id === "react")).toBe(true);
  });

  it("does not duplicate on re-registration", () => {
    const registry = new FrameworkRegistry();
    registry.register(djangoConfig);
    registry.register(djangoConfig);
    expect(registry.getForLanguage("python")).toHaveLength(1);
  });

  it("getForLanguage returns a copy, not the internal array", () => {
    const registry = new FrameworkRegistry();
    registry.register(djangoConfig);
    const result = registry.getForLanguage("python");
    result.push(reactConfig);
    expect(registry.getForLanguage("python")).toHaveLength(1);
  });

  describe("createDefault", () => {
    it("registers all 11 built-in framework configs", () => {
      const registry = FrameworkRegistry.createDefault();
      expect(registry.getAllFrameworks()).toHaveLength(11);
    });

    it("includes frameworks for multiple languages", () => {
      const registry = FrameworkRegistry.createDefault();
      expect(registry.getForLanguage("python").length).toBeGreaterThanOrEqual(3);
      expect(registry.getForLanguage("typescript").length).toBeGreaterThanOrEqual(2);
      expect(registry.getForLanguage("java").length).toBeGreaterThanOrEqual(1);
      expect(registry.getForLanguage("ruby").length).toBeGreaterThanOrEqual(1);
      expect(registry.getForLanguage("go").length).toBeGreaterThanOrEqual(1);
      expect(registry.getForLanguage("razor").some((f) => f.id === "aspnet")).toBe(true);
    });
  });
});
