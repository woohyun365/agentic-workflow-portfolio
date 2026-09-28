# Request intake

이 디렉터리는 사용자 요청을 repository-aware 작업 입력으로 변환하는 tracked contract를 소유합니다.
특정 모델의 prompt template이나 실행 상태를 저장하지 않습니다.

## 문서

- [Decisions](./decisions.md): intake, authority, disclosure, orchestration의 채택 결정
- [TaskEnvelope](./task-envelope.md): request를 표현하는 immutable advisory value contract
- [Output contracts](./output-contracts.md): Answer·Analyze·Plan 결과의 서로 다른 완료 계약
- [Ambiguity and authority](./ambiguity-and-authority.md): 모호함, 사용자 확인, OQ, release handoff,
  mutation 권한 경계
- [ContextPack](./context-pack.md): repository evidence에서 domain candidate와 최소 tracked guide를 발견하는 계약
- [Delegation](./delegation.md): independent lane, one-writer, source-bound handoff 공통 책임
- [Codex child policy](../adapters/codex-delegation.md): typed child handoff, role·effort·model recommendation
- [Codex orchestration and recovery](./orchestration-recovery.md): Codex/OMX native dispatch gate, one-alternate ceiling,
  leader-only synthesis 계약. Claude 기본값이 아님.

공통 문서는 위의 Decisions부터 Delegation까지 필요한 부분만 읽습니다. Codex child policy와 recovery는 **Codex/OMX일 때만**
조건부로 선택하며 Claude·제3 host의 실행 전제가 아닙니다. 다른 host는 [adapter index](../adapters/README.md)를 사용합니다.

## Regression surface

- `scripts/ci/fixtures/agent-intake-cases.json`: Analyze, Plan, direct, ambiguity, recovery 대표 입력과 기대 계약

### Codex adapter 회귀

다음 조합 smoke와 host-specific fixture는 **Codex/OMX adapter 회귀**입니다. Claude·제3 host의 native 실행 입증이나
공통 startup 명령으로 사용하지 않습니다.

- `scripts/ci/codex-intake-integration.test.mjs`: intake부터 Codex dispatch 또는 handoff까지의 조합, source freshness,
  no-write 경계
- `scripts/agents/codex/fresh-session-smoke.mjs`: local session memory 없이 Codex/OMX 대표 route를 확인하는
  read-only smoke
- `scripts/ci/codex-fresh-session.test.mjs`: generic bootstrap, domain-owner conflict, runtime role-routing fallback,
  stale handoff 참조 방지

```bash
node scripts/agents/codex/fresh-session-smoke.mjs --json
```

## 적용 순서

```text
current request
→ TaskEnvelope
→ ambiguity / authority gate
→ ContextPack
→ output contract
→ direct·sequential·clarify·OQ handoff·bounded lane 추천
```

- Canonical intent는 `answer/analyze/plan/implement/review/debug`이며 `unknown`은 미확정 상태다.
  `fresh/resume`은 별도의 continuity 축이다. Debug 분류 자체가 읽기 전용 요청을 수정 승인으로 바꾸지 않는다.
- ContextPack의 `selectedGuides`는 Plan-only이며 다른 intent의 문서 탐색과 동일하지 않다.
- `TaskEnvelope`는 advisory다. 자체적으로 tool을 실행하거나 child를 생성하지 않는다.
- explicit user request와 repository safety rule만 action authority를 부여한다.
- 분석 요청은 구현이 아니며, 계획 요청은 계획 자료와 구현을 동시에 승인하지 않는다.
- 세부 domain guide는 필요할 때만 발견하며, 이 디렉터리에 product policy를 복사하지 않는다.
- Plan 결과가 승인된 경우에만 [Plan authoring](../plan-authoring/README.md)의 core와 primary domain guide를
  선택한다.

## 권한 서열

1. 현재 사용자 요청
2. tracked `AGENTS.md`의 안전·소유·검증 경계
3. current code·contract·test·policy evidence
4. advisory intake 결과
5. local plan·checkpoint·memory

Intake 결과가 상위 근거와 충돌하면 결과를 폐기하고 다시 작성합니다.
