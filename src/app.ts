// clanzi 메인 서비스. Ulanzi Studio가 내장 Node로 실행한다.
// clanzi mod가 보내는 세션 상태와 사용량을 로컬 브리지로 받아, 세션 슬롯 키와 사용량 키에 그린다.
import { homedir } from 'node:os';
import { join } from 'node:path';
import UlanziApi, { Utils } from './vendor/ulanzi-api/index.js';
import type { ActionMessage } from './vendor/ulanzi-api/index.js';
import { createLogger } from './log.ts';
import { DEFAULT_PORT, startBridge } from './bridge.ts';
import { SessionStore } from './sessions.ts';
import type { Session } from './sessions.ts';
import { UsageStore } from './limits.ts';
import { TitleCache } from './title.ts';
import { assignSlots, sessionLabels, slotFromKey } from './slots.ts';
import { SlotMemory } from './slot-memory.ts';
import { toDataUri } from './render/svg.ts';
import { renderSessionTile } from './render/session.ts';
import { renderUsageGauge } from './render/usage.ts';
import { formatRemaining } from './render/format.ts';
import { FocusHelper, focusRequestFor } from './focus.ts';

const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.clanzi';
/** 화면 갱신 간격. 실제 전송은 이미지가 바뀔 때만 한다. */
const FRAME_MS = 100;
/** 깜빡임 반주기: 작업 중 파란 점은 느리게, 입력 대기 배경은 조금 빠르게. */
const WORKING_BLINK_MS = 800;
const WAITING_BLINK_MS = 600;
/** 세션 키를 이만큼 누르고 있으면 그 세션을 강제 종료한다. */
const KILL_HOLD_MS = 2000;

// SDK는 주고받는 메시지를 이미지 본문까지 콘솔에 남긴다. 깜빡임마다 쌓이지 않게 끈다.
if (!process.env.CLANZI_DEBUG) {
  console.log = () => {};
  console.warn = () => {};
}

type ActionKind = 'session' | 'usage' | 'unknown';

interface KeyState {
  kind: ActionKind;
  slot: number;
  active: boolean;
  lastImage: string;
}

/** 누르고 있는 세션 키. 2초를 채우면 fired. */
interface Hold {
  sessionId: string;
  startedAt: number;
  fired: boolean;
  timer: NodeJS.Timeout;
}

const pluginPath = Utils.getPluginPath();
const log = createLogger(join(pluginPath, 'logs'));
const keys = new Map<string, KeyState>();
const sessions = new SessionStore();
const usage = new UsageStore();
const titles = new TitleCache(join(homedir(), '.claude', 'projects'));
/** 세션 ID → 슬롯 번호 */
let assignment = new Map<string, number>();
const slotMemory = new SlotMemory(join(pluginPath, 'state', 'slots.json'));
const focus = new FocusHelper(join(pluginPath, 'scripts', 'focus-helper.ps1'), log);
/** 키 context → 누르고 있는 상태 */
const presses = new Map<string, Hold>();

log('start', { node: process.version, pluginPath });

startBridge({
  port: DEFAULT_PORT,
  log,
  debug() {
    const now = Date.now();
    return {
      sessions: sessions.all().map((s) => ({
        id: s.id,
        cwd: s.cwd,
        status: s.status,
        turn: s.turn,
        origin: s.origin ?? null,
        pid: s.pid ?? null,
        slot: assignment.get(s.id) ?? null,
        visible: s.visibleFrom <= now,
        firstSeenAgoSec: Math.round((now - s.firstSeen) / 1000),
        lastSeenAgoSec: Math.round((now - s.lastSeen) / 1000),
      })),
      sessionSlots: sessionSlots(),
      usage: usage.snapshot(),
    };
  },
  onMessage(msg) {
    const now = Date.now();
    if (!sessions.get(msg.sessionId) || msg.ev !== 'beat') {
      log('msg', { ev: msg.ev, id: msg.sessionId.slice(0, 8), status: msg.status, turn: msg.turn });
    }
    sessions.apply(msg, now);
    // 측정 시각이 없는 예전 mod는 주기 신호에 옛 측정값을 싣고 오므로, 사용량이 바뀐 메시지만 받는다.
    if (msg.measuredAt !== undefined) usage.update(msg.measuredAt, msg.rateLimits);
    else if (msg.ev === 'usage') usage.update(msg.at, msg.rateLimits);
    if (msg.ev === 'end') titles.forget(msg.sessionId);
    else if (msg.ev === 'start' || msg.ev === 'turn-end' || msg.ev === 'beat') titles.refresh(msg.sessionId, msg.cwd, now);
  },
});

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
  log('add', { context: msg.context, kind: state.kind, slot: state.slot });
  draw(msg.context, state, Date.now(), true);
});

$UD.onSetActive((msg) => {
  const state = upsert(msg);
  state.active = msg.active;
  if (msg.active) draw(msg.context, state, Date.now(), true);
});

// 세션 키: 짧게 누르면 그 세션의 창으로 이동(완료·오류 표시는 확인 처리), 2초 누르고 있으면 그 세션을 강제 종료한다.
// Studio는 run을 누르는 순간 보내 짧게·길게를 가를 수 없으므로 keydown/keyup으로 판단한다.
$UD.onKeyDown((msg) => {
  const state = upsert(msg);
  if (state.kind !== 'session') return;
  const id = sessionAt(state.slot);
  if (!id) return;
  const hold: Hold = {
    sessionId: id,
    startedAt: Date.now(),
    fired: false,
    timer: setTimeout(() => {
      hold.fired = true;
      killSession(id);
    }, KILL_HOLD_MS),
  };
  const prev = presses.get(msg.context);
  if (prev) clearTimeout(prev.timer);
  presses.set(msg.context, hold);
});

$UD.onKeyUp((msg) => {
  const hold = presses.get(msg.context);
  presses.delete(msg.context);
  if (!hold) return;
  clearTimeout(hold.timer);
  if (!hold.fired) focusSession(hold.sessionId, msg.context);
});

$UD.onClear((msg) => {
  for (const item of msg.param ?? []) keys.delete(item.context);
});

setInterval(() => {
  const now = Date.now();
  for (const id of sessions.expire(now)) {
    titles.forget(id);
    log('expired', { id: id.slice(0, 8) });
  }
  const visible = sessions.visible(now);
  // 재시작 직후에는 이전 배정을 붙잡아 두어 세션이 신호를 보내는 순서와 상관없이 원래 자리로 돌아오게 한다.
  const holds = slotMemory.holds(now);
  assignment = assignSlots(assignment, visible.map((s) => s.id), sessionSlots(), holds);
  slotMemory.save(new Map([...holds, ...assignment]), now);
  const labels = sessionLabels(visible);
  for (const [context, state] of keys) draw(context, state, now, false, labels);
}, FRAME_MS).unref();

/** 짧게 눌렀을 때: 완료·오류 표시를 확인 처리하고 그 세션의 창으로 이동한다. */
function focusSession(id: string, context: string): void {
  const session = sessions.get(id);
  if (!session) return;
  const state = keys.get(context);
  if (sessions.acknowledge(id) && state) draw(context, state, Date.now());
  const req = focusRequestFor(session);
  if (!req) {
    log('focus skipped', { id: id.slice(0, 8), origin: session.origin ?? null });
    return;
  }
  focus.request(req).then((result) => log('focus', { id: id.slice(0, 8), op: req.op, result }));
}

/** 2초 눌렀을 때: 그 세션의 Claude 프로세스와 하위 프로세스를 강제 종료하고 슬롯을 비운다. */
function killSession(id: string): void {
  const session = sessions.get(id);
  if (!session?.pid) {
    log('kill skipped', { id: id.slice(0, 8), reason: 'no pid' });
    return;
  }
  focus.request({ op: 'kill', pid: session.pid }).then((result) => {
    log('kill', { id: id.slice(0, 8), pid: session.pid, result });
    if (result === 'killed') {
      sessions.remove(id);
      titles.forget(id);
    }
  });
}

function upsert(msg: ActionMessage): KeyState {
  let state = keys.get(msg.context);
  if (!state) {
    state = { kind: kindOf(msg.uuid), slot: slotFromKey(msg.key), active: true, lastImage: '' };
    keys.set(msg.context, state);
  }
  return state;
}

function kindOf(uuid: string): ActionKind {
  const name = uuid.startsWith(PLUGIN_UUID + '.') ? uuid.slice(PLUGIN_UUID.length + 1) : '';
  return name === 'session' || name === 'usage' ? name : 'unknown';
}

function sessionSlots(): number[] {
  return [...keys.values()].filter((k) => k.kind === 'session').map((k) => k.slot);
}

function sessionAt(slot: number): string | undefined {
  for (const [id, s] of assignment) if (s === slot) return id;
  return undefined;
}

/** 그 세션 키를 누르고 있는 동안의 진행률(0~1). 누르고 있지 않으면 undefined. */
function holdProgress(sessionId: string, now: number): number | undefined {
  for (const hold of presses.values()) {
    if (hold.sessionId === sessionId && !hold.fired) return Math.min(1, (now - hold.startedAt) / KILL_HOLD_MS);
  }
  return undefined;
}

function blinkDim(now: number, halfPeriod: number): boolean {
  return Math.floor(now / halfPeriod) % 2 === 1;
}

function renderSession(session: Session | undefined, label: string, now: number): string {
  if (!session) return renderSessionTile({ status: 'empty' });
  const status = SessionStore.displayStatus(session);
  const half = status === 'working' ? WORKING_BLINK_MS : WAITING_BLINK_MS;
  const hold = holdProgress(session.id, now);
  return renderSessionTile({ status, label, subtitle: titles.get(session.id), dim: blinkDim(now, half), hold });
}

function render(state: KeyState, now: number, labels: ReadonlyMap<string, string>): string {
  switch (state.kind) {
    case 'session': {
      const id = sessionAt(state.slot);
      const session = id ? sessions.get(id) : undefined;
      return renderSession(session, (id && labels.get(id)) || '', now);
    }
    case 'usage': {
      const view = usage.view(now);
      const caption = view.fiveHourResetsIn !== null ? formatRemaining(view.fiveHourResetsIn) : undefined;
      return renderUsageGauge({ fiveHour: view.fiveHour, sevenDay: view.sevenDay, caption });
    }
    default:
      return renderSessionTile({ status: 'empty' });
  }
}

/** 이미지가 바뀐 경우에만 보낸다. force는 키가 새로 놓였거나 다시 활성화돼 새로 그려야 할 때 쓴다. */
function draw(context: string, state: KeyState, now: number, force = false, labels?: ReadonlyMap<string, string>): void {
  if (!state.active) return;
  const image = toDataUri(render(state, now, labels ?? sessionLabels(sessions.visible(now))));
  if (!force && image === state.lastImage) return;
  state.lastImage = image;
  $UD.setBaseDataIcon(context, image, '');
}
