// Surface contacts for the receipt's Verlet mesh. Swept vertex/face and edge/edge
// tests retain the incoming side, including contacts between simulation steps.
(function (root) {
  class ReceiptCollisions {
    constructor({ positions, previous, pinned, triangles, spacing, limits }) {
      this.pos = positions;
      this.prev = previous;
      this.pinned = pinned;
      this.limits = limits;
      this.triangles = Int32Array.from(triangles);
      this.gap = spacing * 0.2;
      this.start = Float64Array.from(positions);
      this.speeds = new Float64Array(pinned.length);
      const edges = [];
      const seen = new Set();
      for (let i = 0; i < triangles.length; i += 3) {
        for (let j = 0; j < 3; j++) {
          const a = triangles[i + j], b = triangles[i + (j + 1) % 3];
          const key = Math.min(a, b) * pinned.length + Math.max(a, b);
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push(a, b);
        }
      }
      this.edges = Int32Array.from(edges);
      this.faceCount = triangles.length / 3;
      this.primitiveCount = this.faceCount + edges.length / 2;
      this.bounds = new Float64Array(this.primitiveCount * 6);
      this.vertexBounds = new Float64Array(pinned.length * 6);
      this.faceOrder = Array.from({ length: this.faceCount }, (_, i) => i);
      this.edgeOrder = Array.from({ length: edges.length / 2 }, (_, i) => i);
      this.vertexOrder = Array.from({ length: pinned.length }, (_, i) => i);
      this.active = new Int32Array(this.primitiveCount);
      this.contacts = new Float64Array(1024 * 11);
      this.contactCount = 0;
      this.ids = new Int32Array(4);
      this.sample = new Float64Array(12);
      this.result = new Float64Array(8);
      this.intervals = new Float64Array(64);
      this.grabbed = -1;
    }

    beginStep(grabbed = -1) {
      this.start.set(this.pos);
      this.grabbed = grabbed;
    }

    inverseMass(i) {
      // A held point has more inertia, but contact can still move it when the
      // mouse would otherwise force it through an immovable part of the sheet.
      return this.pinned[i] ? 0 : i === this.grabbed ? 0.2 : 1;
    }

    mobility(i, axis, gradient) {
      if (this.limits) {
        const value = this.pos[i * 3 + axis];
        if (gradient < 0 && value <= this.limits[axis * 2] + 1e-10 ||
            gradient > 0 && value >= this.limits[axis * 2 + 1] - 1e-10) return 0;
      }
      return this.inverseMass(i);
    }

    setBounds(out, offset, indices, first, count, padding) {
      for (let axis = 0; axis < 3; axis++) {
        let min = Infinity, max = -Infinity;
        for (let j = 0; j < count; j++) {
          const b = indices[first + j] * 3 + axis;
          min = Math.min(min, this.pos[b], this.start[b]);
          max = Math.max(max, this.pos[b], this.start[b]);
        }
        out[offset + axis * 2] = min - padding;
        out[offset + axis * 2 + 1] = max + padding;
      }
    }

    detect() {
      this.contactCount = 0;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < this.speeds.length; i++) {
        const b = i * 3;
        this.speeds[i] = Math.hypot(this.pos[b] - this.start[b], this.pos[b + 1] - this.start[b + 1], this.pos[b + 2] - this.start[b + 2]);
        for (let axis = 0; axis < 3; axis++) {
          this.vertexBounds[i * 6 + axis * 2] = Math.min(this.pos[b + axis], this.start[b + axis]);
          this.vertexBounds[i * 6 + axis * 2 + 1] = Math.max(this.pos[b + axis], this.start[b + axis]);
        }
        minX = Math.min(minX, this.vertexBounds[i * 6]); maxX = Math.max(maxX, this.vertexBounds[i * 6 + 1]);
        minY = Math.min(minY, this.vertexBounds[i * 6 + 2]); maxY = Math.max(maxY, this.vertexBounds[i * 6 + 3]);
        minZ = Math.min(minZ, this.vertexBounds[i * 6 + 4]); maxZ = Math.max(maxZ, this.vertexBounds[i * 6 + 5]);
      }
      const axis = maxY - minY > maxX - minX ? (maxZ - minZ > maxY - minY ? 4 : 2) : (maxZ - minZ > maxX - minX ? 4 : 0);
      for (let i = 0; i < this.primitiveCount; i++) {
        const face = i < this.faceCount;
        this.setBounds(this.bounds, i * 6, face ? this.triangles : this.edges, face ? i * 3 : (i - this.faceCount) * 2, face ? 3 : 2, face ? this.gap : this.gap / 2);
      }
      // Sweep reusable sorted bounds along the widest axis. Each feature pair
      // is visited once, without hash buckets or duplicate candidate allocations.
      this.faceOrder.sort((a, b) => this.bounds[a * 6 + axis] - this.bounds[b * 6 + axis]);
      this.vertexOrder.sort((a, b) => this.vertexBounds[a * 6 + axis] - this.vertexBounds[b * 6 + axis]);
      this.edgeOrder.sort((a, b) => this.bounds[(a + this.faceCount) * 6 + axis] - this.bounds[(b + this.faceCount) * 6 + axis]);
      let activeCount = 0, faceCursor = 0;
      for (const vertex of this.vertexOrder) {
        const v = vertex * 6;
        while (faceCursor < this.faceCount && this.bounds[this.faceOrder[faceCursor] * 6 + axis] <= this.vertexBounds[v + axis + 1]) this.active[activeCount++] = this.faceOrder[faceCursor++];
        for (let j = 0; j < activeCount;) {
          const face = this.active[j], b = face * 6;
          if (this.bounds[b + axis + 1] < this.vertexBounds[v + axis]) { this.active[j] = this.active[--activeCount]; continue; }
          j++;
          if (!this.overlap(this.vertexBounds, v, b)) continue;
          const a = this.triangles[face * 3], c = this.triangles[face * 3 + 1], d = this.triangles[face * 3 + 2];
          if (vertex !== a && vertex !== c && vertex !== d) this.testContact(false, vertex, a, c, d);
        }
      }
      activeCount = 0;
      for (const edge of this.edgeOrder) {
        const b = (edge + this.faceCount) * 6;
        const a = this.edges[edge * 2], c = this.edges[edge * 2 + 1];
        for (let j = 0; j < activeCount;) {
          const other = this.active[j], ob = (other + this.faceCount) * 6;
          if (this.bounds[ob + axis + 1] < this.bounds[b + axis]) { this.active[j] = this.active[--activeCount]; continue; }
          j++;
          if (!this.overlap(this.bounds, b, ob)) continue;
          const d = this.edges[other * 2], e = this.edges[other * 2 + 1];
          if (a !== d && a !== e && c !== d && c !== e) this.testContact(true, a, c, d, e);
        }
        this.active[activeCount++] = edge;
      }
    }

    overlap(bounds, a, b) {
      return bounds[a] <= this.bounds[b + 1] && bounds[a + 1] >= this.bounds[b] &&
        bounds[a + 2] <= this.bounds[b + 3] && bounds[a + 3] >= this.bounds[b + 2] &&
        bounds[a + 4] <= this.bounds[b + 5] && bounds[a + 5] >= this.bounds[b + 4];
    }

    closest(edge, time) {
      const p = this.sample, w = this.result;
      for (let j = 0; j < 4; j++) {
        for (let axis = 0; axis < 3; axis++) {
          const b = this.ids[j] * 3 + axis;
          p[j * 3 + axis] = this.start[b] + (this.pos[b] - this.start[b]) * time;
        }
      }
      if (edge) {
        const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2];
        const bx = p[9] - p[6], by = p[10] - p[7], bz = p[11] - p[8];
        const rx = p[0] - p[6], ry = p[1] - p[7], rz = p[2] - p[8];
        const aa = ax * ax + ay * ay + az * az, bb = bx * bx + by * by + bz * bz;
        const ab = ax * bx + ay * by + az * bz, ar = ax * rx + ay * ry + az * rz, br = bx * rx + by * ry + bz * rz;
        let s = aa > 1e-18 ? Math.max(0, Math.min(1, (ab * br - ar * bb) / Math.max(1e-18, aa * bb - ab * ab))) : 0;
        let t = bb > 1e-18 ? (ab * s + br) / bb : 0;
        if (t < 0) { t = 0; s = aa > 1e-18 ? Math.max(0, Math.min(1, -ar / aa)) : 0; }
        else if (t > 1) { t = 1; s = aa > 1e-18 ? Math.max(0, Math.min(1, (ab - ar) / aa)) : 0; }
        w[0] = 1 - s; w[1] = s; w[2] = t - 1; w[3] = -t;
      } else {
        const ax = p[6] - p[3], ay = p[7] - p[4], az = p[8] - p[5];
        const bx = p[9] - p[3], by = p[10] - p[4], bz = p[11] - p[5];
        const rx = p[0] - p[3], ry = p[1] - p[4], rz = p[2] - p[5];
        const d1 = ax * rx + ay * ry + az * rz, d2 = bx * rx + by * ry + bz * rz;
        const d3 = d1 - (ax * ax + ay * ay + az * az), d4 = d2 - (ax * bx + ay * by + az * bz);
        const d5 = d1 - (ax * bx + ay * by + az * bz), d6 = d2 - (bx * bx + by * by + bz * bz);
        const va = d3 * d6 - d5 * d4, vb = d5 * d2 - d1 * d6, vc = d1 * d4 - d3 * d2;
        let u, v;
        if (d1 <= 0 && d2 <= 0) { u = 0; v = 0; }
        else if (d3 >= 0 && d4 <= d3) { u = 1; v = 0; }
        else if (vc <= 0 && d1 >= 0 && d3 <= 0) { u = d1 / Math.max(1e-18, d1 - d3); v = 0; }
        else if (d6 >= 0 && d5 <= d6) { u = 0; v = 1; }
        else if (vb <= 0 && d2 >= 0 && d6 <= 0) { u = 0; v = d2 / Math.max(1e-18, d2 - d6); }
        else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { v = (d4 - d3) / Math.max(1e-18, d4 - d3 + d5 - d6); u = 1 - v; }
        else { const denominator = Math.max(1e-18, va + vb + vc); u = vb / denominator; v = vc / denominator; }
        w[0] = 1; w[1] = u + v - 1; w[2] = -u; w[3] = -v;
      }
      let nx = 0, ny = 0, nz = 0;
      for (let j = 0; j < 4; j++) { nx += p[j * 3] * w[j]; ny += p[j * 3 + 1] * w[j]; nz += p[j * 3 + 2] * w[j]; }
      const distance = Math.hypot(nx, ny, nz);
      let length = distance;
      if (distance < 1e-10) {
        nx = ny = nz = 0;
        for (let j = 0; j < 4; j++) {
          const b = this.ids[j] * 3;
          nx += this.start[b] * w[j]; ny += this.start[b + 1] * w[j]; nz += this.start[b + 2] * w[j];
        }
        length = Math.hypot(nx, ny, nz);
        if (length < 1e-10) { nz = 1; length = Math.hypot(nx, ny, nz); }
      }
      w[4] = nx / length; w[5] = ny / length; w[6] = nz / length; w[7] = distance;
    }

    testContact(edge, a, b, c, d) {
      if (this.inverseMass(a) + this.inverseMass(b) + this.inverseMass(c) + this.inverseMass(d) === 0) return;
      this.ids[0] = a; this.ids[1] = b; this.ids[2] = c; this.ids[3] = d;
      const motion = edge ? Math.max(this.speeds[a], this.speeds[b]) + Math.max(this.speeds[c], this.speeds[d]) : this.speeds[a] + Math.max(this.speeds[b], this.speeds[c], this.speeds[d]);
      let time = 0;
      // Closest-feature distance changes no faster than this relative-motion
      // bound. Advance towards the first contact rather than sampling the end.
      for (let iteration = 0; iteration < 24; iteration++) {
        this.closest(edge, time);
        if (this.result[7] <= this.gap * 1.02) break;
        if (motion < 1e-12) return;
        time += (this.result[7] - this.gap) * 0.8 / motion;
        if (time > 1) return;
      }
      if (this.result[7] > this.gap * 1.02 && !this.refineContact(edge, time, motion)) return;
      const offset = this.contactCount++ * 11;
      if (offset + 11 > this.contacts.length) {
        const contacts = new Float64Array(this.contacts.length * 2);
        contacts.set(this.contacts);
        this.contacts = contacts;
      }
      for (let j = 0; j < 4; j++) { this.contacts[offset + j] = this.ids[j]; this.contacts[offset + 4 + j] = this.result[j]; }
      for (let axis = 0; axis < 3; axis++) this.contacts[offset + 8 + axis] = this.result[4 + axis];
    }

    refineContact(edge, time, motion) {
      // A fast remote corner makes the global bound conservative. Exhausting
      // the advancement budget is not proof that the remaining path is clear.
      const intervals = this.intervals;
      let count = 2;
      intervals[0] = time; intervals[1] = 1;
      const tolerance = this.gap * 0.02;
      while (count > 0) {
        const hi = intervals[--count], lo = intervals[--count], mid = (lo + hi) / 2;
        this.closest(edge, mid);
        if (this.result[7] - motion * (hi - lo) / 2 > this.gap + tolerance) continue;
        if (motion * (hi - lo) < tolerance || count + 4 > intervals.length) {
          // Keep the earliest possible incoming-side contact, before the path
          // could cross the surface within this narrow interval.
          this.closest(edge, lo);
          return true;
        }
        intervals[count++] = mid; intervals[count++] = hi;
        intervals[count++] = lo; intervals[count++] = mid;
      }
      return false;
    }

    resolve() {
      let worst = 0;
      for (let offset = 0; offset < this.contactCount * 11; offset += 11) {
        let distance = 0, mass = 0, velocity = 0;
        for (let j = 0; j < 4; j++) {
          const i = this.contacts[offset + j], weight = this.contacts[offset + 4 + j];
          for (let axis = 0; axis < 3; axis++) {
            const b = i * 3 + axis, n = this.contacts[offset + 8 + axis];
            mass += this.mobility(i, axis, weight * n) * weight * weight * n * n;
            distance += this.pos[b] * weight * n;
            velocity += (this.pos[b] - this.prev[b]) * weight * n;
          }
        }
        if (mass < 1e-12 || distance > this.gap * 1.02) continue;
        const penetration = Math.max(0, this.gap - distance);
        worst = Math.max(worst, penetration);
        for (let j = 0; j < 4; j++) {
          const i = this.contacts[offset + j], weight = this.contacts[offset + 4 + j];
          for (let axis = 0; axis < 3; axis++) {
            const b = i * 3 + axis, n = this.contacts[offset + 8 + axis];
            const amount = this.mobility(i, axis, weight * n) * weight * n / mass;
            const next = this.pos[b] + amount * penetration;
            const bounded = this.limits ? Math.max(this.limits[axis * 2], Math.min(this.limits[axis * 2 + 1], next)) : next;
            const correction = bounded - this.pos[b];
            this.pos[b] = bounded;
            // Position projection must not create an outward kick; separately
            // remove only the velocity that drives the layers into each other.
            this.prev[b] += correction + amount * Math.min(0, velocity);
          }
        }
      }
      return worst;
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = ReceiptCollisions;
  else root.ReceiptCollisions = ReceiptCollisions;
})(typeof window === 'undefined' ? globalThis : window);
