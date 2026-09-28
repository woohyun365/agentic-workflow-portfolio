# Repository-guided parent–subagent orchestration case study

> **Audience:** human-to-human portfolio, onboarding, and engineering discussion reference.
> 이 문서는 `AGENTS.md`나 agent workflow를 대체하는 instruction owner가 아닙니다. 현재 실행 규칙은
> [Agent orchestration](./agent-workflows/orchestration.md)과 연결된 tracked contract가 소유합니다.

## 요약

Roommate Matching는 처음부터 multi-agent를 기본값으로 두지 않았습니다. 먼저 single-agent가 현재 request, code, contract,
test와 policy를 읽고 직접 구현·검증할 수 있는 repository harness를 만들었습니다. 이후 작업 규모가 커지면서 다음 문제가
분명해졌습니다.

- 사용자 개인 설정에 따라 child role·model·effort가 달라질 수 있었습니다.
- 요청 문구의 위험 단어와 실제 repository semantic complexity를 같은 축에서 판단했습니다.
- 독립 lane이 하나뿐인 경우를 배제하면서도, 반대로 여러 child의 shared write를 충분히 제한하지 못했습니다.
- 설치된 role이나 boolean capability만 보고 active runtime이 실제 model·effort를 제공한다고 오인할 수 있었습니다.
- exploration log와 중간 결과가 parent context를 오염시키는 문제를 줄이면서도 최종 판단은 한 곳에 남겨야 했습니다.

이를 해결하기 위해 repository는 **Repository-guided parent–subagent orchestration with adaptive child reasoning**을
구성했습니다. **Astra를 안전한 기본값으로 유지하면서 검증 가능한 한정 작업에는 GPT-6 Sol/Luna xhigh를 실제 배정**합니다.
Semantic 난이도 판정과 호출 model/effort를 분리하고, 각 task의 지원·권한·독립 검증·한 번의 Astra 복구 조건을 연결했습니다.
Parent Astra high는 owner가 선택한 후속 운영 시작값이며 실제 session 적용·품질 관측은 별도입니다. 어려운 전체 판단은
Parent xhigh, 좁게 분리 가능한 깊은 문제는 Astra xhigh child를 검토합니다.

Direct work는 child-free이며, 독립성과 순이익이 확인된 lane만 bounded child contract가 됩니다. 이 contract는 자동 spawn
engine이 아니며 실제 dispatch 직전의 live runtime 확인과 Parent의 최종 판단을 대신하지 않습니다. **2026-09-25의 아래 확장 기록은 PR 생성 전 로컬 검증을 기준으로 작성했습니다.**
이후 원격 CI·merge 상태는 해당 PR과 Git 이력에서 별도로 확인하며 과거 병합 이력과 구분합니다.

## 권한과 evidence 경계

이 문서의 목적은 구현 경험을 설명하고 현재 evidence로 다시 검증할 수 있게 하는 것입니다.

- **Instruction authority:** `AGENTS.md`, `docs/development/agent-workflows/`, current code와 test
- **Human authority:** 제품·보안·법적 결정, provider/credential, 최종 UX, merge, production과 비용 수용
- **Agent responsibility:** bounded exploration, 공식 근거 조사, 구현, review, test와 evidence handoff
- **Evidence priority:** current tracked source/test → 해당 snapshot의 검증·날짜가 있는 관찰 → merged PR/commit → external context
- **Portable evidence:** 이 문서의 실험 요약은 날짜·조건·표본·한계를 보존한 Parent 기록입니다. Raw local 산출물 없이도
  설계와 정적 회귀는 재검증할 수 있지만 과거 native 호출을 이 요약만으로 독립 재현·인증할 수는 없습니다.
- **제외:** raw chat·개인 설정 내용, 다른 clone이 읽어야 하는 ignored 파일, 확인되지 않은 생산성·채용·운영 효과

## 이전 상태에서 확인한 문제

기준점은 PR #385 직전의 tracked tree와 그 당시 orchestration contract입니다. 아래 command는 개인 설정이나 local
artifact 없이 과거 Git tree에서 다시 실행할 수 있습니다.

```bash
git ls-tree -r --name-only e8624c65 .codex
git show e8624c65:docs/development/agent-workflows/orchestration.md
git show e8624c65:docs/development/agent-workflows/request-intake/delegation.md
```

| 확인한 상태                       | Engineering consequence                                                                                   | 재현 가능한 evidence                                                                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| project `.codex`가 없음           | clone마다 user/global role·model·effort가 달라질 수 있고 repository가 같은 child baseline을 보장하지 못함 | 위 `git ls-tree`와 .codex tracking 도입 PR #385 (private repository)                                                                                                            |
| lookup은 Low                      | 큰 repository의 symbol 관계·owner 탐색도 lexical task kind만으로 낮은 effort에 고정될 수 있음             | 이전 orchestration contract (private repository)                                         |
| 독립 lane 최소 2개 요구           | independently valuable lane 하나는 사용하지 못하고, count가 value보다 먼저 판단됨                         | 이전 delegation contract (private repository)                                |
| architecture만 제한적 XHigh       | transaction·migration·lifecycle·trust boundary 같은 deep non-architecture work가 High에서 멈출 수 있음    | 같은 이전 delegation contract의 role/effort table                                                                                                                                                                 |
| lexical risk와 complexity 결합    | “실패 시 위험함”과 “추론이 어려움”이 한 route에 섞여 keyword가 effort의 대리 신호가 됨                    | routing contract 전환 PR #386 (private repository)과 [routing regression](../../scripts/ci/codex-routing-policy.test.mjs)                                                       |
| repository inspection 재평가 없음 | 같은 request라도 실제 transaction·contract·state evidence에 따라 effort를 다시 고를 구조가 없음           | [Pass 1/Pass 2 decision](./agent-workflows/agentic-architecture-decisions.md#da-009--child-reasoning은-repository-evidence로-두-번-판정)과 [same-request fixture](../../scripts/ci/codex-routing-policy.test.mjs) |
| boolean 중심 runtime 판정         | 설치 파일이나 caller assertion을 active role/model/effort authority로 오인할 수 있음                      | runtime evidence 전환 PR #387 (private repository)과 [runtime capability fixture](../../scripts/ci/fixtures/codex-runtime-capability-cases.json)                                |
| sequential route의 effort `null`  | child-free route의 값이 parent routing인지 “child를 선택하지 않음”인지 책임이 불분명함                    | [parent-effort isolation regression](../../scripts/ci/codex-routing-policy.test.mjs)과 [current parent/child boundary](agent-workflows/adapters/codex.md#reasoning-effort-routing)                                |
| prose와 runtime 경계 중복         | 여러 guide의 설명과 advisory code가 실제 spawn/lifecycle authority처럼 해석될 여지가 있음                 | [current delegation ownership boundary](./agent-workflows/request-intake/delegation.md#ownership-boundary)와 [runtime recovery contract](./agent-workflows/request-intake/orchestration-recovery.md)              |

“개인 설정 drift”는 특정 개인 파일의 내용을 durable evidence로 보존한다는 뜻이 아닙니다. Tracked project default가 없으면
clean clone이 user/global setup에 의존한다는 구조적 문제를 뜻합니다.

## 문제를 engineering system으로 재정의

목표는 “AI가 더 많은 코드를 쓰게 하기”가 아니었습니다. 다음 trade-off를 명시적으로 다루는 실행 환경을 만드는 것이었습니다.

1. **Portability:** clean clone도 같은 project role과 child default를 발견해야 합니다.
2. **Context budget:** 탐색·로그·외부 조사 중간 산출물을 parent conversation에 모두 쌓지 않습니다.
3. **Delegation cost:** child는 추가 token, latency, coordination 비용이 있으므로 direct path보다 이득일 때만 사용합니다.
4. **Write conflict:** parallel read는 허용해도 proactive write owner는 하나로 제한합니다.
5. **Runtime honesty:** config에 role이 있다는 사실과 현재 host가 그 role/model/effort를 제공한다는 사실을 구분합니다.
6. **Human authority:** model이 잘할 수 있는 일과 사람에게 남겨야 하는 결정을 별도로 판단합니다.

## Architecture label과 실제 mapping

외부 개념을 비교하기 위한 분석 표현은 다음과 같습니다.

> **Repository-aware hierarchical orchestrator–worker architecture with adaptive inference allocation**

이는 provider가 정의한 고유 제품명이나 이 repository가 그대로 구현한 표준 architecture name이 아닙니다. 다음 요소를
비교하기 위한 **synthesized analytical label**입니다.

| 분석 표현                     | Repository implementation                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Repository-aware              | current request → `AGENTS.md` → `TaskEnvelope` → `ContextPack` → current code/contract/test evidence                  |
| Hierarchical                  | owner-facing parent가 child를 선택하고, child는 sibling이나 global plan을 지휘하지 않으며 결과는 leader-only fan-in   |
| Orchestrator–worker           | parent의 model-mediated lane 선택과 Codex native child surface를 결합하지만 별도 scheduler를 구현하지 않음            |
| Adaptive inference allocation | Parent effort는 session owner 선택; child semantic Medium/High/XHigh와 finite task profile의 호출 model/effort를 분리 |

Repository canonical label을 더 좁게 정한 이유는 구현 범위를 정확히 드러내기 위해서입니다.

> **Repository-guided parent–subagent orchestration with adaptive child reasoning**

- “repository-guided”는 repository가 recommendation과 guard를 제공하지만 host runtime을 대체하지 않음을 나타냅니다.
- “parent–subagent”는 owner-facing parent가 user interaction과 synthesis authority를 유지함을 나타냅니다.
- “adaptive child reasoning”은 Parent 설정을 자동 변경하지 않고 child의 semantic 난이도와 task profile을 근거로 선택함을 나타냅니다.

## 선택한 구조

```text
human request and authority
  → parent session (owner-selected Astra; high start / xhigh escalation)
    → Pass 1: intent / authority / impact risk / candidate shape
      → direct-first gate
        ├── deterministic or dependent work → parent direct/sequential
        └── independent candidate lane
              → ContextPack and current repository inspection
                → Pass 2: source / fact / predicate evidence
                  → semantic role / Medium / High / XHigh assessment
                    → default Astra or eligible finite Sol/Luna xhigh profile
                      → current task admission + live runtime compatibility
                        ├── compatible → native dispatch → independent quality evidence
                        └── unsupported / failed → stop or one bounded Astra recovery
                              → leader-only evidence integration and capability-aware cleanup
```

### Risk와 reasoning complexity 분리

Impact risk는 실패했을 때의 피해와 필요한 사람의 authority를 나타냅니다. Reasoning complexity는 current repository
evidence를 이해하고 올바른 결론을 내리는 난이도입니다. 보안·production처럼 risk가 높은 작업도 단순 확인일 수 있고,
반대로 표면상 harmless한 refactor도 transaction·concurrency·lifecycle invariant 때문에 XHigh가 필요할 수 있습니다.

- Pass 1은 request의 intent, authority, impact risk와 candidate shape만 보존합니다.
- Pass 2는 current `ContextPack` source에 연결된 fact와 predicate를 검증합니다.
- 모든 boundedness evidence가 positive면 Medium, mandatory semantic signal 또는 deep composite면 XHigh, 그 외 substantial
  work는 High입니다.
- keyword, path, file count, LOC, task label만으로 XHigh를 선택하지 않습니다.

### Count와 write ownership

- 기본값은 0 child입니다.
- 독립적이고 가치 있는 lane 하나도 허용합니다.
- 일반 proactive recommendation은 최대 2개입니다.
- Pass 2 evidence에 연결된 high-value third lane만 3개까지 허용합니다.
- owner가 명시적으로 확장한 native/manual capacity는 최대 6개입니다.
- proactive write-capable child는 최대 하나이며 scope가 겹치면 sequential fallback입니다.

이 count는 “많을수록 좋다”는 성능 주장이 아닙니다. 현재 contract를 반박하는 품질·wall time·conflict evidence가 축적되면
재검토할 operational boundary입니다.

### Runtime truthfulness

Tracked `.codex`는 portable default와 role contract를 제공하지만 active authority를 만들지 않습니다. Dispatch 직전에는
current host surface의 role availability, explicit model/effort 지원, role pin과 permission을 다시 확인합니다.
Requested/resolved 값과 관측된 provider-effective metadata는 별개이며 미노출 effective 값은 null입니다.

현재 runtime evidence는 `leader-reported-not-host-authenticated`입니다. 즉 repository validator가 typed input의 모순을
검사할 수는 있지만, provider가 서명한 immutable effective metadata는 아닙니다. 조금이라도 불일치하면 role을 prompt label로
가장하지 않고 direct/sequential로 돌아갑니다.

## 대안과 결정

| 대안                                            | 결정        | 근거                                                                                                   |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| user/global child config만 유지                 | 기각        | clean clone portability와 reviewable project role contract를 보장하지 못함                             |
| project child default와 role만 추가             | 불충분      | lexical routing, count/write conflict, runtime truthfulness 문제를 해결하지 못함                       |
| 모든 lookup을 Low로 비용 최적화                 | 기각        | repository owner·contract 관계 탐색을 task label 하나로 축소함                                         |
| 최소 2개 또는 가능한 lane 전부 fan-out          | 기각        | 한 lane의 가치와 direct path를 배제하고 context·coordination 비용을 키움                               |
| 0~2개, evidence-backed third, owner max 6       | 채택        | 독립성·semantic benefit과 native capacity를 분리하면서 한 개 child도 허용                              |
| 여러 write-capable child                        | 기각        | shared contract와 owner conflict 비용이 병렬화 이득보다 큼                                             |
| parent effort도 repository가 자동 선택          | 기각        | owner session 선택을 침범하고 실제 Parent effort를 repository가 추측하게 됨                            |
| Astra default + finite task profiles            | 채택        | semantic Medium/High/XHigh와 model invocation effort를 분리; 한정 Sol/Luna와 Astra 복구는 별도 gate    |
| boolean 또는 config 존재를 runtime proof로 사용 | 기각        | current host role/model/effort/permission과 다를 수 있음                                               |
| reported evidence + live reconfirmation         | 조건부 채택 | 현재 surface에서 가능한 보수적 경계이며 immutable host-authenticated metadata가 생기면 교체            |
| custom classifier/scheduler/lifecycle engine    | 기각        | Codex native lifecycle과 책임이 중복되고 모든 prompt를 deterministic하게 분류한다는 잘못된 확신을 만듦 |
| Ultra emulation 또는 autonomous factory         | 기각        | 목표는 Parent autonomy 확대가 아니라 bounded delegation·독립 검증·evidence hygiene임                   |

## Decision lineage

설계는 한 번의 prompt에서 확정되지 않았습니다.

1. 독립적인 외부 GPT planning session을 critic으로 사용해 기존 routing contract를 당연한 전제로 받아들이는 circular review를
   피했습니다.
2. 그 분석은 two-pass reasoning, risk/complexity 분리, semantic predicate와 domain signal이라는 hypothesis를 제시했습니다.
3. 이후 owner directive가 repository-selected parent effort와 child Max/Ultra 방향을 명시적으로 폐기했습니다.
4. 당시 retained design은 수동 XHigh/Max parent 아래 Sol child의 Medium/High/XHigh만 조절하도록 좁혀졌습니다.
   현재 모델 선택은 아래 migration evidence와 current contract를 따르며, 이전 결정 당시의 모델을 소급 변경하지 않습니다.
5. 가설은 source/test·owner directive·공식 문서·한정 native smoke로 나누어 검토했습니다. 미검증 품질·비용 가설은
   아래 한계로 남깁니다. Raw chat은 durable authority나 evidence로 사용하지 않습니다.
6. 2026-09-19~25에는 lifecycle의 close 의무를 capability별로 수정하고, 단일 모델 고정에서 finite task profiles로 확장했습니다.
   과거 5.6 후보와 당시 지원 NO-GO는 보존하며 GPT-6 성공으로 소급하지 않습니다.

## 구현 chronology와 evidence

| Merge                                                                                                                                                                     | 구현 책임                                                                                                                                    | Tracked evidence                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR #385 (private repository) / `6c9d1a52` (private repository) | project `.codex` allowlist, Sol/High child default, four bounded roles, parent config exclusion                                              | [.codex/config.toml](../../.codex/config.toml), [.codex/agents](../../.codex/agents), [project config contract](../../scripts/ci/project-codex-config.test.mjs), [tracking fixtures](../../scripts/ci/fixtures/project-codex-tracking-cases.json)                                                                           |
| PR #386 (private repository) / `fa819dca` (private repository) | Pass 1/Pass 2 separation, semantic effort predicates, one-to-three proactive lanes, owner-directed six, one-writer recommendation            | [routing policy](../../scripts/agents/codex/routing-policy.mjs), [child contract](../../scripts/agents/codex/child-task-contract.mjs), [routing regression](../../scripts/ci/codex-routing-policy.test.mjs), [child regression](../../scripts/ci/codex-child-task-contract.test.mjs)                                        |
| PR #387 (private repository) / `24b74185` (private repository) | bounded reported runtime evidence, model/effort/permission compatibility, live reconfirmation, one alternate recovery, leader-only synthesis | [orchestration policy](../../scripts/agents/codex/orchestration-policy.mjs), [runtime fixtures](../../scripts/ci/fixtures/codex-runtime-capability-cases.json), [orchestration regression](../../scripts/ci/codex-orchestration-policy.test.mjs), [fresh-session regression](../../scripts/ci/codex-fresh-session.test.mjs) |

각 PR은 product runtime을 바꾸지 않는 repository agent harness 변경입니다. PR 설명과 merge commit은 검증 command와 결과를
보존하며, 현재 behavior는 언제나 위 tracked source와 test를 다시 읽어 판정합니다.

### GPT-6 Astra 모델 계약 전환 — 2026-09-10

| 질문                                  | 결정과 근거                                                                                           | 검증 경계                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 왜 tool update만으로 끝내지 않았는가? | project child default와 네 role의 명시적 Sol pin이 별도로 남아 있었음                                 | [.codex 설정](../../.codex/config.toml), [role 모델 검사](../../scripts/ci/project-codex-config.test.mjs)                                                      |
| 왜 architecture는 유지했는가?         | 변경 요구는 child 모델 선택이며, two-pass·effort·count·single-writer 구조를 변경할 실패 증거는 없었음 | [routing contract](./agent-workflows/orchestration.md), [runtime policy](../../scripts/agents/codex/orchestration-policy.mjs)                                  |
| 어떤 회귀를 잠갔는가?                 | Astra positive, Sol/Terra/Luna mismatch, 지원하지 않는 child effort, role/permission/provenance 실패  | [runtime fixtures](../../scripts/ci/fixtures/codex-runtime-capability-cases.json), [orchestration tests](../../scripts/ci/codex-orchestration-policy.test.mjs) |
| 실제 실행은 어떻게 확인했는가?        | 파일·정적 테스트와 fresh native runtime 관찰을 분리                                                   | Codex app-server의 loaded thread model/effort, child 응답, hook 완료 이벤트와 owning OMX launch의 doctor를 대조                                                |

기존 Sol 구현에 Astra 기대값을 먼저 적용해 실패를 확인한 뒤 config·policy를 전환했습니다. 당시 targeted contract test는
48개가 통과했습니다. 이 결과는 모델 품질·비용·속도 개선 측정이 아닙니다. 재현 명령은 다음과 같습니다.

```sh
node --test scripts/ci/project-codex-config.test.mjs scripts/ci/codex-orchestration-policy.test.mjs scripts/ci/codex-intake-integration.test.mjs scripts/ci/codex-fresh-session.test.mjs
```

같은 날짜의 Codex `0.153.4` / OMX `0.21.3` 검증에서는 새 read-only parent가 Astra/XHigh로 로딩되고,
모델 override 없이 요청한 `repo_explorer` child가 Astra/High로 로딩된 것을 native `thread/read`에서 확인했습니다.
Child는 project config 읽기를 완료했습니다. `hooks/list`는 OMX hook 7개를 enabled/trusted로 반환했고,
SessionStart·UserPromptSubmit·PreToolUse·PostToolUse·Stop의 실제 완료 이벤트도 관찰했습니다.
Owning OMX launch의 승인된 `omx doctor`는 검증 전후 22/22, session binding usable이었습니다. Sandbox 내부에서는
process identity 조회가 제한됐지만, 같은 read-only 진단을 정상 권한으로 실행해 구별했으며 state를 삭제하지 않았습니다.

이는 해당 실행의 **native loaded configuration과 observed behavior** 증거입니다. Immutable/per-turn attestation,
모든 role/effort 조합, compact hook 실행, 동시성 한계의 실제 강제 집행까지 증명하지는 않습니다.
다음 dispatch도 fresh roster·permission 재확인이 필요하며, 이 기록을 미래 실행의 권한으로 재사용하지 않습니다.

[OpenAI 모델 문서](https://developers.openai.com/api/docs/models/gpt-6-astra)의 지원 effort 중 repository가 기존에
사용하던 Medium/High/XHigh를 유지했습니다. [모델 migration guidance](https://developers.openai.com/api/docs/guides/latest-model)의
instruction priority, bounded delegation, 간결한 보고와 검증 강도 관점은 기존 `AGENTS.md`·execution/orchestration contract에
대조했습니다. 동일 규칙을 추가 복사하거나 새로운 hook을 설치하지 않고 현재 모델 표현만 정합성을 맞췄습니다.

## 2026-09 task-aware 모델과 lifecycle 검증

### 문제와 대안

Owner가 weekly 한도가 빨리 소모된다고 관찰했지만 원인별 토큰·비용은 미계량이었습니다. 목표를 **싼 모델로 전면 교체**가
아니라 **Astra 기본값·독립 QA를 유지하면서 검증 가능한 작업만 낮은 단가의 모델에 맡기는 것**으로 제한했습니다.
함께 조사한 “완료 child를 항상 close해야 하는가?”도 task 완료와 runtime 자원 반환을 혼동한 문제로 재정의했습니다.

| 대안                                      | 판정과 trade-off                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 모든 child Astra 고정                     | 안전한 fallback으로 유지; 분명한 bounded 작업도 비싼 기본값에 묶이는 비용 기회는 남음                    |
| Sol/Luna를 전체 기본값으로 변경           | 기각; 미분류·고위험·독립 QA까지 작은 표본을 확대 적용하게 됨                                             |
| role × model별 TOML 복제                  | 기각; role 권한과 generation 변경 지점이 중복되어 drift·review 비용 증가                                 |
| 세 role의 pin 해제 + 중앙 finite profiles | 채택; executor/explorer/researcher의 model pin만 해제, project Astra/high와 reviewer Astra pin·cap6 유지 |
| 별도 provider adapter/자동 scheduler      | 기각; 기존 native contract가 호출 seam이며 새 SDK·실행 엔진이 필요하지 않음                              |
| 모든 host에 close 의무/강제 V2 전환       | 기각; live capability별 완료를 판정하고 backend 이름·자동 eviction을 추측하지 않음                       |

### 구현 경로와 방어선

```text
task / acceptance / source facts
  → semantic role + risk + complexity
  → finite profile binding (revision + digest)
  → scoped child contract + current source/config + bounded admission
  → supported native model/effort arguments (Parent가 실제 호출)
  → child/task 귀속 + independent quality check
  → success 또는 한 번의 Astra recovery / stop
  → sanitized attempt record + capability별 lifecycle disposition
```

- [중앙 profile registry](../../scripts/agents/codex/model-profiles.mjs): 모델별 TOML 대신 안정된 task ID가 세대별 모델·effort·
  tools·role·cohort를 가집니다. `bounded-build`, `bounded-read`, `bounded-extract`의 호출 effort는 xhigh지만 **대상 난이도는
  complete Medium evidence**가 필요합니다. xhigh 선택은 품질 우선 owner 정책이지 medium보다 재작업이 적다는 실측 결론이 아닙니다.
- [호출·결과 정책](../../scripts/agents/codex/orchestration-policy.mjs): role pin, current scope/config, 승인 기간·예산, context,
  exact task/profile/child 귀속을 확인합니다. Permission·quota·cap·지원 실패를 모델 교체로 우회하지 않습니다.
- [실행 기록](../../scripts/agents/codex/model-run-evidence.mjs): 최초 실패·원인 가설·조치·재검증과 recovery를 분리합니다.
  [기록 회귀](../../scripts/ci/codex-model-run-evidence.test.mjs)는 진단값과 성공·복구 자격을 분리합니다.
  원인 confidence와 근거 참조만 보존하며 secret·전체 대화·hidden reasoning을 수집하는 daemon이 아닙니다.
- [Lifecycle owner](./agent-workflows/subagent-lifecycle.md): `resultDisposition`, `cleanupDisposition`, `closeDisposition`,
  `releaseDisposition`을 분리합니다. Explicit-close, verified-no-close, unknown을 다르게 처리하며 close 미노출만으로
  managed cleanup을 증명하지 않습니다. 완료·interrupt·archive·빈 roster를 terminate/slot 반환으로 바꾸지 않습니다.
- [Cold resume와 선택적 운영](./agent-workflows/session-continuity.md): 저장 history와 runtime residency는 별개입니다.
  `/agents` shared server는 별도 control plane이지 child close 대체재가 아닙니다. 서버 시작·설정 변경·cap 우회는 하지 않았습니다.

로컬 구현 계보는 `3f58d5ee` lifecycle 의미 수정 → `f1be6cac` 세 pin 해제 → `ecf60e48` profile binding → `f7bee958`
xhigh·기록 → `630ed20c` bounded low 복구 → `c90c634f` context/QA 보완 → `f0130275` 한정 운영 채택입니다.
이는 **로컬 commit 이력**이며 위 과거 merged PR 표와 다른 상태입니다. 현재 동작은 링크한 source/tests가 소유합니다.

### 실제 관찰과 표본 범위

아래는 당시 동의된 read-only 또는 disposable fixture 실험의 요약입니다. Scope와 oracle을 **실행 전에** 고정했습니다.
현재 문서 정리를 위해 다시 호출한 실험이 아니며, fresh review 자체를 추가 모델 비교 표본으로 세지 않습니다.

| 날짜 / 조건                                                                                           | 관찰 결과                                                                                                   | 해석 한계                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-20, 같은 SHA의 별도 clean worktree 2개; Astra explorer/high 요청, fresh scoped context 두 arm | 확장 task context와 pointer-scoped 입력 모두 source map **5/5**, 별도 source-first QA PASS; 총 child3/turn3 | 한 task의 한 pair; full-history 대 scoped 비교가 아님. 당시 role pin 때문에 낮은 모델 활성화는 **NO-GO**, 품질 실패가 아님 |
| 2026-09-24, `bounded-build` / repo_executor / Sol xhigh                                                | disposable feed merge: child tests5/5, Parent oracle8/8, 독립 QA PASS                                       | 구현 표본1개; production 변경이나 모든 구현 작업 성능 보장 아님                                                            |
| 같은 날, `bounded-read` / repo_explorer / Sol xhigh                                                    | 고정 source4개의 owner·query navigation 의미 map, source oracle 및 독립 QA PASS                             | 조사 표본1개; 외부 research/새 도메인으로 확대 안 함                                                                       |
| 같은 날, `bounded-extract` / repo_explorer / Luna xhigh                                                | 고정 query transformation8건, executable oracle8/8·독립 QA PASS                                             | task1개 안의 case8개이며 모델 표본8개가 아님                                                                               |
| 같은 날, `astra-bounded-recovery` / repo_executor / Astra low                                          | **controlled** canary RED 후 fresh source binding·writer clearance, 복구 oracle9/9·독립 QA PASS             | Parent가 주입한 fault이며 Sol의 실제 miss가 아님. 원래 candidate와 failed primary attempt·rescue를 별도 보존               |
| 같은 날, fresh repo_reviewer / Astra high                                                              | 원본3결과와 복구1결과, 총4개 결과 독립 QA PASS                                                              | reviewer model 비교가 아님; Sol max 등의 reviewer 실험은 Owner-deferred/not-run                                            |

두 번째 실험은 **5 child / 5 turn, 동시1**, 승인 상한 합산40분 중 Parent의 call-to-result 관측 합계357,391ms
(약5분57초)였습니다. 이는 다섯 관측 구간의 합이지 준비·간격·후처리를 포함한 전체 작업시간이나 순수 추론 latency가 아닙니다.
2026-09-24 baseline은 `630ed20c`, profile revision `2026-09-24.3`입니다. 설치 CLI0.156.1 관찰과 실제 host build는
구분하며, 실제 native surface의 explicit model/effort 인자와 exact child/task final을 확인했습니다. **provider-effective
metadata는 미노출/null**로 유지합니다. Config 해석·요청 성공이 provider attestation은 아닙니다.

Controlled fault는 원본 품질 결과를 보존한 뒤 **primary의 terminal acceptance 전에** 주입했습니다. 따라서 원래 candidate
표본3/3 통과와 controlled primary 실패→Astra 복구를 동시에 기록하며, recovery 성공으로 최초 실패를 지우지 않습니다.
관측된 scope 위반0은 보고된 ownership·고정 파일·diff 검사 범위이며 숨은 도구/파일 접근 telemetry 보장은 아닙니다.

실험 worktree2개와 disposable workspace는 exact ownership·cleanliness·결과 보존 후 정리했습니다. Native child는 finals와
completed를 회수했지만 close 미노출·pending/residency 미관측이므로 **cleanup-unavailable / release-unverified**입니다.
일괄 process kill이나 다른 session/history 삭제는 하지 않았습니다.

### 한정 채택·세대교체·rollback

[운영 채택 결정](./agent-workflows/agentic-architecture-decisions.md#routine-model-adoption)은 위 세 profile/role과 executor의
controlled low 복구만 local cohort GO로 제한합니다. Researcher Sol·explorer/researcher low·deep failure·max·저가 reviewer는
미채택입니다. **Cohort GO ≠ 개별 task 승인 ≠ 모든 host 지원**이며 매번 current packet을 확인합니다.

[Profile 회귀](../../scripts/ci/codex-model-profiles.test.mjs)와 [dispatch 회귀](../../scripts/ci/codex-orchestration-policy.test.mjs)는
retired GPT-5.6 요청·구 revision/digest 승인·role pin 불일치·scope/config 변경을 거절합니다. 미래 세대는 기존 profile ID를
유지하되 새 revision, 지원 재검증, 해당 cohort 품질 근거·새 승인이 필요합니다. Synthetic next-revision 검증은 **GPT-7 실제
실행 이력이 아닙니다**. 자동 latest 전환도 아닙니다.

철회는 Parent가 admission을 회수해 candidate dispatch를 멈추고 Astra/direct로 돌아가는 방식입니다. **같은 유효 GO packet을
재전달하면 통과할 수 있으므로 영구 revocation service가 아닙니다.** Rollback도 마지막 허용 GPT-6 binding 또는 Astra-only를
**새 revision**으로 발행합니다. Old code와 grant를 함께 복원하면 과거 상태 재사용을 막는 monotonic history 보장은 없습니다.
완료 child history 복원, GPT-5.6 호출 부활, 권한 우회를 rollback으로 취급하지 않습니다.

## 비용 가설과 관측 한계

2026-09-25 확인한 [공식 Codex Standard 가격](https://learn.chatgpt.com/docs/pricing#token-rates)은 다음과 같습니다.
API USD 가격이나 구독 포함량이 아닌 **100만 토큰당 credits**입니다.

| Model       | Input | Cached input | Output |
| ----------- | ----: | -----------: | -----: |
| GPT-6 Astra |   250 |           25 |  1,250 |
| GPT-6 Sol   |    50 |            5 |    250 |
| GPT-6 Luna  |   2.5 |         0.25 |   12.5 |

같은 billable token 구성이라면 Sol/Astra=20%, Luna/Astra=1%라는 **단가 비율**입니다. 실제 task·weekly **절감률이 아닙니다**.
Xhigh의 output/reasoning, 재작업과 QA 양은 모델별로 달라질 수 있습니다. 비교하려면 **Parent + child + QA + 실패·복구 + setup**
전체를 포함해야 합니다. Included weekly allowance를 이 표로 고정 환산하지 않습니다.

| 비용/효율 가설               | 적용한 방법                                                    | 관찰과 미채택 범위                                                                                                   |
| ---------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 필요 context만 전달          | scoped packet, source·제약·acceptance·output 지정              | 한 pair 품질 통과; token 감소율·주입된 총 context 크기 미측정                                                        |
| 중복 primary 분석 축소       | 한 primary owner, source/test 포인터 회수; 필수 독립 QA는 예외 | workflow/회귀로 경계 보호; 실제 운영 시간·재작업 감소 미측정                                                         |
| 싼 단가를 적절한 작업에 사용 | finite Sol/Luna profiles + 지원·품질·Astra 복구 gate           | actual sample 가능성 확인; 모델 간 동일 task 비용/품질 비교 없음                                                     |
| Cache 활용                   | 안정된 공통 지침·schema를 불필요하게 흔들지 않기               | cache hit·cached/input/output·credits·USD·weekly delta 모두 **null**; API cache knob·padding·warmup·collector 미도입 |
| 불필요한 child 비용 제거     | 작은 결정적 작업은 child0, 필요한 같은 task만 followup         | idle thread 자체의 token 소비·close의 비용 환급을 가정하지 않음                                                      |

[공식 Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)은 안정된 prefix 재사용을 설명하지만,
실제 native prompt 구성·cache 적중률은 host/usage 관측이 필요합니다. 긴 무관 history를 유지하거나 API 설정을 Codex TOML에
복사하는 근거가 아닙니다. 관측되지 않은 cache/token/비용은 0이 아니라 null입니다.

따라서 성과는 **“품질 우선의 제한 모델 배정·검증·복구 workflow를 구현하고 한정 실제 호출을 확인했다”**입니다.
“비용 N% 절감”, “Astra와 동등한 품질”, “xhigh로 재작업 제거”는 주장하지 않습니다. 단가 우위는 도입 rationale이며 실측
부재만으로 한정 채택을 막지 않되, 실제 이익 검증과 구분합니다.

Reviewer 모델 비교는 Owner가 작성 전제의 착오를 확인해 **미실행 취소**했습니다. 불필요한 계획은 제거했으며,
위 날짜별 보류 이력은 비교 실험의 성공·실패 근거가 아닙니다. 운영 reviewer의 Astra pin과 독립 QA는 그대로 유지합니다.

## Parent high 시작과 품질 stop

Owner가 선택한 후속 기본값은 **Parent Astra high**입니다. 로컬 구현·전체 review gate를 완료한 다음 실제 host의 지원되는
session model/effort control에서 확인·선택합니다. CLI에서 `/model`을 제공하면 그 UI를 사용하고, 현재 schema에 설정 기능이
없으면 파일이나 숨은 API로 대체하지 않습니다. 이 문서 작성에서 전역·Parent·운영 reviewer 설정은 변경하지 않았으며,
**실제 Parent high 적용·품질·비용은 미관측**입니다. 구체 절차와 품질 stop은 [orchestration owner](agent-workflows/adapters/codex.md#parent-high-운영과-quality-stop)를 따릅니다.

- 필요한 context만 제공하고 primary 분석을 중복하지 않되 [독립 QA](./agent-workflows/qa.md)를 비용 이유로 생략하지 않습니다.
- 작은 작업은 Parent 직접, 격리 가능한 깊은 문제만 Astra xhigh child; 전체 framing·통합 자체가 어렵다면 Parent xhigh를 권고합니다.
- 첫 실제 task부터 acceptance 누락·substantive finding·scope 위반·재작업/복구 원인을 확인합니다. 보안·권한·데이터 invariant
  위반이나 허위 완료면 무인 계속을 멈춥니다. Source/환경/권한/검증 gap부터 고치고, 추론 부족·반복 누락이면 effort를 재검토합니다.
- Xhigh 상향은 원인 입증이나 품질 회복 보장이 아닙니다. 지원 불일치·필수 QA 부재를 effort로 우회하지 않습니다.

## Verification에서 드러난 실패와 repair

초기 runtime compatibility 구현은 semantic reviewer에서 두 가지 gap이 발견되었습니다.

1. caller가 `workspace-edit`, `readOnly=false`, 빈 `writeOwnership`을 함께 보고하면 one-write limit을 우회할 수 있었습니다.
2. retired workflow name 검사가 Markdown/JavaScript만 보고 tracked role TOML instruction을 포함하지 않았습니다.

PR #387은 두 gap을 expected-red regression으로 고정한 뒤 fail-closed boundary와 tracked TOML scan을 보강했습니다. 최종
merge evidence는 targeted agent suite 49/49, repository policy 297/297, clean-clone suite 36/36과 selected Monorepo CI를
기록합니다. 숫자는 해당 merge 시점의 test inventory이며 보편적인 품질·생산성 비율을 의미하지 않습니다.

2026-09-25 전체 로컬 변경의 fresh source-first review에서는 다음 두 결함을 별도로 재현했습니다.

- Post-execution 검사가 scope digest를 다시 계산한 잘못된 context/tool 경계를 받아들였습니다. Pre/post가 기존 cohort·
  scoped context·write ownership 검사를 공유하도록 보완하고, 세 profile 정상 결과와 변조 거절을 함께 검사했습니다.
- 기록 constructor가 실패의 requested/resolved/hostObserved 불일치까지 거절했습니다. 유효한 진단값은 failure/blocked로
  보존하되 success와 mismatch primary의 rescue 자격은 계속 거절하도록 수정했습니다. Low rescue의 observed high 실패도
  원형 보존합니다. 알 수 없는 model/effort를 허용하거나 실제 실행 권한을 넓힌 변경이 아닙니다.

두 repair의 기존 suite는 새 negative에서 **114 PASS / 3 FAIL → 117 PASS / 0 FAIL**로 전환됐습니다. 이것은 로컬
deterministic 검증이며, 모델 품질·native authority나 원격 CI 성공을 의미하지 않습니다. 위
[dispatch 회귀](../../scripts/ci/codex-orchestration-policy.test.mjs)와 [진단 기록 회귀](../../scripts/ci/codex-model-run-evidence.test.mjs)가
재현 owner입니다. 문서의 링크·경계 guard도 실제 관찰의 진실성이나 agent의 지침 준수를 자동 보증하지 않습니다.

현재 checkout에서 최소 재검증은 다음과 같습니다.

```bash
node --test \
  scripts/ci/project-codex-config.test.mjs \
  scripts/ci/codex-routing-policy.test.mjs \
  scripts/ci/codex-child-task-contract.test.mjs \
  scripts/ci/codex-orchestration-policy.test.mjs \
  scripts/ci/codex-model-profiles.test.mjs \
  scripts/ci/codex-model-run-evidence.test.mjs \
  scripts/ci/codex-subagent-lifecycle-contract.test.mjs \
  scripts/ci/codex-fresh-session.test.mjs
pnpm test:repo-policy
```

Native smoke는 current host/runtime가 필요한 live evidence입니다. 과거 smoke 결과를 새 session의 authority로 재사용하지
않고 dispatch 직전에 현재 surface를 다시 확인합니다.

## Human과 agent의 책임 분리

| Human owner                                                                | Parent agent                                                                                | Child agent                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 제품 정책, legal/privacy, provider/credential, 비용, 최종 UX, merge/deploy | request와 evidence 통합, direct/delegation 판단, conflict 해결, 최종 edit·verification·응답 | 하나의 bounded objective, 허용된 read/write scope, facts/inferences/gaps/verification handoff |

Child는 global plan, 최종 사용자 답변, 최종 architecture decision을 소유하지 않습니다. Parent의 결과도 사람의 production
authority를 대체하지 않습니다.

## Industry context

아래 자료는 이 repository의 현재 implementation authority가 아니라 설계 trade-off를 비판적으로 비교한 context입니다.

- [Toss — 개발자는 AI에게 대체될 것인가](https://toss.tech/article/will-ai-replace-developers): code production보다 system
  design, agent direction, verification, 그리고 무엇을 사람에게 남길지 결정하는 책임 변화를 논의합니다.
- [MUSINSA — The Philosophy: AI Native Hiring](https://techblog.musinsa.com/the-philosophy-ai-native-hiring-c002c2775b3a): AI 사용
  금지보다 problem definition, ambiguity handling, executable outcome과 제출물의 testability를 평가하는 관점을 제시합니다.
- [OpenAI — A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/):
  single agent의 capability를 먼저 확장하고, central manager가 user interaction과 synthesis를 유지해야 하는 경우의 manager
  pattern과 guardrail을 설명합니다.
- [OpenAI Codex — Subagents](https://developers.openai.com/codex/subagents): read-heavy independent work의 parallelization,
  context pollution 감소, write-heavy conflict 주의, per-agent model/reasoning configuration을 설명합니다.
- [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): 가장 단순한 해법에서
  시작하고, input에 따라 subtask가 달라지는 복잡한 작업에 orchestrator-workers를 적용하되 latency/cost trade-off를
  고려합니다.
- [Anthropic — Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):
  context curation과 focused subagent가 상세 탐색을 격리하고 parent에는 distilled summary를 반환하는 구조를 설명합니다.

이 자료가 이 repository 설계를 보증하거나 각 회사의 보편적 채용 기준을 의미하지는 않습니다.

## Interview evidence map

다음 질문은 암기할 답변이 아니라 current source와 Git history를 다시 읽기 위한 entry입니다.

| 질문                                                                                | 먼저 확인할 evidence                                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 왜 single-agent harness 이후에 multi-agent를 도입했는가?                            | [Agentic Engineering methodology](./agentic-engineering-methodology.md), [orchestration direct-first gate](./agent-workflows/orchestration.md)                                                      |
| 왜 direct-first와 benefit-gated delegation인가?                                     | [DA-001~003](./agent-workflows/agentic-architecture-decisions.md), [delegation single-first gate](./agent-workflows/request-intake/delegation.md)                                                   |
| impact risk와 reasoning complexity를 왜 분리했는가?                                 | [DA-009](./agent-workflows/agentic-architecture-decisions.md#da-009--child-reasoning은-repository-evidence로-두-번-판정), [routing regression](../../scripts/ci/codex-routing-policy.test.mjs)      |
| architecture가 아닌 transaction·migration·lifecycle·trust work도 왜 XHigh가 되는가? | [semantic predicates](../../scripts/agents/codex/routing-policy.mjs), [deep non-architecture fixtures](../../scripts/ci/codex-routing-policy.test.mjs)                                              |
| Parent effort는 왜 session owner가 선택하고 child만 task profile로 배정하는가?      | [.codex parent exclusion test](../../scripts/ci/project-codex-config.test.mjs), [reasoning effort routing](agent-workflows/adapters/codex.md#reasoning-effort-routing)                              |
| model·effort·count·write ownership을 어떻게 통제했는가?                             | [.codex config](../../.codex/config.toml), [delegation contract](./agent-workflows/request-intake/delegation.md), [runtime fixture](../../scripts/ci/fixtures/codex-runtime-capability-cases.json)  |
| hallucinated role/capability claim을 어떻게 막았는가?                               | [reported runtime evidence](./agent-workflows/request-intake/orchestration-recovery.md#reported-runtime-evidence), [orchestration regression](../../scripts/ci/codex-orchestration-policy.test.mjs) |
| context pollution과 delegation cost를 어떻게 제한했는가?                            | direct-first, bounded lane, facts/inferences/gaps output, leader-only fan-in contract                                                                                                               |
| 무엇이 실패했고 어떻게 고쳤는가?                                                    | PR #387 review/repair history (private repository), caller-expanded write boundary와 TOML regression                                                              |
| 무엇을 의도적으로 자동화하지 않았는가?                                              | custom scheduler/classifier, child lifecycle engine, automatic parent effort, merge/deploy authority 기각 표                                                                                        |
| 어떤 evidence가 redesign을 촉발하는가?                                              | 아래 limitation과 [DA-009~012 revisit triggers](./agent-workflows/agentic-architecture-decisions.md)                                                                                                |

## 한계와 재검토 조건

- 한정 activation 표본과 context pair는 있으나 comparable model/effort cohort의 productivity·품질·token·latency 개선률은 측정하지 않았습니다.
- Provider가 인증한 immutable effective model/effort metadata는 현재 repository가 보유하지 않습니다.
- Native surface나 Codex config schema가 바뀌면 role/model/effort evidence contract를 다시 검증합니다.
- 현재 child model의 allowance, cost 또는 latency가 현재 child tier를 반박하면 model/effort allocation을 fresh evidence로 재설계합니다.
- count별 품질·wall time·conflict 측정이 지속적으로 다른 boundary를 지지하면 0~3 proactive limit을 재검토합니다.
- durable mailbox, long-lived task ownership, operator-visible coordination이 필요해질 때만 Team/tmux runtime을 별도 검토합니다.
- 자동 fan-out, deterministic prompt classifier, 무제한 retry/reallocation과 autonomous merge/deploy는 현재 목표가 아닙니다.
- 실제 사용자·production impact는 향후 운영 evidence 없이는 주장하지 않습니다.

마지막 검토일: 2026-09-25
