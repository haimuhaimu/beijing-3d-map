import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, RUNTIME_FILES } from './runtime-files.mjs';

const files = RUNTIME_FILES.filter(file => /\.(?:mjs|js)$/.test(file));
for (const directory of ['scripts', 'tests']) {
  files.push(...(await readdir(path.join(ROOT, directory))).filter(file => file.endsWith('.mjs')).map(file => directory + '/' + file));
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} JavaScript modules.`);
