import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  TEST_DIR,
  '../../../understand-anything-plugin/skills/understand/detect-frameworks.mjs',
);
const roots = [];

function setup(files, frameworks = []) {
  const root = mkdtempSync(join(tmpdir(), 'ua-detect-frameworks-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf-8');
  }
  const scanPath = join(root, 'scan-result.json');
  writeFileSync(scanPath, JSON.stringify({
    frameworks,
    files: Object.keys(files).map((path) => ({ path })),
  }), 'utf-8');
  return { root, scanPath };
}

function run(root, scanPath) {
  return spawnSync('node', [SCRIPT, root, scanPath], { encoding: 'utf-8' });
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('detect-frameworks.mjs', () => {
  it('unions deterministic detections with LLM frameworks and deduplicates known IDs', () => {
    const project = setup({
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    }, ['React', 'Vite']);

    const result = run(project.root, project.scanPath);

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(project.scanPath, 'utf-8')).frameworks).toEqual([
      'react',
      'Vite',
    ]);
  });

  it('reads nested exact manifests from the deterministic inventory', () => {
    const project = setup({
      'services/api/requirements.txt': 'django==5.1\n',
      'README.md': 'django is mentioned here but is not a manifest\n',
    });

    const result = run(project.root, project.scanPath);

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(project.scanPath, 'utf-8')).frameworks).toEqual(['django']);
  });

  it('leaves the LLM result intact when no registered manifest matches', () => {
    const project = setup({ 'README.md': '# Example\n' }, ['Custom Framework']);

    expect(run(project.root, project.scanPath).status).toBe(0);
    expect(JSON.parse(readFileSync(project.scanPath, 'utf-8')).frameworks).toEqual([
      'Custom Framework',
    ]);
  });

  it('detects ASP.NET Core from a web project but not a plain class library', () => {
    const project = setup({
      'src/Library/Library.csproj': '<Project Sdk="Microsoft.NET.Sdk" />\n',
      'src/Web/Web.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web" />\n',
    });

    expect(run(project.root, project.scanPath).status).toBe(0);
    expect(JSON.parse(readFileSync(project.scanPath, 'utf-8')).frameworks).toEqual(['aspnet']);
  });
});
