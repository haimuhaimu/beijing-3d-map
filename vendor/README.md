# Three.js 0.180.0

Vendored from the official npm release archive:
https://registry.npmjs.org/three/-/three-0.180.0.tgz

Runtime files are copied from `three@0.180.0`; the only patch is an `eslint-disable` header that excludes third-party source from the parent project's application-specific lint rules:

- `build/three.module.min.js`
- `build/three.core.min.js`
- `examples/jsm/controls/OrbitControls.js`
- `examples/jsm/loaders/GLTFLoader.js`
- `examples/jsm/utils/BufferGeometryUtils.js`

The original MIT license is preserved in `LICENSE`. No CDN connection is required at runtime. The page's import map resolves the addons' bare `three` import to the local module. The parent portfolio package has not been modified or given an undeclared npm dependency.
