import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const srcDir = path.join(projectRoot, 'src');
const targets = [path.join(srcDir, 'core'), path.join(srcDir, 'main.ts')];

const forbidden = [
  { name: 'framework-import', re: /@framework\//g },
  { name: 'live2d-inc', re: /Live2D Inc/g },
  { name: 'live2d-eula', re: /live2d\.com\/eula/gi },
  { name: 'live2d-license-header', re: /Use of this source code is governed by the Live2D Open Software license/g },
];

const forbiddenCoreToSdk = [
  /from\s+['"]\.\.\/sdk\//g,
  /from\s+['"]\.\.\/\.\.\/sdk\//g,
  /from\s+['"]\.\/sdk\//g,
  /from\s+['"]\.\.\/\.\.\/src\/sdk\//g,
];

function listFiles(p) {
  if (!fs.existsSync(p)) return [];
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  const out = [];
  for (const ent of fs.readdirSync(p, { withFileTypes: true })) {
    const child = path.join(p, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(child));
    else out.push(child);
  }
  return out;
}

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

const files = targets.flatMap((t) => listFiles(t)).filter((p) => p.endsWith('.ts'));

const violations = [];

for (const file of files) {
  const text = readText(file);
  for (const rule of forbidden) {
    if (rule.re.test(text)) {
      violations.push({ file, rule: rule.name });
    }
    rule.re.lastIndex = 0;
  }

  if (file.includes(`${path.sep}core${path.sep}`)) {
    for (const re of forbiddenCoreToSdk) {
      if (re.test(text)) violations.push({ file, rule: 'core-imports-sdk' });
      re.lastIndex = 0;
    }
  }
}

if (violations.length) {
  for (const v of violations) {
    console.error(`[isolation] ${v.rule}: ${v.file}`);
  }
  process.exit(1);
}

console.log('[isolation] ok');

