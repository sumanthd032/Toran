'use client';

/**
 * A search asked aloud. D-129, D-158.
 *
 * Offered only when Toran Core says it serves speech recognition, so a kiosk
 * with no Core, or a Core with no Bhashini key, shows no microphone at all:
 * a control that cannot work is not put in front of a visitor. A tap starts
 * listening, a second tap stops, and five seconds stops it anyway. The audio
 * goes to Core and the words come back; neither is kept.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SPEECH_MAX_SECONDS, SPEECH_SAMPLE_RATE } from '@toran/contracts';
import { sharedCore } from '@/fleet/core';
import { base64, downsample, encodeWav } from './wav';

export type SpeechState = 'idle' | 'listening' | 'working' | 'unheard' | 'no-microphone';

interface Recording {
  readonly stream: MediaStream;
  readonly context: AudioContext;
  readonly chunks: Float32Array[];
  readonly stop: () => void;
}

export function useSpokenQuery(language: string, onWords: (words: string) => void) {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<SpeechState>('idle');
  const recording = useRef<Recording | null>(null);
  const timer = useRef(0);
  // The latest callback, without restarting a recording when it changes.
  const heard = useRef(onWords);
  heard.current = onWords;

  useEffect(() => {
    let live = true;
    const core = sharedCore();
    if (core.base === null || typeof navigator === 'undefined' || !navigator.mediaDevices)
      return;
    void core.serves('language').then((yes) => {
      if (live) setAvailable(yes);
    });
    return () => {
      live = false;
    };
  }, []);

  const finish = useCallback(async () => {
    const r = recording.current;
    if (r === null) return;
    recording.current = null;
    window.clearTimeout(timer.current);
    r.stop();
    setState('working');
    const length = r.chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(length);
    let at = 0;
    for (const c of r.chunks) {
      samples.set(c, at);
      at += c.length;
    }
    const pcm = downsample(samples, r.context.sampleRate);
    void r.context.close();
    // Less than a fifth of a second is a tap, not a question, and Core would
    // refuse it; saying so here saves the visitor the round trip.
    if (pcm.length < SPEECH_SAMPLE_RATE / 5) {
      setState('unheard');
      return;
    }
    const audio = base64(encodeWav(pcm));
    const words = await sharedCore().transcribe(language, audio);
    if (words === null) {
      setState('unheard');
      return;
    }
    setState('idle');
    heard.current(words);
  }, [language]);

  const start = useCallback(async () => {
    // Made inside the tap, before anything is awaited: a browser lets audio
    // run only from a gesture, and an AudioContext made after the microphone
    // prompt resolves can stay suspended and record silence. Found by
    // verify:speech, where the first recordings came back empty.
    const context = new AudioContext();
    void context.resume();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      void context.close();
      setState('no-microphone');
      return;
    }
    const source = context.createMediaStreamSource(stream);
    // A ScriptProcessor is deprecated, and it is also in every browser a
    // kiosk runs and needs no second file to load. Five seconds of it is fine.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (e) =>
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(processor);
    processor.connect(context.destination);
    recording.current = {
      stream,
      context,
      chunks,
      stop: () => {
        processor.disconnect();
        source.disconnect();
        for (const track of stream.getTracks()) track.stop();
      },
    };
    setState('listening');
    timer.current = window.setTimeout(
      () => void finish(),
      SPEECH_MAX_SECONDS * 1000 - 200,
    );
  }, [finish]);

  const toggle = useCallback(() => {
    if (recording.current !== null) void finish();
    else if (state !== 'working') void start();
  }, [finish, start, state]);

  // A visitor who walks away mid-sentence leaves no microphone open.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      recording.current?.stop();
      void recording.current?.context.close();
      recording.current = null;
    },
    [],
  );

  return { available, state, toggle };
}
