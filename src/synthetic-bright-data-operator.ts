// Internal synthetic-only operator path. No HTTP transport is provided here.
import { DurableState, readOnlyCheckpointSnapshot, type ProviderBinding } from './durable-state.js';
import { runSyntheticBrightData } from './durable-bright-data-submission.js';
import type { SyntheticTransport, HandoffBounds } from './bright-data-handoff.js';
import { validateOperatorConfig, projectOperatorStatus, type OperatorRunResult } from './operator.js';
import { createTraversal, type TraversalLimits } from './traversal.js';
import type { GeometryInput } from './index.js';

type Bounds = HandoffBounds & { maxObservations: number; observationDeadline: number };
type Transport = SyntheticTransport & { retrieve(id: string): Promise<{ status: number; body: unknown }> };
type Common = { checkpoint: string; geometry: GeometryInput; binding: ProviderBinding; bounds: Bounds };
type Start = Common & { limits: TraversalLimits };
type Resume = Common & { limits?: Partial<TraversalLimits> };

export async function runSyntheticOperator(command: 'start' | 'resume', options: Start | Resume, transport: Transport): Promise<OperatorRunResult> {
  if (command === 'start') {
    const start = options as Start;
    validateOperatorConfig({ geometry: start.geometry, limits: start.limits });
    DurableState.createBound(start.checkpoint, start.binding, createTraversal(start.geometry, start.limits));
  } else {
    const snapshot = readOnlyCheckpointSnapshot(options.checkpoint).traversal;
    validateOperatorConfig({ geometry: options.geometry, limits: snapshot.limits });
    const normalized = createTraversal(options.geometry, snapshot.limits).geometry;
    if (JSON.stringify(normalized) !== JSON.stringify(snapshot.geometry)) throw new Error('Checkpoint geometry mismatch');
  }
  const state = DurableState.openBound(options.checkpoint, options.binding);
  try {
    const current = state.readTraversal();
    const requested = command === 'resume' ? (options as Resume).limits ?? {} : {};
    if (typeof requested !== 'object' || requested === null || Array.isArray(requested)) throw new Error('Invalid resume limits');
    for (const key of Object.keys(requested)) {
      if (!['cells', 'submissions', 'activeTime'].includes(key)) throw new Error('Invalid resume limit name');
      const name = key as keyof TraversalLimits;
      const value = requested[name];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= current.limits[name]) throw new Error(`Resume ${key} limit must strictly increase`);
    }
    if (Object.keys(requested).length) {
      const limits = { ...current.limits, ...requested };
      validateOperatorConfig({ geometry: current.geometry, limits });
      state.writeTraversal({ ...current, limits });
    }
    await runSyntheticBrightData(state, transport, options.bounds);
    state.releaseOwner();
    return { version: 1, command, status: projectOperatorStatus(state.readTraversalSnapshot()) };
  } finally { state.close(); }
}
