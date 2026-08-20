import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'LeadMoor',
  description: 'Evidence-first B2B lead research. Every claim traces to a stored document.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;0,600;1,400&family=Karla:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
        />
      </head>
      <body>
        <header className="topbar">
          <div className="topbar__inner">
            <Link href="/" className="wordmark">
              LeadMoor <span>evidence-first</span>
            </Link>
            <div className="topbar__spacer" />
            <nav aria-label="Main">
              <Link href="/searches" className="btn btn--ghost btn--sm">
                Searches
              </Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
