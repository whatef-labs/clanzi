// 세션 라벨을 키 폭에 맞춰 한두 줄로 나누고 글자 크기를 정한다.
// 우선순위: 한 줄 → 구분자(-_. 공백)에서 두 줄 → 글자 단위 두 줄 → 둘째 줄 말줄임.
import { estimateWidth } from './svg.ts';

export interface FittedLabel {
  lines: string[];
  size: number;
}

const ONE_LINE_SIZES = [34, 32, 30, 28, 26, 24];
const TWO_LINE_SIZES = [26, 24, 22, 20];
const MIN_SIZE = 18;
const ELLIPSIS = '…';
const SEPARATOR = /[-_. ]/;

export function fitLabel(label: string, maxWidth: number): FittedLabel {
  const clean = label.trim() || '?';
  const fits = (s: string, size: number) => estimateWidth(s, size) <= maxWidth;

  for (const size of ONE_LINE_SIZES) {
    if (fits(clean, size)) return { lines: [clean], size };
  }
  for (const size of [...TWO_LINE_SIZES, MIN_SIZE]) {
    const split = bestSplit(clean, (a, b) => fits(a, size) && fits(b, size), true);
    if (split) return { lines: split, size };
  }
  for (const size of TWO_LINE_SIZES) {
    const split = bestSplit(clean, (a, b) => fits(a, size) && fits(b, size), false);
    if (split) return { lines: split, size };
  }

  const first = firstLine(clean, (s) => fits(s, MIN_SIZE));
  const rest = clean.slice(first.length).trim();
  return { lines: [first.trim(), truncate(rest, (s) => fits(s, MIN_SIZE))], size: MIN_SIZE };
}

/** 두 줄 길이가 가장 비슷한 분할을 고른다. separatorOnly면 구분자 바로 뒤에서만 나눈다. */
function bestSplit(text: string, ok: (a: string, b: string) => boolean, separatorOnly: boolean): string[] | null {
  const chars = [...text];
  let best: { lines: string[]; diff: number } | null = null;
  for (let i = 1; i < chars.length; i++) {
    if (separatorOnly && !SEPARATOR.test(chars[i - 1] ?? '')) continue;
    const a = chars.slice(0, i).join('').trim();
    const b = chars.slice(i).join('').trim();
    if (!a || !b || !ok(a, b)) continue;
    const diff = Math.abs(a.length - b.length);
    if (!best || diff < best.diff) best = { lines: [a, b], diff };
  }
  return best?.lines ?? null;
}

/** 폭에 들어가는 가장 긴 앞부분. 가능하면 마지막 구분자 뒤에서 끊는다. */
function firstLine(text: string, fits: (s: string) => boolean): string {
  const chars = [...text];
  let end = 0;
  while (end < chars.length && fits(chars.slice(0, end + 1).join(''))) end++;
  const prefix = chars.slice(0, Math.max(1, end));
  for (let i = prefix.length - 1; i > 0; i--) {
    if (SEPARATOR.test(prefix[i] ?? '')) return prefix.slice(0, i + 1).join('');
  }
  return prefix.join('');
}

function truncate(text: string, fits: (s: string) => boolean): string {
  if (fits(text)) return text;
  const chars = [...text];
  let out = '';
  for (const ch of chars) {
    if (!fits(out + ch + ELLIPSIS)) break;
    out += ch;
  }
  return out + ELLIPSIS;
}
