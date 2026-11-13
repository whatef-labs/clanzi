import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gaugeColor, COLOR } from '../src/render/theme.ts';
import { ring, esc, estimateWidth, toDataUri } from '../src/render/svg.ts';
import { fitLabel } from '../src/render/label.ts';
import { formatRemaining, normalizePercent } from '../src/render/format.ts';
import { renderSessionTile } from '../src/render/session.ts';
import { renderUsageGauge } from '../src/render/usage.ts';

test('게이지 색 경계: 70 미만 초록, 70~89 노랑, 90 이상 빨강', () => {
  assert.equal(gaugeColor(0), COLOR.ok);
  assert.equal(gaugeColor(69), COLOR.ok);
  assert.equal(gaugeColor(70), COLOR.warn);
  assert.equal(gaugeColor(89), COLOR.warn);
  assert.equal(gaugeColor(90), COLOR.danger);
  assert.equal(gaugeColor(100), COLOR.danger);
});

test('링: 값이 없거나 0이면 트랙만, 100% 초과는 한 바퀴로 자른다', () => {
  assert.equal(countCircles(ring(98, 98, 50, 10, null, '#f00', '#222')), 1);
  assert.equal(countCircles(ring(98, 98, 50, 10, 0, '#f00', '#222')), 1);
  const full = ring(98, 98, 50, 10, 1.5, '#f00', '#222');
  const c = (2 * Math.PI * 50).toFixed(2);
  assert.match(full, new RegExp(`stroke-dasharray="${c} ${c}"`));
});

test('esc는 XML 특수문자를 숫자 엔티티로 바꾼다', () => {
  assert.equal(esc(`<a&b>"'`), '&#60;a&#38;b&#62;&#34;&#39;');
});

test('글자 폭 근사: 한글은 라틴 소문자보다 넓다', () => {
  assert.ok(estimateWidth('가나다', 20) > estimateWidth('abc', 20));
  assert.equal(estimateWidth('가', 20), 20);
});

test('라벨: 짧으면 한 줄, 길면 구분자에서 두 줄, 더 길면 말줄임', () => {
  assert.deepEqual(fitLabel('clanzi', 164).lines, ['clanzi']);

  const two = fitLabel('passtrue-api-server', 164);
  assert.deepEqual(two.lines, ['passtrue-', 'api-server']);
  for (const line of two.lines) assert.ok(estimateWidth(line, two.size) <= 164, line);

  const long = fitLabel('a-very-very-long-project-directory-name-that-never-fits', 164);
  assert.equal(long.lines.length, 2);
  assert.ok(long.lines[1]?.endsWith('…'));
  for (const line of long.lines) assert.ok(estimateWidth(line, long.size) <= 164, line);

  assert.deepEqual(fitLabel('   ', 164).lines, ['?']);
});

test('라벨: 한글 폴더 이름도 폭 안에 들어간다', () => {
  const fitted = fitLabel('고객관리시스템리뉴얼프로젝트', 164);
  for (const line of fitted.lines) assert.ok(estimateWidth(line, fitted.size) <= 164, line);
});

test('남은 시간 표기', () => {
  assert.equal(formatRemaining(-5), '0m');
  assert.equal(formatRemaining(30), '<1m');
  assert.equal(formatRemaining(45 * 60), '45m');
  assert.equal(formatRemaining(2 * 3600 + 10 * 60 + 59), '2h 10m');
  assert.equal(formatRemaining(3 * 3600), '3h');
  assert.equal(formatRemaining(3 * 86400 + 4 * 3600), '3d 4h');
});

test('사용률 정규화', () => {
  assert.equal(normalizePercent(34.4), 34);
  assert.equal(normalizePercent(-3), 0);
  assert.equal(normalizePercent(140), 100);
  assert.equal(normalizePercent('34'), null);
  assert.equal(normalizePercent(Number.NaN), null);
});

test('세션 타일: 점·테두리·배경색으로 상태를 구분하고 문구가 없다', () => {
  const idle = renderSessionTile({ status: 'idle', label: 'clanzi' });
  assert.match(idle, new RegExp(`<circle[^>]*fill="${COLOR.idle}"`));
  assert.match(idle, new RegExp(`stroke="${COLOR.idle}"`));
  assert.equal(COLOR.idle, COLOR.empty);

  const on = renderSessionTile({ status: 'working', label: 'clanzi' });
  const off = renderSessionTile({ status: 'working', label: 'clanzi', dim: true });
  assert.match(on, new RegExp(`<circle[^>]*fill="${COLOR.working}"`));
  assert.doesNotMatch(off, /<circle/);
  for (const svg of [on, off]) assert.match(svg, new RegExp(`stroke="${COLOR.working}"`));

  const waiting = renderSessionTile({ status: 'waiting', label: 'clanzi' });
  const waitingDim = renderSessionTile({ status: 'waiting', label: 'clanzi', dim: true });
  assert.notEqual(waiting, waitingDim);
  assert.match(waiting, new RegExp(`fill="${COLOR.waiting}"`));
  for (const svg of [waiting, waitingDim]) assert.match(svg, new RegExp(`<circle[^>]*fill="${COLOR.waiting}"`));
  // 이름은 밝은 단계에서 검정, 꺼진 단계에서 다른 상태와 같은 흰색
  assert.match(waiting, new RegExp(`<text[^>]*fill="${COLOR.dark}"`));
  assert.match(waitingDim, new RegExp(`<text[^>]*fill="${COLOR.text}"`));

  const done = renderSessionTile({ status: 'done', label: 'clanzi' });
  assert.match(done, new RegExp(`fill="${COLOR.done}"`));
  assert.doesNotMatch(done, /<circle/);

  for (const svg of [idle, on, off, waiting, waitingDim, done]) {
    assert.doesNotMatch(svg, /대기|작업 중|완료/);
    assert.equal(svg.match(/<text/g)?.length, 1);
  }
  // 기본 배경은 채우지 않는다(검은 바탕).
  for (const svg of [idle, on, off, waitingDim]) assert.match(svg, /<rect x="6"[^>]*fill="none"/);
});

test('세션 타일: 빈 슬롯은 패널·라벨 없이 빈 아이콘만', () => {
  const empty = renderSessionTile({ status: 'empty', label: 'ignored' });
  assert.doesNotMatch(empty, /<text/);
  assert.doesNotMatch(empty, /<rect x="6"/);
  assert.equal(countCircles(empty), 1);
  assert.match(empty, new RegExp(`stroke="${COLOR.empty}"`));
});

test('세션 타일: 라벨의 특수문자를 이스케이프한다', () => {
  const svg = renderSessionTile({ status: 'idle', label: '<script>&' });
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&#60;script&#62;&#38;/);
});

test('사용량 게이지: 5시간 값이 없으면 중앙에 --, 링은 트랙만', () => {
  const svg = renderUsageGauge({ fiveHour: null, sevenDay: null, caption: '2h' });
  assert.match(svg, />--</);
  assert.equal(countCircles(svg), 2);
  assert.doesNotMatch(svg, />2h</);
});

test('사용량 게이지: 링마다 따로 색을 정한다', () => {
  const svg = renderUsageGauge({ fiveHour: 95, sevenDay: 40, caption: '1h 5m' });
  assert.match(svg, />95%</);
  assert.match(svg, />1h 5m</);
  assert.match(svg, new RegExp(`stroke="${COLOR.danger}"`));
  assert.match(svg, new RegExp(`stroke="${COLOR.ok}"`));
  assert.equal(countCircles(svg), 4);
});

test('data URI는 SVG MIME 접두어와 base64 본문이다', () => {
  const uri = toDataUri('<svg/>');
  assert.ok(uri.startsWith('data:image/svg+xml;base64,'));
  assert.equal(Buffer.from(uri.split(',')[1] ?? '', 'base64').toString(), '<svg/>');
});

function countCircles(svg: string): number {
  return svg.match(/<circle/g)?.length ?? 0;
}
