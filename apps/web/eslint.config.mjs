// ESLint 9 reads only flat config, and eslint-config-next 15 still ships the
// legacy format, so FlatCompat translates it. `next lint` is deprecated in
// Next 15.5, which is why the script calls the ESLint CLI directly.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  // public/ holds vendored runtimes (ONNX Runtime, the model) and fonts.
  { ignores: ['.next/**', 'out/**', 'out-web/**', 'public/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
