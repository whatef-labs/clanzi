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
/** 사용자의 답을 기다리는 호출. 비어 있지 않으면 입력 대기. */
const pending = new Set()
let beat = null

async function post($, ev, extra) {
  try {
    const sessionId = await $.session.id()
    if (!cwd) cwd = await $.session.cwd()
    await $.http.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, ev, sessionId, cwd, status, turn, at: Date.now(), rateLimits, ...extra }),
    })
  } catch {
    // 브리지가 없으면 버린다. 다음 주기 신호가 상태를 다시 맞춘다.
  }
}

function reset() {
  status = 'idle'
  turn = 0
  pending.clear()
}

function wait($, key) {
  pending.add(key)
  if (status !== 'waiting') {
    status = 'waiting'
    post($, 'wait')
  }
}

function resume($, key) {
  if (!pending.delete(key) || pending.size > 0 || status !== 'waiting') return
  status = 'working'
  post($, 'resume')
}

/** 권한 요청과 그 도구 호출을 같은 키로 묶는다. */
function callKey(id, tool) {
  return id || 'tool:' + tool
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
    pending.clear()
    status = 'working'
    post($, 'turn-start')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // 서브에이전트의 턴은 본 대화의 상태를 바꾸지 않는다.
    if (e.agentId === undefined) {
      pending.clear()
      status = END_STATUS[e.reason] ?? 'done'
      post($, 'turn-end', { reason: e.reason })
    }
    return next(e)
  })

  // 권한 확인 창이 실제로 뜰 때만 온다. 자동 승인된 호출에는 오지 않는다.
  on('classic.PermissionRequest', async ($, e, next) => {
    wait($, callKey(e.tool_use_id, e.tool_name))
    return next(e)
  })

  on('classic.Elicitation', async ($, e, next) => {
    wait($, 'elicitation:' + e.server_name)
    return next(e)
  })

  on('classic.ElicitationResult', async ($, e, next) => {
    resume($, 'elicitation:' + e.server_name)
    return next(e)
  })

  // 도구 호출이 끝나면(승인 후 실행, 거부, 질문에 답함) 그 호출의 대기를 푼다.
  on('tool.call', async ($, e, next) => {
    const key = callKey(e.tool_use_id, e.tool)
    if (ASKS_USER.includes(e.tool)) wait($, key)
    try {
      return await next(e)
    } finally {
      resume($, key)
    }
  })

  on('session.measure', async ($, e, next) => {
    rateLimits = e.rateLimits.map((r) => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))
    if (e.changed.includes('rateLimits')) post($, 'usage')
    return next(e)
  })
}
