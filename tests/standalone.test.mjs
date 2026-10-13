import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, rm, writeFile, readdir, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = new URL('../', import.meta.url);

test('the browser dependency graph resolves entirely inside a copied map folder', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const importMap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  const queue = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => [match[1], root]);
  const visited = new Set();
  while (queue.length) {
    const [specifier, base] = queue.shift();
    if (specifier.startsWith('data:')) continue;
    const mapped = importMap[specifier];
    const url = new URL(mapped || specifier, mapped ? root : base);
    assert.equal(url.protocol, 'file:', `remote runtime dependency: ${specifier}`);
    const relative = path.relative(fileURLToPath(root), fileURLToPath(url));
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), `runtime escapes standalone folder: ${specifier}`);
    url.search = '';
    if (visited.has(url.href)) continue;
    visited.add(url.href);
    const bytes = await readFile(url);
    if (/\.(?:mjs|js)$/.test(url.pathname)) {
      // Vendor JSDoc contains usage examples, not runtime imports.
      const source = bytes.toString().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const imports = /(?:\b(?:import|export)\s*(?:\{[^}]*\}|\*[^;]*?|[\w$]+)\s*from\s*|\bimport\s*\(\s*|\bfetch\s*\(\s*)['"]([^'"]+)['"]/g;
      for (const match of source.matchAll(imports)) queue.push([match[1], url]);
    } else if (url.pathname.endsWith('.glb')) {
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      for (const entry of [...gltf.buffers, ...(gltf.images || [])]) {
        if (entry.uri) queue.push([entry.uri, url]);
      }
    }
  }
  assert.ok(visited.has(new URL('beijing-world.glb', root).href), 'follow the actual model fetch');
  assert.ok(visited.has(new URL('vendor/three.core.min.js', root).href), 'follow transitive Three.js imports');
});

const temporary = async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'beijing-map-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};
const filesBelow = async (directory, prefix = '') => {
  const result = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    result.push(...(entry.isDirectory() ? await filesBelow(directory, relative) : [relative]));
  }
  return result.sort();
};

test('static export contains only runtime files and reproduces source bytes with hashes', async (t) => {
  assert.ok(existsSync(new URL('scripts/build.mjs', root)), 'standalone build script is required');
  const { buildStatic } = await import('../scripts/build.mjs');
  const directory = await temporary(t), source = path.join(directory, 'source'), output = path.join(directory, 'site');
  await cp(fileURLToPath(root), source, { recursive: true, filter: (item) => !['dist', 'output', 'node_modules'].includes(path.basename(item)) });
  await writeFile(path.join(source, 'private-note.txt'), 'must never be exported');
  const manifest = await buildStatic({ sourceDir: source, outputDir: output });
  assert.deepEqual(await filesBelow(output), [...manifest.files.map(file => file.path), 'manifest.json'].sort());
  assert.ok(manifest.files.some(file => file.path === 'beijing-world.glb'));
  assert.ok(manifest.files.some(file => file.path === 'vendor/LICENSE'));
  assert.ok(!manifest.files.some(file => /private|tests\/|scripts\/|package\.json/.test(file.path)));
  for (const file of manifest.files) {
    const actual = await readFile(path.join(output, file.path));
    assert.deepEqual(actual, await readFile(path.join(source, file.path)), file.path);
    assert.equal(file.sha256, createHash('sha256').update(actual).digest('hex'));
    assert.equal(file.bytes, actual.length);
  }
  const before = await readFile(path.join(output, 'manifest.json'));
  await buildStatic({ sourceDir: source, outputDir: output });
  assert.deepEqual(await readFile(path.join(output, 'manifest.json')), before, 'reproducible manifest');
  await writeFile(path.join(output, 'user-note.txt'), 'preserve');
  await assert.rejects(buildStatic({ sourceDir: source, outputDir: output }), /unexpected/i);
  assert.equal(await readFile(path.join(output, 'user-note.txt'), 'utf8'), 'preserve');
  await assert.rejects(buildStatic({ sourceDir: source, outputDir: source }), /source/i);
});

test('preview serves the complete map but rejects non-runtime files, traversal and symlinks', async (t) => {
  assert.ok(existsSync(new URL('scripts/serve.mjs', root)), 'standalone preview script is required');
  const { createPreviewServer } = await import('../scripts/serve.mjs');
  const directory = await temporary(t), source = path.join(directory, 'map');
  await cp(fileURLToPath(root), source, { recursive: true, filter: (item) => !['dist', 'output', 'node_modules'].includes(path.basename(item)) });
  const server = createPreviewServer({ rootDir: source });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const index = await fetch(base + '/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.equal(await index.text(), await readFile(path.join(source, 'index.html'), 'utf8'));
  for (const [file, type] of [['main.mjs', 'text/javascript'], ['vendor/three.core.min.js', 'text/javascript'], ['beijing-world.glb', 'model/gltf-binary'], ['preview.png', 'image/png']]) {
    const response = await fetch(base + '/' + file + '?cache=test');
    assert.equal(response.status, 200, file);
    assert.ok(response.headers.get('content-type').startsWith(type), file);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(path.join(source, file)), file);
  }
  const head = await fetch(base + '/beijing-world.glb', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(Number(head.headers.get('content-length')), (await readFile(path.join(source, 'beijing-world.glb'))).length);
  for (const url of ['/package.json', '/scripts/serve.mjs', '/tests/standalone.test.mjs', '/.env', '/missing', '/%2e%2e%2fpackage.json']) {
    assert.equal((await fetch(base + url)).status, 404, url);
  }
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/%ZZ')).status, 400);
  await writeFile(path.join(directory, 'outside.txt'), 'outside');
  await rm(path.join(source, 'preview.png'));
  await symlink(path.join(directory, 'outside.txt'), path.join(source, 'preview.png'));
  assert.equal((await fetch(base + '/preview.png')).status, 404);
  const { buildStatic } = await import('../scripts/build.mjs');
  await assert.rejects(buildStatic({ sourceDir: source, outputDir: path.join(directory, 'site') }), /symlink|outside/i);
});
