'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconBookmark,
  IconBuilding,
  IconChevron,
  IconClose,
  IconDownload,
  IconHistory,
  IconLayers,
  IconMenu,
  IconPlug,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkle,
  IconTarget,
  IconUsers,
} from '../Icons';
import { CommandMenu } from '../CommandMenu';
import { WorkspaceSwitcher, type WorkspaceOption } from './WorkspaceSwitcher';
import { Brandmark } from './Brandmark';

/**
 * The application shell.
 *
 * A single client component so the sidebar's collapsed state, the mobile drawer, and the command
 * menu share one keyboard and focus model. Everything inside `children` stays a server component.
 */

export interface ShellCounts {
  leads: number;
  companies: number;
  people: number;
  savedSearches: number;
  runs: number;
}

export interface ShellUser {
  name: string;
  email: string;
  role: string;
}

const PRIMARY = [
  { href: '/', label: 'New search', icon: IconPlus, exact: true },
  { href: '/searches', label: 'Searches', icon: IconSearch, countKey: 'runs' as const },
  { href: '/leads', label: 'Leads', icon: IconTarget, countKey: 'leads' as const },
  { href: '/companies', label: 'Companies', icon: IconBuilding, countKey: 'companies' as const },
  { href: '/people', label: 'People', icon: IconUsers, countKey: 'people' as const },
  { href: '/lists', label: 'Saved lists', icon: IconBookmark, countKey: 'savedSearches' as const },
];

const SECONDARY = [
  { href: '/enrichment', label: 'Enrichment', icon: IconSparkle },
  { href: '/exports', label: 'Exports', icon: IconDownload },
  { href: '/runs', label: 'Run history', icon: IconHistory },
];

const ADMIN = [
  { href: '/settings/providers', label: 'Providers', icon: IconPlug },
  { href: '/settings', label: 'Settings', icon: IconSettings },
  { href: '/settings/workspace', label: 'Workspace', icon: IconLayers },
];

export function AppShell({
  children,
  counts,
  user,
  workspaces,
  activeWorkspaceId,
  demo,
}: {
  children: React.ReactNode;
  counts: ShellCounts;
  user: ShellUser;
  workspaces: WorkspaceOption[];
  activeWorkspaceId: string;
  /** True when this workspace holds fixture output, which is labelled rather than hidden. */
  demo: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  // Remember the collapsed preference across navigations without a round trip.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem('leadmoor:sidebar') === 'collapsed');
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      window.localStorage.setItem('leadmoor:sidebar', value ? 'expanded' : 'collapsed');
      return !value;
    });
  }, []);

  // Route changes close the mobile drawer; leaving it open over new content is disorienting.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCmdOpen((open) => !open);
      }
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const navLink = (
    item: { href: string; label: string; icon: (p: { className?: string }) => React.ReactElement; exact?: boolean; countKey?: keyof ShellCounts },
  ) => {
    const Icon = item.icon;
    const active = isActive(item.href, item.exact);
    const count = item.countKey ? counts[item.countKey] : undefined;
    return (
      <Link
        key={item.href}
        href={item.href}
        className="navitem"
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
      >
        <Icon />
        <span className="navitem__label truncate">{item.label}</span>
        {count !== undefined && count > 0 ? <span className="navitem__count">{count}</span> : null}
      </Link>
    );
  };

  return (
    <div className="app" data-collapsed={collapsed}>
      {mobileOpen ? (
        <div
          className="scrim"
          style={{ zIndex: 55 }}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside className="sidebar" data-open={mobileOpen} aria-label="Main navigation">
        <div className="sidebar__brand">
          <Brandmark />
          <span className="brandname">LeadMoor</span>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            style={{ marginLeft: 'auto' }}
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <IconClose />
          </button>
        </div>

        <nav className="sidebar__scroll">
          {PRIMARY.map(navLink)}
          <div className="sidebar__group t-label">Workflow</div>
          {SECONDARY.map(navLink)}
          <div className="sidebar__group t-label">Configure</div>
          {ADMIN.map(navLink)}
        </nav>

        <div className="sidebar__foot col g-4">
          <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} />
          <Link href="/settings" className="wsswitch" title={collapsed ? user.email : undefined}>
            <span className="avatar avatar--muted">{initials(user.name || user.email)}</span>
            <span className="wsswitch__meta">
              <strong>{user.name || user.email.split('@')[0]}</strong>
              <span>{user.role}</span>
            </span>
          </Link>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
          >
            <IconChevron
              className={collapsed ? '' : 'rot180'}
            />
            <span className="navitem__label">Collapse</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="btn btn--ghost btn--icon mobileonly"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <IconMenu />
          </button>

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setCmdOpen(true)}
            style={{ gap: 8 }}
          >
            <IconSearch />
            <span>Search or jump to…</span>
            <kbd>⌘K</kbd>
          </button>

          <div className="grow" />

          {demo ? (
            <span className="pill pill--warn" title="This workspace contains demo output from the fixture corpus.">
              Demo data
            </span>
          ) : null}

          <Link href="/" className="btn btn--primary btn--sm">
            <IconPlus />
            <span className="desktoponly">New search</span>
          </Link>
        </header>

        {children}
      </div>

      {cmdOpen ? <CommandMenu onClose={() => setCmdOpen(false)} /> : null}

      <style>{`
        .rot180 { transform: rotate(180deg); }
        .mobileonly { display: none; }
        @media (max-width: 900px) { .mobileonly { display: inline-flex; } }
        @media (max-width: 480px) { .desktoponly { display: none; } }
        .sidebar__brand .btn--icon { display: none; }
        @media (max-width: 900px) { .sidebar__brand .btn--icon { display: inline-flex; } }
      `}</style>
    </div>
  );
}

function initials(value: string): string {
  const parts = value.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || value.slice(0, 2).toUpperCase();
}
