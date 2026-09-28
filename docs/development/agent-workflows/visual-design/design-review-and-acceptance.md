# Visual review and acceptance

이 문서는 **관찰한 화면을 함께 다듬는 방법**과 디자인 완료 주장의 경계를 소유합니다. 공통 독립 검토, snapshot,
reviewer/runner 권한과 결과 양식은 [QA](../qa.md)를 재사용합니다. Reviewer의 판정은 사람의 취향 승인이 아닙니다.

## 근거와 적용 결정

공식 지침·사례에서 가져온 절차와 이 저장소에서 선택한 운영 방식을 구분합니다. 아래 확인 기준일은 **2026-09-10**입니다.

| 근거                                                                                                                                                                                            | 확인된 내용과 한계                                                                                                                                      | 저장소 적용 판단                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Anthropic frontend-design 고정 revision](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md)                                   | 맥락에 맞는 구체적 디자인 계획, 자체 점검과 렌더링 기반 비평을 제시합니다. 제품의 승인된 스타일을 대신 결정하지 않습니다.                               | 기존 VisualBrief에 짧은 craft sketch를 추가합니다. 스킬 설치나 원문의 스타일 기본값 복제는 요구하지 않습니다. |
| [Anthropic harness 실험](https://www.anthropic.com/engineering/harness-design-long-running-apps)                                                                                                | 생성·평가 분리와 브라우저 피드백을 실험했습니다. 주관적 채점은 관대해질 수 있고, 평가 문구가 스타일을 편향시키거나 마지막 결과가 덜 선호될 수 있습니다. | 근거가 있는 비평과 keep/revert를 사용합니다. 긴 반복 횟수, 미적 점수, 개선 보장은 가져오지 않습니다.          |
| [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots) · [screenshot assertion](https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1) | 안정화한 화면도 환경에 따라 달라질 수 있습니다. 픽셀 비교는 아름다움이나 상호작용의 정답이 아닙니다.                                                    | 동일 조건의 전후 캡처와 별도 동작 검증을 사용합니다.                                                          |
| [토스 휴리봇 사례](https://toss.tech/article/research-platform-ai) (2024-12-02)                                                                                                                 | AI 사용성 점검과 실제 사용자 검증을 구분하며 반영 판단은 디자이너에게 둡니다.                                                                           | Agent의 사용성 의견은 가설로, 사용자 관찰과 Owner 판단은 별도로 기록합니다.                                   |
| [SEED Skill](https://seed-design.io/ai-integration/skill)                                                                                                                                       | 디자인 지식·구현·진단을 나누고 공식 원문으로 안내합니다. 이 저장소의 도입 성과를 의미하지 않습니다.                                                     | 작은 진입점과 owner 링크를 재사용합니다. SEED 설치·디자인 상속·복제 schema는 추가하지 않습니다.               |

모델 안내·일반 코딩 benchmark만으로 GPT/Claude의 디자인 순위를 정하지 않습니다. 기업의 AI 작성 코드 비율도
디자이너 대체율·사용성·디자인 승인 비율이 아닙니다. 제품 디자이너의 사례, 디자인 시스템 도구, HCI나 GenAI 평가 사례는
참고 관점일 뿐 이 제품의 미감이나 성과를 증명하지 않습니다. 계정·도구의 현재 접근은 [Figma evidence](./figma-mcp-evidence.md)가
별도로 확인합니다. 유용한 절차만 채택하고, 검증하지 않은 수치·모델 성격·회사 내부 사정은 결과에 포함하지 않습니다.

이 하네스가 가설로 두는 이익은 **구체적인 선택과 실제 피드백으로 디자인 논의를 개선하는 것**입니다. 문서와 정적 검사만으로
시각적 완성도·시간 절약·사용자 성공률이 좋아졌다고 말하지 않습니다. 작업별 관측과 남은 gap은 [Lifecycle](../development-lifecycle.md)의
verification/value validation 구분을 따릅니다.

## 두 종류의 acceptance

**Exploration:** 같은 콘텐츠·상태·viewport에서 실제 렌더링한 대안, 의미 있는 차이와 tradeoff, Owner에게 줄
선택/수정/기각 packet을 확인합니다. 기본 두 후보이며 다른 가설이 유용할 때만 세 번째를 만듭니다. IA 검토에는 wireframe이
가능하지만 미감 비교에는 스타일이 적용된 화면이 필요합니다. 단순 색상 교체를 구조적 대안으로 포장하지 않습니다.

**Approved implementation:** 승인된 후보 revision과 intent를 기준으로 내용·동작 보존, 해당 접근성 요구, viewport별
fidelity와 코드 검증을 확인합니다. 동일한 픽셀을 모든 기기·콘텐츠에서 강제하지 않습니다. 실제 컴포넌트를 바꿨다면
production surface와 Storybook의 상태 정합성도 검증합니다. 정적 HTML prototype은 production parity의 증거가 아닙니다.

표현 분리·공통 행동·점진 적용은 [표현 책임·device 검증](./device-presentation-and-verification.md)을 기준으로 검토합니다.
프로젝트 이름 대신 실제 viewport/input/state/action과 양쪽 성공 캡처·gap을 확인합니다. 문서-only 채택·읽기 전용 사례
검토를 실제 화면 전환이나 browser/RN 검증 완료로 승격하지 않습니다.

| 판정                         | 필요한 근거                                           | 대체할 수 없는 것                                         |
| ---------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| functional/a11y verification | 내용·상태·action, keyboard/focus/reflow와 해당 테스트 | 예쁜 screenshot이 필수 검사를 면제하지 않음               |
| reference fidelity           | 승인된 reference aspect와 동일 조건의 실제 비교       | reference가 없으면 not-applicable; 추측으로 PASS하지 않음 |
| usability evidence           | 실제 사용자·과제 관찰; 없으면 가설과 unvalidated 표시 | 합성 persona나 Agent 의견은 사용자 연구가 아님            |
| owner visual preference      | 사람이 선택/수정/기각한 대상 revision과 범위          | Agent 점수·침묵·기술 QA PASS는 승인 아님                  |

각 작업은 어느 판정이 완료에 필요한지 먼저 밝힙니다. 하네스/제안 전달 작업은 preference가 `pending/not-collected`여도
정의된 범위에서 끝낼 수 있지만, 이를 production 디자인 승인으로 표현하지 않습니다. 필수 기능·권한 위반은 취향 차이로
완화하지 않습니다. 접근성 문제와 Owner 선호가 충돌하면 그 방향을 살린 접근 가능한 대안을 제시합니다.

## Assertion transition before UI changes

승인된 개편에서도 테스트의 미감과 보호 의미를 구분합니다. 기존 class 때문에 새 방향을 축소하거나 파일 전체를 삭제하지 않습니다.

1. 영향 surface의 instruction·token·class/text/DOM assertion·snapshot을 조사합니다. 전 화면 inventory는 불필요합니다.
2. `assertion → 보호 intent → authority/source → preserve/replace/retire → replacement evidence`를 매핑합니다.
3. 현재 semantic regression baseline을 확보하고 **대체 회귀를 먼저 정의한 뒤** 충돌하는 미감 guard의 교체를 설계합니다.
   실제 UI branch에서 필요한 test 전환과 구현을 RED→GREEN으로 진행합니다. 기존 PASS를 인위적인 결함으로 세지 않습니다.
4. 개인정보·상태·action·정책·a11y 보호는 유지하고, 새 palette/layout/copy는 승인된 revision으로 검증합니다.
   blanket snapshot 갱신·미감 테스트 전부 삭제는 대체 검증이 아닙니다.

예: header의 blur 부재 assertion은 개편 시 교체할 수 있지만 home link 의미는 보존합니다. Login의 grid/spacing은
reflow·reset action·고지 노출을 보호할 수 있으므로 cosmetic이라고 일괄 제거하지 않습니다. Roommate 카드의 색은
바꿔도 private detail/token 비노출 회귀는 유지합니다. Hero 문구/heading 순서는 [copy 권한](./reference-content-contract.md)을
분류하고, 학교 이메일 lookalike 거절은 미감과 무관한 eligibility/security 불변 조건으로 남깁니다.

실제 변경은 [표현·device packet](./device-presentation-and-verification.md)과
[token/theme 계약](./web-semantic-token-contract.md)을 소비하고 production/fixture의 해당 state를 대조합니다.
이 절차 채택 자체는 제품 테스트 삭제나 현재 화면 baseline 전환 완료가 아닙니다.

## Anti-slop은 맥락 비평이지 CSS 금지 목록이 아님

AI-slop은 작성자를 탐지하는 지표가 아니라 **이 brief를 검토하지 않고 반복한 template 선택**으로 다룹니다.
Glass, gradient, bento, 큰 radius, serif, minimalism, 강한 색이나 motion은 일괄 금지·권장이 아닙니다.

- 제목·본문·메타데이터의 강조 순서가 사용자의 일과 맞는가?
- 긴 한국어 문장과 표가 읽히는가? 반복 카드·badge·번호에 실제 정보상의 이유가 있는가?
- 간격·밀도·색·효과가 탐색과 읽기를 돕는가, 내용 누락을 가리는가?
- 실제 없는 성공 지표·후기·광고 문구·불필요한 hero가 target 정보를 대신하지 않는가?

**허용 예시:** Owner가 투명한 도구 영역을 선택했다면 배경 대비, focus와 읽기, reduced motion/성능을 확인하면서 그 효과를
유지할 수 있습니다. **기각 예시:** 조항을 빨리 찾아야 하는 문서에 근거 없는 후기·숫자와 동일한 카드 hero를 얹고
필수 표를 접어 숨겼다면, generic함의 문제가 아니라 정보·목표 위반부터 고칩니다. 이것은 모든 hero나 접힘 UI의 금지가 아닙니다.

## Located critique와 disposition

[VisualAuditFinding](./visual-brief.md#visualauditfinding)을 사용합니다. Hard finding을 먼저 보고하고, 별도로 시각적 위계,
타이포·한국어 줄바꿈, 구성·간격·밀도에서 영향이 큰 **최대 1–3개**를 우선합니다. 고정 개수의 결함이나 점수를 만들지 않습니다.
관찰, 사용성 가설, 취향을 구분하고 근거가 없으면 `not-observed` 또는 설명 있는 `no-change`로 둡니다.

아래는 **작성 형식 예시이며 실제 실행/승인 결과가 아닙니다.**

```text
candidate B / revision r1 / 390×844 / available-fallback
evidence: B-r1-390.png, upper metadata region (x:20–370, y:220–390)
observation: metadata labels occupy three equal blocks; body and labels have equal emphasis
hypothesis: readers seeking a clause may scan metadata before locating the section navigation
suggested repair: reduce metadata emphasis and regroup it, preserving every visible label/value
confidence: medium; owner's taste and real task-success improvement are unmeasured
parent disposition: adopt grouping trial; reject removing dates (exact-copy invariant); defer new font (separate asset decision)
delta: same content/state/viewport; r2 screenshot + content/focus checks compared with r1
keep/revert: record observed reason; revert if scan hierarchy is not helped or a hard check regresses
owner preference: not-collected, not implied by this example
```

「깔끔하다」「AI 같다」만으로는 수정할 위치·영향을 알 수 없습니다. Parent는 채택/기각/보류와 이유를 짧게 남겨 이미
기각한 취향 제안이 반복되지 않도록 합니다. CSS 값마다 승인을 요청하는 대신 승인 범위의 수정안을 실행하되, 제품·비용·위험이나
합의한 방향 변경은 [Owner–Lead](../owner-lead-collaboration.md)의 협의 경계를 사용합니다.

## 실제 수정 루프

`render → isolated critique → adopt/reject/defer → authorized patch → recapture → keep/revert`를 사용합니다.
[공통 maker-checker](../orchestration.md#pattern-selector)를 따라 기본 최대 두 번의 critique→revision cycle로 제한합니다.
의견이 안 모이면 결과와 정확한 질문을 돌려주며, 새 방향은 brief를 다시 여는 별도 판단입니다. 마지막 revision이 항상
더 좋다고 가정하지 않고, 동일/악화 또는 이전 후보 유지도 관찰 결과로 남깁니다.

- content/map hash, candidate revision, viewport/scale, locale와 브라우저 버전을 고정합니다.
- 사용 가능한 font/asset, font 로드 완료, 색상·reduced-motion, 애니메이션·동적 데이터 처리 조건을 기록합니다.
- 전후 중요 영역과 전체 구성을 함께 보존합니다. 필수 콘텐츠를 가리거나 masking해서 비교를 통과시키지 않습니다.
- screenshot 안정화는 별도 interaction/keyboard 검증을 대체하지 않습니다. 실제 이미지를 보지 못하면 시각 판정은 BLOCKED입니다.
- Renderer는 허용된 환경·출력 경로만 쓰고, reviewer는 공통 QA의 read-only/runner 구분을 따릅니다.

일반 작업은 근거 있는 no-change로 끝날 수 있습니다. **수정 하네스 자체를 검증한다고 할 때는** 실제 patch·recapture·독립
delta 검토가 있어야 하며 절차를 써놓는 것만으로 통과시키지 않습니다. 본 후보에 수정 근거가 없으면 명시된 보조 composition
challenge를 격리된 로컬 출력에서 사용할 수 있습니다. Production을 일부러 망가뜨리거나 정답을 reviewer에게 주지 않습니다.
이는 피드백 처리 능력의 검증이지 강제로 얻은 디자인 개선 점수가 아닙니다.

## Provider-free 관측 사례 — 2026-09-10

`9c7522e2` 기준 tracked 진입점에서 시작한 fresh native task로 공개 개인정보 처리방침을 재구성했습니다.
이는 **가이드 발견 → 대안 생성 → 실제 렌더 → 독립 비평 → 제한된 수정**이 동작한 한 사례이며,
모든 새 세션의 동일 판단·디자인 품질 향상·시간 절약을 증명하는 benchmark는 아닙니다.

| 검증 질문                           | 관측한 결과                                                                                                                                                   | 다시 확인할 owner / 한계                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 정보와 표현을 분리했는가?           | 같은 공개 문서의 81개 텍스트 항목·표 3개·조항 anchor 11개를 두 후보에 보존. 원문을 숨기거나 축약하지 않음                                                     | [공개 본문](../../../../apps/web/src/legal/content/legal-fallback-documents.ts), [표시 문구](../../../../apps/web/src/legal/content/legal-copy.ts), [mapper](../../../../apps/web/src/legal/api/legal-document.mapper.ts)                                                                                                     |
| 실제 대안인가?                      | A는 명조 읽기 열·좌측 상시 목차, B는 고딕·상단 다열 목차·조항명/본문 분리와 국소 glass. 독립 reviewer가 실제 화면의 구성 차이를 확인                          | 전역 스타일 추천·제품 적용 승인이 아닌 별도 로컬 HTML 두 후보                                                                                                                                                                                                                                                                 |
| 동작을 함께 확인했는가?             | API/fallback/unavailable 표시, copy 결과 두 상태, print/back/home intent, 기본 Tab 5회·outline과 첫 목차 Enter/heading focus, 320px 문서 가로 overflow를 확인 | [현재 actions](../../../../apps/web/src/legal/components/LegalDocumentActions.tsx), [back](../../../../apps/web/src/legal/components/LegalDocumentBackButton.tsx), [unavailable](../../../../apps/web/src/legal/components/LegalDocumentUnavailable.tsx). API·클립보드·인쇄·history는 선언한 stub이며 실제 부작용 검증이 아님 |
| 비평이 실제 수정으로 연결되는가?    | 모바일 표·요약의 한글 단어 분절을 찾아 줄바꿈 CSS만 수정하고 동일 조건으로 재캡처. 문구·폰트 크기·배치는 유지                                                 | 모바일 셀과 B 요약의 `word-break: keep-all`, 긴 토큰의 `overflow-wrap: anywhere` 유지. 독립 delta 검토 후 Parent가 r2를 keep; 원문·DOM·action 불변                                                                                                                                                                            |
| 모든 취향 제안을 채택했는가?        | 모바일 목차 상단 이동은 과제 근거 부족으로 보류. B glass는 관찰한 sticky 장면에서 글·버튼·대상 제목 가림이 없어 유지                                          | 효과 금지 목록이 아님. 전체 대비·합성 성능·다른 상태의 가림은 별도 검증                                                                                                                                                                                                                                                       |
| 모호한 일반 요청도 범위를 지켰는가? | fresh read-only task가 작은 CSS는 직접 권고, Backoffice는 독립 방향 제안, hostile reference·과거 스타일/승인 주장은 비권위 데이터로 처리                      | 7개 응답 probe는 한 fresh context에서 실행한 권고 관측. 실제 CSS 제품 수정·Backoffice 생성·Figma 호출을 의미하지 않음                                                                                                                                                                                                         |

수정 후 390px 표의 ‘기/록’, ‘자/기소개’와 요약의 ‘보관합니/다’ 같은 관측 단어 분절이 줄었습니다.
320px에서는 일부 셀의 여백·행 높이가 늘어 전체 높이가 A **7323→7371px**, B **6457→6506px**가 되었으나
가로 overflow·가림은 관측되지 않았습니다. 390/1280px의 전체 높이는 같고 desktop 주요 캡처는 전후 동일했습니다.
독립 검토와 Parent는 이 tradeoff를 받아들여 **r2 keep**으로 끝냈으며, 사용자 읽기 속도 향상이나 선호를 실측한 것은 아닙니다.
원문 문단 전체의 줄바꿈까지 확대하지 않았고, 추가 미적 반복을 완료 조건으로 만들지 않았습니다.

캡처 조건은 macOS의 설치된 system font, Playwright **1.63.0** / Chromium **153.0.8010.12**, ko-KR,
light·reduced motion·scale 1, viewport **390×900 / 1280×900**과 **320×900** 보조 검사입니다.
전체 본문과 핵심 영역을 캡처했고, 각 viewport의 연속 top 이미지 hash는 안정적이었습니다. 네트워크 요청은 차단했고
시도 0건, browser JS 오류 0건을 관측했습니다. 최초 sandbox의 macOS MachPort 권한 실패는 승인된 동일 로컬 명령으로
해소했으며 설치·계정·전역 설정·제품 코드를 바꾸지 않았습니다. Font 파일을 고정하거나 다른 OS의 동일 픽셀을 보장하지 않습니다.

정적 회귀 owner는 [시각 workflow contract test](../../../../scripts/ci/visual-design-workflow-contract.test.mjs)와
[입력/평가 분리 corpus](../../../../scripts/ci/fixtures/visual-capability-cases.json)입니다. **20개 corpus 전체의 live 실행은
아니며**, 정적 무결성 PASS를 Agent 행동·미감 PASS로 세지 않습니다. 실제 생성자·검토자는 별도 context로 시작했고
검토자는 작성자의 선호/점수를 받지 않은 채 화면부터 확인했습니다. 요청한 native role/effort는 기록했지만
숨겨진 effective-runtime attestation을 확보했다고 주장하지 않습니다.

원본 HTML·이미지·실행 로그는 로컬 관측 산출물이고, 이 문단은 다른 clone에서도 읽을 수 있는 범위·결과·한계 요약입니다.
Owner preference는 **not-collected**, 승인된 외부 reference fidelity는 **not-applicable**, 인간 usability는 **unvalidated**입니다.
전 조항 keyboard-only 탐색, screen reader, 전체 색상 대비·zoom·교차 브라우저, 실제 API/OS 동작, production/Storybook
parity와 장치 성능은 이 로컬 하네스 검증으로 대신하지 않습니다. 제품 적용 시에는 해당 화면의 새 brief·승인·검증이 필요합니다.

## Task-fit skill의 로컬 렌더 관측 — 2026-09-25

[Task-fit routing](./design-task-orchestration.md#task-fit-skills)을 사용한 **Codex 환경의 관측**입니다. Landing형 `reimagine`에는
`design-taste-frontend`, 기존 form형 `maintain`에는 `redesign-existing-projects`를 각각 적용했습니다.
각 baseline/candidate는 같은 한국어 문구·지원 자격·필수 고지·mock 행동을 가진 독립 HTML fixture입니다.
현재 production 화면의 복제나 채택된 새 디자인이 아니며, 폰트·package·API·DB·전역 설정은 변경하지 않았습니다.

- 기존 파란색/class는 Landing candidate의 제약으로 상속하지 않았습니다. 대신 CTA 이름·행동·고지와
  실제 text contrast·focus·touch target·reflow를 대체 검증으로 두었습니다. Form은 필드/action 구조를 유지했습니다.
- 두 task의 baseline/candidate를 각각 320·390·767·768·1280×900, 1024×768에서 렌더했고,
  form에는 390×560을 추가했습니다. 한 revision당 26개 context에서 실제 viewport와 PNG 크기를 대조했습니다.
  Mobile touch emulation/tap과 Desktop mouse, 순차 Tab을 사용했으며 프로젝트 이름만으로 device를 판정하지 않았습니다.
- Form의 idle/pending/error/명시적 mock success, pending 잠금·재시도·reset·resize 후 입력 보존,
  320px text-spacing override를 확인했습니다. 공유 mock script는 baseline/candidate에서 동일합니다.
- 독립 검토에서 Landing 제목의 한국어 단어 내부 줄바꿈을 관찰했습니다. `word-break: keep-all`과 긴 token의
  emergency wrapping만 한 차례 적용하고 동일 matrix를 재캡처했습니다. Form에는 근거 없는 추가 수정을 하지 않았습니다.
- Playwright 1.63.0 / Chromium 153.0.8010.12, macOS system font, ko-KR, light 환경·reduced motion·scale 1입니다.
  페이지 외부 요청은 차단했고 시도·JS 오류는 0건이었습니다. 각 초기 viewport 캡처는 연속 hash가 같았습니다.
  최초 sandbox의 MachPort 제한은 동일 로컬 renderer에 대한 host 승인으로 해소했습니다.

Source·brief hash, 원본 HTML, 캡처, runner, 독립 critique·keep/revert는
`artifacts/local/frontend-visual-skill-adoption/2026-09-25/vd3/`의 로컬 관측 evidence입니다.
다른 clone의 재현은 같은 [device packet](./device-presentation-and-verification.md#device-verification-packet)과
새 artifact를 사용하며, skill 갱신·미노출·설치 복구는 [기존 설치/qualification 계약](./design-task-orchestration.md#installation-and-qualification-boundary)을 따릅니다.

이는 유한한 synthetic workflow 검증입니다. Mock은 실제 인증·저장·자격 validation의 증거가 아니며,
production/Storybook parity, 실제 OS keyboard·safe area, screen reader, 전체 zoom·WCAG·교차 browser는 미검증입니다.
계산된 text contrast는 pseudo 배경 texture와 focus indicator 전체를 인증하지 않습니다. 사람의 선호·사용성 향상은
미측정이며, 선택한 후보의 제품 채택은 별도 surface brief·권한·실제 동작 검증이 필요합니다.
