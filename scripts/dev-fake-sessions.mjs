// 개발용: 가짜 세션을 브리지에 보내 페이지 넘기기 등을 실기기에서 시험한다.
// 사용법: node scripts/dev-fake-sessions.mjs [개수=12] [유지 초=180]
// 유지 시간이 끝나거나 Ctrl+C를 누르면 가짜 세션을 모두 종료 처리한다.
const count = Number(process.argv[2] ?? 12);
const seconds = Number(process.argv[3] ?? 180);
const ENDPOINT = 'http://127.0.0.1:39311/event';
const STATUSES = ['idle', 'working', 'waiting', 'done', 'error'];

const sessions = Array.from({ length: count }, (_, i) => ({
  sessionId: `fake-${String(i + 1).padStart(2, '0')}-0000-0000-0000-000000000000`,
  cwd: `C:\\fake\\demo-${String(i + 1).padStart(2, '0')}`,
  status: STATUSES[i % STATUSES.length],
  turn: 1,
}));

async function send(s, ev) {
  try {
    await fetch(ENDPOINT, { method: 'POST', body: JSON.stringify({ v: 1, ev, ...s, at: Date.now(), rateLimits: [] }) });
  } catch {
    console.error('브리지에 연결하지 못했습니다. Studio 플러그인이 실행 중인지 확인하세요.');
    process.exit(1);
  }
}

async function end() {
  await Promise.all(sessions.map((s) => send(s, 'end')));
  console.log(`가짜 세션 ${count}개 종료`);
  process.exit(0);
}

process.on('SIGINT', end);
await Promise.all(sessions.map((s) => send(s, 'beat')));
console.log(`가짜 세션 ${count}개 시작, ${seconds}초 유지`);
const beat = setInterval(() => sessions.forEach((s) => send(s, 'beat')), 20_000);
setTimeout(() => {
  clearInterval(beat);
  end();
}, seconds * 1000);
