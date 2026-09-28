# ContextPack discovery contract

`ContextPack`은 validated `TaskEnvelope`와 caller가 수집한 current repository evidence를 최소한의 domain
candidate, source metadata와 tracked guide 추천으로 변환한 immutable advisory value입니다.

## Boundary

- `scripts/agents/common/domain-guide-registry.mjs`는 filesystem search engine이 아닙니다.
- Caller는 current request, changed path, policy, public contract, owner README, route/controller/BFF, test와 필요 시
  official external source 후보를 수집합니다.
- Registry는 입력 evidence를 정규화·분류하지만 tool, web, child, mutation을 실행하지 않습니다.
- Keyword는 보조 evidence일 뿐이며 path/contract/policy/test evidence 없이 high confidence가 되지 않습니다.

## Schema

```text
schemaVersion
requestId / intent
domainCandidates[]:
  domain
  confidence
  evidence[]
  conflictStatus
selectedGuides[]:
  path
  owner
  authorityLevel
  selectionReason
  freshness / verifiedAt
  evidenceRole
  conflictStatus
sources[]:
  path or HTTPS URL
  kind / owner / authorityLevel
  selectionReason
  freshness / verifiedAt
  evidenceRole / conflictStatus
gaps[]
limits:
  primaryGuide: 1
  crossCuttingGuides: 0..2
```

## Discovery order

1. Validated TaskEnvelope의 supplied domain evidence
2. current repository path와 evidence kind
3. public contract, policy, owner README, BFF/controller, test ownership
4. request term은 low-confidence 보조 signal
5. official external source는 `verifiedAt`이 없으면 gap으로 유지

## Guide selection

- Plan intent만 `plan-authoring/core.md`와 primary owner guide를 선택합니다.
- Primary guide는 Frontend, Backend, Infrastructure 중 evidence score가 가장 높은 하나입니다.
- 동점이면 임의 선택하지 않고 `primary-domain-conflict` gap을 반환합니다.
- Security/Privacy와 Operations/Release는 domain evidence가 요구할 때만 선택하며 기본 최대 2개입니다.
- Answer·Analyze·Implementation 요청은 plan-authoring guide를 자동 로드하지 않습니다. Domain candidate와 source
  metadata만 다음 단계에 제공합니다.

### Lead의 선택적 concern consultation

위 목록은 **registry의 선택 결과**입니다. Lead가 source/owner를 확인한 뒤 필요에 따라 domain guide의 관련 부분을
참고하는 [model-mediated consultation](../owner-lead-collaboration.md#필요한-관점만-참고하기)과 구분합니다.
Non-Plan mapper의 `selectedGuides: []`는 유지하며, 별도 참고 경로는 유용할 때 기존 작업/검토 evidence에 기록합니다.
이를 deterministic 자동 로드, Plan 출력 또는 mutation 권한으로 해석하지 않습니다. Schema/registry는 바꾸지 않습니다.

## Freshness and authority

- tracked repository path는 `current-working-tree`, tracked guide는 `tracked-current`로 표시합니다.
- external source는 caller가 실제 확인한 ISO timestamp만 `verifiedAt`으로 받습니다.
- 미확인 external source는 `unverified`와 `external-source-unverified` gap을 남깁니다.
- ContextPack은 mutation authority 또는 child spawn authority를 부여하지 않습니다.
