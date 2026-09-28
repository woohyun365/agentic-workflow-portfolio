# Session continuity

새 session은 이전 transcript를 복제하는 대신 현재 repository evidence로 작업을 재구성합니다.

공통 계획·인계 계약은 host와 독립적입니다. 실제 대화/child/state 재개는 선택한
[host adapter](./adapters/README.md)의 지원 여부와 현재 권한으로 확인합니다. 저장된 경로나 Plan ID만으로
소유권·실행 승인이 생기지 않습니다.

공통 읽기 경로 진단은 다음 명령을 명시적으로 호출할 수 있습니다. 자동 hook이나 dispatch가 아닙니다.

```sh
node scripts/agents/common/workflow-entry.mjs --host claude-code --mode fresh --request '변경 내용을 설명해줘.'
node scripts/agents/common/workflow-entry.mjs --host codex --mode resume --request '지정 작업을 분석해줘.' --plan .plans/example-plan.md
```

Host는 Lead가 실제 session을 확인해 명시합니다. 다른 host 이름을 쓰거나 경로를 전달해 권한·모델을 가장하지 않습니다.
Common CLI는 문서 readset·기존 ContextPack과 선택된 계획 metadata만 반환합니다. Fresh는 계획·memory를 탐색하지 않습니다.
Git 기준점은 `git branch --show-current`, `git rev-parse HEAD`, `git status --short`로 직접 확인합니다.
`pnpm codex:preflight`는 **Codex/OMX 전용 snapshot CLI**이며 공통 CLI의 alias가 아닙니다.

## Fresh task

1. current user request를 읽습니다.
2. branch, `HEAD`, `git status --short`를 확인합니다.
3. 요청과 직접 관련된 production code, contract, test, tracked docs만 읽습니다.
4. 사용자가 plan을 명시했거나 작업 복잡도가 요구할 때만 active plan을 읽습니다.
5. notepad, context snapshot, wiki, project memory, finished plan을 기본 입력으로 읽지 않습니다.

## Resume task

다음 중 하나가 참일 때만 resume 경로를 사용합니다.

- 사용자가 `이어서`, 특정 plan 또는 phase 재개를 명시함
- current request가 같은 task를 계속하는 내용이고, 그 task의 명시적으로 확인한 active workflow가 존재함
- current request가 interruption 또는 compaction 이후 같은 task의 계속을 요구하고, bounded checkpoint가 존재함

notepad priority, context snapshot 또는 active runtime이 존재한다는 사실만으로 fresh request를 resume으로 바꾸지 않습니다.
항상 current request가 같은 task의 연속성을 나타내는지 먼저 확인합니다.

Resume 순서:

```text
current request
→ branch / HEAD / working tree
→ explicit selected plan / task identity
→ 선택한 adapter가 지원하는 bounded context diagnostics (선택 사항)
→ relevant plan checkpoint (사용 가능성 확인 후)
→ code/test/git log freshness verification
→ relevant tracked policy/architecture/runbook
```

checkpoint가 working tree나 최신 요청과 충돌하면 현재 판단 근거로 사용하지 않습니다. 다른 작업/세션의 파일을
자동 수정·삭제하지 않으며, 현재 작업 소유권과 권한이 확인된 경우에만 해당 checkpoint를 갱신합니다.

### Codex child 재개 (조건부)

다음 native cold-resume/operator 설명은 Codex에서만 읽습니다. 다른 host는 adapter의 관측된 lifecycle을 따릅니다.
부모 대화 resume과 child 재개/정리는 [Subagent lifecycle](./subagent-lifecycle.md)의 다른 자원 계약입니다.
누락된 native tool이 resume으로 생긴다고 가정하지 않고
[도구 미노출과 restart/resume](../troubleshooting/tooling/agent-thread-limit-reached.md#도구-미노출과-restartresume)에 따라
current schema·pending 작업·정확한 scope를 다시 확인합니다.

저장된 child ID는 현재 소유·실행 권한 증거가 아닙니다. Cold-root 이후 lazy reload를 지원하는 구현은 있지만 실제 적용과
재개 성공은 [Cold resume 경계](./subagent-lifecycle.md#cold-resume-경계)에 따라 재확인합니다. 목록에서 사라졌다고 영구 소실이나
자동 복원으로 판단하지 않습니다. 선택적 shared server, 정상 exit/resume, archive/delete의 서로 다른 영향은
[operator 절차](../troubleshooting/tooling/agent-thread-limit-reached.md#선택적-agents-운영과-정상-exitresume)가 소유하며 일반 resume 요청으로 서버 시작·전역 설정·history 정리를 실행하지 않습니다.

## Diagnostic contract

공통 진단은 요청·source identity·계획 상태·불완전한 evidence를 구별합니다. Codex의 실제 preflight JSON과 OMX priority/context 필드는 [Codex diagnostic contract](./adapters/codex.md#diagnostic-contract)가 소유합니다.

### Identity and freshness

공통 plan reader의 identity와 source 재확인에 host session metadata를 혼합하지 않습니다. Codex의 `taskMatch`/`freshness` 의미는 [host identity](./adapters/codex.md#identity-and-freshness)를 따릅니다.

### Bounded reads and failure handling

공통 reader의 bounded-path/중복/상태 검사는 아래 lifecycle 계약을 따릅니다. Codex context의 경로·read budget·fallback은 [host bounded reads](./adapters/codex.md#bounded-reads-and-failure-handling)에서 확인합니다.

## Portable handoff

로컬 context 파일이 있다고 다른 clone/기기가 재개할 수 있는 것은 아닙니다. 장기 결정과 불변 조건은 기존 policy/architecture
문서에, 구현·검증 evidence는 PR/테스트/CI에, 미해결 작업은 기존 Issue에 둡니다. 필요한 경우 outcome, acceptance,
evidence 링크, blocker와 다음 행동만 이 owner들에 연결합니다. raw plan/transcript/checkpoint 전체를 추적하지 않습니다.

로컬 기억이 없으면 tracked code/contract/test와 Issue/PR에서 재구성합니다. 필요한 portable evidence가 없으면 gap으로
명시하고 재조사하며, 결과를 바꾸는 중요한 결정이 빠졌을 때만 질문합니다. 과거 답변이나 pointer만으로 채우지 않습니다.

### 기억 없는 checkout에서 이어받기

```text
current request + AGENTS.md
→ branch/HEAD/working tree + 최소 tracked owner 문서
→ 권한 있는 current work item과 연결 PR/검증 근거
→ 다음 한 가지 작업의 outcome/결정/acceptance/non-scope/dependency 확인
→ 현재 code/test와 delta 대조 → 필요한 계획·readiness → 승인된 작업
```

1. 요청에 Issue URL/번호가 있으면 현재 본문·최신 결정 댓글·연결 PR의 상태를 읽는다. 없으면
   [Work item discovery](../github/issues-and-work-tracking.md#이어받을-work-item-찾기)에 따라 해당 owner 범위에서 찾는다.
   전체 backlog의 최신 번호나 local 파일명만으로 다음 작업을 고르지 않는다.
2. 인계에는 축약 문자만이 아닌 **작업 전체 이름**, outcome, accepted decision, AC, source/test, 선행 조건과 다음 단일
   행동이 있어야 한다. 조건부 작업은 trigger·필요 evidence·Owner 판단·NO-GO/종료 조건을 함께 읽는다. 이전 작업의
   완료나 패키지 설치만으로 조건부 작업을 자동 활성화하지 않는다.
3. 과거 계획이 없더라도 위 정보가 충분하면 tracked plan-authoring 규칙으로 현재 baseline의 bounded plan을 작성할 수
   있다. 원문 전체 복제는 필요 없지만 중요한 요구가 빠졌다면 재설계로 채우지 않고 gap/OQ로 남긴다. 분석 요청을
   구현이나 새 plan 생성으로 확대하지 않으며, 과거 readiness는 현재 변경의 검증을 대신하지 않는다.
4. GitHub 접근 불가와 work item 없음은 구분한다. 인증·권한·offline·검색 범위 제한을 보고하고 기존 인증 owner 경로를
   따른다. 확인하지 못한 Issue 상태/댓글/다음 순서를 만들거나 private archive·다른 세션을 뒤져 빈칸을 채우지 않는다.
   안전한 tracked-source 조사는 계속하되, 빠진 결정이 필요한 실행은 멈추고 Issue URL·허용된 본문 또는 Owner 결정을 요청한다.

개발자 요청 예시:

> 이 checkout의 AGENTS.md와 Issue #N의 현재 본문·결정 댓글·연결 PR을 읽고, 다음 Backend 작업 한 가지의 범위와
> 수용 기준을 설명해줘. 로컬 계획이나 지난 대화는 없다고 가정해줘. 근거가 부족하면 무엇이 필요한지 알려주고
> 아직 구현하지 마.

이 경로는 문서 기반 협업 계약이며 모든 prompt를 가로채는 hook, 자동 Issue fetcher 또는 자동 작업 선택기가 아니다.
Portable 인계 성공을 주장할 때는 고정 commit의 실제 history-free checkout에서 허용된 Issue 접근 사례와 접근 불가
사례를 나눠 검증한다. 기존 preflight fixture나 대화만 분리한 shared-filesystem child는 이를 대신하지 못한다.

### 원본 보존과 인계는 다른 책임

재생성 가능한 출력과 당시 상황을 다시 얻을 수 없는 관측 원본은 [Artifact 보존 규칙](../../../artifacts/README.md#보존과-정리)을
따른다. 원문을 외부에 보관했더라도 현재 결정·AC가 private 경로에만 있으면 portable handoff가 완료된 것이 아니다.
반대로 핵심 인계가 끝났다고 역사 원본이나 다른 작업의 유일한 근거를 삭제할 권한이 생기지도 않는다.

## Bounded checkpoint

Checkpoint는 다음 경우에만 만듭니다.

- context가 compaction에 가까움
- session interruption이나 handoff 직전
- multi-phase 작업의 commit/stage 경계를 완료함
- 다른 session이 즉시 이어받아야 함

내용은 [Agent execution contract](./agent-execution-contract.md)의 handoff schema를 따릅니다. 일반 turn마다 만들지
않습니다. 완료 시 해당 작업의 priority pointer는 현재 scope 소유권과 문서화된 lifecycle/API가 확인될 때만 비웁니다.
확인할 수 없으면 유지·보류하고 stale 입력을 사용하지 않는 진단을 남깁니다. 다른 세션의 pointer/state를 손으로 정리하지
않습니다. 승격된 context도 현재 참조·역사 원본 보존·정리 권한을 확인한 뒤 처리합니다.

## Active plan lifecycle

- 공통 authoring root는 `.plans/`입니다. Git/formatter에서 제외하며 runtime memory나 제품 source of truth가 아닙니다.
- top-level `Plan ID`·`Status`·owner·AC·source snapshot을 명시하고 task당 canonical path/writer 하나를 유지합니다.
- root `README.md`는 navigation이며 active plan이 아닙니다. supporting 상세와 독립 bounded plan을 구분합니다.
- 새 계획 생성은 승인된 planning 행동입니다. Analyze만 요청받고 계획 파일을 자동 생성하지 않습니다.
- 기존 legacy 원본은 actual caller 전환과 별도 승인된 migration receipt 이전까지 보존합니다. 자동 복사·이중 canonical
  root·symlink·전체 archive 검색으로 missing pointer를 숨기지 않습니다. 공통 reader는 legacy root로 fallback하지 않습니다.
- 완료 상태는 changed files, verification, commit/stage state와 blocker를 가리켜야 합니다.
- 현재 결정할 수 없는 provider/account/domain/instance 값은 tracked readiness/evidence handoff로 옮깁니다.
- 실제 AC를 충족한 완료 plan만 `.plans/finished/YYYY/MM/<domain>/`으로 이동합니다. current priority 해제는 위 소유권/lifecycle 경계를 따릅니다.

### Supporting 문서 재개와 인계

문서 유형과 분할 기준은 [Plan authoring core](./plan-authoring/core.md#supporting-detail-and-bounded-plans)가 소유합니다.
작업별 상세 문서는 `.plans/supporting/<parent-plan-id>/`에 둘 수 있으며 이 로컬 배치는 문서 유형이나 승인 상태를
결정하지 않습니다.

- 재개 시 부모의 이유·영향 Phase·dependency·disposition을 읽고 현재 작업에 필요한 supporting만 따라갑니다. 전체 하위
  트리를 재귀적으로 로드하지 않습니다. 자식 경로로 시작했으면 backlink의 부모 연결과 실제 상태를 먼저 확인합니다.
- 공통 `discoverPlans`는 root의 active/implementation-ready metadata 문서만 발견합니다. 중첩 supporting은 부모 링크 또는 명시적 경로로
  `readPlan`에 전달합니다. `README.md`·finished/cancelled·terminal·reference 문서는 명시적으로 선택해도 재개 후보가 아닙니다.
  비실행 상세는 header에 `- Document Type: reference`를 선언합니다. supporting/pending 위치나 status 한 줄만으로
  참고 자료라고 추측하지 않으며, 유형 선언 중복/미지원 값 또는 실행 metadata 누락은 해당 문서를 unknown으로 남깁니다.
  `assessPlanContinuation`은 명시적 resume·Plan ID·branch/HEAD/diff hash 일치를 검사하며 결과는 승인 아닌 후보입니다.
- Header는 처음 unfenced `## ` heading 또는 EOF까지이며 최대 64 KiB만 파싱합니다(경계 확인용 1 byte 추가 읽기).
  완전한 header 뒤 큰 본문은 읽기 실패가 아닙니다. Header 경계 미확인·미종결 fence·short read·읽기 실패와
  512개 filesystem entry 한도/unsafe path는 identity 검사를 불완전하게 하여 재개와 discovery 후보를 차단합니다.
  Fenced/indented 예시, blockquote, 본문의 선언은 canonical metadata가 아닙니다.
- `complete`/`issues`는 전체 corpus의 metadata 감사 결과이며 readiness로 재정의하지 않습니다. `identityComplete`/
  `identityIssues`는 모든 header의 선언 검사와 중복 검사가 완료됐는지 별도로 표시합니다. 모든 실제 canonical ID는
  reference·README·archive·terminal에도 중복 검사하며, 잘못된 ID 문법/중복 ID 필드는 fail-closed입니다.
  완전한 header에서 ID 부재를 확인한 unknown 문서나 무관한 lifecycle warning은 감사 gap으로 보존하되 정상 selected
  plan을 전역 차단하지 않습니다. 해당 malformed 문서 자체는 재개할 수 없습니다. `readPlan`은 선택 문서 state/reasons와
  corpus 감사/identity 결과를 함께 반환합니다. 불완전한 감사를 전체 PASS라고 하지 않으며, 파일이 이동됐으면 새 명시적 경로를 확인합니다.
- 로컬 supporting 파일만으로 다른 clone에 인계됐다고 판단하지 않습니다. [Portable handoff](#portable-handoff)에 따라
  현재 결정·AC·evidence·blocker·다음 행동을 권한 있는 기존 Issue/PR 또는 canonical 문서에 남깁니다. Raw 계획 전체를
  추적하거나 local 경로를 장기 결정의 유일한 근거로 삼지 않습니다.
- 완료·보관 시 부모/자식 링크와 상태 요약을 함께 확인하고, 실제 이동 경로에 맞게 링크를 보정합니다. 독립 미완료 plan은
  부모와 함께 완료 처리하거나 finished 아래에 묻지 않고 active 진입점과 portable work item에서 발견 가능하게 유지합니다.
  원본 보존과 runtime 상태 정리는 각각 기존 보존·소유권 경계를 따릅니다.

### 취소·대체 종료와 host 교체

- AC 미충족 작업의 취소/대체는 `cancelled` 또는 `superseded`로 기록하고 `.plans/cancelled/YYYY/MM/<domain>/`에 보관합니다.
  실패·미입증·대체 plan 연결을 보존하고 `finished`로 표시하지 않습니다.
- 인계 시 Plan ID/path, branch/HEAD/diff, 변경·검증·blocker·다음 행동, 이전 writer 해제와 새 writer를 명시합니다.
  두 host가 동시에 같은 파일을 쓰지 않습니다. 이전 reasoning 대신 source/AC·재현 가능한 evidence를 독립 QA에 줍니다.
- Host와 선택적 orchestration plugin은 같은 repository 계획을 소비하도록 [adapter](./adapters/README.md)에서 연결합니다.
  실제 로딩·대화/session 기능은 각 adapter의 관측 대상이며 공통 continuity가 지원을 보장하지 않습니다.
- native/plugin이 별도 위치에 만든 초안은 출처와 채택 여부를 기록한 뒤 명시적으로 repository 계획으로 채택합니다.
  미지원 설정을 Home/plugin 패치로 가장하거나 runtime state를 옮기지 않습니다. 해당 모드의 미지원만 표시합니다.

## Closeout

작업 종료 시 plan과 notepad를 진행 결과처럼 보고하지 않습니다. 실제 파일 변경, 검증 결과와 blocker를 보고하고 active
runtime이 있다면 지원 API와 정확한 소유권으로 정리합니다. 미지원 종료는 완료로 가장하지 않습니다. local state가 tracked source of truth를 대신하지 않게 정리합니다.

Host별 자동 기록·보존 설정은 해당 [adapter](./adapters/README.md)가 소유합니다.
