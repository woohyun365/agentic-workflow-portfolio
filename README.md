# Context Engineering 기반 AI Agentic Coding System — 비용·품질 균일화 설계

1인 풀스택 서비스(대학생 룸메이트 매칭, 비공개 저장소)를 AI coding agent(OpenAI Codex, Anthropic Claude Code)와
개발하며 설계·구현한 **agent workflow architecture**의 발췌본입니다. 학교 식별 정보는 제거했습니다
(프로젝트명 `Roommate Matching`, 역할 접두어 `repo_`). 제품 코드는 포함하지 않았고 PR 번호는 비공개 저장소 기준입니다.

> 한 줄 요약: **같은 요청이라도 도구·모델·설정·대화 이력에 따라 비용과 품질이 들쭉날쭉하던 AI agent 작업을, "무엇을 읽히고(Context), 누가 어떤 모델로 하고(Routing), 누가 검증하는가(Multi-agent QA)"를 저장소가 결정하는 구조로 바꿨습니다.**

## 1. 문제 — agent 결과의 비용·품질 편차

| 관찰한 문제 | 결과 |
|---|---|
| 역할·모델·effort가 개인/전역 설정에 따라 달라짐(저장소에 기본값 없음) | clone·세션마다 같은 요청의 품질이 달라짐 |
| 탐색 로그·중간 산출물·전체 대화가 parent context에 누적 | context 낭비, 오래된 정보가 최신 코드보다 우선되는 오류 |
| "위험해 보이는 단어"로 effort를 정함(위험도와 추론 난이도가 섞임) | 쉬운 작업에 비싼 추론, 어려운 작업에 부족한 추론 |
| 모든 child를 가장 비싼 모델로 실행 / 또는 전면 저가 모델 | 주간 사용량 한도 조기 소진 / 품질 저하 위험 |
| agent의 "완료" 보고·역할 이름·설정 파일 존재를 근거로 판단 | 실제 모델·권한·검증이 지켜졌는지 알 수 없음 |
| workflow가 Codex 전용 | Claude Code로 바꾸면(한도 소진으로 실제 발생) 같은 품질 절차가 사라짐 |

## 2. 해결 설계

### 2.1 Context Engineering — 무엇을, 언제, 얼마나 읽힐 것인가
- **신뢰 순서 고정**: 현재 요청 → 현재 코드·계약·테스트 → 정책/설계 문서 → 활성 계획 → 과거 기록.
  과거 대화·메모리는 기본 입력이 아닙니다(`AGENTS.md` §1, 방법론 문서 "Context Engineering").
- **Progressive disclosure / 문서 graph**: 71개 개발 문서를 intent → 권한 → context → 위임 → QA → 인계로 연결된 graph로 감사하고,
  작업에 필요한 최소 readset만 읽게 했습니다(`agent-workflows/README.md`, `adapters/README.md`).
- **Scoped packet**: child에게 전체 이력 대신 목적·범위·source 포인터·acceptance·출력 형식·중단 조건만 전달합니다
  (`request-intake/delegation.md`). 독립 리뷰어에게는 builder의 추론·기대 결론을 주지 않습니다(`qa.md`).
- **Bounded checkpoint**: 긴 작업은 objective / branch·HEAD / 변경 파일 / 검증 / 다음 행동 / blocker만 인계합니다
  (`session-continuity.md`). 계획은 host 공통 `.plans/` 하나에 두고 Codex↔Claude가 같은 계획을 이어받습니다.

### 2.2 적응형 모델·effort 라우팅 — 비용을 줄이되 품질 하한을 지킨다
- **두 번 판정**: Pass 1은 요청의 의도·위험, Pass 2는 저장소를 실제로 읽은 뒤의 근거로 역할과 effort를 정합니다.
  위험도(impact)와 추론 난이도(complexity)를 분리했습니다(`agentic-architecture-decisions.md` DA-009).
- **유한 profile**: 검증 가능한 bounded 작업만 저가 모델로 보냅니다(Codex: 구현·조사 Sol, 고정 추출 Luna / 기본·최종 QA Astra).
  공식 단가 비율은 Sol/Astra 20%, Luna/Astra 1%이지만 **절감률을 주장하지 않습니다**
  (비교에는 Parent+child+QA+재작업 전체가 필요, `agentic-orchestration-case-study.md` "비용 가설과 관측 한계").
- **한 번의 복구**: 저가 모델 실패 시 writer를 회수하고 기본 모델로 한 번만 복구합니다. 권한·quota 문제를 모델 교체로 우회하지 않습니다.
- **Claude 적용**: task profile(haiku 추출 / sonnet 표준 / opus 복잡·독립 리뷰)을 Lead가 고르고, 실행 직전 hook이
  요청 모델을 검사하며 실행 후 실제 모델을 기록해 대조합니다.

### 2.3 Multi-agent architecture — 필요한 때만, 한 명이 쓰고, 다른 한 명이 검증
- **Direct-first**: 결정적 도구 → 단일 agent → 독립 증거가 있을 때만 bounded child(`orchestration.md` pattern selector).
- **One writer + leader synthesis**: 쓰기 owner는 하나, 결과 통합·판정은 Parent만 합니다. 동시 writer는 lease로 직렬화했습니다.
- **Maker-checker 독립 QA**: fresh context 리뷰어가 요구사항·snapshot·diff만 보고 판정하고, Parent가 finding을 재현한 뒤 판정합니다.
  PASS는 미실행 검증(`notRun`)·gap이 있으면 거부됩니다. 반복은 기본 2회로 제한합니다.

### 2.4 Host-neutral 공통 계약 + Codex/Claude adapter — 도구가 바뀌어도 같은 품질 절차
- 공통 계약(실행·orchestration·QA·위임·계획 lifecycle)이 책임을 소유하고, adapter는 host의 모델·권한·수명주기만 연결합니다.
- Codex도 공통 계약의 소비자로 재연결했고, synthetic 제3 adapter conformance test로 새 host 확장성을 검사합니다.
- 모든 규칙에 강도를 표기합니다: `deterministic-static`(테스트) / `advisory-policy`(문서) / `model-mediated`(agent 판단) /
  `native-runtime`(host 강제). 정적 PASS를 실제 모델·권한 입증으로 세지 않습니다.
- 공식 문서 원문 대조로 "hook이 고장 나면 통제가 조용히 풀린다(fail-open)"를 확인하고, 역할별 `ask` 권한 규칙 +
  `PermissionRequest` grant로 재설계해 고장 시 자동 승인 대신 **사람 승인**으로 넘어가게 했습니다.

## 3. 결과 요약 (상세: [EVIDENCE.md](EVIDENCE.md))

- 공통 계약 재설계·Codex 재연결 PR 2건 병합, Claude adapter PR CI 11/11 통과(병합 전).
- workflow 테스트 467개, 저장소 정책 테스트 1,116개 통과(최신 작업 트리).
- Codex: bounded 구현·조사·추출을 저가 모델 xhigh로 실행해 각 oracle과 독립 QA 통과(표본 소수, 한계 명시).
- Claude: 잘못된 모델 요청 사전 차단, Sonnet 구현 → Opus 독립 리뷰 → 완료 판정, 독립 리뷰가 근거 없는 주장과 우회 결함 5건 적발.

## 4. 다음 문제 해결 방향 (설계 단계, [ROADMAP.md](ROADMAP.md))

- Claude subagent를 (역할 × 모델 × effort 단계) profile로 재설계: 지금은 child가 Parent effort를 그대로 상속해 비용·품질이 세션마다 달라짐.
- 실패 원인별 복구: 정보가 충분한데 오답 → 상위 모델, 누락·중단 → effort 상향(공식 권고 근거).
- 등록·리뷰 packet 생성 helper로 수작업 비용 제거(수작업이 번거로우면 통제 밖 경로로 우회하게 되는 운영 위험).
- 비용 실측: Parent+child+QA+복구 전체를 같은 task·snapshot에서 비교하는 측정 설계.

## 폴더 안내

| 경로 | 내용 |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | 모든 agent 공통 저장소 지침 / Claude 진입점 |
| `docs/development/agentic-engineering-methodology.md` | 채택한 방법론(Context Engineering, Harness Engineering 등)과 적용 수준 |
| `docs/development/agentic-orchestration-case-study.md` | parent–subagent·모델 라우팅 설계의 문제·대안·실측·한계 |
| `docs/development/agent-workflows/` | 공통 계약과 `adapters/`(Codex·Claude·교차 인계) |
| `.codex/`, `.claude/` | 역할 정의(TOML/Markdown), Claude hook·권한 설정 |
| `scripts/agents/{common,codex,claude,bridge}` | 계약을 실제로 소비하는 코드(라우팅·profile·등록·hook·collector) |
| `scripts/ci/*.test.mjs` | 회귀·negative 테스트 |
| `portfolio.pdf` | 이 README와 EVIDENCE·ROADMAP의 PDF 버전 |

발췌본이라 원 저장소의 다른 문서로 가는 일부 상대 링크는 열리지 않습니다.
