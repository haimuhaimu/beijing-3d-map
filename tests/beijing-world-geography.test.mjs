import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const catalog = JSON.parse(fs.readFileSync(new URL('../places.json', import.meta.url)));
const point = id => catalog.places.find(place => place.id === id).position;

test('the city retains Beijing geographic adjacency after artistic compression', () => {
  const north = (a,b) => assert.ok(point(a)[1] > point(b)[1], `${a} must be north of ${b}`);
  const east = (a,b) => assert.ok(point(a)[0] > point(b)[0], `${a} must be east of ${b}`);
  north('xierqi','zhongguancun'); north('zhongguancun','zhichun');
  east('zhichun','zhongguancun'); north('zhichun','beihai'); east('beihai','zhichun');
  north('olympic','beihai'); north('798','workers'); east('798','workers');
  north('xiangshan','zhongguancun'); east('zhongguancun','xiangshan');
  north('sanfeng','xiangshan'); east('xierqi','sanfeng');
  north('workers','happy-valley'); east('happy-valley','workers');
  north('happy-valley','universal'); east('universal','happy-valley');
});

test('CCTV, China Zun and Guomao belong to the CBD south of Workers Stadium and 798', () => {
  assert.ok(catalog.supportingLandmarks, 'supporting landmarks have explicit geographic sites');
  const sites = Object.fromEntries(catalog.supportingLandmarks.map(site => [site.id,site.position]));
  for (const id of ['cctv','china-zun','guomao']) {
    assert.ok(sites[id][1] < point('workers')[1] - 6, `${id} belongs south of Workers Stadium`);
    assert.ok(sites[id][1] < point('798')[1] - 20, `${id} must not be inside the 798 district`);
    assert.ok(sites[id][1] > point('happy-valley')[1], `${id} is north of Happy Valley`);
  }
  assert.ok(sites.cctv[1] > sites.guomao[1]);
  assert.ok(sites['china-zun'][0] > sites.cctv[0]);
  assert.ok(sites['temple-of-heaven'][1] < point('beihai')[1]);
});
