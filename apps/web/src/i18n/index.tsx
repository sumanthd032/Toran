'use client';

/**
 * Toran i18n.
 *
 * Language is a property of the visitor session, not of the URL. A Sutra card
 * tap changes it mid-visit on a kiosk that has no address bar, so routing-based
 * locales would be the wrong model here. See DECISIONS.md D-023.
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
import { DEFAULT_LANGUAGE, language as languageInfo } from '@toran/contracts';
import en from './messages/en.json';
import hi from './messages/hi.json';
import mr from './messages/mr.json';

/** Keys are derived from the English catalogue, so a typo will not compile. */
export type MessageKey = keyof typeof en;

type Catalogue = Record<MessageKey, string>;

/**
 * Loaded catalogues. Step 1 ships three. Step 9 loads the remaining scheduled
 * languages on demand rather than eagerly, once there are twenty-two of them.
 */
const CATALOGUES: Readonly<Record<string, Catalogue>> = {
  en: en as Catalogue,
  hi: hi as Catalogue,
  mr: mr as Catalogue,
};

export function hasCatalogue(code: string): boolean {
  return Object.hasOwn(CATALOGUES, code);
}

export function loadedLanguages(): readonly string[] {
  return Object.keys(CATALOGUES);
}

type Vars = Readonly<Record<string, string | number>>;

function interpolate(template: string, vars?: Vars): string {
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

interface I18nValue {
  readonly lang: string;
  readonly dir: 'ltr' | 'rtl';
  readonly setLang: (code: string) => void;
  readonly t: (key: MessageKey, vars?: Vars) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  children,
  initial = DEFAULT_LANGUAGE,
  applyToDocument = true,
}: {
  children: ReactNode;
  initial?: string;
  /**
   * False for a nested provider, such as a kiosk running inside the Twin. It
   * then leaves the document alone and its caller puts lang and dir on its
   * own root element, so a Marathi kiosk does not switch the whole page.
   */
  applyToDocument?: boolean;
}) {
  const [lang, setLangState] = useState(initial);

  const setLang = useCallback((code: string) => {
    setLangState(hasCatalogue(code) ? code : DEFAULT_LANGUAGE);
  }, []);

  const dir = languageInfo(lang)?.direction ?? 'ltr';

  // The document element carries lang and dir so CSS :lang() and the Indic
  // font stack apply, and so assistive technology announces correctly.
  useEffect(() => {
    if (!applyToDocument) return;
    const root = document.documentElement;
    root.lang = lang;
    root.dir = dir;
  }, [lang, dir, applyToDocument]);

  const t = useCallback(
    (key: MessageKey, vars?: Vars): string => {
      const catalogue = CATALOGUES[lang] ?? CATALOGUES[DEFAULT_LANGUAGE];
      const fallback = CATALOGUES[DEFAULT_LANGUAGE];
      // A missing translation falls back to English rather than showing a key.
      const template = catalogue?.[key] ?? fallback?.[key] ?? key;
      return interpolate(template, vars);
    },
    [lang],
  );

  const value = useMemo<I18nValue>(
    () => ({ lang, dir, setLang, t }),
    [lang, dir, setLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (ctx === null) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return ctx;
}

/** Shorthand for the common case. */
export function useT(): I18nValue['t'] {
  return useI18n().t;
}
