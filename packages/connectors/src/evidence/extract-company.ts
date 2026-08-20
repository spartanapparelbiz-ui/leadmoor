import type { ClaimInput, EvidenceRecord } from '@leadmoor/core';
import { spanFor } from '@leadmoor/evidence';

/**
 * Deterministic company fact extraction from retrieved documents.
 *
 * Each extractor returns a claim only when it can point at the exact text it read the value from.
 * Nothing is inferred: if a page never states a headcount, no headcount claim is produced, and the
 * scorer reports that criterion as unknown rather than guessing a plausible number.
 */

export type PartialClaim = Omit<ClaimInput, 'subjectId' | 'runId'>;

/** "142 employees", "~250 employees", "50-200 employees", "over 1,000 employees". */
const EMPLOYEE_PATTERNS: RegExp[] = [
  /\b(?:approximately\s+|about\s+|around\s+|over\s+|more than\s+|~)?([0-9][0-9,]{0,6})\s*\+?\s*(?:full[- ]time\s+)?(?:employees|people|team members|staff|engineers on staff)\b/gi,
  /\bteam of\s+(?:over\s+|more than\s+|about\s+|~)?([0-9][0-9,]{0,6})\b/gi,
  /\b([0-9][0-9,]{0,6})\s*[-–]\s*([0-9][0-9,]{0,6})\s+employees\b/gi,
  /\bwe(?:'re| are)\s+(?:a\s+)?(?:team of\s+)?([0-9][0-9,]{0,6})\s+(?:people|employees|strong)\b/gi,
];

/** US state names and abbreviations, used to attribute a location claim. */
const US_LOCATION = /\b(?:San Francisco|New York|Boston|Seattle|Austin|Denver|Chicago|Los Angeles|Atlanta|Portland|Miami|Washington,? D\.?C\.?|United States|USA|U\.S\.A?\.?)\b/g;

export function extractCompanyClaims(evidence: EvidenceRecord[], sourceId: string): PartialClaim[] {
  const claims: PartialClaim[] = [];

  for (const doc of evidence) {
    const text = doc.normalizedText;

    const headcount = extractEmployeeCount(doc);
    if (headcount) claims.push(headcount);

    // Location, only from pages that plausibly state it.
    if (doc.documentRole === 'company_about' || doc.documentRole === 'company_home') {
      const match = US_LOCATION.exec(text);
      US_LOCATION.lastIndex = 0;
      if (match?.[0]) {
        const span = spanFor(doc.id, text, match[0], 60);
        if (span) {
          claims.push({
            subjectType: 'company',
            field: 'company.location',
            fieldClass: 'company_firmographic',
            value: match[0],
            spans: [span],
            sourceId,
            extractor: 'pattern_match',
            confidence: 0.62,
          });
        }
      }
    }
  }

  return claims;
}

/**
 * Pull a headcount from a document, preferring the first plausible statement.
 *
 * Values outside a believable band are discarded rather than clamped — a page that says
 * "10,000,000 people trust us" is marketing about users, not a headcount, and treating it as one
 * would be exactly the kind of invented fact this system exists to prevent.
 */
export function extractEmployeeCount(doc: EvidenceRecord): PartialClaim | null {
  const text = doc.normalizedText;

  for (const pattern of EMPLOYEE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const whole = match[0];
      const lower = whole.toLowerCase();

      // Reject counts that are clearly about customers, users, or downloads.
      const contextStart = Math.max(0, (match.index ?? 0) - 60);
      const context = text.slice(contextStart, (match.index ?? 0) + whole.length + 40).toLowerCase();
      if (/\b(customers?|users?|downloads?|companies|developers use|businesses|clients?)\b/.test(context)) continue;

      const first = toInt(match[1]);
      const second = match[2] === undefined ? null : toInt(match[2]);
      if (first === null) continue;

      const value = second === null ? first : Math.round((first + second) / 2);
      if (value < 2 || value > 500_000) continue;

      const span = spanFor(doc.id, text, whole.trim(), 40);
      if (!span) continue;

      return {
        subjectType: 'company',
        field: 'company.employeeCount',
        fieldClass: 'company_firmographic',
        value,
        spans: [span],
        sourceId: doc.sourceId,
        extractor: 'pattern_match',
        // A self-reported headcount on a company page is decent but not registry-grade.
        confidence: lower.includes('employees') ? 0.72 : 0.6,
      };
    }
  }
  return null;
}

function toInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
