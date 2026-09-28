# Agentic Workflow Portfolio — 공통 Agent 계약과 Codex/Claude Code Adapter

개인 풀스택 서비스(대학생 룸메이트 매칭, 비공개 저장소)를 AI coding agent와 개발하며 설계·구현한 **agent workflow harness**의
발췌본입니다. 학교 식별 정보는 제거했습니다(프로젝트명 `Roommate Matching`, 역할 접두어 `repo_`).
제품 코드는 포함하지 않았으며, 링크의 PR 번호는 비공개 저장소 기준입니다.

## 풀려고 한 문제

1. **AI가 만든 결과를 믿을 근거가 없었다.** Agent의 "완료" 문장, 역할 이름, 설정 파일 존재만으로는 실제 모델·권한·검증이
   지켜졌는지 알 수 없었습니다.
2. **처음 만든 workflow가 Codex 전용이었다.** 모델·effort·QA 규칙이 Codex에 묶여 있어 Claude Code로 옮기면
   같은 품질 절차가 적용되지 않았습니다. (주간 사용량 한도 때문에 host를 바꿔야 하는 실제 상황이 있었습니다.)
3. **Hook·설정 같은 통제 장치가 고장 났을 때의 동작**이 보장인지 아닌지 구분되지 않았습니다.

## 설계 한 줄 요약

```text
공통 계약(요청 권한 → 문서 탐색 → 위임 → 독립 QA → 인계)
  ├─ Codex adapter : 모델/effort 라우팅, 필수 독립 QA, 복구 규칙, OMX
  ├─ Claude adapter: 등록된 task만 native subagent 호출, 모델 검사, 결과 수집, 독립 리뷰, 권한 gate
  └─ 새 host        : 같은 계약 + conformance test (synthetic 제3 adapter로 검증)
```

모든 규칙에 강도를 표기합니다: `deterministic-static`(테스트) / `advisory-policy`(문서) / `model-mediated`(agent 판단) /
`native-runtime`(host 강제). 정적 테스트 통과를 실제 모델·권한 입증으로 세지 않습니다.

## 폴더 안내

| 경로 | 내용 |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | 모든 agent 공통 저장소 지침 / Claude 진입점 |
| `docs/development/agent-workflows/` | 공통 계약(실행·orchestration·QA·위임·계획 lifecycle)과 `adapters/`(Codex·Claude·교차 인계) |
| `docs/development/agentic-engineering-methodology.md` | 채택한 방법론과 적용 수준(과장 금지 원칙 포함) |
| `docs/development/agentic-orchestration-case-study.md` | Codex 단계의 parent–subagent 설계 case study |
| `.codex/`, `.claude/` | 역할 정의(TOML/Markdown), Claude hook·권한 설정 |
| `scripts/agents/{common,codex,claude,bridge}` | 계약을 실제로 소비하는 코드(정책·등록·hook·collector·preflight) |
| `scripts/ci/*.test.mjs` | 위 코드의 회귀·negative 테스트 |
| `EVIDENCE.md` | 실제로 확인된 결과와 수치 |
| `ROADMAP.md` | 설계만 존재하거나 검증 대기인 항목 |

이 발췌본은 원 저장소의 다른 문서(제품 정책, GitHub 전략 등)를 포함하지 않으므로 일부 상대 링크는 열리지 않습니다.
