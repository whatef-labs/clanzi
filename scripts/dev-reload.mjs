// 개발용: Studio를 재시작하지 않고 플러그인 메인 서비스만 새 빌드로 다시 띄운다.
// Studio가 쓰던 것과 같은 명령(내장 Node, 주소, 포트, 언어)으로 실행하면 Studio가 키마다 add를 다시 보낸다.
// 실행 중인 플러그인이 없으면 Studio가 대기 중인 포트를 찾아 연결한다.
// manifest를 바꾼 경우(액션 추가 등)에는 Studio 재시작이 필요하다.
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';

const PACKAGE = 'com.ulanzi.clanzi.ulanziPlugin';
const STUDIO_NODE = 'C:\\Program Files (x86)\\Ulanzi Studio\\nodejs\\node.exe';
const APP = join(process.env.APPDATA ?? '', 'Ulanzi', 'UlanziDeck', 'Plugins', PACKAGE, 'plugin', 'app.js').replaceAll('\\', '/');

const found = ps(`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${PACKAGE}*' } | Select-Object ProcessId, CommandLine, ExecutablePath`);

let exe = STUDIO_NODE;
let args;
if (found.length > 0) {
  exe = found[0].ExecutablePath;
  args = splitArgs(found[0].CommandLine).slice(1);
  for (const p of found) process.kill(p.ProcessId);
} else {
  const ports = ps(`Get-NetTCPConnection -State Listen -OwningProcess (Get-Process UlanziDeck).Id | Select-Object LocalAddress, LocalPort`);
  const port = ports.find((p) => p.LocalAddress === '127.0.0.1')?.LocalPort;
  if (!port) {
    console.error('Studio가 실행 중이 아니거나 대기 포트를 찾지 못했습니다.');
    process.exit(1);
  }
  args = [APP, '127.0.0.1', String(port), 'ko-KR'];
  console.log('실행 중인 플러그인이 없어 Studio 포트로 새로 띄웁니다.');
}

const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();
console.log(`다시 실행: pid ${child.pid} ${args.join(' ')}`);

function ps(command) {
  const json = execFileSync('powershell.exe', ['-NoProfile', '-Command', `${command} | ConvertTo-Json -Compress`], { encoding: 'utf8' }).trim();
  return json ? [JSON.parse(json)].flat() : [];
}

/** Windows 명령줄을 큰따옴표 기준으로 나눈다. */
function splitArgs(commandLine) {
  return [...commandLine.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}
