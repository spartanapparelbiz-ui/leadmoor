import Link from 'next/link';
import type { Metadata } from 'next';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { EmptyState } from '@/components/EmptyState';
import { EmailPill } from '@/components/leads/LeadResults';
import { IconUsers } from '@/components/Icons';

export const metadata: Metadata = { title: 'People' };
export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
  await ready();
  const { scope } = await requireSession();

  const people = await scope.listPeople({ limit: 1000 });
  const companies = new Map((await scope.listCompanies({ limit: 2000 })).map((c) => [c.id, c]));
  const leads = await scope.listLeads({ limit: 2000, includeSuppressed: false });
  const leadByPerson = new Map(leads.filter((l) => l.personId).map((l) => [l.personId as string, l]));

  const titles = new Map<string, string>();
  for (const person of people) {
    const claims = await scope.claimsFor('person', person.id);
    const role = claims.find((c) => c.field === 'person.role' && c.status === 'supported');
    if (role && typeof role.value === 'string') titles.set(person.id, role.value);
  }

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1 className="t-page">People</h1>
          <p className="muted t-sm" style={{ margin: '2px 0 0' }}>
            Named on a company&rsquo;s own pages or in a permitted API — never from a private profile.
          </p>
        </div>
        <div className="grow" />
        <span className="mono t-sm faint">{people.length}</span>
      </div>

      {people.length === 0 ? (
        <EmptyState
          icon={<IconUsers />}
          title="No people found yet"
          body="People appear here when a search finds a named role holder on a permitted public page. LeadMoor does not read logged-in profiles, and it does not construct an address from a naming pattern."
          hints={[
            'If a company published no leadership page, its lead still scores on the company criteria alone.',
            'Deleting a person removes their name, role, claims, and any address, while keeping the audit trail.',
          ]}
          action={{ href: '/', label: 'Start a search' }}
        />
      ) : (
        <div className="card">
          <div className="tablewrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Company</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const company = companies.get(p.companyId);
                  const lead = leadByPerson.get(p.id);
                  return (
                    <tr key={p.id}>
                      <td>
                        {lead ? (
                          <Link href={`/leads?lead=${lead.id}`} className="tbl__primary">
                            {p.fullName}
                          </Link>
                        ) : (
                          <span className="tbl__primary">{p.fullName}</span>
                        )}
                      </td>
                      <td className="muted t-sm">{titles.get(p.id) ?? '—'}</td>
                      <td>
                        {company ? (
                          <Link href={`/companies/${company.id}`} className="t-sm">
                            {company.canonicalName}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <EmailPill status={lead?.emailStatus ?? 'unavailable'} />
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
