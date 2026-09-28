# 확인된 결과 (2026-09-28 기준)

"확인됨"은 병합된 PR, CI, 테스트 실행 출력 또는 실제 세션 기록으로 확인한 것만 적었습니다.
PR 번호는 비공개 저장소 기준입니다.

## 1. 통합된 변경

| 단위 | 내용 | 상태 |
|---|---|---|
| 공통 계약 재설계 | 71개 개발 문서를 문서 graph로 감사, host-neutral 계약·계획 lifecycle·adapter conformance | PR #484 병합 |
| Codex 재접합 | Codex도 공통 계약을 소비하도록 재연결, 기존 모델/QA/복구 동작 회귀 고정, preflight 버그 수정 | PR #485 병합 |
| Claude adapter | 진입점·task 등록·hook·결과 수집·독립 리뷰·권한 gate | PR #487 진행 중(최종 commit CI 11/11 통과, 병합 전) |

## 2. 테스트

- Claude/Codex/공통 workflow 대상 테스트: **467/467 통과**, 저장소 전체 정책 테스트 **1116/1116 통과**
  (최신 작업 트리 기준. 병합 전 최종 commit 기준은 1105/1105).
- Negative 테스트 예: 모델 누락·불일치, 다른 세션, 만료, 입력 변조, 재사용, 권한 모드 변경, 독립 리뷰어가 자기 자신을
  검토하는 경우, 리뷰 결과를 다른 리뷰어로 바꿔치기하는 경우, 이미 실행된 작업에 뒤늦게 권한을 붙이는 경우.

## 3. Codex 단계: 비용·품질 라우팅 실측 (2026-09-24, 사전에 고정한 oracle)

| 작업 profile / 역할 / 모델 | 결과 | 한계 |
|---|---|---|
| bounded-build / executor / Sol xhigh | child 테스트 5/5, Parent oracle 8/8, 독립 QA PASS | 구현 표본 1개 |
| bounded-read / explorer / Sol xhigh | 고정 source 4개 의미 map, oracle·독립 QA PASS | 조사 표본 1개 |
| bounded-extract / explorer / Luna xhigh | 변환 8건 oracle 8/8, 독립 QA PASS | task 1개 안의 case 8개 |
| 복구(Astra low, 의도적으로 주입한 실패) | 복구 oracle 9/9, 독립 QA PASS | 실제 실패가 아닌 controlled fault |

공식 단가 비율(Sol/Astra 20%, Luna/Astra 1%)은 선택 근거일 뿐, 실제 절감률은 측정하지 않았습니다(출처: case study).

## 4. 실제 Claude Code 세션에서 관측한 것 (일반 `auto` 모드)

| 관측 | 결과 |
|---|---|
| 잘못된 모델·모델 누락 요청 | 실행 전 hook이 거부, subagent 0개 (여러 회) |
| 입력 파일이 등록 후 바뀐 요청 | `input file drift`로 거부 |
| Sonnet executor 구현 → Opus 독립 reviewer → 공통 QA | 완료 판정 통과. 변경 파일 1개(2,900개 경로 대조), writer lease 회수 |
| Sonnet researcher 결과 | Opus 독립 reviewer가 **공식 문서에 없는 주장(과잉 인용)을 FAIL로 적발**, Parent가 원문으로 재현, 완료 거부 |
| Haiku explorer | 정확한 모델 ID와 oracle 일치 확인 |
| 권한 grant 없이 실행된 subagent | 모델·결과가 맞아도 완료 판정 거부(`missing-permission-grant`) |

## 5. 독립 리뷰가 실제로 잡아낸 결함

- 소스 리뷰 1라운드 FAIL(중간 3건): 리뷰어 "쇼핑"(FAIL 뒤 다른 리뷰어 PASS로 우회), 빈 JSON 결과 통과, 리뷰어가
  실행 주체를 겸함 → 테스트로 재현 후 수정.
- 2라운드 FAIL(중간 1건): 전달됐지만 기록되지 않은 FAIL 우회 → 수정. 3라운드 PASS.
- 권한 gate 리뷰: 이미 실행된 작업에 나중에 권한을 발급하는 우회 → 재현·수정 후 PASS.

## 6. 공식 문서 대조로 바뀐 설계

- Claude Code 공식 hooks 문서 확인 결과, hook이 실패하면 호출이 **그대로 진행**됩니다(fail-open).
- 이를 근거로 "hook만으로 막는다"는 가정을 버렸습니다. 대신 역할별 `ask` 권한 규칙 + `PermissionRequest` hook 구조로 바꿔,
  hook이 고장 나면 자동 승인되지 않고 **사람의 승인 요청으로 넘어가도록**(fail-safe to human) 설계했습니다.
  새 세션에서의 실측은 대기 중입니다(ROADMAP 참조).
