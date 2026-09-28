# Coding-agent host adapters

공통 저장소 계약은 `AGENTS.md`입니다. [Execution](../agent-execution-contract.md),
[Orchestration](../orchestration.md), [QA](../qa.md), [위임](../request-intake/delegation.md)이 책임·인수 기준을 소유하며,
adapter는 **명시적으로 선택한 현재 host의 실행 세부**만 연결합니다. 모든 adapter를 기본 입력으로 읽지 않습니다.

| Host        | Entry                     | 프로젝트 역할          | 조건부 실행 계약                                                            |
| ----------- | ------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| Codex/OMX   | `AGENTS.md`               | `.codex/agents/*.toml` | [Codex](./codex.md): model/effort, native routing, sandbox, OMX             |
| Claude Code | `CLAUDE.md` → `AGENTS.md` | `.claude/agents/*.md`  | [Claude Code](./claude-code.md): discovery, tools, permission, model policy |
| 향후 host   | 승인된 adapter entry      | 해당 host 정의         | 같은 공통 계약과 적합성 검사; 등록 전 Codex fallback 없음                   |

같은 역할 이름·packet은 capability 동등성의 증거가 아닙니다. Lead는 현재 loaded instructions·role/tool·권한·source를
확인합니다. 지원이 없으면 허용된 direct/sequential 작업 또는 bounded blocker를 선택합니다. Prompt로 다른 host의
모델·권한·runtime state를 가장하지 않습니다. OMX/OMC 설치·선택은 작업 owner의 환경 책임입니다.

## 공통 계약과 실제 caller

| Source owner                  | 책임                                                                                     | 현재 caller·증거 경계                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `common/`의 neutral services  | `intake-policy`, `domain-guide-registry`, `plan-readiness-policy`, `cross-model-handoff` | 기존 TaskEnvelope/ContextPack/readiness/QA validation; Plan-only guide selection 보존 |
| `common/workflow-entry.mjs`   | ordered readset·조건부 host/domain guide                                                 | 명시적 CLI가 intake/context를 호출; 자동 startup hook이나 dispatcher가 아님           |
| `common/plan-store.mjs`       | 공통 authoring root의 bounded metadata·discovery·resume 후보                             | 공통 CLI와 tests; host memory/state를 읽거나 쓰지 않음                                |
| `common/adapter-contract.mjs` | descriptor/capability, bounded lanes·receipt/fan-in, 독립 QA 입력 적합성                 | static conformance tests와 명시적 API 소비자; scheduler·provider launcher 아님        |
| `common/index.mjs`            | 위 공통 API의 공개 facade                                                                | export만으로 host admission/invocation을 입증하지 않음                                |
| `codex/`                      | profiles·routing·child/orchestration·model evidence·smoke·session parser/preflight       | 기존 Codex tests/CLI 유지, 모델·effort·상한은 공통 기본값이 아님                      |
| `claude/`                     | Git/계획 preflight·direct workflow·finite model policy·native session coordination       | 공통 계약과 project hook이 manifest/Agent input/receipt를 연결; 인증·전역 지원 아님   |
| `bridge/`                     | static one-shot packet와 고정 fake process                                               | 실제 provider launcher가 아님; live 기본 비활성 유지                                  |

`codex/workflow-entry.mjs`는 공통 route·lane/result/QA contract와 기존 Codex policy의 실제 composition입니다. `codex:workflow`와 smoke가 이를 소비하며 native/provider 실행은 하지 않습니다.

`codex/session-contract`와 `codex/session-preflight`는 Codex/OMX 소유입니다. `pnpm codex:preflight`는 해당 owner를 직접
호출하며 Claude용 명령이 아닙니다. 기존 caller의 기본 authoring 탐색은 공통 `.plans` reader를 소비하며 legacy `.omx/plans`는 명시적 읽기만 유지합니다. native/plugin 출력 설정이나 실제 local 파일 이동까지 완료됐다는 뜻은 아닙니다.
공통 계획 생성·legacy 원본 보존·실제 이동 gate는 [Session continuity](../session-continuity.md#active-plan-lifecycle)를 따릅니다.

[Codex child policy](./codex-delegation.md)와 [Codex recovery](../request-intake/orchestration-recovery.md)는 해당 host만
소비합니다. 기존 Codex 모델 cohort와 Astra QA 의무를 Claude review로 대체하지 않습니다. 교차 검토는 별도 승인된
[교차 모델 계약](./cross-model-handoff.md)과 [QA packet](../qa.md#portable-qa-packet)을 사용합니다.

## Adapter 적합성

`validateAdapterDescriptor`는 명시적인 `hostId`, repository `entry`, source/config digest, capability 선언을 검사합니다.
capability의 `supported/unsupported/unknown` **선언**과 현재 identity에 귀속된 **관측**은 분리합니다.
`assessAdapterCapability`의 정적 결과로 실제 권한이나 모델을 증명하지 않습니다. 필수 관측이 없으면 unknown이며
다른 host/CLI로 자동 우회하지 않습니다.

`validateBoundedLanes`는 기존 TaskEnvelope/ContextPack과 snapshot을 받아 dependency 순서와 one-writer를 검사합니다.
`assessLaneReadiness`·`validateLaneResult`·`validateFanIn`은 task/dispatch/owner/host/source/config/snapshot이 맞는 결과만
검사합니다. 파일 쓰기나 실행 스케줄링은 하지 않습니다. `validateAdapterReview`는 기존 QA packet/result를 재사용하며
builder와 reviewer의 독립성을 확인합니다. 실제 finding의 valid/invalid 판정·재현 책임은 Parent에게 남습니다.

새 adapter를 도입할 때 공통 코드에 vendor 모델 enum을 추가하지 않습니다. 고유 descriptor와 host 실행 정책을 추가하고
공통 positive/negative conformance를 먼저 통과시킨 후 native 권한·모델·취소/결과 회수를 별도 검증합니다.
테스트의 synthetic 제3 adapter는 구조 확장성 증거이지 실제 제3 provider 지원이 아닙니다.

## Preparation versus live adoption

`repository-prepared`는 tracked instructions·역할·검증·portable 인계 준비 상태입니다. 계정 결제/로그인·모델 호출을
필수로 하지 않으며 실제 role loading·권한 강제·모델 동작을 입증하지 않습니다.

`runtime-qualified`는 별도 승인된 실제 host 시험입니다. 고정 disposable fixture에서 instruction/role/tool loading,
allow/deny, executor evidence, lifecycle/cleanup 및 host 간 인계를 관측해야 합니다. 파일 존재·metadata·static PASS만으로
전체 runtime readiness를 선언하지 않습니다. Plugin 설치와 실제 모델 실행도 각각 별도 권한·evidence가 필요합니다.

스크립트·테스트·fixture의 host 명명 및 owner 배치는 [scripts/agents 안내](../../../../scripts/agents/README.md)를 따릅니다.

Claude의 `claude:preflight`·`claude:workflow`는 [Claude adapter](./claude-code.md#loading-and-scope)의 실제
Git/계획·direct-task 경로입니다. `claude --permission-mode auto`는 기존 Home·project 설정을 로드하는 표준 interactive
entry이며 bypass mode가 아닙니다. OMC가 Claude 설정에서 설치·활성화되어 있으면 Claude가 자동으로 plugin을 로드하므로
별도 `omc` CLI prefix는 필요하지 않습니다. 모든 설치에 OMC가 있다는 뜻은 아닙니다. Codex/OMX의 승인 classifier와
의도는 유사하지만 sandbox·보안 동작이 동일하다는 뜻은 아닙니다. Parent model·fallback과 native Agent 지원은 실제
UI/tool 결과로 확인합니다.

같은 session에서 `pnpm claude:native register --input <JSON-file>`로 등록한 manifest는 project hook과 Repo 역할 ask 규칙이
정확한 Agent 입력·grant·receipt를 연결하는 coordination record입니다. Manifest는 인증·업무 승인·model 설정이 아닙니다.
Healthy PreToolUse는 model 누락·불일치를 거부하고, PermissionRequest가 같은 입력에만 한 번 allow합니다. Hook 장애는
auto classifier가 아니라 사람 승인 prompt로 넘어가며(fail-safe to human), 같은 session/tool의 grant·receipt, source·의미 검증과
공통 QA가 완료에 필요합니다. `repo_*` 권한 prompt는 승인하지 않으며, 권한 규칙 편집은 새 세션에서 확인합니다. 이 경로만으로 generic native support나 `runtime-qualified`를
전역 선언하지 않습니다. 기존 headless qualification은 별도 legacy test이고 interactive auto evidence가 아니며,
cross-CLI bridge는 계속 unsupported입니다.
