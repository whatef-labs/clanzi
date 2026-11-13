// 세션 슬롯 키 이미지 (196 x 196). 상태는 문구 없이 배경색과 움직임으로만 나타낸다.
// 대기: 이름만, 작업 중: 파란 배경 펄스, 입력 대기: 주황 배경 깜빡임, 완료: 초록 배경, 빈 슬롯: 빈 아이콘.
import { COLOR, mixColor } from './theme.ts';
import { fitLabel } from './label.ts';
import { KEY_SIZE, panel, svgDoc, text } from './svg.ts';

export type SessionStatus = 'empty' | 'idle' | 'working' | 'waiting' | 'done';

export interface SessionTileInput {
  status: SessionStatus;
  label?: string;
  /** 작업 중 펄스 세기(0~1). */
  pulse?: number;
  /** 입력 대기 깜빡임의 꺼진 단계. */
  dim?: boolean;
}

const LABEL_MAX_WIDTH = 164;
const LABEL_CENTER_Y = 98;

interface Palette {
  fill: string;
  stroke: string;
  label: string;
}

function palette(status: Exclude<SessionStatus, 'empty'>, pulse: number, dim: boolean): Palette {
  switch (status) {
    case 'idle':
      return { fill: COLOR.panel, stroke: COLOR.border, label: COLOR.text };
    case 'working': {
      const fill = mixColor(COLOR.workingLow, COLOR.workingHigh, pulse);
      return { fill, stroke: fill, label: COLOR.text };
    }
    case 'waiting':
      return dim
        ? { fill: COLOR.waitingDim, stroke: COLOR.waiting, label: COLOR.waiting }
        : { fill: COLOR.waiting, stroke: COLOR.waiting, label: COLOR.dark };
    case 'done':
      return { fill: COLOR.done, stroke: COLOR.done, label: COLOR.text };
  }
}

export function renderSessionTile({ status, label, pulse = 0, dim = false }: SessionTileInput): string {
  if (status === 'empty') {
    const emptyIcon = `<circle cx="98" cy="98" r="22" fill="none" stroke="${COLOR.faint}" stroke-width="4" stroke-dasharray="7 7"/>`;
    return svgDoc(KEY_SIZE, KEY_SIZE, panel(COLOR.panel, COLOR.border) + emptyIcon);
  }

  const p = palette(status, pulse, dim);
  const fitted = fitLabel(label ?? '', LABEL_MAX_WIDTH);
  const lineHeight = Math.round(fitted.size * 1.2);
  // 글자 크기의 약 0.35배를 더하면 기준선이 블록 중심에 맞는다.
  const firstBaseline = Math.round(LABEL_CENTER_Y - ((fitted.lines.length - 1) * lineHeight) / 2 + fitted.size * 0.35);
  const labelSvg = fitted.lines
    .map((line, i) => text(98, firstBaseline + i * lineHeight, line, { size: fitted.size, fill: p.label, weight: 700 }))
    .join('');

  return svgDoc(KEY_SIZE, KEY_SIZE, panel(p.fill, p.stroke) + labelSvg);
}
