import { describe, expect, it, vi } from 'vitest';
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

function createRoslynFixture({ styleDiagnosticSeverityError = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ua-framework-roslyn-'));
  const intermediate = join(root, '.ua', 'intermediate');
  mkdirSync(join(root, 'Web', 'Areas', 'Admin', 'Controllers'), { recursive: true });
  mkdirSync(join(root, 'Web', 'Areas', 'Admin', 'Views', 'Home'), { recursive: true });
  mkdirSync(intermediate, { recursive: true });
  const project = `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup><FrameworkReference Include="Microsoft.AspNetCore.App" /></ItemGroup>
</Project>\n`;
  const controller = `
using Microsoft.AspNetCore.Mvc;
${styleDiagnosticSeverityError ? 'using System.Text;' : ''}
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
  writeFileSync(join(root, files[2].path), 'System.Console.WriteLine("top-level");\n');
  writeFileSync(join(root, files[3].path), '<h1>Detail</h1>\n');
  if (styleDiagnosticSeverityError) {
    writeFileSync(join(root, 'Web', '.editorconfig'), `root = true

[*.cs]
dotnet_diagnostic.CS8019.severity = error
`);
  }
  writeFileSync(join(intermediate, 'scan-result.json'), JSON.stringify({
    frameworks: ['aspnet'],
    files,
    importMap: {},
  }));
  return { root, intermediate, files };
}

function createRoslynViewOverloadFixture() {
  const root = mkdtempSync(join(tmpdir(), 'ua-framework-view-overloads-'));
  const intermediate = join(root, '.ua', 'intermediate');
  mkdirSync(join(root, 'Web', 'Controllers'), { recursive: true });
  mkdirSync(join(root, 'Web', 'Views', 'Home'), { recursive: true });
  mkdirSync(intermediate, { recursive: true });
  const files = [
    { path: 'Web/Web.csproj', language: 'csproj', fileCategory: 'config' },
    { path: 'Web/Controllers/HomeController.cs', language: 'csharp', fileCategory: 'code' },
    { path: 'Web/Program.cs', language: 'csharp', fileCategory: 'code' },
    { path: 'Web/Views/Home/Index.cshtml', language: 'razor', fileCategory: 'markup' },
    { path: 'Web/Views/Home/Model.cshtml', language: 'razor', fileCategory: 'markup' },
    { path: 'Web/Views/Home/Detail.cshtml', language: 'razor', fileCategory: 'markup' },
    { path: 'Web/Views/Home/Dynamic.cshtml', language: 'razor', fileCategory: 'markup' },
    { path: 'Web/Views/Home/DynamicModel.cshtml', language: 'razor', fileCategory: 'markup' },
  ];
  writeFileSync(join(root, files[0].path), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup><FrameworkReference Include="Microsoft.AspNetCore.App" /></ItemGroup>
</Project>
`);
  writeFileSync(join(root, files[1].path), `using Microsoft.AspNetCore.Mvc;
namespace Web.Controllers;
public sealed class HomeViewModel { }
public class HomeController : Controller
{
    public IActionResult Index() => View();
    public IActionResult Model() => View(new HomeViewModel());
    public IActionResult Literal() => View("Detail");
    public IActionResult LiteralModel() => View("Detail", new HomeViewModel());
    public IActionResult Dynamic()
    {
        string viewName = GetViewName();
        return View(viewName);
    }
    public IActionResult DynamicModel()
    {
        string viewName = GetViewName();
        return View(viewName, new HomeViewModel());
    }
    private string GetViewName() => "Dynamic";
}
`);
  writeFileSync(join(root, files[2].path), 'System.Console.WriteLine("top-level");\n');
  for (const file of files.slice(3)) writeFileSync(join(root, file.path), `<h1>${file.path}</h1>\n`);
  writeFileSync(join(intermediate, 'scan-result.json'), JSON.stringify({
    frameworks: ['aspnet'],
    files,
    importMap: {},
  }));
  return { root, intermediate };
}

describe('run-framework-relations.mjs', () => {
  it('uses the default semantic-facts timeout when the environment value is unset', async () => {
    const { resolveSemanticFactsTimeoutMs } = await import(pathToFileURL(RUNNER).href);

    expect(resolveSemanticFactsTimeoutMs({})).toBe(120_000);
  });

  it('accepts a valid semantic-facts timeout from the environment', async () => {
    const { resolveSemanticFactsTimeoutMs } = await import(pathToFileURL(RUNNER).href);

    expect(resolveSemanticFactsTimeoutMs({
      UA_CSHARP_SEMANTIC_FACTS_TIMEOUT_MS: '240000',
    })).toBe(240_000);
  });

  it('accepts the 1000ms semantic-facts timeout boundary', async () => {
    const { resolveSemanticFactsTimeoutMs } = await import(pathToFileURL(RUNNER).href);

    expect(resolveSemanticFactsTimeoutMs({
      UA_CSHARP_SEMANTIC_FACTS_TIMEOUT_MS: '1000',
    })).toBe(1_000);
  });

  it('rejects a semantic-facts timeout below 1000ms with a warning', async () => {
    const { resolveSemanticFactsTimeoutMs } = await import(pathToFileURL(RUNNER).href);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(resolveSemanticFactsTimeoutMs({
        UA_CSHARP_SEMANTIC_FACTS_TIMEOUT_MS: '999',
      })).toBe(120_000);
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining(
        'invalid UA_CSHARP_SEMANTIC_FACTS_TIMEOUT_MS "999"',
      ));
    } finally {
      stderr.mockRestore();
    }
  });

  it.each(['abc', '0', '-5000'])(
    'rejects invalid semantic-facts timeout %s with a warning',
    async (value) => {
      const { resolveSemanticFactsTimeoutMs } = await import(pathToFileURL(RUNNER).href);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        expect(resolveSemanticFactsTimeoutMs({
          UA_CSHARP_SEMANTIC_FACTS_TIMEOUT_MS: value,
        })).toBe(120_000);
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining(
          `invalid UA_CSHARP_SEMANTIC_FACTS_TIMEOUT_MS "${value}"`,
        ));
      } finally {
        stderr.mockRestore();
      }
    },
  );

  it('uses the default semantic-facts timeout for an empty value without warning', async () => {
    const { resolveSemanticFactsTimeoutMs } = await import(pathToFileURL(RUNNER).href);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(resolveSemanticFactsTimeoutMs({
        UA_CSHARP_SEMANTIC_FACTS_TIMEOUT_MS: '',
      })).toBe(120_000);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });

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

  it('constructs restore and no-restore build arguments with identical MSBuild properties', async () => {
    const { semanticFactsBuildArguments } = await import(pathToFileURL(RUNNER).href);
    const cacheDir = join(tmpdir(), 'ua-semantic-build-args');
    const args = semanticFactsBuildArguments(cacheDir, '10.0.100');
    const expectedProperties = [
      '-p:TargetFramework=net10.0',
      `-p:BaseIntermediateOutputPath=${join(cacheDir, 'obj')}/`,
      `-p:MSBuildProjectExtensionsPath=${join(cacheDir, 'obj')}/`,
      `-p:RestorePackagesPath=${join(cacheDir, 'packages')}`,
    ];

    expect(args?.restore[0]).toBe('restore');
    expect(args?.build[0]).toBe('build');
    expect(args?.build).toContain('--no-restore');
    expect(args?.restore.filter((arg) => arg.startsWith('-p:'))).toEqual(expectedProperties);
    expect(args?.build.filter((arg) => arg.startsWith('-p:'))).toEqual(expectedProperties);
    expect(semanticFactsBuildArguments(cacheDir, 'invalid')).toBeNull();
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

  it.skipIf(!hasDotnet8)('skips top-level invocations without losing controller facts', async () => {
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
      expect(facts?.warnings).toContain(
        '1 invocations outside a resolvable containing method were skipped',
      );
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
      expect(facts?.invocations).not.toContainEqual(expect.objectContaining({
        invocationName: 'WriteLine',
      }));
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 90_000);

  it.skipIf(!hasDotnet8)('clamps an invalid environment timeout and loads semantic facts', async () => {
    const fixture = createRoslynFixture();
    vi.stubEnv('UA_CSHARP_SEMANTIC_FACTS_TIMEOUT_MS', '1');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { loadCSharpSemanticFacts } = await import(pathToFileURL(RUNNER).href);
      const facts = loadCSharpSemanticFacts(
        { files: fixture.files },
        fixture.root,
        join(fixture.root, '.ua'),
        { enabled: true },
      );

      expect(facts?.schemaVersion).toBe(1);
      expect(facts?.projects).toContainEqual(expect.objectContaining({
        projectFile: 'Web/Web.csproj',
        compilationSucceeded: true,
      }));
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining(
        'invalid UA_CSHARP_SEMANTIC_FACTS_TIMEOUT_MS "1"',
      ));
    } finally {
      stderr.mockRestore();
      vi.unstubAllEnvs();
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 150_000);

  it.skipIf(!hasDotnet8)('honors a trusted 1ms option and warns on timeout', async () => {
    const fixture = createRoslynFixture();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { loadCSharpSemanticFacts } = await import(pathToFileURL(RUNNER).href);
      const facts = loadCSharpSemanticFacts(
        { files: fixture.files },
        fixture.root,
        join(fixture.root, '.ua'),
        { enabled: true, timeoutMs: 1 },
      );

      expect(facts).toBeUndefined();
      expect(stderr).toHaveBeenCalledWith(expect.stringMatching(
        /timed out after 1ms .*UA_CSHARP_SEMANTIC_FACTS_TIMEOUT_MS/,
      ));
    } finally {
      stderr.mockRestore();
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 90_000);

  it.skipIf(!hasDotnet8)('keeps controller semantic gating with top-level statements', async () => {
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

  it.skipIf(!hasDotnet8)('resolves MVC view names from real Roslyn overload facts', async () => {
    const fixture = createRoslynViewOverloadFixture();
    try {
      const { run } = await import(pathToFileURL(RUNNER).href);
      await run(fixture.root, { enableCSharpSemanticFacts: true });
      const scan = JSON.parse(readFileSync(
        join(fixture.intermediate, 'scan-result.json'),
        'utf-8',
      ));
      const facts = JSON.parse(readFileSync(
        join(fixture.intermediate, 'ua-semantic-facts-csharp.json'),
        'utf-8',
      ));
      const artifact = JSON.parse(readFileSync(
        join(fixture.intermediate, 'ua-framework-relations-aspnet.json'),
        'utf-8',
      ));
      const targets = scan.importMap['Web/Controllers/HomeController.cs'];
      const viewSymbols = facts.invocations
        .filter((invocation) => invocation.invocationName === 'View')
        .map((invocation) => invocation.symbolName);

      expect(viewSymbols).toEqual(expect.arrayContaining([
        'Microsoft.AspNetCore.Mvc.Controller.View()',
        'Microsoft.AspNetCore.Mvc.Controller.View(object)',
        'Microsoft.AspNetCore.Mvc.Controller.View(string)',
        'Microsoft.AspNetCore.Mvc.Controller.View(string,object)',
      ]));
      expect(targets).toEqual(expect.arrayContaining([
        'Web/Views/Home/Index.cshtml',
        'Web/Views/Home/Model.cshtml',
        'Web/Views/Home/Detail.cshtml',
      ]));
      expect(targets).not.toContain('Web/Views/Home/Dynamic.cshtml');
      expect(targets).not.toContain('Web/Views/Home/DynamicModel.cshtml');
      expect(artifact.stats.actionViewCandidates).toBe(6);
      expect(artifact.stats.actionViewsResolved).toBe(4);
      expect(artifact.stats.actionViewsModelFallback).toBe(1);
      expect(artifact.stats.actionViewsNonLiteralSkipped).toBe(2);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 90_000);

  it.skipIf(!hasDotnet8)('keeps controller semantic gating for editorconfig-promoted style diagnostics', async () => {
    const fixture = createRoslynFixture({ styleDiagnosticSeverityError: true });
    try {
      const { run } = await import(pathToFileURL(RUNNER).href);
      const result = await run(fixture.root, { enableCSharpSemanticFacts: true });
      const facts = JSON.parse(readFileSync(
        join(fixture.intermediate, 'ua-semantic-facts-csharp.json'),
        'utf-8',
      ));
      const artifact = JSON.parse(readFileSync(
        join(fixture.intermediate, 'ua-framework-relations-aspnet.json'),
        'utf-8',
      ));
      const styleWarnings = facts.warnings.filter((warning) =>
        warning.includes('style diagnostics were treated as non-fatal'));

      expect(facts.diagnostics).toEqual([]);
      expect(facts.projects).toEqual([
        expect.objectContaining({
          projectFile: 'Web/Web.csproj',
          compilationSucceeded: true,
          referencesResolved: true,
        }),
      ]);
      expect(styleWarnings).toHaveLength(1);
      expect(styleWarnings[0]).toMatch(
        /^\d+ style diagnostics were treated as non-fatal \(CS8019: \d+\)$/,
      );
      expect(result.warnings).toContain(`csharp semantic facts: ${styleWarnings[0]}`);
      expect(result.stats.semanticFactsIncomplete).toBe(0);
      expect(artifact.stats.roslynConfirmedControllers).toBe(1);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 90_000);
});
