# Agentic architecture decisions

- 상태: accepted
- 결정일: 2026-08-13
- 범위: repository-local coding agent harness

이 문서는 특정 세션이나 모델의 취향이 아니라, 새 개발자와 coding agent가 같은 evidence·권한·완료 기준으로
수렴하도록 하는 결정을 소유합니다. 외부 benchmark 수치는 해당 실험 범위에만 적용하며 repository의 보편 법칙으로
해석하지 않습니다.

공통 single-first·권한·QA 결정과 host별 모델 실행 결정을 구별합니다. DA-009/011/012/016/017의 GPT/effort·수치 cap·Pass 2,
native/OMX dispatch, profile/admission과 필수 Astra QA는 **Codex cohort**에 한정하며
[Codex adapter](./adapters/codex.md)가 실행 절차를 소유합니다. Claude Code는 이 cohort에 자동 편입되지 않고
[Claude adapter](./adapters/claude-code.md)의 역할·권한 확인과 공통 QA를 사용합니다.

## Decision schema

각 결정은 문제, 근거, 결정, trigger/non-trigger, 기각 대안, 구현 영향, 검증, 재검토 조건을 포함합니다. 근거가
바뀌면 기존 결정을 덮어쓰지 않고 `superseded` 상태와 대체 Decision ID를 기록합니다.

## DA-001 — Deterministic-first, single-agent default

- **문제**: 모든 작업을 agent 토론이나 병렬 실행으로 처리하면 지연·context·충돌 비용이 증가합니다.
- **근거**: Anthropic과 OpenAI는 가장 단순한 구성에서 시작하고 tool이 해결할 수 있는 작업은 결정론적으로 처리할
  것을 권장합니다.
- **결정**: formatter, search, schema check, typecheck, test는 tool 결과를 우선하며 한 owner 작업은 single agent가
  기본입니다.
- **Trigger**: 독립적인 evidence lane이나 파일 ownership이 있을 때만 병렬화를 검토합니다.
- **기각**: 항상 multi-agent 사용 — sequential dependency에서 중복과 충돌을 키웁니다.
- **검증**: single-domain fixture에서 불필요한 child가 생성되지 않아야 합니다.
- **재검토**: 동일 작업군에서 반복적으로 context 한계나 처리량 병목이 측정될 때입니다.

## DA-002 — Sequential dependency와 parallel evidence lane 분리

- **문제**: policy→contract→implementation처럼 앞 결과가 다음 입력인 작업을 병렬화하면 서로 다른 가정을 만듭니다.
- **결정**: dependency chain은 순차 실행하고, repo mapping·외부 조사·독립 위험 분석만 fan-out합니다.
- **기각**: Phase 단위 무조건 병렬화 — 결과 통합 전에 전제가 갈라집니다.
- **검증**: child scope에 dependency와 stop condition이 명시되어야 합니다.

## DA-003 — Centralized leader synthesis와 one-write-owner

- **문제**: 여러 agent가 같은 파일이나 최종 계획을 수정하면 evidence와 결정의 owner가 흐려집니다.
- **결정**: child는 bounded evidence를 반환하고 leader가 충돌을 해결해 하나의 결과를 소유합니다. 쓰기 작업은 파일별
  owner를 하나로 둡니다.
- **기각**: child 결과 다수결 — 같은 근거와 모델의 반복은 독립 검증이 아닙니다.
- **검증**: 최종 결과에 source, inference, confidence와 충돌 해결이 보존되어야 합니다.

## DA-004 — Environment outcome 기반 completion

- **문제**: agent의 완료 선언이나 plan checkbox는 실제 동작을 증명하지 못합니다.
- **결정**: file state, git diff, test, build, service response 같은 environment outcome으로 완료를 판정합니다.
- **기각**: self-certified completion — false positive를 막지 못합니다.
- **검증**: 최종 보고에 실행한 명령과 읽은 결과 또는 명시적 검증 공백이 있어야 합니다.

## DA-005 — Progressive disclosure와 bounded context

- **문제**: 모든 policy·finished plan·transcript를 항상 주입하면 중요한 제약이 희석됩니다.
- **결정**: `AGENTS.md`에는 불변 규칙만 두고 task-specific guide는 필요할 때만 읽습니다. checkpoint는 pointer와
  bounded state만 보존합니다.
- **기각**: mega-prompt와 context stuffing — freshness와 source ownership을 흐립니다.
- **검증**: root guidance는 200줄·32KiB 이내이며 checkpoint에 transcript가 없어야 합니다.

## DA-006 — 명확한 tool namespace, schema, high-signal response

- **문제**: 겹치는 tool 이름과 큰 비정형 응답은 잘못된 호출과 context 낭비를 늘립니다.
- **결정**: tool은 owner/action이 드러나는 이름, 좁은 입력 schema, bounded 결과와 명확한 side-effect 경계를 가집니다.
- **기각**: tool buffet — 역할이 겹치는 도구를 항상 노출하지 않습니다.
- **검증**: destructive/open-world action은 권한 경계가 있고 결과는 필요한 evidence만 반환해야 합니다.

## DA-007 — Model reviewer는 defense-in-depth의 보조 계층

- **문제**: reviewer agent도 같은 오류나 prompt injection을 놓칠 수 있습니다.
- **결정**: reviewer는 static rule, type/contract, transaction guard, sandbox, approval, test 위에 추가하는 보조 검증입니다.
- **기각**: LLM-only guardrail — 실제 side effect를 제한하지 못합니다.
- **검증**: 고위험 invariant는 model 판단 밖의 deterministic control을 가져야 합니다.

## DA-008 — High-risk action은 authority gate 적용

- **문제**: credential, production, destructive, irreversible action은 잘못 실행했을 때 복구 비용이 큽니다.
- **결정**: 해당 action은 명시적 사용자 권한과 readiness/evidence를 확인하며, 그 외 reversible local 작업은 자동
  진행합니다.
- **기각**: 모든 작업 확인 요청 또는 모든 작업 자동 실행 — 각각 처리량과 안전성을 해칩니다.
- **검증**: external-production과 secret action은 실행 전에 authority가 기록되어야 합니다.

## DA-009 — Child reasoning은 repository evidence로 두 번 판정

이 결정의 model/effort와 Pass 1/2 helper는 Codex/OMX 실행에 한정합니다. 다른 host에 `medium | high | xhigh`나
Astra reviewer를 1:1 대응시키지 않습니다. 공통 위험도·boundedness는 [orchestration](./orchestration.md)을 따릅니다.

- **문제**: task label·요청 keyword·lexical risk만으로 effort를 고르면 실제 transaction, migration, public contract,
  trust boundary 복잡도를 놓치거나 단순 lookup을 불필요하게 child로 보낼 수 있습니다.
- **결정**: Pass 1은 intent·authority·impact risk·candidate shape만 분류하고, Pass 2가 current ContextPack의 정규화된
  source/fact/predicate evidence로 child role과 `medium | high | xhigh`를 최종 판정합니다. Medium은 모든 boundedness
  조건의 positive evidence가 있을 때만, XHigh는 mandatory semantic signal 또는 structural deep composite가 있을 때만
  선택하며 나머지 substantial work는 High입니다. 기본 Child는 GPT-6 Astra이고 선택형 quality-gated model advice는
  role/effort 판정 뒤에만 적용합니다. Parent model/effort는 사용자가 session에서 선택합니다. GPT-6 Sol/Luna는 중앙 task profile의 검증 가능한 후보이지
  활성화된 default가 아닙니다. Parent는 일반 bounded 업무에서 적합한 request를 채우고 shell로 충분하면 child를 만들지 않습니다. 검증 fact·exact admission·live compatibility가 필요하고 최종 QA는 Astra를 유지합니다.
- **기각**: lookup Low, taskKind/risk shortcut, leader effort의 무조건 상속, keyword/path/file-count/LOC 기반 XHigh,
  repository가 parent effort를 추천하는 방식.
- **검증**: stable source/fact/evidence binding, duplicate fact amplification 방지, same-request/different-evidence fixture,
  child effort allowlist, parent-effort isolation을 검사합니다.

## DA-010 — Developer request와 agent obligation 분리

- **문제**: 사람에게 필요한 요청 예시와 agent가 따라야 할 실행 schema를 한 문서에 섞으면 양쪽 모두 읽기 어렵습니다.
- **결정**: `getting-started.md`는 사람용 예시, `agent-execution-contract.md`는 agent 의무를 소유하고 canonical rule을
  링크합니다.
- **기각**: 도구별 instruction 사본 — 서로 다른 agent에서 drift가 발생합니다.
- **검증**: Codex 자동 discovery와 generic bootstrap prompt가 같은 authority와 acceptance로 수렴해야 합니다.

## DA-011 — Child 수는 독립성과 semantic benefit으로 제한

- **문제**: child 수를 최소 2개처럼 고정하거나 가능한 lane을 모두 fan-out하면 단일 evidence lane도 배제하거나 context·충돌
  비용을 불필요하게 키웁니다.
- **공통 결정**: 기본 child 수는 0이며 독립적인 bounded lane 하나도 허용합니다. 순이익·one-writer·Lead 통합은 모든
  host에 적용하고 수치 cap과 추천 메커니즘은 현재 adapter가 소유합니다.
- **Codex/OMX 결정**: Proactive 경로는 보통 최대 2개이고 current
  Pass 2 evidence에 직접 연결된 high-value benefit이 있을 때만 세 번째를 허용합니다. Owner가 명시적으로 확장해도 hard
  cap은 6이며 write-capable child는 하나만 선택합니다.
- **Trigger**: 결과 dependency와 write scope가 분리되고 completeness·latency·specialist evidence·risk review 순이익이
  검증된 lane입니다.
- **기각**: minimum-two, more-agents-is-better, shared-write fan-out, 모든 작업에 execution graph 생성.
- **검증**: 공통 독립성·one-writer 계약과 별개로 Codex의 zero/one/two/evidence-backed-three/owner-directed-six
  fixture를 유지합니다. 다른 host의 cap을 이 값으로 추정하지 않습니다.
- **재검토**: 실제 품질·walltime·conflict 측정이 다른 count boundary를 지속적으로 지지할 때입니다.

## DA-012 — Active runtime은 reported evidence와 live reconfirmation으로 판정

- **문제**: tracked role TOML이나 user config가 존재해도 현재 native/OMX dispatch surface가 그 role·model·effort를 실제로
  제공한다는 뜻은 아닙니다.
- **결정**: Native는 current-turn host tool schema, OMX는 current-session runtime overlay와 host-exposed role roster를
  bounded evidence로 사용합니다. 기본 Astra 또는 별도 admitted model과 `medium | high | xhigh`, role availability, effective effort, explicit-effort support,
  dispatch permission이 모두 맞아야 descriptor를 추천합니다. Evidence는 leader-reported이며 host-authenticated authority로
  표현하지 않고 실제 호출 직전에 leader가 다시 확인합니다. Candidate는 supported/resolved model, role pin/explicit model
  support와 별도의 scoped context gate를 모두 확인합니다. 첫 실행 전 resolution과 실행 후 정확한 child/task/result/독립 검증을
  분리하며 runtime-contract-resolved를 provider attestation으로 오인하지 않습니다. Exact pilot 권한과 운영 adoption GO를 구분하고 profile/config/
  source·scope/time/budget/check mismatch는 Parent fallback입니다. `pilot=true` 또는 pilot PASS는 채택 권한이 아닙니다.
- **Trigger**: validated delegation을 existing native child surface로 전달하려는 순간입니다.
- **기각**: boolean capability assertion, local config inspection만으로 active authority 주장, generic role prompt label,
  stale session metadata 재사용.
- **검증**: Native/OMX success, 미허용 Luna/Terra/Low, fixed-effort conflict, unavailable role, stale/unknown provenance와 permission
  fallback fixture를 보존하고, authorized-pilot/adoption 분리·scope/config·예산/만료·context mismatch를 검사합니다.
  추가로 finite GPT-6 task profiles, semantic/resolved effort 분리, Luna xhigh·finite read-only, 구형 GPT-5.6 요청과 stale
  profile 승인 거절, null usage 비차단, Astra one-alternate와 writer clearance를 검사합니다. 중앙 profile policyRevision/hash는
  계약·승인·설정 해석·사후 보고·복구에 연결되며 hash 자체는 권한을 부여하지 않습니다.
  공식 단가 우위와 실측 절약은 구분하며 usage 미노출만으로 품질 GO를 거절하지 않습니다.
  이 정적 fixture는 실제 host 모델 적용이나 성능·weekly 절약을 입증하지 않습니다.
- **재검토**: host가 직접 인증된 immutable runtime capability token이나 동등한 dispatch contract를 제공할 때입니다.

## DA-013 — Owner의 중요한 선택과 Lead의 기술 실행 분리

- **결정일**: 2026-09-10, accepted collaboration contract.
- **문제/근거**: [실행 계약](./agent-execution-contract.md)은 안전한 작업의 진행을, [계획 core](./plan-authoring/core.md)는
  Decision/OQ를 이미 소유합니다. 그러나 계획 외 대화에서 언제 직접 진행하고 언제 대안을 제시할지 찾기 어렵습니다.
- **결정**: [공통 협업 계약](./owner-lead-collaboration.md)을 decision-rights owner로 둡니다. 명확하고 승인된 기술 작업은
  Lead가 진행하고, 현재 제약을 바꾸는 중요한 제품·비용·위험 선택은 짧은 근거/대안/권장안으로 Owner와 협의합니다.
- **Trigger / non-trigger**: 승인된 정책·비용·위험·rollback 경계가 달라질 때 / 함수명·검증 명령 등 통상적 기술 선택에는
  회의나 재승인을 강제하지 않습니다. 기존 Decision/OQ의 표현만 재사용하며 새 ledger/schema를 만들지 않습니다.
- **기각**: 모든 선택을 Owner에게 위임, 침묵을 승인으로 처리, 모든 답변에 고정 개수의 대안 나열, 합의된 수단의 무단 교체.
- **구현 영향**: 공통 guide와 얇은 human/agent 진입점; lifecycle·QA·Git owner는 유지합니다.
- **검증/한계**: 문서/권한 정합성과 실제 direct-work·material-decision 사례를 구분합니다. 지침 자체가 행동 성공이나
  생산성 개선을 증명하지 않습니다.
- **재검토**: 불필요한 확인 요청 또는 중요한 선택의 누락이 실제 작업에서 반복될 때입니다.

## DA-014 — Intent를 바꾸지 않는 선택적 domain concern consultation

- **결정일**: 2026-09-10, accepted collaboration contract.
- **문제/근거**: `scripts/agents/common/domain-guide-registry.mjs`는 Plan 외 intent에 authoring guide를 선택하지 않습니다.
  [Backend](./plan-authoring/backend.md)·[Infrastructure](./plan-authoring/infrastructure.md) 등 기존의 유용한 분석 관점까지
  읽지 말라는 의미로 해석하면, 모호한 Analyze나 승인된 구현의 실제 영향 조사가 약해질 수 있습니다.
- **결정**: source/owner 확인 뒤 Lead가 필요한 primary guide의 관련 부분만 참고합니다. 이는 model-mediated consultation이며
  [ContextPack](./request-intake/context-pack.md)의 `selectedGuides`, mapper/schema나 action authority를 변경하지 않습니다.
- **Trigger / non-trigger**: transaction·비용·복구 등 구체적 근거가 관련 관점을 요구할 때 / 단순 lookup·기지의 작은 수정에
  모든 authoring checklist를 적용하지 않습니다.
- **기각**: classifier 확장, 매번 전체 guide 주입, guide를 읽었다는 이유로 Plan artifact 생성 또는 무단 구현.
- **구현 영향**: execution/ContextPack의 consultation 안내; consultation 기록과 deterministic selection을 분리합니다.
- **검증/한계**: 기존 non-Plan `selectedGuides: []`와 mutation 금지 테스트를 유지합니다. 실제 선택의 품질은 별도 관찰이며
  정적 검사가 자동 로드나 모든 agent의 준수를 증명하지 않습니다.
- **재검토**: 과도한 문서 탐색 또는 필요한 관점 누락의 반복 근거가 있을 때입니다.

## DA-015 — Parent-led authority와 제한된 peer 사실 확인

- **결정일**: 2026-09-10, accepted collaboration contract; DA-003의 중앙 통합 책임을 유지합니다.
- **문제/근거**: [Delegation](./request-intake/delegation.md)은 독립 lane과 leader-only 결과를,
  [QA](./qa.md)는 독립 인수 조건 도출을 소유합니다. 정보 확인과 업무 재위임을 구별하지 않으면 불필요한 중계 또는
  권한 없는 peer 합의가 생길 수 있습니다. 실제 통신 지원 여부는 current runtime에서 다시 확인해야 합니다.
- **결정**: 기본은 Parent 경유. Parent가 지정한 참여자·주제·읽기 범위·snapshot 안에서만 짧은 사실 확인을 허용하며
  task 배정·범위 변경·판정·통합은 Parent에게 남깁니다. 상세 조건은 공통 협업 계약 한 곳에서 소유합니다.
- **Trigger / non-trigger**: 각자 독립적으로 완료할 수 있는 작업의 기존 symbol/fixture 확인 / 새 조사·구현 요청, 의견 협상,
  초기 QA의 builder 설득에는 허용하지 않습니다. Sub-child 생성과 직접/간접 offload는 금지합니다.
- **기각**: 무제한 peer chat, 정보 교환도 일괄 금지, 직군별 상시 agent roster, 도구 노출을 실행 허가로 해석.
- **구현 영향**: 기존 역할/할당의 instruction 수준 계약입니다. 새 scheduler·message ACL·자동 CC·config key를 도입하지 않고,
  실제 host/role 제한이 더 좁으면 Parent 경유를 사용합니다.
- **검증/한계**: instruction presence와 실제 허용/거절·보고·QA 독립성 관찰을 분리합니다. 문서 도입만으로 live peer 검증을
  통과했다고 주장하지 않습니다.
- **재검토**: 관찰된 병목·QA 오염·권한 위반이 다른 정책의 순이익을 뒷받침할 때입니다.

## DA-016 — Scoped ordinary dispatch와 acceptance-bound Parent 운영

- **결정일**: 2026-09-24, scoped dispatch/QA 계약 보완; Parent 설정 채택과 실제 성능 관측은 별개입니다.
- **문제/근거**: `child-task-contract.mjs`가 표시한 context 불일치를 ordinary dispatch consumer가 무시할 수 있었고,
  role/effort 일치만으로는 scoped explicit 호출 인자가 연결되지 않았습니다. Primary 중복 방지와 전체 acceptance 확인도
  단순 child 수/테스트 개수로 대신할 수 없습니다.
- **결정**: 기존 `orchestration-policy.mjs`에서 supplied context failure를 거절하고, 검증된 native Astra scoped/explicit
  경로만 정확한 spawn 인자로 연결합니다. 생략 legacy는 advisory 호환성을 유지하되 실제 context gate를 면제하지 않습니다.
  Primary owner·QA·Parent-high 품질 stop은 [orchestration](adapters/codex.md#parent-high-운영과-quality-stop)과
  [QA](./qa.md#portable-qa-packet)가 각각 소유합니다. Parent 선택/변경은 실제 host control에 남깁니다.
- **Trigger / non-trigger**: 검증 가능한 bounded 미해결 문제, criterion gap, source 변경 / 이미 해결된 primary 재분석,
  작은 direct 작업의 상시 fan-out, 비용만을 위한 필수 QA 축소는 선택하지 않습니다.
- **기각**: 새 scheduler/role TOML, semantic 중복/진실성 점수 엔진, Parent effort 자동 변경, 모든 작업의 xhigh child 강제.
- **구현 영향**: 기존 dispatch/context schema 재사용, model/effort/permission gate 보존, canonical docs와 finite corpus 연결.
  Ordinary 실패 이력은 보존하고 candidate/recovery의 별도 admission을 완화하지 않습니다.
- **검증/한계**: 실제 consumer의 positive/negative unit·integration·synthetic smoke와 source-first 독립 QA를 대조합니다.
  Fixture 정합성은 live 행동/모델 성능 시험이 아니며 Parent-high 품질 동등성·token/weekly 절감을 주장하지 않습니다.
- **재검토**: source/host 지원 변화, 반복된 acceptance 누락 또는 유효한 같은 작업 기준 품질·총 비용 관측이 생길 때입니다.

<a id="routine-model-adoption"></a>

## DA-017 — Evidence-bounded routine task-model adoption

- **결정일**: 2026-09-24. Owner의 task-aware 운영 채택 구현 요청과 독립 품질 검증을 근거로 아래 cohort를 **로컬 routine GO**로
  채택합니다. Policy revision `2026-09-24.3`; canonical model/effort/role/tool data는 `scripts/agents/codex/model-profiles.mjs`가 소유합니다.
- **범위/권한**: 승인된 일반 업무에서 Parent가 이 결정을 소비합니다. 개별 task의 원문 권한·현재 schema·정확한 profile/source/
  config/scope/time/budget·독립 QA는 [별도 admission](./request-intake/orchestration-recovery.md#model-admission)이 필요합니다.
  문서/table/과거 JSON은 영구 실행 허가가 아닙니다. 전체 변경의 최종 QA·통합과 Parent-high 적용 완료를 뜻하지 않습니다.

| 채택 cohort / 역할                    | 요청 model / effort | 관측한 품질 근거와 채택 상한                                                                                                                                                    |
| ------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bounded-build / repo_executor          | gpt-6-sol / xhigh   | Disposable pure feed helper 구현·test: child 5/5, Parent oracle 8/8, 독립 QA PASS. 완전한 Medium, non-high impact, 단일 write owner·oracle·Astra QA                             |
| bounded-read / repo_explorer           | gpt-6-sol / xhigh   | 고정된 repository source 4개의 owner/URL semantics map: source oracle·독립 QA PASS. 유한 repo lookup/analysis, 완전한 Medium·독립 확인                                          |
| bounded-extract / repo_explorer        | gpt-6-luna / xhigh  | 고정 source의 query 변환 8개: executable oracle 8/8·독립 QA PASS. Low impact·단일 semantic extraction·고정 입력/schema, read-only                                               |
| astra-bounded-recovery / repo_executor | gpt-6-astra / low   | Cleared writer + 새 faulted-source binding의 controlled rescue: RED→GREEN, Parent build/canary 9/9·독립 QA PASS. 원인이 좁혀진 non-high-risk, 같은 owner/tools, alternate 한 번 |

**미채택**: explorer/researcher의 low recovery는 미채택이며 별도 evidence/권한 전 routine에 확대하지 않습니다. Researcher의
Sol routine, 다른 role/도구/High·deep cohort, max worker, QA model downgrade도 미채택입니다. Pure helper가 표현할 수 있는
candidate/recovery 집합과 실제 검증·채택된 집합은 다릅니다. 범위 밖이면 Parent direct/검증된 Astra 또는 별도 readiness로
넘기며, semantic effort·원인을 조작해 채택된 것처럼 만들지 않습니다.

- **관측 provenance**: source baseline `630ed20c`, 같은 날 사전 고정 task/oracle/fault로 실행한 순차 5 child/5 turn 중
  후보 3개, controlled rescue 1개, fresh source-first Astra high QA 1개. 네 결과 모두 독립 QA PASS. Native explicit 호출 인자와
  returned child/task/final을 Parent가 대조했습니다. 보존된 로컬 원본을 확인해 수동 요약한 dated evidence이지 CI 재실행 결과나
  새 clone이 원본 없이 재생할 수 있는 benchmark가 아닙니다. 로컬 원본이 없으면 이 표로 새 host 지원/품질을 증명하지 않습니다.
- **한계**: 3개 candidate 표본을 일반적 parity/무재작업으로 확대하지 않습니다. Fault는 Parent가 원래 성공 결과를 보존한 뒤
  primary terminal acceptance 전에 주입했으며 모델 자체 miss가 아닙니다. Rescue 성공으로 candidate 실패율을 개선하지 않습니다.
  Provider-effective attestation은 미관측, tokens/cache/credits/USD/weekly 절감은 미측정입니다. 표의 model/effort는
  requested/resolved 계약이며 immutable provider 관측이 아닙니다. Helper의 static PASS도 native 호출 증거가 아닙니다.
- **결정의 이유/기각**: 보수적인 적격 작업에 다른 모델을 배정하되 총 작업 품질을 oracle·Astra 독립 QA로 우선합니다. 단가나
  짧은 답변만으로 총 비용 우위를 입증하지 않습니다. 상시 Astra-only, 전면 lower-model 전환, 반복 모델명 확인, 자동 alias 승격,
  새 dispatcher/TOML clone을 채택하지 않습니다. 미해결 gap·지원 불일치는 Astra/direct로 돌아갑니다.
- **운영/철회**: [cold-start](adapters/codex.md#routine-task-model-operation), [철회와 재승인](./request-intake/orchestration-recovery.md#routine-admission-lifetime),
  [generation seam](adapters/codex.md#central-profile-migration-boundary)이 소유합니다. Revision/eligibility/model/effort/role·host 또는
  품질이 바뀌면 해당 cohort를 중단·재검증합니다. Data rollback에도 새 revision/승인이 필요합니다. 전체 과거 code+grant 복원을
  차단하는 영구 이력 장치를 구현했다는 뜻은 아닙니다.
- **검증/재검토**: routine→withdrawal→Astra/direct→fresh admission, config pin/drift, stale generation binding 회귀를 사용합니다.
  실제 비용 비교·Parent/reviewer 모델 실험은 이 결정의 필수 조건이나 수행한 근거가 아닙니다. 의미 있는 품질 finding, scope 확대,
  지원 변화 또는 검증된 같은 작업 기준 비용/성능 자료가 나오면 채택을 재검토합니다.

## Collaboration observation — 2026-09-10

DA-013~015의 지침 존재와 실제 동작을 구분하기 위해 synthetic/local 입력으로 제한된 관찰을 수행했습니다.
아래는 Parent가 기록한 실행과 두 context-isolated child의 보고를 대조한 결과이며, 독립된 실제 사용자 연구가 아닙니다.

| Problem → Decision                                          | Change / 검증 근거                                                                               | Observed / Unknown                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 작은 승인 작업에도 불필요한 협의 → direct 기본              | artifact-only helper를 Parent가 수정하고 Node regression 실행                                    | red → green; 승인 작업 재확인은 같은 helper를 재사용한 별도 실행이지 독립 실험 두 개가 아님                   |
| 기술 수단 선결정·비용 혼동 → 근거/대안/Owner 선택 분리      | synthetic 중복 요청에 DB/Redis 대안 검토; CI wall 10→7분, compute 12→18분 비교                   | 외부 서비스 변경 없이 반론과 선택 질문 기록; 실제 가격·비용 절감·Owner 승인 없음                              |
| guide 참고가 구현 권한으로 오인 → concern consultation 분리 | ContextPack과 registry를 독립 reader가 대조; 기존 non-Plan mapper regression 유지                | 수동 참고와 `selectedGuides: []`가 양립; 모든 prompt의 자동 분류 성능은 미측정                                |
| peer 협의가 재위임으로 확대 → 지정된 사실 확인만 허용       | Parent가 두 reader의 pair/topic/source를 지정; 실제 질문·답변과 양측 receipt/report 대조         | ContextPack 의미와 helper 위치 확인; 종료 후 지정 만료. 자동 CC나 hard ACL은 아님                             |
| 만료·범위 밖 요청 → 거절 후 Parent 보고                     | 무지정/다른 수신자·주제/snapshot 불일치/완료/철회/업무 offload/nested spawn/간접 model 위임 입력 | negative assignment에서 peer 연락·spawn·offload 없이 거절 관찰; 위험 동작을 실제 시도한 보안 강제 시험은 아님 |
| 구현자 self-PASS → 독립 acceptance 후 runner·delta review   | reviewer가 초기 source에서 non-string identity/whitespace 테스트 누락 발견; Parent가 보강        | 초기 5개 → 보강 15개 테스트 통과; 초기 gap 보존 후 같은 reviewer가 새 snapshot 재검토. 사실 교환은 그 이후    |

재현 가능한 **정적** 근거는 `scripts/ci/agent-collaboration-contract.test.mjs`의 fixture 정합성/invalid mutation과
`scripts/ci/project-codex-config.test.mjs`의 역할·설정 검사입니다. `pnpm test:repo-policy`로 실행하며,
`scripts/ci/fixtures/agent-collaboration-cases.json`의 corpus 전체가 live 실행되었다는 뜻은 아닙니다.
필수 9개 case group을 관찰했으며, 나머지 7개(모호한 Backend 탐색, 수단 충돌, 강결합 lane, 별도 runner 경계,
FE content/style, UX data 한계, child 결과 충돌)는 전용 live 시나리오 미실행으로 남겼습니다.

Parent는 구현 맥락을 유지했고 두 child만 `fork_turns: none`으로 시작했습니다. Child는 변경된 역할 지침을 직접 읽었으나
자동 role hot reload나 immutable effective model/effort는 검증하지 않았습니다. 따라서 scoped 행동 관찰을
fresh Parent 전체의 준수율·생산성·비용 향상, 모든 공격 입력의 차단 또는 runtime 권한 증명으로 확장하지 않습니다.
새 실행은 [QA snapshot 규칙](./qa.md#portable-qa-packet)에 따라 현재 source와 실제 도구 권한을 다시 확인합니다.

## Evidence inventory

- [OpenAI Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md.md)
- [OpenAI Codex best practices](https://learn.chatgpt.com/guides/best-practices.md)
- [OpenAI practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)
- [OpenAI running Codex safely](https://openai.com/index/running-codex-safely/)
- [Anthropic building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic writing effective tools](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Anthropic demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Google Research scaling agent systems](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/)
- [Google DeepMind AI agent security](https://deepmind.google/blog/securing-the-future-of-ai-agents/)

외부 자료는 원칙의 근거이며 repository code, test, policy보다 높은 현재 구현 권한을 갖지 않습니다.

## Decision traceability

각 Decision의 짧은 본문은 읽기 흐름을 유지하고, 구현 영향과 재검토 기준은 아래 표에서 빠짐없이 추적합니다.

| ID     | 근거                                                        | Trigger / non-trigger                                                         | 구현 영향                                                           | 재검토 조건                                                         |
| ------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| DA-001 | OpenAI practical guide, Anthropic effective agents          | 독립 lane이 있을 때만 병렬화 / 단일 owner·결정론적 작업은 직접 수행           | direct-first routing과 child 생성 억제                              | 반복 측정된 context·처리량 병목                                     |
| DA-002 | Google scaling agent systems, Anthropic effective agents    | 독립 evidence lane / dependency chain                                         | sequential dependency, bounded fan-out                              | 병렬 결과가 충돌 없이 지속적으로 더 나은 evidence를 만들 때         |
| DA-003 | OpenAI practical guide, Anthropic context engineering       | 파일 owner가 겹치지 않을 때 / shared write owner가 필요할 때                  | leader synthesis와 one-write-owner                                  | 분산 merge가 더 낮은 충돌률로 검증될 때                             |
| DA-004 | Anthropic demystifying evals, OpenAI best practices         | 검증 가능한 environment outcome / self report만 존재                          | command·test·diff 기반 완료 판정                                    | 더 강한 자동 acceptance surface가 생길 때                           |
| DA-005 | Anthropic context engineering                               | task-specific 정보가 필요할 때만 load / transcript 전체 주입 금지             | bounded checkpoint와 progressive disclosure                         | startup context가 필수 규칙을 누락하거나 budget을 초과할 때         |
| DA-006 | Anthropic writing tools, OpenAI agent guide                 | 명확한 owner/action/schema / 중복 tool buffet                                 | 좁은 tool contract와 bounded output                                 | tool 선택 오류나 context 비용이 다시 증가할 때                      |
| DA-007 | DeepMind agent security, OpenAI running Codex safely        | deterministic guard 위 reviewer / reviewer-only guard 금지                    | static·type·sandbox·test 우선                                       | model verifier가 독립적 강제력을 제공할 때                          |
| DA-008 | DeepMind agent security, OpenAI running Codex safely        | destructive·credential·production action / reversible local work              | authority gate와 safe auto-continue                                 | 권한 또는 rollback model이 바뀔 때                                  |
| DA-009 | Google scaling agent systems, repository semantic evidence  | Pass 1 intent/risk 뒤 current evidence Pass 2 / label·keyword shortcut 금지   | child-only two-pass + optional quality-gated model fixture          | 실제 품질·비용 측정 또는 native runtime contract가 tier를 반박할 때 |
| DA-010 | OpenAI AGENTS.md, repository onboarding evidence            | 사람 요청 예시와 agent 의무가 모두 필요 / tool별 규칙 복제 금지               | getting-started와 execution contract 분리                           | generic agent가 동일 authority로 수렴하지 못할 때                   |
| DA-011 | Google scaling agent systems, repository lane evidence      | 독립·bounded·positive-benefit lane / dependency·shared write                  | adaptive bounded fan-out과 one-write limit                          | count별 품질·walltime·conflict 실측이 현재 경계를 반박할 때         |
| DA-012 | OpenAI native surface, OMX runtime, repository smoke        | dispatch 직전 fresh reported evidence / config·과거 session만 존재            | dual-runtime + exact model admission과 sequential fallback          | host-authenticated runtime capability contract가 제공될 때          |
| DA-013 | 실행 계약, 계획 Decision/OQ owner                           | 중요한 제약 변경 / 승인된 통상 작업                                           | 공통 decision rights와 짧은 협의                                    | 과잉 질문 또는 중요한 선택 누락                                     |
| DA-014 | ContextPack registry, domain authoring guides               | 근거가 요구하는 관점 / 단순 lookup                                            | model-mediated consultation; mapper 유지                            | 문서 과잉 또는 관점 누락                                            |
| DA-015 | delegation, QA, current runtime 제약                        | 지정된 독립 사실 확인 / offload·초기 QA 설득                                  | 중앙 authority와 제한된 peer 정보 교환                              | 실제 병목·오염·권한 위반                                            |
| DA-016 | Repository context/dispatch consumer와 QA evidence          | scoped explicit Astra/criterion gap / legacy advice를 실제 실행으로 간주 금지 | 기존 dispatch 보완·single primary·acceptance-bound QA               | host 변화 또는 반복 품질 gap·유효한 비용 관측                       |
| DA-017 | Scoped native task/oracle·독립 QA와 registry/admission 회귀 | 검증된 profile/role의 승인된 bounded task / 미검증 역할·위험·영구 grant       | 기존 schema로 local cohort GO·fresh admission·철회/rollback handoff | profile/host/품질 변화 또는 의미 있는 비용/품질 근거                |
