'use client';

import { useState } from 'react';
import type { Citation } from '@/lib/actions/dossier';
import { loadEvidenceText } from '@/lib/actions/dossier';
import { IconCheck, IconExternal } from '../Icons';

/**
 * Evidence, with progressive disclosure.
 *
 * The first thing a user sees is the sentence itself — that is the claim's whole justification and
 * it should be readable without any technical vocabulary. Underneath, "Show technical provenance"
 * reveals the source id, the content hash, the retrieval time, and the document role, for the
 * reader who needs to audit rather than skim.
 */
export function EvidenceList({ citations, emptyNote }: { citations: Citation[]; emptyNote?: string }) {
  if (citations.length === 0) {
    return (
      <p className="muted t-sm" style={{ margin: 0 }}>
        {emptyNote ?? 'No document was cited for this.'}
      </p>
    );
  }

  return (
    <div className="col g-6">
      {citations.map((c, i) => (
        <EvidenceRow key={`${c.evidenceId}-${i}`} citation={c} />
      ))}
    </div>
  );
}

export function EvidenceRow({ citation }: { citation: Citation }) {
  const [showProvenance, setShowProvenance] = useState(false);
  const [context, setContext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const openContext = async () => {
    if (context !== null || loading) return;
    setLoading(true);
    try {
      const doc = await loadEvidenceText(citation.evidenceId);
      if (doc) {
        const at = doc.text.indexOf(citation.quote);
        setContext(
          at < 0
            ? doc.text.slice(0, 600)
            : doc.text.slice(Math.max(0, at - 320), at + citation.quote.length + 320),
        );
      } else {
        setContext('');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <details className="evrow" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void openContext()}>
      <summary>
        <span className="quote">“{citation.quote}”</span>
        <span className="row g-6" style={{ marginTop: 4 }}>
          <span className="mono t-xs faint truncate">{citation.host}</span>
          {citation.verified ? (
            <span className="pill pill--ok" title="This quote was found byte-for-byte in the stored document.">
              <IconCheck />
              Verified in document
            </span>
          ) : (
            <span
              className="pill pill--crit"
              title="The quote is no longer present in the stored document. This citation should not be relied on."
            >
              Quote not found
            </span>
          )}
        </span>
      </summary>

      <div className="evrow__body col g-10">
        {loading ? <span className="skeleton" style={{ height: 48 }} /> : null}
        {context ? (
          <p className="quote quote--context" style={{ margin: 0 }}>
            …{context.split(citation.quote).map((part, i, arr) => (
              <span key={i}>
                {part}
                {i < arr.length - 1 ? <mark>{citation.quote}</mark> : null}
              </span>
            ))}
            …
          </p>
        ) : null}
        {context === '' ? (
          <p className="muted t-sm" style={{ margin: 0 }}>
            The stored document is no longer available — it may have been removed by a deletion request.
          </p>
        ) : null}

        <div className="row g-8 wrap">
          <a href={citation.url} target="_blank" rel="noreferrer noopener" className="btn btn--ghost btn--sm">
            <IconExternal />
            Open source page
          </a>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setShowProvenance((v) => !v)}
            aria-expanded={showProvenance}
          >
            {showProvenance ? 'Hide technical provenance' : 'Show technical provenance'}
          </button>
        </div>

        {showProvenance ? (
          <dl className="provenance">
            <dt>Source</dt>
            <dd className="mono">{citation.sourceId}</dd>
            <dt>Document role</dt>
            <dd className="mono">{citation.documentRole}</dd>
            <dt>Retrieved</dt>
            <dd className="mono">{new Date(citation.fetchedAt).toLocaleString()}</dd>
            <dt>Content hash</dt>
            <dd className="mono" style={{ wordBreak: 'break-all' }}>
              {citation.contentHash}
            </dd>
            <dt>URL</dt>
            <dd className="mono" style={{ wordBreak: 'break-all' }}>
              {citation.url}
            </dd>
          </dl>
        ) : null}
      </div>
    </details>
  );
}
