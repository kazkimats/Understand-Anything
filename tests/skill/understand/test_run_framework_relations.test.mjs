import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(
  TEST_DIR,
  '../../../understand-anything-plugin/skills/understand/run-framework-relations.mjs',
);

describe('run-framework-relations.mjs', () => {
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
});
