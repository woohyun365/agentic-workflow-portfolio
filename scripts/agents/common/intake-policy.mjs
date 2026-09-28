import { createHash } from 'node:crypto';

const INTENTS = new Set(['answer', 'analyze', 'plan', 'implement', 'review', 'debug', 'unknown']);
const ACTIONS = new Set(['inspect', 'answer', 'produce-analysis', 'produce-plan', 'mutate']);
const RISKS = new Set(['low', 'medium', 'high']);
const PATHS = new Set(['direct', 'sequential', 'clarify', 'oq-handoff', 'bounded-lanes']);
const CONFIDENCE = new Set(['low', 'medium', 'high']);
const EVIDENCE_KINDS = new Set(['fact', 'inference', 'gap']);
const AMBIGUITY_DISPOSITIONS = new Set([
  'clarify-now',
  'plan-oq',
  'release-evidence-handoff',
  'evidence-gap',
  'safe-read-only-first',
]);
const REQUIRED_EVIDENCE = new Set(['repo', 'test', 'official-current', 'external-owner']);
const ENVELOPE_FIELDS = new Set([
  'requestId',
  'requestSummary',
  'intent',
  'authorizedAction',
  'risk',
  'domainCandidates',
  'constraints',
  'evidence',
  'requiredEvidence',
  'ambiguities',
  'recommendedPath',
  'confidence',
]);

const SECRET_VALUE_PATTERN =
  /\b(bearer\s+|password\s*[:=]\s*|token\s*[:=]\s*|api[-_]?key\s*[:=]\s*)[^\s,;]+/giu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;
const SENSITIVE_SUMMARY_PATTERN =
  /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:bearer|password|token|api[-_]?key)\s*[:=]\s*(?!\[redacted\]))/iu;

export function buildTaskEnvelope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Task intake input must be an object.');
  }

  const request = requireBoundedString(input.request, 'request', 10_000);
  const classification = classifyRequest(request);
  const suppliedAmbiguities = normalizeAmbiguities(input.ambiguities ?? []);
  const ambiguities = dedupeBy(
    [...classification.ambiguities, ...suppliedAmbiguities],
    ({ question, disposition }) => `${disposition}:${question}`,
  );
  const domainCandidates = normalizeDomainCandidates(input.domainCandidates ?? []);
  const evidence = normalizeEvidence(input.evidence ?? []);
  const constraints = normalizeConstraints(input.constraints ?? []);
  const requiredEvidence = unique([
    ...classification.requiredEvidence,
    ...normalizeRequiredEvidence(input.requiredEvidence ?? []),
  ]);
  const requestSummary = summarizeRequest(request);

  const envelope = {
    requestId: createRequestId(requestSummary),
    requestSummary,
    intent: classification.intent,
    authorizedAction: classification.authorizedAction,
    risk: classification.risk,
    domainCandidates,
    constraints,
    evidence,
    requiredEvidence,
    ambiguities,
    recommendedPath: recommendPath(classification.intent, ambiguities),
    confidence: classification.confidence,
  };

  assertValidTaskEnvelope(envelope);
  return deepFreeze(envelope);
}

export function validateTaskEnvelope(envelope) {
  const errors = [];

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { valid: false, errors: ['TaskEnvelope must be an object.'] };
  }

  validateEnum(envelope.intent, INTENTS, 'intent', errors);
  validateEnum(envelope.authorizedAction, ACTIONS, 'authorizedAction', errors);
  validateEnum(envelope.risk, RISKS, 'risk', errors);
  validateEnum(envelope.recommendedPath, PATHS, 'recommendedPath', errors);
  validateEnum(envelope.confidence, CONFIDENCE, 'confidence', errors);

  if (!isBoundedString(envelope.requestId, 80)) errors.push('requestId is required.');
  if (!isBoundedString(envelope.requestSummary, 200)) errors.push('requestSummary is required.');
  if (SENSITIVE_SUMMARY_PATTERN.test(envelope.requestSummary ?? '')) {
    errors.push('requestSummary contains unredacted sensitive input.');
  }

  for (const field of Object.keys(envelope)) {
    if (!ENVELOPE_FIELDS.has(field)) errors.push(`Unsupported TaskEnvelope field: ${field}`);
  }

  for (const field of [
    'domainCandidates',
    'constraints',
    'evidence',
    'requiredEvidence',
    'ambiguities',
  ]) {
    if (!Array.isArray(envelope[field])) errors.push(`${field} must be an array.`);
  }

  for (const candidate of envelope.domainCandidates ?? []) {
    if (!isBoundedString(candidate.domain, 80)) errors.push('domain candidate requires a domain.');
    validateEnum(candidate.confidence, CONFIDENCE, 'domain confidence', errors);
    if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
      errors.push('domain candidate requires evidence.');
    } else if (candidate.evidence.some((item) => !isBoundedString(item, 160))) {
      errors.push('domain candidate evidence must be bounded strings.');
    }
  }

  for (const constraint of envelope.constraints ?? []) {
    validateEnum(
      constraint.source,
      new Set(['user', 'repository', 'environment']),
      'constraint source',
      errors,
    );
    if (!isBoundedString(constraint.statement, 300)) {
      errors.push('constraint statement is required.');
    }
  }

  for (const item of envelope.evidence ?? []) {
    validateEnum(item.kind, EVIDENCE_KINDS, 'evidence kind', errors);
    validateEnum(item.confidence, CONFIDENCE, 'evidence confidence', errors);
    if (!isBoundedString(item.statement, 300)) errors.push('evidence statement is required.');
  }

  for (const ambiguity of envelope.ambiguities ?? []) {
    validateEnum(ambiguity.disposition, AMBIGUITY_DISPOSITIONS, 'ambiguity disposition', errors);
    if (!isBoundedString(ambiguity.question, 300)) errors.push('ambiguity question is required.');
    if (!isBoundedString(ambiguity.impact, 300)) errors.push('ambiguity impact is required.');
  }

  for (const requirement of envelope.requiredEvidence ?? []) {
    validateEnum(requirement, REQUIRED_EVIDENCE, 'required evidence', errors);
  }

  if (envelope.intent === 'analyze' && envelope.authorizedAction !== 'produce-analysis') {
    errors.push('Analyze intent must use produce-analysis authority.');
  }
  if (envelope.intent === 'plan' && envelope.authorizedAction !== 'produce-plan') {
    errors.push('Plan intent must use produce-plan authority.');
  }
  if (envelope.intent === 'unknown' && envelope.authorizedAction !== 'inspect') {
    errors.push('Unknown intent must fail closed to inspect authority.');
  }
  if (envelope.intent === 'unknown' && envelope.recommendedPath === 'bounded-lanes') {
    errors.push('Unknown intent cannot recommend bounded lanes.');
  }
  if (envelope.authorizedAction === 'mutate' && !['implement', 'debug'].includes(envelope.intent)) {
    errors.push('Mutate authority requires explicit implement or debug intent.');
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidTaskEnvelope(envelope) {
  const validation = validateTaskEnvelope(envelope);
  if (!validation.valid) throw new TypeError(validation.errors.join(' '));
  return envelope;
}

function classifyRequest(request) {
  const normalized = request.normalize('NFC').toLowerCase();
  const risk = classifyRisk(normalized);

  if (isBroadAmbiguousImprovement(normalized, risk)) {
    return {
      intent: 'unknown',
      authorizedAction: 'inspect',
      risk,
      confidence: 'low',
      requiredEvidence: inferRequiredEvidence(normalized),
      ambiguities: [
        {
          question: '개선할 결과와 변경 범위를 확인해야 합니다.',
          impact: '선택한 surface와 정책 근거에 따라 구현 범위와 검증이 달라집니다.',
          disposition: 'clarify-now',
        },
      ],
    };
  }

  const intent = inferExplicitIntent(normalized);
  return {
    intent,
    authorizedAction: actionForIntent(intent),
    risk,
    confidence: intent === 'unknown' ? 'low' : 'high',
    requiredEvidence: inferRequiredEvidence(normalized),
    ambiguities:
      intent === 'unknown'
        ? [
            {
              question: '요청한 결과 종류와 변경 권한이 명확하지 않습니다.',
              impact: '답변·분석·계획·구현 중 어느 결과를 만들어야 하는지가 달라집니다.',
              disposition: 'safe-read-only-first',
            },
          ]
        : [],
  };
}

function inferExplicitIntent(request) {
  if (
    /(계획(을|을\s+|\s*)?(작성|생성|세워|세우|만들|갱신|최신화)|(?:create|write|draft|update)\s+(?:an?\s+)?plan)/iu.test(
      request,
    )
  ) {
    return 'plan';
  }
  if (/(리뷰|review|검토해\s*줘|검토해줘)/iu.test(request)) return 'review';
  if (
    /(원인.*(분석|파악)|분석해\s*줘|분석해줘|평가해\s*줘|평가해줘|검증해\s*줘|검증해줘|investigate|analy[sz]e|verify)/iu.test(
      request,
    )
  ) {
    return 'analyze';
  }
  if (/(해결해\s*줘|해결해줘|고쳐\s*줘|고쳐줘|fix\b|debug\b)/iu.test(request)) return 'debug';
  if (
    /(구현해\s*줘|구현해줘|적용해\s*줘|적용해줘|수정해\s*줘|수정해줘|변경해\s*줘|변경해줘|추가해\s*줘|추가해줘|삭제해\s*줘|삭제해줘|정리해\s*줘|정리해줘|stage(?:해\s*줘)?|commit(?:해\s*줘)?)/iu.test(
      request,
    )
  ) {
    return 'implement';
  }
  if (
    /(알려\s*줘|알려줘|설명해\s*줘|설명해줘|무슨\s+의미|뭐야|궁금|몇\s*(줄|개|명|번)|what|why|how)/iu.test(
      request,
    )
  ) {
    return 'answer';
  }
  return 'unknown';
}

function classifyRisk(request) {
  if (
    /(legal|법적|법률|개인정보|privacy|security|보안|auth|인증|credential|secret|production|배포|migration|마이그레이션|drop\b|삭제)/iu.test(
      request,
    )
  ) {
    return 'high';
  }
  if (/(구현|수정|변경|추가|정리|해결|fix|debug|commit|stage)/iu.test(request)) return 'medium';
  return 'low';
}

function isBroadAmbiguousImprovement(request, risk) {
  if (!/(개선해\s*줘|개선해줘|improve)/iu.test(request)) return false;
  const explicitOutput =
    /(분석|계획|구현|수정|적용|설명|검토|review|plan|implement|analy[sz]e)/iu.test(request);
  return risk === 'high' && !explicitOutput;
}

function actionForIntent(intent) {
  return {
    answer: 'answer',
    analyze: 'produce-analysis',
    plan: 'produce-plan',
    implement: 'mutate',
    review: 'produce-analysis',
    debug: 'mutate',
    unknown: 'inspect',
  }[intent];
}

function recommendPath(intent, ambiguities) {
  if (ambiguities.some(({ disposition }) => disposition === 'clarify-now')) return 'clarify';
  if (ambiguities.some(({ disposition }) => disposition === 'release-evidence-handoff')) {
    return 'oq-handoff';
  }
  if (intent === 'answer') return 'direct';
  if (intent === 'unknown') return 'clarify';
  return 'sequential';
}

function inferRequiredEvidence(request) {
  const required = [];
  if (/(repo|repository|코드|파일|AGENTS\.md|구현|수정|개선|분석|점검|계획)/iu.test(request)) {
    required.push('repo');
  }
  if (/(test|테스트|검증)/iu.test(request)) required.push('test');
  if (/(최신|공식|202\d|legal|법적|법률|정책|provider|version)/iu.test(request)) {
    required.push('official-current');
  }
  if (/(계정|credential|region|production target|배포 대상)/iu.test(request)) {
    required.push('external-owner');
  }
  return required.length === 0 ? ['repo'] : unique(required);
}

function normalizeDomainCandidates(candidates) {
  if (!Array.isArray(candidates)) throw new TypeError('domainCandidates must be an array.');
  return candidates.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new TypeError('domain candidate must be an object.');
    }
    const evidence = normalizeStringArray(candidate.evidence, 'domain evidence', 160);
    if (evidence.length === 0) throw new TypeError('domain candidate requires evidence.');
    return {
      domain: requireBoundedString(candidate.domain, 'domain', 80),
      confidence: requireEnum(candidate.confidence, CONFIDENCE, 'domain confidence'),
      evidence,
    };
  });
}

function normalizeConstraints(constraints) {
  if (!Array.isArray(constraints)) throw new TypeError('constraints must be an array.');
  return constraints.map((constraint) => ({
    source: requireEnum(
      constraint?.source,
      new Set(['user', 'repository', 'environment']),
      'constraint source',
    ),
    statement: sanitize(requireBoundedString(constraint?.statement, 'constraint statement', 300)),
  }));
}

function normalizeEvidence(evidence) {
  if (!Array.isArray(evidence)) throw new TypeError('evidence must be an array.');
  return evidence.map((item) => ({
    kind: requireEnum(item?.kind, EVIDENCE_KINDS, 'evidence kind'),
    statement: sanitize(requireBoundedString(item?.statement, 'evidence statement', 300)),
    source: item?.source
      ? sanitize(requireBoundedString(item.source, 'evidence source', 300))
      : null,
    confidence: requireEnum(item?.confidence, CONFIDENCE, 'evidence confidence'),
  }));
}

function normalizeAmbiguities(ambiguities) {
  if (!Array.isArray(ambiguities)) throw new TypeError('ambiguities must be an array.');
  return ambiguities.map((ambiguity) => ({
    question: sanitize(requireBoundedString(ambiguity?.question, 'ambiguity question', 300)),
    impact: sanitize(requireBoundedString(ambiguity?.impact, 'ambiguity impact', 300)),
    disposition: requireEnum(
      ambiguity?.disposition,
      AMBIGUITY_DISPOSITIONS,
      'ambiguity disposition',
    ),
  }));
}

function normalizeRequiredEvidence(requiredEvidence) {
  return normalizeStringArray(requiredEvidence, 'requiredEvidence', 40).map((value) =>
    requireEnum(value, REQUIRED_EVIDENCE, 'required evidence'),
  );
}

function normalizeStringArray(values, field, maxLength) {
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array.`);
  return unique(values.map((value) => sanitize(requireBoundedString(value, field, maxLength))));
}

function summarizeRequest(request) {
  const sanitized = sanitize(request);
  return sanitized.length <= 160 ? sanitized : `${sanitized.slice(0, 157)}...`;
}

function sanitize(value) {
  return value
    .normalize('NFC')
    .replace(CONTROL_PATTERN, '')
    .replace(SECRET_VALUE_PATTERN, '$1[redacted]')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(/\s+/gu, ' ')
    .trim();
}

function createRequestId(summary) {
  return `request-${createHash('sha256').update(summary).digest('hex').slice(0, 16)}`;
}

function requireBoundedString(value, field, maxLength) {
  if (!isBoundedString(value, maxLength)) {
    throw new TypeError(`${field} must be a non-empty string up to ${maxLength} characters.`);
  }
  return value.trim();
}

function isBoundedString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function requireEnum(value, allowed, field) {
  if (!allowed.has(value)) throw new TypeError(`Unsupported ${field}: ${String(value)}`);
  return value;
}

function validateEnum(value, allowed, field, errors) {
  if (!allowed.has(value)) errors.push(`Unsupported ${field}: ${String(value)}`);
}

function unique(values) {
  return [...new Set(values)];
}

function dedupeBy(values, key) {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
