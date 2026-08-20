'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brandmark } from './Brandmark';
import { IconBookmark, IconClose, IconMenu, IconPlus, IconSettings } from '../Icons';

/**
 * The shell.
 *
 * Three destinations. Everything else this product does — evidence, provenance, suppression,
 * exports — belongs to a lead or to a search, and lives where that thing is, not in a menu.
 */

const LINKS = [
  { href: '/', label: 'New search', icon: IconPlus, exact: true },
  { href: '/searches', label: 'Searches', icon: IconBookmark },
  { href: '/settings', label: 'Settings', icon: IconSettings },
];

export function Shell({
  children,
  email,
  demo,
}: {
  children: React.ReactNode;
  email: string;
  /** True when this account holds fixture output, which is labelled rather than hidden. */
  demo: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="app">
      <a href="#main" className="skip">
        Skip to content
      </a>

      {open ? <div className="scrim" style={{ zIndex: 55 }} onClick={() => setOpen(false)} aria-hidden="true" /> : null}

      <nav className="nav" data-open={open} aria-label="Main">
        <div className="brand">
          <Brandmark />
          <span>LeadMoor</span>
          <div className="grow" />
          <button
            type="button"
            className="btn btn--ghost btn--ico mobonly"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <IconClose />
          </button>
        </div>

        {LINKS.map((l) => {
          const Icon = l.icon;
          const active = l.exact ? pathname === l.href : pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <Link key={l.href} href={l.href} className="navlink" aria-current={active ? 'page' : undefined}>
              <Icon />
              {l.label}
            </Link>
          );
        })}

        <div className="grow" />
        <div className="xs faint truncate" style={{ padding: '0 9px 4px' }} title={email}>
          {email}
        </div>
      </nav>

      <div className="main">
        <header className="bar">
          <button
            type="button"
            className="btn btn--ghost btn--ico mobonly"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <IconMenu />
          </button>
          <div className="grow" />
          {demo ? (
            <span className="pill pill--warn" title="This account holds demo output produced from a fixture corpus.">
              Demo data
            </span>
          ) : null}
          <Link href="/" className="btn btn--sm">
            <IconPlus />
            New search
          </Link>
        </header>

        <main id="main">{children}</main>
      </div>

      <style>{`
        .mobonly { display: none; }
        @media (max-width: 860px) { .mobonly { display: inline-flex; } }
      `}</style>
    </div>
  );
}
