import Link from 'next/link';
import type { Metadata } from 'next';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { relativeTime } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { IconBuilding } from '@/components/Icons';

export const metadata: Metadata = { title: 'Companies' };
export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  await ready();
  const { scope } = await requireSession();

  const companies = await scope.listCompanies({ limit: 1000 });
  const leads = await scope.listLeads({ limit: 2000, includeSuppressed: true });
  const people = await scope.listPeople({ limit: 2000 });

  const leadByCompany = new Map<string, (typeof leads)[number]>();
  for (const lead of leads) {
    const existing = leadByCompany.get(lead.companyId);
    if (!existing || lead.score > existing.score) leadByCompany.set(lead.companyId, lead);
  }
  const peopleCount = new Map<string, number>();
  for (const p of people) peopleCount.set(p.companyId, (peopleCount.get(p.companyId) ?? 0) + 1);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1 className="t-page">Companies</h1>
          <p className="muted t-sm" style={{ margin: '2px 0 0' }}>
            Every organisation discovered in this workspace, with its identity resolved across runs.
          </p>
        </div>
        <div className="grow" />
        <span className="mono t-sm faint">{companies.length}</span>
      </div>

      {companies.length === 0 ? (
        <EmptyState
          icon={<IconBuilding />}
          title="No companies discovered yet"
          body="Companies appear here as searches discover them. Each is identified by its verified domain where one exists, so the same company found twice is one record, not two."
          action={{ href: '/', label: 'Start a search' }}
        />
      ) : (
        <div className="card">
          <div className="tablewrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Domain</th>
                  <th className="num">People</th>
                  <th className="num">Best score</th>
                  <th>Discovered</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const lead = leadByCompany.get(c.id);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/companies/${c.id}`} className="tbl__primary">
                          {c.canonicalName}
                        </Link>
                      </td>
                      <td>
                        {c.primaryDomain ? (
                          <a
                            href={`https://${c.primaryDomain}`}
                            className="mono t-xs"
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {c.primaryDomain}
                          </a>
                        ) : (
                          <span className="pill pill--unknown">Unverified</span>
                        )}
                      </td>
                      <td className="num mono">{peopleCount.get(c.id) ?? 0}</td>
                      <td className="num mono">
                        {lead && lead.status !== 'held_insufficient_evidence' ? Math.round(lead.score) : '—'}
                      </td>
                      <td className="mono t-xs faint">{relativeTime(c.createdAt)}</td>
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
