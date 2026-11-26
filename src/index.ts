export const EARTH_RADIUS_METERS = 6_371_008.8;
export type Coordinate = { latitude: number; longitude: number };
export type Area = { type: 'bbox'; south: number; north: number; west: number; east: number } | { type: 'radius'; radius: number };
export type GeometryInput = { seed: Coordinate; spacing: number; area: Area };
export type Geometry = GeometryInput;
export type CandidateClass = 'inside' | 'outside' | 'unverified';

const finiteCoordinate = (p: Coordinate): boolean => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && p.latitude >= -90 && p.latitude <= 90 && p.longitude >= -180 && p.longitude <= 180;
const radians = (degrees: number): number => degrees * Math.PI / 180;

export function validateGeometry(input: GeometryInput): Geometry {
  const { seed, spacing, area } = input;
  if (!seed || !finiteCoordinate(seed) || Math.abs(seed.latitude) === 90) throw new Error('Invalid seed coordinate');
  if (!Number.isFinite(spacing) || spacing <= 0) throw new Error('Invalid spacing');
  if (area.type === 'bbox') {
    const { south, north, west, east } = area;
    if (![south,north,west,east].every(Number.isFinite) || south < -90 || north > 90 || west <= -180 || east >= 180 || south >= north || west >= east || south <= -90 || north >= 90) throw new Error('Invalid or unsupported bbox');
    if (seed.latitude < south || seed.latitude > north || seed.longitude < west || seed.longitude > east) throw new Error('Seed outside bbox');
  } else if (area.type === 'radius') {
    if (!Number.isFinite(area.radius) || area.radius <= 0) throw new Error('Invalid radius');
    const phi = radians(seed.latitude), lambda = radians(seed.longitude), delta = area.radius / EARTH_RADIUS_METERS;
    if (![phi,lambda,delta].every(Number.isFinite)) throw new Error('Nonfinite radius geometry');
    if (delta >= Math.PI / 2 - Math.abs(phi)) throw new Error('Radius reaches a pole');
    const ratio = Math.sin(delta) / Math.cos(phi);
    const longitudeReach = Math.asin(ratio);
    if (!Number.isFinite(ratio) || !Number.isFinite(longitudeReach) || longitudeReach >= Math.PI - Math.abs(lambda)) throw new Error('Radius reaches longitude seam');
  } else throw new Error('Invalid area');
  return input;
}

export function cellCenter(geometry: Geometry, column: number, row: number): Coordinate {
  if (!Number.isInteger(column) || !Number.isInteger(row)) throw new Error('Cell identity must use integer indices');
  const { seed, spacing } = geometry;
  const latitude = seed.latitude + row * spacing / EARTH_RADIUS_METERS * 180 / Math.PI;
  const longitude = seed.longitude + column * spacing / (EARTH_RADIUS_METERS * Math.cos(radians(seed.latitude))) * 180 / Math.PI;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error('Cell center outside supported coordinates');
  return { latitude, longitude };
}

export function cellKey(column: number, row: number): string {
  if (!Number.isInteger(column) || !Number.isInteger(row)) throw new Error('Cell identity must use integer indices');
  return `${column},${row}`;
}

export function isCellEligible(geometry: Geometry, column: number, row: number): boolean {
  let point: Coordinate;
  try {
    point = cellCenter(geometry, column, row);
  } catch {
    return false;
  }
  const area = geometry.area;
  if (area.type === 'bbox') return point.latitude >= area.south && point.latitude <= area.north && point.longitude >= area.west && point.longitude <= area.east;
  return haversineDistance(geometry.seed, point) <= area.radius;
}

export function haversineDistance(a: Coordinate, b: Coordinate): number {
  const p1 = radians(a.latitude), p2 = radians(b.latitude), dp = p2 - p1, dl = radians(b.longitude - a.longitude);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function classifyCandidate(geometry: Geometry, candidate: Coordinate | null | undefined): CandidateClass {
  if (!candidate || !finiteCoordinate(candidate)) return 'unverified';
  const area = geometry.area;
  if (area.type === 'bbox') return candidate.latitude >= area.south && candidate.latitude <= area.north && candidate.longitude >= area.west && candidate.longitude <= area.east ? 'inside' : 'outside';
  return haversineDistance(geometry.seed, candidate) <= area.radius ? 'inside' : 'outside';
}

export function neighbors(_geometry: Geometry, column: number, row: number): [number, number][] {
  if (!Number.isInteger(column) || !Number.isInteger(row)) throw new Error('Cell identity must use integer indices');
  return [[column,row+1],[column,row-1],[column+1,row],[column-1,row]];
}

export { validateOperatorConfig, parseSyntheticFixture, start, resume } from './operator.js';
export type { OperatorConfig, SyntheticFixture, ParsedSyntheticFixture, OperatorRunResult, OperatorStartOptions, OperatorResumeOptions } from './operator.js';
export { createTraversal, admitNextCell, applyDiscoveryResult, reserveSubmission, dispatchSubmission, debitActiveTime, markUncertain, observeKnownId, cancelTraversal, reportTraversal, skipAttempt, authorizeResend, retryKnownIdObservation, pauseTraversal, resumeTraversal, updateTraversalLimits } from './traversal.js';
export type { TraversalState, DiscoveryResult, CellOutcome, CandidateObservation, TraversalReport } from './traversal.js';
