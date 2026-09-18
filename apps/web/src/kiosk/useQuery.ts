'use client';

import { useEffect, useState } from 'react';

/**
 * The page's query string, read after mount.
 *
 * Reading window.location during render gives the static export one answer,
 * with no window, and the browser another, and React rejects the mismatch
 * when it hydrates. Starting empty and filling in after mount keeps the first
 * client render identical to the exported HTML.
 */
export function useQuery(): URLSearchParams | null {
  const [query, setQuery] = useState<URLSearchParams | null>(null);
  useEffect(() => setQuery(new URLSearchParams(window.location.search)), []);
  return query;
}
