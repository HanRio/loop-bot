// 배포 전에 실행한다: node scripts/stamp_webapp.mjs
// GitHub Pages와 텔레그램은 파일을 10분쯤 캐시해서, 새 JS와 옛 CSS가 섞여 화면이 깨질 수 있다.
// index.html의 CSS·JS 주소와 모듈 import map에 같은 버전 꼬리표를 붙여, 한 번에 모두 새로 받거나 모두 옛것을 쓰게 한다.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'webapp');
const file = join(dir, 'index.html');
const version = Date.now().toString(36);

const modules = readdirSync(dir).filter((name) => name.endsWith('.js')).sort();
const imports = Object.fromEntries(modules.map((name) => [`./${name}`, `./${name}?v=${version}`]));
const importMap = `<script type="importmap">${JSON.stringify({ imports })}</script>`;

let html = readFileSync(file, 'utf8')
  .replace(/href="app\.css(\?v=[^"]*)?"/, `href="app.css?v=${version}"`)
  .replace(/src="app\.js(\?v=[^"]*)?"/, `src="app.js?v=${version}"`);
html = html.includes('<script type="importmap">')
  ? html.replace(/<script type="importmap">.*?<\/script>/s, importMap)
  : html.replace('</head>', `${importMap}\n</head>`);

if (!html.includes(`app.css?v=${version}`) || !html.includes(`app.js?v=${version}`)) {
  throw new Error('index.html에서 app.css나 app.js 주소를 찾지 못했어요');
}
writeFileSync(file, html);
console.log(`stamped ${version} (${modules.length} modules)`);
