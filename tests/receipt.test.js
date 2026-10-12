const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ReceiptCollisions = require('../assets/receipt-collisions.js');

const source = fs.readFileSync(path.join(__dirname, '../assets/receipt.js'), 'utf8');

function eventTarget(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    emit(name, event = {}) {
      for (const callback of listeners.get(name) || []) callback(event);
    }
  }, extra);
}

// Execute the real script with deterministic DOM, rendering and clock boundaries.
// Geometry and texture layout are inspected before the WebGL upload.
function createReceipt({ width = 298, height = 400, finePointer = true, reduced = false, missingThree = false, missingCollisions = false, failWebGL = false } = {}) {
  const frames = new Map();
  const timers = new Map();
  let nextId = 1;
  let now = 0;
  const captured = new Set();
  const classNames = new Set();
  const bounds = { left: 0, top: 0, width, height };
  const canvas = eventTarget({
    style: {},
    setAttribute() {},
    setPointerCapture(id) { captured.add(id); },
    hasPointerCapture(id) { return captured.has(id); },
    releasePointerCapture(id) { captured.delete(id); },
    getBoundingClientRect: () => bounds
  });
  const wrap = {
    clientWidth: width, clientHeight: height, innerHTML: '',
    classList: { add: name => classNames.add(name), remove: name => classNames.delete(name) },
    replaceChildren() {}
  };
  const draws = [];
  const context2d = {
    font: '', textAlign: 'left',
    clearRect() { draws.length = 0; },
    fillRect(x, y, w, h) { draws.push({ type: 'rect', x, y, w, h }); },
    fillText(text, x, y, maxWidth) {
      const size = Number(this.font.match(/(\d+)px/)[1]);
      draws.push({ type: 'text', text, x, y, size, width: Math.min(this.measureText(text).width, maxWidth ?? Infinity) });
    },
    measureText(text) {
      const size = Number(this.font.match(/(\d+)px/)?.[1] || 24);
      return { width: Array.from(text).reduce((sum, character) => sum + size * (/[^\x00-\x7f]/.test(character) ? 1 : 0.6), 0) };
    },
    createLinearGradient: () => ({ addColorStop() {} })
  };
  for (const name of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'clip', 'arc', 'fill', 'stroke', 'setLineDash']) context2d[name] = () => {};

  class Vector {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z = 0) { Object.assign(this, { x, y, z }); return this; }
  }
  class Geometry {
    constructor() { this.attributes = {}; }
    setAttribute(name, value) { this.attributes[name] = value; }
    setIndex(array) { this.index = { array }; }
    computeVertexNormals() {}
    computeBoundingSphere() {}
  }
  class Material { constructor(options) { Object.assign(this, options); } }
  class Mesh {
    constructor(geometry, material) { Object.assign(this, { geometry, material, position: new Vector() }); }
  }
  class Raycaster {
    constructor() {
      this.ray = { intersectPlane: (plane, point) => point.set(this.x, this.y, -plane.constant) };
    }
    setFromCamera(mouse, camera) {
      this.x = mouse.x * camera.right;
      this.y = mouse.y * camera.top;
    }
    intersectObject(mesh) {
      const points = mesh.geometry.attributes.position.array;
      const uvs = mesh.geometry.attributes.uv.array;
      const indices = mesh.geometry.index.array;
      let hit;
      // Orthographic ray picking must use the deformed triangles, including Z;
      // otherwise a second grab on a swinging or folded receipt is never tested.
      for (let i = 0; i < indices.length; i += 3) {
        const vertices = indices.slice(i, i + 3);
        const [a, b, c] = vertices.map(vertex => vertex * 3);
        const denominator = (points[b + 1] - points[c + 1]) * (points[a] - points[c]) + (points[c] - points[b]) * (points[a + 1] - points[c + 1]);
        if (Math.abs(denominator) < 1e-12) continue;
        const wa = ((points[b + 1] - points[c + 1]) * (this.x - points[c]) + (points[c] - points[b]) * (this.y - points[c + 1])) / denominator;
        const wb = ((points[c + 1] - points[a + 1]) * (this.x - points[c]) + (points[a] - points[c]) * (this.y - points[c + 1])) / denominator;
        const wc = 1 - wa - wb;
        if (Math.min(wa, wb, wc) < -1e-6) continue;
        const z = wa * points[a + 2] + wb * points[b + 2] + wc * points[c + 2];
        if (hit && z <= hit.point.z) continue;
        hit = {
          point: new Vector(this.x, this.y, z),
          uv: {
            x: wa * uvs[vertices[0] * 2] + wb * uvs[vertices[1] * 2] + wc * uvs[vertices[2] * 2],
            y: wa * uvs[vertices[0] * 2 + 1] + wb * uvs[vertices[1] * 2 + 1] + wc * uvs[vertices[2] * 2 + 1]
          }
        };
      }
      return hit ? [hit] : [];
    }
  }
  const THREE = {
    WebGLRenderer: class {
      constructor() {
        if (failWebGL) throw new Error('WebGL unavailable');
        this.domElement = canvas;
        this.shadowMap = {};
        this.capabilities = { getMaxAnisotropy: () => 8 };
        this.renders = 0;
      }
      setPixelRatio(value) { this.pixelRatio = value; }
      setSize(w, h) { canvas.width = w * this.pixelRatio; canvas.height = h * this.pixelRatio; }
      render() { this.renders++; }
    },
    Scene: class { add() {} },
    OrthographicCamera: class { constructor() { this.position = new Vector(); } lookAt() {} updateProjectionMatrix() {} },
    PlaneGeometry: Geometry, BufferGeometry: Geometry,
    BufferAttribute: class { constructor(array) { this.array = array; } setUsage() {} },
    ShadowMaterial: Material, MeshLambertMaterial: Material, MeshDepthMaterial: Material, Mesh,
    AmbientLight: class {},
    DirectionalLight: class { constructor() { this.position = new Vector(); this.shadow = { mapSize: {}, camera: {} }; } },
    CanvasTexture: class { constructor(image) { this.image = image; } },
    Vector2: Vector, Vector3: Vector, Raycaster,
    Plane: class { constructor(normal, constant) { this.constant = constant; } }
  };
  const queries = new Map([
    ['(prefers-reduced-motion: reduce)', eventTarget({ matches: reduced })],
    ['(any-pointer: fine)', eventTarget({ matches: finePointer })]
  ]);
  const observers = {};
  const window = eventTarget({
    THREE: missingThree ? undefined : THREE,
    ReceiptCollisions: missingCollisions ? undefined : ReceiptCollisions,
    devicePixelRatio: 1.5,
    matchMedia: query => queries.get(query),
    IntersectionObserver: true, ResizeObserver: true
  });
  const document = eventTarget({
    hidden: false,
    getElementById: () => wrap,
    createElement: () => ({ getContext: () => context2d })
  });
  const sandbox = {
    window, document, THREE,
    performance: { now: () => now },
    IntersectionObserver: class { constructor(callback) { observers.intersection = callback; } observe() {} },
    ResizeObserver: class { constructor(callback) { observers.resize = callback; } observe() {} },
    requestAnimationFrame(callback) { const id = nextId++; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setInterval(callback) { const id = nextId++; timers.set(id, callback); return id; },
    clearInterval: id => timers.delete(id)
  };
  // Keep diagnostics confined to the test VM; the shipped page exposes no internals.
  const instrumented = source.replace(/\n}\);\s*$/, `
    globalThis.receipt = { pos, prev, rest, pinned, COLS, ROWS, W, H, FIXED_STEP, camera, renderer, geo, selfCollisions, receiptProfiles, receiptTextureControl, buildConstraints, solveStretch,
      state: () => ({ dragging, enableInteractiveReceipt, dragPt, target: [pointerTargetX, pointerTargetY] }) };
});`);
  vm.runInNewContext(instrumented, sandbox);
  window.emit('DOMContentLoaded');

  function tick(delta = 1000 / 60) {
    now += delta;
    const scheduled = [...frames.values()];
    frames.clear();
    for (const callback of scheduled) callback(now);
  }
  function drain() {
    let count = 0;
    while (frames.size && count++ < 800) tick();
    assert.equal(frames.size, 0, 'receipt must stop rendering after it settles');
    return count;
  }
  function pointer(name, x, y, pointerId = 1, button = 0, pointerType = 'mouse') {
    canvas.emit(name, { clientX: x, clientY: y, pointerId, button, pointerType, timeStamp: now, preventDefault() {} });
  }
  function worldPoint(x, y) {
    return [(x / sandbox.receipt.camera.right + 1) * bounds.width / 2, (1 - y / sandbox.receipt.camera.top) * bounds.height / 2];
  }
  return { receipt: sandbox.receipt, canvas, wrap, window, document, queries, observers, frames, timers, captured, draws, tick, drain, pointer, worldPoint };
}

// An independent edge/face intersection check observes the actual mesh, rather
// than accepting the collision solver's own contact count as proof of separation.
function findPaperIntersection({ pos, geo }) {
  const faces = [], edges = [], seen = new Set();
  const indices = geo.index.array;
  for (let i = 0; i < indices.length; i += 3) {
    const ids = indices.slice(i, i + 3), points = ids.map(vertex => vertex * 3);
    const min = [0, 1, 2].map(axis => Math.min(...points.map(b => pos[b + axis])));
    const max = [0, 1, 2].map(axis => Math.max(...points.map(b => pos[b + axis])));
    faces.push({ ids, points, min, max });
    for (let j = 0; j < 3; j++) {
      const a = ids[j], b = ids[(j + 1) % 3], key = Math.min(a, b) + ':' + Math.max(a, b);
      if (!seen.has(key)) { seen.add(key); edges.push([a, b]); }
    }
  }
  for (const [u, v] of edges) {
    const a = u * 3, b = v * 3;
    const min = [0, 1, 2].map(axis => Math.min(pos[a + axis], pos[b + axis]));
    const max = [0, 1, 2].map(axis => Math.max(pos[a + axis], pos[b + axis]));
    for (const face of faces) {
      if (face.ids.includes(u) || face.ids.includes(v) ||
          face.min[0] > max[0] || face.max[0] < min[0] ||
          face.min[1] > max[1] || face.max[1] < min[1] ||
          face.min[2] > max[2] || face.max[2] < min[2]) continue;
      const [p, q, s] = face.points;
      const ex = pos[q] - pos[p], ey = pos[q + 1] - pos[p + 1], ez = pos[q + 2] - pos[p + 2];
      const fx = pos[s] - pos[p], fy = pos[s + 1] - pos[p + 1], fz = pos[s + 2] - pos[p + 2];
      const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
      const d0 = nx * (pos[a] - pos[p]) + ny * (pos[a + 1] - pos[p + 1]) + nz * (pos[a + 2] - pos[p + 2]);
      const d1 = nx * (pos[b] - pos[p]) + ny * (pos[b + 1] - pos[p + 1]) + nz * (pos[b + 2] - pos[p + 2]);
      if (d0 * d1 >= 0) continue;
      const t = d0 / (d0 - d1);
      if (t <= 1e-5 || t >= 1 - 1e-5) continue;
      const x = pos[a] + t * (pos[b] - pos[a]) - pos[p];
      const y = pos[a + 1] + t * (pos[b + 1] - pos[a + 1]) - pos[p + 1];
      const z = pos[a + 2] + t * (pos[b + 2] - pos[a + 2]) - pos[p + 2];
      const ee = ex * ex + ey * ey + ez * ez, ef = ex * fx + ey * fy + ez * fz, ff = fx * fx + fy * fy + fz * fz;
      const xe = x * ex + y * ey + z * ez, xf = x * fx + y * fy + z * fz, denominator = ee * ff - ef * ef;
      if (Math.abs(denominator) < 1e-12) continue;
      const vb = (ff * xe - ef * xf) / denominator, vc = (ee * xf - ef * xe) / denominator;
      if (vb > 1e-5 && vc > 1e-5 && vb + vc < 1 - 1e-5) return { edge: [u, v], face: face.ids };
    }
  }
  return null;
}

test('every receipt profile fits its paper texture with undistorted proportions', () => {
  const app = createReceipt();
  const { receipt, draws } = app;
  const { width, height } = receipt.receiptTextureControl.texture.image;
  assert.ok(Math.abs(width / height - receipt.W / receipt.H) < 1e-12);
  for (const profile of receipt.receiptProfiles) {
    receipt.receiptTextureControl.redraw(profile);
    assert.ok(draws.some(draw => draw.text === 'github.com/openshane'));
    assert.ok(draws.some(draw => draw.text === profile.footer));
    for (const draw of draws.filter(draw => draw.type === 'text')) {
      assert.ok(draw.y - draw.size >= 0 && draw.y < height - 16, `${draw.text} must stay inside the paper`);
      assert.ok(draw.width <= width - 112, `${draw.text} must wrap within the printed area`);
    }
    assert.ok(draws.some(draw => draw.type === 'rect' && draw.h === 76 && draw.y + draw.h < height - 100), 'barcode must be fully visible');
  }
});

test('renderer and camera fit the actual canvas on narrow, short and desktop layouts', () => {
  for (const [width, height] of [[230, 300], [298, 400], [326, 360], [500, 280]]) {
    const app = createReceipt({ width, height });
    const { camera, W, H } = app.receipt;
    assert.equal(app.canvas.width, width * 1.5);
    assert.equal(app.canvas.height, height * 1.5);
    assert.ok(Math.abs(camera.right / camera.top - width / height) < 1e-12);
    assert.ok(camera.right * 2 > W && camera.top * 2 > H, 'paper should keep margins on every side');
  }
});

test('material tension preserves an isometric fold around triangle edges', () => {
  const app = createReceipt();
  app.drain();
  const { pos, rest, prev, pinned, COLS, ROWS, W, H, buildConstraints, solveStretch } = app.receipt;
  // Isolate material tension on a flat, unsupported patch. Fold one side 90
  // degrees around c === r, preserving the lengths of all triangle edges.
  pinned.fill(0);
  for (let b = 2; b < rest.length; b += 3) rest[b] = 0;
  pos.set(rest);
  prev.set(rest);
  buildConstraints();
  for (let r = 0; r < ROWS; r++) {
    for (let c = r + 1; c < COLS; c++) {
      const b = (r * COLS + c) * 3;
      const dx = rest[b] + W / 2, dy = rest[b + 1] - H / 2;
      const along = (dx - dy) / 2;
      pos[b] = -W / 2 + along;
      pos[b + 1] = H / 2 - along;
      pos[b + 2] = (dx + dy) / Math.SQRT2;
    }
  }
  const folded = Float64Array.from(pos);
  for (let i = 0; i < 20; i++) solveStretch();
  const displacement = Math.max(...Array.from(pos, (value, i) => Math.abs(value - folded[i])));
  assert.ok(displacement < 1e-10, `material tension must leave a free hinge folded; displacement ${displacement}`);
});

test('dragging outside the canvas preserves the paper grid and releases into a settled shape', () => {
  const app = createReceipt();
  app.drain();
  const baseline = Float64Array.from(app.receipt.pos);
  app.pointer('pointerdown', ...app.worldPoint(0.34, -0.34));
  assert.ok(app.receipt.state().dragging);
  assert.ok(app.captured.has(1));
  app.pointer('pointermove', 1200, -800);
  for (let i = 0; i < 60; i++) app.tick();
  const { pos, rest, pinned, COLS, ROWS, camera } = app.receipt;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const b = (r * COLS + c) * 3;
      assert.ok(Number.isFinite(pos[b]) && Number.isFinite(pos[b + 1]) && Number.isFinite(pos[b + 2]));
      if (pinned[r * COLS + c]) for (let axis = 0; axis < 3; axis++) assert.equal(pos[b + axis], rest[b + axis]);
      assert.ok(pos[b] >= camera.left && pos[b] <= camera.right && pos[b + 1] >= camera.bottom && pos[b + 1] <= camera.top, 'paper must stay inside the canvas');
      const neighbors = [c < COLS - 1 ? b + 3 : -1, r < ROWS - 1 ? b + COLS * 3 : -1];
      for (const neighbor of neighbors) {
        if (neighbor === -1) continue;
        const distance = Math.hypot(pos[neighbor] - pos[b], pos[neighbor + 1] - pos[b + 1], pos[neighbor + 2] - pos[b + 2]);
        const length = Math.hypot(rest[neighbor] - rest[b], rest[neighbor + 1] - rest[b + 1], rest[neighbor + 2] - rest[b + 2]);
        assert.ok(distance > length * 0.88 && distance < length * 1.12, `paper edge must keep its material length; ratio ${distance / length}`);
      }
    }
  }
  app.pointer('pointerup', 1200, -800);
  assert.equal(app.receipt.state().dragging, false);
  assert.equal(app.captured.size, 0);
  assert.ok(app.drain() <= 600);
  const residual = Math.max(...Array.from(pos, (value, i) => Math.abs(value - baseline[i])));
  assert.ok(residual < 0.05, `paper must relax after its swing; residual ${residual}`);
});

test('the same drag has the same physics at 30, 60 and 120 Hz', () => {
  const positions = [];
  for (const fps of [30, 60, 120]) {
    const app = createReceipt();
    app.drain();
    app.pointer('pointerdown', ...app.worldPoint(0.34, -0.34));
    app.pointer('pointermove', ...app.worldPoint(0.5, -0.18));
    app.tick();
    for (let i = 0; i < fps; i++) app.tick(1000 / fps);
    positions.push(Float64Array.from(app.receipt.pos));
  }
  for (const result of positions.slice(1)) {
    const deviation = Math.max(...Array.from(result, (value, i) => Math.abs(value - positions[0][i])));
    assert.ok(deviation < 1e-8, `refresh rate changed the simulation by ${deviation}`);
  }
});

test('the grabbed point stays within a pixel of slow cursor motion', () => {
  const app = createReceipt();
  app.drain();
  app.pointer('pointerdown', ...app.worldPoint(0.34, -0.34));
  for (let i = 1; i <= 12; i++) {
    app.pointer('pointermove', ...app.worldPoint(0.34 + i * 0.012, -0.34 + i * 0.009));
    app.tick();
    const { dragPt, target } = app.receipt.state();
    const { pos } = app.receipt;
    const error = Math.hypot(pos[dragPt * 3] - target[0], pos[dragPt * 3 + 1] - target[1]);
    assert.ok(error < 0.006, `grabbed point trails the cursor by ${error}`);
  }
});

test('a sudden cursor change eases briefly without teleporting or leaving persistent lag', () => {
  const app = createReceipt();
  app.drain();
  app.pointer('pointerdown', ...app.worldPoint(0.34, -0.34));
  const { dragPt } = app.receipt.state();
  const b = dragPt * 3;
  const start = [app.receipt.pos[b], app.receipt.pos[b + 1]];
  app.pointer('pointermove', ...app.worldPoint(0.6, -0.2));
  const { target } = app.receipt.state();
  const distance = Math.hypot(target[0] - start[0], target[1] - start[1]);
  app.tick(1000 / 120);
  const first = Math.hypot(app.receipt.pos[b] - start[0], app.receipt.pos[b + 1] - start[1]);
  assert.ok(first > distance * 0.25 && first < distance * 0.8, 'first step should soften a cursor jump while responding immediately');
  for (let i = 0; i < 9; i++) app.tick();
  assert.ok(Math.hypot(app.receipt.pos[b] - target[0], app.receipt.pos[b + 1] - target[1]) < 0.001, 'brief smoothing must not leave the grab lagging behind a stopped cursor');
});

test('lifting and reversing a corner does not intersect other paper faces', () => {
  const app = createReceipt();
  app.drain();
  app.pointer('pointerdown', ...app.worldPoint(-0.612, -0.952));
  for (let i = 1; i <= 25; i++) {
    app.pointer('pointermove', ...app.worldPoint(-0.612 + 1.012 * i / 25, -0.952 + 1.752 * i / 25));
    app.tick();
    assert.equal(findPaperIntersection(app.receipt), null, `raised corner intersects at frame ${i}`);
    assert.equal(findPaperIntersection({ ...app.receipt, pos: app.receipt.geo.attributes.position.array }), null, 'rendered drag must remain separated');
  }
  for (let i = 0; i < 30; i++) app.tick();
  assert.equal(findPaperIntersection(app.receipt), null, 'holding a folded sheet must keep its layers apart');
  app.pointer('pointermove', ...app.worldPoint(-0.5, 0.25));
  for (let i = 1; i <= 12; i++) {
    app.tick();
    assert.equal(findPaperIntersection(app.receipt), null, `reversed corner intersects at frame ${i}`);
    assert.equal(findPaperIntersection({ ...app.receipt, pos: app.receipt.geo.attributes.position.array }), null, 'rendered reversal must remain separated');
  }
  app.pointer('pointerup', 0, 0);
  for (let i = 0; i < 24; i++) {
    app.tick();
    if (i % 6 === 0) assert.equal(findPaperIntersection({ ...app.receipt, pos: app.receipt.geo.attributes.position.array }), null, 'render interpolation must not recreate a crossing');
  }
  app.drain();
});

test('the attached top stays straight and a raised corner unfolds into a hanging sheet', () => {
  const app = createReceipt();
  app.drain();
  const { pos, rest, COLS, ROWS, H } = app.receipt;
  app.pointer('pointerdown', ...app.worldPoint(-0.54, 0.85));
  app.pointer('pointermove', ...app.worldPoint(0.55, -0.6));
  for (let i = 0; i < 45; i++) app.tick();
  for (let c = 0; c < COLS; c++) {
    for (let axis = 0; axis < 3; axis++) assert.equal(pos[c * 3 + axis], rest[c * 3 + axis], 'attached edge must not turn into a diagonal crease');
  }
  app.pointer('pointerup', 0, 0);
  app.drain();

  app.pointer('pointerdown', ...app.worldPoint(-0.612, -0.952));
  assert.ok(app.receipt.state().dragging);
  for (let i = 1; i <= 25; i++) {
    app.pointer('pointermove', ...app.worldPoint(-0.612 + 1.012 * i / 25, -0.952 + 1.752 * i / 25));
    app.tick();
  }
  for (let i = 0; i < 30; i++) app.tick();
  const liftedCorner = ((ROWS - 2) * COLS + 1) * 3 + 1;
  assert.ok(pos[liftedCorner] > rest[liftedCorner] + 0.5, 'regression must exercise an upward fold');
  app.pointer('pointerup', 0, 0);
  for (let i = 0; i < 180; i++) app.tick();
  for (let c = 0; c < COLS; c++) {
    const bottom = ((ROWS - 1) * COLS + c) * 3;
    assert.ok(pos[c * 3 + 1] - pos[bottom + 1] > H * 0.97, 'released lower edge must drop back below its support');
    for (let r = 1; r < ROWS; r++) {
      const b = (r * COLS + c) * 3;
      assert.ok(pos[b + 1] < pos[b - COLS * 3 + 1], 'released rows must not remain inverted');
    }
  }
  app.drain();
});

test('repeated grabs while the receipt is swinging still settle into a natural drape', () => {
  const app = createReceipt();
  app.drain();
  const { pos, COLS, ROWS, H } = app.receipt;
  const checkSeparation = () => {
    assert.equal(findPaperIntersection(app.receipt), null, 'successive grabs must keep the physical paper separated');
    assert.equal(findPaperIntersection({ pos: app.receipt.geo.attributes.position.array, geo: app.receipt.geo }), null, 'successive grabs must keep the displayed paper separated');
  };
  for (const [column, x, y] of [[2, 0.35, 0.62], [18, -0.4, 0.7], [10, 0.2, 0.65]]) {
    const b = ((ROWS - 5) * COLS + column) * 3;
    // Input targets the visible interpolated surface, as it does in the browser.
    const displayed = app.receipt.geo.attributes.position.array;
    const start = [displayed[b], displayed[b + 1]];
    app.pointer('pointerdown', ...app.worldPoint(...start));
    assert.ok(app.receipt.state().dragging, 'a visible folded surface must remain grabbable');
    for (let i = 1; i <= 18; i++) {
      app.pointer('pointermove', ...app.worldPoint(start[0] + (x - start[0]) * i / 18, start[1] + (y - start[1]) * i / 18));
      app.tick();
      checkSeparation();
    }
    app.pointer('pointerup', 0, 0);
    for (let i = 0; i < 18; i++) {
      app.tick();
      checkSeparation();
    }
  }
  for (let i = 0; i < 180; i++) {
    app.tick();
    if (i % 6 === 0) checkSeparation();
  }
  for (let c = 0; c < COLS; c++) {
    assert.ok(pos[c * 3 + 1] - pos[((ROWS - 1) * COLS + c) * 3 + 1] > H * 0.97, 'successive folds must unfold instead of piling up');
  }
  app.drain();
  assert.equal(app.captured.size, 0);
});

test('release carries the recent cursor momentum into a gradually damped swing', () => {
  const app = createReceipt();
  app.drain();
  app.pointer('pointerdown', ...app.worldPoint(0.34, -0.34));
  const { dragPt } = app.receipt.state();
  for (let i = 1; i <= 8; i++) {
    app.pointer('pointermove', ...app.worldPoint(0.34 + i * 0.015, -0.34 + i * 0.006));
    app.tick();
  }
  app.pointer('pointerup', 0, 0);
  const { pos, prev } = app.receipt;
  assert.ok(pos[dragPt * 3] - prev[dragPt * 3] > 0.003, 'release should retain the forward flick');
  const motion = () => Math.sqrt(Array.from(pos, (value, i) => (value - prev[i]) ** 2).reduce((sum, value) => sum + value, 0) / pos.length);
  const early = [];
  const late = [];
  for (let i = 0; i < 240; i++) {
    app.tick();
    if (i < 30) early.push(motion());
    if (i >= 210) late.push(motion());
  }
  assert.ok(Math.max(...early) > 0.0002, 'paper should keep swinging after release');
  assert.ok(Math.max(...late) < Math.max(...early) * 0.25, 'motion should decay instead of oscillating forever');
  app.drain();
  const stopped = Float64Array.from(pos);
  const renders = app.receipt.renderer.renders;
  app.tick(1000);
  assert.deepEqual(Array.from(pos), Array.from(stopped));
  assert.equal(app.receipt.renderer.renders, renders, 'settled receipt should stop rendering');
});

test('holding the cursor still before release does not replay an old flick', () => {
  const app = createReceipt();
  app.drain();
  app.pointer('pointerdown', ...app.worldPoint(0.34, -0.34));
  const { dragPt } = app.receipt.state();
  app.pointer('pointermove', ...app.worldPoint(0.5, -0.18));
  for (let i = 0; i < 15; i++) app.tick();
  app.pointer('pointerup', 0, 0);
  for (let axis = 0; axis < 3; axis++) {
    const b = dragPt * 3 + axis;
    assert.equal(app.receipt.pos[b], app.receipt.prev[b], 'stale pointer velocity must not become a throw');
  }
  app.drain();
});

test('touch and reduced-motion modes stay static and react to preference changes', () => {
  for (const options of [{ finePointer: false }, { reduced: true }]) {
    const app = createReceipt(options);
    app.drain();
    assert.equal(app.canvas.style.touchAction, 'pan-y');
    app.pointer('pointerdown', ...app.worldPoint(0.34, -0.34));
    assert.equal(app.receipt.state().dragging, false);
    assert.deepEqual(app.receipt.pos, app.receipt.rest);
  }
  const app = createReceipt();
  app.drain();
  app.pointer('pointerdown', ...app.worldPoint(0.34, -0.34));
  const query = app.queries.get('(prefers-reduced-motion: reduce)');
  query.matches = true;
  query.emit('change');
  app.drain();
  assert.equal(app.receipt.state().dragging, false);
  assert.equal(app.captured.size, 0);
  assert.equal(app.timers.size, 0);
  assert.deepEqual(app.receipt.pos, app.receipt.rest);
});

test('narrow desktop layouts allow mouse grabs while leaving touch scrolling available', () => {
  const app = createReceipt({ width: 326, height: 360 });
  app.drain();
  assert.equal(app.canvas.style.touchAction, 'pan-y');
  const point = app.worldPoint(0.34, -0.34);
  app.pointer('pointerdown', ...point, 1, 0, 'touch');
  assert.equal(app.receipt.state().dragging, false);
  assert.equal(app.captured.size, 0);
  app.pointer('pointerdown', ...point);
  assert.equal(app.receipt.state().dragging, true);
  assert.ok(app.captured.has(1));
  app.pointer('pointerup', ...point);
  app.drain();
});

test('hidden and offscreen receipts cancel dragging, rendering and profile timers', () => {
  const app = createReceipt();
  app.drain();
  app.pointer('pointerdown', ...app.worldPoint(0.34, -0.34));
  app.document.hidden = true;
  app.document.emit('visibilitychange');
  assert.equal(app.frames.size, 0);
  assert.equal(app.timers.size, 0);
  assert.equal(app.captured.size, 0);
  assert.equal(app.receipt.state().dragging, false);
  app.document.hidden = false;
  app.document.emit('visibilitychange');
  assert.equal(app.frames.size, 1);
  app.tick(30000);
  app.drain();
  app.observers.intersection([{ isIntersecting: false }]);
  assert.equal(app.frames.size, 0);
  assert.equal(app.timers.size, 0);
  app.observers.intersection([{ isIntersecting: true }]);
  assert.equal(app.frames.size, 1);
  assert.equal(app.timers.size, 1);
});

test('pointer cancellation and focus loss release the drag', () => {
  for (const boundary of ['pointercancel', 'blur']) {
    const app = createReceipt();
    app.drain();
    app.pointer('pointerdown', ...app.worldPoint(0.34, -0.34));
    if (boundary === 'blur') app.window.emit('blur');
    else app.pointer(boundary, 0, 0);
    assert.equal(app.receipt.state().dragging, false);
    assert.equal(app.captured.size, 0);
    app.drain();
  }
});

test('missing rendering dependencies and unavailable WebGL still show the static receipt', () => {
  for (const options of [{ missingThree: true }, { missingCollisions: true }, { failWebGL: true }]) {
    const app = createReceipt(options);
    assert.match(app.wrap.innerHTML, /IndustrialSim/);
    assert.equal(app.frames.size, 0);
    assert.equal(app.timers.size, 0);
  }
});
