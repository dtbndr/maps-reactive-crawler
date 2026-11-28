import { readOnlyCheckpointSnapshot } from './durable-state.js';
import { projectOperatorStatus, type OperatorStatus } from './operator.js';
import type { CandidateObservation, DetailWork } from './traversal.js';

type DetailState = Exclude<DetailWork['status'], 'pending'> | 'not_attempted' | 'unknown';
type Occurrence = {
  candidateId: string; name: string | null; coordinate: CandidateObservation['coordinate'];
  classification: CandidateObservation['classification']; fieldStatus: { name: 'present' | 'not_present'; coordinate: 'present' | 'not_present' };
  detailState: DetailState; sourceCell: string; workId: string; attemptId: string; observationId: string; occurrence: number;
};
type V2Export = { version: 2; status: OperatorStatus; verifiedPlaces: { canonicalKey: string; observations: Occurrence[] }[]; unverifiedObservations: Occurrence[] };
const lexical = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export function projectV2Checkpoint(options: { checkpoint: string }): V2Export {
  const snapshot = readOnlyCheckpointSnapshot(options.checkpoint);
  const state = snapshot.traversal;
  const details = new Map<string, DetailState>();
  for (const work of state.detailWork ?? []) for (const id of work.observationIds) details.set(id, work.status === 'pending' ? 'not_attempted' : work.status);
  const groups = new Map<string, Occurrence[]>();
  const unverifiedObservations: Occurrence[] = [];
  const candidates = [...state.candidates].sort((a, b) => lexical(a.observationId, b.observationId));
  for (const candidate of candidates) {
    const attempt = state.attempts.find(item => item.id === candidate.attemptId);
    if (!attempt) throw new Error('Corrupt traversal checkpoint: occurrence attempt is missing');
    const detailState = state.detailWork === undefined ? 'unknown' : details.get(candidate.observationId);
    if (!detailState) throw new Error('Corrupt traversal checkpoint: occurrence detail work is missing');
    const occurrence: Occurrence = {
      candidateId: candidate.id, name: candidate.name ?? null, coordinate: candidate.coordinate ?? null, classification: candidate.classification,
      fieldStatus: { name: candidate.name == null ? 'not_present' : 'present', coordinate: candidate.coordinate == null ? 'not_present' : 'present' },
      detailState, sourceCell: candidate.sourceCell, workId: attempt.workId, attemptId: candidate.attemptId, observationId: candidate.observationId, occurrence: candidate.occurrence,
    };
    if (candidate.verifiedCanonicalKey) {
      const group = groups.get(candidate.verifiedCanonicalKey) ?? [];
      group.push(occurrence); groups.set(candidate.verifiedCanonicalKey, group);
    } else unverifiedObservations.push(occurrence);
  }
  return { version: 2, status: projectOperatorStatus(state, { pid: snapshot.ownerPid, alive: snapshot.ownerAlive }), verifiedPlaces: [...groups].sort(([a], [b]) => lexical(a, b)).map(([canonicalKey, observations]) => ({ canonicalKey, observations })), unverifiedObservations };
}
