import { describe, expect, it } from 'vitest';
import { checkRateLimit, createLogger, redact, resetRateLimits, suppressionKey } from '@leadmoor/core';
import { toCsv, EXPORT_COLUMNS } from '@leadmoor/export';

describe('secret redaction', () => {
  it('redacts credential-shaped keys', () => {
    const out = redact({ apiKey: 'sk-ant-abcdef123456', nested: { authorization: 'Bearer xyz' }, safe: 'ok' });
    expect(JSON.stringify(out)).not.toContain('sk-ant-abcdef123456');
    expect(JSON.stringify(out)).not.toContain('Bearer xyz');
    expect(JSON.stringify(out)).toContain('ok');
  });

  it('redacts credential-shaped values even under an innocuous key', () => {
    const out = redact({ note: 'the key is sk-ant-api03-abcdefghijklmnop' });
    expect(JSON.stringify(out)).not.toContain('sk-ant-api03-abcdefghijklmnop');
  });

  it('redacts a token inside an error message', () => {
    const out = redact(new Error('request failed with ghp_abcdefghijklmnopqrstuvwxyz01'));
    expect(JSON.stringify(out)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz01');
  });

  it('never writes a secret through the logger', () => {
    const lines: string[] = [];
    const log = createLogger({ service: 'test' }, { level: 'debug', sink: (l) => lines.push(l) });
    log.error('provider failed', { apiKey: 'sk-ant-secret-value-here', url: 'https://api.example/x' });
    expect(lines.join('')).not.toContain('sk-ant-secret-value-here');
    expect(lines.join('')).toContain('api.example');
  });

  it('does not recurse forever on a cyclic object', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => JSON.stringify(redact(a))).not.toThrow();
  });
});

describe('rate limiting', () => {
  it('permits up to the limit then refuses with a retry hint', () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) expect(checkRateLimit('k', 3, 60_000, 1000).allowed).toBe(true);
    const denied = checkRateLimit('k', 3, 60_000, 1000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('opens a fresh window after the interval', () => {
    resetRateLimits();
    checkRateLimit('w', 1, 1000, 0);
    expect(checkRateLimit('w', 1, 1000, 500).allowed).toBe(false);
    expect(checkRateLimit('w', 1, 1000, 1500).allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    resetRateLimits();
    checkRateLimit('a', 1, 60_000, 0);
    expect(checkRateLimit('b', 1, 60_000, 0).allowed).toBe(true);
  });
});

describe('suppression keys', () => {
  it('stores a hash, never the identifier', () => {
    const key = suppressionKey('email', 'Jane.Okafor@Acme.example');
    expect(key).toMatch(/^email:[0-9a-f]{64}$/);
    expect(key).not.toMatch(/jane|okafor|acme/i);
  });

  it('is case- and whitespace-insensitive so suppression cannot be evaded by formatting', () => {
    expect(suppressionKey('email', ' Jane@Acme.example ')).toBe(suppressionKey('email', 'jane@acme.example'));
  });
});

describe('CSV export safety', () => {
  const row = (over: Record<string, string> = {}) => ({
    company: 'Acme',
    domain: 'acme.example',
    person: 'Jane Okafor',
    role: 'CTO',
    email: '',
    email_status: 'unavailable' as const,
    score: '80',
    coverage: '100%',
    status: 'qualified',
    why_fit: 'x',
    evidence_count: '3',
    source_urls: 'https://acme.example',
    ...over,
  });

  it('neutralizes a formula injection payload', () => {
    const csv = toCsv([row({ company: '=cmd|/c calc' })]);
    expect(csv).not.toMatch(/(^|,)=cmd/m);
    expect(csv).toContain("'=cmd");
  });

  it('quotes values containing commas, quotes, or newlines', () => {
    const csv = toCsv([row({ why_fit: 'a,b "quoted"\nnext' })]);
    expect(csv).toContain('"a,b ""quoted""\nnext"');
  });

  it('emits every declared column in the header', () => {
    expect(toCsv([]).split('\n')[0]).toBe(EXPORT_COLUMNS.join(','));
  });
});
