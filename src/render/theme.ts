// 색 기준. 패널·테두리는 핸드오프 6.5의 기존 아이콘 규칙을 따른다.
export const COLOR = {
  panel: '#17181C',
  border: '#30323A',
  track: '#2A2C33',
  text: '#F3F4F6',
  muted: '#9CA3AF',
  faint: '#4B5060',
  dark: '#111111',

  idle: '#6B7280',
  working: '#3B82F6',
  waiting: '#F97316',
  waitingDim: '#3A1D0A',
  done: '#16A34A',

  ok: '#22C55E',
  warn: '#EAB308',
  danger: '#EF4444',
} as const;

/** 사용률 게이지 색: 70% 미만 초록, 70~89% 노랑, 90% 이상 빨강. */
export function gaugeColor(percent: number): string {
  if (percent >= 90) return COLOR.danger;
  if (percent >= 70) return COLOR.warn;
  return COLOR.ok;
}
