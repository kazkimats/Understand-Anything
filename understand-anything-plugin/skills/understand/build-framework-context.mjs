#!/usr/bin/env node
/** Build one canonical framework prompt context for Phase 2 and Phase 4. */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SKILL_DIR = dirname(SCRIPT_PATH);
const PLUGIN_ROOT = resolve(SKILL_DIR, '../..');
const require = createRequire(resolve(PLUGIN_ROOT, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(PLUGIN_ROOT, 'packages/core/dist/index.js')).href);
}

const { FrameworkRegistry, resolveUaDir } = core;

function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function buildFrameworkContext(frameworkIds, registry = FrameworkRegistry.createDefault()) {
  const sections = [];
  const seen = new Set();
  for (const id of Array.isArray(frameworkIds) ? frameworkIds : []) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const framework = registry.getById(id);
    if (!framework) continue;
    try {
      const snippetPath = realpathSync(resolve(SKILL_DIR, framework.promptSnippetPath));
      if (!isWithin(SKILL_DIR, snippetPath)) continue;
      sections.push(readFileSync(snippetPath, 'utf-8').trim());
    } catch {
      // Missing optional framework addenda are intentionally skipped.
    }
  }
  return sections.length ? `## Framework Context\n\n${sections.join('\n\n')}\n` : '';
}

export function run(projectRoot, scanResultPath, outputPath) {
  const root = realpathSync(projectRoot);
  const uaDir = resolveUaDir(root);
  const scanPath = scanResultPath
    ? resolve(scanResultPath)
    : join(uaDir, 'intermediate', 'scan-result.json');
  const target = outputPath
    ? resolve(outputPath)
    : join(uaDir, 'intermediate', 'framework-context.md');
  if (!existsSync(scanPath)) throw new Error(`scan result not found: ${scanPath}`);
  const scan = JSON.parse(readFileSync(scanPath, 'utf-8'));
  const context = buildFrameworkContext(scan.frameworks);
  writeFileSync(target, context, 'utf-8');
  process.stderr.write(
    `build-framework-context: frameworks=${Array.isArray(scan.frameworks) ? scan.frameworks.length : 0} `
    + `bytes=${Buffer.byteLength(context)}\n`,
  );
  return context;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  try {
    const projectRoot = process.argv[2];
    if (!projectRoot) {
      throw new Error(
        'usage: build-framework-context.mjs <project-root> [scan-result-path] [output-path]',
      );
    }
    run(projectRoot, process.argv[3], process.argv[4]);
  } catch (error) {
    process.stderr.write(`Error: build-framework-context: ${error.message}\n`);
    process.exitCode = 1;
  }
}
