# Development lifecycle

개발의 결과는 코드 작성에 그치지 않습니다. **무슨 문제를 풀고, 무엇으로 확인하며, 누가 다음 판단을 하는가**를
연결합니다. 이 문서는 기존 owner를 찾아가는 지도이며 별도 workflow engine, 상태 파일이나 의무적인 회의 절차가 아닙니다.

## Intent에서 feedback까지

| 단계             | 입력 → 산출물                                                            | Evidence owner                                                                                  | 다음 소비자                   |
| ---------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------- |
| 문제와 권한 확인 | 현재 요청·현상 → outcome, non-scope, 미확정 결정                         | [Request intake](./request-intake/README.md), 기존 Issue                                        | 분석자·계획 작성자            |
| 근거와 설계      | code/policy/contract → Decision/OQ, 검증 가능한 acceptance               | [Plan authoring](./plan-authoring/core.md), 해당 policy/architecture                            | readiness reviewer·구현자     |
| 구현과 검증      | 승인된 acceptance → usable change, regression, 실행 결과                 | code/test, [Execution contract](./agent-execution-contract.md)                                  | QA reviewer·통합 담당자       |
| 리뷰와 통합      | 정확한 diff·검증 결과 → disposition, CI, merge                           | [QA](./qa.md), [Branch/PR strategy](../github/branch-and-pr-strategy.md), PR                    | 다음 구현자·release 담당자    |
| 배포 준비와 관측 | 통합 결과·실제 target → readiness/운영 evidence                          | [Production release evidence](../../../infra/runbooks/release/production-release-evidence.md)   | 승인 권한을 가진 owner·운영자 |
| 학습과 후속 작업 | 사용자 관찰·incident·실패 → keep/change/stop, regression 또는 후속 Issue | [Issues and work tracking](../github/issues-and-work-tracking.md), 해당 troubleshooting/runbook | 다음 bounded outcome의 담당자 |

위 순서는 모든 작업에 모든 단계를 강제하지 않습니다. 오탈자는 직접 수정·검사할 수 있고, 불확실한 설계는 작은 실험으로
판단할 수 있습니다. Agent는 승인된 reversible 작업을 진행하되, 중요한 제품·법적·credential·release 결정은 owner에게 남깁니다.

## Verification과 value validation

- **Verification:** 승인된 정책·계약대로 구현됐는가? 테스트·정적 검사·실행 증거로 확인합니다.
- **Value validation:** 의도한 사용자·운영 이익이 실제로 생겼는가? 적절한 관찰이 필요합니다. 테스트 통과가 사용 편의,
  미적 만족이나 business value를 증명하지 않습니다.

효과가 불확실한 사용자-facing 결과에는 기존 Issue/계획의 Outcome·Acceptance·Evidence에 짧게 연결합니다.

```text
problem / hypothesis → small usable change → observation method
→ observed result 또는 missing evidence → owner의 keep / change / stop
```

관찰 규모는 결정의 위험에 맞춥니다. 수동 walkthrough로 충분할 수 있으며 analytics 설치, 사용자 회의나 수치 실험을
모든 작업에 요구하지 않습니다. 미래 사용자/production이 필요하면 owner·trigger·필요 evidence를 기존 후속 Issue 또는
release handoff에 남깁니다. 현재 scoped acceptance는 완료할 수 있지만, 관측하지 않은 이익을 검증됐다고 표현하지 않습니다.

### 예시: Legal 문서를 찾기 쉽게 하기

다음은 **설명용 시나리오**이며 실제 사용자 조사나 선택된 디자인이 아닙니다.

- 문제 가설: 사용자가 필요한 약관 버전을 찾기 어렵다. 실제 문제 여부는 아직 확인되지 않았다.
- 작은 변경: 합의된 entry와 문서 탐색을 개선하되, 기존 법적 문구·버전·동의 동작은 보존한다.
- Verification: 링크/키보드 이동, loading/empty/error, 문서 버전과 동의 contract를 관련 테스트·Storybook/browser에서 확인한다.
- 관찰: owner 또는 동의한 테스트 사용자가 도움 없이 특정 버전 문서를 찾는 과정을 수동으로 본다. 현재 관찰 결과는 없다.
- 다음 결정: 찾기 쉬워졌다는 관찰이면 keep, entry 혼동이 남으면 change, 이 방향이 오히려 방해하면 stop/revert를 검토한다.
  미적 만족과 법적 변경은 Agent가 대신 승인하지 않는다.
- 인접 아이디어: 전체 동의 funnel analytics는 이 acceptance에 필요하지 않다. 별도 가치·근거·owner가 있으면 후속 Issue,
  그렇지 않으면 구현하지 않는다. 이 예시를 따라 Issue나 analytics를 자동 생성하지 않는다.

### 예시: 재개 진단의 신뢰성 개선

운영/개발 도구의 acceptance는 사용자 analytics 없이도 기술적으로 검증할 수 있습니다.
선택한 작업과 무관하거나 만료된 context를 추천하지 않는지 synthetic fixture로 확인하고, 기존 CLI 소비자와 실패 경로를
보호합니다. 실제 재개 진단 변경 PR #444 (private repository)와
[session-preflight 회귀 테스트](../../../scripts/ci/codex-session-preflight.test.mjs)는 그 증거입니다.
이는 모든 fresh session의 성능, native compaction 동등성 또는 개발 시간 단축을 증명하지 않습니다.

## Scoped Done과 portable evidence

다음은 새로운 workflow 상태가 아니라 **서로 다른 완료 주장**입니다.

- 구현됨: 범위에 맞는 diff가 존재한다.
- 로컬 검증됨: 명시한 환경·snapshot의 필요한 테스트를 실행해 결과를 읽었다.
- 통합됨: 해당 PR의 review/CI 조건을 통과하고 target에 병합됐다.
- Release-ready: 실제 target의 secret, migration, rollback 등 release owner의 조건이 충족됐다.
- Production-observed: 실제 운영 또는 사용자 관찰 결과가 있다.

통합 후에는 [Local branch cleanup](../github/branch-and-pr-strategy.md#local-branch-cleanup)에 따라 해당 task의 local
branch를 `deleted` 또는 `retained-with-reason`으로 인계합니다. PR/merge 근거와 삭제 결과·복구 위치 또는 보존 이유·다음
판단 조건을 남깁니다. 이 판정은 배포 완료나 다른 작업의 일괄 삭제 권한을 뜻하지 않으며, 상세 절차는 Git owner를 재사용합니다.

개발 도구처럼 development-only outcome에는 배포가 필요하지 않습니다. 반대로 happy path만 만든 뒤 필요한 실패 경로,
public contract나 검증을 미래로 미루면 usable slice가 아닙니다. 계약상 필요한 acceptance가 빠지면 현재 완료를 막습니다.
실제 target이 없는 production 주장은 `PENDING_TARGET`이며 local rehearsal나 QA PASS로 승격하지 않습니다.

여러 owner를 잇거나 중요한 결정·재사용할 학습이 있으면 짧은 evidence map을 남깁니다.

| Problem   | Decision / constraint    | Change    | Verification               | Observed result / follow-up                |
| --------- | ------------------------ | --------- | -------------------------- | ------------------------------------------ |
| 근거 링크 | policy/architecture 링크 | commit/PR | tests/review/CI와 snapshot | 실제 결과 또는 owner·trigger·필요 evidence |

기존 본문을 새 ledger로 복제하지 않습니다. 임시 plan/checkpoint와 `artifacts/local/`은 다른 clone의 필수 입력이 아니므로,
다음 개발자가 필요한 결정은 tracked owner, 구현 근거는 PR/test/CI, 미해결 작업은 Issue로 연결합니다.
로컬 기억 없이 재개하거나 중요한 근거가 없을 때는 [Session continuity](./session-continuity.md)에 따라 재조사합니다.

## WIP와 inspect/adapt

새 outcome을 시작하거나 blocked work를 넘길 때 진행 중인 결과·review backlog·dependency를 먼저 확인합니다.
우선 완료하거나 unblock할 수 있는 slice가 있는지 판단하고, 인접 아이디어는 [scope disposition](../github/branch-and-pr-strategy.md#scope-drift-disposition)으로
분리합니다. Child 수가 동시 작업 여력은 아니며 backlog/조건부 계획 전체를 active WIP로 세지 않습니다. 별도 board나 commit
개수 제한을 추가하지 않습니다.

반복된 결함·재작업·비용/지연 문제가 있을 때만 기존 Issue/troubleshooting owner에서 작은 학습 loop를 구성합니다.

```text
observed friction → 한 가지 corrective practice → 효과를 확인할 위치/조건 → keep / revise / drop
```

예를 들어 재개 진단에서 잘못된 identity가 정상 후보로 보이는 문제가 재현되었다면, boundary regression을 추가하고
다음 같은 입력에서 진단과 추천이 안전한지 확인합니다. 통과하면 practice를 유지하고, 같은 입력이 다시 실패하면 재현
근거로 수정합니다. 오래된 guard가 더 이상 의미가 없다면 owner가 삭제 여부를 검토합니다. 테스트가 기술적 결함을 막는다는
관측과 사람의 재작업 시간이 줄었다는 미측정 주장은 분리합니다. 불확실한 선택은 작은 실험의 종료 기준과 다음 결정을
정하며 무기한 조사나 매 단계 회고를 만들지 않습니다.
