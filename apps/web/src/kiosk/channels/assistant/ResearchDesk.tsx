'use client';

/**
 * The Research Assistant, device 11. PROJECT.md 7.7, R11.
 *
 * A question, and an answer in which every claim sits above the passage it
 * came from, at its volume and page. The passage is not a footnote or a
 * tooltip: it is on the screen, under the sentence that rests on it, because a
 * group standing at a kiosk cannot hover and because a claim a visitor cannot
 * check is a claim they have to take on trust.
 *
 * What this screen will not do is answer when the archive does not hold an
 * answer. The refusal is not a fallback, it is the feature: an assistant
 * attached to a memorial that will confabulate about the Constitution is worse
 * than no assistant. When it refuses it says which kind of refusal it was and
 * shows what search did find, so a visitor leaves with something to read
 * rather than an apology.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AssistantReply, CitedPassage } from '@toran/contracts';
import { Button, Citation, Field, Rule } from '@/design/primitives';
import { sharedCore } from '@/fleet/core';
import { useI18n, type MessageKey } from '@/i18n';
import { useAnnounce } from '../../announce';
import { ICON, Icon } from '../../icons';
import { useChannelNav } from '../../nav';
import { ReachTools } from '../../reach';
import { askArchive, engineReady, numberOf, supportOf, type Asked } from './model';
import styles from './assistant.module.css';

/**
 * What a visitor is offered before they type anything.
 *
 * Three, and they are three of the questions `npm run build:answers` prepared,
 * so pressing one works with the network off. The last is deliberately outside
 * the corpus: a visitor who presses it watches the assistant refuse, which is
 * the thing worth showing and the thing a jury should see happen rather than
 * be told about.
 *
 * The label is translated and the question is not. The prepared answers are
 * keyed by the English question, and the answer itself is in the language of
 * the corpus, so a visitor reading Marathi presses a Marathi label and gets
 * the same cited passages as everyone else.
 */
const OPENERS: readonly { readonly label: MessageKey; readonly question: string }[] = [
  {
    label: 'assistant.opener.article17',
    question: 'What does Article 17 of the Constitution do?',
  },
  { label: 'assistant.opener.mahad', question: 'What happened at Mahad?' },
  {
    label: 'assistant.opener.outside',
    question: 'What did Dr. Ambedkar say about cricket?',
  },
];

const REFUSAL_KEY = {
  'nothing-retrieved': 'assistant.refusal.nothingFound',
  'not-in-corpus': 'assistant.refusal.notInCorpus',
  ungrounded: 'assistant.refusal.ungrounded',
  unavailable: 'assistant.refusal.unavailable',
  'rate-limited': 'assistant.refusal.rateLimited',
} as const satisfies Record<string, MessageKey>;

export function ResearchDesk() {
  const { t, lang } = useI18n();
  const announce = useAnnounce();
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState<Asked | null>(null);
  // A question nobody prepared needs the device's own search, which is 118 MB
  // of model. The prepared questions do not, so the openers stay live while
  // this loads and only the free-text field waits.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    engineReady().then(
      () => live && setReady(true),
      () => live && setReady(false),
    );
    return () => {
      live = false;
    };
  }, []);

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length < 3 || asking) return;
      setAsking(true);
      setAsked(null);
      announce(t('assistant.thinking'));
      try {
        const result = await askArchive(trimmed, { core: sharedCore() });
        setAsked(result);
      } finally {
        setAsking(false);
      }
    },
    [announce, asking, t],
  );

  // What happened, for a visitor who is not reading the screen. The first
  // claim, not "an answer arrived", because the claim is the content.
  useEffect(() => {
    if (asked === null) return;
    announce(
      asked.reply.kind === 'answer'
        ? asked.reply.segments.map((s) => s.text).join('. ')
        : t(REFUSAL_KEY[asked.reply.because]),
    );
  }, [asked, announce, t]);

  useChannelNav({
    back: () => {
      if (asked === null) return false;
      setAsked(null);
      setQuestion('');
      return true;
    },
    home: () => {
      setAsked(null);
      setQuestion('');
    },
    // There is nothing to go forward to. An answer is not a place a visitor
    // returns to: the question is still in the field, and asking again is the
    // honest way back to it, because the archive may have been reindexed.
    forward: () => false,
    canForward: false,
  });

  return (
    <div className={styles.root} data-testid="assistant">
      <div className={styles.stage}>
        {asked === null ? (
          <Opening
            asking={asking}
            onPick={(text) => {
              setQuestion(text);
              void ask(text);
            }}
          />
        ) : (
          <Result asked={asked} />
        )}
      </div>

      <ReachTools>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <Field
            label={t('assistant.ask')}
            value={question}
            lang={lang}
            disabled={asking || !ready}
            hint={ready ? undefined : t('assistant.loading')}
            enterKeyHint="search"
            autoComplete="off"
            data-testid="assistant-question"
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            icon={<Icon d={ICON.search} />}
            disabled={asking || !ready || question.trim().length < 3}
            aria-label={t('assistant.ask')}
            data-testid="assistant-submit"
          >
            {asking ? t('assistant.thinking') : t('assistant.ask')}
          </Button>
        </form>
      </ReachTools>
    </div>
  );
}

function Opening({
  asking,
  onPick,
}: {
  asking: boolean;
  onPick: (question: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.opening}>
      <p className={styles.lead}>{t('assistant.lead')}</p>
      <p className={styles.limit}>{t('assistant.limit')}</p>
      <Rule />
      <ul className={styles.openers} aria-label={t('assistant.openers')}>
        {OPENERS.map((opener) => (
          <li key={opener.label}>
            <button
              type="button"
              className={styles.opener}
              disabled={asking}
              data-testid="assistant-opener"
              onClick={() => onPick(opener.question)}
            >
              {t(opener.label)}
            </button>
          </li>
        ))}
      </ul>
      {asking ? (
        <p className={styles.thinking} data-testid="assistant-thinking">
          {t('assistant.thinking')}
        </p>
      ) : null}
    </div>
  );
}

function Result({ asked }: { asked: Asked }) {
  const { t } = useI18n();
  const support = supportOf(asked.reply);
  return (
    <div className={styles.result}>
      <p className={styles.question} data-testid="assistant-asked">
        {asked.reply.question}
      </p>
      <Rule />
      {asked.reply.kind === 'answer' ? (
        <Answered reply={asked.reply} support={support} />
      ) : (
        <Refused reply={asked.reply} />
      )}
      {support.length > 0 ? (
        <>
          <h2 className={styles.sourcesTitle}>{t('assistant.sources')}</h2>
          <ol className={styles.sources} data-testid="assistant-sources">
            {support.map((passage, i) => (
              <li
                key={`${passage.citation.pageId}-${String(i)}`}
                id={`assistant-source-${String(i + 1)}`}
              >
                <span className={styles.sourceNumber} aria-hidden="true">
                  {i + 1}
                </span>
                <blockquote
                  className={styles.sourceText}
                  lang={passage.language}
                  data-testid="assistant-source"
                >
                  {passage.speaker === null ? null : (
                    <b className={styles.speaker}>{passage.speaker}</b>
                  )}
                  {passage.text}
                </blockquote>
                <Citation
                  citation={passage.citation}
                  block
                  translatedFrom={passage.translatedFrom}
                />
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </div>
  );
}

function Answered({
  reply,
  support,
}: {
  reply: Extract<AssistantReply, { kind: 'answer' }>;
  support: readonly CitedPassage[];
}) {
  const { t } = useI18n();
  return (
    <>
      <div className={styles.answer} data-testid="assistant-answer">
        {reply.segments.map((segment, i) => (
          <p className={styles.segment} key={i} lang={reply.language}>
            <span className={styles.claim} data-testid="assistant-claim">
              {segment.text}
            </span>
            {/* Not a superscript. A visitor reading at arm's length has to be
                able to see which passage below a claim rests on. */}
            <span className={styles.marks}>
              {segment.support.map((passage) => (
                <a
                  key={numberOf(support, passage)}
                  className={styles.mark}
                  href={`#assistant-source-${String(numberOf(support, passage))}`}
                  data-testid="assistant-mark"
                >
                  {numberOf(support, passage)}
                </a>
              ))}
            </span>
          </p>
        ))}
      </div>
      <p className={styles.engine} data-testid="assistant-engine">
        {t(reply.cached ? 'assistant.preparedBy' : 'assistant.writtenBy', {
          engine: reply.engine,
        })}
      </p>
    </>
  );
}

function Refused({ reply }: { reply: Extract<AssistantReply, { kind: 'refusal' }> }) {
  const { t } = useI18n();
  return (
    <div className={styles.refusal} data-testid="assistant-refusal">
      <p className={styles.refusalLead}>{t(REFUSAL_KEY[reply.because])}</p>
      <p className={styles.refusalNote}>
        {t(
          reply.nearest.length > 0
            ? 'assistant.refusal.readInstead'
            : 'assistant.refusal.nothingToRead',
        )}
      </p>
    </div>
  );
}
