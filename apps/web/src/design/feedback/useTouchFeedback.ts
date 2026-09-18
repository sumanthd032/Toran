'use client';

import { useCallback } from 'react';
import { playTouch, unlockAudio } from './sound';

/**
 * Every interactive primitive calls this. Visual feedback is the primitive's
 * own :active state; this adds the auditory half of the contract.
 */
export function useTouchFeedback(weight: 'light' | 'firm' = 'light') {
  return useCallback(() => {
    unlockAudio();
    playTouch(weight);
  }, [weight]);
}
