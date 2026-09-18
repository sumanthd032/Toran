import Link from 'next/link';

/**
 * Placeholder. Step 4 replaces this with the Twin, which is the real entry
 * point: the camera pushes through the Toran gateway into the hall.
 */
export default function Home() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--s-6)',
      }}
    >
      <div style={{ maxWidth: '54ch', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--t-display)' }}>Toran</h1>
        <p style={{ color: 'var(--text-soft)', marginTop: 'var(--s-3)' }}>
          Digital heritage archive and institutional twin for the Dr. Ambedkar
          International Centre.
        </p>
        <p style={{ marginTop: 'var(--s-6)' }}>
          <Link href="/system/" style={{ color: 'var(--accent-text)' }}>
            Design system
          </Link>
        </p>
      </div>
    </main>
  );
}
