'use client';

/**
 * One of the console's queues, loaded from Core and replaced by what Core
 * sends back after each decision. The console never edits a queue locally:
 * what it shows after a save is what Core now holds, so a curator cannot be
 * looking at a decision that did not reach the log.
 */

import { useCallback, useEffect, useState } from 'react';
import { useOperator, type OperatorFailure } from './operator';

export type Queue<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly value: T }
  | {
      readonly state: 'failed';
      readonly failure: OperatorFailure;
      readonly detail: string;
    };

export function useQueue<T>(path: string, read: (raw: unknown) => T) {
  const { call, operator } = useOperator();
  const [queue, setQueue] = useState<Queue<T>>({ state: 'loading' });

  const reload = useCallback(() => {
    setQueue({ state: 'loading' });
    void call('GET', path, undefined, read).then((result) =>
      setQueue(
        result.ok
          ? { state: 'ready', value: result.value }
          : { state: 'failed', failure: result.failure, detail: result.detail },
      ),
    );
  }, [call, path, read]);

  useEffect(() => {
    if (operator !== null) reload();
  }, [operator, reload]);

  const replace = useCallback((value: T) => setQueue({ state: 'ready', value }), []);

  return { queue, reload, replace };
}
