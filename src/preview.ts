// 렌더러 미리보기 샘플. 브라우저 미리보기(scripts/preview.ts)와 실기기 미리보기 모드(app.ts)가 함께 쓴다.
import { renderSessionTile } from './render/session.ts';
import type { SessionTileInput } from './render/session.ts';
import { renderUsageGauge } from './render/usage.ts';
import type { UsageGaugeInput } from './render/usage.ts';
import { renderWaitingCount } from './render/waiting.ts';

export type SessionPreview = Omit<SessionTileInput, 'slot' | 'dim'>;

export const SESSION_PREVIEW: SessionPreview[] = [
  { status: 'empty' },
  { status: 'idle', label: 'clanzi' },
  { status: 'working', label: 'passtrue-api-server' },
  { status: 'waiting', label: 'fms-api' },
  { status: 'done', label: '고객관리 리뉴얼' },
  { status: 'working', label: 'a-very-long-project-directory-name' },
];

export const USAGE_PREVIEW: UsageGaugeInput[] = [
  { fiveHour: 34, sevenDay: 61, caption: '2h 10m' },
  { fiveHour: 75, sevenDay: 91, caption: '48m' },
  { fiveHour: 100, sevenDay: 40, caption: '<1m' },
  { fiveHour: null, sevenDay: null },
  { fiveHour: 8, sevenDay: 22 },
];

export const WAITING_PREVIEW: number[] = [0, 2, 12];

export interface PreviewSample {
  name: string;
  svg: string;
}

export const PREVIEW_SAMPLES: PreviewSample[] = [
  ...SESSION_PREVIEW.map((s, i) => ({ name: `${s.status} ${s.label ?? ''}`, svg: renderSessionTile({ ...s, slot: i + 1 }) })),
  { name: 'waiting (dim)', svg: renderSessionTile({ status: 'waiting', label: 'fms-api', slot: 4, dim: true }) },
  ...USAGE_PREVIEW.map((u) => ({ name: `usage ${u.fiveHour ?? '--'} / ${u.sevenDay ?? '--'}`, svg: renderUsageGauge(u) })),
  ...WAITING_PREVIEW.map((count) => ({ name: `waiting ${count}`, svg: renderWaitingCount({ count }) })),
];
