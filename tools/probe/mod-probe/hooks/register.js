// 임시 프로브 mod: 어떤 이벤트가 언제 오는지, 사용량이 어떻게 오는지를 로컬 로거(127.0.0.1:39311)로 보낸다.
// 프롬프트·명령·응답 내용은 보내지 않는다. 확인이 끝나면 지운다.
const ENDPOINT = 'http://127.0.0.1:39311/probe'

// 대화 상대를 기다리게 만드는 도구. 이 도구의 tool.call이 끝날 때까지 사용자를 기다린다.
const ASKS_USER = ['AskUserQuestion', 'ExitPlanMode']

async function send($, ev, fields) {
  try {
    const sessionId = await $.session.id()
    await $.http.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ev, sessionId, at: Date.now(), ...fields }),
    })
  } catch {
    // 로거가 꺼져 있으면 버린다
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    const version = await $.session.version()
    send($, 'session.start', { cwd: e.cwd, surface: e.surface, isInteractive: e.isInteractive, version: version.version })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    send($, 'session.end', { reason: e.reason, endedId: e.sessionId })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    send($, 'turn.start', { turnId: e.turnId })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    send($, 'turn.complete', { turnId: e.turnId, reason: e.reason, agentId: e.agentId, isAborted: e.isAborted, durationMs: e.durationMs })
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const decided = await next(e)
    send($, 'tool.check', { tool: e.tool, agentId: e.agentId, decision: decided && decided.decision })
    return decided
  })

  on('tool.call', async ($, e, next) => {
    const asksUser = ASKS_USER.includes(e.tool)
    send($, 'tool.call:before', { tool: e.tool, agentId: e.agentId, asksUser })
    const result = await next(e)
    send($, 'tool.call:after', { tool: e.tool, agentId: e.agentId, denied: Boolean(result && result.deny), isError: Boolean(result && result.isError) })
    return result
  })

  on('session.measure', async ($, e, next) => {
    send($, 'session.measure', { rateLimits: e.rateLimits, contextPercent: e.context && e.context.percent, changed: e.changed })
    return next(e)
  })
}
