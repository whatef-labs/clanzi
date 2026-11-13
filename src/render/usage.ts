// 사용량 키 이미지 (196 x 196): 바깥 링 5시간 한도, 안쪽 링 주간 한도, 중앙 숫자 5시간 사용률.
import { COLOR, gaugeColor } from './theme.ts';
import { FONT_NUMBER, KEY_SIZE, estimateWidth, panel, ring, svgDoc, text } from './svg.ts';

export interface UsageGaugeInput {
  /** 0~100. 값이 없으면 null(첫 응답 전, 창 만료 후). */
  fiveHour: number | null;
  sevenDay: number | null;
  /** 중앙 숫자 아래 보조 문구. 예: 5시간 리셋까지 남은 시간. */
  caption?: string;
}

const CX = 98;
const CY = 98;
const OUTER = { r: 74, width: 14 };
const INNER = { r: 52, width: 12 };
const CENTER_MAX_WIDTH = 84;

export function renderUsageGauge({ fiveHour, sevenDay, caption }: UsageGaugeInput): string {
  const center = fiveHour === null ? '--' : `${fiveHour}%`;
  const size = fitSize(center, 40, 26);
  const hasCaption = Boolean(caption) && fiveHour !== null;
  const baseline = hasCaption ? 106 : 112;

  const parts = [
    panel(COLOR.panel, COLOR.border),
    ring(CX, CY, OUTER.r, OUTER.width, fiveHour === null ? null : fiveHour / 100, gaugeColor(fiveHour ?? 0), COLOR.track),
    ring(CX, CY, INNER.r, INNER.width, sevenDay === null ? null : sevenDay / 100, gaugeColor(sevenDay ?? 0), COLOR.track),
    text(CX, baseline, center, { size, fill: fiveHour === null ? COLOR.muted : COLOR.text, family: FONT_NUMBER, weight: 700 }),
    hasCaption ? text(CX, 130, caption ?? '', { size: 16, fill: COLOR.muted, family: FONT_NUMBER, weight: 600 }) : '',
  ];
  return svgDoc(KEY_SIZE, KEY_SIZE, parts.join(''));
}

function fitSize(content: string, max: number, min: number): number {
  for (let size = max; size > min; size -= 2) {
    if (estimateWidth(content, size) <= CENTER_MAX_WIDTH) return size;
  }
  return min;
}
