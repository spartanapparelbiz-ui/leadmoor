'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { searchEverything, type QuickResult } from '@/lib/actions/search';
import {
  IconBookmark,
  IconBuilding,
  IconDownload,
  IconHistory,
  IconPlug,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkle,
  IconTarget,
  IconUsers,
} from './Icons';

/**
 * Command menu (⌘K).
 *
 * Static destinations answer instantly from memory; typing two or more characters also queries the
 * workspace for matching leads, companies, and people. That query is a server action, so it is
 * scoped to the caller's workspace like every other read.
 */

interface Item {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: (p: { className?: string }) => React.ReactElement;
}

const DESTINATIONS: Item[] = [
  { id: 'new', label: 'New search', hint: 'Home', href: '/', icon: IconPlus },
  { id: 'searches', label: 'Searches', href: '/searches', icon: IconSearch },
  { id: 'leads', label: 'Leads', href: '/leads', icon: IconTarget },
  { id: 'companies', label: 'Companies', href: '/companies', icon: IconBuilding },
  { id: 'people', label: 'People', href: '/people', icon: IconUsers },
  { id: 'lists', label: 'Saved lists', href: '/lists', icon: IconBookmark },
  { id: 'enrichment', label: 'Enrichment', href: '/enrichment', icon: IconSparkle },
  { id: 'exports', label: 'Exports', href: '/exports', icon: IconDownload },
  { id: 'runs', label: 'Run history', href: '/runs', icon: IconHistory },
  { id: 'providers', label: 'Providers', href: '/settings/providers', icon: IconPlug },
  { id: 'settings', label: 'Settings', href: '/settings', icon: IconSettings },
];

const RESULT_ICON = { lead: IconTarget, company: IconBuilding, person: IconUsers } as const;

export function CommandMenu({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [results, setResults] = useState<QuickResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced workspace search. An in-flight response for a stale query is discarded.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await searchEverything(term);
        if (!cancelled) setResults(found);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 160);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const destinations = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return DESTINATIONS;
    return DESTINATIONS.filter((d) => d.label.toLowerCase().includes(term));
  }, [query]);

  const items: Item[] = useMemo(
    () => [
      ...destinations,
      ...results.map((r) => ({
        id: `${r.kind}:${r.id}`,
        label: r.label,
        hint: r.hint,
        href: r.href,
        icon: RESULT_ICON[r.kind],
      })),
    ],
    [destinations, results],
  );

  useEffect(() => {
    setCursor(0);
  }, [query, results.length]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };

  return (
    <div
      className="cmdk"
      role="dialog"
      aria-modal="true"
      aria-label="Command menu"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdk__panel">
        <input
          ref={inputRef}
          className="input cmdk__input"
          placeholder="Search leads, companies, people — or jump to a page"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Command menu search"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, Math.max(0, items.length - 1)));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              go(items[cursor]);
            }
          }}
        />

        <div className="cmdk__list" role="listbox" aria-label="Results">
          {items.length === 0 ? (
            <p className="muted t-sm" style={{ padding: '14px 12px', margin: 0 }}>
              {searching ? 'Searching…' : `Nothing matches “${query.trim()}”.`}
            </p>
          ) : (
            items.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  className="cmdk__item"
                  data-active={index === cursor}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(item)}
                >
                  <Icon />
                  <span className="truncate">{item.label}</span>
                  {item.hint ? <small className="truncate">{item.hint}</small> : null}
                </button>
              );
            })
          )}
          {searching && items.length > 0 ? (
            <p className="faint t-xs" style={{ padding: '6px 12px', margin: 0 }}>
              Searching workspace…
            </p>
          ) : null}
        </div>

        <div
          className="row g-12"
          style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--faint)' }}
        >
          <span className="row g-4">
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span className="row g-4">
            <kbd>↵</kbd> open
          </span>
          <span className="row g-4">
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
