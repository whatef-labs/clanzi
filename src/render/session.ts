// 세션 슬롯 키 이미지 (196 x 196). 상태는 문구 없이 색과 깜빡임으로만 나타낸다.
// 대기: 회색 점, 작업 중: 파란 점, 입력 대기: 주황 배경(깜빡임), 완료: 초록 배경.
import { COLOR } from './theme.ts';
import { fitLabel } from './label.ts';
import { FONT_NUMBER, KEY_SIZE, panel, svgDoc, text } from './svg.ts';

export type SessionStatus = 'empty' | 'idle' | 'working' | 'waiting' | 'done';

export interface SessionTileInput {
  status: SessionStatus;
  /** 키 위치로 정한 슬롯 번호(1부터). */
  slot: number;
  label?: string;
  /** 입력 대기 깜빡임의 꺼진 단계. */
  dim?: boolean;
}

const LABEL_MAX_WIDTH = 164;
/** 라벨 블록의 세로 중심. 위쪽에 슬롯 번호와 상태 점이 있어 가운데(98)보다 조금 아래로 둔다. */
const LABEL_CENTER_Y = 106;

interface Palette {
  fill: string;
  stroke: string;
  label: string;
  slot: string;
  dot?: string;
}

function palette(status: Exclude<SessionStatus, 'empty'>, dim: boolean): Palette {
  switch (status) {
    case 'idle':
      return { fill: COLOR.panel, stroke: COLOR.border, label: COLOR.text, slot: COLOR.faint, dot: COLOR.idle };
    case 'working':
      return { fill: COLOR.panel, stroke: COLOR.border, label: COLOR.text, slot: COLOR.faint, dot: COLOR.working };
    case 'waiting':
      return dim
        ? { fill: COLOR.waitingDim, stroke: COLOR.waiting, label: COLOR.waiting, slot: COLOR.waiting }
        : { fill: COLOR.waiting, stroke: COLOR.waiting, label: COLOR.dark, slot: COLOR.dark };
    case 'done':
      return { fill: COLOR.done, stroke: COLOR.done, label: COLOR.text, slot: COLOR.text };
  }
}

export function renderSessionTile({ status, slot, label, dim = false }: SessionTileInput): string {
  if (status === 'empty') {
    return svgDoc(KEY_SIZE, KEY_SIZE, panel(COLOR.panel, COLOR.border) + slotNumber(slot, COLOR.faint));
  }

  const p = palette(status, dim);
  const fitted = fitLabel(label ?? '', LABEL_MAX_WIDTH);
  const lineHeight = Math.round(fitted.size * 1.2);
  // 글자 높이의 약 0.35배를 더하면 기준선이 블록 중심에 맞는다.
  const firstBaseline = Math.round(LABEL_CENTER_Y - ((fitted.lines.length - 1) * lineHeight) / 2 + fitted.size * 0.35);
  const labelSvg = fitted.lines
    .map((line, i) => text(98, firstBaseline + i * lineHeight, line, { size: fitted.size, fill: p.label, weight: 700 }))
    .join('');

  const parts = [
    panel(p.fill, p.stroke),
    slotNumber(slot, p.slot),
    p.dot ? `<circle cx="162" cy="38" r="12" fill="${p.dot}"/>` : '',
    labelSvg,
  ];
  return svgDoc(KEY_SIZE, KEY_SIZE, parts.join(''));
}

function slotNumber(slot: number, fill: string): string {
  return text(26, 44, String(slot), { size: 20, fill, family: FONT_NUMBER, weight: 600, anchor: 'start' });
}
