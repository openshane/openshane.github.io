// Grab offsets and iterative grab projection are adapted from Holocloth (MIT).
// https://github.com/dmitrykurash/holocloth — see licenses/holocloth.txt.
window.addEventListener('DOMContentLoaded', () => {
    const wrap = document.getElementById('receipt-wrap');
    if (!wrap) return;
    const showReceiptFallback = () => {
      wrap.classList.add('receipt-unavailable');
      wrap.innerHTML = '<div class="receipt-fallback">FEATURED PROJECT<br><strong>IndustrialSim</strong><br><small>Modbus · OPC-UA · Web Presentation</small></div>';
    };
    if (!window.THREE) {
      showReceiptFallback();
      return;
    }
    if (!window.ReceiptCollisions) {
      showReceiptFallback();
      return;
    }
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointerQuery = window.matchMedia('(any-pointer: fine)');
    let prefersReducedMotion = motionQuery.matches;
    let enableInteractiveReceipt = !prefersReducedMotion && pointerQuery.matches;

    const COLS = 21;
    const ROWS = 31;
    const SPACING = 0.068;
    const ITERS = 8;
    const GRAVITY = 0.00024;
    const AIR_DRAG = 1;
    const AIR_DRAG_SPEED = 0.4;
    const BEND_DRAG = 0.00008;
    const BEND_REST = 0.0025;
    const FIXED_STEP = 1 / 120;
    const BEND_RELEASE_RESPONSE = 1 - Math.exp(-FIXED_STEP / 0.32);
    const MAX_FRAME_DELTA = FIXED_STEP * 8;
    const SETTLE_STEPS = 1200;
    const DRAG_RADIUS = SPACING * 2.4;
    const GRAB_RESPONSE = 1 - Math.exp(-FIXED_STEP / 0.009);
    const MAX_GRAB_SPEED = 10;
    const MAX_RELEASE_SPEED = 3;
    const MIN_Z = -0.025;
    const MAX_Z = 0.65;
    const W = (COLS - 1) * SPACING;
    const H = (ROWS - 1) * SPACING;
    const N = COLS * ROWS;

    const rest = new Float64Array(N * 3);
    const pos = new Float64Array(N * 3);
    const prev = new Float64Array(N * 3);
    const pinned = new Uint8Array(N);
    const dragWeights = new Float64Array(N);
    const grabOffsets = new Float64Array(N * 3);
    const grabBounds = new Float64Array(6);
    const particleLimits = new Float64Array(6);
    const anchors = Array.from({ length: COLS }, (_, i) => i);
    const constraints = [];
    const bends = [];
    let bendStrength = BEND_REST;

    function pidx(r, c) { return r * COLS + c; }

    function initParticles() {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = pidx(r, c);
          const u = c / (COLS - 1);
          const v = r / (ROWS - 1);
          rest[i * 3] = (u - 0.5) * W;
          rest[i * 3 + 1] = H * 0.5 - v * H;
          // A shallow curl gives the paper volume without bending the printed lines.
          rest[i * 3 + 2] = Math.sin(Math.PI * u) * 0.012 * v + 0.04 * v ** 4;
          pinned[i] = r === 0 ? 1 : 0;
        }
      }
      pos.set(rest);
      prev.set(rest);
      bendStrength = BEND_REST;
    }

    function buildConstraints() {
      constraints.length = 0;
      bends.length = 0;
      function push(a, b, stiffness, strainLimit = 0.06) {
        const length = Math.hypot(
          rest[b * 3] - rest[a * 3],
          rest[b * 3 + 1] - rest[a * 3 + 1],
          rest[b * 3 + 2] - rest[a * 3 + 2]
        );
        constraints.push(a, b, length, stiffness, strainLimit);
      }
      function bend(a, b, c) {
        bends.push(a, b, c,
          rest[a * 3] - 2 * rest[b * 3] + rest[c * 3],
          rest[a * 3 + 1] - 2 * rest[b * 3 + 1] + rest[c * 3 + 1],
          rest[a * 3 + 2] - 2 * rest[b * 3 + 2] + rest[c * 3 + 2]);
      }
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = pidx(r, c);
          if (c < COLS - 1) push(i, pidx(r, c + 1), 0.9);
          if (r < ROWS - 1) push(i, pidx(r + 1, c), 0.9);
          // Follow the rendered triangle edges. An extra cross diagonal would
          // resist a free hinge and make each cell behave like a rigid plate.
          if (r < ROWS - 1 && c < COLS - 1) push(i, pidx(r + 1, c + 1), 0.12, 0.14);
          if (c < COLS - 2) bend(i, pidx(r, c + 1), pidx(r, c + 2));
          if (r < ROWS - 2) bend(i, pidx(r + 1, c), pidx(r + 2, c));
        }
      }
    }

    function solveBends() {
      // Signed curvature opens a folded strip. A distance-only bend constraint
      // also accepts an inverted strip, allowing the paper to stay rolled up.
      for (let k = 0; k < bends.length; k += 6) {
        const ia = bends[k], ib = bends[k + 1], ic = bends[k + 2];
        const wa = pinned[ia] || (dragging && ia === dragPt) ? 0 : 1;
        const wb = pinned[ib] || (dragging && ib === dragPt) ? 0 : 1;
        const wc = pinned[ic] || (dragging && ic === dragPt) ? 0 : 1;
        const mass = wa + 4 * wb + wc;
        if (mass === 0) continue;
        for (let axis = 0; axis < 3; axis++) {
          const a = ia * 3 + axis, b = ib * 3 + axis, c = ic * 3 + axis;
          const correction = (pos[a] - 2 * pos[b] + pos[c] - bends[k + 3 + axis]) * bendStrength / mass;
          pos[a] -= correction * wa;
          pos[b] += correction * 2 * wb;
          pos[c] -= correction * wc;
        }
      }
    }

    function pinAnchors() {
      for (const i of anchors) {
        const b = i * 3;
        for (let axis = 0; axis < 3; axis++) {
          pos[b + axis] = rest[b + axis];
          prev[b + axis] = rest[b + axis];
        }
      }
    }

    function solveStretch(limitOnly = false) {
      for (let k = 0; k < constraints.length; k += 5) {
        const ia = constraints[k], ib = constraints[k + 1];
        const length = constraints[k + 2], stiff = constraints[k + 3], strain = constraints[k + 4];
        const a = ia * 3, b = ib * 3;
        const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const target = limitOnly ? Math.max(length * (1 - strain), Math.min(length * (1 + strain), dist)) : length;
        const diff = (dist - target) / dist * (limitOnly ? 1 : stiff);
        if (diff === 0) continue;
        const pa = pinned[ia] || (dragging && ia === dragPt);
        const pb = pinned[ib] || (dragging && ib === dragPt);
        if (!pa && !pb) {
          const h = diff * 0.5;
          pos[a] += dx * h; pos[a + 1] += dy * h; pos[a + 2] += dz * h;
          pos[b] -= dx * h; pos[b + 1] -= dy * h; pos[b + 2] -= dz * h;
        } else if (!pa) {
          pos[a] += dx * diff; pos[a + 1] += dy * diff; pos[a + 2] += dz * diff;
        } else if (!pb) {
          pos[b] -= dx * diff; pos[b + 1] -= dy * diff; pos[b + 2] -= dz * diff;
        }
      }
    }

    function stepPhysics() {
      selfCollisions.beginStep(dragging ? dragPt : -1);
      advanceGrabTarget();
      bendStrength += ((dragging ? BEND_DRAG : BEND_REST) - bendStrength) * (dragging ? 0.12 : BEND_RELEASE_RESPONSE);
      for (let i = 0; i < N; i++) {
        if (pinned[i]) continue;
        const b = i * 3;
        let vx = pos[b] - prev[b];
        let vy = pos[b + 1] - prev[b + 1];
        let vz = pos[b + 2] - prev[b + 2];
        const maxV = MAX_RELEASE_SPEED * FIXED_STEP;
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed > maxV) {
          const s = maxV / speed;
          vx *= s; vy *= s; vz *= s;
        }
        // Fast folds lose energy to air; gentle motion keeps enough momentum
        // to sway smoothly. Apply drag per second, independent of frame rate.
        const airDamping = Math.exp(-(AIR_DRAG + AIR_DRAG_SPEED * Math.min(speed, maxV) / FIXED_STEP) * FIXED_STEP);
        vx *= airDamping; vy *= airDamping; vz *= airDamping;
        prev[b] = pos[b];
        prev[b + 1] = pos[b + 1];
        prev[b + 2] = pos[b + 2];
        // During a grab, gravity and material constraints shape the free paper;
        // a weak recovery after release prevents residual sideways drift.
        const recovery = dragging ? 0 : 0.000008;
        pos[b] += vx + (rest[b] - pos[b]) * recovery;
        pos[b + 1] += vy - GRAVITY + (rest[b + 1] - pos[b + 1]) * recovery;
        pos[b + 2] += vz + (rest[b + 2] - pos[b + 2]) * (dragging ? 0 : 0.00002);
      }

      applyDrag();
      pinAnchors();
      for (let iter = 0; iter < ITERS; iter++) {
        solveBends();
        solveStretch();
        // Reapply the grab during the solve so stretch constraints cannot pull
        // the grabbed point away from the mouse.
        applyDrag(false);
        constrainParticles();
        pinAnchors();
      }
      // Resolve material lengths alongside layer contacts so a fast, large drag
      // preserves the printing while keeping folded surfaces apart.
      selfCollisions.detect();
      const contactIterations = selfCollisions.contactCount > 0 ? 8 : 2;
      for (let iter = 0; iter < contactIterations; iter++) {
        solveStretch(true);
        constrainParticles();
        selfCollisions.resolve();
        pinAnchors();
      }
      if (selfCollisions.contactCount > 0) {
        // Refresh contacts after stretch correction, then give separation the
        // final priority. Projection also cancels inward velocity, avoiding kicks.
        selfCollisions.detect();
        for (let iter = 0; iter < 16; iter++) {
          const penetration = selfCollisions.resolve();
          if (penetration < selfCollisions.gap * 0.01) break;
        }
      }
      if (dragging) {
        const b = dragPt * 3;
        grabX = pos[b]; grabY = pos[b + 1]; grabZ = pos[b + 2];
      }

      let movement = 0;
      for (let b = 0; b < pos.length; b++) {
        movement = Math.max(movement, Math.abs(pos[b] - prev[b]));
      }
      return movement;
    }

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      showReceiptFallback();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    wrap.replaceChildren(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);

    const wallMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.ShadowMaterial({ color: 0x141413, opacity: 0.12 })
    );
    wallMesh.position.z = -0.055;
    wallMesh.receiveShadow = true;
    scene.add(wallMesh);

    scene.add(new THREE.AmbientLight(0xfaf9f5, 0.78));
    const sun = new THREE.DirectionalLight(0xfaf9f5, 0.55);
    sun.position.set(-3, 4, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 20;
    sun.shadow.camera.left = -1.4;
    sun.shadow.camera.right = 1.4;
    sun.shadow.camera.top = 1.6;
    sun.shadow.camera.bottom = -1.6;
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0002;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xf4e2d9, 0.12);
    fill.position.set(3, -1, 2);
    scene.add(fill);

    const receiptProfiles = [
      {
        header: 'FEATURED PROJECT', subheader: 'INDUSTRIALSIM', intro: '工业硬件仿真平台',
        focusLabel: 'PROTOCOLS', focusValue: 'Modbus / OPC-UA',
        line: '让设备逻辑可运行、可讲解、可在线展示',
        quoteLabel: 'STATUS', quote: '协议适配、设备模型与 Web 演示持续推进', quoteBy: '— openshane',
        footer: 'BUILD · EXPLAIN · DEMONSTRATE'
      },
      {
        header: 'CAPABILITIES', subheader: 'ENGINEERING / EXPERIENCE', intro: '从工程实现到交互表达',
        focusLabel: 'STACK', focusValue: 'Python / TypeScript',
        line: '工业协议、Web 体验与可运行原型',
        quoteLabel: 'FOCUS', quote: '把复杂技术做成清晰、可验证的体验', quoteBy: '— openshane',
        footer: 'PROTOCOL · WEB · INTERACTION'
      },
      {
        header: 'NOW BUILDING', subheader: 'INDUSTRIALSIM / NEXT', intro: '正在构建完整演示闭环',
        focusLabel: 'NEXT', focusValue: 'Device Models',
        line: '连接协议输入、设备行为与 Web 展示',
        quoteLabel: 'GOAL', quote: '减少真实硬件依赖，让验证与沟通前移', quoteBy: '— openshane',
        footer: 'ITERATE · VERIFY · SHARE'
      }
    ];

    function buildTexture(profile) {
      // Match the 2:3 mesh ratio so the printing keeps its original proportions.
      const TW = 768, TH = 1152;
      const RECEIPT_COLORS = {
        paper: '#faf9f5',
        paperShadow: '#e8e6dc',
        ink: '#141413',
        muted: '#62615b',
        accent: '#d97757',
        olive: '#788c5d',
        oliveText: '#536242',
        rule: '#b0aea5'
      };
      const cv = document.createElement('canvas');
      cv.width = TW; cv.height = TH;
      const ctx = cv.getContext('2d');
      const alpha = (color, opacity) => {
        const value = Number.parseInt(color.slice(1), 16);
        return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
      };

      function drawReceipt(data) {
        ctx.clearRect(0, 0, TW, TH);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(TW, 0);
        ctx.lineTo(TW, TH - 8);
        for (let x = TW - 12; x >= 0; x -= 12) {
          ctx.lineTo(x, TH - (x % 24 === 0 ? 8 : 2));
        }
        ctx.closePath();
        ctx.clip();

        const paperGrad = ctx.createLinearGradient(0, 0, 0, TH);
        paperGrad.addColorStop(0, RECEIPT_COLORS.paper);
        paperGrad.addColorStop(0.5, RECEIPT_COLORS.paper);
        paperGrad.addColorStop(1, RECEIPT_COLORS.paperShadow);
        ctx.fillStyle = paperGrad;
        ctx.fillRect(0, 0, TW, TH);

        for (let y = 0; y < TH; y += 2) {
          ctx.fillStyle = alpha(RECEIPT_COLORS.ink, 0.0052 + Math.random() * 0.0022);
          ctx.fillRect(0, y, TW, 1);
        }
        for (let i = 0; i < 360; i++) {
          ctx.fillStyle = alpha(RECEIPT_COLORS.muted, Math.random() * 0.016 + 0.005);
          ctx.fillRect(Math.random() * TW, Math.random() * TH, Math.random() * 3 + 1, 1);
        }

        const vL = ctx.createLinearGradient(0, 0, TW, 0);
        vL.addColorStop(0, alpha(RECEIPT_COLORS.ink, 0.025));
        vL.addColorStop(0.09, alpha(RECEIPT_COLORS.ink, 0));
        vL.addColorStop(0.91, alpha(RECEIPT_COLORS.ink, 0));
        vL.addColorStop(1, alpha(RECEIPT_COLORS.ink, 0.025));
        ctx.fillStyle = vL;
        ctx.fillRect(0, 0, TW, TH);

        const topBand = ctx.createLinearGradient(0, 0, TW, 0);
        topBand.addColorStop(0, RECEIPT_COLORS.accent);
        topBand.addColorStop(1, RECEIPT_COLORS.olive);
        ctx.fillStyle = topBand;
        ctx.fillRect(0, 0, TW, 44);
        ctx.globalCompositeOperation = 'destination-out';
        for (let x = 24; x < TW - 18; x += 20) {
          ctx.beginPath();
          ctx.arc(x, 22, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';

        const C = (t, y, sz, col = RECEIPT_COLORS.ink, w = 'normal') => {
          ctx.font = `${w} ${sz}px "Courier New", monospace`;
          ctx.fillStyle = col;
          ctx.textAlign = 'center';
          ctx.fillText(t, TW / 2, y, TW - 112);
        };
        const L = (t, y, sz, col = RECEIPT_COLORS.ink, w = 'normal') => {
          ctx.font = `${w} ${sz}px "Courier New", monospace`;
          ctx.fillStyle = col;
          ctx.textAlign = 'left';
          ctx.fillText(t, 56, y);
        };
        const R = (t, y, sz, col = RECEIPT_COLORS.ink, w = 'normal') => {
          ctx.font = `${w} ${sz}px "Courier New", monospace`;
          ctx.fillStyle = col;
          ctx.textAlign = 'right';
          ctx.fillText(t, TW - 56, y, TW - 260);
        };
        const HR = y => {
          ctx.strokeStyle = alpha(RECEIPT_COLORS.rule, 0.9);
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(56, y);
          ctx.lineTo(TW - 56, y);
          ctx.stroke();
          ctx.setLineDash([]);
        };
        const THICK = y => {
          ctx.strokeStyle = RECEIPT_COLORS.ink;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(56, y);
          ctx.lineTo(TW - 56, y);
          ctx.stroke();
        };

        function wrapCenter(text, y, size, color, weight = 'normal', maxWidth = TW - 120, lineGap = 10) {
          ctx.font = `${weight} ${size}px "Courier New", monospace`;
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          const lines = [];
          let current = '';
          // Chinese copy has no spaces; wrap by code point instead of by word.
          for (const character of Array.from(text)) {
            const next = current + character;
            if (ctx.measureText(next).width > maxWidth && current) {
              lines.push(current.trim());
              current = character.trimStart();
            } else {
              current = next;
            }
          }
          if (current) lines.push(current);
          lines.forEach((line, index) => ctx.fillText(line, TW / 2, y + index * (size + lineGap)));
          return y + (lines.length - 1) * (size + lineGap);
        }

        C(data.header, 112, 52, RECEIPT_COLORS.ink, 'bold');
        C(data.subheader, 164, 24, RECEIPT_COLORS.muted, 'bold');
        THICK(202);

        C(data.intro, 272, 42, RECEIPT_COLORS.ink, 'bold');
        wrapCenter(data.line, 326, 28, RECEIPT_COLORS.muted, 'normal', TW - 136, 12);
        HR(410);

        L(data.focusLabel, 464, 24, RECEIPT_COLORS.oliveText, 'bold');
        R(data.focusValue, 464, 28, RECEIPT_COLORS.ink, 'bold');

        L(data.quoteLabel, 526, 24, RECEIPT_COLORS.oliveText, 'bold');
        const quoteEnd = wrapCenter(`“${data.quote}”`, 590, 30, RECEIPT_COLORS.ink, 'normal', TW - 144, 14);
        C(data.quoteBy, quoteEnd + 48, 24, RECEIPT_COLORS.muted);

        HR(752);
        C('github.com/openshane', 812, 28, RECEIPT_COLORS.ink, 'bold');
        C(data.footer, 856, 24, RECEIPT_COLORS.muted, 'bold');

        const bx = 160, bw = TW - 320, bh = 76;
        let bp = bx;
        ctx.fillStyle = RECEIPT_COLORS.ink;
        while (bp < bx + bw) {
          const bw2 = Math.random() > 0.62 ? 3 : (Math.random() > 0.5 ? 2 : 1);
          if (Math.random() > 0.38) ctx.fillRect(bp, 914, bw2, bh);
          bp += bw2 + (Math.random() > 0.5 ? 1 : 0);
        }
        C('THANK YOU FOR STOPPING BY', TH - 62, 22, RECEIPT_COLORS.muted);
        ctx.restore();
      }

      drawReceipt(profile);
      const texture = new THREE.CanvasTexture(cv);
      texture.encoding = THREE.sRGBEncoding;
      return { texture, redraw: drawReceipt };
    }

    function makeGeo() {
      const geo = new THREE.BufferGeometry();
      const vPos = new Float32Array(N * 3);
      const uv = new Float32Array(N * 2);
      const idx = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = pidx(r, c);
          uv[i * 2] = c / (COLS - 1);
          uv[i * 2 + 1] = 1 - r / (ROWS - 1);
        }
      }
      for (let r = 0; r < ROWS - 1; r++) {
        for (let c = 0; c < COLS - 1; c++) {
          const a = pidx(r, c), b = pidx(r, c + 1), cc = pidx(r + 1, c + 1), d = pidx(r + 1, c);
          idx.push(a, cc, b, a, d, cc);
        }
      }
      geo.setAttribute('position', new THREE.BufferAttribute(vPos, 3));
      geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }

    function syncGeo(geo, blend = 1) {
      const arr = geo.attributes.position.array;
      for (let i = 0; i < N; i++) {
        for (let axis = 0; axis < 3; axis++) {
          const b = i * 3 + axis;
          const interpolation = dragging ? 1 : blend;
          arr[b] = prev[b] + (pos[b] - prev[b]) * interpolation;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    }

    let receiptProfileIndex = 0;
    const receiptTextureControl = buildTexture(receiptProfiles[receiptProfileIndex]);
    const tex = receiptTextureControl.texture;
    tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    tex.needsUpdate = true;
    const geo = makeGeo();
    const selfCollisions = new window.ReceiptCollisions({
      positions: pos, previous: prev, pinned, triangles: geo.index.array,
      spacing: SPACING, limits: particleLimits
    });
    const front = new THREE.MeshLambertMaterial({
      map: tex,
      side: THREE.DoubleSide,
      alphaTest: 0.5
    });
    const meshF = new THREE.Mesh(geo, front);
    meshF.castShadow = true;
    meshF.customDepthMaterial = new THREE.MeshDepthMaterial({
      map: tex,
      alphaTest: 0.5,
      depthPacking: THREE.RGBADepthPacking,
      side: THREE.DoubleSide
    });
    scene.add(meshF);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    let dragging = false;
    let activePointerId = null;
    let dragPt = -1;
    let pointerTargetX = 0;
    let pointerTargetY = 0;
    let pointerTargetZ = 0;
    let grabX = 0, grabY = 0, grabZ = 0;
    let dragStartX = 0, dragStartY = 0, dragStartZ = 0;
    let releaseVX = 0, releaseVY = 0, releaseVZ = 0;
    let lastDragInputTime = 0;
    let offX = 0, offY = 0;

    function advanceGrabTarget() {
      if (!dragging) return;
      let dx = (pointerTargetX - grabX) * GRAB_RESPONSE;
      let dy = (pointerTargetY - grabY) * GRAB_RESPONSE;
      let dz = (pointerTargetZ - grabZ) * GRAB_RESPONSE;
      const distance = Math.hypot(dx, dy, dz);
      const maxStep = MAX_GRAB_SPEED * FIXED_STEP;
      if (distance > maxStep) {
        const scale = maxStep / distance;
        dx *= scale; dy *= scale; dz *= scale;
      }
      grabX += dx;
      grabY += dy;
      grabZ += dz;
      // The throw inherits the motion actually shown, rather than pointer-event
      // spikes or a target that the paper has not reached yet.
      releaseVX = releaseVX * 0.35 + dx / FIXED_STEP * 0.65;
      releaseVY = releaseVY * 0.35 + dy / FIXED_STEP * 0.65;
      releaseVZ = releaseVZ * 0.35 + dz / FIXED_STEP * 0.65;
    }

    function applyDrag(includePatch = true) {
      if (!dragging || dragPt === -1) return;
      for (let i = 0; i < N; i++) {
        // Only the center is fixed during the solve. Nudge its surroundings once
        // per substep so they can rotate and bend instead of forming a rigid patch.
        const weight = i === dragPt ? 1 : includePatch ? dragWeights[i] * 0.004 : 0;
        if (weight === 0) continue;
        const b = i * 3;
        // Preserve the patch's captured offsets, including existing folds.
        pos[b] += (grabX + grabOffsets[b] - pos[b]) * weight;
        pos[b + 1] += (grabY + grabOffsets[b + 1] - pos[b + 1]) * weight;
        pos[b + 2] += (grabZ + grabOffsets[b + 2] - pos[b + 2]) * weight;
      }
    }

    function constrainParticles() {
      for (let i = 0; i < N; i++) {
        if (pinned[i]) continue;
        for (let axis = 0; axis < 3; axis++) {
          const b = i * 3 + axis;
          const boundary = Math.max(particleLimits[axis * 2], Math.min(particleLimits[axis * 2 + 1], pos[b]));
          if (boundary !== pos[b]) {
            const velocity = pos[b] - prev[b];
            pos[b] = boundary;
            prev[b] = boundary + velocity * 0.1;
          }
        }
      }
    }

    function resize() {
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      const aspect = width / height;
      const viewHeight = Math.max(H + 0.42, (W + 0.48) / aspect);
      const viewWidth = viewHeight * aspect;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.left = -viewWidth / 2;
      camera.right = viewWidth / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      particleLimits.set([camera.left + 0.04, camera.right - 0.04, camera.bottom + 0.04, camera.top - 0.04, MIN_Z, MAX_Z]);
      camera.updateProjectionMatrix();
    }

    function pointRay(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
    }

    function nearestParticle(wx, wy, wz) {
      let best = -1;
      let bestDist = SPACING * 1.5;
      for (let i = 0; i < N; i++) {
        if (pinned[i]) continue;
        const dx = pos[i * 3] - wx;
        const dy = pos[i * 3 + 1] - wy;
        const dz = pos[i * 3 + 2] - wz;
        const d = Math.hypot(dx, dy, dz);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best;
    }

    function onDown(clientX, clientY) {
      pointRay(clientX, clientY);
      const intersection = raycaster.intersectObject(meshF)[0];
      if (!intersection) return false;
      if (intersection.uv.y > 0.985) return false;
      const w = intersection.point;
      const p = nearestParticle(w.x, w.y, w.z);
      if (p === -1) return false;
      dragging = true;
      dragPt = p;
      dragPlane.constant = -w.z;
      offX = pos[p * 3] - w.x;
      offY = pos[p * 3 + 1] - w.y;
      grabX = pointerTargetX = dragStartX = pos[p * 3];
      grabY = pointerTargetY = dragStartY = pos[p * 3 + 1];
      grabZ = pointerTargetZ = dragStartZ = pos[p * 3 + 2];
      releaseVX = releaseVY = releaseVZ = 0;
      lastDragInputTime = performance.now();
      grabBounds.fill(0);
      for (let i = 0; i < N; i++) {
        const b = i * 3;
        grabOffsets[b] = pos[b] - pointerTargetX;
        grabOffsets[b + 1] = pos[b + 1] - pointerTargetY;
        grabOffsets[b + 2] = pos[b + 2] - pointerTargetZ;
        const distance = Math.hypot(grabOffsets[b], grabOffsets[b + 1], grabOffsets[b + 2]);
        const t = Math.max(0, 1 - distance / DRAG_RADIUS);
        dragWeights[i] = pinned[i] ? 0 : t * t * (3 - 2 * t);
        if (dragWeights[i] > 0) {
          for (let axis = 0; axis < 3; axis++) {
            grabBounds[axis * 2] = Math.min(grabBounds[axis * 2], grabOffsets[b + axis]);
            grabBounds[axis * 2 + 1] = Math.max(grabBounds[axis * 2 + 1], grabOffsets[b + axis]);
          }
        }
      }
      wrap.classList.add('is-dragging');
      scheduleReceiptFrame(SETTLE_STEPS);
      return true;
    }

    function onMove(clientX, clientY, time = performance.now()) {
      if (!dragging) return;
      pointRay(clientX, clientY);
      const w = raycaster.ray.intersectPlane(dragPlane, hit);
      if (!w) return;
      const b = dragPt * 3;
      // Keep the whole captured patch in view, rather than crushing its outer
      // vertices against the frame while its center is still following the mouse.
      let x = Math.max(particleLimits[0] - grabBounds[0], Math.min(particleLimits[1] - grabBounds[1], w.x + offX));
      let y = Math.max(particleLimits[2] - grabBounds[2], Math.min(particleLimits[3] - grabBounds[3], w.y + offY));
      let z = Math.min(MAX_Z - grabBounds[5] - 0.01, dragStartZ + Math.min(0.28, Math.hypot(x - dragStartX, y - dragStartY) * 0.22));
      // A hanging sheet can fold toward its supports, but cannot stretch beyond
      // the material distance to either support just to reach an impossible cursor.
      for (let iter = 0; iter < 3; iter++) {
        for (const anchor of [0, dragPt % COLS, COLS - 1]) {
          const a = anchor * 3;
          const reach = Math.hypot(rest[b] - rest[a], rest[b + 1] - rest[a + 1], rest[b + 2] - rest[a + 2]) * 1.02;
          const dx = x - rest[a], dy = y - rest[a + 1], dz = z - rest[a + 2];
          const distance = Math.hypot(dx, dy, dz);
          if (distance > reach) {
            const scale = reach / distance;
            x = rest[a] + dx * scale;
            y = rest[a + 1] + dy * scale;
            z = rest[a + 2] + dz * scale;
          }
        }
      }
      pointerTargetX = x;
      pointerTargetY = y;
      pointerTargetZ = z;
      lastDragInputTime = time;
    }

    function onUp() {
      if (!dragging) return;
      // Keep the recent mouse velocity on release, even if two physics substeps
      // ran between pointer events. Holding still before release adds no impulse.
      const freshness = Math.max(0, 1 - (performance.now() - lastDragInputTime) / 100);
      const speed = Math.hypot(releaseVX, releaseVY, releaseVZ);
      const scale = Math.min(1, MAX_RELEASE_SPEED / (speed || 1)) * FIXED_STEP * freshness;
      for (let i = 0; i < N; i++) {
        const weight = dragWeights[i];
        if (weight === 0) continue;
        const b = i * 3;
        prev[b] = pos[b] - ((pos[b] - prev[b]) * (1 - weight) + releaseVX * scale * weight);
        prev[b + 1] = pos[b + 1] - ((pos[b + 1] - prev[b + 1]) * (1 - weight) + releaseVY * scale * weight);
        prev[b + 2] = pos[b + 2] - ((pos[b + 2] - prev[b + 2]) * (1 - weight) + releaseVZ * scale * weight);
      }
      dragging = false;
      dragPt = -1;
      wrap.classList.remove('is-dragging');
      const pointerId = activePointerId;
      activePointerId = null;
      if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
      scheduleReceiptFrame(SETTLE_STEPS);
    }

    const canvas = renderer.domElement;
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', event => {
      if (!enableInteractiveReceipt || dragging || event.button !== 0 || event.pointerType !== 'mouse') return;
      if (!onDown(event.clientX, event.clientY)) return;
      activePointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', event => {
      if (event.pointerId === activePointerId) onMove(event.clientX, event.clientY, event.timeStamp);
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(eventName, event => {
        if (event.pointerId === activePointerId) onUp();
      });
    }
    window.addEventListener('blur', onUp);
    window.addEventListener('resize', () => { resize(); scheduleReceiptFrame(1); });
    if ('ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(() => { resize(); scheduleReceiptFrame(); });
      resizeObserver.observe(wrap);
    }

    initParticles();
    buildConstraints();

    let receiptProfileTimer = null;
    let receiptInView = true;
    let receiptFrameId = null;
    let settleStepsRemaining = 0;
    let lastReceiptTime = null;
    let physicsAccumulator = 0;
    let quietSteps = 0;

    function canRunReceipt() {
      return !document.hidden && receiptInView;
    }

    function updateProfileTimer() {
      if (receiptProfileTimer) {
        clearInterval(receiptProfileTimer);
        receiptProfileTimer = null;
      }
      if (prefersReducedMotion || !canRunReceipt()) return;
      receiptProfileTimer = setInterval(() => {
        receiptProfileIndex = (receiptProfileIndex + 1) % receiptProfiles.length;
        receiptTextureControl.redraw(receiptProfiles[receiptProfileIndex]);
        tex.needsUpdate = true;
        scheduleReceiptFrame(1);
      }, 60000);
    }

    function scheduleReceiptFrame(steps = 0) {
      settleStepsRemaining = Math.max(settleStepsRemaining, steps);
      if (steps > 0) quietSteps = 0;
      if (!canRunReceipt() || receiptFrameId !== null) return;
      receiptFrameId = requestAnimationFrame(runReceiptFrame);
    }

    function isHanging() {
      for (let c = 0; c < COLS; c++) {
        const bottom = pidx(ROWS - 1, c) * 3;
        if (pos[c * 3 + 1] - pos[bottom + 1] < H * 0.97) return false;
        for (let r = 1; r < ROWS; r++) {
          const b = pidx(r, c) * 3;
          if (pos[b + 1] >= pos[b - COLS * 3 + 1]) return false;
        }
      }
      return true;
    }

    function runReceiptFrame(time) {
      receiptFrameId = null;
      if (!canRunReceipt()) return;
      const elapsed = lastReceiptTime === null ? FIXED_STEP : Math.min((time - lastReceiptTime) / 1000, MAX_FRAME_DELTA);
      lastReceiptTime = time;
      if (enableInteractiveReceipt && (dragging || settleStepsRemaining > 0)) {
        physicsAccumulator += elapsed;
        while (physicsAccumulator + 1e-8 >= FIXED_STEP) {
          const movement = stepPhysics();
          physicsAccumulator = Math.max(0, physicsAccumulator - FIXED_STEP);
          if (!dragging) {
            settleStepsRemaining = Math.max(0, settleStepsRemaining - 1);
            quietSteps = movement < 0.000025 ? quietSteps + 1 : 0;
            if ((quietSteps >= 24 || settleStepsRemaining === 0) && isHanging()) {
              settleStepsRemaining = 0;
              prev.set(pos);
              break;
            }
            // A deadline must not freeze a folded sheet. Let gravity finish
            // opening it before suspending the animation.
            if (settleStepsRemaining === 0) settleStepsRemaining = 120;
          }
        }
      } else {
        settleStepsRemaining = 0;
      }
      const running = dragging || settleStepsRemaining > 0;
      syncGeo(geo, running ? Math.min(1, physicsAccumulator / FIXED_STEP) : 1);
      renderer.render(scene, camera);
      if (running) {
        receiptFrameId = requestAnimationFrame(runReceiptFrame);
      } else {
        lastReceiptTime = null;
        physicsAccumulator = 0;
      }
    }

    function pauseReceipt() {
      onUp();
      if (receiptFrameId !== null) cancelAnimationFrame(receiptFrameId);
      receiptFrameId = null;
      lastReceiptTime = null;
      physicsAccumulator = 0;
    }

    function updateInteraction() {
      prefersReducedMotion = motionQuery.matches;
      enableInteractiveReceipt = !prefersReducedMotion && pointerQuery.matches;
      onUp();
      initParticles();
      settleStepsRemaining = 0;
      lastReceiptTime = null;
      physicsAccumulator = 0;
      canvas.style.cursor = enableInteractiveReceipt ? '' : 'default';
      updateProfileTimer();
      scheduleReceiptFrame();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) pauseReceipt();
      updateProfileTimer();
      if (!document.hidden) scheduleReceiptFrame(1);
    });

    if ('IntersectionObserver' in window) {
      const receiptObserver = new IntersectionObserver(([entry]) => {
        receiptInView = entry.isIntersecting;
        if (!receiptInView) pauseReceipt();
        updateProfileTimer();
        if (receiptInView) scheduleReceiptFrame(1);
      }, { threshold: 0.05 });
      receiptObserver.observe(wrap);
    }

    for (const query of [motionQuery, pointerQuery]) {
      if (query.addEventListener) query.addEventListener('change', updateInteraction);
      else query.addListener(updateInteraction);
    }

    resize();
    updateInteraction();
});
