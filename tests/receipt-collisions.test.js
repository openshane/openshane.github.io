const { test } = require('node:test');
const assert = require('node:assert/strict');
const ReceiptCollisions = require('../assets/receipt-collisions.js');

function makeSolver(points, triangles, pinned, { limits, grabbed = -1 } = {}) {
  const positions = Float64Array.from(points.flat());
  const previous = Float64Array.from(positions);
  const solver = new ReceiptCollisions({ positions, previous, pinned: Uint8Array.from(pinned), triangles, spacing: 0.068, limits });
  solver.beginStep(grabbed);
  return { positions, previous, solver };
}

function resolve(solver) {
  solver.detect();
  for (let i = 0; i < 24; i++) solver.resolve();
}

test('a fast vertex cannot tunnel through a supported face between substeps', () => {
  const { positions, previous, solver } = makeSolver(
    [[0, 0, 0.2], [-0.2, -0.2, 0], [0.2, -0.2, 0], [0, 0.2, 0]],
    [1, 2, 3], [0, 1, 1, 1]
  );
  positions[2] = -0.2;
  resolve(solver);
  assert.ok(positions[2] >= solver.gap * 0.99, 'crossing must be stopped on the incoming side');
  assert.ok(positions[2] - previous[2] >= -1e-8, 'contact must cancel inward velocity');
  assert.deepEqual(Array.from(positions.slice(3)), [-0.2, -0.2, 0, 0.2, -0.2, 0, 0, 0.2, 0]);
});

test('crossing edges collide even when their endpoints miss the opposite faces', () => {
  const { positions, solver } = makeSolver(
    [[-0.3, 0, 0.1], [0.3, 0, 0.1], [0, -0.3, 0], [0, 0.3, 0], [-1, -0.2, 0.1], [0.45, 0, 1]],
    [0, 1, 4, 2, 3, 5], [0, 0, 1, 1, 0, 1]
  );
  for (const i of [0, 1, 4]) positions[i * 3 + 2] = -0.1;
  resolve(solver);
  assert.ok((positions[2] + positions[5]) / 2 >= solver.gap * 0.95, 'edge interiors must stay on their original side');
});

test('touching folds keep a small gap without moving their supports', () => {
  const { positions, previous, solver } = makeSolver(
    [[-0.2, -0.2, 0], [0.2, -0.2, 0], [0, 0.2, 0], [-0.2, -0.2, 0.06], [0.2, -0.2, 0.06], [0, 0.2, 0.06]],
    [0, 1, 2, 3, 4, 5], [1, 1, 1, 0, 0, 0]
  );
  for (const i of [3, 4, 5]) positions[i * 3 + 2] = 0.002;
  resolve(solver);
  for (const i of [3, 4, 5]) assert.ok(positions[i * 3 + 2] >= solver.gap * 0.99);
  assert.deepEqual(Array.from(positions.slice(0, 9)), Array.from(previous.slice(0, 9)));
  assert.ok(Array.from(positions).every(Number.isFinite));
});

test('a flat sheet does not repel its own incident triangles or edges', () => {
  const { positions, previous, solver } = makeSolver(
    [[0, 0, 0], [0.068, 0, 0], [0.068, 0.068, 0], [0, 0.068, 0]],
    [0, 2, 1, 0, 3, 2], [0, 0, 0, 0]
  );
  resolve(solver);
  assert.equal(solver.contactCount, 0);
  assert.deepEqual(positions, previous);
});

test('a rotating face cannot hide a slow contact behind a large motion bound', () => {
  const { positions, solver } = makeSolver(
    [[-0.19, -0.19, 0.04], [-0.2, -0.2, 0], [0.2, -0.2, 0], [0, 0.2, 0]],
    [1, 2, 3], [0, 1, 1, 1]
  );
  positions[11] = 10;
  resolve(solver);
  assert.ok(solver.contactCount > 0, 'advancement must not discard an unresolved swept contact');
  assert.ok(-(positions[1] + 0.2) + positions[2] / 25 >= 0, 'the rotating surface must not sweep through the point');
});

test('a held point yields to a layer backed by the canvas wall', () => {
  const { positions, solver } = makeSolver(
    [[0, 0, 0.03], [-0.2, -0.2, 0], [0.2, -0.2, 0], [0, 0.2, 0]],
    [1, 2, 3], [0, 0, 0, 0], { limits: [-1, 1, -1, 1, 0, 0.1], grabbed: 0 }
  );
  positions[2] = 0;
  resolve(solver);
  assert.ok(positions[2] >= solver.gap * 0.99, 'a mouse constraint must not override the supported layer');
  for (const i of [1, 2, 3]) assert.equal(positions[i * 3 + 2], 0, 'contact must not push the layer through the wall');
});
