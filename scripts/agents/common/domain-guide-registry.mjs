import { assertValidTaskEnvelope } from './intake-policy.mjs';

const GUIDE_REGISTRY = Object.freeze({
  core: guide('docs/development/agent-workflows/plan-authoring/core.md', 'plan-authoring-core'),
  frontend: guide('docs/development/agent-workflows/plan-authoring/frontend.md', 'frontend'),
  backend: guide('docs/development/agent-workflows/plan-authoring/backend.md', 'backend'),
  infrastructure: guide(
    'docs/development/agent-workflows/plan-authoring/infrastructure.md',
    'infrastructure',
  ),
  'security-privacy': guide(
    'docs/development/agent-workflows/plan-authoring/cross-cutting/security-privacy.md',
    'security-privacy',
  ),
  'operations-release': guide(
    'docs/development/agent-workflows/plan-authoring/cross-cutting/operations-release.md',
    'operations-release',
  ),
});

const PRIMARY_GUIDES = [
  { id: 'frontend', domains: new Set(['frontend', 'bff']) },
  { id: 'backend', domains: new Set(['backend']) },
  { id: 'infrastructure', domains: new Set(['infrastructure']) },
];

const EVIDENCE_KINDS = new Set([
  'changed-file',
  'policy',
  'architecture',
  'owner-readme',
  'contract',
  'route',
  'controller',
  'bff',
  'test',
  'external-source',
]);
const EVIDENCE_ROLES = new Set(['fact', 'inference', 'gap']);
const CONFLICT_STATUSES = new Set(['none', 'conflicting']);

export function discoverContextPack({
  envelope,
  repositoryEvidence = [],
  crossCuttingLimit = 2,
} = {}) {
  assertValidTaskEnvelope(envelope);
  validateCrossCuttingLimit(crossCuttingLimit);

  const sources = normalizeSources(repositoryEvidence);
  const domainCandidates = mergeDomainCandidates(envelope, sources);
  const gaps = collectEvidenceGaps(sources);
  const selectedGuides = selectGuides({
    envelope,
    domainCandidates,
    crossCuttingLimit,
    gaps,
  });

  return deepFreeze({
    schemaVersion: 1,
    requestId: envelope.requestId,
    intent: envelope.intent,
    domainCandidates,
    selectedGuides,
    sources,
    gaps: unique(gaps),
    limits: {
      primaryGuide: 1,
      crossCuttingGuides: crossCuttingLimit,
    },
  });
}

export function listDomainGuides() {
  return deepFreeze(Object.values(GUIDE_REGISTRY).map(({ ...entry }) => entry));
}

function selectGuides({ envelope, domainCandidates, crossCuttingLimit, gaps }) {
  if (envelope.intent !== 'plan') return [];

  const selected = [selectedGuide('core', 'Every Plan output uses the common authoring contract.')];
  const primary = selectPrimaryGuide(domainCandidates);
  if (primary.status === 'selected') {
    selected.push(selectedGuide(primary.id, primary.reason));
  } else {
    gaps.push(primary.reason);
  }

  const crossCutting = selectCrossCuttingGuides(envelope, domainCandidates).slice(
    0,
    crossCuttingLimit,
  );
  selected.push(...crossCutting);
  return selected;
}

function selectPrimaryGuide(candidates) {
  const scored = PRIMARY_GUIDES.map((entry) => ({
    ...entry,
    score: candidates
      .filter(({ domain }) => entry.domains.has(domain))
      .reduce((total, candidate) => total + confidenceWeight(candidate.confidence), 0),
  })).filter(({ score }) => score > 0);

  if (scored.length === 0) {
    return {
      status: 'unresolved',
      reason: 'primary-domain-unresolved: repository evidence did not identify a plan owner.',
    };
  }

  scored.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  if (scored[1]?.score === scored[0].score) {
    return {
      status: 'conflict',
      reason: `primary-domain-conflict: ${scored
        .filter(({ score }) => score === scored[0].score)
        .map(({ id }) => id)
        .join(', ')} have equal evidence.`,
    };
  }

  return {
    status: 'selected',
    id: scored[0].id,
    reason: `Selected ${scored[0].id} as the highest-evidence primary owner.`,
  };
}

function selectCrossCuttingGuides(envelope, candidates) {
  const domains = new Set(candidates.map(({ domain }) => domain));
  const selected = [];

  if (
    ['legal-policy', 'security', 'privacy', 'auth', 'moderation'].some((domain) =>
      domains.has(domain),
    )
  ) {
    selected.push(
      selectedGuide(
        'security-privacy',
        'Selected because repository evidence includes legal, auth, moderation, security, or privacy scope.',
      ),
    );
  }

  if (
    ['infrastructure', 'operations', 'release', 'migration', 'provider'].some((domain) =>
      domains.has(domain),
    ) ||
    envelope.requiredEvidence.includes('external-owner')
  ) {
    selected.push(
      selectedGuide(
        'operations-release',
        'Selected because repository evidence includes runtime, provider, migration, or release scope.',
      ),
    );
  }

  return selected;
}

function selectedGuide(id, selectionReason) {
  return {
    ...GUIDE_REGISTRY[id],
    selectionReason,
    conflictStatus: 'none',
  };
}

function mergeDomainCandidates(envelope, sources) {
  const candidateMap = new Map();

  for (const candidate of envelope.domainCandidates) {
    addCandidate(candidateMap, {
      domain: candidate.domain,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
    });
  }

  for (const source of sources) {
    for (const domain of domainsForSource(source)) {
      addCandidate(candidateMap, {
        domain,
        confidence: confidenceForSource(source),
        evidence: [`${source.kind}: ${source.path}`],
      });
    }
  }

  for (const domain of domainsForRequest(envelope.requestSummary)) {
    addCandidate(candidateMap, {
      domain,
      confidence: 'low',
      evidence: [`request term: ${domain}`],
    });
  }

  return [...candidateMap.values()]
    .map((candidate) => ({
      ...candidate,
      evidence: unique(candidate.evidence),
      conflictStatus: 'none',
    }))
    .sort((left, right) => left.domain.localeCompare(right.domain));
}

function addCandidate(candidateMap, candidate) {
  const current = candidateMap.get(candidate.domain);
  if (!current) {
    candidateMap.set(candidate.domain, { ...candidate, evidence: [...candidate.evidence] });
    return;
  }

  current.confidence = higherConfidence(current.confidence, candidate.confidence);
  current.evidence.push(...candidate.evidence);
}

function domainsForSource(source) {
  const domains = new Set();
  const path = source.path.toLowerCase();

  if (path.startsWith('docs/policies/')) domains.add('policy');
  if (/(legal|privacy|consent|terms|개인정보)/u.test(path)) domains.add('legal-policy');
  if (/(auth|login|signup|password|session)/u.test(path)) domains.add('auth');
  if (/(moderation|report|block|abuse|incident)/u.test(path)) domains.add('moderation');
  if (path.startsWith('apps/web/src/app/api/')) {
    domains.add('frontend');
    domains.add('bff');
  } else if (path.startsWith('apps/web/')) {
    domains.add('frontend');
  }
  if (path.startsWith('apps/api/')) domains.add('backend');
  if (path.startsWith('packages/shared/')) domains.add('shared-contract');
  if (isTestPath(path) || source.kind === 'test') domains.add('test');
  if (
    path.startsWith('infra/') ||
    path.startsWith('.github/workflows/') ||
    path.startsWith('scripts/infra/')
  ) {
    domains.add('infrastructure');
  }
  if (/(migration|prisma\/migrations|schema\.prisma)/u.test(path)) domains.add('migration');
  if (/(observability|runbooks|release|deploy)/u.test(path)) domains.add('operations');
  if (source.kind === 'external-source') domains.add('external-evidence');

  return domains;
}

function domainsForRequest(summary) {
  const domains = new Set();
  const request = summary.toLowerCase();
  if (/(legal|법적|약관|개인정보|privacy)/u.test(request)) domains.add('legal-policy');
  if (/(frontend|next\.js|react|ui|ux|web)/u.test(request)) domains.add('frontend');
  if (/(bff|route handler)/u.test(request)) domains.add('bff');
  if (/(backend|api|nestjs|persistence|db)/u.test(request)) domains.add('backend');
  if (/(infra|deploy|release|runtime|container|aws)/u.test(request)) {
    domains.add('infrastructure');
  }
  if (/(auth|login|signup|password|session)/u.test(request)) domains.add('auth');
  if (/(test|테스트|검증)/u.test(request)) domains.add('test');
  return domains;
}

function normalizeSources(repositoryEvidence) {
  if (!Array.isArray(repositoryEvidence)) {
    throw new TypeError('repositoryEvidence must be an array.');
  }

  return repositoryEvidence.map((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new TypeError('repository evidence must be an object.');
    }
    const path = normalizeEvidencePath(source.path);
    const kind = source.kind ?? inferEvidenceKind(path);
    if (!EVIDENCE_KINDS.has(kind)) throw new TypeError(`Unsupported evidence kind: ${kind}`);
    const verifiedAt = normalizeVerifiedAt(source.verifiedAt ?? null);
    const evidenceRole = normalizeEnum(
      source.evidenceRole ?? 'fact',
      EVIDENCE_ROLES,
      'evidenceRole',
    );
    const conflictStatus = normalizeEnum(
      source.conflictStatus ?? 'none',
      CONFLICT_STATUSES,
      'conflictStatus',
    );
    const selectionReason = normalizeSelectionReason(source.reason, kind);

    return {
      path,
      kind,
      owner: inferOwner(path, kind),
      authorityLevel: authorityForKind(kind),
      selectionReason,
      freshness: verifiedAt ? 'verified-at' : freshnessForPath(path),
      verifiedAt,
      evidenceRole,
      conflictStatus,
    };
  });
}

function collectEvidenceGaps(sources) {
  const gaps = [];
  for (const source of sources) {
    if (source.kind === 'external-source' && !source.verifiedAt) {
      gaps.push(`external-source-unverified: ${source.path}`);
    }
    if (source.conflictStatus !== 'none') {
      gaps.push(`source-conflict: ${source.path}`);
    }
  }
  return gaps;
}

function guide(path, owner) {
  return Object.freeze({
    path,
    owner,
    authorityLevel: 'workflow-guidance',
    freshness: 'tracked-current',
    verifiedAt: null,
    evidenceRole: 'inference-lens',
  });
}

function normalizeEvidencePath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    throw new TypeError('repository evidence path is required.');
  }
  const normalized = path.trim().replaceAll('\\', '/');
  if (/^https:\/\//u.test(normalized)) return normalized;
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(normalized)) {
    throw new TypeError('external evidence URL must use HTTPS.');
  }
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new TypeError('repository evidence path must stay inside the repository.');
  }
  return normalized.replace(/^\.\//u, '');
}

function inferEvidenceKind(path) {
  const lower = path.toLowerCase();
  if (lower.startsWith('https://')) return 'external-source';
  if (isTestPath(lower)) return 'test';
  if (lower.startsWith('docs/policies/')) return 'policy';
  if (lower.includes('/contracts/') || lower.startsWith('packages/shared/')) return 'contract';
  if (lower.endsWith('/readme.md')) return 'owner-readme';
  if (lower.startsWith('docs/architecture/')) return 'architecture';
  if (lower.startsWith('apps/web/src/app/api/')) return 'bff';
  if (/controller\.(?:ts|js)$/u.test(lower)) return 'controller';
  if (/route\.(?:ts|tsx|js)$/u.test(lower)) return 'route';
  return 'changed-file';
}

function inferOwner(path, kind) {
  if (kind === 'external-source') return 'external-owner';
  if (path.startsWith('docs/policies/')) return 'policy-owner';
  if (path.startsWith('apps/web/src/app/api/')) return 'bff';
  if (path.startsWith('apps/web/')) return 'frontend';
  if (path.startsWith('apps/api/')) return 'backend';
  if (path.startsWith('packages/shared/')) return 'shared-contract';
  if (
    path.startsWith('infra/') ||
    path.startsWith('.github/') ||
    path.startsWith('scripts/infra/')
  ) {
    return 'infrastructure';
  }
  return 'repository';
}

function authorityForKind(kind) {
  if (kind === 'policy') return 'tracked-policy';
  if (kind === 'contract') return 'public-contract';
  if (kind === 'test') return 'executable-evidence';
  if (kind === 'external-source') return 'external-evidence';
  return 'repository-evidence';
}

function freshnessForPath(path) {
  return path.startsWith('https://') ? 'unverified' : 'current-working-tree';
}

function normalizeVerifiedAt(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new TypeError('verifiedAt must be an ISO timestamp or null.');
  }
  return new Date(value).toISOString();
}

function normalizeSelectionReason(value, kind) {
  if (value === undefined || value === null) {
    return `Current ${kind} evidence matched the request.`;
  }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 300) {
    throw new TypeError('repository evidence reason must be a bounded string.');
  }
  return value.trim();
}

function normalizeEnum(value, allowed, field) {
  if (!allowed.has(value)) throw new TypeError(`Unsupported ${field}: ${value}`);
  return value;
}

function confidenceForSource(source) {
  if (['policy', 'contract', 'controller', 'bff', 'test'].includes(source.kind)) return 'high';
  if (['architecture', 'owner-readme', 'route', 'changed-file'].includes(source.kind)) {
    return 'medium';
  }
  return source.verifiedAt ? 'medium' : 'low';
}

function confidenceWeight(confidence) {
  return { low: 1, medium: 2, high: 3 }[confidence];
}

function higherConfidence(left, right) {
  return confidenceWeight(left) >= confidenceWeight(right) ? left : right;
}

function isTestPath(path) {
  return /(?:^|\/)(?:test|tests|__tests__|__stories__)(?:\/|$)|\.(?:spec|test)\.[^/]+$/u.test(path);
}

function validateCrossCuttingLimit(value) {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new TypeError('crossCuttingLimit must be an integer between 0 and 2.');
  }
}

function unique(values) {
  return [...new Set(values)];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
