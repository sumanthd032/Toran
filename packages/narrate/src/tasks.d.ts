/**
 * Types for the ULCA task descriptors and readers in tasks.mjs, for Toran
 * Core, which is TypeScript and transcribes spoken queries with them.
 */

import type { UlcaService, UlcaTask } from './bhashini.d.ts';

export declare function asrTask(
  sourceLanguage: string,
  options?: { audioFormat?: string; samplingRate?: number },
): UlcaTask;

export declare function withService(
  task: UlcaTask,
  services: ReadonlyMap<string, UlcaService>,
): UlcaTask;

export declare function readTranscript(
  response: readonly Record<string, unknown>[],
): string;
