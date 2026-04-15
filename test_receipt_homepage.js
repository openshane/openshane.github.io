const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

assert(/\.receipt-showcase\s*\{[\s\S]*width:\s*min\(360px,\s*100%\);/m.test(html), 'receipt-showcase width not tightened');
assert(/#receipt-wrap\s*\{[\s\S]*height:\s*420px;/m.test(html), 'receipt-wrap height not reduced');
assert(/const\s+RECEIPT_TEXTURE_HEIGHT\s*=\s*700;/.test(html), 'receipt texture height constant missing');
assert(/const\s+TW\s*=\s*512,\s*TH\s*=\s*700;/.test(html), 'receipt texture height not shortened');
assert(/C\('OPENSHANE',\s*cy,\s*38,/.test(html), 'receipt title font not enlarged');
assert(/C\('专注 AI、Web 与工业硬件的全栈开发者',\s*cy,\s*22,/.test(html), 'intro line missing or too small');
assert(/C\('让项目既能跑起来，也能被看见',\s*cy,\s*20,/.test(html), 'personal slogan missing');
assert(/互动小票实验/.test(html), 'receipt heading missing');
assert(/暖纸质感 \+ 深蓝光晕/.test(html), 'updated caption copy missing');
console.log('receipt homepage assertions passed');
