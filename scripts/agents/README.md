# Agent workflow script 소유권

공통 지침은 [`AGENTS.md`](../../AGENTS.md), host별 실행 책임은
[adapter 안내](../../docs/development/agent-workflows/adapters/README.md)가 소유합니다.
이 디렉터리의 정적 validator·recommendation은 실제 provider 호출·모델·권한 입증을 대신하지 않습니다.

| 경로                          | 책임                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `common/`                     | host-neutral intake·context·plan readiness/storage·workflow graph·QA packet·adapter conformance   |
| `codex/`                      | Codex 모델/effort·위임·복구·결과·Git/OMX preflight와 workflow composition                         |
| `claude/`                     | Claude Git/계획 preflight·direct workflow·finite model 정책·same-session native task coordination |
| `bridge/`                     | 교차-host static 계약과 fake process 검증; real provider 기본 비활성                              |
| `fixtures/workflow-contract/` | 공통 intake·synthetic graph fixture; 실제 host/runtime 증거가 아님                                |
| `fixtures/codex-preflight/`   | 실제 disposable Git와 optional OMX stub로 Codex preflight 회귀 검증                               |
| `fixtures/plan-readiness/`    | 공통 계획 readiness positive/negative 입력                                                        |

## 명명과 호출

- host 명령은 `<host>:<operation>`: `pnpm codex:preflight`, `pnpm codex:workflow`.
  Claude는 `pnpm claude:preflight`·`pnpm claude:workflow`를 사용하고, 같은 interactive session의 bounded Agent task만
  `pnpm claude:native register --input <JSON-file>`로 등록합니다. Registry는 dispatcher·인증·업무 승인 수단이 아니며
  Codex 명령으로 대체하지 않습니다.
- Claude 표준 interactive entry는 `claude --permission-mode auto`입니다. 기존 Home·project 설정을 로드하고, 그
  설정에서 설치·활성화된 OMC plugin도 Claude가 자동으로 로드하므로 별도 `omc` CLI prefix가 필요하지 않습니다.
  모든 설치에 OMC가 있다는 뜻은 아닙니다. Home 설정을 설치·변경하지 않습니다. `auto`는 bypass가 아니고
  Codex/OMX와 동일한 sandbox·보안 계약도 아닙니다.
- Project hook(`SessionStart`, `PreToolUse`·`PermissionRequest`·`PostToolUse` Agent)과 네 Repo 역할의 `permissions.ask`가
  session manifest와 정확한 Agent input/grant/receipt를 연결합니다. Healthy PreToolUse는 model 누락·불일치를 거부하고,
  PermissionRequest가 같은 입력의 attempt에만 한 번 allow합니다. Hook 장애는 사람 승인 prompt(fail-safe to human)로
  넘어가며(`repo_*` prompt는 승인하지 않음), Repo grant·receipt 없이 완료하지 않고 source·의미·공통 QA를 함께 확인합니다.
  권한 규칙 편집은 실행 중인 세션에 반영되지 않았으므로 새 세션에서 확인합니다.
- 이 source entry는 generic native support·live qualification·parent model 설정·task authority를 주장하지 않습니다.
  기존 headless qualification은 별도 legacy test이고 auto evidence가 아니며 cross-CLI bridge는 계속 unsupported입니다.
- `codex/`·`claude/` 안의 `.mjs`는 경로 자체가 host를 구분하므로 파일명에 prefix를 중복하지 않습니다.
- flat `scripts/ci/`의 host 전용 suite는 `codex-*`·`claude-*`처럼 host를 식별합니다.
  공통 계약 및 여러 host의 경계를 함께 검사하는 suite는 `agent-*`·`cross-host-*` 등 검증 책임을 표시합니다.
- fixture 이름은 검증하는 동작·계약을 설명합니다. 임시 계획 단계·번호를 directory/file/API 이름으로 사용하지 않습니다.
  과거 시점의 관측 내용·receipt 식별자는 당시 증거로 보존하되 현재 동작의 규범으로 사용하지 않습니다.
- 경로 변경 시 import·문서·package·CI caller를 함께 바꿉니다. 과거 명령만 보존하는 re-export/wrapper는 만들지 않습니다.
  실제 소비자가 남은 데이터 읽기 호환성은 필요·제거 조건을 명시하고 별도로 검증합니다.
- `common/index.mjs`는 공통 API 공개 facade이지 이전 경로 compatibility 파일이 아닙니다.
  명시적 legacy plan 읽기는 실제 local migration 전까지 필요한 데이터 호환성입니다.

## 검증

`pnpm test:repo-policy`가 `scripts/ci/**/*.test.mjs`를 재귀적으로 발견합니다.
Fixture는 suite에서 import하며 별도 과거 probe wrapper로 중복 실행하지 않습니다.
Host 명명·공통 source owner·현재 명령·fixture 경계는 `scripts/ci/agent-host-naming.test.mjs`가 검사합니다.
