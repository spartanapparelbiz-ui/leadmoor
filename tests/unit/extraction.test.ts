import { describe, expect, it } from 'vitest';
import type { EvidenceRecord } from '@leadmoor/core';
import {
  canonicalTitle,
  extractCompanyClaims,
  extractEmployeeCount,
  extractPeople,
  isFabricatedEmailShape,
  rankAgainstPersona,
} from '@leadmoor/connectors';
import { htmlToText } from '@leadmoor/evidence';
import { normalizeCompanyName, registrableDomain, resolve, nameSimilarity } from '@leadmoor/resolution';

function doc(text: string, role: EvidenceRecord['documentRole'] = 'company_team', id = 'e1'): EvidenceRecord {
  return {
    id,
    runId: 'r',
    sourceId: 'company_web',
    url: 'https://acme.example/team',
    title: null,
    documentRole: role,
    httpStatus: 200,
    contentHash: 'h',
    contentType: 'text/html',
    normalizedText: text,
    byteLength: text.length,
    fetchedAt: new Date(),
    robotsDecision: 'allowed',
    metadata: {},
  };
}

const PERSONA = { titles: ['CTO', 'VP Engineering'], seniority: [], functions: [], maxPerCompany: 3 };

describe('person extraction', () => {
  it('finds a name and role adjacent on a team page', () => {
    const people = extractPeople([doc('Jane Okafor - Chief Technology Officer')], {
      persona: PERSONA,
      maxPeople: 3,
      sourceId: 'company_web',
    });
    expect(people).toHaveLength(1);
    expect(people[0]!.fullName).toBe('Jane Okafor');
    expect(people[0]!.role).toBe('Chief Technology Officer');
  });

  it('is not defeated by a heading on the preceding line', () => {
    // Regression: a greedy name pattern absorbed the heading, and the whole candidate was dropped.
    const text = htmlToText('<h1>Leadership</h1><ul><li><strong>Priya Raghunathan</strong> &mdash; Chief Technology Officer</li></ul>');
    const people = extractPeople([doc(text)], { persona: PERSONA, maxPeople: 3, sourceId: 'company_web' });
    expect(people.map((p) => p.fullName)).toContain('Priya Raghunathan');
  });

  it('never attributes a title to the next person in a list', () => {
    // Regression: the CTO title was given to the VP listed underneath, along with her email.
    const text = htmlToText(
      '<h1>Leadership</h1><ul>' +
        '<li><strong>Priya Raghunathan</strong> &mdash; Chief Technology Officer. Reach her at priya.raghunathan@nw.example.</li>' +
        '<li><strong>Daniel Okonkwo</strong> &mdash; VP Engineering</li>' +
        '</ul>',
    );
    const people = extractPeople([doc(text)], { persona: PERSONA, maxPeople: 3, sourceId: 'company_web' });

    const cto = people.find((p) => p.role === 'Chief Technology Officer');
    const vp = people.find((p) => p.role === 'VP Engineering');
    expect(cto?.fullName).toBe('Priya Raghunathan');
    expect(vp?.fullName).toBe('Daniel Okonkwo');
  });

  it('ranks the requested title first even when the page spells it out', () => {
    // Regression: asking for "CTO" ranked a "VP Engineering" above a "Chief Technology Officer".
    const text = htmlToText(
      '<ul><li>Daniel Okonkwo &mdash; VP Engineering</li><li>Priya Raghunathan &mdash; Chief Technology Officer</li></ul>',
    );
    const people = extractPeople([doc(text)], { persona: PERSONA, maxPeople: 3, sourceId: 'company_web' });
    expect(people[0]!.fullName).toBe('Priya Raghunathan');
  });

  it('invents nobody when a page has titles but no names', () => {
    const people = extractPeople([doc('We are hiring a Chief Technology Officer. Apply now.')], {
      persona: PERSONA,
      maxPeople: 3,
      sourceId: 'company_web',
    });
    expect(people).toHaveLength(0);
  });

  it('ignores pages where people do not belong', () => {
    const people = extractPeople([doc('Jane Okafor - Chief Technology Officer', 'company_pricing')], {
      persona: PERSONA,
      maxPeople: 3,
      sourceId: 'company_web',
    });
    expect(people).toHaveLength(0);
  });

  it('rejects headings and navigation words as names', () => {
    for (const text of ['Our Team - Chief Technology Officer', 'Open Roles - VP Engineering']) {
      const people = extractPeople([doc(text)], { persona: PERSONA, maxPeople: 3, sourceId: 'company_web' });
      expect(people.every((p) => !/team|roles/i.test(p.fullName))).toBe(true);
    }
  });
});

describe('canonical titles', () => {
  it('maps abbreviations and spelled-out forms to the same key', () => {
    expect(canonicalTitle('CTO')).toBe('cto');
    expect(canonicalTitle('Chief Technology Officer')).toBe('cto');
    expect(canonicalTitle('chief technical officer')).toBe('cto');
    expect(canonicalTitle('VP of Engineering')).toBe('vp_engineering');
    expect(canonicalTitle('Vice President, Engineering')).toBe('vp_engineering');
    expect(canonicalTitle('CISO')).toBe('ciso');
  });

  it('does not confuse a security VP with an engineering VP', () => {
    expect(canonicalTitle('VP of Security')).toBe('vp_security');
    expect(canonicalTitle('VP of Engineering')).toBe('vp_engineering');
  });

  it('returns null for something that is not a recognised role', () => {
    expect(canonicalTitle('Chief Happiness Wizard')).toBeNull();
    expect(canonicalTitle('')).toBeNull();
    expect(canonicalTitle(null)).toBeNull();
  });

  it('ranks by the persona order the user gave', () => {
    expect(rankAgainstPersona('Chief Technology Officer', ['CTO', 'VP Engineering'])).toBe(0);
    expect(rankAgainstPersona('VP Engineering', ['CTO', 'VP Engineering'])).toBe(1);
    expect(rankAgainstPersona(null, ['CTO'])).toBe(1000);
  });
});

describe('employee count extraction', () => {
  const count = (text: string) => extractEmployeeCount(doc(text, 'company_about'))?.value ?? null;

  it('reads an explicit headcount', () => {
    expect(count('We have 142 employees.')).toBe(142);
    expect(count('Approximately 1,200 employees worldwide.')).toBe(1200);
  });

  it('keeps a headcount that happens to mention customers afterwards', () => {
    // Regression: trailing context caused a real headcount to be discarded.
    expect(count('We are a team of 214 employees serving enterprise customers.')).toBe(214);
  });

  it('refuses a customer count dressed as a headcount', () => {
    expect(count('Trusted by 40,000 customers and 9 people love us')).toBeNull();
    expect(count('Over 2,000,000 users trust our team of people')).toBeNull();
  });

  it('reads a published band as its midpoint', () => {
    expect(count('We have 50-200 employees')).toBe(125);
  });

  it('refuses an implausible value rather than clamping it', () => {
    expect(count('We have 900000 employees')).toBeNull();
    expect(count('We have 1 employees')).toBeNull();
  });

  it('produces a span that resolves in the document it cites', () => {
    const d = doc('About us. We have 142 employees in total.', 'company_about');
    const claim = extractEmployeeCount(d);
    expect(claim).not.toBeNull();
    const span = claim!.spans[0]!;
    expect(d.normalizedText.slice(span.start, span.end)).toBe(span.quote);
  });
});

describe('location extraction', () => {
  it('prefers the country phrase when the page has one', () => {
    const claims = extractCompanyClaims([doc('Headquartered in Boston, United States.', 'company_about')], 'company_web');
    const location = claims.find((c) => c.field === 'company.location');
    expect(location?.value).toBe('United States');
  });

  it('still records a city when no country is stated', () => {
    const claims = extractCompanyClaims([doc('Our office is in Seattle.', 'company_about')], 'company_web');
    expect(claims.find((c) => c.field === 'company.location')?.value).toBe('Seattle');
  });

  it('claims no location when the page states none', () => {
    const claims = extractCompanyClaims([doc('We build software.', 'company_about')], 'company_web');
    expect(claims.find((c) => c.field === 'company.location')).toBeUndefined();
  });
});

describe('email shape guard', () => {
  it('recognises the classic guessed permutations', () => {
    for (const local of ['jane.okafor', 'janeokafor', 'jokafor', 'jane_okafor', 'okafor.jane', 'jane']) {
      expect(isFabricatedEmailShape(`${local}@acme.example`, 'Jane Okafor', 'acme.example')).toBe(true);
    }
  });

  it('does not flag an address that is not a name permutation', () => {
    expect(isFabricatedEmailShape('j.o.contact@acme.example', 'Jane Okafor', 'acme.example')).toBe(false);
  });

  it('does not flag an address on a different domain', () => {
    expect(isFabricatedEmailShape('jane.okafor@other.example', 'Jane Okafor', 'acme.example')).toBe(false);
  });
});

describe('company resolution', () => {
  it('normalizes legal suffixes away', () => {
    expect(normalizeCompanyName('Acme Systems, Inc.')).toBe('acme');
    expect(normalizeCompanyName('Acme Systems Limited')).toBe('acme');
    expect(normalizeCompanyName('Northwind Ledger LLC')).toBe('northwind ledger');
  });

  it('finds the registrable domain through subdomains and multi-part TLDs', () => {
    expect(registrableDomain('https://careers.acme.example/jobs')).toBe('acme.example');
    expect(registrableDomain('www.acme.co.uk')).toBe('acme.co.uk');
    expect(registrableDomain('app.acme.co.uk')).toBe('acme.co.uk');
    expect(registrableDomain('not a domain')).toBeNull();
  });

  it('merges records sharing a strong identifier', () => {
    const { canonical, decisions } = resolve([
      { id: 'a', name: 'Acme Systems', domain: null, country: 'US', identifiers: [{ kind: 'cik', value: '0000123', strength: 'strong' }] },
      { id: 'b', name: 'Acme Sys', domain: 'acme.example', country: null, identifiers: [{ kind: 'cik', value: '0000123', strength: 'strong' }] },
    ]);
    expect(canonical).toHaveLength(1);
    expect(decisions[0]!.decision).toBe('merge');
    // The survivor gains what the duplicate knew.
    expect(canonical[0]!.domain).toBe('acme.example');
  });

  it('merges records sharing a registrable domain', () => {
    const { canonical } = resolve([
      { id: 'a', name: 'Acme', domain: 'acme.example', country: null, identifiers: [] },
      { id: 'b', name: 'Acme Systems', domain: 'www.acme.example', country: null, identifiers: [] },
    ]);
    expect(canonical).toHaveLength(1);
  });

  it('keeps two companies apart when their verified domains differ', () => {
    const { canonical, decisions } = resolve([
      { id: 'a', name: 'Acme Systems', domain: 'acme.example', country: null, identifiers: [] },
      { id: 'b', name: 'Acme Systems', domain: 'acme-systems.example', country: null, identifiers: [] },
    ]);
    expect(canonical).toHaveLength(2);
    expect(decisions.every((d) => d.decision !== 'merge')).toBe(true);
  });

  it('merges when the only difference is a stripped legal suffix', () => {
    const { canonical } = resolve([
      { id: 'a', name: 'Northwind Ledger Systems', domain: null, country: null, identifiers: [] },
      { id: 'b', name: 'Northwind Ledger', domain: 'nw.example', country: null, identifiers: [] },
    ]);
    expect(canonical).toHaveLength(1);
  });

  it('flags an uncertain pair for review instead of merging it', () => {
    // Similar enough to be suspicious, not similar enough to merge on: a human decides.
    const { canonical, decisions } = resolve([
      { id: 'a', name: 'Granite Peak Health Analytics Cloud', domain: null, country: null, identifiers: [] },
      { id: 'b', name: 'Granite Peak Health Analytics', domain: null, country: null, identifiers: [] },
    ]);
    expect(canonical).toHaveLength(2);
    expect(decisions.some((d) => d.decision === 'review')).toBe(true);
  });

  it('scores name similarity symmetrically in its arguments', () => {
    expect(nameSimilarity('Acme Systems', 'Acme Systems')).toBe(1);
    expect(nameSimilarity('Northwind Ledger', 'Northwind Data')).toBe(
      nameSimilarity('Northwind Data', 'Northwind Ledger'),
    );
    expect(nameSimilarity('Acme', 'Boreal')).toBeLessThan(0.2);
  });
});
