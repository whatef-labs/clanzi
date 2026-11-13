// 렌더러 결과를 한 HTML 페이지로 모아 본다. 실행: node scripts/preview.ts [출력 경로]
// Studio의 SVG 렌더러와 브라우저는 결과가 조금 다를 수 있으니 최종 확인은 실기기에서 한다.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PREVIEW_SAMPLES } from '../src/preview.ts';
import { toDataUri } from '../src/render/svg.ts';

const out = resolve(process.argv[2] ?? 'preview/index.html');
const cells = PREVIEW_SAMPLES.map(
  (s) => `<figure><img src="${toDataUri(s.svg)}" width="196" height="196"><figcaption>${s.name}</figcaption></figure>`,
).join('\n');

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>clanzi preview</title>
<style>body{background:#202124;color:#ddd;font:13px sans-serif;display:flex;flex-wrap:wrap;gap:14px;padding:16px;margin:0}
figure{margin:0;text-align:center}img{display:block;border-radius:24px}</style>
${cells}
`);
console.log(out);
