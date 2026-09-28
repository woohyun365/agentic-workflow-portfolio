const CONTEXT_REQUIRED_FIELDS = [
  'schemaVersion',
  'taskSlug',
  'objective',
  'latestUserRequest',
  'branch',
  'head',
  'workingTreeSummary',
  'activePlan',
  'currentPhase',
  'planStatus',
  'completed',
  'nextActions',
  'blockers',
  'decisions',
  'rejectedAlternatives',
  'relevantFiles',
  'doNotTouch',
  'verification',
  'knownFailures',
  'createdAt',
  'expiresAt',
];

const PRIORITY_REQUIRED_FIELDS = ['task', 'branch', 'head', 'contextPath', 'nextAction', 'blocker'];

const ARRAY_FIELDS = new Set([
  'completed',
  'nextActions',
  'blockers',
  'decisions',
  'rejectedAlternatives',
  'relevantFiles',
  'doNotTouch',
  'verification',
  'knownFailures',
]);

const FORBIDDEN_KEY_PATTERN =
  /(secret|token|password|rawEnv|transcript|assistantResponse|userPii)/iu;
const CONTEXT_PATH_PATTERN = /^\.omx\/context\/[a-z0-9][a-z0-9-]*-\d{8}T\d{6}Z\.md$/u;

export function parsePriorityPointer(content) {
  if (content == null || (typeof content === 'string' && !content.trim()))
    return { exists: false, valid: true, value: null, errors: [] };
  if (typeof content !== 'string')
    return { exists: true, valid: false, value: null, errors: ['priority must be a JSON object'] };

  if (Buffer.byteLength(content) > 500) {
    return { exists: true, valid: false, value: null, errors: ['priority exceeds 500 bytes'] };
  }

  try {
    const value = JSON.parse(content);
    const errors = validateRequiredFields(value, PRIORITY_REQUIRED_FIELDS);
    if (!isObject(value)) return { exists: true, valid: false, value: null, errors };
    for (const field of PRIORITY_REQUIRED_FIELDS.filter((field) => field !== 'blocker')) {
      if (field in value && typeof value[field] !== 'string')
        errors.push(`${field} must be a string`);
    }
    if (value.blocker !== null && typeof value.blocker !== 'string')
      errors.push('blocker must be a string or null');
    if (value.contextPath && !CONTEXT_PATH_PATTERN.test(value.contextPath)) {
      errors.push('contextPath must match .omx/context/<task-slug>-<timestamp>.md');
    }
    collectForbiddenKeys(value, errors);
    return { exists: true, valid: errors.length === 0, value, errors };
  } catch {
    return {
      exists: true,
      valid: false,
      value: null,
      errors: ['priority must be a JSON object'],
    };
  }
}

export function parseContextContract(markdown, now = new Date()) {
  const match = typeof markdown === 'string' && markdown.match(/```json\s*([\s\S]*?)```/u);
  if (!match) {
    return { valid: false, value: null, errors: ['context must contain one JSON contract block'] };
  }

  try {
    return validateContextContract(JSON.parse(match[1]), now);
  } catch {
    return { valid: false, value: null, errors: ['context JSON contract is invalid'] };
  }
}

export function validateContextContract(value, now = new Date()) {
  const errors = validateRequiredFields(value, CONTEXT_REQUIRED_FIELDS);
  if (!isObject(value)) return { valid: false, value: null, errors };

  for (const field of CONTEXT_REQUIRED_FIELDS) {
    if (ARRAY_FIELDS.has(field) || field === 'schemaVersion' || field === 'workingTreeSummary')
      continue;
    if (field in value && typeof value[field] !== 'string')
      errors.push(`${field} must be a string`);
  }
  if (
    'workingTreeSummary' in value &&
    !Array.isArray(value.workingTreeSummary) &&
    typeof value.workingTreeSummary !== 'string'
  ) {
    errors.push('workingTreeSummary must be an array or string');
  }

  for (const field of ARRAY_FIELDS) {
    if (field in value && !Array.isArray(value[field])) errors.push(`${field} must be an array`);
  }

  if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (
    typeof value.taskSlug === 'string' &&
    value.taskSlug &&
    !/^[a-z0-9][a-z0-9-]*$/u.test(value.taskSlug)
  ) {
    errors.push('taskSlug must use kebab-case');
  }
  if (typeof value.head === 'string' && value.head && !/^[0-9a-f]{7,40}$/u.test(value.head))
    errors.push('head must be a git SHA');
  if (
    typeof value.createdAt === 'string' &&
    value.createdAt &&
    Number.isNaN(Date.parse(value.createdAt))
  ) {
    errors.push('createdAt must be an ISO timestamp');
  }
  if (
    typeof value.expiresAt === 'string' &&
    value.expiresAt &&
    value.expiresAt !== 'on-phase-completion'
  ) {
    const expiry = Date.parse(value.expiresAt);
    if (Number.isNaN(expiry))
      errors.push('expiresAt must be an ISO timestamp or on-phase-completion');
    else if (expiry <= now.getTime()) errors.push('context contract is expired');
  }

  collectForbiddenKeys(value, errors);
  return { valid: errors.length === 0, value, errors };
}

function validateRequiredFields(value, fields) {
  if (!isObject(value)) return ['contract must be an object'];
  return fields.filter((field) => !(field in value)).map((field) => `missing field: ${field}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectForbiddenKeys(value, errors, path = '') {
  if (!value || typeof value !== 'object') return;

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEY_PATTERN.test(key)) errors.push(`forbidden field: ${nestedPath}`);
    collectForbiddenKeys(nestedValue, errors, nestedPath);
  }
}
