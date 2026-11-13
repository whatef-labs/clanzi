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

/** 한 줄로만 맞춘다. 가장 작은 크기에서도 넘치면 말줄임한다. */
export function fitOneLine(text: string, maxWidth: number, sizes: readonly number[]): FittedLabel {
  const clean = text.trim() || '?';
  for (const size of sizes) {
    if (estimateWidth(clean, size) <= maxWidth) return { lines: [clean], size };
  }
  const size = sizes[sizes.length - 1] ?? MIN_SIZE;
  return { lines: [truncate(clean, (s) => estimateWidth(s, size) <= maxWidth)], size };
}

/**
 * 공백 단위로 줄을 바꿔 maxLines 안에 넣는다. 들어가는 가장 큰 크기를 고르고,
 * 가장 작은 크기에서도 넘치면 마지막 줄을 말줄임한다. 한 단어가 한 줄보다 길면 글자 단위로 자른다.
 */
export function fitWrapped(text: string, maxWidth: number, sizes: readonly number[], maxLines: number): FittedLabel {
  const clean = text.trim().replace(/\s+/g, ' ') || '?';
  for (const size of sizes) {
    const lines = wrap(clean, (s) => estimateWidth(s, size) <= maxWidth);
    if (lines.length <= maxLines) return { lines, size };
  }
  const size = sizes[sizes.length - 1] ?? MIN_SIZE;
  const fits = (s: string) => estimateWidth(s, size) <= maxWidth;
  const lines = wrap(clean, fits);
  const kept = lines.slice(0, maxLines - 1);
  kept.push(truncate(lines.slice(maxLines - 1).join(' '), fits));
  return { lines: kept, size };
}

function wrap(text: string, fits: (s: string) => boolean): string[] {
  const lines: string[] = [];
  let current = '';
  for (let word of text.split(' ')) {
    const candidate = current ? current + ' ' + word : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    // 한 줄보다 긴 단어는 들어가는 만큼씩 잘라 낸다
    while (!fits(word)) {
      const head = firstLine(word, fits);
      lines.push(head);
      word = word.slice(head.length);
    }
    current = word;
  }
  if (current) lines.push(current);
  return lines;
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
