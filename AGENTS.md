# Roommate Matching repository guidance

이 파일은 이 저장소에서 작업하는 모든 coding agent가 공유하는 **추적 가능한 repository instruction**이다.
현재 사용자 요청과 working tree가 가장 우선하며, 이 문서는 장기간 유지할 저장소 불변 조건만 다룬다.

## 1. Source of truth와 freshness

정보는 다음 순서로 신뢰한다.

1. 현재 사용자 요청과 같은 thread의 최신 evidence
2. current working tree의 production code, contract, tests
3. `docs/policies/`, `docs/architecture/`, `docs/runbooks/`, owner README
4. 현재 branch·commit과 해당 작업의 active plan
5. local checkpoint, memory, wiki, historical document

- 하위 정보가 상위 정보와 충돌하면 하위 정보를 수정하거나 폐기한다.
- 과거 turn, 완료 plan, local memory를 현재 사실처럼 재사용하지 않는다.
- 외부 provider·release target 없이 정할 수 없는 사항은 추측하지 않고 tracked readiness/evidence handoff로 남긴다.

## 2. Repository map

- `apps/web`: Next.js 사용자 Web과 BFF
- `apps/api`: NestJS API, Prisma schema·migration·seed
- `packages/shared`: FE/BE 공유 contract와 schema
- `packages/config-*`: 공통 lint·test·build 설정
- `docs/policies`: 제품·보안·운영 불변 정책
- `docs/architecture`: 현재 책임 경계와 설계 결정
- `docs/development`: 개발·CI 기준과 troubleshooting
- `docs/runbooks`: 제품·서비스 운영 절차
- `infra`: 배포 후보, rehearsal, observability, release runbook
- 로컬 infra 환경 선택: `infra/runbooks/rehearsal/local-environments.md`에서 OrbStack·독립 Linux VM의 용도와 증거 경계를 확인한다.
- `scripts`: CI·검증·artifact·infra 자동화
- `local-docs`: Git에서 제외하는 legacy·개인 분석·과거 기록
- `.plans`: host 공통 local 계획; lifecycle은 tracked session-continuity가 소유
- `.omx`·`.omc`: 선택한 host의 local runtime state; 제품 source of truth가 아님

## 3. Canonical commands

- 빠른 staged-file 검사: `pnpm check:fast`
- repository policy: `pnpm test:repo-policy`
- API 검사: `pnpm api:check`
- Web 검사: `pnpm web:check`
- 전체 lint: `pnpm lint`
- 전체 typecheck: `pnpm typecheck`
- 전체 정적 검사: `pnpm check`
- infra 정적 검사: `pnpm infra:check:static`
- infra 전체 검사: `pnpm infra:check`

변경 범위에 가장 가까운 targeted test를 먼저 실행하고, 영향 범위에 따라 상위 검증을 추가한다.

## 4. Session startup과 workflow routing

- 처음 참여한 개발자는 `docs/development/agent-workflows/getting-started.md`의 요청 예시를 사용한다.
- Coding agent는 current request → 이 파일 → 최소 관련 workflow guide → code/test evidence 순서로 읽는다.
- 새 작업은 과거 memory를 기본 입력으로 읽지 않는다. `이어서`, plan/phase가 명시되거나 현재 요청이 같은 task의 active
  runtime/checkpoint를 명확히 이어갈 때만 `session-continuity.md`의 resume 경로를 사용한다.
- multi-step/resume 작업의 Git 기준점은 branch·HEAD·raw working tree로 확인한다. 공통 문서/계획 진단은
  `session-continuity.md`의 명시적 host 진입 명령을 사용한다. `pnpm codex:preflight`는 Codex 전용 명령이다.
- 분석·구현·검증 공통 계약은 `agent-execution-contract.md`, orchestration 선택은 `orchestration.md`를 따른다.
- Host별 모델·역할·권한 실행은 `docs/development/agent-workflows/adapters/README.md`에서 현재 host adapter를 선택한다.
- 명확한 기술 작업은 승인 범위에서 진행하고 중요한 제품·비용·위험 선택은 근거를 갖춰 사용자와 협의한다.
  결정권·짧은 협의·specialist 통신 경계는 `docs/development/agent-workflows/owner-lead-collaboration.md`를 따른다.
- 한 owner 작업은 single agent가 기본이다. 독립적인 evidence·파일 ownership이 있을 때만 bounded child lane을 사용한다.
- Codex child 완료 또는 thread limit 오류 시 Parent는 `docs/development/agent-workflows/subagent-lifecycle.md`에 따라 결과 회수·
  capability별 완료 판정을 수행한다. V2 자동 회수 계약에서 close 부재를 결함으로 간주하지 않는다. Codex child 상한 6은 유지한다. 다른 host의 lifecycle·상한은 adapter가 소유하며 미지원 종료를 완료로 가장하지 않는다.
- architecture/feature/refactor plan 요청은 tracked plan-authoring workflow를 사용한다. 세부 routing은 해당 guide가
  존재할 때 on-demand로 읽으며 ignored local handoff를 durable source로 취급하지 않는다.
- 구현 요청은 `docs/development/github/branch-and-pr-strategy.md`를 따른다. `dev`·`main`에서 직접 구현하지 않고 fresh
  integration baseline에서 bounded branch를 만든 뒤 edit·stage·commit한다.

## 5. Implementation agreements

- 기존 utility, component, owner pattern을 먼저 재사용한다.
- 새 dependency는 사용자가 명시적으로 요청하지 않으면 추가하지 않는다.
- diff는 작고 review 가능하며 되돌릴 수 있게 유지한다.
- API/contract/persistence 변경은 owner와 transaction boundary를 함께 확인한다.
- framework나 SDK의 version-sensitive 동작은 현재 lockfile과 공식 문서를 기준으로 검증한다.
- generated file과 migration을 수동 편집하기 전 canonical generator/owner를 확인한다.
- production-only `pnpm deploy` 검증은 active checkout에서 실행하지 않고 Docker build stage 또는 disposable copy/worktree를
  사용한다. 오실행 복구는 `docs/development/troubleshooting/tooling/pnpm-legacy-deploy-active-checkout.md`를 따른다.
- 사용자 소유 untracked file과 현재 요청 밖의 working-tree 변경을 수정·삭제·revert하지 않는다.
- 장기 추적 문서와 owner README는 현재 책임·불변 조건·동작을 설명하며, active plan 파일명·Phase 번호·임시 checkpoint를
  근거로 사용하지 않는다. 이러한 lifecycle 표현은 plan, session checkpoint, 명시적인 migration evidence에만 둔다.

## 6. Cleanup과 refactor

- 수정 전에 cleanup plan을 작성한다.
- 기존 동작이 보호되지 않았다면 regression test를 먼저 추가한다.
- 추가보다 삭제, 새 abstraction보다 기존 boundary 복구를 우선한다.
- 호출부가 없는 코드인지 repo-wide search로 확인하고 dynamic import·framework convention도 점검한다.
- 한 번에 하나의 smell과 책임 경계를 다뤄 diff를 review 가능하게 유지한다.

## 7. Verification과 완료 보고

- 완료 주장을 증명할 최소 검증을 먼저 정의하고 실제 출력을 읽는다.
- 실패하면 원인을 해결하고 재검증한다. 환경 제한이면 다음으로 강한 증거와 검증 공백을 명시한다.
- UI 변경은 가능한 경우 production surface와 Storybook fixture의 정합성을 함께 확인한다.
- 최종 보고 순서:
  1. Added / Updated / Deleted 파일
  2. 핵심 변경
  3. 실행한 검증과 결과
  4. 남은 blocker 또는 risk
- 내부 role, prompt, plan 단계명 자체를 완료 근거로 사용하지 않는다.

## 8. Commit과 PR

- Shell을 사용할 수 있는 local coding session의 GitHub remote control plane은 `gh` CLI-first이고 Git transport는 Git
  credential이 소유한다. ChatGPT Web처럼 shell이 없는 session은 GitHub Connector-first이며, local Connector fallback은
  `docs/development/github/authentication-and-operator-access.md`의 단발성·명시적 경계를 따른다.
- 커밋 제목 기본 형식: `type(scope): 한글 설명 #이슈번호`
- PR 제목 기본 형식: `type(scope): 한글 설명 (#이슈번호)`
- `type`은 소문자 conventional commit 형태를 사용한다.
- 제목과 본문 설명은 한글 기반으로 작성한다.
- PR 본문은 `.github/PULL_REQUEST_TEMPLATE.md`를 따른다.
- 여러 줄 commit message는 message file 또는 heredoc과 `git commit -F`를 사용해 literal `\n` 오염을 막는다.
- commit body에는 필요한 경우 다음 Lore trailer를 사용한다.
  - `Constraint`, `Rejected`, `Confidence`, `Scope-risk`
  - `Reversibility`, `Directive`, `Tested`, `Not-tested`, `Related`

## 9. Artifact responsibility

- 로컬 검증 결과: `artifacts/local/`
- 추적 가능한 infra schema·manifest: `infra/artifacts/`
- 장기 정책·아키텍처·운영 문서: `docs/`
- CI 생성물: `${{ runner.temp }}` 아래 생성 후 `upload-artifact`
- repository script는 `scripts/artifacts/paths.mjs`의 `resolveArtifactPath()`를 사용한다.
- repository script가 `docs/`에 generated output을 쓰지 않는다.
- `.omx/reports`, `.omx/screenshots`, `.omx/artifacts`를 일반 CI·stress·rehearsal 출력 경로로 사용하지 않는다.

## 10. Repository inspection tools

- 내용 검색: `rg`
- 파일 목록: `rg --files` 또는 `fd`
- 디렉토리 구조: `eza --tree`
- 파일 확인: `bat --paging=never --color=never`
- `fzf`는 명시적 요청 또는 안전한 비대화식 filter에서만 사용한다.

도구가 없거나 POSIX 호환성을 검증할 때는 기본 shell 도구를 사용할 수 있다.

## 11. Context hygiene

- 새 요청은 이전 task의 plan·checklist보다 우선한다.
- checkpoint는 objective, branch/head, changed/staged files, verification, next action, blocker만 기록한다.
- 완료된 작업의 긴 transcript나 이미 commit된 diff를 memory에 반복 저장하지 않는다.
- local history와 finished plan은 조사 근거일 뿐 current implementation authority가 아니다.
- destructive action, production 변경, credential 사용, 외부 side effect는 사용자 권한과 release evidence를 확인한다.
- `.omx/wiki`, `.omx/reports`, `.omx/screenshots`를 session progress나 일반 검증 출력 owner로 만들지 않는다.
- `.omx/state`는 runtime/hooks가 소유하며 agent가 mode를 가장하는 JSON을 수동 생성하지 않는다.
