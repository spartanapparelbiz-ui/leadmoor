import { describe, expect, it } from 'vitest';
import { confidenceOf, sourceName } from '../../apps/web/src/lib/lead.js';

/**
 * The rules that stop the interface overstating what the pipeline established.
 *
 * These are small functions on purpose: a lead's confidence and the words next to it are the two
 * things a user reads fastest, so they are the two easiest to get subtly wrong.
 */

describe('confidence describes the evidence, not the score', () => {
  it('is high only when most criteria were checked against more than one source', () => {
    expect(confidenceOf(1, 3, true)).toBe('high');
    expect(confidenceOf(0.85, 2, true)).toBe('high');
  });

  it('drops to medium when everything rests on a single source', () => {
    // Full coverage from one source is not the same claim as full coverage from three.
    expect(confidenceOf(1, 1, true)).toBe('medium');
  });

  it('drops to medium when only part of the rubric could be checked', () => {
    expect(confidenceOf(0.6, 4, true)).toBe('medium');
  });

  it('is low when little could be established', () => {
    expect(confidenceOf(0.3, 2, true)).toBe('low');
    expect(confidenceOf(0, 0, true)).toBe('low');
  });

  it('is never high for a lead that could not be ranked at all', () => {
    // An unranked lead has no score to be confident about, whatever its coverage happens to read.
    expect(confidenceOf(1, 5, false)).toBe('low');
  });
});

describe('sources are named, not shown as identifiers', () => {
  it('gives a readable name to each connector', () => {
    expect(sourceName('company_web')).toBe('Company site');
    expect(sourceName('github_public')).toBe('GitHub');
    expect(sourceName('sec_edgar')).toBe('SEC EDGAR');
  });

  it('falls back readably for a connector added later', () => {
    expect(sourceName('some_new_provider')).toBe('some new provider');
  });
});
