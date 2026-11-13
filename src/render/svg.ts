// SVG 조립 도우미. Studio의 SVG 렌더러(Qt 계열)가 확실히 그리는 기본 요소만 쓴다:
// rect·circle·text·line, text-anchor, stroke-dasharray, transform rotate. dominant-baseline과 <style>은 쓰지 않는다.

export const KEY_SIZE = 196;

export const FONT_TEXT = 'Malgun Gothic';
export const FONT_NUMBER = 'Segoe UI';

export function svgDoc(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

export function toDataUri(svg: string): string {
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export interface TextOptions {
  size: number;
  fill: string;
  weight?: number;
  family?: string;
  anchor?: 'start' | 'middle' | 'end';
  /** 0~1 */
  opacity?: number;
}

/** y는 글자 기준선(baseline)이다. */
export function text(x: number, y: number, content: string, o: TextOptions): string {
  const weight = o.weight ? ` font-weight="${o.weight}"` : '';
  const opacity = o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : '';
  return `<text x="${x}" y="${y}" font-family="${o.family ?? FONT_TEXT}" font-size="${o.size}"${weight} fill="${o.fill}"${opacity} text-anchor="${o.anchor ?? 'middle'}">${esc(content)}</text>`;
}

/** 키 전체를 덮는 검정 바탕과 둥근 패널. */
export function panel(fill: string, stroke: string, size = KEY_SIZE): string {
  return `<rect width="${size}" height="${size}" fill="#000000"/><rect x="6" y="6" width="${size - 12}" height="${size - 12}" rx="24" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
}

/**
 * 12시 방향에서 시계 방향으로 채우는 원형 progress. ratio는 0~1.
 * 0이면 둥근 끝(round cap)이 점으로 보이지 않도록 채움 원호를 생략한다.
 */
export function ring(cx: number, cy: number, r: number, width: number, ratio: number | null, color: string, track: string): string {
  const base = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${track}" stroke-width="${width}"/>`;
  if (ratio === null || ratio <= 0) return base;
  const c = 2 * Math.PI * r;
  const filled = Math.min(1, ratio) * c;
  return base + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${filled.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
}

/**
 * 글자 폭 근사치(px). 폰트 측정 없이 줄바꿈·크기 조절에 쓴다.
 * 한글·한자 등 넓은 글자는 1em, 라틴 대문자·숫자는 0.62em, 나머지는 0.52em으로 본다.
 */
export function estimateWidth(content: string, size: number): number {
  let em = 0;
  for (const ch of content) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x1100 && isWide(code)) em += 1;
    else if (/[A-Z0-9MW@#%&]/.test(ch)) em += 0.62;
    else if (/[il.,:;'|!]/.test(ch)) em += 0.3;
    else em += 0.52;
  }
  return em * size;
}

function isWide(code: number): boolean {
  return (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6);
}
