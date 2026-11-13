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

- **SessionStart는 HTTP 훅을 지원하지 않는다.** 디버그 로그에 `HTTP hooks are not supported for SessionStart`가 남는다. 공식 문서에는 없다. SessionEnd는 지원한다.
- 닫힌 포트로 보낸 HTTP 훅은 8ms 만에 `ECONNREFUSED`로 실패한다. 비차단 오류라 Claude 동작에는 영향이 없고, 대화창에 `hook error` 알림 줄만 남는다.
- 같은 상황에서 curl과 .NET은 실패까지 약 2초가 걸린다. Windows가 거부된 연결을 재시도하기 때문이다. Node(libuv)는 7ms다.

## 핸드오프 대비 확정된 변경

| 항목 | 핸드오프 | 확정 | 이유 |
| --- | --- | --- | --- |
| 훅 전송 | 명령형 훅 + Node 스크립트 | HTTP 훅 | 이벤트마다 프로세스를 띄우지 않는다. 본문은 루프백으로만 가고 브리지가 필요한 필드만 남긴다 |
| 세션 등록 | SessionStart | 첫 이벤트(보통 첫 프롬프트) | SessionStart가 HTTP 훅을 지원하지 않는다 |
| 입력 대기 해제 | (없음) | PostToolUse·PostToolUseFailure 훅 추가 | 권한 승인 뒤 '작업 중'으로 돌아갈 신호가 필요하다 |
| Studio가 꺼져 있을 때 | — | hook error 알림 줄을 감수 | 지연은 없고 Studio는 평소 켜 둔다 |
| Claude Code 쪽 Node | 필요 | 필요 없음 | 훅은 HTTP, statusLine은 curl로 구성 예정(5단계) |
| 사용량 표시 | 2x 키 하나에 이중 링 + 대기 집계 | 작은 키 '사용량'(이중 링) + 작은 키 '입력 대기'(집계) | 2x 키에 플러그인 액션을 놓을 수 없다 |
| 세션 슬롯 수 | 13개 고정 | 세션 액션을 놓은 키 수만큼. 슬롯 번호는 키 위치로 정한다 | context에 키 위치가 들어 있다 |
| 세션 상태 표현 | 색 + 상태 문구 | 문구 없이 색과 깜빡임만 | 사용자 결정 |

## 개발

필요한 것: Node 22.18 이상(타입 스트리핑으로 테스트 실행), npm.

```sh
npm install
npm run build        # com.ulanzi.clanzi.ulanziPlugin/plugin/app.js 생성
npm run typecheck
npm run dev:link     # Studio 사용자 플러그인 폴더에 정션 연결 (해제: npm run dev:unlink)
```

빌드 후 Studio를 재시작해야 플러그인이 다시 로드된다. 플러그인 로그는 `com.ulanzi.clanzi.ulanziPlugin/logs/plugin.log`에 남는다.

### 폴더 구조

```
src/                         TypeScript 소스 (esbuild로 한 파일 번들)
  vendor/ulanzi-api/         공식 Node SDK 복사본 (수정 금지, VENDORED.md 참고)
scripts/                     빌드·개발 스크립트
tools/probe/                 1단계 확인용 임시 프로브
com.ulanzi.clanzi.ulanziPlugin/
  manifest.json              UUID com.ulanzi.ulanzistudio.clanzi
  plugin/app.js              빌드 산출물 (커밋하지 않음)
  resources/                 아이콘
  en.json, ko_KR.json        현지화
```
