// 입력 대기 집계 키 이미지 (196 x 196). 1개 이상이면 주황으로 강조한다.
import { COLOR } from './theme.ts';
import { FONT_NUMBER, KEY_SIZE, panel, svgDoc, text } from './svg.ts';

export interface WaitingCountInput {
  count: number;
}

export function renderWaitingCount({ count }: WaitingCountInput): string {
  const active = count > 0;
  const value = count > 99 ? '99+' : String(Math.max(0, Math.floor(count)));
  const size = value.length >= 3 ? 64 : value.length === 2 ? 80 : 92;

  const parts = [
    panel(COLOR.panel, active ? COLOR.waiting : COLOR.border),
    text(98, 122, value, { size, fill: active ? COLOR.waiting : COLOR.faint, family: FONT_NUMBER, weight: 700 }),
    text(98, 168, '입력 대기', { size: 22, fill: active ? COLOR.text : COLOR.muted, weight: 700 }),
  ];
  return svgDoc(KEY_SIZE, KEY_SIZE, parts.join(''));
}
