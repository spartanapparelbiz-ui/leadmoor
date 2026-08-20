'use client';

import { useState } from 'react';
import type { Citation, Dossier } from '@/lib/actions/dossier';
import { loadEvidenceText } from '@/lib/actions/dossier';
import { IconCheck, IconExternal } from '../Icons';

/**
 * Evidence, quote first.
 *
 * The sentence itself is the whole justification for a claim and should be readable without any
 * technical vocabulary. Underneath, "Show source detail" reveals the source id, the content hash,
 * and the retrieval time for anyone who needs to audit rather than skim.
 */
export function Evidence({ dossier }: { dossier: Dossier }) {
  const cited = [
    ...dossier.criteria.filter((c) => c.citations.length > 0).map((c) => ({ label: c.name, cites: c.citations })),
    ...dossier.facts.filter((f) => f.citations.length > 0).map((f) => ({ label: `${f.label}: ${f.value}`, cites: f.citations })),
    ...dossier.personFacts
      .filter((f) => f.citations.length > 0)
      .map((f) => ({ label: `${f.label}: ${f.value}`, cites: f.citations })),
  ];

  if (cited.length === 0) {
    return (
      <p className="sm muted" style={{ margin: 0 }}>
        No document could be retrieved for this company, so nothing here is asserted. LeadMoor stores a fact only
        when a document supports it.
      </p>
    );
  }

  return (
    <div className="col g6">
      {cited.slice(0, 12).map((group, i) => (
        <details key={`${group.label}-${i}`} className="ev">
          <summary>
            <span className="row g8" style={{ alignItems: 'baseline' }}>
              <strong style={{ color: 'var(--ink)', fontWeight: 550 }}>{group.label}</strong>
            </span>
            <span className="quote" style={{ display: 'block', marginTop: 6 }}>
              “{group.cites[0]?.quote}”
            </span>
          </summary>
          <div className="ev__b">
            {group.cites.map((c, j) => (
              <Cite key={`${c.evidenceId}-${j}`} c={c} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function Cite({ c }: { c: Citation }) {
  const [detail, setDetail] = useState(false);
  const [context, setContext] = useState<string | null>(null);

  const loadContext = async () => {
    if (context !== null) return;
    const doc = await loadEvidenceText(c.evidenceId);
    if (!doc) return setContext('');
    const at = doc.text.indexOf(c.quote);
    setContext(at < 0 ? doc.text.slice(0, 500) : doc.text.slice(Math.max(0, at - 260), at + c.quote.length + 260));
  };

  return (
    <div className="col g8">
      <div className="row g8 wrap">
        <span className="mono xs faint truncate">{c.host}</span>
        {c.verified ? (
          <span className="pill pill--ok" title="This quote was found byte-for-byte in the stored document.">
            <IconCheck />
            Verified in document
          </span>
        ) : (
          <span className="pill pill--crit" title="The quote is no longer present in the stored document.">
            Quote not found
          </span>
        )}
        <div className="grow" />
        <a href={c.url} target="_blank" rel="noreferrer noopener" className="btn btn--ghost btn--sm">
          <IconExternal />
          Open
        </a>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            setDetail((v) => !v);
            void loadContext();
          }}
          aria-expanded={detail}
        >
          {detail ? 'Hide detail' : 'Show source detail'}
        </button>
      </div>

      {detail ? (
        <>
          {context ? (
            <p className="quote" style={{ margin: 0, maxHeight: 180, overflowY: 'auto' }}>
              …
              {context.split(c.quote).map((part, i, all) => (
                <span key={i}>
                  {part}
                  {i < all.length - 1 ? <mark>{c.quote}</mark> : null}
                </span>
              ))}
              …
            </p>
          ) : null}
          <dl className="prov">
            <dt>Source</dt>
            <dd>{c.sourceId}</dd>
            <dt>Retrieved</dt>
            <dd>{new Date(c.fetchedAt).toLocaleString()}</dd>
            <dt>Hash</dt>
            <dd>{c.contentHash}</dd>
            <dt>URL</dt>
            <dd>{c.url}</dd>
          </dl>
        </>
      ) : null}
    </div>
  );
}
