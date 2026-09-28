# Codex/OMX child selection, model and context delivery

이 문서는 [공통 lane 계약](../request-intake/delegation.md)의 Codex 전용 확장입니다. Claude 모델 admission/runtime을 정의하지 않습니다. 구현 owner는 `scripts/agents/codex/`이며 제거된 root compatibility imports를 사용하지 않습니다. 일반 요청의 composition은 [Codex workflow entry](./codex.md#repository-workflow-entry)를 사용하고, 아래 API는 host policy leaf입니다.

## Candidate schema

```text
id / domain / taskKind / priority / impactRisk
objective / question
allowedEvidence[] / allowedTools[]
readScope[] / writeOwnership[]
dependencies[]
nonGoals[] / prohibitedAssumptions[]
expectedOutputFields[] / verification[]
stopCondition / handoffCondition
benefit: kind / rationale / value / evidenceIds
pass2Evidence: sources / facts / predicateClaims / inferences / gaps / confidence
modelRequest?: profileId / purpose / verificationFacts
```

`scripts/agents/codex/child-task-contract.mjs`는 candidate를 다음 typed handoff로 정규화합니다.

```text
objective / question
allowed evidence and tools
read-only boundary or distinct write ownership
non-goals / prohibited assumptions
facts / inferences / gaps / confidence output labels
verification / stop / handoff condition
installed role and effort recommendation
leader-only final decision, response, integration, verification
```

## Model recommendation

선택형 `modelRequest`는 기존 lane 또는 `selectAgentRoute()` 입력에서 같은 strict schema를 사용합니다.

```text
profileId: bounded-build | bounded-read | bounded-extract
purpose: pilot | routine
verificationFacts:
  bounded-read: acceptance / independentCheck
  bounded-build: acceptance / regression / astraQa
  bounded-extract: acceptance / fixedInput / outputSchema / singleStep / independentCheck
```

각 verification 값은 current Pass 2의 high-confidence `factId`입니다. Acceptance와 실행 가능한 검사/독립 확인,
구현 lane의 regression 및 Astra QA 계획을 실제 source에 근거해 작성합니다. Policy가 자연어 사실의 진실이나 앞으로
실행할 QA 성공을 인증하지는 않으므로 Parent가 원문 근거와 최종 결과를 확인합니다. 임의의 다른 fact를 연결해서는 안 됩니다.

[채택 범위와 cold-start 순서](./codex.md#routine-task-model-operation)를 확인한 일반 Parent는 매 bounded delegation에서 task/위험/검증 방법을 판정하고 적합한 `modelRequest`를 직접 채웁니다.
사용자에게 모델명을 매번 다시 선택하게 하지 않습니다. 단, cohort 채택과 이번 task의 실제 작업 권한은 별개입니다.
GPT-6 Sol은 bounded-build의 구현/test 또는 bounded-read의 lookup/analysis 후보입니다. Researcher는 bounded-read pilot만
가능하며 routine은 Astra입니다. GPT-6 Luna는 bounded-extract의 low-impact lookup/analysis 고정 입력·단일 semantic extraction만 후보입니다. Luna에는 무제한 조사·공식 웹 탐색·쓰기 권한을 부여하지 않습니다. 단순 grep/list/format이면 child 없이 도구를 씁니다.

입력 누락은 기존 default Astra 동작을 유지합니다. [Orchestration의 보수적 후보 조건](./codex.md#quality-gated-model-advice)을
충족하면 `routeRecommendation.modelRecommendation`에 request/taskKind/role, recommendedModel, candidate/baseline,
reason, `applied=false`, `profileBinding`을 붙입니다. 부적합 task·위험·품질 gap은 Astra baseline입니다.

중앙 owner는 `scripts/agents/codex/model-profiles.mjs`입니다. `profileBinding`은 profileId/policyRevision/profileDigest/model/
resolvedEffort/cohort이며, digest는 role/task/risk/검증 fact/tool 범위를 포함한 전체 profile data의 canonical hash입니다.
`routeRecommendation.effort`는 기존 semantic 위험 판정(Medium gate)을 유지하고, 실제 후보 호출에는 `resolvedEffort`를
사용합니다. Sol 두 프로필과 Luna extraction의 invocation effort는 모두 xhigh입니다. Semantic Medium eligibility는 그대로입니다. Context 상속·runtime·admission·native descriptor·
사후 검증은 같은 resolved effort를 사용합니다. Caller가 raw model/cohort를 주입하거나 GPT-5.6을 요청하는 구형 schema,
unknown profile/field/불완전 verification schema는 거부합니다. Astra default는 modelRequest 생략으로 유지합니다.

Child contract는 original task identity인 `modelTaskId`와 `modelScopeDigest`를 함께 전달합니다. Digest는 source digest에
연결된 semantic facts, 전체 profileBinding, 목적·role/effort/cohort, read/tool/write 범위, output/verification/stop/handoff, context delivery를 포함한
전체 contract의 정확한 JSON 표현에 연결됩니다. Field 순서까지 달라진 재직렬화는 재생성/재승인이 필요할 수 있습니다.
Hash는 무결성 대조값이지 source freshness·권한 증명은 아닙니다. 실제 파일/config 재확인은 Parent 책임입니다.

이 packet은 candidate 제안이지 pilot 허용서/운영 채택 GO가 아닙니다. [별도 model admission](../request-intake/orchestration-recovery.md#model-admission)이
없거나 불일치하면 dispatch는 Parent로 돌아갑니다. Candidate는 compatible한 fresh scoped context만 지원하며 full-history/reuse의
모델 변경을 추측하지 않습니다. Context gate와 runtime/model gate는 독립이며 하나의 성공이 다른 쪽을 생략하지 않습니다.

## Context delivery

`recommendDelegation()`의 선택 입력 `deliveryByLane`은 기존 lane ID별 context 전달 관측을 받습니다. 생략하면 기존
contract와 routing 동작을 그대로 반환합니다. 사용하면 선택된 child contract에 `contextDelivery`만 추가하며, 원래의
objective·scope·allowed tools·non-goals·금지 가정·output·검증·stop/handoff·role/effort·Parent 책임을 삭제하지 않습니다.
전달 packet은 이 **완전한 child contract 하나**이며 같은 contract나 전체 transcript를 다시 붙이지 않습니다.

```text
deliveryByLane[laneId]
  purpose: task | initial-review | review-delta
  mode: scoped | full-history | reuse
  effortMode: explicit | inherit
  rationale: string | null
  snapshot / evidencePointers[] / findings[] / failures[]
  previous: null | childId / laneId / role / sourceSnapshot / revalidatedForSnapshot
                    / sameOutcome / scopeUnchanged / independentReview
  runtime: null | freshness / scopedFork / fullHistoryFork / followup / explicitEffort
                   / fullHistoryWithExplicitEffort / effectiveEffort
```

- 독립 작업의 기본은 `scoped`: 필요한 snapshot·evidence pointer·finding/failure만 전달하고 상위 대화는 fork하지 않습니다.
  `AGENTS.md`와 공통 실행 계약·적용되는 하위 지침은 계속 적용됩니다. 전달 추천이 native 상속 지침을 대체하지 않습니다.
- `initial-review`는 fresh scoped context만 허용합니다. 이전 builder를 reviewer로 바꾸거나 full history를 주입하지
  않습니다. `review-delta`는 scoped 또는 검증된 같은 reviewer 재사용이며 최초 독립 리뷰라고 다시 부르지 않습니다.
- `reuse`는 같은 outcome·lane·role·scope와 **이번 snapshot에 대한 재확인**이 필요합니다. 새 snapshot 자체는 delta에서
  정상적이지만 stale 확인값을 재사용하지 않습니다. 불일치하면 scoped 재구성을 추천하고 `compatible=false`로 둡니다.
  실제 child 소유·상태·pending·결과 귀속은 [lifecycle 계약](../subagent-lifecycle.md#후속-작업과-fan-in)으로 별도 확인합니다.
- `full-history`는 사유와 actual schema 지원이 필요합니다. 명시적 effort와 full fork 조합을 지원하지 않으면 통과시키지
  않습니다. inherited/fixed effort는 이미 선택된 role effort와 같아야 하며 비용 때문에 낮추지 않습니다.
- 지원 불명·stale 관측은 `compatible=false`; **모든 결과의 `applied=false`**는 순수 추천이 native 설정을 적용하지 않았다는
  뜻입니다. 실제 role/model/권한은 dispatch gate에서 별도 확인합니다. role-compatible 결과만 보고 context gate를 생략하지
  않으며 Parent는 delivery `compatible`와 gaps까지 확인한 뒤 실제 schema에 맞춰 전달합니다.
- evidence pointer는 기존 read scope 밖으로 확장하지 않습니다. history·allowedTools 같은 임의 필드와 길이 초과 입력은
  거절하며 실패 내용·안전 지침을 조용히 자르지 않습니다. 긴 로그는 허용 scope 안의 원문 pointer와 정확한 실패 요약으로
  전달합니다. 이 전달 요청은 self-attestation이며 새 권한이나 접근 허용 목록을 만들지 않습니다.

`createDispatchRecommendation()`은 **공급된** `contextDelivery`의 `compatible=true`, `applied=false`, 빈 `gaps`를
확인하고 불일치/unknown이면 ordinary Astra에서도 dispatch 없이 `runtime-context-incompatible:<laneId>`를 반환합니다.
선택 입력을 **생략**한 legacy caller는 기존 advisory shape를 유지하지만, 이 생략은 실제 호출의 context 확인을 면제하지
않습니다. 필수 독립 QA가 막힌 경우 sequential disposition을 Parent self-review PASS로 바꾸지 않습니다.

Ordinary Astra의 native + scoped + explicit-effort 경로는 기존 role metadata의 `modelSelection`과
`explicitEffortSupport`를 확인합니다. Astra 지원, explicit model 지원, 호환 role pin, 기존 role/model/effort/permission
검사를 모두 통과할 때만 descriptor에 `spawnArguments={agent_type, model: gpt-6-astra, reasoning_effort, fork_turns: none}`을
연결합니다. Metadata가 없거나 충돌하면 ready descriptor 대신 명시 gap입니다. `failures`는 ordinary 전달에서 보존해야 할
근거이며 자동 거절 사유가 아닙니다. Candidate admission과 bound recovery의 별도 제한은 바꾸지 않습니다.

Compatible full-history/reuse/inherit 및 OMX advisory 경로를 fresh native spawn으로 변환하지 않습니다. Descriptor에는
Parent의 live 재확인이 계속 필요하며 실제 실행·provider-effective 설정을 증명하지 않습니다. 기존 source/권한 의미의
진실성까지 순수 helper가 인증하지 않으므로 Parent는 실제 host와 완전한 packet을 확인한 후에만 호출합니다.

기존 fresh-session smoke는 이 결과를 실제로 소비하되 **synthetic/no-native 실행**입니다. Fixture의 UTF-8 bytes와
중복 전달 감소는 token/weekly 절감이 아니며, 미관측 usage는 `null/unknown`입니다. 실제 fork 설정·사용량 관측은 별도
native 실행 evidence가 필요합니다. 비용 운영 기준은 [orchestration owner](../orchestration.md#context와-검증-비용)를 따릅니다.
Native의 numeric fork 지원 여부는 이 계약의 필수 확장 사유가 아닙니다. 실제 consumer 요구 없이 새 전달 모드를 만들지 않으며,
기존 complete packet·fresh initial QA·role/context 두 gate를 유지합니다. 결과 회수 후에는 [capability별 완료 판정](../subagent-lifecycle.md#capability별-완료-판정)을 따르고, 무관한 재사용이나 close 없는 환경의 실패를 기본값으로 가정하지 않습니다.

## Role and effort

`scripts/agents/codex/routing-policy.mjs`는 raw prompt나 task label만으로 role/effort를 확정하지 않습니다.

- Pass 1: TaskEnvelope의 intent·authority·impact risk와 candidate task shape를 보존합니다.
- Pass 2: current ContextPack source에 연결된 stable fact와 semantic predicate claim을 검증합니다.
- 역할: lookup/analysis는 `repo_explorer`, official research는 `repo_researcher`, implementation/debug/test는
  `repo_executor`, review/verification/architecture evidence lane은 `repo_reviewer`입니다.
- Effort: complete positive boundedness evidence는 Medium, mandatory/deep-composite evidence는 XHigh, 나머지 substantial
  evidence는 High입니다. Low/Max/Ultra는 repository child route가 아닙니다.

Impact risk와 reasoning complexity는 서로 다른 결과입니다. Keyword, path, file count, LOC, task label은 semantic signal을
대체할 수 없고, 동일 fact를 여러 composite category에 중복 반영하지 않습니다. 이 결과는 dispatch 명령이나 live role
proof가 아닙니다. Active surface evidence가 없으면 support unknown/applied false 상태로 두고 leader가 dispatch 직전에
runtime compatibility를 확인합니다. Native는 current-turn host tool schema, OMX는 current-session runtime overlay와
host-exposed role roster가 함께 있어야 하며 local config나 과거 session 결과는 active authority가 아닙니다. Parent effort는
이 contract 밖에서 사용자가 선택합니다.

## Count와 write policy

- Direct, deterministic, ambiguous, dependent, missing-Pass-2, low-benefit work: 0 child
- 독립적으로 가치 있는 bounded lane: 1 child 허용
- 일반 proactive fan-out: 최대 2 child
- Pass 2 evidence에 연결된 high-value third lane: 최대 3 child
- 명시적인 owner-directed fan-out: 최대 6 child
- 선택 가능한 write-capable child: 최대 1개
- sibling write scope가 겹치면 해당 lane들은 independent가 아니므로 선택하지 않음

각 `routeRecommendation`은 최종 effort뿐 아니라 validated Pass 2 assessment, evidence ID, confidence와
`runtime-role-evidence-deferred` gap을 함께 전달합니다. Keyword나 candidate의 legacy `risk` field로 이 근거를 대체할 수
없습니다.

## Ownership boundary

- assignment·재배정·scope/file owner 변경·결과 판정·통합은 Parent 책임입니다. Child 결과와 blocker는 Parent로 반환합니다.
- 기본 Parent 경유와 지정된 기존 사실 확인 예외는 [공통 협업 계약](../owner-lead-collaboration.md)을 따릅니다. 참여자·주제·
  read scope·snapshot 지정은 기존 task text/allowedTools/nonGoals로 전달하며 schema나 runtime 권한 필드를 만들지 않습니다.
- 도구 지원만으로 peer 권한이 생기지 않습니다. 초기 QA 독립성, 보고와 만료 조건을 지키고, 새 업무·상충·반복 의존성은
  Parent에게 돌려보냅니다. Child의 직접/간접 offload와 sub-child 생성은 허용하지 않습니다.
- Intake mapper는 child를 생성하지 않습니다.
- ContextPack registry는 lane을 만들지 않습니다.
- Child contract policy는 spawn, retry, reallocation, tmux 또는 workflow state를 실행하지 않습니다.
- `orchestration-policy.mjs`는 existing native surface를 사용하기 전 leader가 최종 독립성과 runtime capability를
  다시 확인할 수 있는 advisory result를 제공합니다.

### Recovery child context

`createRecoveryChildContract({ primaryContract, sourceSnapshot })`는 기존 primary의 task/lane/role·semantic effort와
owner/tool/verification 경계를 복제하고 candidate recommendation만 제거합니다. 현재 rescue snapshot으로 scoped explicit
context와 scope digest를 갱신하며 recovery를 가짜 candidate로 만들지 않습니다. 이 helper 자체는 실패·권한을 승인하지 않습니다.

`assertRecoveryChildContract(contract, recoveryBinding)`은 current binding, 원래 boundary/allowed ownership digest,
rescue task/lane/source scope, semantic risk와 scoped task context를 확인합니다. Recovery invocation의 low는 별도 binding과
runtime resolution에서만 해석됩니다. Ordinary delivery effectiveEffort의 low/max, inherited/full-history rescue는 계속 거절합니다.
`evaluateRecovery`에서 원래 primary 실패·현재 contract를 검증한 뒤 새 admission을 받아야 하며 source 변경이 쓰기 범위 확대를
허용하지 않습니다. 자세한 입력은 [bound recovery](../request-intake/orchestration-recovery.md#bound-recovery-selection-and-admission)를 따릅니다.
