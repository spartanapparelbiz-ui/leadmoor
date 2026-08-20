import type { Criterion, LeadSpec } from '@leadmoor/core';
import { humanize } from '@/lib/format';

/**
 * The LeadSpec, rendered as prose a non-technical reader can check.
 *
 * The point of this screen is that the user can see exactly what will run before it runs. Each
 * criterion states how it will be decided, and how many independent sources its verdict needs —
 * because "we found it once on a blog" and "two registries agree" are not the same claim.
 */
export function SpecSections({ spec }: { spec: LeadSpec }) {
  const hard = spec.rubric.criteria.filter((c) => c.kind === 'hard_filter');
  const weighted = spec.rubric.criteria.filter((c) => c.kind === 'weighted' || c.kind === 'bonus');
  const dq = spec.rubric.criteria.filter((c) => c.kind === 'disqualifier');

  return (
    <div className="col g-16" style={{ marginTop: 20 }}>
      <section className="card">
        <div className="card__head">
          <span className="t-section">Who we are looking for</span>
        </div>
        <div className="card__body col g-12">
          <div className="kv">
            <Cell label="Countries" value={spec.geography.countries.join(', ')} />
            <Cell
              label="Company size"
              value={
                spec.company.employeeRange
                  ? `${spec.company.employeeRange.min ?? '0'}–${spec.company.employeeRange.max ?? 'any'} employees`
                  : 'Any'
              }
            />
            <Cell label="Industries" value={spec.company.industries.join(', ') || 'Not restricted'} />
            <Cell label="Companies to find" value={`Up to ${spec.discovery.maxCompanies}`} />
          </div>

          {spec.company.descriptors.length > 0 ? (
            <Chips label="Described as" items={spec.company.descriptors} />
          ) : null}
          {spec.signals.length > 0 ? <Chips label="Signals that matter" items={spec.signals} /> : null}
          {spec.company.excludeDomains.length > 0 ? (
            <Chips label="Excluded domains" items={spec.company.excludeDomains} />
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <span className="t-section">Who we want to reach</span>
        </div>
        <div className="card__body col g-12">
          <Chips label="Target titles" items={spec.personas.titles} />
          {spec.personas.seniority.length > 0 ? (
            <Chips label="Seniority" items={spec.personas.seniority} />
          ) : null}
          {spec.personas.functions.length > 0 ? (
            <Chips label="Functions" items={spec.personas.functions} />
          ) : null}
          <p className="faint t-xs" style={{ margin: 0 }}>
            At most {spec.personas.maxPerCompany} {spec.personas.maxPerCompany === 1 ? 'person' : 'people'} per
            company. Only names and roles published on a company&rsquo;s own pages or a permitted API are used —
            never a personal profile behind a login.
          </p>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <span className="t-section">Where we will look</span>
        </div>
        <div className="card__body col g-12">
          <Chips label="Sources" items={spec.discovery.sources} mono />
          <div className="col g-4">
            <span className="t-label">Search queries</span>
            <ul className="col g-2" style={{ margin: 0, paddingLeft: 18 }}>
              {spec.discovery.queries.map((q) => (
                <li key={q} className="t-sm">
                  {q}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <span className="t-section">How each company is judged</span>
          <div className="grow" />
          <span className="pill pill--plain mono">Pass at {spec.rubric.passThreshold}</span>
        </div>
        <div className="card__body col g-16">
          {hard.length > 0 ? <CriterionGroup title="Must be true" note="A company failing any of these is dropped before enrichment." items={hard} /> : null}
          {weighted.length > 0 ? (
            <CriterionGroup title="Scored" note="Each contributes its weight when proven. Unproven is unknown, not zero-because-false." items={weighted} />
          ) : null}
          {dq.length > 0 ? (
            <CriterionGroup
              title="Disqualifying"
              note={`Requires ${spec.evidencePolicy.disqualifierMinSources} independent sources before it can drop a lead.`}
              items={dq}
            />
          ) : null}
        </div>
      </section>

      <section className="card">
        <div className="card__head">
          <span className="t-section">Evidence rules and limits</span>
        </div>
        <div className="card__body">
          <div className="kv">
            <Cell
              label="Minimum coverage to score"
              value={`${Math.round(spec.evidencePolicy.minCoverage * 100)}% of rubric weight`}
              note="Below this, a lead is held as insufficient evidence rather than scored on a fragment."
            />
            <Cell label="Evidence must be newer than" value={`${spec.evidencePolicy.maxEvidenceAgeDays} days`} />
            <Cell label="Document budget" value={`${spec.budget.maxDocuments} documents`} />
            <Cell label="Model call budget" value={`${spec.budget.maxModelCalls} calls`} />
            <Cell label="Fetches per company" value={String(spec.budget.maxFetchesPerCompany)} />
            <Cell label="Run time limit" value={`${Math.round(spec.budget.maxRuntimeMs / 60000)} minutes`} />
          </div>
        </div>
      </section>
    </div>
  );
}

function CriterionGroup({ title, note, items }: { title: string; note: string; items: Criterion[] }) {
  return (
    <div className="col g-8">
      <div className="col g-2">
        <span className="t-label">{title}</span>
        <span className="faint t-xs">{note}</span>
      </div>
      <div className="col g-6">
        {items.map((c) => (
          <div key={c.id} className="criterion">
            <div className="row g-8 wrap">
              <span style={{ fontWeight: 550 }}>{c.name}</span>
              <div className="grow" />
              {c.kind !== 'hard_filter' ? <span className="pill pill--plain mono">{c.weight} pts</span> : null}
              <span className="pill pill--plain" title={evaluatorHelp(c)}>
                {evaluatorLabel(c)}
              </span>
            </div>
            {c.description ? (
              <p className="muted t-sm" style={{ margin: '4px 0 0' }}>
                {c.description}
              </p>
            ) : null}
            <p className="faint t-xs" style={{ margin: '4px 0 0' }}>
              {c.evidenceRequirement.minSources === 1
                ? 'One cited source is enough.'
                : `${c.evidenceRequirement.minSources} independent sources required.`}
              {c.evidenceRequirement.maxAgeDays ? ` Evidence must be under ${c.evidenceRequirement.maxAgeDays} days old.` : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function evaluatorLabel(c: Criterion): string {
  switch (c.evaluator.type) {
    case 'numeric_range':
      return 'Number range';
    case 'structured_predicate':
      return 'Structured check';
    case 'evidence_keyword':
      return 'Text in evidence';
    case 'llm_judge':
      return 'Model judgement';
  }
}

function evaluatorHelp(c: Criterion): string {
  switch (c.evaluator.type) {
    case 'numeric_range':
      return `Reads ${c.evaluator.field} from a cited claim and compares it to the range.`;
    case 'structured_predicate':
      return `Compares ${c.evaluator.field} using "${c.evaluator.op}".`;
    case 'evidence_keyword':
      return `Matches ${c.evaluator.anyOf.slice(0, 4).join(', ')} in stored document text and cites the exact span.`;
    case 'llm_judge':
      return 'A model answers from cited passages only; its answer is discarded if the quote is not in the document.';
  }
}

function Cell({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="kv__cell">
      <span className="t-label">{label}</span>
      <span className="t-sm" style={{ fontWeight: 500 }}>
        {value}
      </span>
      {note ? (
        <span className="faint t-xs" style={{ marginTop: 2 }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

function Chips({ label, items, mono }: { label: string; items: string[]; mono?: boolean }) {
  return (
    <div className="col g-6">
      <span className="t-label">{label}</span>
      <div className="row g-4 wrap">
        {items.map((item) => (
          <span key={item} className={mono ? 'pill pill--mono' : 'pill pill--plain'}>
            {mono ? item : humanize(item)}
          </span>
        ))}
      </div>
    </div>
  );
}
