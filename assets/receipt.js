window.addEventListener('DOMContentLoaded', () => {
    const wrap = document.getElementById('receipt-wrap');
    const showReceiptFallback = () => {
      wrap.classList.add('receipt-unavailable');
      wrap.innerHTML = '<div class="receipt-fallback">FEATURED PROJECT<br><strong>IndustrialSim</strong><br><small>Modbus · OPC-UA · Web Presentation</small></div>';
    };
    if (!window.THREE) {
      showReceiptFallback();
      return;
    }
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isMobileViewport = window.matchMedia('(max-width: 720px)').matches;
    const enableInteractiveReceipt = !prefersReducedMotion && !isMobileViewport;

    const COLS = 16;
    const ROWS = 20;
    const SPACING = 0.1;
    const ITERS = enableInteractiveReceipt ? 20 : 12;
    const GRAVITY = enableInteractiveReceipt ? 0.0065 : 0.0032;
    const DAMPING = enableInteractiveReceipt ? 0.979 : 0.992;
    const SURFACE_Z = 0.012;
    const MAX_OUTWARD_Z = SPACING * 0.9;
    const MAX_INWARD_Z = -SPACING * 3.2;
    const DRAG_RADIUS = SPACING * 4.2;
    const W = (COLS - 1) * SPACING;
    const H = (ROWS - 1) * SPACING;
    const N = COLS * ROWS;

    // 右上方悬挂：固定顶部整行，但整体位置偏到右上区域
    let anchorX = 0.82;
    let anchorY = 1.36;
    let anchorTargetX = anchorX;
    let anchorTargetY = anchorY;

    const pos = new Float64Array(N * 3);
    const prev = new Float64Array(N * 3);
    const pinned = new Uint8Array(N);
    const constraints = [];

    function pidx(r, c) { return r * COLS + c; }

    function initParticles() {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = pidx(r, c);
          const x = anchorX + (c / (COLS - 1) - 0.5) * W;
          const y = anchorY - (r / (ROWS - 1)) * H;
          const arch = Math.sin(Math.PI * c / (COLS - 1)) * 0.03 * (r / (ROWS - 1));
          pos[i * 3] = x;
          pos[i * 3 + 1] = y;
          pos[i * 3 + 2] = arch;
          prev[i * 3] = x;
          prev[i * 3 + 1] = y;
          prev[i * 3 + 2] = arch * 0.97;
          pinned[i] = (r === 0) ? 1 : 0;
        }
      }
    }

    function buildConstraints() {
      constraints.length = 0;
      function push(a, b, rest, stiffness) { constraints.push(a, b, rest, stiffness); }
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = pidx(r, c);
          if (c < COLS - 1) push(i, pidx(r, c + 1), SPACING, 0.13);
          if (r < ROWS - 1) push(i, pidx(r + 1, c), SPACING, 0.13);
          if (r < ROWS - 1 && c < COLS - 1) push(i, pidx(r + 1, c + 1), SPACING * Math.SQRT2, 0.07);
          if (r < ROWS - 1 && c > 0) push(i, pidx(r + 1, c - 1), SPACING * Math.SQRT2, 0.07);
          if (c < COLS - 2) push(i, pidx(r, c + 2), SPACING * 2, 0.03);
          if (r < ROWS - 2) push(i, pidx(r + 2, c), SPACING * 2, 0.03);
        }
      }
    }

    function pinTopRow() {
      for (let c = 0; c < COLS; c++) {
        const b = pidx(0, c) * 3;
        const x = anchorX + (c / (COLS - 1) - 0.5) * W;
        pos[b] = x;
        pos[b + 1] = anchorY;
        pos[b + 2] = 0;
        prev[b] = x;
        prev[b + 1] = anchorY;
        prev[b + 2] = 0;
      }
    }

    function stepPhysics() {
      anchorX += (anchorTargetX - anchorX) * 0.2;
      anchorY += (anchorTargetY - anchorY) * 0.2;
      setCamera();

      for (let i = 0; i < N; i++) {
        if (pinned[i]) continue;
        const b = i * 3;
        let vx = (pos[b] - prev[b]) * DAMPING;
        let vy = (pos[b + 1] - prev[b + 1]) * DAMPING;
        let vz = (pos[b + 2] - prev[b + 2]) * DAMPING;
        const maxV = SPACING * 0.2;
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed > maxV) {
          const s = maxV / speed;
          vx *= s; vy *= s; vz *= s;
        }
        prev[b] = pos[b];
        prev[b + 1] = pos[b + 1];
        prev[b + 2] = pos[b + 2];
        pos[b] += vx;
        pos[b + 1] += vy - GRAVITY;
        pos[b + 2] += vz;
        pos[b + 2] += (SURFACE_Z - pos[b + 2]) * 0.028;
        if (pos[b + 2] < MAX_INWARD_Z) {
          pos[b + 2] = MAX_INWARD_Z;
          prev[b + 2] = MAX_INWARD_Z;
        }
        if (pos[b + 2] > MAX_OUTWARD_Z) pos[b + 2] = MAX_OUTWARD_Z;
      }

      pinTopRow();
      for (let iter = 0; iter < ITERS; iter++) {
        for (let k = 0; k < constraints.length; k += 4) {
          const ia = constraints[k], ib = constraints[k + 1];
          const rest = constraints[k + 2], stiff = constraints[k + 3];
          const a = ia * 3, b = ib * 3;
          const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (dist - rest) / dist * stiff;
          const pa = pinned[ia], pb = pinned[ib];
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
        pinTopRow();
      }

      applyDragCone();

      for (let i = 0; i < N; i++) {
        if (pinned[i]) continue;
        if (pos[i * 3 + 2] < MAX_INWARD_Z) {
          pos[i * 3 + 2] = MAX_INWARD_Z;
          prev[i * 3 + 2] = MAX_INWARD_Z;
        }
      }
    }

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      showReceiptFallback();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, enableInteractiveReceipt ? 2 : 1.25));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    wrap.replaceChildren(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);

    const wallMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshLambertMaterial({ color: 0xe9e5dc, transparent: true, opacity: 0.98 })
    );
    wallMesh.position.z = -0.45;
    wallMesh.receiveShadow = true;
    scene.add(wallMesh);

    scene.add(new THREE.AmbientLight(0xfaf8f2, 0.52));
    const sun = new THREE.DirectionalLight(0xf3f0e8, 0.82);
    sun.position.set(-2.5, 5, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 20;
    sun.shadow.camera.left = -3;
    sun.shadow.camera.right = 3;
    sun.shadow.camera.top = 4;
    sun.shadow.camera.bottom = -4;
    sun.shadow.radius = 10;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xf2d9ce, 0.3);
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
      const TW = 640, TH = 560;
      const RECEIPT_COLORS = {
        paper: '#f7f2e8',
        paperShadow: '#ded5c7',
        ink: '#2b2722',
        muted: '#746d63',
        accent: '#c96445',
        olive: '#72734f',
        rule: '#cfc7ba'
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
        vL.addColorStop(0, alpha(RECEIPT_COLORS.ink, 0.10));
        vL.addColorStop(0.09, alpha(RECEIPT_COLORS.ink, 0));
        vL.addColorStop(0.91, alpha(RECEIPT_COLORS.ink, 0));
        vL.addColorStop(1, alpha(RECEIPT_COLORS.ink, 0.10));
        ctx.fillStyle = vL;
        ctx.fillRect(0, 0, TW, TH);

        const topBand = ctx.createLinearGradient(0, 0, TW, 0);
        topBand.addColorStop(0, RECEIPT_COLORS.accent);
        topBand.addColorStop(1, RECEIPT_COLORS.olive);
        ctx.fillStyle = topBand;
        ctx.fillRect(0, 0, TW, 38);
        ctx.fillStyle = RECEIPT_COLORS.paper;
        for (let x = 20; x < TW - 18; x += 16) {
          ctx.beginPath();
          ctx.arc(x, 19, 6, 0, Math.PI * 2);
          ctx.fill();
        }

        const C = (t, y, sz, col = RECEIPT_COLORS.ink, w = 'normal') => {
          ctx.font = `${w} ${sz}px "Courier New", monospace`;
          ctx.fillStyle = col;
          ctx.textAlign = 'center';
          ctx.fillText(t, TW / 2, y);
        };
        const L = (t, y, sz, col = RECEIPT_COLORS.ink, w = 'normal') => {
          ctx.font = `${w} ${sz}px "Courier New", monospace`;
          ctx.fillStyle = col;
          ctx.textAlign = 'left';
          ctx.fillText(t, 48, y);
        };
        const R = (t, y, sz, col = RECEIPT_COLORS.ink, w = 'normal') => {
          ctx.font = `${w} ${sz}px "Courier New", monospace`;
          ctx.fillStyle = col;
          ctx.textAlign = 'right';
          ctx.fillText(t, TW - 48, y);
        };
        const HR = y => {
          ctx.strokeStyle = alpha(RECEIPT_COLORS.rule, 0.9);
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(48, y);
          ctx.lineTo(TW - 48, y);
          ctx.stroke();
          ctx.setLineDash([]);
        };
        const THICK = y => {
          ctx.strokeStyle = RECEIPT_COLORS.ink;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(48, y);
          ctx.lineTo(TW - 48, y);
          ctx.stroke();
        };

        function wrapCenter(text, y, size, color, weight = 'normal', maxWidth = TW - 120, lineGap = 10) {
          ctx.font = `${weight} ${size}px "Courier New", monospace`;
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          const words = text.split(' ');
          const lines = [];
          let current = '';
          for (const word of words) {
            const test = current ? `${current} ${word}` : word;
            if (ctx.measureText(test).width > maxWidth && current) {
              lines.push(current);
              current = word;
            } else {
              current = test;
            }
          }
          if (current) lines.push(current);
          lines.forEach((line, index) => ctx.fillText(line, TW / 2, y + index * (size + lineGap)));
          return y + (lines.length - 1) * (size + lineGap);
        }

        let cy = 82;
        C(data.header, cy, 54, RECEIPT_COLORS.ink, 'bold'); cy += 48;
        C(data.subheader, cy, 22, RECEIPT_COLORS.muted, 'bold'); cy += 32;
        THICK(cy); cy += 34;

        C(data.intro, cy, 46, RECEIPT_COLORS.ink, 'bold'); cy += 54;
        cy = wrapCenter(data.line, cy, 24, RECEIPT_COLORS.muted, 'bold', TW - 130, 8) + 36;
        HR(cy); cy += 34;

        L(data.focusLabel, cy, 19, RECEIPT_COLORS.olive, 'bold');
        R(data.focusValue, cy, 20, RECEIPT_COLORS.ink, 'bold'); cy += 36;

        L(data.quoteLabel, cy, 19, RECEIPT_COLORS.olive, 'bold'); cy += 34;
        cy = wrapCenter(`“${data.quote}”`, cy, 26, RECEIPT_COLORS.ink, 'bold', TW - 140, 10) + 20;
        C(data.quoteBy, cy, 20, RECEIPT_COLORS.muted, 'bold'); cy += 34;

        HR(cy); cy += 34;
        C('github.com/openshane', cy, 22, RECEIPT_COLORS.ink, 'bold'); cy += 28;
        C(data.footer, cy, 22, RECEIPT_COLORS.muted, 'bold'); cy += 24;

        const bx = 132, bw = TW - 264, bh = 30;
        let bp = bx;
        ctx.fillStyle = RECEIPT_COLORS.ink;
        while (bp < bx + bw) {
          const bw2 = Math.random() > 0.62 ? 3 : (Math.random() > 0.5 ? 2 : 1);
          if (Math.random() > 0.38) ctx.fillRect(bp, cy, bw2, bh);
          bp += bw2 + (Math.random() > 0.5 ? 1 : 0);
        }
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
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }

    function syncGeo(geo) {
      const arr = geo.attributes.position.array;
      for (let i = 0; i < N; i++) {
        arr[i * 3] = pos[i * 3];
        arr[i * 3 + 1] = pos[i * 3 + 1];
        arr[i * 3 + 2] = pos[i * 3 + 2];
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
    }

    let receiptProfileIndex = 0;
    const receiptTextureControl = buildTexture(receiptProfiles[receiptProfileIndex]);
    const tex = receiptTextureControl.texture;
    tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    tex.needsUpdate = true;
    const geo = makeGeo();
    const front = new THREE.MeshPhongMaterial({
      map: tex,
      side: THREE.FrontSide,
      shininess: 6,
      specular: new THREE.Color(0x444444)
    });
    const back = new THREE.MeshPhongMaterial({
      color: 0xe7dccb,
      side: THREE.BackSide,
      shininess: 2,
      transparent: true,
      opacity: 0.88,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
    const meshF = new THREE.Mesh(geo, front);
    const meshB = new THREE.Mesh(geo, back);
    meshB.renderOrder = -1;
    meshF.castShadow = true;
    meshB.castShadow = true;
    scene.add(meshF);
    scene.add(meshB);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    let dragging = false;
    let dragPt = -1;
    let dragTargetX = 0;
    let dragTargetY = 0;
    let offX = 0, offY = 0;

    function applyDragCone() {
      if (!dragging || dragPt === -1) return;
      const centerX = dragTargetX;
      const centerY = dragTargetY;
      for (let i = 0; i < N; i++) {
        const row = Math.floor(i / COLS);
        if (row === 0) continue;
        const b = i * 3;
        const dx = pos[b] - centerX;
        const dy = pos[b + 1] - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > DRAG_RADIUS) continue;
        const t = 1 - dist / DRAG_RADIUS;
        const smooth = t * t * (3 - 2 * t);
        const coneTarget = MAX_INWARD_Z * (0.18 + 0.82 * smooth * smooth);
        pos[b + 2] += (coneTarget - pos[b + 2]) * (i === dragPt ? 0.58 : 0.3 + smooth * 0.08);
        prev[b + 2] += (pos[b + 2] - prev[b + 2]) * 0.42;

        const pull = i === dragPt ? 0.78 : 0.1 + 0.18 * smooth;
        pos[b] += (centerX - pos[b]) * pull;
        pos[b + 1] += (centerY - pos[b + 1]) * pull;

        const edgeRelax = (1 - smooth) * 0.04;
        pos[b + 2] += (SURFACE_Z - pos[b + 2]) * edgeRelax;
      }
    }

    function setCamera() {
      const targetY = anchorY - H * 0.58;
      const camY = anchorY - H * 0.44;
      camera.position.set(anchorX, camY, 4.2);
      camera.lookAt(anchorX, targetY, 0);
    }

    function resize() {
      const rect = wrap.getBoundingClientRect();
      const width = Math.max(260, rect.width);
      const height = Math.max(380, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      setCamera();
    }

    function toWorld(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
      raycaster.ray.intersectPlane(dragPlane, hit);
      return hit;
    }

    function nearestParticle(wx, wy) {
      let best = -1;
      let bestDist = 0.12;
      for (let i = 0; i < N; i++) {
        const dx = pos[i * 3] - wx;
        const dy = pos[i * 3 + 1] - wy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best;
    }

    function onDown(clientX, clientY) {
      const w = toWorld(clientX, clientY);
      const p = nearestParticle(w.x, w.y);
      if (p === -1) return;
      dragging = true;
      scheduleReceiptFrame(1);
      dragTargetX = w.x;
      dragTargetY = w.y;
      if (Math.floor(p / COLS) < 2) {
        dragPt = -1;
        offX = anchorX - w.x;
        offY = anchorY - w.y;
      } else {
        dragPt = p;
      }
    }

    function onMove(clientX, clientY) {
      if (!dragging) return;
      scheduleReceiptFrame(2);
      const w = toWorld(clientX, clientY);
      if (dragPt === -1) {
        anchorTargetX = Math.max(0.35, Math.min(1.15, w.x + offX));
        anchorTargetY = Math.max(0.9, Math.min(1.7, w.y + offY));
      } else {
        dragTargetX += (w.x - dragTargetX) * 0.45;
        dragTargetY += (w.y - dragTargetY) * 0.45;
      }
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      dragPt = -1;
      scheduleReceiptFrame(36);
    }

    const canvas = renderer.domElement;
    canvas.style.cursor = enableInteractiveReceipt ? 'grab' : 'default';

    if (enableInteractiveReceipt) {
      canvas.addEventListener('mousedown', e => onDown(e.clientX, e.clientY));
      canvas.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
      canvas.addEventListener('mouseup', onUp);
      canvas.addEventListener('mouseleave', onUp);
      canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        const t = e.touches[0];
        onDown(t.clientX, t.clientY);
      }, { passive: false });
      canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        const t = e.touches[0];
        onMove(t.clientX, t.clientY);
      }, { passive: false });
      canvas.addEventListener('touchend', onUp);
    }
    window.addEventListener('resize', () => { resize(); scheduleReceiptFrame(1); });

    initParticles();
    buildConstraints();
    for (let r = 1; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = pidx(r, c);
        const arch = Math.sin(Math.PI * c / (COLS - 1)) * 0.06 * (r / (ROWS - 1));
        pos[i * 3 + 2] = arch;
        prev[i * 3 + 2] = arch * 0.95;
      }
    }

    let receiptProfileTimer = null;
    let receiptInView = true;
    let receiptFrameId = null;
    let settleFramesRemaining = 0;

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

    function scheduleReceiptFrame(frames = enableInteractiveReceipt ? 24 : 18) {
      settleFramesRemaining = Math.max(settleFramesRemaining, frames);
      if (!canRunReceipt() || receiptFrameId !== null) return;
      receiptFrameId = requestAnimationFrame(runReceiptFrame);
    }

    function runReceiptFrame() {
      receiptFrameId = null;
      if (!canRunReceipt()) return;
      if (settleFramesRemaining > 0) {
        stepPhysics();
        settleFramesRemaining -= 1;
      }
      syncGeo(geo);
      renderer.render(scene, camera);
      if (dragging || settleFramesRemaining > 0) scheduleReceiptFrame(1);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && receiptFrameId !== null) {
        cancelAnimationFrame(receiptFrameId);
        receiptFrameId = null;
      }
      updateProfileTimer();
      if (!document.hidden) scheduleReceiptFrame(1);
    });

    if ('IntersectionObserver' in window) {
      const receiptObserver = new IntersectionObserver(([entry]) => {
        receiptInView = entry.isIntersecting;
        if (!receiptInView && receiptFrameId !== null) {
          cancelAnimationFrame(receiptFrameId);
          receiptFrameId = null;
        }
        updateProfileTimer();
        if (receiptInView) scheduleReceiptFrame(1);
      }, { threshold: 0.05 });
      receiptObserver.observe(wrap);
    }


    resize();
    updateProfileTimer();
    scheduleReceiptFrame(18);
});
