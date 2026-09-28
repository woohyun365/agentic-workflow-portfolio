import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import {
  validateCrossModelPacket,
  validateCrossModelResult,
} from '../common/cross-model-handoff.mjs';

const FAKE_CLI = resolve(import.meta.dirname, '../../ci/fixtures/cross-host-review-fake-cli.mjs');
const FIXTURE_CASES = new Set([
  'complete',
  'error',
  'malformed',
  'multi',
  'oversize',
  'partial',
  'stale',
  'secret',
  'wrong-model',
  'wrong-dispatch',
  'env',
  'early-close',
  'hang',
]);
const MAX_OUTPUT_BYTES = 131_072;
const MAX_FAKE_TIMEOUT_MS = 30_000;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function fingerprint(value) {
  const canonical = (input) => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, canonical(input[key])]),
      );
    }
    return input;
  };
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')}`;
}

// This is a static declaration check, not Lead authentication or live host admission.
// This static bridge intentionally has no real-provider spawn path.
export function assessReviewBridgeInvocation(input = {}) {
  const {
    packet,
    currentSnapshot,
    invocationId,
    ownerRequest,
    activeWriterConflict,
    seenInvocationIds,
    binding,
    targetAdmission,
    providerDispatchEnabled = false,
  } = input && typeof input === 'object' ? input : {};
  const errors = [];
  const packetCheck = validateCrossModelPacket(packet, {
    currentSnapshot,
    seenDispatchIds: [],
  });
  errors.push(...packetCheck.errors);
  if (!currentSnapshot || typeof currentSnapshot !== 'object' || Array.isArray(currentSnapshot)) {
    errors.push('current-snapshot-required');
  }
  if (packet?.lifecycle?.transport !== 'cli') errors.push('transport-not-cli');
  if (!['unknown', 'supported'].includes(packet?.lifecycle?.support)) {
    errors.push('transport-unsupported');
  }
  if (typeof invocationId !== 'string' || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(invocationId)) {
    errors.push('invalid-invocation-id');
  }
  if (!Array.isArray(seenInvocationIds)) {
    errors.push('seen-invocation-state-required');
  } else if (seenInvocationIds.includes(invocationId)) {
    errors.push('duplicate-invocation');
  }
  if (
    ownerRequest?.approved !== true ||
    ownerRequest?.lead !== packet?.authority?.integrationOwner ||
    ownerRequest?.reviewerMode !== 'read-only'
  ) {
    errors.push('lead-request-not-declared');
  }
  if (activeWriterConflict !== false) errors.push('writer-conflict');
  if (providerDispatchEnabled !== false) errors.push('provider-dispatch-disabled');
  const admitted = targetAdmission?.admission ?? targetAdmission;
  if (
    targetAdmission?.valid !== true ||
    admitted?.decision !== 'candidate' ||
    targetAdmission.dispatchAllowed === true ||
    admitted?.executed === true
  ) {
    errors.push('target-host-admission-missing');
  }
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    errors.push('binding-absent');
  } else {
    for (const [key, expected] of [
      ['schemaVersion', 'cross-host-review-binding/v1'],
      ['transport', 'direct-cli'],
      ['packetId', packet?.packetId],
      ['dispatchId', packet?.lifecycle?.dispatchId],
      ['invocationId', invocationId],
      ['sandbox', 'read-only'],
      ['fallback', 'none'],
      ['applied', false],
      ['runtimeQualification', 'not-run'],
    ]) {
      if (binding[key] !== expected) errors.push(`binding-${key}-mismatch`);
    }
    if (!['codex', 'claude'].includes(binding.host)) errors.push('binding-host-invalid');
    const { bindingDigest, ...bindingData } = binding;
    if (bindingDigest !== fingerprint(bindingData)) errors.push('binding-digest-mismatch');
    if (binding.packetDigest !== fingerprint(packet)) errors.push('binding-packet-digest-mismatch');
    if (
      admitted?.bindingDigest !== bindingDigest ||
      admitted?.invocationId !== invocationId ||
      admitted?.host !== binding.host
    ) {
      errors.push('target-admission-binding-mismatch');
    }
    if (
      binding.role !== (binding.host === 'claude' ? 'repo_reviewer' : 'top-level-read-only-reviewer')
    ) {
      errors.push('binding-role-invalid');
    }
    if (binding.host === 'codex' && binding.projectRoleClaim !== 'unqualified') {
      errors.push('codex-native-role-claim-unqualified');
    }
    if (binding.host === 'claude' && binding.restrictedProjectAgentLoading !== 'unresolved') {
      errors.push('claude-project-role-loading-unproven');
    }
    if (binding.authRoute !== 'local-subscription') errors.push('binding-auth-route-invalid');
    if (
      (binding.host === 'claude' && !Array.isArray(binding.mcpServers)) ||
      (binding.mcpServers !== undefined &&
        (!Array.isArray(binding.mcpServers) || binding.mcpServers.length !== 0))
    ) {
      errors.push('binding-mcp-scope-invalid');
    }
    const expectedTools =
      binding.host === 'claude'
        ? ['Read', 'Grep', 'Glob']
        : ['repository-read', 'test-result-read'];
    if (
      !Array.isArray(binding.allowedTools) ||
      binding.allowedTools.length !== expectedTools.length ||
      binding.allowedTools.some((tool, index) => tool !== expectedTools[index])
    ) {
      errors.push('binding-tool-scope-invalid');
    }
    if (
      typeof binding.requestedModel !== 'string' ||
      !binding.requestedModel.trim() ||
      binding.requestedModel === 'unknown'
    ) {
      errors.push('binding-model-unknown');
    }
    if (binding.expectedResolvedModel !== 'unknown')
      errors.push('binding-resolved-identity-unproven');
    for (const key of ['sourceDigest', 'configDigest', 'roleDigest']) {
      if (!DIGEST.test(binding[key] ?? '')) errors.push(`binding-${key}-invalid`);
    }
  }
  const decision = errors.length ? 'refuse' : 'candidate';
  return Object.freeze({
    decision,
    errors: Object.freeze(errors),
    executed: false,
    dispatchAllowed: false,
    invocation:
      decision === 'candidate'
        ? Object.freeze({
            invocationId,
            packetId: packet.packetId,
            dispatchId: packet.lifecycle.dispatchId,
            packetDigest: fingerprint(packet),
            host: binding.host,
            applied: false,
            runtimeQualification: 'not-run',
          })
        : null,
  });
}

function receipt(
  status,
  { executed = false, invocationId = null, cleanup = 'not-started', result = null } = {},
) {
  return Object.freeze({ status, executed, providerInvoked: false, invocationId, cleanup, result });
}

// Only the checked-in fake executable is reachable. Real CLI commands are descriptive
// host artifacts for authorized live qualification; no option or environment flag enables them here.
export async function runFakeReviewProcess(input = {}) {
  const {
    admission,
    packet,
    fixtureCase,
    timeoutMs = 2000,
    signal,
  } = input && typeof input === 'object' ? input : {};
  if (
    admission?.decision !== 'candidate' ||
    admission?.dispatchAllowed !== false ||
    !admission.invocation
  ) {
    return receipt('refused');
  }
  if (
    !FIXTURE_CASES.has(fixtureCase) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_FAKE_TIMEOUT_MS ||
    (signal !== undefined &&
      (signal === null ||
        typeof signal.aborted !== 'boolean' ||
        typeof signal.addEventListener !== 'function' ||
        typeof signal.removeEventListener !== 'function')) ||
    signal?.aborted
  ) {
    return receipt('refused', { invocationId: admission.invocation.invocationId });
  }
  if (
    packet?.packetId !== admission.invocation.packetId ||
    packet?.lifecycle?.dispatchId !== admission.invocation.dispatchId ||
    fingerprint(packet) !== admission.invocation.packetDigest
  ) {
    return receipt('refused', { invocationId: admission.invocation.invocationId });
  }
  const packetCheck = validateCrossModelPacket(packet, { currentSnapshot: packet.snapshot });
  if (!packetCheck.valid)
    return receipt('refused', { invocationId: admission.invocation.invocationId });
  const packetJson = JSON.stringify(packet);
  if (Buffer.byteLength(packetJson) > MAX_OUTPUT_BYTES)
    return receipt('refused', { invocationId: admission.invocation.invocationId });

  return await new Promise((resolveReceipt) => {
    const child = spawn(process.execPath, [FAKE_CLI, fixtureCase], {
      cwd: resolve(import.meta.dirname, '../../..'),
      env: {},
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let status = null;
    let stdout = '';
    let outputBytes = 0;
    let closed = false;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolveReceipt(value);
    };
    const stop = (reason) => {
      if (closed || status) return;
      status = reason;
      child.kill('SIGKILL');
    };
    const onAbort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timed-out'), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) stop('cancelled');
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_OUTPUT_BYTES) return stop('output-limit');
        if (stream === child.stdout) stdout += chunk;
      });
    }
    child.stdin.on('error', () => stop('input-error'));
    child.stdin.end(packetJson);
    child.on('error', () => {
      status = 'spawn-error';
    });
    child.on('close', (code) => {
      closed = true;
      const common = {
        executed: true,
        invocationId: admission.invocation.invocationId,
        cleanup: 'exited',
      };
      if (status) return finish(receipt(status, common));
      if (code !== 0) return finish(receipt('provider-error', common));
      if (/ANTHROPIC_API_KEY|OPENAI_API_KEY|sk-[A-Za-z0-9]{12}|Bearer\s/i.test(stdout)) {
        return finish(receipt('malformed', common));
      }
      let envelope;
      try {
        envelope = JSON.parse(stdout);
      } catch {
        return finish(receipt('malformed', common));
      }
      if (
        !envelope ||
        typeof envelope !== 'object' ||
        Array.isArray(envelope) ||
        Object.keys(envelope).sort().join(',') !== 'packetReceived,result,schemaVersion' ||
        envelope.schemaVersion !== 'cross-host-fake-output/v1'
      ) {
        return finish(receipt('malformed', common));
      }
      if (envelope.packetReceived !== true) return finish(receipt('input-error', common));
      const { result } = envelope;
      const validation = validateCrossModelResult(result, {
        packet,
        currentSnapshot: packet.snapshot,
      });
      if (!validation.valid) return finish(receipt('malformed', common));
      if (result.status !== 'complete') return finish(receipt('partial', common));
      return finish(receipt('complete', { ...common, result }));
    });
  });
}
