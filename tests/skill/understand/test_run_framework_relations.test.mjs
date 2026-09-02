import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(
  TEST_DIR,
  '../../../understand-anything-plugin/skills/understand/run-framework-relations.mjs',
);
const dotnetVersion = spawnSync('dotnet', ['--version'], { encoding: 'utf-8' });
const hasDotnet8 = dotnetVersion.status === 0
  && Number.parseInt(dotnetVersion.stdout.trim().split('.')[0], 10) >= 8;

function createRoslynFixture() {
  const root = mkdtempSync(join(tmpdir(), 'ua-framework-roslyn-'));
  const intermediate = join(root, '.ua', 'intermediate');
  mkdirSync(join(root, 'Web', 'Areas', 'Admin', 'Controllers'), { recursive: true });
  mkdirSync(join(root, 'Web', 'Areas', 'Admin', 'Views', 'Home'), { recursive: true });
  mkdirSync(intermediate, { recursive: true });
  const project = `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>
  <ItemGroup><FrameworkReference Include="Microsoft.AspNetCore.App" /></ItemGroup>
</Project>\n`;
  const controller = `
using Microsoft.AspNetCore.Mvc;
namespace Web.Areas.Admin.Controllers;
[Area("Admin")]
public class HomeController : Controller
{
    [ActionName("List")]
    public IActionResult Index() => View("Detail", new object());
}\n`;
  const files = [
    { path: 'Web/Web.csproj', language: 'csproj', fileCategory: 'config' },
    {
      path: 'Web/Areas/Admin/Controllers/HomeController.cs',
      language: 'csharp',
      fileCategory: 'code',
    },
    { path: 'Web/Program.cs', language: 'csharp', fileCategory: 'code' },
    {
      path: 'Web/Areas/Admin/Views/Home/Detail.cshtml',
      language: 'razor',
      fileCategory: 'markup',
    },
  ];
  writeFileSync(join(root, files[0].path), project);
  writeFileSync(join(root, files[1].path), controller);
  writeFileSync(join(root, files[2].path), 'public static class Program { public static void Main() { } }\n');
  writeFileSync(join(root, files[3].path), '<h1>Detail</h1>\n');
  writeFileSync(join(intermediate, 'scan-result.json'), JSON.stringify({
    frameworks: ['aspnet'],
    files,
    importMap: {},
  }));
  return { root, intermediate, files };
}

describe('run-framework-relations.mjs', () => {
  it('selects the semantic-facts TFM from the detected SDK major', async () => {
    const {
      parseDotnetVersion,
      semanticFactsSdkSupported,
      semanticFactsTargetFramework,
    } = await import(pathToFileURL(RUNNER).href);

    expect(semanticFactsTargetFramework('8.0.424')).toBe('net8.0');
    expect(semanticFactsTargetFramework('9.0.100')).toBe('net9.0');
    expect(semanticFactsTargetFramework('10.0.100')).toBe('net10.0');
    expect(semanticFactsTargetFramework('10.0.100-preview.2')).toBe('net10.0');
    expect(semanticFactsTargetFramework('not-a-version')).toBeNull();

    expect(semanticFactsSdkSupported(parseDotnetVersion('7.0.410'))).toBe(false);
    expect(semanticFactsSdkSupported(parseDotnetVersion('8.0.100'))).toBe(true);
    expect(semanticFactsSdkSupported(parseDotnetVersion('invalid'))).toBe(false);
  });

  it('uses the raw SDK version to select the semantic-facts cache directory', async () => {
    const { semanticToolCacheDir } = await import(pathToFileURL(RUNNER).href);
    const uaDir = join(tmpdir(), 'ua-semantic-cache-test');

    expect(semanticToolCacheDir(uaDir, '8.0.424')).not.toBe(
      semanticToolCacheDir(uaDir, '10.0.100'),
    );
  });

  it('unions and deduplicates file dependencies without dropping imports', async () => {
    const { unionFileDependencies } = await import(pathToFileURL(RUNNER).href);
    expect(unionFileDependencies({
      'a.ts': ['b.ts'],
      'b.ts': [],
    }, [{
      fileDependencies: [
        { sourcePath: 'a.ts', targetPath: 'b.ts', kind: 'existing' },
        { sourcePath: 'a.ts', targetPath: 'c.html', kind: 'template' },
        { sourcePath: 'c.html', targetPath: 'model.ts', kind: 'model' },
      ],
    }])).toEqual({
      'a.ts': ['b.ts', 'c.html'],
      'b.ts': [],
      'c.html': ['model.ts'],
    });
  });

  it('refreshes new and deleted framework files during incremental runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ua-framework-runner-'));
    try {
      const intermediate = join(root, '.ua', 'intermediate');
      mkdirSync(join(root, 'Web', 'Controllers'), { recursive: true });
      mkdirSync(join(root, 'Web', 'Views', 'Home'), { recursive: true });
      mkdirSync(intermediate, { recursive: true });
      writeFileSync(join(root, 'Web', 'Web.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web" />\n');
      writeFileSync(
        join(root, 'Web', 'Controllers', 'HomeController.cs'),
        'public class HomeController : Controller { public IActionResult Index() { return View(); } }\n',
      );
      writeFileSync(join(root, 'Web', 'Views', 'Home', 'Index.cshtml'), '<h1>Home</h1>\n');
      writeFileSync(join(intermediate, 'scan-result.json'), JSON.stringify({
        frameworks: [],
        files: [],
        importMap: {},
      }));
      const { run } = await import(pathToFileURL(RUNNER).href);
      const changedFiles = [
        'Web/Web.csproj',
        'Web/Controllers/HomeController.cs',
        'Web/Views/Home/Index.cshtml',
      ];

      await run(root, { changedFiles });
      let scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
      expect(scan.frameworks).toContain('aspnet');
      expect(scan.importMap['Web/Controllers/HomeController.cs']).toContain(
        'Web/Views/Home/Index.cshtml',
      );

      unlinkSync(join(root, 'Web', 'Views', 'Home', 'Index.cshtml'));
      await run(root, { changedFiles: ['Web/Views/Home/Index.cshtml'] });
      scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
      expect(scan.files.some((file) => file.path === 'Web/Views/Home/Index.cshtml')).toBe(false);
      expect(scan.importMap['Web/Controllers/HomeController.cs']).not.toContain(
        'Web/Views/Home/Index.cshtml',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasDotnet8)('extracts schema-valid semantic facts from an ASP.NET project', async () => {
    const fixture = createRoslynFixture();
    try {
      const { loadCSharpSemanticFacts } = await import(pathToFileURL(RUNNER).href);
      const facts = loadCSharpSemanticFacts(
        { files: fixture.files },
        fixture.root,
        join(fixture.root, '.ua'),
        { enabled: true },
      );

      expect(facts?.schemaVersion).toBe(1);
      expect(facts?.diagnostics).toEqual([]);
      expect(facts?.warnings).toEqual([]);
      expect(facts?.projects).toEqual([
        expect.objectContaining({
          projectFile: 'Web/Web.csproj',
          compilationSucceeded: true,
          referencesResolved: true,
        }),
      ]);
      expect(facts?.types).toContainEqual(expect.objectContaining({
        symbolName: 'Web.Areas.Admin.Controllers.HomeController',
        filePath: 'Web/Areas/Admin/Controllers/HomeController.cs',
        baseTypes: expect.arrayContaining([
          expect.objectContaining({ symbolName: 'Microsoft.AspNetCore.Mvc.Controller' }),
        ]),
        attributes: expect.arrayContaining([
          expect.objectContaining({
            symbolName: 'Microsoft.AspNetCore.Mvc.AreaAttribute',
            arguments: ['Admin'],
          }),
        ]),
      }));
      expect(facts?.invocations).toContainEqual(expect.objectContaining({
        invocationName: 'View',
        symbolName: expect.stringMatching(/^Microsoft\.AspNetCore\.Mvc\.Controller\.View\(/),
        arguments: ['"Detail"', 'new object()'],
        targetKind: 'instance-method',
        resolved: true,
      }));
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 90_000);

  it.skipIf(!hasDotnet8)('runs semantic-gated relations once and preserves fallback parity', async () => {
    const fixture = createRoslynFixture();
    try {
      const { run } = await import(pathToFileURL(RUNNER).href);
      const semanticResult = await run(fixture.root, { enableCSharpSemanticFacts: true });
      const semanticScan = JSON.parse(
        readFileSync(join(fixture.intermediate, 'scan-result.json'), 'utf-8'),
      );
      const semanticArtifact = JSON.parse(readFileSync(
        join(fixture.intermediate, 'ua-framework-relations-aspnet.json'),
        'utf-8',
      ));

      expect(semanticResult.stats.semanticFactsAvailable).toBe(1);
      expect(semanticResult.stats.semanticFactsProjects).toBe(1);
      expect(semanticResult.stats.semanticFactsIncomplete).toBe(0);
      expect(semanticArtifact.stats.roslynConfirmedControllers).toBe(1);
      expect(semanticScan.importMap['Web/Areas/Admin/Controllers/HomeController.cs']).toContain(
        'Web/Areas/Admin/Views/Home/Detail.cshtml',
      );
      expect(readFileSync(
        join(fixture.intermediate, 'ua-semantic-facts-csharp.json'),
        'utf-8',
      )).toContain('Microsoft.AspNetCore.Mvc.Controller.View');

      const fallbackResult = await run(fixture.root, { enableCSharpSemanticFacts: false });
      const fallbackScan = JSON.parse(
        readFileSync(join(fixture.intermediate, 'scan-result.json'), 'utf-8'),
      );
      expect(fallbackResult.stats.semanticFactsAvailable).toBe(0);
      expect(fallbackScan.importMap['Web/Areas/Admin/Controllers/HomeController.cs']).toContain(
        'Web/Areas/Admin/Views/Home/Detail.cshtml',
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 90_000);
});
