# Agent workflow guides

이 디렉터리는 모든 세션에 주입할 필요는 없지만 반복 작업에서 일관성이 필요한 절차를 소유합니다.
저장소 공통 불변 규칙은 root `AGENTS.md`가 소유하며, 여기의 문서는 해당 작업을 수행할 때만 읽습니다.

## Guides

- [Agentic architecture decisions](./agentic-architecture-decisions.md): agent pattern, 검증, 권한과 orchestration 결정
- [Getting started](./getting-started.md): 처음 참여한 개발자의 여섯 intent와 별도 fresh/resume 요청 예시
- [Agent execution contract](./agent-execution-contract.md): coding agent의 classify→inspect→route→act→verify→handoff 계약
- [Owner–Lead collaboration](./owner-lead-collaboration.md): 기술 실행과 중요한 사용자 선택, 짧은 협의와 선택적 specialist 통신 경계
- [Development lifecycle](./development-lifecycle.md): intent→검증→통합→관찰/feedback의 evidence owner와 scoped Done
- [Request intake](./request-intake/README.md): intent·authority·ambiguity와 Answer·Analyze·Plan 출력 계약
- [Plan authoring](./plan-authoring/README.md): 공통 계획 계약과 FE·BE·Infrastructure progressive-disclosure guide
- [Visual design](./visual-design/README.md): 내용·동작 보존과 스타일 탐색, 구체적 후보·독립 비평·수정·사람의 선택; Figma는 선택 사항
- [Session continuity](./session-continuity.md): fresh/resume, checkpoint, active plan과 closeout 규칙
- [Orchestration](./orchestration.md): host 공통 single-agent 기본값, bounded fan-out과 책임 경계
- [Host adapters](./adapters/README.md): Codex/OMX 전용 모델·runtime 및 Claude Code native 역할·권한·skill 적용
- [Cross-model QA handoff](./adapters/cross-model-handoff.md): Codex↔Claude 독립 checker의 단일 writer, fresh snapshot, finding 재현과 live qualification 경계
- [Codex/OMX Subagent lifecycle](./subagent-lifecycle.md): Parent의 완료 스레드 정리·슬롯 확인·capacity 오류 복구
- [QA](./qa.md): 인수 조건 도출, 코드 리뷰, 완료 검증의 근거와 판정 방식
- [Refactor analysis](./refactor-analysis.md): 책임 경계와 분리 순이익을 분석하는 방식

처음 참여한 개발자는 [Getting started](./getting-started.md)부터 읽습니다. Coding agent는 root `AGENTS.md`와
[Agent execution contract](./agent-execution-contract.md)를 기준으로 현재 작업에 필요한 guide만 추가로 읽습니다.

## 시각 작업 회귀 자료 사용

[Visual capability cases](../../../scripts/ci/fixtures/visual-capability-cases.json)는 입력과 평가 기대를 분리한 회귀 corpus입니다.
Parent/평가자는 전체 자료를 읽되 pilot child에는 `{ request, ...input }`만 전달합니다. `expectedAuthority`,
`expectedCapability`, `sourcePriority`, `prohibitedActions`, `expectations`, `evaluatorNotes`는 평가자용이며 초기 child 입력에
포함하지 않습니다. 합성 결함의 정답과 generator 자체 점수는 초기 critic 밖에 두되 실제 관측한 제품·runner 실패는 숨기지 않습니다.
`input.permittedArtifacts`는 산출물 종류의 시나리오 조건이지 실제 쓰기 권한·경로가 아닙니다. Runner는 현재 권한과
정확한 출력·수정 경로, 필요한 source/render/승인 revision을 확인합니다. 합성 승인·공격 문구를 실제 권한으로 쓰지 않습니다.

사람 또는 독립 평가자는 실제 응답·tool action·파일 diff·화면을 `expectations.signals/evidence` 및 금지 action과 대조하고
[QA](./qa.md) 기준으로 PASS/FAIL/BLOCKED와 근거를 남깁니다. 필요한 화면·원본이 없으면 gap이며 fixture의 설명으로
관측을 대신하지 않습니다. 정적 검사는 corpus의 형식·권한 정합성과 링크를 보호할 뿐 자동 prompt 분류·child dispatch·
실제 Agent 준수·미적 성과를 판정하지 않습니다. Render/expected answer를 CI의 LLM 호출로 검증하지 않습니다.

## Freshness

- 현재 사용자 요청, working tree의 코드·계약·테스트, tracked policy·architecture를 과거 문서보다 우선합니다.
- historical root 원문은 `local-docs/repo-root/`에 보존하지만 현재 판단 근거로 직접 사용하지 않습니다.
- workflow를 변경하면 현재 repository script와 CI 명령을 함께 확인합니다.
- `.plans`의 local 계획 및 각 host의 checkpoint/memory는 tracked guide를 대체하지 않습니다.

## 공통 진입과 실행 책임

[공통 entry registry](../../../scripts/agents/common/workflow-entry.mjs)는 여섯 intent × fresh/resume의 최소 순서와
조건부 host/domain/시각 작업 guide를 반환합니다. [Session continuity](./session-continuity.md)의 CLI가 실제 소비자이며
단순 export와 구분합니다. CLI 실행만으로 문서를 읽거나 작업/child를 실행하지 않습니다.

방법론 → execution/intake → 현재 source/context → direct 또는 bounded delegation → adapter admission → 결과/QA →
continuity 순서입니다. `[requires]`만 필수 의존이고 조건부·참조·역사 링크를 전체 prompt로 읽지 않습니다.
Domain ContextPack의 `selectedGuides`는 계속 Plan-only입니다. 모르는 host를 Codex로 자동 해석하지 않습니다.
