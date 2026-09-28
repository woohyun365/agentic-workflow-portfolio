# Visual design workflow

이 디렉터리는 **내용·동작을 보존하면서 시각적 대안을 만들고 함께 다듬는 작업 계약**을 소유합니다. 사람은 목적과 중요한
디자인 방향을 선택하고, Parent Agent는 조사·대안·실행·통합을 책임집니다. 필요한 때만 specialist를 호출합니다.
Next.js/React/BFF, accessibility contract, component owner, performance와 test planning은
[Frontend plan authoring](../plan-authoring/frontend.md)이 계속 소유합니다.

## When to read

- 새 page/surface의 aesthetic direction을 제안할 때
- 기존 UI의 look-and-feel, hierarchy, typography, composition을 크게 바꿀 때
- Figma frame/component/variable을 구현 evidence로 사용할 때
- visual audit 결과와 repository rule이 충돌할 때

작은 CSS 오류, 이미 승인된 token 적용, backend-only 작업에는 이 workflow를 로드하지 않습니다.
작은 FE 작업의 shared/split/unchanged 판단은 [표현 책임·device 검증](./device-presentation-and-verification.md)을
직접 사용합니다. 이 계약 참조가 전체 시각 탐색·기존 화면 migration을 요구하는 것은 아닙니다.

## 책임과 도구

| Surface                  | Current owner                                | 책임                                                       |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------------- |
| product/policy semantics | `docs/policies/`, current contract/code      | 화면이 전달할 상태와 action 의미                           |
| FE architecture          | `plan-authoring/frontend.md`                 | React/Next.js/BFF/component/a11y/performance/test boundary |
| completion evidence      | [QA](../qa.md), 이 디렉터리의 review guide   | 공통 독립 검토와 시각 판정의 분리                          |
| visual iteration         | 허용된 로컬 render, Storybook, production UI | 실제 state/viewport와 수정 전후 비교                       |
| design discovery         | Parent 또는 현재 host의 허용된 구현 역할     | 구체적 대안과 짧은 자체 점검; 실제 역할·도구 권한 확인     |
| independent critique     | 격리된 검토 역할, 별도 허용된 runner         | 실제 이미지·동작의 비평; 사람의 승인 아님                  |
| Figma evidence           | 이 workflow                                  | authority, trigger, failure와 rollback                     |

현재 repository는 project-scoped Figma MCP를 추적하지 않습니다. User-level provider 연결은 repository dependency가
아니며 실제 승인된 Figma source가 있을 때만 선택적으로 사용합니다.

이 흐름은 문서와 현재 Agent 판단에 의한 **model-mediated** orchestration입니다. Hook 자동 로딩, 자동 spawn 또는
새 runtime engine이 아닙니다. 별도 디자인 스킬·Figma·추가 역할 설정이 없어도 허용된 로컬 작업은 가능합니다.
Concrete role·tool·permission은 [현재 host adapter](../adapters/README.md)가 연결하며 Codex의 TOML·role ID는 공통 전제가 아닙니다.
스킬을 명시적으로 호출하면 그 지침과 현재 권한을 확인하되 저장소 정책이나 사용자 소유 파일 보호를 우회하지 않습니다.

## 작업 mode와 허용 행동

| Mode          | 기본 시각적 상속                                        | 보존할 경계                       |
| ------------- | ------------------------------------------------------- | --------------------------------- |
| `maintain`    | 승인된 해당 surface의 관례 유지                         | 기존 정보·동작과 요청된 수정 범위 |
| `reimagine`   | 선언된 내용·동작을 유지하며 layout·시각 언어 재탐색     | 필수 문구·상태·action·접근성      |
| `new-surface` | 자기 audience/job에서 시작, 공유 항목은 명시적으로 선택 | 해당 surface의 정책·데이터·행동   |

Mode는 **권한과 별개**입니다. Analyze는 분석으로, Plan은 계획으로 끝나며, 로컬 prototype 권한은 production/Figma
수정 권한이 아닙니다. [VisualBrief](./visual-brief.md)에 실제 요청 결과와 허용된 출력/수정 경로를 따로 기록합니다.

Landing/Auth/Main/support 모두 승인된 reimagine에서 palette·font·layout·density·composition을 다시 선택할 수 있습니다.
Repo 미감을 의무로 삼지는 않지만 실제 지원 대상·가입 자격·privacy·서비스 사실을 바꾸는 권한도 생기지 않습니다.
[copy 분류](./reference-content-contract.md#copy-authority-classes),
[폰트·dependency 실험](./visual-brief.md#bounded-dependency-and-font-experiments),
[미감 assertion 전환](./design-review-and-acceptance.md#assertion-transition-before-ui-changes)을 해당 작업에만 적용합니다.
한국어 가독성·핵심 문구/CTA 위계·실제 상태/행동을 관찰하며 “AI-slop 0%”나 사용자 효과를 점수로 보장하지 않습니다.
[task-fit skill](./design-task-orchestration.md#task-fit-skills)은 보조 도구이며 미설치 시에도 기존 direct workflow를 사용합니다.

## Source hierarchy

1. latest user request: 목표·허용 범위·명시적으로 승인된 visual reference
2. product policy, domain contract와 user-visible semantics: 시각적 승인으로 변경할 수 없는 의미·안전 경계
3. 승인된 Figma/reference에서 실제 관찰한 부분: layout 근거이지 외부 문구·통계·행동의 수입 허가가 아님
4. current production UI, component/token과 Storybook state: 현재 동작/구현 근거이지 모든 surface의 미감 의무가 아님
5. tracked visual workflow와 해당 surface에 채택된 review rule
6. untracked/historical design note: 출처와 현재 유효성을 재확인할 참고 자료

Root 또는 local workspace의 untracked `DESIGN.md` 같은 design note는 **non-canonical**입니다. 사용자 소유 파일을 자동
수정·stage·삭제하지 않고, 그 안의 표현이나 과거 constraint를 보존 조건으로 사용하지 않습니다. 유효한 visual
decision은 current evidence와 사용자 승인 후 tracked guide, token 또는 component contract로 별도 승격합니다.

Binding constraint는 출처·결정 owner·적용 surface가 있어야 합니다. "이 프로젝트는 calm·campus-oriented여야 한다" 같은 과거
assistant의 문장은 정책이 아닙니다. 실제 사용자가 대학생이라는 사실만으로 palette·밀도를 추론하지 않습니다.
반대로 그 스타일을 근거 있는 후보로 선택하는 것도 금지하지 않습니다. 중립성은 무미건조한 결과가 아니라 숨은 상속을
없애고 각 후보의 의도를 설명하는 것입니다. Backoffice가 User Web의 shell/theme을 자동 상속하지 않습니다.

## Core decisions

- Visual suggestion은 BFF·API·product policy 변경 권한을 부여하지 않습니다.
- 제품 의미의 중요한 모호함은 확인하고, 허용된 미적 불확실성은 구체적인 임시 선택과 bounded 대안으로 좁힙니다.
- 사용자가 구현을 승인하기 전 ideation이나 Figma evidence를 production mutation 권한으로 해석하지 않습니다.
- Figma MCP는 context bridge이며 지원되는 외부 write 도구도 있습니다. Capability와 이번 작업의 승인은 별개입니다.
- Provider가 없어도 current code, Storybook, screenshot과 native review로 fail-open합니다.
- Product package와 lockfile에는 Figma 연결용 dependency를 임의로 추가하지 않습니다.

상세 계약:

- [VisualBrief](./visual-brief.md)
- [Web semantic token 계약](./web-semantic-token-contract.md): 역할·값·theme·override와 변경 surface만의 점진 적용; 작은 token 수리도 직접 참조
- [Desktop/Mobile 표현 책임과 검증](./device-presentation-and-verification.md): 공통 행동 비복제·점진 적용·device evidence
- [Reference/content contract](./reference-content-contract.md): 무엇을 보존하고 무엇만 참고할지
- [Design task orchestration](./design-task-orchestration.md): 직접 작업과 필요한 specialist의 산출물
- [Review and acceptance](./design-review-and-acceptance.md): 공식 근거, 비평·수정·유지/되돌리기, 네 종류 판정
- [Figma MCP evidence](./figma-mcp-evidence.md)

## Recommended flow

```text
request → mode + authority + content/reference evidence → VisualBrief
  → permitted proposal/prototype: concrete choices + self-check → rendered alternatives
  → isolated critique → authorized revision → comparable recapture → keep/revert
  → human select/revise/reject (required for production direction, not invented)
  → separately approved production implementation → applicable parity/a11y/code checks
```

## Non-goals

- visual skill이 product policy나 architecture를 결정하지 않습니다.
- screenshot similarity만으로 accessibility나 behavior correctness를 판정하지 않습니다.
- Figma account, token, OAuth receipt 또는 private file content를 repository에 저장하지 않습니다.
- 모든 요청에 ideation을 강제하거나 모델 순위·미적 점수·회사 직군 수로 하네스를 구성하지 않습니다.
