// clanzi 메인 서비스. Ulanzi Studio가 내장 Node로 실행한다.
// 현재는 3단계 확인용 미리보기 모드: 키마다 렌더러 샘플을 그리고, 키를 누르면 다음 샘플로 넘긴다.
import { join } from 'node:path';
import UlanziApi, { Utils } from './vendor/ulanzi-api/index.js';
import type { ActionMessage } from './vendor/ulanzi-api/index.js';
import { createLogger } from './log.ts';
import { toDataUri } from './render/svg.ts';
import { renderSessionTile } from './render/session.ts';
import { renderUsageGauge } from './render/usage.ts';
import { SESSION_PREVIEW, USAGE_PREVIEW } from './preview.ts';

const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.clanzi';
/** 애니메이션 프레임 간격. 작업 중 펄스와 입력 대기 깜빡임이 같은 타이머를 쓴다. */
const FRAME_MS = 100;
const PULSE_PERIOD_MS = 2000;
const BLINK_MS = 600;

// SDK는 주고받는 메시지를 이미지 본문까지 콘솔에 남긴다. 애니메이션 프레임마다 쌓이지 않게 끈다.
if (!process.env.CLANZI_DEBUG) {
  console.log = () => {};
  console.warn = () => {};
}

type ActionKind = 'session' | 'usage' | 'unknown';

interface KeyState {
  kind: ActionKind;
  key: string;
  slot: number;
  active: boolean;
  sample: number;
  lastImage: string;
}

const pluginPath = Utils.getPluginPath();
const log = createLogger(join(pluginPath, 'logs'));
const keys = new Map<string, KeyState>();

log('start', { node: process.version, pluginPath });

const $UD = new UlanziApi();
$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => log('connected', { language: $UD.language }));
// SDK는 다시 연결하지 않는다. Studio가 다음 실행 때 플러그인을 새로 띄우므로 연결이 끊기면 끝낸다.
$UD.onClose(() => {
  log('closed');
  process.exit(0);
});
$UD.onError((error) => log('error', error));

$UD.onAdd((msg) => {
  const state = upsert(msg);
  log('add', { context: msg.context, kind: state.kind, key: msg.key, slot: state.slot });
  draw(msg.context, state);
});

$UD.onSetActive((msg) => {
  const state = upsert(msg);
  const changed = state.active !== msg.active;
  state.active = msg.active;
  if (changed) log('setactive', { context: msg.context, active: msg.active });
  if (msg.active) draw(msg.context, state, true);
});

$UD.onRun((msg) => {
  const state = upsert(msg);
  state.sample += 1;
  log('run', { context: msg.context, sample: state.sample });
  draw(msg.context, state);
});

$UD.onClear((msg) => {
  for (const item of msg.param ?? []) {
    keys.delete(item.context);
    log('clear', { context: item.context });
  }
});

$UD.onDialRotate((msg) => log('dialrotate', { context: msg.context, rotateEvent: msg.rotateEvent }));

// 움직이는 키(작업 중 펄스, 입력 대기 깜빡임)만 프레임마다 다시 그린다. 모든 키가 같은 위상으로 움직인다.
setInterval(() => {
  for (const [context, state] of keys) {
    if (isAnimated(state)) draw(context, state);
  }
}, FRAME_MS).unref();

function upsert(msg: ActionMessage): KeyState {
  let state = keys.get(msg.context);
  if (!state) {
    const slot = slotFromKey(msg.key);
    state = { kind: kindOf(msg.uuid), key: msg.key, slot, active: true, sample: Math.max(0, slot - 1), lastImage: '' };
    keys.set(msg.context, state);
  }
  return state;
}

function kindOf(uuid: string): ActionKind {
  const name = uuid.startsWith(PLUGIN_UUID + '.') ? uuid.slice(PLUGIN_UUID.length + 1) : '';
  return name === 'session' || name === 'usage' ? name : 'unknown';
}

/** 키 이름 '열_행'을 왼쪽 위부터 1로 시작하는 번호로 바꾼다. D200X는 한 줄에 5키. */
function slotFromKey(key: string): number {
  const [col, row] = key.split('_').map(Number);
  if (col === undefined || row === undefined || Number.isNaN(col) || Number.isNaN(row)) return 0;
  return row * 5 + col + 1;
}

function pick<T>(list: readonly T[], index: number): T {
  return list[index % list.length] as T;
}

function isAnimated(state: KeyState): boolean {
  if (state.kind !== 'session') return false;
  const status = pick(SESSION_PREVIEW, state.sample).status;
  return status === 'working' || status === 'waiting';
}

/** 0→1→0으로 부드럽게 오가는 펄스 세기. */
function pulseAt(now: number): number {
  return (1 - Math.cos((2 * Math.PI * (now % PULSE_PERIOD_MS)) / PULSE_PERIOD_MS)) / 2;
}

function render(state: KeyState): string {
  const now = Date.now();
  switch (state.kind) {
    case 'session':
      return renderSessionTile({
        ...pick(SESSION_PREVIEW, state.sample),
        pulse: pulseAt(now),
        dim: Math.floor(now / BLINK_MS) % 2 === 1,
      });
    case 'usage':
      return renderUsageGauge(pick(USAGE_PREVIEW, state.sample));
    default:
      return renderSessionTile({ status: 'empty' });
  }
}

/** 이미지가 바뀐 경우에만 보낸다. force는 키가 다시 활성화돼 화면을 새로 그려야 할 때 쓴다. */
function draw(context: string, state: KeyState, force = false): void {
  if (!state.active) return;
  const image = toDataUri(render(state));
  if (!force && image === state.lastImage) return;
  state.lastImage = image;
  $UD.setBaseDataIcon(context, image, '');
}
