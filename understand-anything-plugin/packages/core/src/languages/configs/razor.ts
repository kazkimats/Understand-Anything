import type { LanguageConfig } from "../types.js";

export const razorConfig = {
  id: "razor",
  displayName: "Razor",
  extensions: [".cshtml"],
  concepts: [
    "Razor directives",
    "model binding",
    "dependency injection",
    "Tag Helpers",
    "HTML templating",
  ],
  filePatterns: {
    entryPoints: [],
    barrels: ["_ViewImports.cshtml", "_ViewStart.cshtml"],
    tests: [],
    config: [],
  },
} satisfies LanguageConfig;
