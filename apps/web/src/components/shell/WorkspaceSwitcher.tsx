'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { switchWorkspaceAction } from '@/lib/actions/workspace';
import { IconCheck, IconChevron, IconPlus } from '../Icons';

export interface WorkspaceOption {
  id: string;
  name: string;
  slug: string;
  role: string;
}

/**
 * Switches the active workspace.
 *
 * The switch is a server action that re-verifies membership before it changes anything — this
 * menu only decides what to offer, never what is permitted.
 */
export function WorkspaceSwitcher({ workspaces, activeId }: { workspaces: WorkspaceOption[]; activeId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const active = workspaces.find((w) => w.id === activeId);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="wsswitch"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
      >
        <span className="avatar">{(active?.name ?? '?').slice(0, 1).toUpperCase()}</span>
        <span className="wsswitch__meta">
          <strong>{active?.name ?? 'Workspace'}</strong>
          <span>{workspaces.length > 1 ? `${workspaces.length} workspaces` : 'Workspace'}</span>
        </span>
        {pending ? <span className="spinner" /> : <IconChevron className="rot90" />}
      </button>

      {open ? (
        <div
          role="menu"
          className="card"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            minWidth: 210,
            zIndex: 40,
            boxShadow: 'var(--shadow-lg)',
            padding: 4,
          }}
        >
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              role="menuitem"
              className="cmdk__item"
              data-active={ws.id === activeId}
              onClick={() => {
                setOpen(false);
                if (ws.id === activeId) return;
                startTransition(async () => {
                  await switchWorkspaceAction(ws.id);
                });
              }}
            >
              <span className="avatar" style={{ width: 20, height: 20, fontSize: 10 }}>
                {ws.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{ws.name}</span>
              {ws.id === activeId ? <IconCheck /> : <small>{ws.role}</small>}
            </button>
          ))}
          <div className="hr" style={{ margin: '4px 0' }} />
          <a href="/settings/workspace" role="menuitem" className="cmdk__item">
            <IconPlus />
            <span>New workspace</span>
          </a>
        </div>
      ) : null}

      <style>{`.rot90 { transform: rotate(90deg); opacity: 0.6; margin-left: auto; }`}</style>
    </div>
  );
}
