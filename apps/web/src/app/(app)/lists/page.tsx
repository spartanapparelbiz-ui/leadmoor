import type { Metadata } from 'next';
import type { LeadSpec } from '@leadmoor/core';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { relativeTime } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { SavedSearchRow } from '@/components/search/SavedSearchRow';
import { IconBookmark } from '@/components/Icons';

export const metadata: Metadata = { title: 'Saved lists' };
export const dynamic = 'force-dynamic';

export default async function ListsPage() {
  await ready();
  const { scope } = await requireSession();
  const saved = await scope.listSavedSearches();

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1 className="t-page">Saved lists</h1>
          <p className="muted t-sm" style={{ margin: '2px 0 0' }}>
            A saved definition can be re-run whenever you want fresh evidence for the same criteria.
          </p>
        </div>
      </div>

      {saved.length === 0 ? (
        <EmptyState
          icon={<IconBookmark />}
          title="No saved lists yet"
          body="Save a search once you are happy with its definition. Re-running it later retrieves current documents rather than replaying old ones, so the evidence is always fresh."
          hints={['Open any approved search and choose “Save as list”.']}
          action={{ href: '/searches', label: 'Browse searches' }}
        />
      ) : (
        <div className="card">
          <div className="card__body card__body--flush divide">
            {saved.map((row) => {
              const doc = row.spec as unknown as LeadSpec;
              return (
                <SavedSearchRow
                  key={row.id}
                  id={row.id}
                  name={row.name}
                  summary={`${doc.geography?.countries?.join(', ') ?? ''} · ${doc.rubric?.criteria?.length ?? 0} criteria · up to ${doc.discovery?.maxCompanies ?? 0} companies`}
                  lastRunId={row.lastRunId}
                  lastRunLabel={row.lastRunAt ? relativeTime(row.lastRunAt) : null}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
