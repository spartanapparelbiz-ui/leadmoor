import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { leadSpec as leadSpecTable, run as runTable } from '@leadmoor/db';
import { ready, services } from '@/lib/services';
import { relativeTime, runStatusChip } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SearchesPage() {
  await ready();
  const db = services().db;

  const specs = await db.select().from(leadSpecTable).orderBy(desc(leadSpecTable.createdAt)).limit(50);
  const runsBySpec = new Map<string, { id: string; status: string }>();
  for (const spec of specs) {
    const found = await db.select().from(runTable).where(eq(runTable.specId, spec.id)).limit(1);
    if (found[0]) runsBySpec.set(spec.id, { id: found[0].id, status: found[0].status });
  }

  return (
    <div className="shell">
      <header style={{ padding: '40px 0 24px' }}>
        <span className="eyebrow">Workspace</span>
        <h1 className="h-display" style={{ fontSize: '2.1rem', marginTop: '0.25em' }}>
          Searches
        </h1>
      </header>

      {specs.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <p className="h-section">No searches yet</p>
            <p className="muted" style={{ maxWidth: '46ch', margin: '0 auto 20px' }}>
              Describe the companies you want to sell to and LeadMoor will build a search you can review before
              anything runs.
            </p>
            <Link href="/" className="btn btn--primary">
              Start a search
            </Link>
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Search</th>
                  <th>Built by</th>
                  <th>State</th>
                  <th>Created</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {specs.map((spec) => {
                  const doc = spec.spec as { name?: string };
                  const run = runsBySpec.get(spec.id);
                  const chip = run ? runStatusChip(run.status) : null;
                  return (
                    <tr key={spec.id}>
                      <td>
                        <Link href={`/searches/${spec.id}`} style={{ fontWeight: 600 }}>
                          {doc.name ?? 'Untitled search'}
                        </Link>
                      </td>
                      <td className="small muted">
                        {spec.origin === 'compiled' ? 'Model' : spec.origin === 'edited' ? 'Edited by you' : 'Keyword draft'}
                      </td>
                      <td>
                        {chip ? (
                          <span className={chip.className}>{chip.label}</span>
                        ) : spec.approvedAt ? (
                          <span className="chip chip--neutral">Approved</span>
                        ) : (
                          <span className="chip chip--neutral">Draft</span>
                        )}
                      </td>
                      <td className="mono small muted">{relativeTime(spec.createdAt)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <Link href={run ? `/runs/${run.id}` : `/searches/${spec.id}`} className="btn btn--sm">
                          {run ? 'Open run' : 'Review'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
