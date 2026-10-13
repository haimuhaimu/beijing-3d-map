import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beihaiReflectionAnchors } from '../beihai-reflections.mjs';

test('all actual Beihai lamp reflections begin inside the lake in their own shore direction', () => {
  const world = JSON.parse(readFileSync(new URL('../places.json', import.meta.url)));
  const anchors = beihaiReflectionAnchors(world);
  assert.equal(anchors.length, world.beihaiShore.reflectionLights.length);
  assert.ok(anchors.length >= 17);
  for (const [i, anchor] of anchors.entries()) {
    const lamp = world.beihaiShore.reflectionLights[i].position;
    const [x, z, reach, strength] = anchor;
    const radius = Math.hypot((x - 2) / 5.65, (z - 7) / 6.8);
    assert.ok(radius > .95 && radius < 1, 'reflections must start on water, not on the bank');
    assert.ok(Math.abs((x - 2) * (lamp[1] - 7) - (z - 7) * (lamp[0] - 2)) < .001, 'each reflection must align with its physical lamp');
    assert.ok(reach > 0 && strength > 0 && strength <= 1);
  }
});

test('missing or invalid reflection metadata cannot produce invalid shader uniforms', () => {
  assert.deepEqual(beihaiReflectionAnchors({}), []);
  const world = { places: [{ id: 'beihai', position: [2, -7] }], beihaiShore: { lakeRadii: [5.65, 6.8], reflectionLights: [{ position: [NaN, 7], strength: 1 }, { position: [2, 7], strength: 1 }, { position: [8, 7], strength: -1 }] } };
  assert.deepEqual(beihaiReflectionAnchors(world), []);
  world.beihaiShore.reflectionLights = Array.from({ length: 40 }, () => ({ position: [8, 7], strength: 3 }));
  const anchors = beihaiReflectionAnchors(world);
  assert.equal(anchors.length, 24);
  assert.ok(anchors.flat().every(Number.isFinite));
  assert.ok(anchors.every(anchor => anchor[3] === 1));
});
