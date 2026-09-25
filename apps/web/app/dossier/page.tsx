import type { Metadata } from 'next';
import { TakeHome } from '@/archive/TakeHome';

export const metadata: Metadata = {
  title: 'Your reading, Toran',
  description:
    'Passages kept at the Dr. Ambedkar National Memorial, each with its source.',
};

export default function DossierPage() {
  return <TakeHome />;
}
