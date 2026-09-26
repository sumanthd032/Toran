'use client';

/**
 * A curator at the desk: who they are, the key that lets them change things,
 * and a client that sends both to Toran Core.
 *
 * The key is typed, never built in. It is held in this tab's sessionStorage,
 * so closing the tab forgets it, and a visitor's kiosk never has it because no
 * visitor ever types it there. D-151.
 *
 * This is the one client in the web app that is allowed to wait. The kiosk's
 * own Core client gives up at two seconds because a visitor is standing there;
 * a curator saving a correction is sitting at a desk, and a rebuild behind the
 * save can take a second, so an operator call waits up to ten.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CORE_API } from '@toran/contracts';
import { sharedCore } from '@/fleet/core';

const STORAGE_KEY = 'toran.operator';
const OPERATOR_TIMEOUT_MS = 10_000;

export interface Operator {
  readonly name: string;
  readonly key: string;
}

/** Why a call did not succeed, in terms a curator can act on. */
export type OperatorFailure =
  | 'no-core'
  | 'unreachable'
  | 'wrong-key'
  | 'read-only'
  | 'waiting'
  | 'refused'
  | 'invalid';

export type OperatorResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: OperatorFailure; readonly detail: string };

function failureFor(status: number): OperatorFailure {
  if (status === 401) return 'wrong-key';
  if (status === 503) return 'read-only';
  if (status === 429) return 'waiting';
  if (status === 409 || status === 404) return 'refused';
  return 'invalid';
}

export async function operatorCall<T>(
  base: string | null,
  operator: Operator,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body: unknown,
  read: (raw: unknown) => T,
): Promise<OperatorResult<T>> {
  if (base === null) return { ok: false, failure: 'no-core', detail: '' };
  let response: Response;
  try {
    response = await fetch(`${base}${CORE_API}${path}`, {
      method,
      cache: 'no-store',
      signal: AbortSignal.timeout(OPERATOR_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${operator.key}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, failure: 'unreachable', detail: '' };
  }
  let raw: unknown = null;
  try {
    raw = await response.json();
  } catch {
    raw = null;
  }
  if (!response.ok) {
    const detail =
      typeof raw === 'object' &&
      raw !== null &&
      typeof (raw as { error?: unknown }).error === 'string'
        ? (raw as { error: string }).error
        : '';
    return { ok: false, failure: failureFor(response.status), detail };
  }
  try {
    return { ok: true, value: read(raw) };
  } catch (error) {
    // Core answered with something the contract refuses. The console shows
    // nothing it cannot trust, so this is a failure, not a partial view.
    return {
      ok: false,
      failure: 'invalid',
      detail: error instanceof Error ? error.message : '',
    };
  }
}

function loadOperator(): Operator | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<Operator>;
    return typeof parsed.name === 'string' && typeof parsed.key === 'string'
      ? { name: parsed.name, key: parsed.key }
      : null;
  } catch {
    return null;
  }
}

function saveOperator(operator: Operator | null): void {
  try {
    if (operator === null) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(operator));
  } catch {
    // Storage blocked. The operator stays signed in for this page only.
  }
}

interface OperatorState {
  /** Where Core is, or null when this build points at none. */
  readonly base: string | null;
  readonly operator: Operator | null;
  /** Tries the key against Core, and keeps it only if Core accepts it. */
  unlock: (name: string, key: string) => Promise<OperatorResult<true>>;
  lock: () => void;
  call: <T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body: unknown,
    read: (raw: unknown) => T,
  ) => Promise<OperatorResult<T>>;
}

const Ctx = createContext<OperatorState | null>(null);

export function OperatorProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<Operator | null>(null);
  const [base, setBase] = useState<string | null>(null);

  // Read after mount, so the first render matches the static export.
  useEffect(() => {
    setBase(sharedCore().base);
    setOperator(loadOperator());
  }, []);

  const unlock = useCallback(
    async (name: string, key: string): Promise<OperatorResult<true>> => {
      const candidate = { name: name.trim(), key: key.trim() };
      const result = await operatorCall(
        base,
        candidate,
        'GET',
        '/curation',
        undefined,
        () => true as const,
      );
      if (result.ok) {
        saveOperator(candidate);
        setOperator(candidate);
      }
      return result;
    },
    [base],
  );

  const lock = useCallback(() => {
    saveOperator(null);
    setOperator(null);
  }, []);

  const call = useCallback(
    <T,>(
      method: 'GET' | 'POST' | 'PUT',
      path: string,
      body: unknown,
      read: (raw: unknown) => T,
    ): Promise<OperatorResult<T>> => {
      if (operator === null) {
        return Promise.resolve({ ok: false, failure: 'wrong-key', detail: '' });
      }
      return operatorCall(base, operator, method, path, body, read);
    },
    [base, operator],
  );

  const value = useMemo<OperatorState>(
    () => ({ base, operator, unlock, lock, call }),
    [base, operator, unlock, lock, call],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOperator(): OperatorState {
  const ctx = useContext(Ctx);
  if (ctx === null) throw new Error('useOperator must be used inside OperatorProvider');
  return ctx;
}
