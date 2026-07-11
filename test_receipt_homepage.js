const fs = require('fs');
const path = require('path');

const root = __dirname;
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'projects', 'industrialsim.html'), 'utf8');

const failures = [];
function assert(condition, message) {
  if (!condition) failures.push(message);
}
function includesAll(source, values, label) {
  for (const value of values) assert(source.includes(value), `${label}: missing ${value}`);
}

includesAll(home, [
  '<link rel="canonical" href="https://openshane.github.io/">',
  '<meta name="theme-color" content="#1a1a2e">',
  'property="og:title"',
  'rel="preconnect" href="https://fonts.googleapis.com"',
  'rel="preconnect" href="https://fonts.gstatic.com" crossorigin',
  '<script defer src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>',
  'if (!window.THREE)',
  'new THREE.WebGLRenderer',
  "renderer.domElement.setAttribute('aria-hidden', 'true')",
  'alt="openshane 的头像" width="96" height="96"',
  'IndustrialSim 紧凑协议流',
  'LANGUAGES', 'WEB &amp; INTERACTION', 'ENGINEERING', 'Now Building',
  "header: 'FEATURED PROJECT'", "header: 'CAPABILITIES'", "header: 'NOW BUILDING'"
], 'homepage structure');

includesAll(detail, [
  '<link rel="canonical" href="https://openshane.github.io/projects/industrialsim.html">',
  '<meta name="theme-color" content="#091120">',
  'property="og:title"',
  'rel="preconnect" href="https://fonts.googleapis.com"',
  '<nav class="topbar" aria-label="面包屑导航">',
  '<main>',
  'aria-labelledby="architecture-title architecture-description"',
  '<title id="architecture-title">',
  '<desc id="architecture-description">'
], 'detail structure');

assert(/a:focus-visible\s*\{/.test(home), 'homepage: focus-visible style missing');
assert(/a:focus-visible\s*\{/.test(detail), 'detail: focus-visible style missing');
assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.protocol-flow \.flow-pulse/.test(home), 'homepage: protocol flow reduced-motion fallback missing');

includesAll(home, [
  'function scheduleReceiptFrame(',
  'receiptFrameId = requestAnimationFrame(runReceiptFrame)',
  "document.addEventListener('visibilitychange'",
  "'IntersectionObserver' in window",
  'receiptObserver.observe(wrap)',
  'updateProfileTimer()',
  'if (prefersReducedMotion || !canRunReceipt()) return',
  'scheduleReceiptFrame(36)',
  'scheduleReceiptFrame(18)'
], 'receipt lifecycle');

assert(!/function animate\s*\(/.test(home), 'receipt lifecycle: perpetual animate loop remains');
assert(!/window\.receiptDebug/.test(home), 'receipt lifecycle: debug global remains');
assert(!/RECEIPT_TEXTURE_HEIGHT/.test(home), 'receipt lifecycle: unused texture constant remains');
assert(!/texture\.colorSpace\s*=/.test(home), 'Three r128: unsupported texture colorSpace assignment remains');
assert(/texture\.encoding\s*=\s*THREE\.sRGBEncoding/.test(home), 'Three r128: texture encoding missing');
assert(/setInterval\([\s\S]*?scheduleReceiptFrame\(1\)[\s\S]*?,\s*60000\)/.test(home), 'receipt lifecycle: visible profile rotation does not wake rendering');

if (failures.length) {
  console.error(`receipt homepage assertions failed (${failures.length})`);
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log('receipt homepage structure and lifecycle assertions passed');
