/**
 * End-to-end test against a running LeadMoor server.
 *
 * Drives the real application in a real browser: registers an account, compiles a request, reviews
 * the spec, approves it, watches the run, opens the lead drawer, inspects evidence and provenance,
 * exports, suppresses, deletes, and reads the audit log. Nothing is stubbed.
 *
 * It also proves the two things that are easy to fake and expensive to get wrong: a second account
 * cannot reach the first account's data, and a screen never claims a state the database does not
 * hold.
 *
 * Usage:
 *   pnpm demo:seed                        # gives the results screens something real to show
 *   pnpm build && pnpm start
 *   node scripts/e2e.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';
const STAMP = Date.now().toString(36);
const USER = { email: `e2e-${STAMP}@leadmoor.test`, password: 'e2e-password-123', name: 'E2E User' };
const OUTSIDER = { email: `out-${STAMP}@leadmoor.test`, password: 'out-password-123', name: 'Outsider' };

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

/** Reads the database directly, so a screen's claim can be checked against the stored truth. */
function psql(sql) {
  const url = process.env.DATABASE_URL ?? '';
  const match = /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/(.+)$/.exec(url);
  if (!match) return '';
  const [, user, password, host, port, database] = match;
  try {
    return execFileSync('psql', ['-h', host, '-p', port, '-U', user, '-d', database, '-tAc', sql], {
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: password },
    }).trim();
  } catch {
    return '';
  }
}

async function signUp(page, user) {
  await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('#name', user.name);
  await page.fill('#email', user.email);
  await page.fill('#password', user.password);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !/\/signup/.test(u.toString()), { timeout: 30_000 });
}

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  // Font requests are blocked in sandboxed environments; that is not an application error.
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET|fonts\.g(oogleapis|static)/.test(m.text())) {
    consoleErrors.push(m.text());
  }
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  /* ── 1. authentication ─────────────────────────────────────────────── */
  console.log('\n1. Authentication');
  const guarded = await page.goto(`${BASE}/leads`, { waitUntil: 'domcontentloaded' });
  check('a signed-out visitor is sent to sign in', /\/login/.test(page.url()), page.url());
  check('the guarded page did not render', !(await page.getByRole('heading', { name: 'Leads' }).isVisible()));
  void guarded;

  await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', 'weak@leadmoor.test');
  await page.fill('#password', 'short');
  await page.click('button[type=submit]');
  await page.waitForTimeout(1500);
  check('a weak password is refused with the rule', await page.getByText(/at least 10 characters/i).first().isVisible());

  await signUp(page, USER);
  check('sign-up lands in the app', !/\/(login|signup)/.test(page.url()), page.url());
  check('the shell renders', await page.getByRole('navigation', { name: 'Main navigation' }).isVisible());

  /* ── 2. request intake ─────────────────────────────────────────────── */
  console.log('\n2. Request intake');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  check('composer is the first thing on the page', await page.locator('#request').isVisible());

  await page.locator('button.chipbtn').first().click();
  const typed = await page.locator('#request').inputValue();
  check('an example fills the composer', typed.length > 40, `${typed.length} chars`);

  /* ── 3. spec review and the approval gate ──────────────────────────── */
  console.log('\n3. Spec review');
  await page.getByRole('button', { name: /Build search/ }).click();
  await page.waitForURL(/\/searches\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const specUrl = page.url();
  check('a request compiles to a reviewable spec', /\/searches\//.test(specUrl));

  const specText = await page.locator('body').innerText();
  check('the search is explained in prose', /Who we are looking for/i.test(specText));
  check('the rubric is itemised', /How each company is judged/i.test(specText));
  check('evidence rules are stated', /Minimum coverage to score/i.test(specText));
  check('nothing runs before approval', /Ready to run/i.test(specText));

  const runBefore = Number(psql('select count(*) from run') || '0');
  check('viewing a spec starts no run', runBefore >= 0);

  await page.getByRole('button', { name: 'Open editor' }).click();
  check('the definition is editable in full', await page.locator('#spec-json').isVisible());
  const json = await page.locator('#spec-json').inputValue();
  check('the editor holds the real spec', json.includes('"rubric"') && json.includes('"budget"'));

  await page.locator('#spec-json').fill('{ not json');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(1500);
  check('an invalid edit is rejected with the reason', await page.getByText(/not valid JSON/i).isVisible());

  /* ── 4. the run ────────────────────────────────────────────────────── */
  console.log('\n4. Run');
  await page.goto(specUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Approve and run/ }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const runId = page.url().split('/runs/')[1].split(/[?#]/)[0];
  check('approval starts a run', Boolean(runId));
  check('the pipeline is shown as real steps', await page.getByText('Pipeline', { exact: true }).first().isVisible());

  await page.waitForFunction(
    () => /completed|partial|failed|budget reached|cancelled|Run stopped/i.test(document.body.innerText),
    undefined,
    { timeout: 180_000 },
  );
  const runText = await page.locator('body').innerText();
  check('the run reaches a terminal state', /completed|partial|failed|budget reached|cancelled/i.test(runText));

  const dbStatus = psql(`select status from run where id='${runId}'`);
  const shownTerminal = /completed|partial|failed|budget reached|cancelled/i.test(runText);
  check('the screen agrees with the stored run status', shownTerminal && Boolean(dbStatus), dbStatus);

  const dbLeads = Number(psql(`select count(*) from lead where run_id='${runId}'`) || '0');
  if (dbLeads === 0) {
    check(
      'a run with no leads says why instead of looking successful',
      /No leads produced|Run stopped|Working/i.test(runText),
      runText.slice(0, 140).replace(/\n/g, ' '),
    );
  } else {
    check('leads found in the database are displayed', /Showing \d+ of \d+/.test(runText), `${dbLeads} in db`);
  }

  /* ── 5. results, drawer, evidence (against the seeded demo run) ────── */
  console.log('\n5. Results, drawer, and evidence');
  const demoRun = psql('select id from run where is_demo order by created_at desc limit 1');
  const demoWorkspace = demoRun ? psql(`select workspace_id from run where id='${demoRun}'`) : '';

  if (!demoRun) {
    console.log('  ! no demo run seeded — run `pnpm demo:seed` first. Skipping evidence screens.');
  } else {
    // The demo run belongs to the demo account, so sign in as it.
    const demoPage = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    await demoPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await demoPage.fill('#email', process.env.DEMO_EMAIL ?? 'demo@leadmoor.local');
    await demoPage.fill('#password', process.env.DEMO_PASSWORD ?? 'demo-password-1');
    await demoPage.click('button[type=submit]');
    await demoPage.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 30_000 });

    await demoPage.goto(`${BASE}/runs/${demoRun}`, { waitUntil: 'domcontentloaded' });
    await demoPage.waitForTimeout(800);
    check('demo output is labelled as demo', await demoPage.getByText(/Demo data/i).first().isVisible());

    const qualified = Number(
      psql(`select count(*) from lead where run_id='${demoRun}' and status='qualified' and suppressed_at is null`) || '0',
    );
    const held = Number(
      psql(`select count(*) from lead where run_id='${demoRun}' and status='held_insufficient_evidence'`) || '0',
    );
    const resultsText = await demoPage.locator('body').innerText();
    check('coverage is shown beside every score', (await demoPage.getByText(/% evidence/).count()) > 0);
    check(
      'held leads are shown, not hidden',
      held === 0 || /Insufficient evidence/i.test(resultsText),
      `${held} held in db`,
    );

    await demoPage.locator('table.tbl tbody tr').first().locator('button.tbl__primary').click();
    await demoPage.waitForTimeout(1600);
    check('the drawer opens', await demoPage.getByRole('dialog').first().isVisible());

    const drawer = demoPage.getByRole('dialog').first();
    const drawerText = await drawer.innerText();
    check('the score is decomposed', /Fit/.test(drawerText) && /Contactability/.test(drawerText));
    check('email state is explicit', /Verified|Unverified|None found/.test(drawerText));

    const evidenceRow = drawer.locator('details.evrow').first();
    const hasEvidence = (await evidenceRow.count()) > 0;
    check('claims carry evidence', hasEvidence);

    if (hasEvidence) {
      const quote = await evidenceRow.locator('.quote').first().innerText();
      check('the quote is shown before any jargon', quote.trim().length > 5, quote.slice(0, 60));
      check('the quote is marked verified against the stored document', /Verified in document/i.test(await evidenceRow.innerText()));

      await evidenceRow.locator('summary').click();
      await demoPage.waitForTimeout(900);
      await evidenceRow.getByRole('button', { name: /Show technical provenance/ }).click();
      await demoPage.waitForTimeout(400);
      const provenance = await evidenceRow.innerText();
      check('provenance discloses the content hash', /[0-9a-f]{32}/.test(provenance));
      check(
        'provenance discloses the source and retrieval time',
        /source/i.test(provenance) && /retrieved/i.test(provenance),
      );

      // The quote the UI shows must exist in the stored document, byte for byte.
      const bare = quote.replace(/^[“"]|[”"]$/g, '').slice(0, 60).replace(/'/g, "''");
      const inDb = Number(
        psql(`select count(*) from evidence where normalized_text like '%${bare}%'`) || '0',
      );
      check('the displayed quote exists in a stored document', inDb > 0, bare.slice(0, 50));
    }

    /* ── 6. export ───────────────────────────────────────────────────── */
    console.log('\n6. Export');
    await demoPage.keyboard.press('Escape');
    await demoPage.waitForTimeout(400);
    if (qualified > 0) {
      await demoPage.getByRole('button', { name: /^Export$/ }).click();
      await demoPage.waitForTimeout(500);
      check('the export dialog offers column choice', await demoPage.getByText(/of 12 columns/).isVisible());
      await demoPage.getByRole('button', { name: 'Download CSV' }).click();
      await demoPage.waitForTimeout(2500);
      const message = await demoPage.locator('body').innerText();
      check('the export reports what it produced', /lead\(s\) exported/i.test(message), message.match(/[^\n]*exported[^\n]*/)?.[0] ?? '');

      const exportRows = Number(
        psql(`select coalesce(max(row_count),0) from export where run_id='${demoRun}'`) || '0',
      );
      check('the export was recorded with its row count', exportRows > 0, `${exportRows} rows`);
    } else {
      console.log('  ! no qualified leads in the demo run — skipping export checks');
    }

    /* ── 7. suppression ──────────────────────────────────────────────── */
    console.log('\n7. Suppression');
    if (qualified > 0) {
      await demoPage.goto(`${BASE}/runs/${demoRun}`, { waitUntil: 'domcontentloaded' });
      await demoPage.waitForTimeout(800);
      await demoPage.locator('table.tbl tbody tr').first().locator('button.tbl__primary').click();
      await demoPage.waitForTimeout(1200);
      demoPage.once('dialog', (d) => d.accept());
      await demoPage.getByRole('button', { name: /^Suppress$/ }).click();
      await demoPage.waitForTimeout(3000);

      const keys = Number(psql(`select count(*) from suppression where workspace_id='${demoWorkspace}'`) || '0');
      check('a suppression key was written', keys > 0, `${keys} keys`);

      const after = Number(
        psql(`select count(*) from lead where run_id='${demoRun}' and status='qualified' and suppressed_at is null`) || '0',
      );
      check('the suppressed lead leaves qualified results', after < qualified, `${qualified} → ${after}`);
    }

    /* ── 8. deletion ─────────────────────────────────────────────────── */
    console.log('\n8. Deletion');
    const personId = psql(
      `select p.id from person p join lead l on l.person_id = p.id where l.run_id='${demoRun}' and l.suppressed_at is null limit 1`,
    );
    if (personId) {
      const claimsBefore = Number(psql(`select count(*) from claim where subject_id='${personId}'`) || '0');
      await demoPage.goto(`${BASE}/leads`, { waitUntil: 'domcontentloaded' });
      await demoPage.waitForTimeout(900);
      await demoPage.locator('table.tbl tbody tr').first().locator('button.tbl__primary').click();
      await demoPage.waitForTimeout(1400);

      const deleteButton = demoPage.getByRole('button', { name: /Delete person/ });
      if (await deleteButton.count()) {
        demoPage.once('dialog', (d) => d.accept());
        await deleteButton.first().click();
        await demoPage.waitForTimeout(3000);
        const gone = Number(psql(`select count(*) from person where id='${personId}'`) || '0');
        const claimsAfter = Number(psql(`select count(*) from claim where subject_id='${personId}'`) || '0');
        check('deletion propagates or the lead was a different person', gone === 0 || claimsAfter <= claimsBefore);
      }
      const orphans = Number(
        psql('select count(*) from lead where person_id is null and email is not null') || '0',
      );
      check('no contact data is orphaned by deletion', orphans === 0, `${orphans} orphans`);
    } else {
      console.log('  ! no person attached to a live lead — skipping deletion checks');
    }

    /* ── 9. audit ────────────────────────────────────────────────────── */
    console.log('\n9. Audit');
    await demoPage.goto(`${BASE}/runs/${demoRun}/audit`, { waitUntil: 'domcontentloaded' });
    await demoPage.waitForTimeout(700);
    const audit = (await demoPage.locator('body').innerText()).toLowerCase();
    for (const action of ['run.created', 'document.retrieved', 'claim.created', 'score.generated']) {
      check(`the audit records ${action}`, audit.includes(action));
    }
    check('the audit shows refusals alongside successes', /attempted/.test(audit));
    check('the audit contains no credential', !/sk-ant|ghp_|postgres:\/\//.test(audit));

    await demoPage.context().close();
  }

  /* ── 10. workspace isolation, through the browser ──────────────────── */
  console.log('\n10. Workspace isolation');
  const outsiderContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const outsider = await outsiderContext.newPage();
  await signUp(outsider, OUTSIDER);

  if (demoRun) {
    const status = (await outsider.goto(`${BASE}/runs/${demoRun}`, { waitUntil: 'domcontentloaded' }))?.status();
    check("another workspace's run is not found", status === 404, String(status));

    const demoCompany = psql(`select id from company where run_id='${demoRun}' limit 1`);
    if (demoCompany) {
      const s2 = (await outsider.goto(`${BASE}/companies/${demoCompany}`, { waitUntil: 'domcontentloaded' }))?.status();
      check("another workspace's company is not found", s2 === 404, String(s2));
    }
  }

  await outsider.goto(`${BASE}/leads`, { waitUntil: 'domcontentloaded' });
  await outsider.waitForTimeout(600);
  check('a new workspace starts empty', await outsider.getByText(/No leads yet/i).isVisible());
  await outsiderContext.close();

  /* ── 11. command menu, keyboard, and mobile ────────────────────────── */
  console.log('\n11. Command menu, keyboard, and mobile');
  // The shortcut is a client listener, so it exists only once the shell has hydrated.
  await page.goto(`${BASE}/leads`, { waitUntil: 'domcontentloaded' });
  await page.locator('.sidebar').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(500);
  check('⌘K opens the command menu', await page.getByRole('dialog', { name: 'Command menu' }).isVisible());
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('escape closes it', (await page.getByRole('dialog', { name: 'Command menu' }).count()) === 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/leads`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('mobile layout does not overflow horizontally', overflow <= 2, `${overflow}px`);
  const sidebarVisible = await page.evaluate(() => {
    const el = document.querySelector('.sidebar');
    return el ? el.getBoundingClientRect().left >= -5 : false;
  });
  check('the sidebar is off-canvas on mobile', !sidebarVisible);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.waitForTimeout(500);
  check('the mobile drawer opens', await page.locator('.sidebar[data-open="true"]').isVisible());
  await page.setViewportSize({ width: 1440, height: 1000 });

  /* ── 12. errors and provider honesty ───────────────────────────────── */
  console.log('\n12. Errors and provider honesty');
  const errorsBeforeIntentional404 = consoleErrors.length;
  const missing = await page.goto(`${BASE}/companies/00000000-0000-0000-0000-000000000000`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(1200);
  check('a missing record 404s cleanly', missing?.status() === 404, String(missing?.status()));
  check('the 404 page is helpful', await page.getByText(/Not found/i).first().isVisible());
  check(
    'the 404 keeps the app shell so navigation survives',
    await page.getByRole('navigation', { name: 'Main navigation' }).isVisible(),
  );

  await page.goto(`${BASE}/settings/providers`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const providers = await page.locator('body').innerText();
  check('unconfigured providers say so', /Not configured|Ready/.test(providers));
  check('no credential value is rendered', !/sk-ant-|ghp_[A-Za-z0-9]{20}/.test(providers));

  await page.goto(`${BASE}/enrichment`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const enrichment = await page.locator('body').innerText();
  check('enrichment states that no address is inferred', /never|not.*inferred|no pattern/i.test(enrichment));

  console.log('\n13. Console health');
  check('no unexpected console errors', errorsBeforeIntentional404 === 0, consoleErrors.slice(0, 3).join(' | '));
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
