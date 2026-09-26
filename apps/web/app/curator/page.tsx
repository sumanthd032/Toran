import type { Metadata } from 'next';
import { CuratorPage } from './CuratorPage';

export const metadata: Metadata = {
  title: 'Curator Console, Toran',
  description: 'Ingest, correction, provenance and the fleet, for the archive staff.',
};

export default function Page() {
  return <CuratorPage />;
}
