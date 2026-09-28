# Security and privacy plan lens

Auth, legal, PII, profile/chat, moderation, abuse, analytics 또는 observability payload가 범위에 포함될 때 primary domain
guide와 함께 읽습니다. 일반 기능마다 자동 선택하지 않습니다.

## Required analysis

- actor, identity, authentication, authorization and trust boundary
- public/private/sensitive data classification and minimum disclosure
- consent, purpose, retention, deletion, de-identification and audit owner
- enumeration, replay, CSRF/XSS/open redirect, brute force, rate limit and abuse path
- moderation/report/block behavior and false-positive/appeal implications
- secret, credential, token, cookie and log/telemetry scrubbing
- legal or policy freshness that requires official-current evidence
- provider processing region, DPA, retention and operator access when applicable

## Plan additions

- threat/abuse cases and prohibited outcomes
- data-flow and disclosure matrix
- security/privacy Decisions and blocking OQs
- server-side enforcement owner; UI-only gating is insufficient
- negative tests for unauthorized actor, stale/replayed input, sensitive leakage and enumeration
- release evidence handoff for account/region/retention values unavailable during repository implementation

보안을 이유로 unrelated abstraction이나 provider를 자동 도입하지 않습니다. Risk와 current control gap을 먼저
증명하고 가장 작은 owner-local control을 계획합니다.
