import type { Metadata } from 'next';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { loadLeadViews } from '@/lib/leads';
import { LeadResults } from '@/components/leads/LeadResults';
import { EmptyState } from '@/components/EmptyState';
import { IconTarget } from '@/components/Icons';

export const metadata: Metadata = { title: 'Leads' };
export const dynamic = 'force-dynamic';

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; email?: string; run?: string }>;
}) {
  const params = await searchParams;
  await ready();
  const { scope } = await requireSession();

  const views = await loadLeadViews(scope, { runId: params.run, includeSuppressed: false, limit: 1000 });

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1 className="t-page">Leads</h1>
          <p className="muted t-sm" style={{ margin: '2px 0 0' }}>
            Every lead across every run in this workspace. Open one to see the evidence behind its score.
          </p>
        </div>
      </div>

      {views.length === 0 ? (
        <EmptyState
          icon={<IconTarget />}
          title="No leads yet"
          body="Leads appear here once a search has run. Each one carries its score, the criteria it met, and the exact sentence in a stored document that proves each fact."
          hints={[
            'A lead marked “insufficient evidence” is not a rejection — it means too little of the rubric could be checked.',
            'Suppressed leads are hidden here and excluded from every export, including future runs.',
          ]}
          action={{ href: '/', label: 'Start a search' }}
          secondary={{ href: '/runs', label: 'See run history' }}
        />
      ) : (
        <LeadResults views={views} initialStatus={params.status} initialEmail={params.email} />
      )}
    </div>
  );
}
