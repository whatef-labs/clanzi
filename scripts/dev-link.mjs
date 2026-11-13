// 개발용: Ulanzi Studio 사용자 플러그인 폴더에 이 저장소의 패키지 폴더를 정션으로 연결한다.
// 사용법: node scripts/dev-link.mjs [--remove]
import { lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = 'com.ulanzi.clanzi.ulanziPlugin';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, PACKAGE);
const pluginsDir = join(process.env.APPDATA ?? '', 'Ulanzi', 'UlanziDeck', 'Plugins');
const target = join(pluginsDir, PACKAGE);

const existing = lstatSync(target, { throwIfNoEntry: false });

if (process.argv.includes('--remove')) {
  if (!existing) {
    console.log(`연결 없음: ${target}`);
  } else if (existing.isSymbolicLink()) {
    rmSync(target);
    console.log(`연결 해제: ${target}`);
  } else {
    console.error(`정션이 아닌 실제 폴더라 지우지 않습니다: ${target}`);
    process.exit(1);
  }
} else if (existing) {
  if (existing.isSymbolicLink() && resolve(readlinkSync(target)) === source) {
    console.log(`이미 연결됨: ${target} -> ${source}`);
  } else {
    console.error(`같은 이름이 이미 있습니다. 확인 후 지워 주세요: ${target}`);
    process.exit(1);
  }
} else {
  mkdirSync(pluginsDir, { recursive: true });
  symlinkSync(source, target, 'junction');
  console.log(`연결: ${target} -> ${source}`);
}
