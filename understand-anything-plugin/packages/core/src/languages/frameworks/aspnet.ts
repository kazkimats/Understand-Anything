import type { FrameworkConfig } from "../types.js";

export const aspnetConfig = {
  id: "aspnet",
  displayName: "ASP.NET Core",
  languages: ["csharp", "razor"],
  manifestFiles: ["*.csproj"],
  detectionKeywords: [
    "Microsoft.NET.Sdk.Web",
    "Microsoft.AspNetCore.App",
    "Microsoft.AspNetCore.Mvc",
    "Microsoft.NET.Sdk.Razor",
  ],
  promptSnippetPath: "./frameworks/aspnet.md",
  entryPoints: ["**/Program.cs", "**/Startup.cs"],
  layerHints: {
    controllers: "api",
    services: "service",
    repositories: "data",
    data: "data",
    views: "ui",
    areas: "ui",
    middleware: "middleware",
    config: "config",
  },
} satisfies FrameworkConfig;
