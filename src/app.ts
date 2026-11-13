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
import { assignSlots, pageLayout, sessionLabels, slotFromKey } from './slots.ts';
import { SlotMemory } from './slot-memory.ts';
import { toDataUri } from './render/svg.ts';
import { renderSessionTile } from './render/session.ts';
import { renderUsageGauge } from './render/usage.ts';
import { formatRemaining } from './render/format.ts';
import { renderPageIcon } from './render/pages.ts';
import { FocusHelper, focusRequestFor } from './focus.ts';

const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.clanzi';
/** 화면 갱신 간격. 실제 전송은 이미지가 바뀔 때만 한다. */
const FRAME_MS = 100;
/** 깜빡임 반주기: 작업 중 파란 점은 느리게, 입력 대기 배경은 조금 빠르게. */
const WORKING_BLINK_MS = 800;
const WAITING_BLINK_MS = 600;
/** 세션 키를 이만큼 누르고 있으면 그 세션을 강제 종료한다. */
const KILL_HOLD_MS = 2000;
/** 사용량 키를 누르면 여는 claude.ai 사용량 화면 */
const USAGE_URL = 'https://claude.ai/new#settings/usage';
/** 노브를 이만큼 만지지 않으면 1페이지로 돌아간다. 다른 페이지를 보던 것을 잊어도 헷갈리지 않게. */
const PAGE_RETURN_MS = 30_000;

// SDK는 주고받는 메시지를 이미지 본문까지 콘솔에 남긴다. 깜빡임마다 쌓이지 않게 끈다.
if (!process.env.CLANZI_DEBUG) {
  console.log = () => {};
  console.warn = () => {};
}

type ActionKind = 'session' | 'usage' | 'pages' | 'unknown';

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
/** 강제 종료를 요청해 결과를 기다리는 세션. 그동안 키는 다 찬 진행 표시로 둔다. */
const killing = new Set<string>();
/** 세션 페이지(0부터). 세션이 세션 키보다 많을 때 노브로 넘긴다. */
let page = 0;
let pageCount = 1;
let pageTouchedAt = 0;
/** 슬롯 번호 → 지금 페이지에서 그 슬롯에 보이는 세션 ID */
let shown = new Map<number, string>();
/** 이번 갱신에서 바뀐 키 이미지(context → data URI). 한 메시지로 묶어 보낸다. */
const pendingIcons = new Map<string, string>();

log('start', { node: process.version, pluginPath });

startBridge({
  port: DEFAULT_PORT,
  log,
  onShutdown() {
    log('shutdown requested by a newer instance');
    process.exit(0);
  },
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
        shownAt: [...shown].find(([, id]) => id === s.id)?.[0] ?? null,
        visible: s.visibleFrom <= now,
        firstSeenAgoSec: Math.round((now - s.firstSeen) / 1000),
        lastSeenAgoSec: Math.round((now - s.lastSeen) / 1000),
      })),
      sessionSlots: sessionSlots(),
      page: { page, pageCount },
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
// Studio가 넘긴 주소와 포트. SDK의 connect()는 process.argv를 잘라 내므로 다시 연결할 때 쓰도록 미리 받아 둔다.
const [studioAddress, studioPort] = process.argv.slice(2);
/** Studio가 막 시작해 아직 연결을 받지 못할 때 다시 시도하는 시간 */
const CONNECT_RETRY_MS = 2_000;
const CONNECT_DEADLINE = Date.now() + 60_000;
let everConnected = false;
const connectStudio = () => $UD.connect(PLUGIN_UUID, Number(studioPort) || 3906, studioAddress || '127.0.0.1');
connectStudio();

$UD.onConnected(() => {
  everConnected = true;
  log('connected', { language: $UD.language });
});
$UD.onClose(() => {
  // 한 번 연결된 뒤 끊기면 Studio가 끝난 것이다. 다음 실행 때 Studio가 새로 띄우므로 끝낸다.
  if (everConnected) {
    log('closed');
    process.exit(0);
  }
  // 처음 연결이 실패했으면(Studio가 막 시작함) 잠시 뒤 다시 시도한다.
  if (Date.now() > CONNECT_DEADLINE) {
    log('studio unreachable');
    process.exit(1);
  }
  setTimeout(connectStudio, CONNECT_RETRY_MS);
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

// 사용량 키: 누르면 기본 브라우저로 claude.ai 사용량 화면을 연다.
$UD.onRun((msg) => {
  if (upsert(msg).kind !== 'usage') return;
  focus.request({ op: 'url', url: USAGE_URL }).then((result) => log('open usage', { result }));
});

// 세션 페이지 노브: 돌리면 페이지를 넘기고, 누르면 1페이지로.
$UD.onDialRotate((msg) => {
  if (upsert(msg).kind !== 'pages' || pageCount <= 1) return;
  const step = msg.rotateEvent === 'left' || msg.rotateEvent === 'hold-left' ? -1 : 1;
  page = (page + step + pageCount) % pageCount;
  pageTouchedAt = Date.now();
  refresh(pageTouchedAt);
});

$UD.onDialDown((msg) => {
  if (upsert(msg).kind !== 'pages') return;
  page = 0;
  pageTouchedAt = Date.now();
  refresh(pageTouchedAt);
});

$UD.onClear((msg) => {
  for (const item of msg.param ?? []) keys.delete(item.context);
});

setInterval(() => refresh(Date.now()), FRAME_MS).unref();

/** 세션 목록·배정·페이지를 다시 계산하고, 바뀐 키 이미지를 한 메시지로 묶어 보낸다. */
function refresh(now: number): void {
  for (const id of sessions.expire(now)) {
    titles.forget(id);
    log('expired', { id: id.slice(0, 8) });
  }
  const visible = sessions.visible(now);
  // 재시작 직후에는 이전 배정을 붙잡아 두어 세션이 신호를 보내는 순서와 상관없이 원래 자리로 돌아오게 한다.
  const holds = slotMemory.holds(now);
  assignment = assignSlots(assignment, visible.map((s) => s.id), sessionSlots(), holds);
  slotMemory.save(new Map([...holds, ...assignment]), now);
  if (page > 0 && now - pageTouchedAt > PAGE_RETURN_MS) page = 0;
  const layout = pageLayout(assignment, visible.map((s) => s.id), sessionSlots(), page);
  ({ shown, pageCount, page } = layout);
  const labels = sessionLabels(visible);
  for (const [context, state] of keys) draw(context, state, now, false, labels);
  flushIcons();
}

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
  killing.add(id);
  focus.request({ op: 'kill', pid: session.pid }).then((result) => {
    log('kill', { id: id.slice(0, 8), pid: session.pid, result });
    // 끝났으면 슬롯을 비우고, 실패했으면 원래 상태 표시로 돌아간다.
    if (result === 'killed') {
      sessions.remove(id, Date.now());
      titles.forget(id);
    }
    killing.delete(id);
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
  return name === 'session' || name === 'usage' || name === 'pages' ? name : 'unknown';
}

function sessionSlots(): number[] {
  return [...keys.values()].filter((k) => k.kind === 'session').map((k) => k.slot);
}

function sessionAt(slot: number): string | undefined {
  return shown.get(slot);
}

/** 그 세션 키를 누르고 있거나 종료 중일 때의 진행률(0~1). 다 찬 뒤에는 종료가 끝날 때까지 1로 둔다. 아니면 undefined. */
function holdProgress(sessionId: string, now: number): number | undefined {
  if (killing.has(sessionId)) return 1;
  for (const hold of presses.values()) {
    if (hold.sessionId === sessionId) return hold.fired ? 1 : Math.min(1, (now - hold.startedAt) / KILL_HOLD_MS);
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
  if (state.kind === 'pages') {
    drawPages(context, state, force);
    return;
  }
  const image = toDataUri(render(state, now, labels ?? sessionLabels(sessions.visible(now))));
  if (!force && image === state.lastImage) return;
  state.lastImage = image;
  pendingIcons.set(context, image);
  // 주기 갱신 밖에서 부른 경우(키 추가, 확인 처리 등)는 바로 보낸다.
  if (!labels) flushIcons();
}

/**
 * 모아 둔 키 이미지를 'state' 명령 하나로 보낸다. 페이지를 넘기면 세션 키가 한꺼번에 바뀌는데,
 * 키마다 따로 보내면 Studio가 차례로 처리해 하나씩 늦게 바뀌어 보이기 때문이다. (setBaseDataIcon과 같은 형식)
 */
function flushIcons(): void {
  if (pendingIcons.size === 0) return;
  // Studio는 목록 순서대로 키를 하나씩 기기에 쓴다. 키 번호(왼쪽 위부터) 순서로 보내 화면이 위에서 아래로 쓸 듯 바뀌게 한다.
  const ordered = [...pendingIcons].sort(([a], [b]) => (keys.get(a)?.slot ?? 0) - (keys.get(b)?.slot ?? 0));
  const statelist = ordered.map(([context, data]) => ({
    ...$UD.decodeContext(context),
    type: 1,
    data,
    textData: '',
    showtext: false,
  }));
  pendingIcons.clear();
  $UD.send('state', { param: { statelist } });
}

/** 노브 화면: 내장 레이아웃 $UA1의 아이콘 칸에 현재 페이지, 제목 칸에 이름. */
function drawPages(context: string, state: KeyState, force: boolean): void {
  const icon = toDataUri(renderPageIcon({ page, pageCount }));
  if (!force && icon === state.lastImage) return;
  state.lastImage = icon;
  $UD.setFeedback(context, { icon: { value: icon }, title: { text: '세션 페이지' } });
}
