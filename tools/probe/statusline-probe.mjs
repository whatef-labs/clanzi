// 임시 프로브: statusLine이 어느 환경(VS Code 확장 패널 / CLI)에서 호출되는지와
// rate_limits 수신 여부를 ~/.claude/clanzi/probe/ 에 기록한다. 확인이 끝나면 settings.json에서 제거한다.
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dir = join(homedir(), '.claude', 'clanzi', 'probe');
const now = new Date();

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', finish);
setTimeout(finish, 1000).unref();

let done = false;
function finish() {
  if (done) return;
  done = true;
  try {
    mkdirSync(dir, { recursive: true });
    let data = {};
    try { data = JSON.parse(raw); } catch { /* 빈 입력이나 깨진 JSON도 기록만 한다 */ }
    writeFileSync(join(dir, 'last-stdin.json'), raw);
    const rl = data.rate_limits ?? null;
    appendFileSync(join(dir, 'statusline.log'), JSON.stringify({
      t: now.toISOString(),
      entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null,
      session_id: data.session_id ?? null,
      version: data.version ?? null,
      has_rate_limits: rl !== null,
      five_hour: rl?.five_hour ?? null,
      seven_day: rl?.seven_day ?? null,
      keys: Object.keys(data),
    }) + '\n');
  } catch { /* 프로브 실패가 상태 줄을 깨뜨리지 않게 한다 */ }
  process.stdout.write(`clanzi probe · ${now.toTimeString().slice(0, 8)}\n`);
  process.exit(0);
}
