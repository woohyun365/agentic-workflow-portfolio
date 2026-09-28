# Request intake decisions

- 상태: accepted
- 결정일: 2026-08-13
- 범위: repository-aware intake, plan authoring, bounded orchestration

이 문서는 [Agentic architecture decisions](../agentic-architecture-decisions.md)를 request intake에 적용한다. 모델이나
provider 선택이 아니라 authority, evidence, output, recovery의 repository 계약을 고정한다.
공통 의미와 Codex 구현 수치는 구분하며 다른 host는 [adapter index](../adapters/README.md)를 통해 연결한다.

## AIPO-001 — Advisory intake와 mutation authority 분리

- **결정**: intent·domain·risk 분류는 advisory다. `authorizedAction`은 explicit user request와 repository
  safety rule에서만 결정한다.
- **기각**: high-confidence intent를 write permission으로 간주하는 classifier.
- **재검토**: runtime이 cryptographically verifiable authority token을 제공하는 경우.

## AIPO-002 — TaskEnvelope는 immutable value contract

- **결정**: request 요약, intent, authority, risk, domain candidate, constraint, evidence, ambiguity, route,
  confidence를 하나의 검증 가능한 value로 표현한다.
- **기각**: raw prompt와 작업 상태를 계속 누적하는 mutable session object.
- **구현 영향**: durable artifact에 raw request를 기본 저장하지 않는다.

## AIPO-003 — Ambiguity는 명시적인 상태

- **결정**: `clarify-now`, `plan-oq`, `release-evidence-handoff`, `evidence-gap`,
  `safe-read-only-first`로 구분한다.
- **기각**: 빈 값을 agent의 임의 assumption으로 채우기.
- **재검토**: 모호함 분류가 반복적으로 불필요한 사용자 질문을 만드는 경우.

## AIPO-004 — Answer, Analyze, Plan은 다른 output contract

- **결정**: Answer는 직접 응답, Analyze는 근거·문제·권장, Plan은
  Decision·OQ·dependency·test·acceptance를 소유한다.
- **기각**: 분석 요청에서 plan artifact나 code change를 자동 생성.
- **구현 영향**: output 종류별 schema와 no-write/no-plan negative fixture를 둔다.

## AIPO-005 — Tracked guide와 progressive disclosure

- **결정**: `AGENTS.md` → request-intake core → primary domain → 필요한 cross-cutting guide 순서로
  최소 context를 읽는다.
- **기각**: ignored local handoff와 과거 transcript를 항상 startup context에 주입.
- **재검토**: fresh-session fixture가 tracked docs만으로 domain 관점을 재현하지 못할 때.

## AIPO-006 — Single-first, independent-lane fail-closed

- **결정**: evidence goal, ownership, bounded output, integration, net benefit가 모두 명확할 때만 lane을
  independent로 분류한다. 그 외에는 direct 또는 sequential이다.
- **기각**: domain 수나 phase 수만으로 multi-agent를 생성.
- **구현 영향**: child default 0, shared dependency/write owner는 single sequential.

## AIPO-007 — Bounded fan-out, leader-only fan-in

- **공통 결정**: 독립 lane 하나도 허용하며 한 task에는 하나의 write owner만 둔다. 최종 결정·응답·통합·검증은
  leader가 소유한다. 현재 host가 지원·허용하는 범위 안에서만 위임한다.
- **Host binding**: Codex의 fan-out cap·write policy는 [Codex delegation](../adapters/codex-delegation.md#count와-write-policy)이 소유하며 다른 host에 자동 적용하지 않는다.
- **기각**: child 수를 품질 지표로 사용하거나 child가 global plan을 각자 작성.
- **재검토**: repository fixture가 다른 bound에서 지속적인 품질·latency 이득을 증명할 때.

## AIPO-008 — Role·effort는 recommendation

- **공통 결정**: 필요한 조사·구현·검토 책임과 impact risk·reasoning complexity를 구분한다. 실제 역할·모델·자원
  설정은 현재 adapter가 소유하며 dispatch 전에 capability를 확인한다.
- **Host binding**: Codex의 Pass 2·role/effort·runtime gate는 [Codex routing](../adapters/codex.md#reasoning-effort-routing)을 따른다. Host별 enum을 공통 기본값으로 삼지 않는다.
- **기각**: model family를 공통 core에 고정하거나 Parent 자원 설정을 무조건 상속.
- **구현 영향**: capability를 입증하지 못하면 지원된 direct/sequential 경로 또는 blocker를 선택한다. 필수 독립 QA·권한 증거를 fallback으로 대체하지 않는다.

## AIPO-009 — Child task는 typed handoff

- **결정**: objective, question, evidence/tool, owner, non-goal, prohibited assumption, output schema,
  verification, confidence label, recovery condition을 포함한다.
- **기각**: “조사해줘” 수준의 vague delegation과 shared write ownership.
- **구현 영향**: child는 fact/inference/gap을 구분하고 final user answer를 소유하지 않는다.

## AIPO-010 — Recovery는 한 번의 alternate attempt

- **결정**: failure category를 기록하고 동일 시도를 반복하지 않는다. 한 번의 안전한 대체 시도
  후 evidence gap, OQ, user handoff 중 하나로 종료한다. 이는 **해당 ordinary recovery route**의 budget이며,
  일반 구현 전체의 test-fix 반복을 한 번으로 제한하는 규칙이 아니다. 권한·scope·quota 거절은 다른 provider로 우회하지 않는다.
  Codex의 실제 descriptor·재시도 판정은 [Codex recovery](./orchestration-recovery.md)가 소유한다.
- **기각**: 무제한 reflection, respawn, reallocation loop.
- **재검토**: 실패 분류가 잘못되어 서로 다른 recovery를 같은 시도로 오판할 때.

## AIPO-011 — AI-readable architecture는 OOP/DDD owner를 강화

- **결정**: bounded context, owner-local invariant, public contract, transaction boundary, canonical naming, narrow
  interface, executable test를 더 명시적으로 만든다.
- **기각**: agent class hierarchy, 불필요한 Strategy/Factory, domain semantics를 central god file로 이동.
- **구현 영향**: plan은 pattern을 자동 적용하지 않고 문제·trade-off·owner evidence로 선택.

## AIPO-012 — Eval은 outcome과 negative behavior를 검증

- **결정**: route label만이 아니라 no-write, no-plan, no-child, freshness, fact/inference separation,
  해당 ordinary recovery route의 one-retry ceiling을 검증한다. 전체 구현의 수정·검증 횟수와 혼동하지 않는다.
- **기각**: agent의 완료 선언과 happy-path transcript만을 grader로 사용.
- **구현 영향**: positive·negative·ambiguity·recovery fixture를 같이 유지.

## 근거와 재검토

상위 근거는 [Agentic architecture decisions](../agentic-architecture-decisions.md)의 official source inventory를 공유한다.
이 결정은 다음 조건에서 재검토한다.

- fresh-session fixture가 tracked guide만으로 같은 authority/output 결론에 도달하지 못함
- direct task에 child·context 비용이 반복적으로 발생함
- high-risk action이 authority gate 없이 실행됨
- representative fixture가 현재 bound와 output schema를 반박함
