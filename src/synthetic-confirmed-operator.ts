// Internal test orchestration only. Neither this confirmation nor its transport authorizes HTTP.
import { DurableState, type ProviderBinding } from './durable-state.js';
import { previewProviderInvocation, previewProviderResume, type ProviderPreview } from './provider-preview.js';
import { runSyntheticBrightData } from './durable-bright-data-submission.js';
import type { SyntheticTransport, HandoffBounds } from './bright-data-handoff.js';
import { projectOperatorStatus } from './operator.js';
import { createTraversal, type TraversalLimits } from './traversal.js';
import type { GeometryInput } from './index.js';

type Transport = SyntheticTransport & { retrieve(id: string): Promise<{ status: number; body: unknown }> };
type Options = { checkpoint: string; binding: ProviderBinding; geometry?: GeometryInput; limits?: Partial<TraversalLimits>; bounds: HandoffBounds & { maxObservations: number; observationDeadline: number }; account: string; dataset: string; evidence: unknown; estimate: unknown };
type Preview = Extract<ProviderPreview, { kind: 'preview' }>;

export async function runConfirmedSyntheticOperator(command: 'start' | 'resume', input: Options, affirm: (preview: Preview) => Promise<boolean>, transport: Transport) {
  // Capture all inputs before displaying anything; the callback cannot change what is run.
  const options = structuredClone(input);
  const resume = command === 'resume' ? previewProviderResume(options.checkpoint, options.limits) : undefined;
  const binding = resume?.binding ?? options.binding;
  if (JSON.stringify(binding) !== JSON.stringify(options.binding)) throw new Error('Checkpoint binding mismatch');
  const geometry = resume?.geometry ?? options.geometry;
  const limits = resume?.limits ?? options.limits;
  const invocation = { operation: command, query: { keyword: binding.keyword, country: binding.country }, geometry, limits, account: options.account, dataset: options.dataset };
  const preview = previewProviderInvocation({ invocation, evidence: options.evidence, estimate: options.estimate });
  if (preview.kind === 'blocked') throw new Error(preview.reason);
  if (await affirm(structuredClone(preview)) !== true) throw new Error('Synthetic confirmation declined');
  // Revalidate current evidence immediately before any checkpoint mutation.
  const checked = previewProviderInvocation({ invocation, evidence: options.evidence, estimate: options.estimate });
  if (checked.kind === 'blocked') throw new Error(checked.reason);
  if (command === 'start') DurableState.createBound(options.checkpoint, binding, createTraversal(preview.invocation.geometry, preview.invocation.limits));
  const state = resume
    ? DurableState.openProviderGuarded(options.checkpoint, binding, options.limits ?? {}, resume.fingerprint)
    : DurableState.openBound(options.checkpoint, binding);
  try {
    if (resume && Object.keys(options.limits ?? {}).length) state.writeTraversal({ ...state.readTraversal(), limits: preview.invocation.limits });
    await runSyntheticBrightData(state, transport, options.bounds);
    state.releaseOwner();
    return { version: 1 as const, command, status: projectOperatorStatus(state.readTraversalSnapshot()) };
  } finally { state.close(); }
}
