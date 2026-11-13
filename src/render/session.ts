// 세션 슬롯 키 이미지 (196 x 196). 상태는 문구 없이 점·테두리·배경색으로만 나타낸다.
// 대기: 회색 점, 작업 중: 파란 테두리 + 파란 점 깜빡임, 입력 대기: 주황 배경 깜빡임 + 주황 점,
// 완료: 초록 배경, 오류: 빨간 테두리 + 빨간 점, 빈 슬롯: 빈 아이콘.
// 글자는 폴더 이름(굵게)과, 있으면 그 아래 짧은 세션 제목.
import { COLOR } from './theme.ts';
import { fitLabel, fitOneLine, fitWrapped } from './label.ts';
import { KEY_SIZE, panel, svgDoc, text } from './svg.ts';

export type SessionStatus = 'empty' | 'idle' | 'working' | 'waiting' | 'done' | 'error';

export interface SessionTileInput {
  status: SessionStatus;
  label?: string;
  /** 폴더 이름 아래 작게 붙는 세션 제목. */
  subtitle?: string;
  /** 깜빡임의 꺼진 단계. 작업 중은 점이, 입력 대기는 배경이 어두워진다. */
  dim?: boolean;
  /** 강제 종료하려고 누르고 있는 진행률(0~1). 빨간 테두리가 시계 방향으로 차오른다. */
  hold?: number;
}

const LABEL_MAX_WIDTH = 164;
/** 라벨 블록의 세로 중심. 오른쪽 위 상태 점을 피해 가운데(98)보다 조금 아래로 둔다. */
const LABEL_CENTER_Y = 104;
const TITLE_SIZES = [28, 26, 24, 22, 20];
const SUBTITLE_SIZES = [22, 21, 20];
const SUBTITLE_MAX_LINES = 2;

interface Palette {
  fill: string;
  stroke: string;
  label: string;
  dot?: string;
}

function palette(status: Exclude<SessionStatus, 'empty'>, dim: boolean): Palette {
  switch (status) {
    // 대기·작업 중·입력 대기(꺼진 단계)·오류는 패널을 채우지 않아 검은 바탕 그대로 보인다.
    case 'idle':
      return { fill: 'none', stroke: COLOR.idle, label: COLOR.text, dot: COLOR.idle };
    case 'working':
      // 꺼지는 단계에서는 점을 그리지 않아 파란 점만 깜빡인다.
      return { fill: 'none', stroke: COLOR.working, label: COLOR.text, dot: dim ? undefined : COLOR.working };
    case 'waiting':
      // 점은 항상 주황. 배경이 밝은 주황일 때는 배경에 묻힌다.
      return dim
        ? { fill: 'none', stroke: COLOR.waiting, label: COLOR.text, dot: COLOR.waiting }
        : { fill: COLOR.waiting, stroke: COLOR.waiting, label: COLOR.dark, dot: COLOR.waiting };
    case 'done':
      return { fill: COLOR.done, stroke: COLOR.done, label: COLOR.text };
    case 'error':
      return { fill: 'none', stroke: COLOR.error, label: COLOR.text, dot: COLOR.error };
  }
}

export function renderSessionTile({ status, label, subtitle, dim = false, hold }: SessionTileInput): string {
  if (status === 'empty') {
    // 빈 슬롯은 패널 없이 검은 바탕에 점선 원 아이콘만 둔다.
    const emptyIcon = `<circle cx="98" cy="98" r="22" fill="none" stroke="${COLOR.empty}" stroke-width="4" stroke-dasharray="7 7"/>`;
    return svgDoc(KEY_SIZE, KEY_SIZE, `<rect width="${KEY_SIZE}" height="${KEY_SIZE}" fill="#000000"/>` + emptyIcon);
  }

  const body = (fill: string) => (subtitle?.trim() ? labelWithSubtitle(label ?? '', subtitle, fill) : labelOnly(label ?? '', fill));

  // 강제 종료하려고 누르고 있는 동안: 빨간 테두리에 빨간 면이 아래에서 차오르고, 이름은 흰 글자로 계속 보인다.
  if (hold !== undefined) {
    return svgDoc(KEY_SIZE, KEY_SIZE, panel('none', COLOR.error) + holdFill(hold) + body(COLOR.text));
  }

  const p = palette(status, dim);
  const dot = p.dot ? `<circle cx="162" cy="36" r="12" fill="${p.dot}"/>` : '';
  return svgDoc(KEY_SIZE, KEY_SIZE, panel(p.fill, p.stroke) + dot + body(p.label));
}

/** 패널(184x184, 모서리 24) 안에서 진행률만큼 아래부터 차오르는 빨간 면. */
function holdFill(hold: number): string {
  const side = KEY_SIZE - 12;
  const height = Math.max(1, side * Math.max(0, Math.min(1, hold)));
  return `<rect x="6" y="${(6 + side - height).toFixed(1)}" width="${side}" height="${height.toFixed(1)}" rx="24" fill="${COLOR.error}" fill-opacity="0.85"/>`;
}

/** 폴더 이름만: 한두 줄로 세로 가운데. */
function labelOnly(label: string, fill: string): string {
  const fitted = fitLabel(label, LABEL_MAX_WIDTH);
  const lineHeight = Math.round(fitted.size * 1.2);
  // 글자 크기의 약 0.35배를 더하면 기준선이 블록 중심에 맞는다.
  const firstBaseline = Math.round(LABEL_CENTER_Y - ((fitted.lines.length - 1) * lineHeight) / 2 + fitted.size * 0.35);
  return fitted.lines
    .map((line, i) => text(98, firstBaseline + i * lineHeight, line, { size: fitted.size, fill, weight: 700 }))
    .join('');
}

/** 폴더 이름 한 줄과 그 아래 제목 최대 두 줄. 블록 전체를 세로 가운데에 둔다. */
function labelWithSubtitle(label: string, subtitle: string, fill: string): string {
  const title = fitOneLine(label, LABEL_MAX_WIDTH, TITLE_SIZES);
  const sub = fitWrapped(subtitle, LABEL_MAX_WIDTH, SUBTITLE_SIZES, SUBTITLE_MAX_LINES);
  const gap = 8;
  const subLineHeight = Math.round(sub.size * 1.2);
  const blockHeight = title.size + gap + sub.lines.length * subLineHeight;
  const top = LABEL_CENTER_Y - blockHeight / 2;
  const titleBaseline = Math.round(top + title.size * 0.85);
  const subTop = top + title.size + gap;
  return (
    text(98, titleBaseline, title.lines[0] ?? '', { size: title.size, fill, weight: 700 }) +
    sub.lines
      .map((line, i) => text(98, Math.round(subTop + i * subLineHeight + sub.size * 0.85), line, { size: sub.size, fill, opacity: 0.8 }))
      .join('')
  );
}
