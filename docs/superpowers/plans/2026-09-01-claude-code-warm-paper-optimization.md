# Claude Code Warm Paper Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将双页面 GitHub Pages 站点改造成统一的 Claude Code 暖纸张视觉风格，同时拆分内联资源、移除永久背景动画并建立零依赖测试和 CI。

**Architecture:** 继续使用原生 HTML、CSS 和 JavaScript，两个页面共享 `assets/styles.css`，首页通过 `assets/receipt.js` 和 `assets/home-effects.js` 加载交互。测试使用 Node 内置 `node:test` 检查静态结构和降级契约，部署仍然不需要构建步骤。

**Tech Stack:** HTML5、CSS 自定义属性、原生 JavaScript、Three.js r128 CDN、Node.js 24 内置测试、GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-01-claude-code-warm-paper-optimization-design.md`

## Global Constraints

- 不引入 React、Vue、Astro、Vite、CSS 框架或第三方测试框架。
- 不大幅重写项目文案或添加未经证实的项目能力、截图和演示。
- GitHub Pages 必须继续直接发布仓库中的静态文件，不增加构建产物目录。
- 首页和详情页共享一套暖纸张色彩变量，页面专属规则分别限定在 `body.home-page` 和 `body.project-page` 下。
- Three.js 加载失败、减少动态效果、页面隐藏和组件离开视口时必须保持现有降级或暂停行为。
- 使用 Git Bash 执行跨平台命令；所有源码编辑使用 `apply_patch`。
- 计划中的提交步骤仅是审查检查点，未得到用户明确提交授权前不得执行。

---

## File Map

| File | Responsibility |
| --- | --- |
| `index.html` | 首页语义结构和静态资源引用，不再承载 CSS 或交互实现 |
| `projects/industrialsim.html` | IndustrialSim 详情页语义结构和静态资源引用 |
| `assets/styles.css` | 品牌变量、共享组件、首页/详情页样式和响应式规则 |
| `assets/receipt.js` | Three.js 小票渲染、物理、拖拽、纹理和生命周期 |
| `assets/home-effects.js` | 一次性入场、指针聚光和卡片轻微倾斜 |
| `assets/favicon.svg` | 暖纸张主题站点图标 |
| `tests/site.test.js` | 静态页面、资源引用、降级契约和仓库配置测试 |
| `package.json` | 唯一项目命令 `npm test` |
| `.github/workflows/validate.yml` | 推送和拉取请求的 Node 24 测试工作流 |
| `.gitignore` | 忽略本地工具会话和系统临时文件 |
| `README.md` | 项目结构、本地预览、测试和发布说明 |

---

### Task 1: Establish the Warm Paper Stylesheet and Test Harness

**Files:**
- Create: `package.json`
- Create: `tests/site.test.js`
- Create: `assets/styles.css`
- Modify: `index.html:16-934`
- Modify: `projects/industrialsim.html:16-402`

**Interfaces:**
- Produces: `read(relativePath: string): string` test helper
- Produces: `countMatches(source: string, pattern: RegExp): number` test helper
- Produces: global CSS tokens `--page-bg`, `--surface`, `--surface-soft`, `--text`, `--muted`, `--accent`, `--olive`, `--border`
- Consumes: existing HTML class names; this task does not rename content components

- [ ] **Step 1: Create the test runner and write the failing stylesheet test**

Create `package.json`:

```json
{
  "name": "openshane-github-io",
  "private": true,
  "scripts": {
    "test": "node --test tests/*.test.js"
  }
}
```

Create `tests/site.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const countMatches = (source, pattern) => [...source.matchAll(pattern)].length;

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
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run: `npm test`

Expected: FAIL with `ENOENT` for `assets/styles.css` or a failed body/stylesheet assertion.

- [ ] **Step 3: Extract and normalize the styles**

Create `assets/styles.css` with this token and base layer first:

```css
:root {
  --page-bg: #e9e5dc;
  --surface: #faf8f2;
  --surface-soft: #f3f0e8;
  --text: #27241f;
  --muted: #716a60;
  --accent: #c96445;
  --accent-soft: #f2d9ce;
  --olive: #72734f;
  --border: #cfc7ba;
  --shadow: 0 18px 48px rgba(67, 55, 43, 0.12);
  --font-serif: Georgia, 'Times New Roman', 'Noto Serif SC', serif;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  --font-mono: 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  min-height: 100vh;
  color: var(--text);
  background:
    radial-gradient(circle at 88% 4%, rgba(201, 100, 69, 0.12), transparent 26%),
    linear-gradient(rgba(113, 106, 96, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(113, 106, 96, 0.055) 1px, transparent 1px),
    var(--page-bg);
  background-size: auto, 28px 28px, 28px 28px, auto;
  font-family: var(--font-sans);
}

h1, h2 { font-family: var(--font-serif); font-weight: 400; }
code, .eyebrow, .title-kicker, .card-tag { font-family: var(--font-mono); }
a:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }
```

Then perform a mechanical move with `apply_patch`:

1. Move the remaining homepage rules from the current `index.html` `<style>` block into `assets/styles.css` and scope root layout rules under `.home-page` where names can collide.
2. Move the detail rules from the current `projects/industrialsim.html` `<style>` block into the same file and scope page-specific selectors under `.project-page`.
3. Replace dark/white/glass colors with the tokens above; use `var(--surface)` for primary panels, `var(--surface-soft)` for secondary panels, `var(--text)` for headings, `var(--muted)` for supporting copy, `var(--accent)` for primary actions, and `var(--border)` for structural borders.
4. Change large panel blur effects to `box-shadow: var(--shadow)` and opaque paper surfaces.
5. Remove Google Fonts preconnect and stylesheet tags from both HTML heads.
6. Add `<link rel="stylesheet" href="assets/styles.css">` to the homepage and `<link rel="stylesheet" href="../assets/styles.css">` to the detail page.
7. Change `<body>` to `<body class="home-page">` and `<body class="project-page">` respectively.
8. Delete both inline `<style>` blocks only after all selectors are present in `assets/styles.css`.

Add this mobile CTA rule so all three homepage actions retain the same affordance:

```css
@media (max-width: 720px) {
  .home-page .hero-actions { flex-direction: column; }
  .home-page .hero-actions .cta-button {
    width: 100%;
    min-height: 48px;
    padding: 0 18px;
    justify-content: center;
    border: 1px solid var(--border);
  }
}
```

- [ ] **Step 4: Run the test and inspect both pages for missing selectors**

Run: `npm test`

Expected: PASS for `pages use the shared warm paper stylesheet`.

Run: `rg -n "<style|fonts.googleapis|fonts.gstatic" index.html projects/industrialsim.html`

Expected: no matches.

- [ ] **Step 5: Commit the independently testable stylesheet extraction if authorized**

```bash
git add package.json tests/site.test.js assets/styles.css index.html projects/industrialsim.html
git commit -m "refactor(site): extract warm paper visual system

- centralize shared page tokens and responsive components
- migrate both pages away from inline styles and external fonts
- add the zero-dependency Node test harness"
```

---

### Task 2: Remove the Permanent Background Animation and Extract Home Effects

**Files:**
- Create: `assets/home-effects.js`
- Modify: `tests/site.test.js`
- Modify: `index.html:935-940,1761-1872`
- Modify: `assets/styles.css`

**Interfaces:**
- Consumes: existing selectors `.hero-top`, `.hero-actions`, `.featured-project`, `.project-card`, `.hero-summary`, `.receipt-showcase`, `.footer-note`
- Produces: deferred side-effect script `assets/home-effects.js`; it exports no globals
- Produces: CSS state classes `[data-reveal]`, `.revealed`, and `.glow-card`

- [ ] **Step 1: Add the failing background/effects contract test**

Append to `tests/site.test.js`:

```js
test('homepage uses finite effects without a background canvas', () => {
  const home = read('index.html');
  const effects = read('assets/home-effects.js');

  assert.match(home, /<script defer src="assets\/home-effects\.js"><\/script>/);
  assert.doesNotMatch(home, /id="stars"|class="bg-effects"|class="bg-blob/);
  assert.doesNotMatch(effects, /starLoop|requestAnimationFrame/);
  assert.match(effects, /prefers-reduced-motion: reduce/);
  assert.match(effects, /IntersectionObserver/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`

Expected: FAIL because `assets/home-effects.js` does not exist.

- [ ] **Step 3: Create the finite home effects script**

Create `assets/home-effects.js` around this exact lifecycle:

```js
(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const revealTargets = document.querySelectorAll(
    '.hero-top, .hero-actions, .featured-project, .tags, .project-showcase, ' +
    '.project-card, .hero-summary, .receipt-showcase, .footer-note'
  );

  revealTargets.forEach((element, index) => {
    element.dataset.reveal = '';
    element.style.setProperty('--reveal-delay', `${Math.min(index * 0.07, 0.42)}s`);
  });

  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach(element => element.classList.add('revealed'));
  } else {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    revealTargets.forEach(element => observer.observe(element));
  }

  if (!finePointer) return;
  document.querySelectorAll('.hero-card, .featured-project, .project-card, .compact-panel, .about-box')
    .forEach(element => {
      element.classList.add('glow-card');
      element.addEventListener('pointermove', event => {
        const rect = element.getBoundingClientRect();
        element.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        element.style.setProperty('--my', `${event.clientY - rect.top}px`);
      });
    });

  if (reducedMotion) return;
  const maxTilt = 3;
  document.querySelectorAll('.project-card, .project-highlight').forEach(element => {
    element.addEventListener('pointermove', event => {
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      element.style.transform =
        `perspective(700px) rotateX(${(-y * maxTilt).toFixed(2)}deg) ` +
        `rotateY(${(x * maxTilt).toFixed(2)}deg) translateY(-2px)`;
    });
    element.addEventListener('pointerleave', () => {
      element.style.transform = '';
    });
  });
})();
```

Do not copy the old star canvas setup, `starLoop`, resize listener, or perpetual `requestAnimationFrame` call. The exact `maxTilt = 3` implementation above is the retained pointer tilt.

- [ ] **Step 4: Remove obsolete background markup and wire the script**

Using `apply_patch`:

1. Remove the complete `<div class="bg-effects" aria-hidden="true">...</div>` block from `index.html`.
2. Replace the second inline `<script>` block with `<script defer src="assets/home-effects.js"></script>`.
3. Delete `.bg-effects`, `.bg-blob`, `.bg-grid`, `#stars`, and their keyframes from `assets/styles.css`.
4. Keep the static body background from Task 1 as the only page backdrop.

- [ ] **Step 5: Run tests and confirm the removed loop is absent**

Run: `npm test`

Expected: all tests PASS.

Run: `rg -n "stars|starLoop|bg-blob|requestAnimationFrame" index.html assets/home-effects.js assets/styles.css`

Expected: no matches.

- [ ] **Step 6: Commit the finite effects extraction if authorized**

```bash
git add index.html assets/home-effects.js assets/styles.css tests/site.test.js
git commit -m "refactor(home): replace animated backdrop with finite effects

- remove the star canvas and perpetual background rendering loop
- preserve reduced-motion aware reveal and pointer interactions
- rely on the shared warm paper background"
```

---

### Task 3: Extract and Retheme the Three.js Receipt

**Files:**
- Create: `assets/receipt.js`
- Modify: `tests/site.test.js`
- Modify: `index.html:1116-1759`
- Modify: `assets/styles.css`

**Interfaces:**
- Consumes: global `window.THREE` from `three.min.js` and `#receipt-wrap` from the homepage
- Produces: no exported globals; all state remains inside a `DOMContentLoaded` callback
- Preserves: `showReceiptFallback`, `scheduleReceiptFrame`, `canRunReceipt`, `updateProfileTimer`

- [ ] **Step 1: Add the failing receipt extraction and fallback test**

Append to `tests/site.test.js`:

```js
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
  assert.doesNotMatch(receipt, /function animate\s*\(/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`

Expected: FAIL because `assets/receipt.js` does not exist.

- [ ] **Step 3: Move the receipt implementation without changing physics**

Use `apply_patch` to move the body of the first homepage inline script, currently `index.html:1117-1759`, into `assets/receipt.js`. Start the file with this exact prefix:

```js
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
```

Move the existing implementation beginning with `const prefersReducedMotion` immediately after this prefix, preserve particle dimensions, constraint construction, gravity, damping, drag radius, visibility listener, intersection observer and finite frame scheduling exactly, and retain the callback's final `});`. Delete the duplicated `data-reveal` assignment from the separate effects code rather than introducing it into this file.

- [ ] **Step 4: Apply the warm receipt palette**

Inside the canvas texture drawing code, replace the old receipt palette with these exact constants and use them for all fill/stroke/text operations:

```js
const RECEIPT_COLORS = {
  paper: '#f7f2e8',
  paperShadow: '#ded5c7',
  ink: '#2b2722',
  muted: '#746d63',
  accent: '#c96445',
  olive: '#72734f',
  rule: '#cfc7ba'
};
```

Update `assets/styles.css` so `#receipt-wrap` uses `var(--surface-soft)`, `var(--border)` and a low-strength warm shadow. Keep the canvas `aria-hidden="true"` and the wrapper role/label unchanged.

- [ ] **Step 5: Replace the inline script with deferred resources**

The final homepage order must be:

```html
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script defer src="assets/receipt.js"></script>
<script defer src="assets/home-effects.js"></script>
```

- [ ] **Step 6: Run tests and the legacy contract once before deleting it**

Run: `node test_receipt_homepage.js`

Expected: the legacy test may fail only because scripts moved; record which obsolete string assertions fail, then remove `test_receipt_homepage.js` because `tests/site.test.js` now owns the migrated contract.

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 7: Commit the receipt extraction if authorized**

```bash
git add index.html assets/receipt.js assets/styles.css tests/site.test.js test_receipt_homepage.js
git commit -m "refactor(home): extract and retheme interactive receipt

- preserve finite receipt physics and visibility lifecycle behavior
- apply the warm paper texture palette and fallback styling
- replace inline interaction code with deferred static assets"
```

---

### Task 4: Add Site Identity Metadata and Correct Navigation

**Files:**
- Create: `assets/favicon.svg`
- Modify: `tests/site.test.js`
- Modify: `index.html:4-20,1065-1070`
- Modify: `projects/industrialsim.html:4-19`

**Interfaces:**
- Produces: `assets/favicon.svg` referenced as `image/svg+xml`
- Produces: homepage theme color `#e9e5dc` and detail theme color `#e9e5dc`
- Preserves: existing canonical and Open Graph text values

- [ ] **Step 1: Add the failing identity and link tests**

Append to `tests/site.test.js`:

```js
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`

Expected: FAIL on missing favicon and old theme color assertions.

- [ ] **Step 3: Create the code-native favicon**

Create `assets/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="openshane">
  <rect width="64" height="64" rx="14" fill="#27241f"/>
  <path d="M16 20l12 12-12 12" fill="none" stroke="#c96445" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M34 44h14" fill="none" stroke="#f3f0e8" stroke-width="6" stroke-linecap="round"/>
</svg>
```

- [ ] **Step 4: Update page metadata and current-page link**

Add the appropriate favicon link immediately after each viewport meta tag. Change both `theme-color` values to `#e9e5dc`. Change only the homepage quick-link URL whose visible label is `当前主页` from `https://openshane.github.io/openshane` to `/`; do not alter the canonical URL.

- [ ] **Step 5: Run tests and validate repository-local targets**

Run: `npm test`

Expected: all tests PASS.

Run: `test -f assets/favicon.svg && test -f projects/industrialsim.html`

Expected: exit 0.

- [ ] **Step 6: Commit metadata and navigation if authorized**

```bash
git add assets/favicon.svg index.html projects/industrialsim.html tests/site.test.js
git commit -m "fix(site): align metadata and navigation with warm theme

- add the code-native site icon and warm browser theme color
- point the current-page shortcut at the canonical site root
- verify external link opener isolation"
```

---

### Task 5: Document and Automate the Static Site Contract

**Files:**
- Create: `.gitignore`
- Create: `.github/workflows/validate.yml`
- Modify: `README.md`
- Modify: `tests/site.test.js`

**Interfaces:**
- Consumes: `npm test` from Task 1
- Produces: GitHub Actions workflow using `actions/checkout@v6`, `actions/setup-node@v6`, and Node 24
- Produces: documented local preview command `python -m http.server 8000`

- [ ] **Step 1: Add the failing repository contract test**

Append to `tests/site.test.js`:

```js
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`

Expected: FAIL because `.github/workflows/validate.yml` and `.gitignore` do not exist.

- [ ] **Step 3: Add ignore rules**

Create `.gitignore`:

```gitignore
.claude/
.superpowers/
.DS_Store
Thumbs.db
```

- [ ] **Step 4: Add the CI workflow**

Create `.github/workflows/validate.yml`:

```yaml
name: Validate site

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          package-manager-cache: false
      - run: npm test
```

- [ ] **Step 5: Replace the placeholder README**

Write `README.md` with these exact sections and commands:

````markdown
# openshane.github.io

Personal GitHub Pages site for presenting IndustrialSim, industrial hardware simulation, and web interaction experiments.

## Structure

- `index.html` — homepage
- `projects/industrialsim.html` — IndustrialSim detail page
- `assets/styles.css` — shared warm paper visual system
- `assets/receipt.js` — interactive Three.js receipt
- `assets/home-effects.js` — finite homepage effects
- `tests/site.test.js` — zero-dependency static contract tests

## Local preview

```bash
python -m http.server 8000
```

Open `http://localhost:8000/`.

## Test

```bash
npm test
```

## Deployment

The repository is deployed directly by GitHub Pages; no build step is required.
````

- [ ] **Step 6: Run the complete automated suite**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 7: Commit documentation and CI if authorized**

```bash
git add .gitignore .github/workflows/validate.yml README.md tests/site.test.js
git commit -m "chore(site): document and automate static validation

- add Node 24 checks for pushes and pull requests
- document local preview, testing, structure, and deployment
- keep local agent sessions out of version control"
```

---

### Task 6: Browser Verification and Final Cleanup

**Files:**
- Modify only if verification finds a scoped defect: `assets/styles.css`, `assets/receipt.js`, `assets/home-effects.js`, `index.html`, `projects/industrialsim.html`, `tests/site.test.js`

**Interfaces:**
- Consumes: the complete static site from Tasks 1-5
- Produces: verified desktop/mobile behavior; no new public interface

- [ ] **Step 1: Start the local static server**

Run: `python -m http.server 8765 --bind 127.0.0.1`

Expected: server reports `Serving HTTP on 127.0.0.1 port 8765`.

- [ ] **Step 2: Verify the desktop homepage at 1440×1000**

Check `http://127.0.0.1:8765/` in a real browser and record:

- `document.documentElement.scrollWidth <= innerWidth`
- exactly one `main` and one `h1`
- no console errors or warnings
- avatar loads or retains meaningful alt text if the remote image fails
- Three.js receipt renders, or the static fallback is visible
- primary and secondary actions are visually distinct

- [ ] **Step 3: Verify the desktop detail page at 1440×1000**

Check `http://127.0.0.1:8765/projects/industrialsim.html` for no horizontal overflow, one `main`, one `h1`, readable architecture SVG, and no console errors or warnings.

- [ ] **Step 4: Repeat both pages at 390×844**

Confirm both pages stack to one column, all CTA links retain button treatment, the architecture diagram stays inside its container, and the receipt does not force horizontal overflow.

- [ ] **Step 5: Verify internal navigation**

Click `先看代表作：IndustrialSim` and confirm navigation to `/projects/industrialsim.html`. Click `返回首页` and confirm navigation to `/index.html` or `/`.

- [ ] **Step 6: Verify reduced motion**

Emulate `prefers-reduced-motion: reduce`, reload the homepage, and confirm reveal targets are immediately visible, card tilt is disabled, and the receipt does not start high-iteration interactive motion.

- [ ] **Step 7: Fix only observed defects and add a regression assertion first**

For each defect, add a focused failing assertion to `tests/site.test.js` when the defect is statically testable, run `npm test` to observe the failure, apply the minimal patch, and rerun the suite. Do not refactor unrelated styles or text.

- [ ] **Step 8: Run final verification commands**

Run:

```bash
npm test
git diff --check
git status --short
```

Expected: tests PASS, `git diff --check` emits no errors, and status lists only intended source, documentation, test and workflow changes.

- [ ] **Step 9: Create a final verification commit only if authorized**

Skip this step when Task 6 required no source changes. Otherwise:

```bash
git add assets index.html projects tests package.json README.md .gitignore .github
git commit -m "fix(site): resolve warm paper verification defects

- correct responsive or runtime issues found in browser checks
- add focused regression coverage for each verified defect"
```
