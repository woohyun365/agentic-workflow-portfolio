# Design task orchestration

디자이너가 없는 작업에서 Agent는 **대안을 보여주고 피드백을 반영하는 동료 역할**을 합니다. 사람을 여러 직군의 Agent로
일괄 치환하지 않고, 현재 필요한 책임과 산출물만 분리합니다. 공통 결정권·통신은 [Owner–Lead collaboration](../owner-lead-collaboration.md),
역할 책임·독립성은 [Orchestration](../orchestration.md), 검토 packet은 [QA](../qa.md)가 소유합니다.

## 책임에서 task로

| 필요한 관점         | 입력 → 산출물                                                       | 기본 수행자와 한계                                                               |
| ------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Product/UX          | 실제 사용자 job·content/state → flow/IA·보존할 의미                 | Parent 제안; 중요한 제품 선택은 사람, 요구사항 발명 금지                         |
| UX research         | 실제 관찰·문제 → 가설·사용자 test 과제·불확실성                     | Parent; repository 조사는 허용된 조사 역할 가능, 합성 persona는 인터뷰 결과 아님 |
| UI/BX/art direction | brief·reference aspect → 구체적 craft sketch·자체 점검·렌더링 후보  | Parent 또는 허용된 구현 역할; 임의 전역 brand 결정 금지                          |
| Interaction         | 현재 state/action → feedback/focus/reduced-motion 설계              | 선행 결과를 받은 같은 writer; 없는 product action 추가 금지                      |
| Design engineering  | 승인된 candidate → component/slot map·구현·검증 handoff             | 현재 FE owner의 Parent/구현 역할; API/hook 의미 보존                             |
| Critique/QA         | frozen requirement + 실제 이미지/동작 → 위치 있는 findings·대안·gap | 격리된 독립 검토자; 실행 산출물은 허용된 runner, 사람 취향 승인 불가             |

위 직군명은 새 역할 설정이나 고정 인원 수가 아닙니다. Source 기반 외부 기술 근거가 필요할 때만 연구 역할을 사용합니다.
[현재 host adapter](../adapters/README.md)가 concrete role·모델·자원 설정을 연결하고 실제 역할/도구 지원을 확인합니다.
Codex에서는 `repo_explorer`·`repo_researcher`·`repo_executor`·`repo_reviewer`와 TOML을 사용하는
[Codex delegation](../adapters/codex-delegation.md)을 따릅니다. 다른 host에 이 이름이나 effort를 강제하지 않습니다.
이름만 보고 global designer로 대체하거나 설정을 변경하지 않으며 role/task packet은 host 권한을 넓히지 않습니다.

## Direct path와 의존성

작은 padding 결함·이미 승인된 token 적용은 Parent가 직접 처리합니다. 새 스타일 탐색이 아니라면 alternative·Figma·QA swarm을
강제하지 않습니다. 큰 reimagine도 한 dependency chain이면 순차 작업이며 파일 수나 직군 이름만으로 병렬화하지 않습니다.

```text
Human Owner ↔ Parent (brief, alternatives, important decisions)
                ├─ direct small work
                └─ scoped designer task → authorized renderer → isolated critic
                                              ↑                    │
                                              └─ parent-selected revision
```

하나의 checkout에는 한 write owner만 둡니다. 보통 독립 조언 lane이 유용할 때만 최대 두 개를 선택하며 UX→UI→구현을
독립 병렬 task로 가장하지 않습니다. 초기 critic은 builder/peer와 대화하지 않고 먼저 판단합니다. 이후 짧은 사실 확인은
공통 Owner–Lead 계약의 Parent 지정·scope·snapshot·보고 조건을 따릅니다. Child의 sub-child 생성·업무 재위임·승인 대행은
허용하지 않습니다. 최대 두 advisory lane은 이 시각 작업의 공통 budget이지 host의 native 동시 호출 cap이 아닙니다.
Native specialist 호출이 자동 runtime Team 실행을 뜻하지 않으며 Codex/OMX Team/Conductor는 해당 adapter에서만 확인합니다.

## Task-fit skills

Skill은 VisualBrief의 보조 도구이며 mode·수정 권한·제품 사실·한국어/a11y·기존 표현/token owner를 덮어쓰지 않습니다.
한 작업의 주 skill은 하나가 기본이고, 작은 maintain·비시각 작업에는 미호출이 정상입니다.

`design-taste-frontend`와 `redesign-existing-projects`는 **Codex 전용** 보조 도구입니다. Claude에 이식하거나 공통 workflow
필수 항목으로 요구하지 않습니다. 제3 host에도 이식이나 설치를 요구하지 않습니다. Claude의 시각 작업은 공통 VisualBrief·content·a11y·독립 review로 직접 수행합니다.
Codex에서도 두 skill은 별도 채택 대상이며 각각 발견·자격검증 후 필요한 작업에만 사용합니다.

| 작업                                                | 선택 / 제한                                                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Landing·portfolio·소개/전환형 public 화면           | Codex: `$design-taste-frontend`; Claude: 공통 계약 direct path. Dashboard·data table·multi-step product UI·Native를 소유하지 않음 |
| 기존 Auth/Main/support의 audit·targeted improvement | Codex: `$redesign-existing-projects`; Claude: 공통 계약 direct path. 기존 stack을 존중하되 승인 범위를 유지함                     |
| 복잡한 제품 flow·전면 IA 개편                       | VisualBrief + domain/state/IA + 실제 render/critique가 owner. 필요한 skill 항목만 보조 사용                                       |
| 작은 padding 수리·이미 승인된 token 적용            | direct path, 두 skill 동시 호출·전면 탐색 불필요                                                                                  |

검토한 upstream은 [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill/tree/c184364c58658b2f131b4ae8bd3d206cabb3deee)의
`c184364c58658b2f131b4ae8bd3d206cabb3deee`입니다. 경로는 `skills/taste-skill`, `skills/redesign-skill`이며
frontmatter 이름은 위 호출 이름입니다. 각 subtree의 필수 파일은 `SKILL.md` 하나이고, taste의 blocks는 향후 추가할 schema입니다.
업데이트 시 floating main을 설치하지 말고 새 SHA의 전체 required resources·명령/side effect·충돌을 다시 검토합니다.

### Installation and qualification boundary

아래 `skill-installer`, `${CODEX_HOME:-~/.codex}/skills` 및 `$...` 호출 예시는 **Codex 설치·발견 경로**입니다.
Claude Code에는 두 skill을 복사·설치·자격검증하지 않습니다. 아래 설치·호출 절차는 Codex에 한정합니다.

1. 현재 host의 installer/discovery 경로·동명 skill·수정 권한을 확인합니다. 설치 요청은 제품 package/font/global config
   변경 승인이 아닙니다. 설치할 두 directory와 network/tmp side effect만 고정하고 기존 설치는 덮어쓰지 않습니다.
2. 설치된 공식 `skill-installer`를 사용합니다. 그 helper의 기본 목적지는 `${CODEX_HOME:-~/.codex}/skills`이고,
   [현재 discovery 문서](https://learn.chatgpt.com/docs/build-skills)는 `~/.agents/skills`도 설명합니다. host 차이를 숨기지 말고
   현재 지원되는 **한 경로만** 선택합니다. 중복 설치·symlink·전역 설정 변경으로 미노출을 우회하지 않습니다.
3. helper에 `--repo Leonxlnx/taste-skill --ref <검토한-SHA> --path skills/taste-skill skills/redesign-skill --dest <확인한-root> --method download`를
   전달합니다. `--path`는 한 번만 사용합니다. 임의 설치 command를 skill prose에서 복사 실행하지 않습니다.
   두 경로 설치 중 실패하면 이번에 생성한 exact directory만 복구하며 기존 skill·공유 cache는 삭제하지 않습니다.
4. root [MIT LICENSE](https://github.com/Leonxlnx/taste-skill/blob/c184364c58658b2f131b4ae8bd3d206cabb3deee/LICENSE)의
   copyright/permission notice를 각 복사본에 보존합니다. helper가 subtree만 복사하므로 LICENSE가 자동 포함됐다고 가정하지 않습니다.
   source SHA·path·raw hash·destination과 실제 설치 결과를 기록합니다.
5. 상태를 `source-reviewed` → `installed-unqualified` → `native-qualified`로 구분합니다. 설치 exit0·파일 읽기는 native 적용 증거가
   아닙니다. 현재 host catalog 또는 제공되는 runtime inventory에서 두 이름을 확인한 뒤 각각 scoped read-only 호출로
   identity·허용 output·금지 부작용을 확인합니다. 명시 호출 예: `$design-taste-frontend: 이 Landing brief의 방향만 분석; 파일/설치 금지`,
   `$redesign-existing-projects: 이 form의 문제만 분석; 수정/외부 호출 금지`.
6. 같은 turn에 catalog 갱신 경로가 없으면 다음 turn의 지원되는 discovery를 확인합니다. 미노출이면 installed-unqualified와
   정확한 gap을 남기고 direct fallback합니다. 별도 app-server/session 실행·강제 재시작·모델 변경으로 호출 증거를 만들지 않습니다.
   실제 호출 전에는 qualification을 완료로 보고하지 않습니다.

Skill의 npm/npx·motion/icon·외부 image/CDN·Latin font/word-count 지시는 새 권한이 아닙니다. 현재 pnpm/stack,
[명시적 experiment 범위](./visual-brief.md#bounded-dependency-and-font-experiments),
[copy 사실/승인](./reference-content-contract.md), 한국어 glyph·fallback·접근성이 우선합니다.
강한 aesthetic defaults도 contextual 후보일 뿐 전역 금지/의무가 아니며, 가짜 후기·수치·API 성공을 만들어 적용하지 않습니다.

Native read-only smoke는 실제 UI 품질 검증과 별개입니다. 별도 승인된 synthetic/render 작업은 기존
[device 검증](./device-presentation-and-verification.md)·[token/theme](./web-semantic-token-contract.md)·
[독립 critique](./design-review-and-acceptance.md)를 소비합니다. mock/state 검증을 production API·실기기·RN 검증으로 세지 않습니다.

## Brief가 고정되면 실행할 designer task

공통 child contract에 [VisualBrief](./visual-brief.md)와 [content/reference map](./reference-content-contract.md)을 연결합니다.
새 TaskEnvelope나 영속 상태 schema는 만들지 않습니다. 필요한 시각 작업 입력은 다음과 같습니다.

- 목표·mode·surface/audience/job, latest requirements와 정확한 source/revision
- 보존할 content ID/value/state/action과 조건부 노출, reference의 허용 aspect
- 구체적인 읽기/쓰기·도구/출력 경로와 stub, 금지된 제품·provider 부작용
- 산출물: 짧은 intent/hierarchy/type·density/composition/responsive 선택, self-check, 허용된 실제 후보
- 관련 acceptance, 현재 도구의 검증 한계, 완료/보고/중단 조건

초기 request가 analyze-only라면 render나 prototype 파일을 만들지 않습니다. 명시적으로 허용된 로컬 prototype은 격리된
출력 디렉터리에 두며 product branch 파일로 자동 승격하지 않습니다. 추가 asset/font/dependency는
[명시적 experiment 범위](./visual-brief.md#bounded-dependency-and-font-experiments)와 license·성능을 확인하며
임의로 설치하지 않습니다. Synthetic content만으로 실제 긴 문구를 다룰 수 있다고 보고하지 않습니다.

재구성 예: 공개 문서의 내용·actions를 보존하고 layout은 탐색하도록 승인했다면 designer는 같은 콘텐츠로 읽기/탐색의
다른 구성을 제시합니다. 정해지지 않은 간격·type scale은 임시 선택으로 설명하고, 각 CSS 값의 승인을 요청하지 않습니다.
법적 문구를 줄여도 되는지는 미적 불확실성이 아니므로 보존하거나 Owner에게 그 변경만 확인합니다.

New Backoffice 예: User Web의 tokens나 shell을 전제로 주지 않고 운영자의 실제 업무·데이터·권한과 명시한 상속 범위를
제공합니다. 운영자 화면에 조밀한 목록이 적합한지는 가설이지 의무가 아닙니다. 새 정보나 지표를 만들지 않고 후보로 비교합니다.

## 독립 비평과 Parent 통합

Critic은 같은 revision의 frozen brief/content/constraints와 실제 render·관찰 가능한 action을 봅니다. Writer의 긴
자기 정당화, 원하는 점수, 예상 정답, "Owner가 좋아함"은 초기 판단 입력이 아닙니다. 같은 모델의 격리된 context도 상관된
오류를 없애지는 않습니다. 알려진 실패·제약을 숨기지 않으며, 이후 필요한 rationale/사실 대조는 공통 QA 순서로 진행합니다.

구체적 finding과 수정 루프는 [Review and acceptance](./design-review-and-acceptance.md)를 사용합니다. Parent가
adopt/reject/defer, 허용된 patch, 재렌더링·delta review와 keep/revert를 통합합니다. 소스·brief·candidate가 바뀌면 해당
판정도 새 snapshot에서 재확인합니다. Reviewer의 read-only 권한으로 browser/cache를 조용히 만들지 않습니다.

Owner에게는 후보별 이미지와 의도·핵심 차이·검증 결과·남은 tradeoff를 보여주고 select/revise/reject를 쉽게 요청합니다.
기술적으로 명확한 작업은 Parent가 계속하고, 제품·비용·위험·합의 방향을 바꾸는 선택만 사람에게 돌려줍니다.
실제 사람의 preference가 없으면 not-collected이며, 하네스/제안 완료와 production 디자인 승인을 구분합니다.

## Evidence와 기능의 한계

정적 fixture는 형식·discovery·권한 계약을 검사하지만 실제 Agent 준수나 시각적 완성도를 증명하지 않습니다. 그런 주장이
필요하면 허용된 fresh task에서 실제 산출물·렌더링·독립 비평·수정 결과를 확인합니다. Self-authored 모의 답변을 fresh Agent
결과로 쓰지 않습니다. Tool/권한이 없으면 필요한 항목은 BLOCKED로 보고하고 안전한 독립 작업만 계속합니다.

로컬 검증 산출물은 `artifacts/local/`, repository script는 `resolveArtifactPath()`를 사용합니다. 승인된 장기 결정만 기존
정책/component/token owner로 승격합니다. Raw prompt·private provider payload·로컬 transcript를 durable 규칙으로 복제하거나
특정 모델의 디자인 우월성·미관측 생산성 향상을 주장하지 않습니다.
