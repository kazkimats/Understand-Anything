import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  TEST_DIR,
  '../../../understand-anything-plugin/skills/understand/build-framework-context.mjs',
);

describe('build-framework-context.mjs', () => {
  it('builds one deduplicated context from registered snippet paths', async () => {
    const { buildFrameworkContext } = await import(pathToFileURL(SCRIPT).href);
    const context = buildFrameworkContext(['rails', 'unknown', 'rails', 'django']);
    expect(context).toContain('## Framework Context');
    expect(context).toContain('# Ruby on Rails Framework Addendum');
    expect(context).toContain('# Django Framework Addendum');
    expect(context.match(/# Ruby on Rails Framework Addendum/g)).toHaveLength(1);
  });

  it('returns an empty context when no registered addendum applies', async () => {
    const { buildFrameworkContext } = await import(pathToFileURL(SCRIPT).href);
    expect(buildFrameworkContext(['unknown'])).toBe('');
  });
});
