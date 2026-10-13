import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildStatic } from '../scripts/build.mjs';

test('static delivery retains original-work and font notices alongside the vendored MIT license', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'beijing-notices-'));
  try {
    const outputDir = path.join(parent, 'site');
    await buildStatic({ outputDir });
    for (const relative of ['LICENSE', 'vendor/Noto-OFL.txt', 'vendor/LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      const shipped = await readFile(path.join(outputDir, relative));
      assert.deepEqual(shipped, await readFile(new URL('../'+relative, import.meta.url)));
    }
  } finally { await rm(parent, { recursive: true, force: true }); }
});
