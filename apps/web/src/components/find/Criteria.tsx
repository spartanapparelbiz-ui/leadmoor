import type { LeadSpec } from '@leadmoor/core';

/**
 * What the AI understood, in six lines.
 *
 * Shown because the user should be able to see the interpretation without being made to approve
 * it. If it is wrong, the fix is to type the correction into Refine — not to open a filter panel.
 */
export function Criteria({ spec, count, running }: { spec: LeadSpec; count: number; running: boolean }) {
  const size = spec.company.employeeRange;
  const items: Array<[string, string]> = [
    ['Location', spec.geography.countries.join(', ') + (spec.geography.regions.length ? ` · ${spec.geography.regions.join(', ')}` : '')],
    ['Industry', spec.company.industries.join(', ') || spec.company.descriptors.join(', ') || 'Any'],
    ['Employees', size ? `${size.min ?? 1}–${size.max ?? 'any'}` : 'Any'],
    ['Signals', spec.signals.join(', ') || 'None specified'],
    ['Target people', spec.personas.titles.slice(0, 4).join(' / ')],
  ];

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card__b">
        <div className="row g8" style={{ marginBottom: 12 }}>
          <span className="label">Searching for</span>
          <div className="grow" />
          <span className="mono xs faint">
            {running ? `up to ${spec.discovery.maxCompanies} companies` : `${count} lead${count === 1 ? '' : 's'}`}
          </span>
        </div>
        <dl className="crit">
          {items.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
