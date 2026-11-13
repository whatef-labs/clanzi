// 개발용: Studio를 재시작하지 않고 플러그인 메인 서비스만 새 빌드로 다시 띄운다.
// Studio가 쓰던 것과 같은 명령(내장 Node, 주소, 포트, 언어)으로 실행하면 Studio가 키마다 add를 다시 보낸다.
// manifest를 바꾼 경우(액션 추가 등)에는 Studio 재시작이 필요하다.
import { execFileSync, spawn } from 'node:child_process';

const PACKAGE = 'com.ulanzi.clanzi.ulanziPlugin';

const json = execFileSync('powershell.exe', [
  '-NoProfile', '-Command',
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${PACKAGE}*' } | Select-Object ProcessId, CommandLine, ExecutablePath | ConvertTo-Json -Compress`,
], { encoding: 'utf8' }).trim();

const found = json ? [JSON.parse(json)].flat() : [];
if (found.length === 0) {
  console.error('실행 중인 플러그인 프로세스가 없습니다. Studio를 실행하거나 재시작해 주세요.');
  process.exit(1);
}

const [proc] = found;
const args = splitArgs(proc.CommandLine).slice(1);
for (const p of found) process.kill(p.ProcessId);

const child = spawn(proc.ExecutablePath, args, { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();
console.log(`다시 실행: pid ${child.pid} ${args.join(' ')}`);

/** Windows 명령줄을 큰따옴표 기준으로 나눈다. */
function splitArgs(commandLine) {
  return [...commandLine.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}
