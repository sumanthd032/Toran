import type { Metadata, Viewport } from 'next';
import { I18nProvider } from '@/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'Toran',
  description:
    'Digital heritage archive and institutional twin for the Dr. Ambedkar International Centre.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /*
    Zoom stays enabled. Disabling it fails WCAG 1.4.4, and this same build is
    the public web app, not only the kiosk. On a kiosk the panel geometry is
    protected by Chromium's own launch flags at deploy time, which is where a
    deployment constraint belongs. Visitors who need larger text get the card
    type scale, which reaches 200% without reflow breaking.
  */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4efe6' },
    { media: '(prefers-color-scheme: dark)', color: '#141210' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
