const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const countMatches = (source, pattern) => [...source.matchAll(pattern)].length;

const pageContracts = [
  { file: 'index.html', canonical: 'https://openshane.github.io/' },
  { file: 'projects/industrialsim.html', canonical: 'https://openshane.github.io/projects/industrialsim.html' }
];

test('pages use the shared warm paper stylesheet', () => {
  const home = read('index.html');
  const detail = read('projects/industrialsim.html');
  const css = read('assets/styles.css');

  assert.match(home, /<body class="home-page">/);
  assert.match(detail, /<body class="project-page">/);
  assert.match(home, /href="assets\/styles\.css"/);
  assert.match(detail, /href="\.\.\/assets\/styles\.css"/);
  assert.equal(countMatches(home, /<style\b/g), 0);
  assert.equal(countMatches(detail, /<style\b/g), 0);

  for (const token of [
    '--page-bg: #e9e5dc', '--surface: #faf8f2', '--surface-soft: #f3f0e8',
    '--text: #27241f', '--muted: #716a60', '--accent: #c96445',
    '--olive: #72734f', '--border: #cfc7ba'
  ]) assert.ok(css.includes(token), `missing CSS token: ${token}`);
});

test('mobile homepage keeps every hero CTA styled as a button', () => {
  const css = read('assets/styles.css');

  assert.match(css, /body\.home-page \.hero-actions \.cta-button \{\s*width: 100%;\s*min-height: 48px;\s*padding: 0 18px;\s*justify-content: center;\s*border: 1px solid var\(--border\);\s*background: var\(--surface-soft\);\s*\}/);
});

test('each page has one main heading, one canonical URL, and valid local targets', () => {
  for (const { file, canonical } of pageContracts) {
    const html = read(file);

    assert.equal(countMatches(html, /<main\b/g), 1, `${file} should have one main`);
    assert.equal(countMatches(html, /<h1\b/g), 1, `${file} should have one h1`);
    assert.equal(countMatches(html, /<link\b[^>]*rel="canonical"/g), 1, `${file} should have one canonical link`);
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`));

    for (const [, reference] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      if (/^(?:https?:|mailto:|#)/.test(reference)) continue;
      const cleanReference = reference.split(/[?#]/, 1)[0];
      const target = cleanReference === '/'
        ? path.join(root, 'index.html')
        : path.resolve(root, path.dirname(file), cleanReference);
      assert.ok(fs.existsSync(target), `${file} references missing local target: ${reference}`);
    }
  }
});

test('stylesheet has one authoritative warm-paper theme without legacy decoration', () => {
  const css = read('assets/styles.css');

  assert.match(css, /--on-accent: #17130f/);
  assert.match(css, /--accent-text: #8f402b/);
  assert.match(css, /body\.home-page \.cta-button\.primary,[\s\S]*?body\.project-page \.btn\.primary \{\s*color: var\(--on-accent\);\s*background: var\(--accent\);/);
  assert.equal(countMatches(css, /body\.home-page \.protocol-flow\s*\{/g), 1);
  assert.doesNotMatch(css, /Warm paper palette overrides/);

  for (const legacySource of [
    'Fira Code', 'titleShine', 'ringSpin', 'ctaSheen', '--ring-angle',
    '#131c33', '#4ecdc4', '#2b5f9e', '#1a2440', '#ff6b6b', '#ffe66d',
    '#6c8cff', '#ff8f8f', '#ffd166', '#0f1b2d', '#101827', '#fff8df',
    '#fff4d6', '#fff4cf', '#fff6df', '#fff4d8'
  ]) assert.ok(!css.includes(legacySource), `legacy stylesheet source remains: ${legacySource}`);
});

test('small eyebrow labels use the high-contrast accent text token', () => {
  const css = read('assets/styles.css');

  assert.match(css, /body\.home-page \.receipt-caption \.eyebrow\{[^}]*color: var\(--accent-text\);/);
  assert.match(css, /body\.project-page \.eyebrow\{[^}]*color: var\(--accent-text\);/);
});

test('inline diagrams use the shared warm-paper palette and mono stack', () => {
  const home = read('index.html');
  const detail = read('projects/industrialsim.html');

  assert.match(home, /font-family="var\(--font-mono\)"/);
  assert.match(detail, /font-family="var\(--font-mono\)"/);
  assert.match(home, /fill="var\(--surface-soft\)"/);
  assert.match(detail, /fill="var\(--surface\)"/);

  for (const legacySource of [
    'Fira Code', '#4ecdc4', '#ffe66d', '#142641', '#1d2c47', '#bcd0e6',
    '#020617', '#0f172a', '#1e293b', '#22d3ee', '#34d399', '#a78bfa',
    '#fbbf24', '#fb923c', '#f8fafc', '#94a3b8', '#cbd5e1'
  ]) {
    assert.ok(!home.includes(legacySource), `homepage diagram retains legacy source: ${legacySource}`);
    assert.ok(!detail.includes(legacySource), `detail diagram retains legacy source: ${legacySource}`);
  }
});

test('receipt scene uses warm-paper wall and light colors', () => {
  const receipt = read('assets/receipt.js');

  assert.match(receipt, /MeshLambertMaterial\(\{ color: 0xe9e5dc,/);
  assert.match(receipt, /AmbientLight\(0xfaf8f2, 0\.52\)/);
  assert.match(receipt, /DirectionalLight\(0xf3f0e8, 0\.82\)/);
  assert.match(receipt, /DirectionalLight\(0xf2d9ce, 0\.3\)/);
  assert.doesNotMatch(receipt, /0xcad5eb|0xf7f7ff|0xfff1d4|0xc9dcff/);
});

test('homepage uses finite effects without a background canvas', () => {
  const home = read('index.html');
  const effects = read('assets/home-effects.js');

  assert.match(home, /<script defer src="assets\/home-effects\.js"><\/script>/);
  assert.doesNotMatch(home, /id="stars"|class="bg-effects"|class="bg-blob/);
  assert.doesNotMatch(effects, /starLoop|requestAnimationFrame/);
  assert.match(effects, /prefers-reduced-motion: reduce/);
  assert.match(effects, /IntersectionObserver/);
});

test('receipt is external and preserves lifecycle fallbacks', () => {
  const home = read('index.html');
  const receipt = read('assets/receipt.js');

  assert.match(home, /three\.min\.js"><\/script>\s*<script defer src="assets\/receipt\.js"><\/script>/);
  assert.equal(countMatches(home, /<script(?![^>]*\bsrc=)[^>]*>/g), 0);
  assert.match(receipt, /if \(!window\.THREE\)/);
  assert.match(receipt, /prefers-reduced-motion: reduce/);
  assert.match(receipt, /document\.addEventListener\('visibilitychange'/);
  assert.match(receipt, /IntersectionObserver/);
  assert.match(receipt, /function scheduleReceiptFrame\(/);
  assert.match(receipt, /\n}\);\s*$/);
  assert.doesNotMatch(receipt, /function animate\s*\(/);
});

test('external receipt keeps the legacy lifecycle and r128 contracts', () => {
  const receipt = read('assets/receipt.js');

  assert.match(receipt, /new THREE\.WebGLRenderer/);
  assert.match(receipt, /renderer\.domElement\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(receipt, /receiptFrameId = requestAnimationFrame\(runReceiptFrame\)/);
  assert.match(receipt, /receiptObserver\.observe\(wrap\)/);
  assert.match(receipt, /updateProfileTimer\(\)/);
  assert.match(receipt, /if \(prefersReducedMotion \|\| !canRunReceipt\(\)\) return/);
  assert.match(receipt, /scheduleReceiptFrame\(36\)/);
  assert.match(receipt, /scheduleReceiptFrame\(18\)/);
  assert.match(receipt, /texture\.encoding\s*=\s*THREE\.sRGBEncoding/);
  assert.match(receipt, /setInterval\([\s\S]*?scheduleReceiptFrame\(1\)[\s\S]*?,\s*60000\)/);
  assert.doesNotMatch(receipt, /window\.receiptDebug/);
  assert.doesNotMatch(receipt, /RECEIPT_TEXTURE_HEIGHT/);
  assert.doesNotMatch(receipt, /texture\.colorSpace\s*=/);
});

test('pages expose warm paper metadata and valid internal links', () => {
  const home = read('index.html');
  const detail = read('projects/industrialsim.html');

  assert.match(home, /<link rel="icon" type="image\/svg\+xml" href="assets\/favicon\.svg">/);
  assert.match(detail, /<link rel="icon" type="image\/svg\+xml" href="\.\.\/assets\/favicon\.svg">/);
  assert.match(home, /<meta name="theme-color" content="#e9e5dc">/);
  assert.match(detail, /<meta name="theme-color" content="#e9e5dc">/);
  assert.match(home, /<a href="\/"[^>]*>[\s\S]*?当前主页/);
  assert.match(home, /href="projects\/industrialsim\.html"/);
  assert.match(detail, /href="\.\.\/index\.html"/);
});

test('new-tab links isolate their opener', () => {
  for (const file of ['index.html', 'projects/industrialsim.html']) {
    const html = read(file);
    const links = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map(match => match[0]);
    assert.ok(links.length > 0, `${file} should contain external links`);
    links.forEach(link => assert.match(link, /rel="noopener noreferrer"/));
  }
});

test('repository documents and automates its validation contract', () => {
  const workflow = read('.github/workflows/validate.yml');
  const readme = read('README.md');
  const gitignore = read('.gitignore');

  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /run: npm test/);
  assert.match(readme, /python -m http\.server 8000/);
  assert.match(readme, /npm test/);
  assert.match(gitignore, /^\.claude\/$/m);
  assert.match(gitignore, /^\.superpowers\/$/m);
});
