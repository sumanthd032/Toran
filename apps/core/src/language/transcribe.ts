/**
 * Spoken queries, through Bhashini's speech recognition. D-129, D-158.
 *
 * The one Bhashini call that cannot be made at build time: a visitor's words
 * are new audio every time. So Core makes it, with the key that never leaves
 * this machine, and a kiosk sends five seconds of audio and gets back text.
 * Neither the audio nor the text is written down anywhere.
 */

import {
  BhashiniError,
  compute,
  configure,
  type UlcaConfig,
  type UlcaEndpoint,
} from '@toran/narrate';
import { asrTask, readTranscript, withService } from '@toran/narrate/tasks';
import { SPEECH_SAMPLE_RATE } from '@toran/contracts';

export interface Transcriber {
  transcribe: (language: string, audio: string) => Promise<string>;
}

/**
 * How long a pipeline configuration is reused. The configuration call names
 * the model and hands back the inference key; making it on every query would
 * double the wait, and a model that moves is picked up within ten minutes.
 */
const CONFIG_TTL_MS = 10 * 60 * 1000;

export function bhashiniTranscriber(now: () => number = Date.now): Transcriber {
  const configs = new Map<
    string,
    { config: UlcaConfig & { endpoint: UlcaEndpoint }; at: number }
  >();
  return {
    async transcribe(language, audio) {
      const task = asrTask(language, {
        audioFormat: 'wav',
        samplingRate: SPEECH_SAMPLE_RATE,
      });
      let cached = configs.get(language);
      if (cached === undefined || now() - cached.at > CONFIG_TTL_MS) {
        cached = { config: await configure([task]), at: now() };
        configs.set(language, cached);
      }
      try {
        const response = await compute(
          cached.config.endpoint,
          [withService(task, cached.config.services)],
          {
            audio: [{ audioContent: audio }],
          },
        );
        return readTranscript(response);
      } catch (error) {
        // A configuration that stopped working is fetched again next time.
        if (error instanceof BhashiniError) configs.delete(language);
        throw error;
      }
    },
  };
}
