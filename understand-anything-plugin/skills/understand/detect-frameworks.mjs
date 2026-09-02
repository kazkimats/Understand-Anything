#!/usr/bin/env node
/**
 * Deterministically augments scan-result.json framework IDs from registered
 * framework manifest patterns. Existing LLM detections are preserved.
 */
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

const { FrameworkRegistry, matchesManifestPattern, resolveUaDir } = core;

function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function canonicalizeExistingFrameworks(frameworks, registry) {
  const configs = registry.getAllFrameworks();
  const aliases = new Map();
  for (const config of configs) {
    aliases.set(config.id.toLowerCase(), config.id);
    aliases.set(config.displayName.toLowerCase(), config.id);
  }

  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(frameworks) ? frameworks : []) {
    if (typeof value !== 'string' || value.trim() === '') continue;
    const trimmed = value.trim();
    const canonical = aliases.get(trimmed.toLowerCase()) ?? trimmed;
    const key = aliases.has(trimmed.toLowerCase())
      ? canonical
      : canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(canonical);
  }
  return { result, seen };
}

export function detectFrameworks(projectRoot, scanResult, registry = FrameworkRegistry.createDefault()) {
  const root = realpathSync(projectRoot);
  const patterns = registry
    .getAllFrameworks()
    .flatMap((framework) => framework.manifestFiles);
  const manifests = {};
  const warnings = [];

  for (const file of Array.isArray(scanResult.files) ? scanResult.files : []) {
    if (!file || typeof file.path !== 'string') continue;
    if (!patterns.some((pattern) => matchesManifestPattern(file.path, pattern))) continue;

    try {
      const candidate = realpathSync(join(root, file.path));
      if (!isWithin(root, candidate)) {
        warnings.push(`${file.path} resolves outside the project root`);
        continue;
      }
      manifests[file.path] = readFileSync(candidate, 'utf-8');
    } catch (error) {
      warnings.push(`${file.path} could not be read (${error.message})`);
    }
  }

  const deterministic = registry.detectFrameworks(manifests).map((framework) => framework.id);
  const { result: frameworks, seen } = canonicalizeExistingFrameworks(
    scanResult.frameworks,
    registry,
  );
  for (const id of deterministic) {
    if (seen.has(id)) continue;
    seen.add(id);
    frameworks.push(id);
  }

  return { frameworks, deterministic, warnings };
}

export function run(projectRoot, scanResultPath) {
  const root = realpathSync(projectRoot);
  const target = scanResultPath
    ? resolve(scanResultPath)
    : join(resolveUaDir(root), 'intermediate', 'scan-result.json');
  if (!existsSync(target)) {
    throw new Error(`scan result not found: ${target}`);
  }

  const scanResult = JSON.parse(readFileSync(target, 'utf-8'));
  const result = detectFrameworks(root, scanResult);
  scanResult.frameworks = result.frameworks;
  writeFileSync(target, `${JSON.stringify(scanResult, null, 2)}\n`, 'utf-8');

  for (const warning of result.warnings) {
    process.stderr.write(`Warning: detect-frameworks: ${warning}\n`);
  }
  process.stderr.write(
    `detect-frameworks: deterministic=${result.deterministic.length} total=${result.frameworks.length}\n`,
  );
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  try {
    const projectRoot = process.argv[2];
    if (!projectRoot) throw new Error('usage: detect-frameworks.mjs <project-root> [scan-result-path]');
    run(projectRoot, process.argv[3]);
  } catch (error) {
    process.stderr.write(`Error: detect-frameworks: ${error.message}\n`);
    process.exitCode = 1;
  }
}
