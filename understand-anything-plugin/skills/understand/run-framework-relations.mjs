#!/usr/bin/env node
/** Run deterministic relation providers and union their file adjacency into scan-result.json. */
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { detectCategory } from './scan-project.mjs';

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

const {
  FrameworkRegistry,
  FrameworkRelationRegistry,
  LanguageRegistry,
  matchesManifestPattern,
  resolveUaDir,
  runFrameworkRelationProviders,
} = core;

function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function readChangedFiles(path) {
  if (!path) return undefined;
  return readFileSync(path, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean);
}

function refreshChangedFiles(scan, root, changedFiles, frameworkRegistry, providerRegistry) {
  if (!changedFiles) return;
  const languageRegistry = LanguageRegistry.createDefault();
  const byPath = new Map((Array.isArray(scan.files) ? scan.files : []).map((file) => [file.path, file]));
  scan.importMap = scan.importMap ?? {};
  const providerFrameworks = frameworkRegistry.getAllFrameworks()
    .filter((framework) => providerRegistry.get(framework.id));
  const watchedLanguages = new Set(providerFrameworks.flatMap((framework) => framework.languages));
  const watchedManifests = providerFrameworks.flatMap((framework) => framework.manifestFiles);

  for (const rawPath of changedFiles) {
    const filePath = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const language = languageRegistry.getForFile(filePath)?.id;
    const existing = byPath.get(filePath);
    if (
      !watchedManifests.some((pattern) => matchesManifestPattern(filePath, pattern))
      && !watchedLanguages.has(language ?? existing?.language)
    ) continue;
    let target;
    try {
      target = realpathSync(join(root, filePath));
      if (!isWithin(root, target) || !statSync(target).isFile()) throw new Error('not a project file');
    } catch {
      byPath.delete(filePath);
      delete scan.importMap[filePath];
      for (const [source, targets] of Object.entries(scan.importMap)) {
        if (Array.isArray(targets)) scan.importMap[source] = targets.filter((targetPath) => targetPath !== filePath);
      }
      continue;
    }
    const content = readFileSync(target, 'utf-8');
    const prior = existing ?? {};
    byPath.set(filePath, {
      ...prior,
      path: filePath,
      language: language ?? filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase(),
      sizeLines: content === '' ? 0 : content.split('\n').length - (content.endsWith('\n') ? 1 : 0),
      fileCategory: detectCategory(filePath),
    });
    if (!(filePath in scan.importMap)) scan.importMap[filePath] = [];
  }
  scan.files = [...byPath.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function augmentDeterministicFrameworks(scan, root, registry) {
  const manifests = {};
  const patterns = registry.getAllFrameworks().flatMap((framework) => framework.manifestFiles);
  for (const file of scan.files ?? []) {
    if (!patterns.some((pattern) => matchesManifestPattern(file.path, pattern))) continue;
    try {
      const target = realpathSync(join(root, file.path));
      if (isWithin(root, target)) manifests[file.path] = readFileSync(target, 'utf-8');
    } catch {
      // The refreshed inventory already drops changed missing manifests.
    }
  }
  const frameworks = Array.isArray(scan.frameworks) ? [...scan.frameworks] : [];
  const seen = new Set(frameworks);
  for (const framework of registry.detectFrameworks(manifests)) {
    if (!seen.has(framework.id)) {
      seen.add(framework.id);
      frameworks.push(framework.id);
    }
  }
  scan.frameworks = frameworks;
}

export function unionFileDependencies(importMap, artifacts) {
  const output = {};
  for (const [source, targets] of Object.entries(importMap ?? {})) {
    output[source] = Array.isArray(targets) ? [...new Set(targets)] : [];
  }
  for (const artifact of artifacts) {
    for (const dependency of artifact.fileDependencies) {
      const targets = output[dependency.sourcePath] ?? [];
      if (!targets.includes(dependency.targetPath)) targets.push(dependency.targetPath);
      output[dependency.sourcePath] = targets;
    }
  }
  return output;
}

export async function run(projectRoot, options = {}) {
  const root = realpathSync(projectRoot);
  const uaDir = resolveUaDir(root);
  const intermediateDir = join(uaDir, 'intermediate');
  const scanPath = options.scanResultPath
    ? resolve(options.scanResultPath)
    : join(intermediateDir, 'scan-result.json');
  if (!existsSync(scanPath)) throw new Error(`scan result not found: ${scanPath}`);

  const scan = JSON.parse(readFileSync(scanPath, 'utf-8'));
  const frameworkRegistry = options.frameworkRegistry ?? FrameworkRegistry.createDefault();
  const providerRegistry = options.providerRegistry ?? FrameworkRelationRegistry.createDefault();
  const changedFiles = options.changedFiles ?? readChangedFiles(options.changedFilesPath);
  refreshChangedFiles(scan, root, changedFiles, frameworkRegistry, providerRegistry);
  augmentDeterministicFrameworks(scan, root, frameworkRegistry);

  const result = await runFrameworkRelationProviders({
    frameworkIds: Array.isArray(scan.frameworks) ? scan.frameworks : [],
    frameworkRegistry,
    providerRegistry,
    context: {
      projectRoot: root,
      files: Array.isArray(scan.files) ? scan.files : [],
      changedFiles,
      async readFile(filePath) {
        try {
          const target = realpathSync(join(root, filePath));
          if (!isWithin(root, target)) return null;
          return readFileSync(target, 'utf-8');
        } catch {
          return null;
        }
      },
    },
  });

  mkdirSync(intermediateDir, { recursive: true });
  const expectedArtifacts = new Set();
  for (const artifact of result.artifacts) {
    const filename = `ua-framework-relations-${artifact.frameworkId}.json`;
    expectedArtifacts.add(filename);
    writeFileSync(
      join(intermediateDir, filename),
      `${JSON.stringify(artifact, null, 2)}\n`,
      'utf-8',
    );
  }
  for (const filename of readdirSync(intermediateDir)) {
    if (
      /^ua-framework-relations-[a-z0-9_-]+\.json$/i.test(filename)
      && !expectedArtifacts.has(filename)
    ) {
      unlinkSync(join(intermediateDir, filename));
    }
  }

  scan.importMap = unionFileDependencies(scan.importMap, result.artifacts);
  writeFileSync(scanPath, `${JSON.stringify(scan, null, 2)}\n`, 'utf-8');
  writeFileSync(
    join(intermediateDir, 'ua-framework-relations-stats.json'),
    `${JSON.stringify(result.stats, null, 2)}\n`,
    'utf-8',
  );

  for (const warning of result.warnings) {
    process.stderr.write(`Warning: run-framework-relations: ${warning}\n`);
  }
  process.stderr.write(
    `run-framework-relations: providers=${result.stats.providersExecuted} `
    + `failures=${result.stats.providerFailures} `
    + `fileDependencies=${result.stats.fileDependenciesAdded}\n`,
  );
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  try {
    const projectRoot = process.argv[2];
    if (!projectRoot) {
      throw new Error('usage: run-framework-relations.mjs <project-root> [--changed-files=<path>]');
    }
    let changedFilesPath;
    for (const arg of process.argv.slice(3)) {
      const match = arg.match(/^--changed-files=(.+)$/);
      if (!match || changedFilesPath) throw new Error(`invalid option: ${arg}`);
      changedFilesPath = resolve(match[1]);
    }
    await run(projectRoot, { changedFilesPath });
  } catch (error) {
    process.stderr.write(`Error: run-framework-relations: ${error.message}\n`);
    process.exitCode = 1;
  }
}
