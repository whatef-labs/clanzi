import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModMessage } from '../src/protocol.ts';
import type { ModMessage } from '../src/protocol.ts';
import { ENDED_MS, EXPIRE_MS, SETTLE_MS, SessionStore } from '../src/sessions.ts';
import { assignSlots, folderName, pageLayout, sessionLabels, slotFromKey } from '../src/slots.ts';
import { UsageStore } from '../src/limits.ts';
import { lastAiTitle, projectDirName } from '../src/title.ts';
import { HOLD_MS, SlotMemory } from '../src/slot-memory.ts';
import { focusRequestFor } from '../src/focus.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function msg(over: Partial<ModMessage> = {}): ModMessage {
  return { ev: 'beat', sessionId: 's1', cwd: 'X:\\dev\\clanzi', status: 'idle', turn: 0, at: 0, rateLimits: [], ...over };
}

test('메시지 검증: 필요한 필드만 남기고 형식이 틀리면 버린다', () => {
  const ok = parseModMessage({
    v: 1, ev: 'turn-end', sessionId: 'a', cwd: 'C:\\x', status: 'done', turn: 2, at: 5, reason: 'answer',
    prompt: '보내면 안 되는 내용',
    rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-11-13T05:10:00.000Z' }, { kind: 'bad' }],
  });
  assert.deepEqual(ok, {
    ev: 'turn-end', sessionId: 'a', cwd: 'C:\\x', status: 'done', turn: 2, at: 5,
    rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-11-13T05:10:00.000Z' }],
  });
  assert.equal(parseModMessage({ v: 2, ev: 'beat', sessionId: 'a', cwd: 'c', status: 'idle' }), null);
  assert.equal(parseModMessage({ v: 1, ev: 'hack', sessionId: 'a', cwd: 'c', status: 'idle' }), null);
  assert.equal(parseModMessage({ v: 1, ev: 'beat', sessionId: '', cwd: 'c', status: 'idle' }), null);
  assert.equal(parseModMessage({ v: 1, ev: 'beat', sessionId: 'a', cwd: 'c', status: 'sleeping' }), null);
  assert.equal(parseModMessage(null), null);
});

test('세션: 막 시작한 빈 세션은 유예 뒤에 보이고, 유예 중에 끝나면 보이지 않는다', () => {
  const store = new SessionStore();
  store.apply(msg({ ev: 'start', sessionId: 'phantom' }), 1000);
  assert.equal(store.visible(1000).length, 0);
  store.apply(msg({ ev: 'end', sessionId: 'phantom' }), 1400);
  assert.equal(store.visible(1000 + SETTLE_MS).length, 0);

  store.apply(msg({ ev: 'start', sessionId: 'real' }), 2000);
  assert.deepEqual(store.visible(2000 + SETTLE_MS).map((s) => s.id), ['real']);
});

test('세션: 작업 중 상태로 처음 들어오면(플러그인 재시작 후 복구) 바로 보인다', () => {
  const store = new SessionStore();
  store.apply(msg({ ev: 'beat', status: 'working', turn: 3 }), 1000);
  assert.equal(store.visible(1000).length, 1);
});

test('세션: 신호가 끊기면 정리하고, 끝 메시지는 바로 지운다', () => {
  const store = new SessionStore();
  store.apply(msg({ sessionId: 'a' }), 0);
  store.apply(msg({ sessionId: 'b' }), 0);
  store.apply(msg({ sessionId: 'b' }), EXPIRE_MS);
  assert.deepEqual(store.expire(EXPIRE_MS + 1), ['a']);
  store.apply(msg({ ev: 'end', sessionId: 'b' }), EXPIRE_MS + 2);
  assert.equal(store.visible(EXPIRE_MS + 3).length, 0);
});

test('세션: 끝난 뒤 늦게 온 주기 신호로 되살아나지 않고, 같은 ID로 다시 시작하면 받는다', () => {
  const store = new SessionStore();
  store.apply(msg({ ev: 'start', sessionId: 'a', status: 'working' }), 0);
  store.apply(msg({ ev: 'end', sessionId: 'a' }), 1000);
  store.apply(msg({ ev: 'beat', sessionId: 'a', status: 'idle' }), 1080);
  store.apply(msg({ ev: 'turn-end', sessionId: 'a', status: 'done' }), 1100);
  assert.equal(store.get('a'), undefined);

  store.apply(msg({ ev: 'start', sessionId: 'a', status: 'working' }), 2000);
  assert.equal(store.get('a')?.status, 'working');

  // 키로 강제 종료한 세션도 같다
  store.remove('a', 3000);
  store.apply(msg({ ev: 'beat', sessionId: 'a', status: 'working' }), 3050);
  assert.equal(store.get('a'), undefined);

  // 오래 지나면 잊는다(플러그인이 기억할 ID가 끝없이 늘지 않게)
  store.expire(3000 + ENDED_MS + 1);
  store.apply(msg({ ev: 'beat', sessionId: 'a', status: 'working' }), 3000 + ENDED_MS + 2);
  assert.equal(store.get('a')?.status, 'working');
});

test('세션: 키를 눌러 확인한 완료·오류는 대기로 보이고, 다음 턴에는 다시 표시된다', () => {
  const store = new SessionStore();
  store.apply(msg({ status: 'done', turn: 1 }), 0);
  const s = store.get('s1');
  assert.ok(s);
  assert.equal(SessionStore.displayStatus(s), 'done');
  assert.equal(store.acknowledge('s1'), true);
  assert.equal(SessionStore.displayStatus(s), 'idle');
  // 주기 신호가 같은 턴의 done을 다시 보내도 확인한 표시는 유지
  store.apply(msg({ status: 'done', turn: 1 }), 10);
  assert.equal(SessionStore.displayStatus(s), 'idle');
  store.apply(msg({ status: 'error', turn: 2 }), 20);
  assert.equal(SessionStore.displayStatus(s), 'error');
  assert.equal(store.acknowledge('s1'), true);
  assert.equal(store.acknowledge('s1'), false);
});

test('슬롯: 기존 배정은 유지하고 새 세션은 가장 작은 빈 슬롯에, 넘치면 배정하지 않는다', () => {
  const first = assignSlots(new Map(), ['a', 'b'], [3, 1, 2]);
  assert.deepEqual([...first], [['a', 1], ['b', 2]]);
  // a가 끝나고 c, d가 들어오면 c는 1번, d는 3번
  const second = assignSlots(first, ['b', 'c', 'd'], [1, 2, 3]);
  assert.deepEqual(Object.fromEntries(second), { b: 2, c: 1, d: 3 });
  const overflow = assignSlots(second, ['b', 'c', 'd', 'e'], [1, 2, 3]);
  assert.equal(overflow.has('e'), false);
  // 슬롯 키가 빠지면 그 자리의 세션은 남는 슬롯으로 옮긴다
  const fewer = assignSlots(second, ['b', 'c', 'd'], [1, 3]);
  assert.deepEqual(Object.fromEntries(fewer), { c: 1, d: 3 });
});

test('슬롯 번호: 열_행 → 왼쪽 위부터 1', () => {
  assert.equal(slotFromKey('0_0'), 1);
  assert.equal(slotFromKey('4_0'), 5);
  assert.equal(slotFromKey('0_1'), 6);
  assert.equal(slotFromKey('2_2'), 13);
  assert.equal(slotFromKey('bad'), 0);
});

test('라벨: 폴더 이름, 같은 폴더는 두 번째부터 번호', () => {
  assert.equal(folderName('x:\\dev\\dev-proj\\clanzi'), 'clanzi');
  assert.equal(folderName('/home/me/project/'), 'project');
  const labels = sessionLabels([
    { id: 'a', cwd: 'X:\\dev\\clanzi' },
    { id: 'b', cwd: 'X:\\dev\\api' },
    { id: 'c', cwd: 'x:\\dev\\Clanzi' },
  ]);
  assert.deepEqual(Object.fromEntries(labels), { a: 'clanzi', b: 'api', c: 'Clanzi 2' });
});

test('사용량: 더 최근 측정만 반영하고, 리셋 시각이 지난 창은 비운다', () => {
  const usage = new UsageStore();
  const reset5 = '2026-11-13T05:00:00.000Z';
  const reset7 = '2026-11-18T01:00:00.000Z';
  assert.equal(usage.update(100, [{ kind: 'five_hour', percentUsed: 30.4, resetsAt: reset5 }, { kind: 'seven_day', percentUsed: 9, resetsAt: reset7 }]), true);
  assert.equal(usage.update(50, [{ kind: 'five_hour', percentUsed: 99 }]), false);
  assert.equal(usage.update(200, []), false);

  const before = Date.parse(reset5) - 2 * 3600_000;
  assert.deepEqual(usage.view(before), { fiveHour: 30, sevenDay: 9, fiveHourResetsIn: 7200 });
  const after = Date.parse(reset5) + 1;
  assert.deepEqual(usage.view(after), { fiveHour: null, sevenDay: 9, fiveHourResetsIn: null });
});

test('제목: projects 폴더 이름 규칙과 마지막 ai-title 찾기', () => {
  assert.equal(projectDirName('x:\\dev\\dev-proj\\clanzi'), 'x--dev-dev-proj-clanzi');
  const text = [
    'cut-off-partial-line"}',
    JSON.stringify({ type: 'ai-title', aiTitle: '첫 제목', sessionId: 's' }),
    JSON.stringify({ type: 'user', message: 'ai-title 이라는 단어가 든 사용자 내용' }),
    JSON.stringify({ type: 'ai-title', aiTitle: '  마지막 제목 ', sessionId: 's' }),
    '',
  ].join('\n');
  assert.equal(lastAiTitle(text), '마지막 제목');
  assert.equal(lastAiTitle('{"type":"user"}\n'), null);
});

test('슬롯: 재시작 직후 붙잡아 둔 자리는 돌아온 세션에게 주고, 새 세션은 피해 간다', () => {
  const held = new Map([['old-a', 1], ['old-b', 2]]);
  // b가 먼저 돌아오고 새 세션 n이 들어와도 a의 1번 자리는 비워 둔다
  const first = assignSlots(new Map(), ['old-b', 'n'], [1, 2, 3], held);
  assert.deepEqual(Object.fromEntries(first), { 'old-b': 2, n: 3 });
  const second = assignSlots(first, ['old-b', 'n', 'old-a'], [1, 2, 3], held);
  assert.deepEqual(Object.fromEntries(second), { 'old-b': 2, n: 3, 'old-a': 1 });
  // 붙잡는 시간이 지나면(held 비움) 남은 자리는 새 세션이 쓴다
  const later = assignSlots(new Map([['old-b', 2]]), ['old-b', 'm'], [1, 2, 3]);
  assert.deepEqual(Object.fromEntries(later), { 'old-b': 2, m: 1 });
});

test('슬롯 기록: 저장한 배정을 다음 시작 때 붙잡고, 시간이 지나면 놓는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clanzi-'));
  const file = join(dir, 'state', 'slots.json');
  const first = new SlotMemory(file, 0);
  first.save(new Map([['a', 3], ['b', 1]]), 0);
  const restarted = new SlotMemory(file, 1000);
  assert.deepEqual(Object.fromEntries(restarted.holds(1000)), { a: 3, b: 1 });
  assert.equal(restarted.holds(1000 + HOLD_MS).size, 0);
  assert.equal(new SlotMemory(join(dir, 'none.json'), 0).holds(0).size, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('메시지 검증: 실행 위치와 프로세스 ID(문자열도 받음)', () => {
  const base = { v: 1, ev: 'beat', sessionId: 'a', cwd: 'c', status: 'idle' };
  assert.deepEqual(
    [parseModMessage({ ...base, origin: 'claude-vscode', pid: '3048' })].map((m) => [m?.origin, m?.pid]),
    [['claude-vscode', 3048]],
  );
  const bad = parseModMessage({ ...base, origin: '', pid: 'abc' });
  assert.equal(bad?.origin, undefined);
  assert.equal(bad?.pid, undefined);
});

test('창 이동 요청: VS Code 세션은 폴더와 세션 ID, 터미널 세션은 프로세스 ID, 둘 다 없으면 없음', () => {
  assert.deepEqual(focusRequestFor({ id: 's', cwd: 'x:\\dev\\clanzi', origin: 'claude-vscode', pid: 1 }), { op: 'vscode', folder: 'clanzi', session: 's' });
  assert.deepEqual(focusRequestFor({ id: 's', cwd: 'X:\\dev\\fms-api', origin: 'cli', pid: 42 }), { op: 'pid', pid: 42, folder: 'fms-api' });
  assert.equal(focusRequestFor({ id: 's', cwd: 'X:\\dev\\fms-api', origin: 'cli' }), null);
});

test('메시지 검증: 사용량 측정 시각', () => {
  const base = { v: 1, ev: 'beat', sessionId: 'a', cwd: 'c', status: 'idle' };
  assert.equal(parseModMessage({ ...base, rateLimitsAt: 1234 })?.measuredAt, 1234);
  assert.equal(parseModMessage({ ...base, rateLimitsAt: 0 })?.measuredAt, undefined);
  assert.equal(parseModMessage(base)?.measuredAt, undefined);
});

test('사용량: 쉬는 세션이 주기 신호로 다시 보낸 옛 측정값은 최신 값을 덮지 않는다', () => {
  const usage = new UsageStore();
  usage.update(2000, [{ kind: 'five_hour', percentUsed: 39 }]); // 일하는 세션의 최신 측정
  assert.equal(usage.update(1000, [{ kind: 'five_hour', percentUsed: 38 }]), false); // 쉬는 세션의 옛 측정
  assert.equal(usage.view(0).fiveHour, 39);
});

test('페이지: 1페이지는 고정 배정, 넘친 세션은 다음 페이지부터 슬롯 순서대로', () => {
  const assignment = new Map([['a', 2], ['b', 1]]);
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const first = pageLayout(assignment, ids, [2, 1], 0);
  assert.equal(first.pageCount, 3);
  assert.deepEqual(Object.fromEntries(first.shown), { 2: 'a', 1: 'b' });
  const second = pageLayout(assignment, ids, [2, 1], 1);
  assert.deepEqual(Object.fromEntries(second.shown), { 1: 'c', 2: 'd' });
  const third = pageLayout(assignment, ids, [2, 1], 2);
  assert.deepEqual(Object.fromEntries(third.shown), { 1: 'e' });
  // 세션이 줄면 페이지를 범위 안으로 맞춘다
  const shrunk = pageLayout(assignment, ['a', 'b', 'c'], [1, 2], 5);
  assert.equal(shrunk.page, 1);
  assert.equal(shrunk.pageCount, 2);
  // 슬롯 키가 없으면 한 페이지
  assert.deepEqual(pageLayout(new Map(), ['a'], [], 3), { shown: new Map(), pageCount: 1, page: 0 });
});
