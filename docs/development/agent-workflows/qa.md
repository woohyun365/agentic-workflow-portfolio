# QA workflow

인수 기준·독립성·증거 packet은 host 공통입니다. Codex cohort의 필수 Astra QA는
[Codex adapter](./adapters/codex.md)와 [채택 결정](./agentic-architecture-decisions.md)이 소유하며,
Claude reviewer의 독립 검토로 그 requirement를 충족했다고 주장하지 않습니다. 반대로 Claude Code의 native
read-only 여부는 [Claude adapter](./adapters/claude-code.md)의 실제 permission/tool 관측이 필요합니다.

QA는 구현 역할이 아니라 완료 기준을 만들고, 변경의 안전성과 결과의 충족 여부를 검증하는 역할입니다.
사용자가 구현이나 테스트 보강까지 명시한 경우에만 제품 코드를 수정합니다.

공통 source priority, 사실·추론 구분과 handoff schema는 [Agent execution contract](./agent-execution-contract.md)를
따릅니다. 정책이 모호하거나 충돌하면 구현 결함과 구분해 정책 결정이 필요한 항목으로 보고합니다.

## Three verification questions

1. **Acceptance derivation**: 완료라고 판단하려면 무엇을 충족해야 하는가?
2. **Code review**: 이 변경을 머지해도 회귀·배선·계약 위험이 없는가?
3. **Acceptance verification**: 구현 결과가 정의한 조건을 실제로 만족하는가?

세 질문은 서로 대체하지 않습니다. 코드가 깔끔해도 요구사항을 만족하지 못할 수 있고, 테스트가 통과해도 잘못된
mock이나 assertion으로 false positive가 생길 수 있습니다.

## Review evidence

- finding은 심각도 순으로 문제 위치, 영향, 재현되는 사용자·시나리오를 적습니다.
- 테스트는 mock 정확성, false positive 가능성, 실제 계약을 보호하는 assertion인지 확인합니다.
- finding이 없으면 잔여 위험과 검증하지 못한 범위를 명시합니다.

## Independent review disposition

기존 [계획 readiness review](./plan-authoring/README.md#implementation-readiness-review)는 구현 전의 검토입니다.
변경 후 acceptance 검증은 별도로 판단합니다. 다음과 같은 **의미 있는 변경/근거**가 있으면 merge 전에 독립 검토의
결과와 남은 gap을 기록합니다.

- trust/authorization 경계, transaction/concurrency 불변 조건, schema/data migration
- 여러 surface의 public contract 또는 CI/security gate
- 테스트와 구현이 같은 잘못된 가정을 공유할 수 있다는 구체적 evidence

단순 경로명, diff 크기, commit 수, AI 사용 여부만으로 추가 reviewer를 요구하지 않습니다. 오탈자·포맷 변경이나 위 신호
없이 이미 검증 가능한 bounded 변경은 direct path로 targeted checks를 실행하고 `not-needed: 이유`를 남길 수 있습니다.
QA 절차 자체의 누락이 검증을 잘못 PASS시키는 변경은 단순 Markdown 오탈자가 아니므로 의미를 검토합니다.

| 검증 방식                | 증거와 한계                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Self-review              | 구현 맥락을 가진 agent의 재검토; 역할 이름만 바꿔도 독립 검토는 아님                              |
| Context-isolated review  | 대화 이력을 상속하지 않는 새 reviewer context 또는 동등한 fresh-session handoff; 같은 모델도 가능 |
| Deterministic checks     | 실제 실행한 test/typecheck/CI 결과; reviewer의 문장으로 대체할 수 없음                            |
| Human / release approval | 해당 권한을 가진 owner의 결정; QA PASS가 대신하지 않음                                            |

독립성은 context 분리이지 정답 보장이 아닙니다. 실제 지원되는 launch 방식과 전달 입력을 기록하고, 숨겨진 runtime
attestation을 추측하지 않습니다. 현재 host adapter가 지원하는 fresh-context 경로를 사용하되 prompt에
builder transcript를 다시 붙이지 않습니다. **Codex native 예시로만**, 지원되는 surface의 `fork_turns: none`을 사용할 수 있습니다.
다른 host에 그 인자를 강제하지 않습니다. 필요한 독립 surface가 없으면 안전한 로컬 검증은 계속하고 `BLOCKED`/review gap을
남깁니다. 다른 독립 검토를 확보하기 전에는 merge-ready로 표현하지 않습니다. Model-mediated 절차는 권한 강제 장치가 아닙니다.

## Reviewer와 runner의 책임

새 역할 설정을 일괄 설치하지 않고 [현재 orchestration 역할](./orchestration.md)을 재사용합니다.
공통 책임을 현재 host의 실제 역할·tool permission에 연결하며, Codex의 TOML이나 role ID를 다른 host의 전제로 삼지 않습니다.

| 책임                                               | 수행 주체                                          | 제한                                                                     |
| -------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| acceptance·negative case 도출, diff review         | context-isolated 독립 검토자                       | current requirement/source를 읽고 findings·snapshot·gap 반환; read-only  |
| test 작성·실행, cache/build/DB/browser 산출물 생성 | 권한 있는 parent 또는 별도 범위의 구현·검증 runner | 명시된 runner/write owner, 허용된 환경·출력 경로만 사용                  |
| 결과 통합·의견 차이 해결                           | parent                                             | current evidence와 scope로 판단; human/release authority를 대신하지 않음 |

Read-only 검토가 모든 test 실행을 허용하는 것은 아닙니다. cache, service, fixture DB나 screenshot을 만드는 명령은
side effect를 확인한 authorized runner에게 넘깁니다. Reviewer는 재현·테스트를 제안할 수 있지만 구현 checkout을 조용히
수정하지 않습니다. 회귀 테스트 추가가 필요하면 write ownership을 별도로 정하고 같은 파일에 두 writer를 두지 않습니다.
Role 파일/이름은 tool permission을 넓히지 않습니다. Codex에서 `repo_reviewer`/`repo_executor`를 사용하는 mapping은
[Codex delegation](./adapters/codex-delegation.md)을 확인하고, 다른 host는 [해당 adapter](./adapters/README.md)를 따릅니다.

## Portable QA packet

아래가 공통 QA 입력/결과의 단일 owner입니다. 실행 계약·plan·PR은 이곳을 참조하며 양식을 복제하지 않습니다.
필요한 포인터와 범위를 제공하되 raw transcript, secret, 불필요한 ignored memory는 넘기지 않습니다.
Codex↔Claude checker handoff의 방향·transport·finding 판정 경계는
[Cross-model handoff](./adapters/cross-model-handoff.md)가 이 packet을 재사용해 설명합니다.

같은 host의 context-isolated reviewer도 `same-host-independent-review` 방향으로 이 packet을 그대로 사용합니다. Host가
같다는 이유로 reviewer/builder 분리, fresh context, current snapshot, read-only scope와 acceptance coverage를 줄이지
않습니다. Reviewer의 `complete + FAIL`은 검토 작업이 정상 종료되어 finding을 반환했다는 뜻이지 builder 결과의 PASS가
아닙니다. `partial`·`denied`·`timed-out`·`cancelled` 또는 `BLOCKED`는 완료된 독립 QA로 승격하지 않습니다. Parent가
현재 source에서 finding을 재현·판정하고 builder 완료 여부를 결정합니다. Reviewer task 자체에 다시 독립 reviewer를
요구해 재귀시키지 않으며, 이 예외는 builder의 필수 QA를 생략하는 경로가 아닙니다.

```text
Input
  outcome / nonScope
  requirementSources[] / policy-publicContractSources[] / relevantOwners[]
  snapshot: baseSHA / headSHA / dirtyDiffDigest(if any) / untrackedInputDigests(if any)
  allowedReadPaths[] / doNotTouch[]
  environment / prerequisites / commands / runnerOwner
  permittedReadsAndTests / forbiddenMutations / permittedOutputPaths
  knownGaps / sanitizedEvidenceLinks[]

Result
  reviewedSnapshot / contextIsolationMethod
  acceptanceCoverage[]: criterion -> evidence or gap
  findings[]: severity / path:line / impact / reproduction / evidence
  commandsActuallyRun[]: runner / exit / observedResult / environment
  notRun[] / knownGaps[] / confidence
  verdict: PASS | FAIL | BLOCKED (scope and reason)
  nextAction / integrationOwner
```

1. 요구사항·현재 policy/public contract와 전체 in-scope source/diff를 먼저 제공해 reviewer가 acceptance를 도출하게 합니다.
   구현자의 solution rationale이나 self-PASS를 정답으로 주지 않습니다. 필요하면 요구사항을 재조사하고 policy OQ를 분리합니다.
2. 그 다음 실제 테스트 결과·known findings와 비교합니다. 중요한 실패·제약을 숨기지 않으며, 초기 verdict를 맞추도록 유도하지
   않습니다. Synthetic 평가의 예상 답은 reviewer packet 밖에 두지만 실제 변경의 알려진 결함을 은폐하는 방법으로 쓰지 않습니다.
3. SHA는 checkout과 실제 비교합니다. Dirty 변경이 있으면 base/head뿐 아니라 scoped diff, untracked 입력과 관련 guide/requirement의
   digest도 묶습니다. 같은 HEAD여도 파일이 변하면 같은 snapshot이 아닙니다. Digest는 내용 식별이지 runtime 권한 증명은 아닙니다.
4. Parent는 결과를 재현 가능한 증거와 대조합니다. Reviewer가 실행했다고 말한 것만으로 test PASS를 기록하지 않습니다.
   허용된 reader가 결과를 확인할 수 있도록 필요한 command/output 포인터를 제공하고, 실행하지 않은 검증은 그대로 남깁니다.

최종 fan-in은 **criterion → source/test → gap** 순서로 대조합니다. Child completed, self-PASS, 한 테스트 성공이나
테스트 개수는 전체 acceptance coverage가 아닙니다. 각 required criterion에 현재 snapshot의 근거가 있어야 하며, 중요한
누락·상충 finding·필수 미실행 검증은 gap으로 남겨 완료를 막습니다. 단순 구조/문구 검사로 semantic evidence의 진실성을
보장하지 않습니다. Future 관측처럼 현재 acceptance 밖인 항목은 분리해 handoff하고, 작은 direct 작업에 무조건 독립 child를
추가하지 않습니다. 재조회/재현과 불필요한 primary 중복의 구분은 [orchestration](./orchestration.md#primary-작업과-증거-재사용)을
따르며 필수 reviewer를 Parent self-review로 대체하지 않습니다.

Source/contract 또는 acceptance에 영향을 주는 요구사항·guide가 바뀌면 이전 리뷰는 해당 snapshot의 historical evidence입니다.
바뀐 가정과 영향 범위에 대해 delta re-review와 관련 regression을 수행한 후 새 snapshot을 기록합니다. 무관한 metadata 수정으로
전체 suite를 자동 재실행하지 않지만, 기존 PASS를 새 코드의 PASS로 옮기지 않습니다.

의견이 다르면 parent가 현재 정책·source·재현 결과로 adjudication을 남깁니다. 해결되지 않은 중요한 정책 결정은 owner OQ,
필수 검증 부재는 BLOCKED, 재현된 결함은 FAIL입니다. 같은 rubric의 maker-checker 재검토는
[기존 bounded 반복 기준](./orchestration.md#pattern-selector)을 따르고, 해결되지 않으면 무한 reviewer/retry 대신 gap을 보고합니다.

임시 packet/result는 `artifacts/local/`에 두고 script는 `resolveArtifactPath()`를 사용합니다. 다른 clone에 필요한 최종 근거는
PR/test/CI와 기존 Issue/owner docs로 연결합니다. 제품 디자인의 취향·reference fidelity 판정은 이 공통 양식에 필요한 별도
입력을 더하는 것이며, 기술 QA PASS가 사람의 시각적 방향 승인을 의미하지 않습니다.

## Verification strategy

위험과 변경 범위에 맞는 가장 작은 검증부터 실행합니다.

1. 변경 동작을 직접 보호하는 targeted test
2. 변경 파일 lint와 typecheck
3. 영향 범위 build 또는 integration test
4. 사용자 흐름에 필요한 Storybook, e2e, manual smoke

필요한 환경이나 권한이 없어 판정할 수 없을 때만 `BLOCKED`로 둡니다. 현재 단계에서 충분한 근거가 있으면
`PASS` 또는 `FAIL`을 판정하고, 더 큰 환경에서 확인할 항목은 별도 검증 공백으로 남깁니다.

`PASS`는 명시한 scope의 필요한 acceptance evidence가 충분할 때만 사용합니다. Finding이 없지만 필수 runner/reviewer 증거가
빠졌다면 PASS가 아닙니다. 이미 재현한 결함이 있으면 전체 실행이 불가능해도 그 결함은 FAIL로 보고하고 별도 blocked check를
병기합니다. Future production 관측처럼 current acceptance 밖의 항목은 [scoped Done](./development-lifecycle.md#scoped-done과-portable-evidence)에
따라 후속 handoff로 남깁니다. 모든 타입의 evidence gap이 현재 완료를 막는 것은 아닙니다.

## Output

1. findings 또는 acceptance 결과
2. 사용한 근거와 검증 명령
3. 변경·브랜치 범위
4. 잔여 위험과 검증 공백

검증 결과를 별도 파일로 남기는 것은 장기 추적 가치가 있거나 사용자가 요청한 경우로 제한합니다.
