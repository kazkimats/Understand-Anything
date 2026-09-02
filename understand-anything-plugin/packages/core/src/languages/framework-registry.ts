import { FrameworkConfigSchema } from "./types.js";
import type { FrameworkConfig } from "./types.js";
import { builtinFrameworkConfigs } from "./frameworks/index.js";

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

/** Match a framework manifest pattern without requiring a glob dependency. */
export function matchesManifestPattern(relativePath: string, pattern: string): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);
  const normalizedPattern = normalizeRelativePath(pattern);
  const candidate = normalizedPattern.includes("/")
    ? normalizedPath
    : normalizedPath.split("/").pop() ?? normalizedPath;
  return patternToRegExp(normalizedPattern).test(candidate);
}

/**
 * Registry for framework configurations. Provides detection of frameworks
 * from manifest file contents and lookup by id or language.
 */
export class FrameworkRegistry {
  private byId = new Map<string, FrameworkConfig>();
  private byLanguage = new Map<string, FrameworkConfig[]>();

  register(config: FrameworkConfig): void {
    const parsed = FrameworkConfigSchema.parse(config);

    // Prevent duplicate registration
    if (this.byId.has(parsed.id)) return;

    this.byId.set(parsed.id, parsed);

    for (const lang of parsed.languages) {
      const existing = this.byLanguage.get(lang) ?? [];
      existing.push(parsed);
      this.byLanguage.set(lang, existing);
    }
  }

  getById(id: string): FrameworkConfig | null {
    return this.byId.get(id) ?? null;
  }

  getForLanguage(langId: string): FrameworkConfig[] {
    return [...(this.byLanguage.get(langId) ?? [])];
  }

  getAllFrameworks(): FrameworkConfig[] {
    return [...this.byId.values()];
  }

  /**
   * Detect frameworks from manifest file contents.
   * @param manifests - Map of filename to file content (e.g., { "requirements.txt": "django==4.2\n..." })
   * @returns Array of detected FrameworkConfig objects
   */
  detectFrameworks(manifests: Record<string, string>): FrameworkConfig[] {
    const detected = new Set<string>();
    const results: FrameworkConfig[] = [];

    for (const config of this.byId.values()) {
      if (detected.has(config.id)) continue;

      for (const manifestFile of config.manifestFiles) {
        const content = Object.entries(manifests).find(
          ([key]) => matchesManifestPattern(key, manifestFile),
        )?.[1];

        if (!content) continue;

        const contentLower = content.toLowerCase();
        const found = config.detectionKeywords.some((keyword) =>
          contentLower.includes(keyword.toLowerCase()),
        );

        if (found) {
          detected.add(config.id);
          results.push(config);
          break;
        }
      }
    }

    return results;
  }

  /**
   * Create a registry pre-populated with all built-in framework configs.
   */
  static createDefault(): FrameworkRegistry {
    const registry = new FrameworkRegistry();
    for (const config of builtinFrameworkConfigs) {
      registry.register(config);
    }
    return registry;
  }
}
