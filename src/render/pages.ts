// 노브 화면(D200X 노브 슬롯)의 세션 페이지 표시. 내장 레이아웃 $UA1의 아이콘 칸(100 x 100)에 들어간다.
import { COLOR } from './theme.ts';
import { FONT_NUMBER, svgDoc, text } from './svg.ts';

export interface PageIconInput {
  /** 0부터 */
  page: number;
  pageCount: number;
}

const SIZE = 100;
const MAX_DOTS = 6;

export function renderPageIcon({ page, pageCount }: PageIconInput): string {
  const single = pageCount <= 1;
  const number = text(SIZE / 2, 54, `${page + 1}/${pageCount}`, { size: 34, fill: single ? COLOR.empty : COLOR.text, family: FONT_NUMBER, weight: 700 });
  const dots = Math.min(pageCount, MAX_DOTS);
  const gap = 14;
  const start = SIZE / 2 - ((dots - 1) * gap) / 2;
  const dotSvg = Array.from({ length: dots }, (_, i) =>
    `<circle cx="${start + i * gap}" cy="78" r="4" fill="${i === Math.min(page, MAX_DOTS - 1) ? COLOR.text : COLOR.empty}"/>`).join('');
  return svgDoc(SIZE, SIZE, `<rect width="${SIZE}" height="${SIZE}" fill="#000000"/>` + number + dotSvg);
}
