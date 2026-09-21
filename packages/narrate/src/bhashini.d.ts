/**
 * Types for the Bhashini ULCA client. The implementation is bhashini.mjs;
 * these exist so Toran Core, which is TypeScript, can call it in step 10
 * without restating the shapes and letting the two drift.
 */

export interface UlcaTask {
  readonly taskType: 'translation' | 'tts' | 'asr';
  readonly config: Record<string, unknown>;
}

export interface UlcaService {
  readonly serviceId: string;
  readonly modelId: string | null;
  readonly language: Record<string, string> | null;
}

/** Where compute calls go, and the header that authorises them. */
export interface UlcaEndpoint {
  readonly url: string;
  readonly header: string;
  readonly key: string | null;
}

export interface UlcaConfig {
  readonly services: ReadonlyMap<string, UlcaService>;
  /** Null for an unauthenticated configuration call, which still lists services. */
  readonly endpoint: UlcaEndpoint | null;
}

export declare class BhashiniError extends Error {
  readonly status: number | null;
  readonly body: unknown;
  readonly task: string | null;
}

export declare const CONFIG_URL: string;
export declare const PIPELINE_ID: string;

export declare function readConfig(raw: unknown): UlcaConfig;

export declare function configure(
  tasks: readonly UlcaTask[],
  options?: { pipelineId?: string },
): Promise<UlcaConfig & { endpoint: UlcaEndpoint }>;

export declare function compute(
  endpoint: UlcaEndpoint,
  tasks: readonly UlcaTask[],
  inputData: Record<string, unknown>,
): Promise<readonly Record<string, unknown>[]>;
