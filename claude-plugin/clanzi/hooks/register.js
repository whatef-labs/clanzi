// clanzi mod: 이 Claude Code 세션의 상태와 사용량을 clanzi Studio 플러그인의 로컬 브리지로 보낸다.
// 보내는 것: 세션 ID, 작업 폴더, 상태, 턴 번호, 턴이 끝난 이유, 사용량(rateLimits).
// 프롬프트·명령·응답 내용은 보내지 않는다. Studio가 꺼져 있으면 조용히 버린다.

const ENDPOINT = 'http://127.0.0.1:39311/event'
/** 세션이 살아 있음을 알리는 주기. 플러그인이 재시작해도 이 신호로 상태를 복구한다. */
const BEAT_MS = 20_000
/** 사용자의 답을 기다리게 만드는 도구. 호출이 끝날 때까지 입력 대기로 본다. */
const ASKS_USER = ['AskUserQuestion', 'ExitPlanMode']
/** 턴이 끝난 이유별 상태. 사용자가 멈춘 턴은 대기로 돌아간다. */
const END_STATUS = { answer: 'done', aborted: 'idle', refusal: 'error', error: 'error' }

// 이 프로세스가 맡은 세션의 상태. 세션 ID는 /clear 뒤에 바뀌므로 보낼 때마다 다시 읽는다.
let cwd = ''
let status = 'idle'
let turn = 0
let rateLimits = []
/** 어디서 실행 중인지와 프로세스 ID. 대시보드에서 키를 눌러 이 세션의 창으로 이동할 때 쓴다. */
let origin
let pid
/** 진행 중인 도구 호출. 사용자의 답을 기다리는 호출에는 waiting이 붙는다. */
const calls = new Map()
let nextCall = 0
/** 진행 중인 호출과 짝을 찾지 못한 대기(MCP elicitation 등). 다음 도구 호출이 끝나거나 턴이 바뀌면 푼다. */
let looseWaits = 0
let beat = null

async function post($, ev, extra) {
  try {
    const sessionId = await $.session.id()
    if (!cwd) cwd = await $.session.cwd()
    if (origin === undefined) origin = (await $.env.get('CLAUDE_CODE_ENTRYPOINT')) ?? ''
    if (pid === undefined) pid = (await $.env.get('CLAUDE_PID')) ?? ''
    await $.http.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, ev, sessionId, cwd, status, turn, at: Date.now(), rateLimits, origin, pid, ...extra }),
    })
  } catch {
    // 브리지가 없으면 버린다. 다음 주기 신호가 상태를 다시 맞춘다.
  }
}

function reset() {
  status = 'idle'
  turn = 0
  looseWaits = 0
}

/** 대기 중인 호출이 있으면 입력 대기, 없어지면 작업 중으로 되돌린다. 턴이 이미 끝났으면 그대로 둔다. */
function refresh($) {
  const waiting = looseWaits > 0 || [...calls.values()].some((c) => c.waiting)
  if (waiting && status !== 'waiting') {
    status = 'waiting'
    post($, 'wait')
  } else if (!waiting && status === 'waiting') {
    status = 'working'
    post($, 'resume')
  }
}

/** 권한 요청을 진행 중인 호출에 붙인다. ID가 같은 호출, 없으면 같은 도구의 가장 최근 호출. */
function markWaiting(id, tool) {
  const open = [...calls.values()]
  const match = open.find((c) => id && c.id === id) ?? open.reverse().find((c) => c.tool === tool && !c.waiting)
  if (match) match.waiting = true
  else looseWaits += 1
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    reset()
    post($, 'start')
    if (!beat) beat = $.clock.every(BEAT_MS, () => post($, 'beat'))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await post($, 'end', { sessionId: e.sessionId, reason: e.reason })
    const result = await next(e)
    // /clear와 resume 뒤에는 같은 프로세스가 새 세션 ID로 이어 간다.
    if (e.reason === 'clear' || e.reason === 'resume') {
      reset()
      post($, 'start')
    }
    return result
  })

  on('turn.start', async ($, e, next) => {
    turn += 1
    looseWaits = 0
    status = 'working'
    post($, 'turn-start')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // 서브에이전트의 턴은 본 대화의 상태를 바꾸지 않는다.
    if (e.agentId === undefined) {
      looseWaits = 0
      status = END_STATUS[e.reason] ?? 'done'
      post($, 'turn-end', { reason: e.reason })
    }
    return next(e)
  })

  // 권한 확인 창이 실제로 뜰 때만 온다. 자동 승인된 호출에는 오지 않는다.
  on('classic.PermissionRequest', async ($, e, next) => {
    markWaiting(e.tool_use_id, e.tool_name)
    refresh($)
    return next(e)
  })

  on('classic.Elicitation', async ($, e, next) => {
    looseWaits += 1
    refresh($)
    return next(e)
  })

  on('classic.ElicitationResult', async ($, e, next) => {
    looseWaits = Math.max(0, looseWaits - 1)
    refresh($)
    return next(e)
  })

  // 도구 호출이 끝나면(승인 후 실행, 거부, 질문에 답함) 그 호출에 붙은 대기도 사라진다.
  on('tool.call', async ($, e, next) => {
    const token = ++nextCall
    calls.set(token, { id: e.tool_use_id, tool: e.tool, waiting: ASKS_USER.includes(e.tool) })
    refresh($)
    try {
      return await next(e)
    } finally {
      calls.delete(token)
      looseWaits = 0
      refresh($)
    }
  })

  on('session.measure', async ($, e, next) => {
    rateLimits = e.rateLimits.map((r) => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))
    if (e.changed.includes('rateLimits')) post($, 'usage')
    return next(e)
  })
}
