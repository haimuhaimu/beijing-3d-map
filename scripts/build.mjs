import { mkdir, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, RUNTIME_FILES, readRuntimeFile, isMain } from './runtime-files.mjs';

async function checkOutput(directory, prefix = '') {
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Unexpected output symlink: ' + relative);
    if (entry.isDirectory()) {
      if (!RUNTIME_FILES.some(file => file.startsWith(relative + '/'))) throw new Error('Unexpected output directory: ' + relative);
      await checkOutput(directory, relative);
    } else if (![...RUNTIME_FILES, 'manifest.json'].includes(relative)) {
      throw new Error('Unexpected output file (preserved): ' + relative);
    }
  }
}

export async function buildStatic({ sourceDir = ROOT, outputDir = path.join(ROOT, 'dist') } = {}) {
  const source = path.resolve(sourceDir), output = path.resolve(outputDir);
  if (source === output || source.startsWith(output + path.sep)) throw new Error('Output must not overwrite source');
  const existing = await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Unexpected output path');
  if (existing) await checkOutput(output);
  // Validate all inputs before creating or modifying any output.
  const entries = await Promise.all(RUNTIME_FILES.map(async file => ({ file, bytes: await readRuntimeFile(source, file) })));
  const manifest = { format: 1, files: entries.map(({ file, bytes }) => ({
    path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  })).sort((a, b) => a.path.localeCompare(b.path, 'en')) };
  for (const { file, bytes } of entries) {
    await mkdir(path.dirname(path.join(output, file)), { recursive: true });
    await writeFile(path.join(output, file), bytes);
  }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (isMain(import.meta.url)) {
  const result = await buildStatic();
  console.log(`Built ${result.files.length} runtime files into dist/ (${result.files.reduce((sum, file) => sum + file.bytes, 0)} bytes).`);
}
