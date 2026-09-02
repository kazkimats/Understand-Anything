import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
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
});
