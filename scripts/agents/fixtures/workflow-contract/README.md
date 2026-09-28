# 공통 workflow 계약 fixture

이 디렉터리는 production runtime이나 등록된 adapter가 아닌 **테스트 전용** 자료입니다.

- `intake-cases.json`: 실제 `buildTaskEnvelope` / `discoverContextPack` 호출의 characterization.
  여섯 intent와 fresh/resume 요청 문구를 별도 축으로 유지합니다. API에 없는 session-mode 필드를 발명하지 않습니다.
  이 행렬은 host entry 실행·checkpoint 재개를 검증하지 않습니다. 각 기대값의 이유를 유지하고 별도 대조 요청과
  authority 변조 negative로 단순 action map 복사를 보완합니다.
- `graph-cases.json` / `graph-oracle.mjs`: synthetic graph 의미의 positive/negative oracle.
  canonical owner 유일성, required cycle과 reference backlink 차이, current orphan, host 조건,
  Analyze의 write 도달, 미지원 capability를 구분합니다. scoped/history edge는 공통 필수 경로가 아닙니다.
  **실제 문서 graph, 전체 문서 coverage, host capability의 관측 또는 runtime conformance 증거가 아닙니다.**

```sh
node --test scripts/ci/agent-workflow-contract.test.mjs
node --test scripts/ci/codex-git-status.test.mjs scripts/ci/codex-session-preflight.test.mjs
```

Codex Git/OMX 실제 preflight fixture는 `../codex-preflight/`가 소유합니다. `skip`, `todo`, 실패 기대 wrapper로 결함을 숨기지 않으며 정상 CI가 현재 intended behavior를 보호한다. Native 모델·권한 관측과 테스트 fixture는 다른 증거다.
