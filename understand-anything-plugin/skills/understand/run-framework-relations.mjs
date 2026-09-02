#!/usr/bin/env node
/** Run deterministic relation providers and union their file adjacency into scan-result.json. */
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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

const {
  FrameworkRegistry,
  FrameworkRelationRegistry,
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
