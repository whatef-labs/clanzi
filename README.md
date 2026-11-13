# clanzi

Ulanzi D200X를 Claude Code 세션 상태·사용량 대시보드로 만드는 Ulanzi Studio 플러그인이다. 설계 배경은 [HANDOFF.md](HANDOFF.md)에 있다.

## 1단계: 환경 확인 결과

확인일 2026-11-13, Windows 11 Pro 26200.

| 항목 | 결과 | 확인 방법 |
| --- | --- | --- |
| Ulanzi Studio 버전 | 3.4.8.0 | `UlanziDeck.exe` 파일 버전 |
| Studio 내장 Node | v20.12.2, `C:\Program Files (x86)\Ulanzi Studio\nodejs\node.exe` | 직접 실행, 플러그인 시작 로그의 `process.version` |
| Studio가 넘기는 인자 | 주소, 포트(실행마다 다름, 예: 3906·7532), 언어(`ko-KR`), Studio 버전(`3.4.8`) | 플러그인 프로세스 명령줄 |
| 사용자 플러그인 폴더 | `%APPDATA%\Ulanzi\UlanziDeck\Plugins`. 정션으로 연결해도 로드된다 | 실기기 로드. 기본 제공 플러그인은 `...\UlanziDeck\System\Plugins` |
| 플러그인 재로드 | 새 플러그인과 manifest 변경은 Studio 재시작이 필요하다. 코드만 바꿨으면 플러그인 프로세스를 같은 인자로 다시 띄우면 된다(`npm run dev:reload`). Studio가 키마다 add를 다시 보낸다. 종료된 플러그인을 Studio가 자동으로 다시 띄우지는 않는다 | 프로세스 종료·재실행 |
| 프로파일 위치 | `%APPDATA%\Ulanzi\UlanziDeck\ProfilesV2` | 폴더 탐색 (읽기만 함) |
| 키 식별자 | `열_행` 형식. 작은 키 `0_0`~`4_2`, 2x 키 `3_2`, 노브 `x_3`. 슬롯 번호 = 행 × 5 + 열 + 1 | 프로파일 manifest와 onAdd의 context key가 같은 형식 |
| Claude Code | CLI 2.1.311, VS Code 확장 2.1.283 | `claude --version`, 확장 경로 |
| statusLine (VS Code 패널) | 호출되지 않음 | 프로브를 건 뒤 30분 넘게 응답을 주고받아도 `claude-vscode` 기록 0건 |
| statusLine (통합 터미널 CLI) | 호출됨(`CLAUDE_CODE_ENTRYPOINT=cli`). 세션 시작 때와 응답마다 | 같은 프로브 |
| 구독 플랜 (`rate_limits` 수신) | 수신됨. 첫 응답 뒤부터 `five_hour`·`seven_day`가 모두 들어온다 | 프로브의 `last-stdin.json` |
| 2x 키 사용 가능 여부 | 불가. Studio 전용 "스몰 윈도우"(`com.ulanzi.ulanzideck.smallwindow.window`)라 플러그인 액션을 놓을 수 없다 | 드래그 앤 드롭, 실행 파일 문자열 |
| 전역 PATH의 `node` | 없음. fnm은 PowerShell 프로필에서만 켜지고, `C:\Program Files\nodejs`는 비어 있는 경로 | Git Bash, cmd, `pwsh -NoProfile`에서 확인 |
| 공식 SDK 라이선스 | Apache-2.0 (핸드오프의 AGPL 표기는 옛 정보) | 저장소 LICENSE |

### 실측으로 알게 된 Claude Code 동작

- **VS Code 확장 패널은 statusLine을 실행하지 않는다.** CLI(통합 터미널 포함)만 실행한다.
- **SessionStart는 HTTP 훅을 지원하지 않는다.** 디버그 로그에 `HTTP hooks are not supported for SessionStart`가 남는다. 공식 문서에는 없다.
- 닫힌 포트로 보낸 HTTP 훅은 8ms 만에 실패하지만, 대화창에 `hook error` 알림 줄이 남는다. curl과 .NET은 같은 실패에 약 2초가 걸린다.
- **Claude Code mod(v2.1.287 이상)는 CLI, VS Code 패널, Desktop 앱에서 모두 실행된다.** VS Code 확장 2.1.323에서 확인했다.
  - `session.start`는 대화 탭을 열자마자, `session.measure`는 첫 턴 전부터 사용량(`rateLimits`)을 준다.
  - `classic.PermissionRequest`는 권한 확인 창이 실제로 뜰 때만 온다. 자동 모드에서 분류기가 승인한 호출에는 오지 않는다. 반면 `tool.check`의 `ask`는 창이 뜨지 않아도 온다.
  - 질문 도구(AskUserQuestion)는 도구 호출과 권한 요청 두 경로로 대기가 걸린다.
  - Claude Code 자신의 환경에는 `CLAUDE_PID`가 없다(하위 프로세스에만 전달).
- VS Code가 대화 탭을 열고 있는 동안 1초 안에 시작과 종료를 마치는 내부 세션을 띄운다.
- VS Code 확장은 `vscode://anthropic.claude-code/open?session=<id>` URI로 그 대화를 연다. 다만 백그라운드 프로그램이 열면 Windows가 VS Code 창을 앞으로 가져오지 않는다.

## 구조

```
Claude Code 세션(CLI · VS Code 패널 · Desktop)
  └ clanzi mod (claude-plugin/clanzi)         세션 상태·사용량을 스스로 추적
        │ POST http://127.0.0.1:39311/event   상태가 바뀔 때 + 20초 주기 신호
        ▼
Ulanzi Studio 플러그인 (com.ulanzi.clanzi.ulanziPlugin, Node 20)
  ├ 브리지(src/bridge.ts)                     메시지 검증, GET /debug
  ├ 세션 저장소(src/sessions.ts)               유예·만료·확인 처리
  ├ 슬롯 배정(src/slots.ts, slot-memory.ts)    키 위치 순서, 재시작 후 자리 유지
  ├ 사용량(src/limits.ts), 제목(src/title.ts)  가장 최근 측정값, 기록 파일의 ai-title
  ├ 렌더러(src/render/)                        SVG → 바뀐 키만 'state' 명령 하나로
  └ 창 이동·세션 종료·브라우저 열기(src/focus.ts + scripts/focus-helper.ps1)
```

Studio는 키 이미지를 목록 순서대로 기기에 한 장씩 보낸다. 기기 전송이 병목이라 한 번에 바뀌지는 않으므로, 키 번호 순서로 보내 위에서 아래로 바뀌게 한다.

Studio를 재시작하면 새 플러그인 프로세스가 뜬다. 첫 연결이 실패해도 60초 동안 2초마다 다시 붙고, 이전 인스턴스가 브리지 포트를 쥐고 있으면 `POST /shutdown`으로 넘겨받는다. Studio는 죽은 플러그인을 다시 띄우지 않으므로 플러그인이 스스로 꺼지지 않게 하는 것이 중요하다.

mod가 보내는 것은 세션 ID, 작업 폴더, 상태, 턴 번호, 턴이 끝난 이유, 사용량, 실행 위치, 프로세스 ID뿐이다. 프롬프트·명령·응답 내용은 보내지 않는다. 세션 제목은 플러그인이 기록 파일 끝부분에서 `ai-title` 레코드만 읽어 쓴다.

## 핸드오프 대비 확정된 변경

| 항목 | 핸드오프 | 확정 | 이유 |
| --- | --- | --- | --- |
| 데이터 수집 | 명령형 훅 + statusLine | Claude Code mod 하나 | 이벤트마다 프로세스를 띄우지 않고, VS Code 패널에서도 사용량을 받는다. Studio가 꺼져 있어도 대화창에 오류 줄이 남지 않는다 |
| settings.json 변경 | 훅·statusLine 병합 | 플러그인 설치 두 항목(`extraKnownMarketplaces`, `enabledPlugins`) | mod는 플러그인으로 설치한다 |
| 세션 등록 | SessionStart | 탭을 열자마자(1.5초 유예로 내부 세션 거름) | |
| 입력 대기 | Notification | 권한 확인 창·질문 도구가 열린 동안. 그 도구 호출이 끝나면 해제 | 승인 뒤 '작업 중'으로 정확히 돌아온다 |
| 사용량 표시 | 2x 키 하나에 이중 링 + 대기 집계 | 작은 키 '사용량' 하나(이중 링) | 2x 키에 플러그인 액션을 놓을 수 없다. 대기 집계 키는 사용자 결정으로 뺐다 |
| 세션 슬롯 수 | 13개 고정 | 세션 액션을 놓은 키 수만큼, 번호는 키 위치 | context에 키 위치가 들어 있다 |
| 라벨 | session_name 또는 폴더 | 폴더 이름 + 짧은 AI 제목(최대 두 줄) | mod에서는 session_name을 얻을 수 없다 |
| 상태 표현 | 색 + 상태 문구 | 문구 없이 점·테두리·배경색 | 사용자 결정 |
| 중단·오류 | — | 사용자가 멈춘 턴은 대기, API 오류는 빨간 테두리·점 | 사용자 결정 |
| 키 누르기 | 완료 표시 해제 | 그 세션의 창으로 이동 + 완료·오류 확인 | 사용자 요청. 핸드오프에서는 범위 밖이었다 |
| 키 길게 누르기 | — | 2초 누르면 그 세션의 claude 프로세스 강제 종료 | 사용자 요청 |
| 사용량 키 누르기 | — | 기본 브라우저로 claude.ai 사용량 화면 | 사용자 요청 |
| 슬롯보다 세션이 많을 때 | 노브로 페이지 | '세션 페이지' 노브 액션. 30초 손대지 않으면 1페이지로 | |
| 빈 슬롯 누르기로 새 세션 | — | 보류 | 어느 폴더에서 어떤 실행기로 띄울지 정하기 어렵다 |

### 세션 키 표시

| 상태 | 표현 |
| --- | --- |
| 빈 슬롯 | 검은 바탕에 점선 원 |
| 대기 | 회색 테두리·점 |
| 작업 중 | 파란 테두리, 파란 점 깜빡임(0.8초) |
| 입력 대기 | 주황 배경 깜빡임(0.6초), 주황 점 |
| 완료 | 초록 배경 |
| 오류 | 빨간 테두리·점 |
| 길게 누르는 중 | 빨간 테두리, 아래에서 빨간색이 차오름(2초). 다 차면 종료가 끝날 때까지 가득 찬 채로 둔다 |

라벨은 폴더 이름 한 줄과 AI 제목(최대 두 줄)이다. 같은 폴더 이름이 겹치면 뒤에 " 2"를 붙인다.

### 키를 누르면

| 세션 위치 | 동작 |
| --- | --- |
| VS Code 패널 | 폴더 이름으로 VS Code 창을 앞으로 가져온 뒤 URI로 그 대화를 연다 |
| 터미널 CLI(PhpStorm, Windows Terminal 등) | Claude 프로세스의 부모를 따라 올라가 창을 가진 앱을 앞으로 가져온다. 특정 탭까지는 고르지 못한다 |

2초 동안 누르고 있으면 mod가 알려 준 프로세스 ID로 세션을 끝낸다(`taskkill /T /F`). 그 프로세스 이름이 `claude`일 때만 끄므로, 세션이 이미 끝나 다른 프로그램이 같은 PID를 받았다면 아무것도 하지 않는다. 프로세스 ID를 아직 모르는 세션은 건너뛴다.

| 다른 액션 | 동작 |
| --- | --- |
| 사용량 키 | `https://claude.ai/new#settings/usage`를 기본 브라우저로 연다 |
| 세션 페이지 노브 | 돌리면 페이지를 넘기고(끝에서 처음으로 돈다), 누르면 1페이지로 |

창 전환은 Alt+Tab과 같은 전환을 먼저 쓰고, Windows가 막으면 앞 창의 입력 스레드에 잠시 붙어서 넘긴다. 전환 직후에는 실제 마우스 입력으로 1만큼 움직였다 되돌려 커서를 새로 정하게 한다. Windows Terminal에서 '작업 중' 커서가 남던 문제 때문이다.

## 설치

필요한 것: Windows, Ulanzi Studio, Claude Code 2.1.287 이상, Node 22.18 이상(설치 스크립트와 빌드용).

```sh
npm install
npm run clanzi:status      # 지금 설치 상태와 브리지 응답 확인
npm run clanzi:install     # 빌드 → Studio 플러그인 복사 → 설정 백업 → mod 설치
npm run clanzi:uninstall   # 설정 백업 → mod·마켓플레이스 제거 → Studio 플러그인 제거
```

- 실행 전에 할 일을 보여 주고, `~/.claude/settings.json`이 바뀌는 단계가 있으면 확인을 받는다. 바꾸기 전에 `settings.json.clanzi-bak-<시각>`으로 백업한다.
- `-- --dry-run`을 붙이면 할 일만 보여 준다. 확인 없이 진행하려면 `-- --yes`.
- 다시 실행해도 된 단계는 건너뛴다. mod 폴더 버전이 설치된 것과 다르면 갱신한다.
- settings.json에는 `extraKnownMarketplaces.clanzi-local`과 `enabledPlugins["clanzi@clanzi-local"]` 두 항목만 생긴다. 기존 훅·statusLine은 건드리지 않는다. 제거하면 두 항목도 빠진다.
- Studio 플러그인은 `%APPDATA%\Ulanzi\UlanziDeck\Plugins\com.ulanzi.clanzi.ulanziPlugin`에 복사한다. 실행 중 생긴 `state/`, `logs/`는 다시 설치해도 남는다. `-- --link`를 붙이면 복사 대신 저장소 폴더로 정션을 건다(개발용). 이미 저장소를 가리키는 정션이 있으면 그대로 둔다.
- Studio 프로파일은 바꾸지 않는다. 설치 뒤 Studio를 재시작하고 키에 액션을 직접 놓는다.

이미 열린 Claude Code 세션은 `/reload-plugins`를 해야 mod가 적용된다.

## 개발

필요한 것: Node 22.18 이상(타입 스트리핑으로 테스트 실행), npm, Claude Code 2.1.287 이상.

```sh
npm run build        # com.ulanzi.clanzi.ulanziPlugin/plugin/app.js 생성
npm run typecheck
npm test
npm run preview      # 렌더러 결과를 preview/index.html로
npm run dev:link     # Studio 플러그인 폴더를 저장소로 정션 연결(해제: npm run dev:unlink)
npm run dev:reload   # 빌드 후 Studio 재시작 없이 플러그인만 다시 띄움(manifest 변경은 Studio 재시작 필요)
npm run dev:fake -- 12 300   # 가짜 세션 12개를 300초 동안 띄움(페이지·배치 확인용). Ctrl+C로 정리
claude plugin validate ./claude-plugin/clanzi
```

- 플러그인 로그: `com.ulanzi.clanzi.ulanziPlugin/logs/plugin.log`
- 세션·슬롯 상태: `curl http://127.0.0.1:39311/debug`
- mod를 고친 뒤에는 `plugin.json`의 버전을 올리고 `claude plugin update clanzi@clanzi-local`, 각 세션에서 `/reload-plugins`

### 폴더 구조

```
src/                         Studio 플러그인 TypeScript 소스 (esbuild로 한 파일 번들)
  vendor/ulanzi-api/         공식 Node SDK 복사본 (수정 금지, VENDORED.md 참고)
claude-plugin/               Claude Code 로컬 마켓플레이스 (clanzi-local)
  clanzi/                    clanzi mod
scripts/                     빌드·개발 스크립트
test/                        단위 테스트 (node --test)
com.ulanzi.clanzi.ulanziPlugin/
  manifest.json              UUID com.ulanzi.ulanzistudio.clanzi, 액션: 세션 슬롯, 사용량, 세션 페이지(노브)
  plugin/app.js              빌드 산출물 (커밋하지 않음)
  scripts/focus-helper.ps1   창 전환 도우미 (Windows PowerShell 5.1용, UTF-8 BOM)
  state/, logs/              실행 중 생기는 파일 (커밋하지 않음)
  resources/                 아이콘
  en.json, ko_KR.json        현지화
```

## 진행 상황

| 단계 | 상태 |
| --- | --- |
| 1. 환경 확인 | 완료 |
| 2. 스캐폴드 | 완료 |
| 3. SVG 렌더러 | 완료 (실기기 확인) |
| 4. 브리지·세션 상태 | 완료 (훅 대신 mod) |
| 5. 사용량 | 완료 (statusLine 대신 mod의 session.measure. 측정 시각이 가장 늦은 값만 써서 `/usage`와 맞춤) |
| 6. 다중 세션 | 완료 (슬롯 배정·라벨 중복·만료·재시작 후 자리 유지·노브 페이지) |
| 7. 설치·문서 | 완료 (`npm run clanzi:install` / `clanzi:uninstall` / `clanzi:status`) |
| 추가: 키로 세션 창 이동 | 완료 |
| 추가: 길게 눌러 세션 종료, 사용량 키로 브라우저 열기 | 완료 |
| 보류: 빈 슬롯으로 새 세션 띄우기 | 보류 |
