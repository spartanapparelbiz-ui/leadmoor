import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { sha256, type EvidenceRecord } from '@leadmoor/core';
import { EvidenceStore, MemoryBlobStore, ProvenanceValidator, findTermSpans, locateQuote, spanFor, verifySpan, htmlToText } from '@leadmoor/evidence';
import { openTestDb, seedRun, type TestDb } from '../helpers/db.js';

const PAGE = `Acme Systems is a security company. We are hiring a Senior Security Engineer to join our
platform team. Our infrastructure runs on Kubernetes across three regions. Reach Jane Okafor, our
Chief Technology Officer, at jane.okafor@acme.example for partnership enquiries. We have 142
employees.`;

describe('evidence store', () => {
  let tdb: TestDb;
  let store: EvidenceStore;
  let blobs: MemoryBlobStore;
  let record: EvidenceRecord;

  beforeAll(async () => {
    tdb = await openTestDb();
  });
  afterAll(async () => {
    await tdb.close();
  });

  beforeEach(async () => {
    await tdb.truncate();
    blobs = new MemoryBlobStore();
    store = new EvidenceStore(tdb.db, blobs);
    record = await store.put({
      runId: null,
      sourceId: 'company_web',
      url: 'https://acme.example/about',
      documentRole: 'company_about',
      rawBody: PAGE,
      normalizedText: PAGE,
      robotsDecision: 'allowed',
    });
  });

  it('content-addresses the stored document', async () => {
    expect(record.contentHash).toBe(sha256(PAGE));
    expect(await blobs.get(record.contentHash)).toBe(PAGE);
  });

  it('round-trips the original bytes so a score can be re-audited', async () => {
    expect(await store.rawBody(record.id)).toBe(PAGE);
    expect(await store.verifyIntegrity(record.id)).toBe(true);
  });

  it('reads a document back by id after the cache is bypassed', async () => {
    const fresh = new EvidenceStore(tdb.db, blobs);
    const loaded = await fresh.get(record.id);
    expect(loaded?.url).toBe('https://acme.example/about');
    expect(loaded?.normalizedText).toBe(PAGE);
  });

  it('reports a missing document rather than inventing one', async () => {
    expect(await store.get('does-not-exist')).toBeNull();
    expect(await store.verifyIntegrity('does-not-exist')).toBe(false);
  });
});

describe('span location', () => {
  it('finds an exact quote and returns real offsets', () => {
    const found = locateQuote(PAGE, 'Senior Security Engineer');
    expect(found?.how).toBe('exact');
    expect(PAGE.slice(found!.start, found!.end)).toBe('Senior Security Engineer');
  });

  it('finds a quote whose whitespace differs from the document', () => {
    const found = locateQuote(PAGE, 'Chief   Technology  Officer');
    expect(found?.how).toBe('fuzzy');
    expect(PAGE.slice(found!.start, found!.end)).toBe('Chief Technology Officer');
  });

  it('returns null for text that is genuinely not present', () => {
    expect(locateQuote(PAGE, 'we are SOC 2 Type II certified')).toBeNull();
  });

  it('repairs wrong offsets when the quote really is in the document', () => {
    const result = verifySpan(PAGE, { evidenceId: 'e1', start: 0, end: 5, quote: 'Kubernetes' });
    expect(result.verification).toBe('repaired');
    expect(PAGE.slice(result.corrected!.start, result.corrected!.end)).toBe('Kubernetes');
  });

  it('reports an absent quote rather than repairing it into existence', () => {
    const result = verifySpan(PAGE, { evidenceId: 'e1', start: 0, end: 5, quote: 'FedRAMP authorized' });
    expect(result.verification).toBe('absent');
    expect(result.corrected).toBeNull();
  });

  it('returns sentence context for a matched term', () => {
    const spans = findTermSpans('e1', PAGE, 'Kubernetes');
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0]!.quote).toContain('Kubernetes');
    expect(PAGE.slice(spans[0]!.start, spans[0]!.end)).toBe(spans[0]!.quote);
  });

  it('builds a span with surrounding context that still matches the document', () => {
    const span = spanFor('e1', PAGE, '142', 20);
    expect(span).not.toBeNull();
    expect(PAGE.slice(span!.start, span!.end)).toBe(span!.quote);
  });
});

describe('ProvenanceValidator', () => {
  let tdb: TestDb;
  let store: EvidenceStore;
  let validator: ProvenanceValidator;
  let evidenceId: string;
  let runId: string;

  beforeAll(async () => {
    tdb = await openTestDb();
  });
  afterAll(async () => {
    await tdb.close();
  });

  beforeEach(async () => {
    await tdb.truncate();
    const seeded = await seedRun(tdb.db);
    runId = seeded.runId;
    store = new EvidenceStore(tdb.db, new MemoryBlobStore());
    const record = await store.put({
      runId,
      sourceId: 'company_web',
      url: 'https://acme.example/about',
      documentRole: 'company_about',
      rawBody: PAGE,
      normalizedText: PAGE,
      robotsDecision: 'allowed',
    });
    evidenceId = record.id;
    validator = new ProvenanceValidator(store, { runId });
  });

  const base = () => ({
    runId,
    subjectType: 'company' as const,
    subjectId: 'c1',
    sourceId: 'company_web',
    extractor: 'pattern_match' as const,
    confidence: 0.8,
  });

  it('supports a claim whose quote is present in the cited document', async () => {
    const outcome = await validator.validateClaim({
      ...base(),
      field: 'company.employeeCount',
      fieldClass: 'company_firmographic',
      value: 142,
      spans: [{ evidenceId, start: 0, end: 0, quote: '142' }],
    });
    expect(outcome.status).toBe('supported');
    expect(outcome.sourceIds).toEqual(['company_web']);
  });

  it('holds a claim that cites nothing', async () => {
    const outcome = await validator.validateClaim({
      ...base(),
      field: 'company.employeeCount',
      fieldClass: 'company_firmographic',
      value: 142,
      spans: [],
    });
    expect(outcome.status).toBe('insufficient_evidence');
    expect(outcome.reasons.join(' ')).toMatch(/no evidence cited/);
  });

  it('rejects a claim citing an evidence id that does not exist', async () => {
    const outcome = await validator.validateClaim({
      ...base(),
      field: 'company.employeeCount',
      fieldClass: 'company_firmographic',
      value: 142,
      spans: [{ evidenceId: 'fabricated-id', start: 0, end: 3, quote: '142' }],
    });
    expect(outcome.status).toBe('rejected');
    expect(outcome.reasons.join(' ')).toMatch(/does not exist/);
  });

  it('rejects a claim whose quote is not in the cited document', async () => {
    const outcome = await validator.validateClaim({
      ...base(),
      field: 'company.certifications',
      fieldClass: 'company_signal',
      value: 'SOC 2 Type II',
      spans: [{ evidenceId, start: 0, end: 10, quote: 'we are SOC 2 Type II certified' }],
    });
    expect(outcome.status).toBe('rejected');
    expect(outcome.reasons.join(' ')).toMatch(/not present in cited document/);
  });

  it('rejects the whole claim when one of several citations is fabricated', async () => {
    const outcome = await validator.validateClaim({
      ...base(),
      field: 'company.employeeCount',
      fieldClass: 'company_firmographic',
      value: 142,
      spans: [
        { evidenceId, start: 0, end: 0, quote: '142' },
        { evidenceId: 'nope', start: 0, end: 0, quote: '142' },
      ],
    });
    expect(outcome.status).toBe('rejected');
    expect(outcome.spans).toHaveLength(0);
  });

  it('refuses a globally prohibited field class outright', async () => {
    const outcome = await validator.validateClaim({
      ...base(),
      field: 'person.mobile',
      fieldClass: 'personal_direct_contact',
      value: '+1 555 0100',
      spans: [{ evidenceId, start: 0, end: 0, quote: '142' }],
    });
    expect(outcome.status).toBe('rejected');
    expect(outcome.reasons.join(' ')).toMatch(/prohibited by data minimization/);
  });

  it('refuses a field class the source is not permitted to supply', async () => {
    const strict = new ProvenanceValidator(store, {
      runId,
      fieldClassPermitted: (_sourceId, fieldClass) => fieldClass !== 'person_work_email',
    });
    const outcome = await strict.validateClaim({
      ...base(),
      field: 'person.workEmail',
      fieldClass: 'person_work_email',
      value: 'jane.okafor@acme.example',
      spans: [{ evidenceId, start: 0, end: 0, quote: 'jane.okafor@acme.example' }],
    });
    expect(outcome.status).toBe('rejected');
    expect(outcome.reasons.join(' ')).toMatch(/not permitted to supply/);
  });

  it('accepts an email that literally appears in the cited document', async () => {
    const outcome = await validator.validateClaim({
      ...base(),
      field: 'person.workEmail',
      fieldClass: 'person_work_email',
      value: 'jane.okafor@acme.example',
      spans: [{ evidenceId, start: 0, end: 0, quote: 'jane.okafor@acme.example' }],
    });
    expect(outcome.status).toBe('supported');
  });

  it('rejects a plausible but fabricated email that is not in the document', async () => {
    const outcome = await validator.validateClaim({
      ...base(),
      field: 'person.workEmail',
      fieldClass: 'person_work_email',
      // The classic guessed pattern. It looks right and is nowhere in the page.
      value: 'j.okafor@acme.example',
      spans: [{ evidenceId, start: 0, end: 0, quote: 'Chief Technology Officer' }],
    });
    expect(outcome.status).toBe('rejected');
    expect(outcome.reasons.join(' ')).toMatch(/does not appear in any cited document/);
  });

  it('rejects a citation borrowed from a different run', async () => {
    const other = new ProvenanceValidator(store, { runId: 'run-2-does-not-exist' });
    const outcome = await other.validateClaim({
      ...base(),
      runId: 'run-2-does-not-exist',
      field: 'company.employeeCount',
      fieldClass: 'company_firmographic',
      value: 142,
      spans: [{ evidenceId, start: 0, end: 0, quote: '142' }],
    });
    expect(outcome.status).toBe('rejected');
    expect(outcome.reasons.join(' ')).toMatch(/different run/);
  });

  it('decays confidence with evidence age', async () => {
    const future = new ProvenanceValidator(store, {
      runId,
      now: () => new Date(Date.now() + 400 * 86_400_000),
    });
    const outcome = await future.validateClaim({
      ...base(),
      field: 'company.employeeCount',
      fieldClass: 'company_firmographic',
      value: 142,
      spans: [{ evidenceId, start: 0, end: 0, quote: '142' }],
      confidence: 0.9,
    });
    expect(outcome.status).toBe('supported');
    expect(outcome.confidence).toBeLessThan(0.5);
  });

  it('drops evidence older than the spec allows', async () => {
    const strict = new ProvenanceValidator(store, {
      runId,
      maxEvidenceAgeDays: 1,
      now: () => new Date(Date.now() + 10 * 86_400_000),
    });
    const outcome = await strict.validateClaim({
      ...base(),
      field: 'company.employeeCount',
      fieldClass: 'company_firmographic',
      value: 142,
      spans: [{ evidenceId, start: 0, end: 0, quote: '142' }],
    });
    expect(outcome.status).toBe('insufficient_evidence');
  });

  describe('LLM judge responses', () => {
    it('accepts a verdict whose quotes are all present', async () => {
      const result = await validator.validateJudgeResponse(
        {
          verdict: 'pass',
          confidence: 0.8,
          citations: [{ evidenceId, quote: 'hiring a Senior Security Engineer' }],
          reasoning: 'the page advertises a security engineering role',
        },
        [evidenceId],
      );
      expect(result.ok).toBe(true);
      expect(result.spans).toHaveLength(1);
    });

    it('rejects a verdict quoting text that is not in the document', async () => {
      const result = await validator.validateJudgeResponse(
        {
          verdict: 'pass',
          confidence: 0.9,
          citations: [{ evidenceId, quote: 'Acme is SOC 2 Type II certified' }],
          reasoning: 'invented',
        },
        [evidenceId],
      );
      expect(result.ok).toBe(false);
      expect(result.reasons.join(' ')).toMatch(/quote not found/);
    });

    it('rejects a verdict citing a document the judge was never shown', async () => {
      const result = await validator.validateJudgeResponse(
        {
          verdict: 'pass',
          confidence: 0.9,
          citations: [{ evidenceId, quote: 'Kubernetes' }],
          reasoning: 'x',
        },
        ['some-other-doc'],
      );
      expect(result.ok).toBe(false);
      expect(result.reasons.join(' ')).toMatch(/was not supplied to the judge/);
    });

    it('rejects a pass verdict that cites nothing at all', async () => {
      const result = await validator.validateJudgeResponse(
        { verdict: 'pass', confidence: 0.9, citations: [], reasoning: 'trust me' },
        [evidenceId],
      );
      expect(result.ok).toBe(false);
    });

    it('allows an unknown verdict to cite nothing', async () => {
      const result = await validator.validateJudgeResponse(
        { verdict: 'unknown', confidence: 0, citations: [], reasoning: 'documents do not say' },
        [evidenceId],
      );
      expect(result.ok).toBe(true);
    });
  });
});

describe('html normalization', () => {
  it('strips scripts and styles so their contents can never be cited as page text', () => {
    const text = htmlToText('<html><head><style>.a{color:red}</style><script>var secret=1</script></head><body><p>Hello</p></body></html>');
    expect(text).toBe('Hello');
    expect(text).not.toContain('secret');
  });

  it('is idempotent, so spans stay valid across re-normalization', () => {
    const once = htmlToText('<div>A  B</div><p>C</p>');
    expect(htmlToText(once)).toBe(once);
  });

  it('decodes entities', () => {
    expect(htmlToText('<p>Tom &amp; Jerry &mdash; 50&nbsp;employees</p>')).toBe('Tom & Jerry - 50 employees');
  });
});
