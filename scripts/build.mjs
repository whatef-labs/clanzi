// src/app.ts를 Studio 내장 Node(v20.12.2)가 실행할 단일 CJS 파일로 번들한다.
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  absWorkingDir: root,
  entryPoints: ['src/app.ts'],
  outfile: 'com.ulanzi.clanzi.ulanziPlugin/plugin/app.js',
  bundle: true,
  platform: 'node',
  target: 'node20.12',
  format: 'cjs',
  // ws의 선택 의존성. 없으면 ws가 순수 JS 경로로 동작한다.
  external: ['bufferutil', 'utf-8-validate'],
  sourcemap: 'inline',
  legalComments: 'eof',
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
