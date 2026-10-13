import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const RUNTIME_FILES = Object.freeze([
  'index.html', 'style.css', 'main.mjs', 'state.mjs', 'map-layout.mjs',
  'city-lighting.mjs', 'city-surfaces.mjs', 'night-scene.mjs',
  'view-hierarchy.mjs', 'guided-view.mjs', 'overview-view.mjs',
  'beihai-reflections.mjs', 'beijing-world.glb', 'places.json',
  'model-info.json', 'preview.png', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'vendor/Noto-OFL.txt',
  'vendor/LICENSE', 'vendor/README.md', 'vendor/three.module.min.js',
  'vendor/three.core.min.js', 'vendor/controls/OrbitControls.js',
  'vendor/loaders/GLTFLoader.js', 'vendor/utils/BufferGeometryUtils.js',
]);

export async function readRuntimeFile(rootDir, relative) {
  if (!RUNTIME_FILES.includes(relative)) throw new Error('Not a runtime file');
  const root = await realpath(rootDir);
  const expected = path.join(root, relative), actual = await realpath(expected);
  if (actual !== expected) throw new Error('Symlink or outside runtime file');
  if (!(await stat(actual)).isFile()) throw new Error('Not a regular runtime file');
  return readFile(actual);
}

export const isMain = (url) => Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url));
