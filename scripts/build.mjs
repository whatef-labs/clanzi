// src/app.ts를 Studio 내장 Node(v20.12.2)가 실행할 단일 CJS 파일로 번들하고,
// 창 전환 도우미(native/focus-helper.cs)를 Windows 기본 C# 컴파일러로 빌드한다.
import { build, context } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const outDir = join(root, 'com.ulanzi.clanzi.ulanziPlugin', 'plugin');
const HELPER_SOURCE = join(root, 'native', 'focus-helper.cs');
const HELPER_EXE = join(outDir, 'focus-helper.exe');

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

buildHelper();
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}

/**
 * .NET Framework 4의 csc.exe(Windows 10·11에 기본으로 있음)로 도우미를 빌드한다. 소스가 그대로면 건너뛴다.
 * 실행 중인 exe는 덮어쓸 수 없지만 이름은 바꿀 수 있으므로, 옛 파일을 비켜 두고 새 파일을 넣는다.
 */
function buildHelper() {
  if (process.platform !== 'win32') {
    console.warn('focus-helper.exe는 Windows에서만 빌드합니다. 건너뜁니다.');
    return;
  }
  removeStale();
  if (existsSync(HELPER_EXE) && statSync(HELPER_EXE).mtimeMs >= statSync(HELPER_SOURCE).mtimeMs) return;
  const csc = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!existsSync(csc)) throw new Error(`C# 컴파일러가 없습니다: ${csc}`);
  mkdirSync(outDir, { recursive: true });
  const fresh = `${HELPER_EXE}.new`;
  execFileSync(csc, ['/nologo', '/target:exe', '/optimize+', '/r:System.Web.Extensions.dll', `/out:${fresh}`, HELPER_SOURCE], { stdio: 'inherit' });
  if (existsSync(HELPER_EXE)) {
    try {
      rmSync(HELPER_EXE);
    } catch {
      renameSync(HELPER_EXE, `${HELPER_EXE}.old-${Date.now()}`);
    }
  }
  renameSync(fresh, HELPER_EXE);
  console.log('  com.ulanzi.clanzi.ulanziPlugin\\plugin\\focus-helper.exe');
}

/** 비켜 둔 옛 도우미를 지운다. 아직 실행 중이면 다음 빌드 때 지운다. */
function removeStale() {
  if (!existsSync(outDir)) return;
  for (const name of readdirSync(outDir)) {
    if (!name.startsWith('focus-helper.exe.')) continue;
    try {
      rmSync(join(outDir, name));
    } catch {
      // 실행 중
    }
  }
}
