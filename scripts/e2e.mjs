/**
 * End-to-end test against a running LeadMoor server.
 *
 * Drives the real application in a real browser: types a request, reviews the compiled spec,
 * approves it, watches the run, opens a dossier, inspects evidence, suppresses a lead, and
 * exports. Nothing is stubbed — this exercises the deployed app exactly as a user would.
 *
 * Usage:
 *   pnpm demo:seed                        # gives the results screens something real to show
 *   pnpm build && pnpm start              # or pnpm dev
 *   node scripts/e2e.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function psql(sql) {
  try {
    return execFileSync('su', ['-', 'postgres', '-c', `psql -tA -d leadmoor -c "${sql}"`], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  // Font requests are blocked in sandboxed environments; that is not an application error.
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET|fonts\.googleapis/.test(m.text())) {
    consoleErrors.push(m.text());
  }
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  /* ── 1. intake ─────────────────────────────────────────────────────── */
  console.log('\n1. Request intake');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('home page loads', await page.locator('h1', { hasText: 'Find your next customers' }).isVisible());
  check('input is obvious', await page.locator('#request').isVisible());
  check('provider status is shown', await page.getByText(/not configured|Language model ready/i).first().isVisible());

  await page.locator('button', { hasText: 'Find 20 US B2B SaaS' }).first().click();
  const typed = await page.locator('#request').inputValue();
  check('an example fills the input', typed.length > 40);

  /* ── 2. spec review and approval gate ──────────────────────────────── */
  console.log('\n2. Spec review');
  await page.locator('button', { hasText: 'Build search' }).click();
  await page.waitForURL(/\/searches\/[0-9a-f-]{36}/, { timeout: 60_000 });
  check('redirected to a spec for review', /\/searches\//.test(page.url()));

  check('spec shows the parsed search', await page.getByText('Your search').isVisible());
  check('geography is shown', await page.locator('dd', { hasText: 'US' }).first().isVisible());
  check('scoring rubric is shown', await page.getByText('How leads will be scored').isVisible());
  check('approval is required before running', await page.getByRole('button', { name: /Approve/ }).isVisible());

  await page.getByRole('button', { name: 'Open editor' }).click();
  check('spec is editable', await page.locator('#spec-json').isVisible());
  const specText = await page.locator('#spec-json').inputValue();
  check('editor holds the real spec', specText.includes('"rubric"') && specText.includes('"budget"'));

  await page.locator('#spec-json').fill('{ not json');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(1200);
  check('invalid edits are rejected with a reason', await page.getByText(/not valid JSON/i).isVisible());

  const specUrl = page.url();

  /* ── 3. run ────────────────────────────────────────────────────────── */
  console.log('\n3. Run');
  await page.goto(specUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Approve/ }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}/, { timeout: 60_000 });
  check('approval starts a run', /\/runs\//.test(page.url()));
  check('progress is shown', await page.getByText('Progress', { exact: true }).first().isVisible());

  // Wait for the run to reach a terminal state. Status chips are uppercased by CSS, so innerText
  // comes back as "FAILED" rather than "Failed" — match case-insensitively.
  await page.waitForFunction(
    () => /completed|partial|failed|budget reached|run stopped/i.test(document.body.innerText),
    undefined,
    { timeout: 120_000 },
  );
  const runText = await page.locator('body').innerText();
  const terminal = /completed|partial|failed|budget reached|run stopped/i.test(runText);
  check('run reaches a terminal state', terminal);

  const producedLeads = /qualified leads/i.test(runText);
  if (producedLeads) {
    check('leads were produced', true);
  } else {
    // The honest outcome when discovery sources are unreachable.
    check(
      'a run with no leads states why, rather than looking successful',
      /Run stopped|No leads produced|not configured/i.test(runText),
      runText.slice(0, 160),
    );
  }

  /* ── 4. results, dossier, evidence ─────────────────────────────────── */
  console.log('\n4. Results and dossier (against the seeded demo run)');
  const demoRun = psql('select id from run where is_demo order by created_at desc limit 1');
  if (!demoRun) {
    console.log('  ! no demo run seeded — run `pnpm demo:seed` first. Skipping result screens.');
  } else {
    await page.goto(`${BASE}/runs/${demoRun}`, { waitUntil: 'networkidle' });
    check('demo data is labelled', await page.getByText('Demo data.').first().isVisible());
    check('qualified leads are listed', await page.getByText(/qualified leads/i).first().isVisible());
    check('coverage is shown beside each score', (await page.getByText(/% evidence/).count()) > 0);
    check(
      'a company with no discoverable person says so',
      (await page.getByText(/no match found/i).count()) > 0,
    );

    await page.getByRole('link', { name: 'Open dossier' }).first().click();
    await page.waitForURL(/\/leads\/[0-9a-f-]{36}/, { timeout: 30_000 });
    check('dossier opens', /\/leads\//.test(page.url()));
    check('dossier explains why', await page.getByText('Why this company').isVisible());
    check('criteria are itemised', await page.getByText('Qualification criteria').isVisible());
    check('sources are listed', await page.getByText(/^sources$/i).first().isVisible());

    const criterion = page.locator('details.evidence').first();
    await criterion.locator('summary').click();
    await page.waitForTimeout(400);
    const quote = criterion.locator('blockquote.quote').first();
    const hasQuote = (await quote.count()) > 0;
    check('a claim reveals the evidence behind it', hasQuote);
    if (hasQuote) {
      const caption = await criterion.locator('figcaption').first().innerText();
      check('citation carries source and retrieval time', /retrieved \d{4}-\d{2}-\d{2}/.test(caption), caption.slice(0, 80));
      check('citation carries the exact span offsets', /chars \d+–\d+/.test(caption), caption.slice(0, 80));
    }

    const emailState = await page.getByText(/email verified|email unverified|no email/i).first().innerText();
    check('contact state is explicit', /verified|unverified|No email/i.test(emailState), emailState);

    /* ── 5. export ───────────────────────────────────────────────────── */
    console.log('\n5. Export');
    await page.goto(`${BASE}/runs/${demoRun}`, { waitUntil: 'networkidle' });
    const before = Number(psql(`select count(*) from lead where run_id='${demoRun}' and status='qualified'`) || '0');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    await page.waitForTimeout(2500);
    const exportMsg = await page.locator('body').innerText();
    check('export reports what it produced', /lead\(s\) exported/i.test(exportMsg), exportMsg.match(/[^\n]*exported[^\n]*/)?.[0] ?? '');

    /* ── 6. suppression ──────────────────────────────────────────────── */
    console.log('\n6. Suppression');
    await page.getByRole('link', { name: 'Open dossier' }).first().click();
    await page.waitForURL(/\/leads\//, { timeout: 30_000 });
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Suppress this lead' }).click();
    await page.waitForTimeout(2500);
    check('suppression confirms', await page.getByText(/Suppressed|not appear in results/i).first().isVisible());

    const suppressed = Number(psql("select count(*) from suppression") || '0');
    check('a suppression key was written', suppressed > 0);

    await page.goto(`${BASE}/runs/${demoRun}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Export CSV' }).click();
    await page.waitForTimeout(2500);
    const after = Number(psql(`select count(*) from lead where run_id='${demoRun}' and status='qualified'`) || '0');
    check('suppression removes the lead from qualified results', after < before, `${before} → ${after}`);

    /* ── 7. deletion ─────────────────────────────────────────────────── */
    console.log('\n7. Deletion');
    const personRow = psql(
      `select p.id from person p join lead l on l.person_id = p.id where l.run_id='${demoRun}' limit 1`,
    );
    if (personRow) {
      const leadRow = psql(`select id from lead where person_id='${personRow}' limit 1`);
      await page.goto(`${BASE}/leads/${leadRow}`, { waitUntil: 'networkidle' });
      const claimsBefore = Number(psql(`select count(*) from claim where subject_id='${personRow}'`) || '0');
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: 'Delete this person' }).click();
      await page.waitForTimeout(3000);
      const claimsAfter = Number(psql(`select count(*) from claim where subject_id='${personRow}'`) || '0');
      const personGone = Number(psql(`select count(*) from person where id='${personRow}'`) || '0');
      check('deletion removes the person record', personGone === 0);
      check('deletion removes their claims', claimsBefore > 0 && claimsAfter === 0, `${claimsBefore} → ${claimsAfter}`);
      const orphanEmails = Number(
        psql(`select count(*) from lead where person_id is null and email is not null`) || '0',
      );
      check('no orphaned contact data remains', orphanEmails === 0);
    } else {
      console.log('  ! no person attached to a lead — skipping deletion checks');
    }

    /* ── 8. audit ────────────────────────────────────────────────────── */
    console.log('\n8. Audit');
    await page.goto(`${BASE}/runs/${demoRun}/audit`, { waitUntil: 'networkidle' });
    const audit = await page.locator('body').innerText();
    // Action chips are uppercased by CSS, so compare case-insensitively.
    const auditLower = audit.toLowerCase();
    for (const action of ['run.created', 'document.retrieved', 'claim.created', 'score.generated']) {
      check(`audit records ${action}`, auditLower.includes(action));
    }
    check('audit records the deletion', auditLower.includes('record.deleted') || !personRow);
    check('audit contains no credential', !/sk-ant|ghp_|postgres:\/\//.test(audit));
  }

  /* ── 9. errors ─────────────────────────────────────────────────────── */
  console.log('\n9. Error handling');
  // Everything after this point navigates to a deliberately missing record.
  const errorsBeforeIntentional404 = consoleErrors.length;
  const missing = await page.goto(`${BASE}/leads/00000000-0000-0000-0000-000000000000`);
  check('a missing record 404s cleanly', missing?.status() === 404);
  check('404 page is helpful', await page.getByText('Not found').first().isVisible());

  console.log('\n10. Console health');
  check(
    'no unexpected console errors',
    errorsBeforeIntentional404 === 0,
    consoleErrors.slice(0, 3).join(' | '),
  );
} catch (error) {
  failed += 1;
  failures.push(`threw: ${error.message}`);
  console.error('\nE2E threw:', error.message);
} finally {
  await browser.close();
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`E2E: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
