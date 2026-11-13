// 배포 전에 실행한다: node scripts/stamp_webapp.mjs
// GitHub Pages와 텔레그램은 파일을 10분쯤 캐시해서, 새 JS와 옛 CSS가 섞여 화면이 깨질 수 있다.
// 각 화면(index.html, v2.html)의 CSS·JS 주소와 모듈 import map에 같은 버전 꼬리표를 붙여, 한 번에 모두 새로 받거나 모두 옛것을 쓰게 한다.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'webapp');
const PAGES = [
  { html: 'index.html', css: 'app.css', js: 'app.js' },
  { html: 'v2.html', css: 'v2.css', js: 'v2.js' },
];
const version = Date.now().toString(36);

const modules = readdirSync(dir).filter((name) => name.endsWith('.js')).sort();
const imports = Object.fromEntries(modules.map((name) => [`./${name}`, `./${name}?v=${version}`]));
const importMap = `<script type="importmap">${JSON.stringify({ imports })}</script>`;
// href="app.css" / src="app.js" 속성만 고친다. import map 안의 같은 이름은 아래에서 통째로 바꾼다.
const stamp = (html, attr, name) =>
  html.replace(new RegExp(`${attr}="${name.replace('.', '\\.')}(\\?v=[^"]*)?"`), `${attr}="${name}?v=${version}"`);

for (const page of PAGES) {
  const file = join(dir, page.html);
  let html = stamp(stamp(readFileSync(file, 'utf8'), 'href', page.css), 'src', page.js);
  html = html.includes('<script type="importmap">')
    ? html.replace(/<script type="importmap">.*?<\/script>/s, importMap)
    : html.replace('</head>', `${importMap}\n</head>`);
  if (!html.includes(`href="${page.css}?v=${version}"`) || !html.includes(`src="${page.js}?v=${version}"`)) {
    throw new Error(`${page.html}에서 ${page.css}나 ${page.js} 주소를 찾지 못했어요`);
  }
  writeFileSync(file, html);
}
console.log(`stamped ${version} (${modules.length} modules, ${PAGES.length} pages)`);
