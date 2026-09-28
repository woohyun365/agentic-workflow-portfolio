import { createHash } from 'node:crypto';

import { validateCrossModelExchange, validateTaskEnvelope } from '../common/index.mjs';

const POLICY_REVISION = '2026-09-28.1';
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/u;
const SAFE_REF = /^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,299}$/u;
const EXACT_MODEL_ID = /^claude-(?:haiku|sonnet|opus)-[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const ROLE_TOOLS = deepFreeze({
  repo_explorer: ['Read', 'Grep', 'Glob'],
  repo_researcher: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
  repo_executor: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
  repo_reviewer: ['Read', 'Grep', 'Glob'],
});

const PROFILES = deepFreeze([
  {
    id: 'bounded-extraction',
    modelAlias: 'haiku',
    kinds: ['extract'],
    impactRisks: ['low'],
    complexities: ['bounded'],
    roles: ['repo_explorer'],
    allowedTools: ['Read', 'Grep', 'Glob'],
    requiredFacts: [
      'source-bound',
      'fixed-input',
      'single-step',
      'output-schema',
      'acceptance',
      'independent-check',
    ],
    readOnly: true,
  },
  {
    id: 'bounded-standard',
    modelAlias: 'sonnet',
    kinds: ['read', 'build'],
    impactRisks: ['low', 'medium'],
    complexities: ['bounded'],
    roles: ['repo_explorer', 'repo_researcher', 'repo_executor'],
    allowedTools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Edit', 'Write', 'Bash'],
    requiredFacts: ['source-bound', 'bounded-scope', 'acceptance', 'oracle', 'independent-qa'],
    readOnly: false,
  },
  {
    id: 'complex-critical',
    modelAlias: 'opus',
    kinds: ['extract', 'read', 'build', 'review'],
    impactRisks: ['low', 'medium', 'high'],
    complexities: ['bounded', 'complex'],
    roles: ['repo_explorer', 'repo_researcher', 'repo_executor', 'repo_reviewer'],
    allowedTools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Edit', 'Write', 'Bash'],
    requiredFacts: ['source-bound', 'bounded-scope', 'acceptance', 'oracle', 'independent-qa'],
    readOnly: false,
  },
]);

const PROFILE_BY_ID = new Map(PROFILES.map((profile) => [profile.id, profile]));
const INPUT_FIELDS = [
  'envelope',
  'profileId',
  'selectedBy',
  'selectionBasisRef',
  'task',
  'sourceDigest',
  'configDigest',
  'issuedAt',
  'expiresAt',
];
const TASK_FIELDS = [
  'taskId',
  'kind',
  'impactRisk',
  'complexity',
  'uncertainty',
  'role',
  'allowedTools',
  'readScope',
  'writeScope',
  'writeOwner',
  'childValue',
  'independent',
  'knownGaps',
  'facts',
];
const FACT_FIELDS = ['key', 'sourceRef', 'confidence'];
const ADMISSION_FIELDS = [
  'bindingDigest',
  'taskId',
  'envelopeDigest',
  'sourceDigest',
  'configDigest',
  'scopeDigest',
  'approvedBy',
  'authorityRef',
  'permission',
  'qaOwner',
  'issuedAt',
  'expiresAt',
];
const RUNTIME_FIELDS = [
  'support',
  'permission',
  'quota',
  'freshness',
  'role',
  'roleTools',
  'requestedAlias',
  'expectedResolvedModel',
  'evidenceRef',
];
const CURRENT_FIELDS = [
  'requestId',
  'taskId',
  'envelopeDigest',
  'sourceDigest',
  'configDigest',
  'scopeDigest',
  'writerInventory',
  'now',
];
const BINDING_FIELDS = [
  'schemaVersion',
  'policyRevision',
  'requestId',
  'requestSummary',
  'taskId',
  'envelopeDigest',
  'envelopeIntent',
  'envelopeAction',
  'envelopeRisk',
  'envelopePath',
  'profileId',
  'taskKind',
  'impactRisk',
  'complexity',
  'uncertainty',
  'childValue',
  'independent',
  'knownGaps',
  'requestedModelAlias',
  'requestedModelSource',
  'selectedBy',
  'selectionBasisRef',
  'role',
  'allowedTools',
  'readScope',
  'writeScope',
  'writeOwner',
  'sourceDigest',
  'configDigest',
  'scopeDigest',
  'issuedAt',
  'expiresAt',
  'taskFacts',
  'bindingDigest',
];
const DESCRIPTOR_FIELDS = [
  'schemaVersion',
  'bindingDigest',
  'taskId',
  'host',
  'transport',
  'role',
  'allowedTools',
  'writeOwner',
  'requestedModel',
  'expectedResolvedModel',
  'evidenceRef',
  'dispatchAllowed',
  'applied',
  'runtimeQualification',
];
const RECEIPT_FIELDS = [
  'bindingDigest',
  'status',
  'role',
  'requestedAlias',
  'resolvedModel',
  'observedModel',
  'evidenceRef',
  'oracle',
];

export function listClaudeSubagentProfiles() {
  return PROFILES;
}

export function evaluateClaudeProfileEligibility(input) {
  const reasons = [];
  try {
    exact(input, INPUT_FIELDS);
    exact(input.task, TASK_FIELDS);
    assertEnvelope(input.envelope);
    digest(input.sourceDigest);
    digest(input.configDigest);
    identifier(input.task.taskId);
    reference(input.selectionBasisRef);
    require(input.selectedBy === 'lead');
    validInterval(input.issuedAt, input.expiresAt);
    validateTask(input.task);
  } catch {
    reasons.push('invalid-input');
  }
  if (reasons.length > 0) return deepFreeze({ eligible: false, reasons });

  const profile = PROFILE_BY_ID.get(input?.profileId);
  if (!profile) reasons.push('unknown-profile');
  if (profile && input?.task) {
    reasons.push(...envelopeReasons(input.envelope, input.task));
    reasons.push(...eligibilityReasons(profile, input.task));
  }

  return deepFreeze({ eligible: reasons.length === 0, reasons: [...new Set(reasons)] });
}

export function createClaudeSubagentBinding(input) {
  const eligibility = evaluateClaudeProfileEligibility(input);
  if (!eligibility.eligible) {
    throw new TypeError(`Claude subagent binding is ineligible: ${eligibility.reasons.join(', ')}`);
  }
  const profile = PROFILE_BY_ID.get(input.profileId);
  const scope = {
    role: input.task.role,
    allowedTools: [...input.task.allowedTools],
    readScope: [...input.task.readScope],
    writeScope: [...input.task.writeScope],
    writeOwner: input.task.writeOwner,
  };
  const data = {
    schemaVersion: 1,
    policyRevision: POLICY_REVISION,
    requestId: input.envelope.requestId,
    requestSummary: input.envelope.requestSummary,
    taskId: input.task.taskId,
    envelopeDigest: hash(input.envelope),
    envelopeIntent: input.envelope.intent,
    envelopeAction: input.envelope.authorizedAction,
    envelopeRisk: input.envelope.risk,
    envelopePath: input.envelope.recommendedPath,
    profileId: profile.id,
    taskKind: input.task.kind,
    impactRisk: input.task.impactRisk,
    complexity: input.task.complexity,
    uncertainty: input.task.uncertainty,
    childValue: input.task.childValue,
    independent: input.task.independent,
    knownGaps: [...input.task.knownGaps],
    requestedModelAlias: profile.modelAlias,
    requestedModelSource: `profile:${profile.id}`,
    selectedBy: input.selectedBy,
    selectionBasisRef: input.selectionBasisRef,
    role: input.task.role,
    allowedTools: [...input.task.allowedTools],
    readScope: [...input.task.readScope],
    writeScope: [...input.task.writeScope],
    writeOwner: input.task.writeOwner,
    sourceDigest: input.sourceDigest,
    configDigest: input.configDigest,
    scopeDigest: hash(scope),
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    taskFacts: structuredClone(input.task.facts),
  };
  return deepFreeze({ ...data, bindingDigest: hash(data) });
}

export function assessClaudeSubagentAdmission(input) {
  try {
    exact(input, ['binding', 'admission', 'runtime', 'current']);
    const { binding, admission, runtime, current } = input;
    validateBinding(binding);
    checked(admission !== null && admission !== undefined, 'missing-admission');
    exact(admission, ADMISSION_FIELDS);
    exact(runtime, RUNTIME_FIELDS);
    exact(current, CURRENT_FIELDS);
    for (const field of ['envelopeDigest', 'sourceDigest', 'configDigest', 'scopeDigest']) {
      digest(admission[field]);
      digest(current[field]);
      checked(
        admission[field] === binding[field] && current[field] === binding[field],
        'stale-binding',
      );
    }
    checked(admission.bindingDigest === binding.bindingDigest, 'stale-binding');
    checked(
      admission.taskId === binding.taskId && current.taskId === binding.taskId,
      'stale-binding',
    );
    checked(current.requestId === binding.requestId, 'stale-binding');
    require(admission.approvedBy === 'lead');
    reference(admission.authorityRef);
    checked(admission.permission === 'allowed', 'admission-denied');
    require(admission.qaOwner === 'independent-reviewer');
    require(admission.qaOwner !== binding.writeOwner);
    validInterval(admission.issuedAt, admission.expiresAt);
    checked(within(current.now, binding.issuedAt, binding.expiresAt), 'stale-binding');
    checked(within(current.now, admission.issuedAt, admission.expiresAt), 'stale-binding');
    validateWriterInventory(current.writerInventory);
    checked(
      !current.writerInventory.active.some(({ writeScope }) =>
        writeScope.some((activePath) =>
          binding.writeScope.some((path) => pathsOverlap(activePath, path)),
        ),
      ),
      'writer-conflict',
    );

    checked(
      runtime.support === 'supported',
      runtime.support === 'unknown' ? 'runtime-unknown' : 'runtime-unsupported',
    );
    checked(runtime.permission === 'allowed', 'permission-denied');
    checked(
      runtime.quota === 'available',
      runtime.quota === 'unknown' ? 'quota-unknown' : 'quota-denied',
    );
    checked(runtime.freshness === 'current-turn', 'stale-runtime');
    checked(runtime.role === binding.role, 'role-mismatch');
    checked(runtime.requestedAlias === binding.requestedModelAlias, 'model-mismatch');
    exactStringArray(runtime.roleTools);
    checked(
      equalArrays(runtime.roleTools, ROLE_TOOLS[binding.role]) &&
        equalArrays(binding.allowedTools, runtime.roleTools),
      'tool-mismatch',
    );
    checked(
      modelIdentityMatches(binding.requestedModelAlias, runtime.expectedResolvedModel),
      'model-mismatch',
    );
    reference(runtime.evidenceRef);

    const descriptor = deepFreeze({
      schemaVersion: 1,
      bindingDigest: binding.bindingDigest,
      taskId: binding.taskId,
      host: 'claude-code',
      transport: 'native-subagent',
      role: binding.role,
      allowedTools: [...binding.allowedTools],
      writeOwner: binding.writeOwner,
      requestedModel: {
        alias: binding.requestedModelAlias,
        source: binding.requestedModelSource,
      },
      expectedResolvedModel: runtime.expectedResolvedModel,
      evidenceRef: runtime.evidenceRef,
      dispatchAllowed: false,
      applied: false,
      runtimeQualification: 'not-run',
    });
    return deepFreeze({ decision: 'candidate', descriptor });
  } catch (error) {
    return deepFreeze({ decision: 'refuse', reason: policyReason(error), descriptor: null });
  }
}

export function assessClaudeModelObservation({ binding, descriptor, receipt, ...extra } = {}) {
  try {
    require(Object.keys(extra).length === 0);
    validateBinding(binding);
    validateDescriptor(descriptor);
    checked(
      descriptor.bindingDigest === binding.bindingDigest &&
        descriptor.taskId === binding.taskId &&
        descriptor.role === binding.role &&
        equalArrays(descriptor.allowedTools, binding.allowedTools) &&
        descriptor.writeOwner === binding.writeOwner &&
        descriptor.requestedModel.alias === binding.requestedModelAlias &&
        descriptor.requestedModel.source === binding.requestedModelSource,
      'binding-mismatch',
    );
    exact(receipt, RECEIPT_FIELDS);
    checked(receipt.bindingDigest === descriptor.bindingDigest, 'binding-mismatch');
    checked(
      receipt.status === 'complete',
      ['denied', 'timed-out', 'cancelled'].includes(receipt.status) ? receipt.status : 'incomplete',
    );
    checked(receipt.role === descriptor.role, 'role-mismatch');
    checked(receipt.requestedAlias === descriptor.requestedModel.alias, 'model-mismatch');
    checked(receipt.resolvedModel === descriptor.expectedResolvedModel, 'model-mismatch');
    checked(
      receipt.observedModel === receipt.resolvedModel && receipt.observedModel !== 'unknown',
      'unobserved-model',
    );
    reference(receipt.evidenceRef);
    checked(receipt.oracle === 'pass', 'oracle-failed');
    return deepFreeze({ decision: 'compatible-static', liveQualified: false });
  } catch (error) {
    return deepFreeze({ decision: 'blocked', reason: policyReason(error), liveQualified: false });
  }
}

export function assessClaudeStaticExchange({
  binding,
  descriptor,
  packet,
  result,
  currentSnapshot,
} = {}) {
  try {
    validateBinding(binding);
    validateDescriptor(descriptor);
    checked(binding.taskKind === 'review' && binding.role === 'repo_reviewer', 'role-mismatch');
    checked(
      descriptor.bindingDigest === binding.bindingDigest &&
        descriptor.taskId === binding.taskId &&
        descriptor.role === binding.role &&
        descriptor.writeOwner === binding.writeOwner &&
        equalArrays(descriptor.allowedTools, binding.allowedTools) &&
        descriptor.requestedModel.alias === binding.requestedModelAlias &&
        descriptor.requestedModel.source === binding.requestedModelSource,
      'binding-mismatch',
    );
    checked(
      packet?.packetId === binding.taskId &&
        packet?.objective === binding.requestSummary &&
        hash(packet?.snapshot) === binding.sourceDigest &&
        packet?.intent?.modelIntent === 'independent-read-only-reviewer',
      'handoff-mismatch',
    );
    checked(
      result?.identity?.requestedModelIntent === packet.intent.modelIntent &&
        result?.identity?.resolvedModel === 'unknown' &&
        result?.identity?.observedModel === 'unknown' &&
        result?.verdict === 'BLOCKED',
      'handoff-mismatch',
    );
    const neutral = validateCrossModelExchange({ packet, result, currentSnapshot });
    checked(neutral.decision === 'accept', 'invalid-handoff');
    return deepFreeze({ decision: 'accept-static-blocked', liveQualified: false });
  } catch (error) {
    return deepFreeze({ decision: 'refuse', reason: policyReason(error), liveQualified: false });
  }
}

function validateTask(task) {
  require(['extract', 'read', 'build', 'review'].includes(task.kind));
  require(['low', 'medium', 'high'].includes(task.impactRisk));
  require(['bounded', 'complex'].includes(task.complexity));
  require(['resolved', 'uncertain'].includes(task.uncertainty));
  require(Object.hasOwn(ROLE_TOOLS, task.role));
  exactStringArray(task.allowedTools);
  require(equalArrays(task.allowedTools, ROLE_TOOLS[task.role]));
  safePaths(task.readScope, true);
  safePaths(task.writeScope, false);
  require(
    task.writeOwner === null || (typeof task.writeOwner === 'string' && ID.test(task.writeOwner)),
  );
  require(text(task.childValue));
  require(typeof task.independent === 'boolean');
  exactStringArray(task.knownGaps);
  require(Array.isArray(task.facts) && task.facts.length > 0);
  const keys = new Set();
  for (const fact of task.facts) {
    exact(fact, FACT_FIELDS);
    require(typeof fact.key === 'string' && ID.test(fact.key) && !keys.has(fact.key));
    keys.add(fact.key);
    reference(fact.sourceRef);
    require(fact.confidence === 'high');
  }
}

function eligibilityReasons(profile, task) {
  const reasons = [];
  const writing = Array.isArray(task.writeScope) && task.writeScope.length > 0;
  const independentReadOnlyReview =
    task.kind === 'review' &&
    task.role === 'repo_reviewer' &&
    task.independent === true &&
    !writing &&
    task.writeOwner === null;
  if (!profile.kinds.includes(task.kind)) reasons.push('kind');
  if (!profile.impactRisks.includes(task.impactRisk)) reasons.push('impact-risk');
  if (!profile.complexities.includes(task.complexity)) reasons.push('complexity');
  if (profile.id !== 'complex-critical' && task.uncertainty !== 'resolved') {
    reasons.push('uncertainty');
  }
  if (
    profile.id === 'complex-critical' &&
    !independentReadOnlyReview &&
    task.impactRisk !== 'high' &&
    task.complexity !== 'complex' &&
    task.uncertainty !== 'uncertain'
  ) {
    reasons.push('critical-signal');
  }
  if (!profile.roles.includes(task.role)) reasons.push('role');
  if (!rolesForKind(task.kind).includes(task.role)) reasons.push('kind-role');
  if (!toolsWithin(task.allowedTools, profile.allowedTools)) reasons.push('tools');
  const factKeys = new Set(task.facts.map(({ key }) => key));
  if (requiredFactsFor(profile, task.kind).some((key) => !factKeys.has(key))) {
    reasons.push('required-facts');
  }
  if (task.childValue === 'none') reasons.push('child-value');
  if (task.independent !== true) reasons.push('independence');
  if (!Array.isArray(task.knownGaps) || task.knownGaps.length > 0) reasons.push('known-gaps');

  if (task.kind === 'build' && (!writing || !task.writeOwner || task.role !== 'repo_executor')) {
    reasons.push('write-owner');
  }
  if (task.kind !== 'build' && (writing || task.writeOwner !== null)) reasons.push('read-only');
  if (profile.readOnly && writing) reasons.push('profile-read-only');
  return reasons;
}

function envelopeReasons(envelope, task) {
  const reasons = [];
  const actionForIntent = {
    answer: 'answer',
    analyze: 'produce-analysis',
    plan: 'produce-plan',
    implement: 'mutate',
    review: 'produce-analysis',
    debug: 'mutate',
    unknown: 'inspect',
  };
  if (
    !Object.hasOwn(actionForIntent, envelope.intent) ||
    envelope.authorizedAction !== actionForIntent[envelope.intent] ||
    !['direct', 'sequential', 'clarify', 'oq-handoff', 'bounded-lanes'].includes(
      envelope.recommendedPath,
    )
  ) {
    reasons.push('invalid-intake');
  }
  if (
    ['unknown', 'answer'].includes(envelope.intent) ||
    ['clarify', 'oq-handoff', 'direct'].includes(envelope.recommendedPath)
  ) {
    reasons.push('intake-not-child-ready');
  }
  if (
    task.kind === 'build' &&
    (envelope.authorizedAction !== 'mutate' || !['implement', 'debug'].includes(envelope.intent))
  ) {
    reasons.push('mutation-not-authorized');
  }
  if (task.kind === 'review' && !['review', 'implement', 'debug'].includes(envelope.intent)) {
    reasons.push('review-not-authorized');
  }
  const riskRank = { low: 0, medium: 1, high: 2 };
  if (
    !Object.hasOwn(riskRank, envelope.risk) ||
    riskRank[task.impactRisk] < riskRank[envelope.risk]
  ) {
    reasons.push('risk-downgrade');
  }
  return reasons;
}

function rolesForKind(kind) {
  return (
    {
      extract: ['repo_explorer'],
      read: ['repo_explorer', 'repo_researcher'],
      build: ['repo_executor'],
      review: ['repo_reviewer'],
    }[kind] ?? []
  );
}

function requiredFactsFor(profile, kind) {
  if (kind === 'extract') {
    return [
      'source-bound',
      'fixed-input',
      'single-step',
      'output-schema',
      'acceptance',
      'independent-check',
    ];
  }
  const required = [...profile.requiredFacts];
  if (kind === 'build') required.push('regression', 'one-writer');
  if (kind === 'review') required.push('fresh-context');
  return required;
}

function validateBinding(binding) {
  exact(binding, BINDING_FIELDS);
  digest(binding.bindingDigest);
  const { bindingDigest, ...data } = binding;
  require(hash(data) === bindingDigest);
  require(binding.policyRevision === POLICY_REVISION && binding.schemaVersion === 1);
  digest(binding.envelopeDigest);
  require(PROFILE_BY_ID.get(binding.profileId)?.modelAlias === binding.requestedModelAlias);
  require(binding.requestedModelSource === `profile:${binding.profileId}`);
  require(binding.selectedBy === 'lead');
  reference(binding.selectionBasisRef);
  identifier(binding.requestId);
  require(text(binding.requestSummary));
  identifier(binding.taskId);
  require(Object.hasOwn(ROLE_TOOLS, binding.role));
  exactStringArray(binding.allowedTools);
  require(equalArrays(binding.allowedTools, ROLE_TOOLS[binding.role]));
  safePaths(binding.readScope, true);
  safePaths(binding.writeScope, false);
  require(
    binding.writeOwner === null ||
      (typeof binding.writeOwner === 'string' && ID.test(binding.writeOwner)),
  );
  require(text(binding.childValue));
  require(typeof binding.independent === 'boolean');
  exactStringArray(binding.knownGaps);
  require(
    hash({
      role: binding.role,
      allowedTools: binding.allowedTools,
      readScope: binding.readScope,
      writeScope: binding.writeScope,
      writeOwner: binding.writeOwner,
    }) === binding.scopeDigest,
  );
  require(Array.isArray(binding.taskFacts) && binding.taskFacts.length > 0);
  for (const fact of binding.taskFacts) {
    exact(fact, FACT_FIELDS);
    require(typeof fact.key === 'string' && ID.test(fact.key));
    reference(fact.sourceRef);
    require(fact.confidence === 'high');
  }
  digest(binding.sourceDigest);
  digest(binding.configDigest);
  digest(binding.scopeDigest);
  validInterval(binding.issuedAt, binding.expiresAt);
  const profile = PROFILE_BY_ID.get(binding.profileId);
  require(
    envelopeReasons(
      {
        intent: binding.envelopeIntent,
        authorizedAction: binding.envelopeAction,
        risk: binding.envelopeRisk,
        recommendedPath: binding.envelopePath,
      },
      { kind: binding.taskKind, impactRisk: binding.impactRisk },
    ).length === 0,
  );
  require(
    eligibilityReasons(profile, {
      kind: binding.taskKind,
      impactRisk: binding.impactRisk,
      complexity: binding.complexity,
      uncertainty: binding.uncertainty,
      role: binding.role,
      allowedTools: binding.allowedTools,
      readScope: binding.readScope,
      writeScope: binding.writeScope,
      writeOwner: binding.writeOwner,
      childValue: binding.childValue,
      independent: binding.independent,
      knownGaps: binding.knownGaps,
      facts: binding.taskFacts,
    }).length === 0,
  );
}

function validateDescriptor(descriptor) {
  exact(descriptor, DESCRIPTOR_FIELDS);
  exact(descriptor.requestedModel, ['alias', 'source']);
  require(descriptor.schemaVersion === 1);
  identifier(descriptor.taskId);
  require(Object.hasOwn(ROLE_TOOLS, descriptor.role));
  exactStringArray(descriptor.allowedTools);
  require(equalArrays(descriptor.allowedTools, ROLE_TOOLS[descriptor.role]));
  require(
    descriptor.writeOwner === null ||
      (typeof descriptor.writeOwner === 'string' && ID.test(descriptor.writeOwner)),
  );
  const profile = PROFILES.find(({ modelAlias }) => modelAlias === descriptor.requestedModel.alias);
  require(profile && descriptor.requestedModel.source === `profile:${profile.id}`);
  require(descriptor.host === 'claude-code' && descriptor.transport === 'native-subagent');
  require(descriptor.dispatchAllowed === false && descriptor.applied === false);
  require(descriptor.runtimeQualification === 'not-run');
  digest(descriptor.bindingDigest);
  require(modelIdentityMatches(descriptor.requestedModel.alias, descriptor.expectedResolvedModel));
  reference(descriptor.evidenceRef);
}

function validateWriterInventory(inventory) {
  exact(inventory, ['status', 'evidenceRef', 'active']);
  checked(inventory.status === 'current-turn', 'writer-state-unknown');
  reference(inventory.evidenceRef);
  require(Array.isArray(inventory.active));
  for (const writer of inventory.active) {
    exact(writer, ['owner', 'writeScope']);
    identifier(writer.owner);
    safePaths(writer.writeScope, true);
  }
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function checked(condition, reason) {
  if (!condition)
    throw Object.assign(new TypeError('Claude policy refusal.'), { policyReason: reason });
}

function policyReason(error) {
  return error?.policyReason ?? 'invalid-input';
}

function assertEnvelope(envelope) {
  const result = validateTaskEnvelope(envelope);
  require(result.valid);
}

function exact(value, fields) {
  require(value && Object.getPrototypeOf(value) === Object.prototype);
  require(Reflect.ownKeys(value).length === fields.length);
  require(fields.every((field) => Object.hasOwn(value, field)));
}

function exactStringArray(value) {
  require(Array.isArray(value) && new Set(value).size === value.length);
  require(value.every((item) => text(item)));
}

function safePaths(value, nonEmpty) {
  exactStringArray(value);
  if (nonEmpty) require(value.length > 0);
  require(
    value.every(
      (item) =>
        !item.startsWith('/') &&
        !item.endsWith('/') &&
        item.split('/').every((segment) => /^(?!\.{1,2}$)[a-zA-Z0-9._-]+$/u.test(segment)),
    ),
  );
}

function toolsWithin(actual, allowed) {
  return Array.isArray(actual) && actual.every((tool) => allowed.includes(tool));
}

function equalArrays(a, b) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function validInterval(start, end) {
  const startMs = timestamp(start);
  const endMs = timestamp(end);
  require(startMs < endMs);
  require(endMs - startMs <= 30 * 60 * 1000);
}

function within(value, start, end) {
  const time = timestamp(value);
  return time >= timestamp(start) && time <= timestamp(end);
}

function timestamp(value) {
  require(typeof value === 'string' && ISO_UTC.test(value));
  const time = Date.parse(value);
  require(Number.isFinite(time) && new Date(time).toISOString() === value);
  return time;
}

function identifier(value) {
  require(typeof value === 'string' && ID.test(value));
}

function digest(value) {
  require(typeof value === 'string' && DIGEST.test(value));
}

function reference(value) {
  require(
    typeof value === 'string' &&
      SAFE_REF.test(value) &&
      !value.includes('//') &&
      value.split('/').every((segment) => segment !== '.' && segment !== '..'),
  );
}

function modelIdentityMatches(alias, identity) {
  return (
    typeof identity === 'string' &&
    EXACT_MODEL_ID.test(identity) &&
    identity.startsWith(`claude-${alias}-`)
  );
}

function text(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 300;
}

function require(condition) {
  if (!condition) throw new TypeError('Claude subagent policy input is invalid.');
}

function hash(value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function deepFreeze(value) {
  for (const child of Object.values(value ?? {})) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  }
  return Object.freeze(value);
}
