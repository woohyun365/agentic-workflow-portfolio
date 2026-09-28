# Agentic Engineering methodology

> **Audience:** human-to-human portfolio, onboarding, and engineering discussion reference.
> 이 문서는 `AGENTS.md`를 대체하는 instruction owner가 아니며 coding agent의 실행 규칙은 root guidance와 tracked agent
> workflow가 소유합니다.

## 목적

Roommate Matching에서 AI를 사용했다는 사실보다 **어떤 engineering system 안에서 AI를 사용했고 왜 그 방식을 선택했는지**를
설명합니다. 미래의 포트폴리오·이력서·면접 자료는 이 문서의 현재 repository evidence와 Git history를 다시 검증해
작성하며, 확인되지 않은 생산성·운영 경험을 주장하지 않습니다.

## 선택한 접근

현재 개발 방식을 한 문장으로 표현하면 다음과 같습니다.

> **Policy-first, Contract-driven, Evidence-driven, Harness-engineered, Human-governed Agentic Programming**

사람은 사용자 문제, 정책, trade-off, 외부 권한, 최종 품질 판단을 소유합니다. Agent는 repository evidence를 탐색하고,
bounded change를 구현하며, 테스트·CI·리허설 결과를 통해 반복적으로 수정합니다.

## 방법론별 적용 수준

| 방법론·표현                              | 적용 수준       | Repository evidence                                                                          |
| ---------------------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| Agentic Programming                      | 높음            | 사용자 결정 + Agent 구현·검증, Git diff·CI 기반 완료 판정                                    |
| Harness Engineering                      | 높음            | `AGENTS.md`, workflow guides, repository policy, CI, Storybook, rehearsal                    |
| Context Engineering                      | 높음            | source freshness, progressive guide discovery, bounded context/checkpoint                    |
| Repository as System of Record           | 높음            | policy, architecture, contract, test, runbook, Git history                                   |
| Evaluation / Evidence-driven Development | 높음            | expected-red, targeted regression, repo policy, CI summary, performance fixture              |
| Policy-first                             | 높음            | `docs/policies/`에서 제품·보안·운영 불변 조건 소유                                           |
| Contract-driven                          | 높음            | `packages/shared` Zod contract와 producer/consumer test                                      |
| Human-governed                           | 높음            | credential·provider·production·legal·비용·최종 UX authority gate                             |
| Long-running Agent Harness               | 중간~높음       | session continuity, task context, checkpoint, finished-plan lifecycle                        |
| Agentic DevOps                           | 중간            | CI, dependency, infrastructure, observability, release readiness; production automation 제외 |
| Multi-agent Orchestration                | 중간            | single-first, independent lane에만 bounded child/team 사용                                   |
| AI-DLC / Agile lifecycle practices       | 선택적 적용     | intent·evidence owner 연결, scoped Done, 독립 QA disposition, 관찰/feedback handoff          |
| Full SDD                                 | 부분 적용       | policy·plan·acceptance는 강하지만 feature spec이 모든 code를 생성하는 구조는 아님            |
| Autonomous Software Factory              | 낮음            | 제품 roadmap·provider·production 결정을 Agent가 자율 소유하지 않음                           |
| Vibe Coding                              | 의도적으로 배제 | 코드·계약·테스트·diff를 검토하고 실패 evidence를 숨기지 않음                                 |

## Agentic Programming과 Vibe Coding의 구분

Agentic Programming에서는 사람이 모든 코드를 직접 입력하지 않아도 code와 architecture의 책임을 유지하고 Agent가 source
tree, tools, tests를 사용해 긴 작업을 수행합니다. Vibe Coding은 사람이 코드의 내부 의미를 적극적으로 검토하지 않는
방식을 가리킵니다.

이 저장소는 다음 이유로 Vibe Coding을 목표로 하지 않습니다.

- 정책과 action authority를 먼저 정합니다.
- API transaction과 public contract를 UI copy보다 우선합니다.
- behavior change와 cleanup을 분리하고 regression을 먼저 고정합니다.
- Agent의 완료 문장보다 working tree, test, CI, provider evidence를 우선합니다.
- 실패한 검증은 blocker 또는 successor work로 남깁니다.
- staging·commit·PR 단위에서 변경 의도와 검증 경계를 재확인합니다.

참고: [Martin Fowler — Agentic Programming](https://martinfowler.com/bliki/AgenticProgramming.html)

## Harness Engineering

Harness Engineering은 더 긴 prompt를 쓰는 것보다 Agent가 신뢰 가능한 일을 할 수 있는 환경과 feedback loop를 만드는
접근입니다.

```text
intent and authority
  → repository map and current evidence
    → bounded plan/change
      → compiler/test/CI/rehearsal
        → failure feedback
          → repair or explicit handoff
```

Repository 적용:

- root `AGENTS.md`는 작은 공통 불변 조건과 workflow entry를 제공합니다.
- `docs/development/agent-workflows/`는 task에 필요한 guide만 점진적으로 제공합니다.
- `scripts/ci/`는 source-of-truth, artifact, workflow, branch, intake 등의 deterministic boundary를 검증합니다.
- Storybook과 Playwright는 UI와 browser behavior를 Agent가 관찰 가능한 형태로 만듭니다.
- local infrastructure rehearsal과 observability는 runtime failure를 설명 가능한 evidence로 만듭니다.
- Git branch와 bounded PR은 Agent 작업을 review·rollback 가능한 단위로 제한합니다.

참고: [OpenAI — Harness engineering](https://openai.com/index/harness-engineering/)

## Context Engineering

Context Engineering은 한 번의 prompt보다 제한된 context window에 어떤 instructions, code, docs, tools, history를 언제
제공할지 설계하는 방식입니다.

이 저장소는 다음 freshness 순서를 사용합니다.

```text
current request
  → current working tree code / contract / test
    → tracked policy / architecture / runbook
      → active plan and bounded checkpoint
        → local memory and historical evidence
```

과거 대화 전체를 기본 context로 복원하지 않고 path, identifier, compact checkpoint를 이용해 필요한 정보를 just-in-time으로
읽습니다. 이는 큰 instruction blob으로 모든 상황을 통제하려는 방식보다 stale context와 attention dilution을 줄입니다.

참고: [Anthropic — Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

## Policy-first와 Contract-driven Development

제품 정책은 화면별 boolean이나 Agent의 해석이 아니라 `docs/policies/`에서 현재 의미를 소유합니다. 이 의미는 가능한
범위에서 실행 가능한 contract와 server precondition으로 내려갑니다.

```text
product policy
  → shared Zod schema and enum
    → API command/query transaction
      → BFF privacy/error shaping
        → UI capability and scenario
```

이 방식은 FE·BE가 같은 TypeScript monorepo와 `packages/shared`를 사용함으로써 contract·schema·constraint 변경을 하나의
atomic diff로 검증할 수 있다는 장점과 연결됩니다.

## Evaluation / Evidence-driven Development

Agent의 결과는 생성량이나 설명의 자연스러움보다 검증 가능한 outcome으로 평가합니다.

- expected-red test
- targeted unit/integration regression
- lint/typecheck/build
- shared producer/consumer contract
- Storybook scenario와 browser smoke
- repository policy와 architecture boundary
- local rehearsal와 target-specific release handoff
- performance p50/p95, compute, cache, flake evidence

테스트 숫자를 늘리는 것이 목적은 아닙니다. 어떤 위험을 어느 계층이 검증하고, 실패 시 어떤 owner가 수정하는지를 명확히
하는 것이 목적입니다.

## AI-DLC와 Agile을 선택적으로 연결하는 방식

AWS의 [AI-DLC 소개](https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/)는 Inception, Construction,
Operations를 설명하며 지속적인 context뿐 아니라 사람의 판단과 검증을 함께 다룹니다. 따라서 checkpoint 파일이 있다는
사실만으로 AI-DLC 전체가 적용됐다고 말하지 않습니다. [Upstream reviewer protocol](https://awslabs.github.io/aidlc-workflows/reference/04-stage-protocol/#reviewer-invocation)은
builder의 결론과 분리된 검토 맥락을 사용합니다. 이는 특정 구현의 방법이며 repository의 native runtime 기능을 증명하지 않습니다.

이 프로젝트의 적용 판단은 별도 AI-DLC 패키지·hooks·state directory를 설치하는 대신 기존 owner를 연결하는 것입니다.
[Development lifecycle](./agent-workflows/development-lifecycle.md)이 intent→구현→검증→통합→관찰/follow-up을 연결하고,
[QA workflow](./agent-workflows/qa.md)는 위험 기반 독립 검토와 실제 runner/test evidence를 구분합니다. 새로운 역할 이름이나
모델 변경 자체를 독립 검증으로 계산하지 않습니다. 독립 리뷰는 테스트·CI·사람의 승인과 서로 대체하지 않습니다.

[Agile 원칙](https://agilemanifesto.org/principles.html)의 작동하는 increment와 feedback을 참고하지만, PR 병합을 곧바로
사용자 가치 전달로 계산하거나 Scrum 전체를 채택했다고 표현하지 않습니다. 기술적 실패의 재현과 개선은 내부 feedback이고,
사용자 관찰·aesthetic approval·production 성공은 별도 근거가 필요합니다. 미래 관측은 owner/trigger/evidence handoff로
남기며 개발-only acceptance와 섞지 않습니다. 지도·절차는 advisory-policy이고 테스트/CI는 별도의 실행 가능한 control입니다.

공식 자료 확인: 2026-09-10. 위 내용은 방법론과 현재 문서의 비교이며 upstream의 특정 release 실행 검증, Repo 생산성 향상,
운영 자동화나 실제 사용자 효과를 입증한 benchmark가 아닙니다. 보관할 맥락은 현재 code/contract, durable 결정, PR/CI와
bounded handoff이며, 전체 대화나 모든 방법론 산출물을 복제하는 별도 ledger가 아닙니다.

## Human-governed Agentic DevOps

Agentic DevOps는 Agent가 coding뿐 아니라 계획, 테스트, CI, dependency, infrastructure, observability, release readiness에
참여하는 방식을 포괄합니다. 현재 저장소는 pre-production 범위에서 이를 적용하지만 다음은 사람이 소유합니다.

- product policy와 UX trade-off
- 법적·개인정보 결정
- third-party App과 credential 승인
- production deploy, traffic, rollback
- 비용 수용과 실제 운영 readiness
- 사용자 관찰에 기반한 최종 visual 만족도

따라서 현재 구조는 완전 자율 운영이 아니라 **Human-governed Agentic DevOps**입니다.

참고: [Microsoft — Agentic DevOps foundations](https://devblogs.microsoft.com/all-things-azure/getting-started-with-agentic-devops-part-1-foundations/)

## Full SDD를 그대로 채택하지 않은 이유

GitHub Spec Kit의 Full SDD는 `Spec → Plan → Tasks → Implement`를 중심으로 specification을 primary artifact이자 executable
implementation source로 다룹니다.

이 저장소는 SDD의 다음 요소를 적극 사용합니다.

- 구현 전에 policy, Decision, OQ, acceptance와 test shape를 고정
- shared runtime contract
- plan과 bounded task
- code/test/policy conflict 확인
- 검증 결과를 다음 specification/decision에 반영

그러나 Full SDD라고 표현하지 않는 이유가 있습니다.

- 모든 feature가 tracked canonical spec directory를 갖지는 않습니다.
- policy 문서가 code를 자동 생성하지 않습니다.
- stale 문서보다 current working tree의 code·contract·test를 우선합니다.
- 탐색적 UI와 pre-release 구현에서 모든 세부사항을 사전에 완전 명세하면 학습 비용과 문서 drift가 커질 수 있습니다.
- local execution plan은 lifecycle artifact이며 최종 decision은 code, test, tracked docs로 승격합니다.

따라서 현재 선택은 **SDD 원칙을 policy·contract·acceptance에 선택적으로 적용하는 구조**입니다.

참고: [GitHub Spec Kit — Specification-Driven Development](https://github.com/github/spec-kit/blob/main/spec-driven.md)

## Autonomous Software Factory를 목표로 하지 않은 이유

완전 Autonomous Software Factory는 Agent가 task discovery, implementation, review, merge, deploy와 운영 판단을 광범위하게
소유하는 방향입니다. 이 저장소는 다음 이유로 이를 현재 목표로 두지 않습니다.

- 기숙사·성별·프로필·채팅·신고·법적 동의처럼 사람의 가치·법적 판단이 필요한 정책이 있습니다.
- 실제 사용자와 production evidence가 없는 pre-release 상태입니다.
- private repository provider 권한과 비용은 소유자가 승인해야 합니다.
- Agent가 같은 오류를 더 빠르게 확대하지 않도록 CI·architecture·authority gate가 먼저 필요합니다.
- 1인 개발에서 최종 제품 의도와 품질 책임은 개발자에게 남아야 합니다.

DORA는 AI가 조직의 기존 강점과 약점을 증폭한다고 설명합니다. 따라서 자동화 수준보다 테스트, platform, documentation,
feedback loop의 품질을 먼저 높이는 방향을 선택했습니다.

참고: [DORA — State of AI-assisted Software Development 2025](https://dora.dev/research/2025/dora-report/)

## Multi-agent와 long-running work

Multi-agent는 모든 작업의 기본값이 아닙니다. 독립적인 evidence·파일 owner가 존재하고 병렬화 이득이 coordination 비용보다
클 때만 사용합니다. 최종 decision, integration, response, verification은 leader가 소유합니다.

이 원칙의 현재 공통 owner는 [실행 계약](./agent-workflows/agent-execution-contract.md),
[Orchestration](./agent-workflows/orchestration.md), [독립 QA](./agent-workflows/qa.md)입니다. 공통 절차·위임 packet·완료 기준 위에
[host adapter](./agent-workflows/adapters/README.md)가 실제 역할·모델·권한·lifecycle을 연결합니다. Codex와 Claude 모두
이 공통 계약의 소비자이며, 새 host도 명시적인 adapter와 capability 검증 없이 기존 host의 설정을 상속하지 않습니다.

[Repository-guided parent–subagent orchestration case study](./agentic-orchestration-case-study.md)는 당시 Codex 구현의
역사적 evidence이지 현재 공통 모델 기본값이 아닙니다. Codex의 현재 role/model/effort·count 추천과 admission은
[Codex adapter](./agent-workflows/adapters/codex.md)가 소유합니다. Recommendation은 자동 spawn이나 runtime authority가
아니며 실제 지원 확인과 leader-only synthesis를 거칩니다. 문서 연결·정적 검증을 실제 host 실행 입증으로 세지 않습니다.

긴 작업은 대화 전체를 기억한다고 가정하지 않고 다음 artifact로 이어갑니다.

- current objective
- branch / HEAD / working tree
- changed and staged files
- verification
- next action
- blocker
- bounded plan and task context

참고: [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

## 포트폴리오·면접에서 사용하는 방법

이 문서 자체를 답변 script로 암기하지 않습니다. 다음 순서로 current evidence를 다시 확인해 설명합니다.

```text
problem observed
  → measured evidence
    → alternatives considered
      → chosen boundary and human decision
        → implementation and regression proof
          → limitation and revisit trigger
```

예를 들어 CI 개선을 설명할 때는 “Turborepo를 사용했다”보다 다음을 증명하는 것이 중요합니다.

- 어떤 stage가 병목이었는가
- wall time과 compute time을 어떻게 구분했는가
- compiler, cache, sharding, provider 대안을 어떻게 비교했는가
- test signal을 줄이지 않고 무엇이 개선됐는가
- 선택하지 않은 도구와 재검토 조건은 무엇인가

### Engineering evidence map

| Case                           | Current decision                                                                      | Measurement                                                                                            | Implementation                                                                                                                                                                           | Limitation / revisit                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Web test environment partition | [Monorepo CI architecture](../architecture/platform/monorepo-ci.md)                   | [Monorepo CI baseline](./ci/monorepo-ci-baseline.md)                                                   | PR #370 (private repository)                                                                                                                           | Natural post-change cohort와 later DAG evidence는 baseline에서 계속 갱신       |
| API integration DB sharding    | [Monorepo CI architecture](../architecture/platform/monorepo-ci.md)                   | [Monorepo CI baseline](./ci/monorepo-ci-baseline.md)                                                   | PR #371 (private repository)                                                                                                                           | Duplicate setup과 API-only advisory gap은 later DAG work에서 재검토            |
| Web validation DAG             | [Monorepo CI architecture](../architecture/platform/monorepo-ci.md)                   | [Monorepo CI baseline](./ci/monorepo-ci-baseline.md)                                                   | PR #372 (private repository)                                                                                                                           | Unit만 분리하며 artifact transfer·추가 shard는 cost evidence 후 재검토         |
| Compiler and native cache      | [Monorepo CI architecture](../architecture/platform/monorepo-ci.md)                   | [Monorepo CI baseline](./ci/monorepo-ci-baseline.md)                                                   | PR #374 (private repository)                                                                                                                           | Exact-hit cohort와 cache-family expiry는 baseline에서 계속 관측                |
| Adaptive child orchestration   | [Agentic architecture decisions](./agent-workflows/agentic-architecture-decisions.md) | [Case study verification](./agentic-orchestration-case-study.md#verification에서-드러난-실패와-repair) | PR #385 (private repository), #386 (private repository), #387 (private repository) | Comparable productivity 측정과 host-authenticated runtime metadata는 아직 없음 |

이 map은 current evidence의 위치만 연결합니다. 수치, plan phase, 개인 면접 답변은 복사하지 않으며, underlying decision이
되돌려지면 entry도 제거합니다.

Agent 활용을 설명할 때도 “AI가 코드를 작성했다”보다 다음을 근거로 사용합니다.

- 사람이 소유한 policy·security·provider decision
- Agent가 수행한 탐색·반복 구현·검증
- repository harness와 context owner
- 실패를 숨기지 않은 provider/CI evidence
- 실제 사용자·production 경험과 local rehearsal의 구분

## 한계와 재검토 조건

- 실제 사용자 feedback과 production incident 대응 경험은 아직 없습니다.
- 완전한 spec-code drift detection이나 autonomous deployment가 존재하지 않습니다.
- Multi-agent 효율은 task shape에 따라 다르며 자동 fan-out 자체가 목표가 아닙니다.
- Full SDD는 feature 규모와 requirement 안정성이 높아지고 tracked spec의 유지 이득이 비용보다 커질 때 재검토합니다.
- 더 높은 autonomy는 CI, security, observability, rollback과 provider authority가 충분히 검증된 뒤 재검토합니다.

마지막 검토일: 2026-08-31
