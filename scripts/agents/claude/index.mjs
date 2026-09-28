// Mode-specific repository wiring, not a claim about a currently running host.
export const CLAUDE_ADAPTER_READINESS = Object.freeze({
  host: 'claude-code',
  admission: 'mode-specific',
  mode: 'interactive-auto',
  enforcement: 'healthy-hook-request-check',
  runtimeSupport: 'per-run-observation-required',
  applied: false,
});

export {
  assessClaudeModelObservation,
  assessClaudeStaticExchange,
  assessClaudeSubagentAdmission,
  createClaudeSubagentBinding,
  evaluateClaudeProfileEligibility,
  listClaudeSubagentProfiles,
} from './model-policy.mjs';

export { runClaudePreflight } from './session-preflight.mjs';
export { prepareClaudeWorkflow, validateClaudeWorkflowResults } from './workflow-entry.mjs';

export {
  prepareClaudeNativeQualification,
  runClaudeNativeQualification,
  decideClaudeNativePermission,
} from './native-qualification.mjs';
export { createClaudeNativeCollector } from './native-run-evidence.mjs';

export {
  registerClaudeNativeTask,
  handleClaudeNativeSessionEvent,
  completeClaudeNativeTask,
} from './native-session.mjs';
