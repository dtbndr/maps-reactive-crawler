export interface DiscoveryBounds {
  radiusMeters?: number;
  boundingBox?: { north: number; south: number; east: number; west: number };
}

export interface DiscoveryLimits {
  cells: number;
  submissions: number;
  activeMilliseconds: number;
}

export interface DiscoveryRequest {
  keyword: string;
  country: string;
  lat: number;
  lon: number;
  bounds: DiscoveryBounds;
  limits: DiscoveryLimits;
}

export interface BrightDataRunReference {
  id: string;
}

export interface BrightDataObservation {
  state: 'starting' | 'running' | 'ready' | 'failed' | 'canceled' | 'unknown';
  records?: unknown[];
}

/** Async transport seam; credentials are intentionally not part of request arguments. */
export interface BrightDataDiscoveryTransport {
  submit(request: DiscoveryRequest): Promise<BrightDataRunReference>;
  observe(runId: string): Promise<BrightDataObservation>;
}

export interface BrightDataDiscoveryOptions {
  apiKey?: string;
  mode?: 'discover' | 'known-id-only';
  evidence?: { submission: boolean; observation: boolean };
  approvals?: { invocation: boolean; pricing: boolean; rights: boolean };
  transport: BrightDataDiscoveryTransport;
}

export type BrightDataDiscoveryResult =
  | { kind: 'unsupported'; reason: string }
  | { kind: 'submitted'; run: BrightDataRunReference }
  | { kind: 'observed'; observation: BrightDataObservation };

/** Strip known credentials and common authorization forms from diagnostics. */
export function sanitizeProviderDiagnostic(value: unknown, credential?: string): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|token|authorization)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(Authorization:\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(credential ? new RegExp(escapeRegExp(credential), 'g') : /$^/, '[REDACTED]');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const unsupportedResult = (reason: string): BrightDataDiscoveryResult => ({ kind: 'unsupported', reason });

/**
 * Exposes typed asynchronous submit/observe contracts while keeping every
 * provider route closed until the terminal production approval gate is complete.
 */
export function createBrightDataDiscoveryAdapter(options: BrightDataDiscoveryOptions) {
  const evidence = options.evidence ?? { submission: false, observation: false };
  const approvals = options.approvals ?? { invocation: false, pricing: false, rights: false };

  function unavailable(operation: 'start' | 'resume'): BrightDataDiscoveryResult {
    if (!options.apiKey) return unsupportedResult('Bright Data API key is not configured');
    if (!approvals.invocation) return unsupportedResult('Provider invocation approval is absent');
    if (!approvals.pricing) return unsupportedResult('Pricing approval is absent');
    if (!approvals.rights) return unsupportedResult('Data-rights approval is absent');
    if (operation === 'start' && options.mode === 'known-id-only') {
      return unsupportedResult('Known-ID-only mode cannot submit discovery work');
    }
    if (operation === 'start' && !evidence.submission) {
      return unsupportedResult('Submission contract evidence is absent');
    }
    if (!evidence.observation) return unsupportedResult('Observation contract evidence is absent');
    return unsupportedResult('Provider transport is disabled pending the production terminal approval gate');
  }

  return {
    async start(_request: DiscoveryRequest): Promise<BrightDataDiscoveryResult> {
      return unavailable('start');
    },
    async resume(_run: BrightDataRunReference): Promise<BrightDataDiscoveryResult> {
      return unavailable('resume');
    },
  };
}
