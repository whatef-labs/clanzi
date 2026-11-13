// 세션 슬롯 키 이미지 (196 x 196).
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

const STATUS_TEXT: Record<Exclude<SessionStatus, 'empty'>, string> = {
  idle: '대기',
  working: '작업 중',
  waiting: '입력 대기',
  done: '완료',
};

const LABEL_MAX_WIDTH = 164;

interface Palette {
  fill: string;
  stroke: string;
  label: string;
  status: string;
  dot?: string;
}

function palette(status: Exclude<SessionStatus, 'empty'>, dim: boolean): Palette {
  switch (status) {
    case 'idle':
      return { fill: COLOR.panel, stroke: COLOR.border, label: COLOR.text, status: COLOR.muted, dot: COLOR.idle };
    case 'working':
      return { fill: COLOR.panel, stroke: COLOR.border, label: COLOR.text, status: COLOR.working, dot: COLOR.working };
    case 'waiting':
      return dim
        ? { fill: COLOR.waitingDim, stroke: COLOR.waiting, label: COLOR.waiting, status: COLOR.waiting }
        : { fill: COLOR.waiting, stroke: COLOR.waiting, label: COLOR.dark, status: COLOR.dark };
    case 'done':
      return { fill: COLOR.done, stroke: COLOR.done, label: COLOR.text, status: COLOR.text };
  }
}

export function renderSessionTile({ status, slot, label, dim = false }: SessionTileInput): string {
  if (status === 'empty') {
    return svgDoc(KEY_SIZE, KEY_SIZE, panel(COLOR.panel, COLOR.border) + slotNumber(slot, COLOR.faint));
  }

  const p = palette(status, dim);
  const fitted = fitLabel(label ?? '', LABEL_MAX_WIDTH);
  const lineHeight = Math.round(fitted.size * 1.2);
  const firstBaseline = fitted.lines.length === 1 ? 114 : 100;
  const labelSvg = fitted.lines
    .map((line, i) => text(98, firstBaseline + i * lineHeight, line, { size: fitted.size, fill: p.label, weight: 700 }))
    .join('');

  const slotColor = status === 'waiting' && !dim ? COLOR.dark : status === 'done' ? COLOR.text : COLOR.faint;
  const parts = [
    panel(p.fill, p.stroke),
    slotNumber(slot, slotColor),
    p.dot ? `<circle cx="162" cy="38" r="11" fill="${p.dot}"/>` : '',
    labelSvg,
    text(98, 168, STATUS_TEXT[status], { size: 20, fill: p.status, weight: 700 }),
  ];
  return svgDoc(KEY_SIZE, KEY_SIZE, parts.join(''));
}

function slotNumber(slot: number, fill: string): string {
  return text(26, 44, String(slot), { size: 20, fill, family: FONT_NUMBER, weight: 600, anchor: 'start' });
}
