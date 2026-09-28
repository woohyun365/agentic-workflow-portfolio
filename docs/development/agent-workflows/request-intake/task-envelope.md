# TaskEnvelope contract

`TaskEnvelope`는 현재 사용자 요청을 repository evidence와 작업 권한에 맞게 구조화한 immutable advisory
value다. 실행 engine, session state, plan artifact가 아니다.

## Schema

```text
requestId: ephemeral stable identifier
requestSummary: raw text를 복제하지 않은 bounded summary
intent: answer | analyze | plan | implement | review | debug | unknown
authorizedAction: inspect | answer | produce-analysis | produce-plan | mutate
risk: low | medium | high
domainCandidates[]:
  domain: canonical domain identifier
  confidence: low | medium | high
  evidence[]: request term | repository path | contract | policy
constraints[]:
  source: user | repository | environment
  statement: bounded constraint
evidence[]:
  kind: fact | inference | gap
  statement: bounded evidence statement
  source: repository path | official URL | null
  confidence: low | medium | high
requiredEvidence[]: repo | test | official-current | external-owner
ambiguities[]:
  question: unresolved decision
  impact: what changes depending on the answer
  disposition: clarify-now | plan-oq | release-evidence-handoff | evidence-gap | safe-read-only-first
recommendedPath: direct | sequential | clarify | oq-handoff | bounded-lanes
confidence: low | medium | high
```

## Invariants

1. `intent` and `authorizedAction` are independent. `implement` inference alone cannot grant `mutate`.
2. `unknown` intent or conflicting authority fails closed to `inspect`, `clarify`, or `oq-handoff`.
3. Analyze requests cannot authorize `mutate` or implicitly create a plan artifact.
4. Plan requests authorize `produce-plan`, not implementation.
5. `bounded-lanes` is only a recommendation. The leader rechecks independence and runtime role capability.
6. Every domain candidate states why it was selected. Confidence without evidence is invalid.
7. Current request and working-tree evidence outrank previous envelope, checkpoint, or memory.
8. Raw prompts, secrets, credentials, transcripts, and user personal data are not durable envelope fields.
9. Evidence는 `fact`, `inference`, `gap` label과 원래 confidence를 보존하며 mapper가 inference를 fact로
   승격하지 않는다.

## Mapper boundary

`scripts/agents/common/intake-policy.mjs`는 다음만 수행하는 pure advisory mapper다.

- 명시적인 결과 동사에서 intent와 action authority를 보수적으로 분리
- high-risk broad request를 `inspect`와 ambiguity로 fail-closed
- supplied domain candidate, constraint, evidence의 bounded normalization
- secret·email이 durable summary에 남지 않도록 redaction
- schema/invariant validation과 immutable result 반환

Mapper는 repository를 검색하거나 tool, child, route, mutation을 실행하지 않는다. Domain guide 발견은 별도
registry, independent lane과 child lifecycle은 orchestration owner가 담당한다.

## Construction order

```text
summarize requested outcome
→ classify requested output
→ derive action authority from explicit wording
→ collect user/repository/environment constraints
→ identify candidate domains and required evidence
→ record ambiguity without resolving it by assumption
→ recommend the lightest safe path
→ validate invariants
```

Repository inspection may refine domain and evidence fields. It cannot silently widen `authorizedAction`.

## Examples

### Read-only analysis

```json
{
  "requestSummary": "Legal surface의 개선 지점을 분석한다.",
  "intent": "analyze",
  "authorizedAction": "produce-analysis",
  "risk": "high",
  "domainCandidates": [
    { "domain": "legal-policy", "confidence": "high", "evidence": ["Legal"] },
    { "domain": "frontend", "confidence": "medium", "evidence": ["surface"] }
  ],
  "requiredEvidence": ["repo", "official-current"],
  "ambiguities": [],
  "recommendedPath": "sequential",
  "confidence": "medium"
}
```

Result: inspect and Analyze only. No code change and no plan artifact.

### Ambiguous write request

`Legal을 개선해줘.`는 수정 대상·성공 기준·법적 근거 시점이 비어 있다. reversible read-only
baseline은 가능하지만 `mutate`를 부여하지 않고 `safe-read-only-first` 또는 `clarify-now`를 선택한다.

## Validation failure

다음은 invalid envelope다.

- `intent: analyze` + `authorizedAction: mutate`
- evidence 없는 high-confidence domain
- unknown intent + bounded-lanes
- ambiguity를 비우고 미확정 provider/production 값을 constraint로 고정
- raw request에 있던 credential을 summary나 constraint에 복사
