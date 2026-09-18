/**
 * BM25 lexical index.
 *
 * Vectors lose exact proper nouns, and an archive is made of them. Someone
 * searching "Mahad" must get the Mahad Satyagraha, not a passage that is
 * merely about water rights. BM25 handles the literal, vectors handle the
 * meaning, and step 3 fuses the two.
 *
 * The same tokeniser runs at build time and at query time. If they diverge,
 * the index silently stops matching, so both import this file.
 */

export const K1 = 1.2;
export const B = 0.75;

// Unicode aware: \p{L} keeps Devanagari, Tamil and the rest alongside Latin.
const TOKEN = /[\p{L}\p{N}]+/gu;

/**
 * English function words only. Indic stop words are deliberately not removed:
 * the corpus is English today, and stripping Indic words here would quietly
 * damage recall once translated content lands in step 9.
 */
const STOP = new Set(
  ('a an and are as at be been but by for from had has have he her his i in is it its of on or ' +
   'that the their them there they this to was were which who will with would you your not no ' +
   'so if then than these those we us our my me him she do does did done can could shall should ' +
   'may might must about into over under out up down all any each other some such only own same')
    .split(' '),
);

export function tokenise(text) {
  const out = [];
  for (const m of text.toLowerCase().matchAll(TOKEN)) {
    const t = m[0];
    if (t.length < 2 || STOP.has(t)) continue;
    out.push(t);
  }
  return out;
}

/** Build postings from the corpus. Returns a structure that serialises to JSON. */
export function buildLexical(docs) {
  const df = new Map();
  const termsPerDoc = [];
  let totalLength = 0;

  docs.forEach((text) => {
    const counts = new Map();
    for (const t of tokenise(text)) counts.set(t, (counts.get(t) ?? 0) + 1);
    termsPerDoc.push(counts);
    totalLength += [...counts.values()].reduce((a, b) => a + b, 0);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  });

  // Every term is kept, including those appearing in a single document.
  // Dropping rare terms to save space would remove exactly the proper nouns
  // this index exists to catch: "Mahad" occurs in few passages and is the
  // case that pure vector search already fails.
  const vocabulary = [...df.keys()].sort();
  const termIndex = new Map(vocabulary.map((t, i) => [t, i]));

  const postings = vocabulary.map(() => []);
  const docLengths = [];
  termsPerDoc.forEach((counts, docId) => {
    let length = 0;
    for (const [t, n] of counts) {
      length += n;
      const ti = termIndex.get(t);
      if (ti !== undefined) postings[ti].push(docId, n);
    }
    docLengths.push(length);
  });

  return {
    vocabulary,
    postings,
    docLengths,
    docCount: docs.length,
    averageLength: totalLength / Math.max(1, docs.length),
  };
}

/** Score a query against a built index. Returns Map of docId to score. */
export function scoreBm25(index, queryTerms) {
  const { vocabulary, postings, docLengths, docCount, averageLength } = index;
  const termIndex = index._termIndex ?? new Map(vocabulary.map((t, i) => [t, i]));
  index._termIndex = termIndex;

  const scores = new Map();
  for (const term of new Set(queryTerms)) {
    const ti = termIndex.get(term);
    if (ti === undefined) continue;
    const list = postings[ti];
    const df = list.length / 2;
    const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
    for (let i = 0; i < list.length; i += 2) {
      const docId = list[i];
      const tf = list[i + 1];
      const norm = tf * (K1 + 1) /
        (tf + K1 * (1 - B + (B * docLengths[docId]) / averageLength));
      scores.set(docId, (scores.get(docId) ?? 0) + idf * norm);
    }
  }
  return scores;
}
