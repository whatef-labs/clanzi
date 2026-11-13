// 세션 슬롯 키 이미지 (196 x 196). 상태는 문구 없이 점·테두리·배경색으로만 나타낸다.
// 대기: 회색 점, 작업 중: 파란 테두리 + 파란 점 깜빡임, 입력 대기: 주황 배경 깜빡임 + 주황 점,
// 완료: 초록 배경, 빈 슬롯: 빈 아이콘.
import { COLOR } from './theme.ts';
import { fitLabel } from './label.ts';
import { KEY_SIZE, panel, svgDoc, text } from './svg.ts';

export type SessionStatus = 'empty' | 'idle' | 'working' | 'waiting' | 'done';

export interface SessionTileInput {
  status: SessionStatus;
  label?: string;
  /** 깜빡임의 꺼진 단계. 작업 중은 점이, 입력 대기는 배경이 어두워진다. */
  dim?: boolean;
}

const LABEL_MAX_WIDTH = 164;
/** 라벨 블록의 세로 중심. 오른쪽 위 상태 점을 피해 가운데(98)보다 조금 아래로 둔다. */
const LABEL_CENTER_Y = 104;

interface Palette {
  fill: string;
  stroke: string;
  label: string;
  dot?: string;
}

function palette(status: Exclude<SessionStatus, 'empty'>, dim: boolean): Palette {
  switch (status) {
    case 'idle':
      return { fill: COLOR.panel, stroke: COLOR.border, label: COLOR.text, dot: COLOR.idle };
    case 'working':
      // 꺼지는 단계에서는 점을 그리지 않아 파란 점만 깜빡인다.
      return { fill: COLOR.panel, stroke: COLOR.working, label: COLOR.text, dot: dim ? undefined : COLOR.working };
    case 'waiting':
      // 점은 항상 주황. 배경이 밝은 주황일 때는 배경에 묻힌다.
      return dim
        ? { fill: COLOR.waitingDim, stroke: COLOR.waiting, label: COLOR.waiting, dot: COLOR.waiting }
        : { fill: COLOR.waiting, stroke: COLOR.waiting, label: COLOR.dark, dot: COLOR.waiting };
    case 'done':
      return { fill: COLOR.done, stroke: COLOR.done, label: COLOR.text };
  }
}

export function renderSessionTile({ status, label, dim = false }: SessionTileInput): string {
  if (status === 'empty') {
    const emptyIcon = `<circle cx="98" cy="98" r="22" fill="none" stroke="${COLOR.faint}" stroke-width="4" stroke-dasharray="7 7"/>`;
    return svgDoc(KEY_SIZE, KEY_SIZE, panel(COLOR.panel, COLOR.border) + emptyIcon);
  }

  const p = palette(status, dim);
  const fitted = fitLabel(label ?? '', LABEL_MAX_WIDTH);
  const lineHeight = Math.round(fitted.size * 1.2);
  // 글자 크기의 약 0.35배를 더하면 기준선이 블록 중심에 맞는다.
  const firstBaseline = Math.round(LABEL_CENTER_Y - ((fitted.lines.length - 1) * lineHeight) / 2 + fitted.size * 0.35);
  const labelSvg = fitted.lines
    .map((line, i) => text(98, firstBaseline + i * lineHeight, line, { size: fitted.size, fill: p.label, weight: 700 }))
    .join('');
  const dot = p.dot ? `<circle cx="162" cy="36" r="12" fill="${p.dot}"/>` : '';

  return svgDoc(KEY_SIZE, KEY_SIZE, panel(p.fill, p.stroke) + dot + labelSvg);
}
