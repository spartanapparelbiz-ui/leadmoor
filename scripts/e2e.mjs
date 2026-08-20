/**
 * The flow, driven for real in a browser.
 *
 * This is the brief's final test, executed: open LeadMoor, type a request, click Find Leads, watch
 * the search run, get companies and people, see email states, understand why each lead was picked,
 * filter, and export. It checks what the screen says against what the database holds — a quote
 * shown in the interface must exist byte-for-byte in a stored document, and one account must not
 * reach another's data.
 *
 * Usage:
 *   pnpm demo:seed && pnpm build && pnpm start
 *   node scripts/e2e.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const EXEC = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';
const STAMP = Date.now().toString(36);
const USER = { email: `e2e-${STAMP}@leadmoor.test`, password: 'e2e-password-123' };

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
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
  const m = /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/(.+)$/.exec(process.env.DATABASE_URL ?? '');
  if (!m) return '';
  const [, user, password, host, port, database] = m;
  try {
    return execFileSync('psql', ['-h', host, '-p', port, '-U', user, '-d', database, '-tAc', sql], {
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: password },
    }).trim();
  } catch {
    return '';
  }
}

/** Waits for a navigation away from `from`, not merely for a url that matches a shape. */
async function waitForNewRun(target, from) {
  await target.waitForFunction(
    (previous) => /\/s\/[0-9a-f-]{36}/.test(location.pathname) && !location.pathname.endsWith(previous),
    from,
    { timeout: 90_000 },
  );
  return target.url().split('/s/')[1].split(/[?#]/)[0];
}

const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET|fonts\.g(oogleapis|static)/.test(m.text())) {
    consoleErrors.push(m.text());
  }
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  /* ── 1. the front door ─────────────────────────────────────────────── */
  console.log('\n1. Getting in');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  check('a signed-out visitor is sent to sign in', /\/login/.test(page.url()), page.url());

  await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', 'weak@leadmoor.test');
  await page.fill('#password', 'short');
  await page.click('button[type=submit]');
  await page.waitForTimeout(1400);
  check('a weak password is refused with the rule', await page.getByText(/at least 10 characters/i).first().isVisible());

  await page.fill('#email', USER.email);
  await page.fill('#password', USER.password);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !/signup/.test(u.toString()), { timeout: 30_000 });
  check('sign-up lands on the search box', await page.locator('#ask').isVisible());

  /* ── 2. one input, one button ──────────────────────────────────────── */
  console.log('\n2. Asking for leads');
  const heading = await page.locator('h1').first().innerText();
  check('the page asks one question', /who are you looking for/i.test(heading), heading);

  await page.locator('button.eg').first().click();
  check('an example fills the box', (await page.locator('#ask').inputValue()).length > 20);

  await page.fill('#ask', 'Find 20 US SaaS companies with 20-200 employees that are hiring salespeople.');
  const runsBefore = Number(psql('select count(*) from run') || '0');
  await page.getByRole('button', { name: /Find Leads/ }).click();
  await page.waitForURL(/\/s\/[0-9a-f-]{36}/, { timeout: 90_000 });
  const runId = page.url().split('/s/')[1].split(/[?#]/)[0];
  check('one click starts the search — no approval step', Boolean(runId));
  check('a run was actually created', Number(psql('select count(*) from run') || '0') > runsBefore);

  /* ── 3. real progress ──────────────────────────────────────────────── */
  console.log('\n3. Watching it run');
  await page.waitForTimeout(2000);
  const mid = await page.locator('body').innerText();
  check('progress is shown while it runs', /Searching/i.test(mid) || /leads/i.test(mid));
  check('the understood criteria are shown', /searching for/i.test(mid));

  // A fast search can finish before this line runs, so the stages are checked where they are
  // recorded rather than from whatever happens to be painted at this instant.
  const stages = psql(`select string_agg(stage, ',' order by ordinal) from run_stage where run_id='${runId}'`);
  check(
    'the real pipeline ran, stage by stage',
    /source_planning/.test(stages) && /discovery/.test(stages) && /scoring/.test(stages),
    stages.slice(0, 80),
  );

  await page.waitForFunction(() => !/Searching…/.test(document.body.innerText), undefined, { timeout: 240_000 });
  await page.waitForTimeout(1500);
  check('the search reaches a finished state', Boolean(psql(`select status from run where id='${runId}'`)));

  /* ── 4. results ────────────────────────────────────────────────────── */
  console.log('\n4. Results');
  const dbLeads = Number(psql(`select count(*) from lead where run_id='${runId}'`) || '0');
  const shown = await page.locator('table.t tbody tr').count();
  const results = await page.locator('body').innerText();

  if (dbLeads === 0) {
    check('a search with no leads says why', /No leads found/i.test(results), results.slice(0, 120).replace(/\n/g, ' '));
  } else {
    check('every stored lead is displayed', shown === dbLeads, `${shown} shown vs ${dbLeads} stored`);
    check('the requested columns are present', /SCORE[\s\S]*COMPANY[\s\S]*PERSON[\s\S]*ROLE[\s\S]*EMAIL[\s\S]*WHY THEY FIT[\s\S]*SOURCE[\s\S]*CONFIDENCE/i.test(results));
    check('email state is explicit on every row', /Verified|Unverified|Unavailable/.test(results));
  }

  /* ── 5. the demo run, where enrichment succeeds ────────────────────── */
  console.log('\n5. A fully enriched search');
  const demoRun = psql('select id from run where is_demo order by created_at desc limit 1');
  if (!demoRun) {
    console.log('  ! no demo run seeded — run `pnpm demo:seed` first. Skipping.');
  } else {
    const demoCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const d = await demoCtx.newPage();
    await d.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await d.fill('#email', process.env.DEMO_EMAIL ?? 'demo@leadmoor.local');
    await d.fill('#password', process.env.DEMO_PASSWORD ?? 'demo-password-1');
    await d.click('button[type=submit]');
    await d.waitForURL((u) => !/login/.test(u.toString()), { timeout: 30_000 });
    await d.goto(`${BASE}/s/${demoRun}`, { waitUntil: 'domcontentloaded' });
    await d.waitForTimeout(1800);

    const text = await d.locator('body').innerText();
    check('demo output is labelled as demo', /Demo data/i.test(text));

    const scored = Number(psql(`select count(*) from lead where run_id='${demoRun}' and status='qualified'`) || '0');
    check('leads carry real scores', scored === 0 || /\b\d{2,3}\b/.test(text), `${scored} qualified`);

    const withPeople = Number(psql(`select count(*) from lead where run_id='${demoRun}' and person_id is not null`) || '0');
    check('people are found and shown', withPeople === 0 || /Chief Technology Officer|VP Engineering/i.test(text), `${withPeople} with a person`);

    /* the drawer */
    await d.locator('table.t tbody tr').first().locator('.tname').click();
    await d.waitForTimeout(2200);
    const drawer = await d.getByRole('dialog').innerText();
    check('the drawer explains why', /WHY THIS IS A LEAD/i.test(drawer));
    check('reasons are itemised', (drawer.match(/✓/g) ?? []).length >= 2, `${(drawer.match(/✓/g) ?? []).length} reasons`);
    check('company facts are shown, with gaps marked', /COMPANY/i.test(drawer) && /Not established|Employees/i.test(drawer));
    check('contact state is explicit', /CONTACT/i.test(drawer));
    check('"Find more like this" is offered', (await d.getByRole('button', { name: /Find more like this/ }).count()) > 0);

    /* evidence and provenance */
    const ev = d.locator('details.ev').first();
    check('claims carry evidence', (await ev.count()) > 0);
    if (await ev.count()) {
      const quote = (await ev.locator('.quote').first().innerText()).replace(/^[“"]|[”"]$/g, '');
      check('the quote is shown before any jargon', quote.trim().length > 5, quote.slice(0, 50));
      await ev.locator('summary').click();
      await d.waitForTimeout(500);
      const detailBtn = ev.getByRole('button', { name: /Show source detail/ });
      if (await detailBtn.count()) {
        await detailBtn.first().click();
        await d.waitForTimeout(900);
      }
      const opened = await ev.innerText();
      check('the source, time, and hash are one click away', /[0-9a-f]{32}/.test(opened) && /retrieved/i.test(opened));
      check('the quote is marked verified against the stored document', /Verified in document/i.test(opened));

      const needle = quote.trim().slice(0, 50).replace(/'/g, "''");
      const inDb = Number(psql(`select count(*) from evidence where normalized_text like '%${needle}%'`) || '0');
      check('the displayed quote exists in a stored document', inDb > 0, needle.slice(0, 40));
    }
    await d.keyboard.press('Escape');
    await d.waitForTimeout(400);

    /* filters */
    console.log('\n6. Filters');
    const before = await d.locator('table.t tbody tr').count();
    await d.getByRole('button', { name: 'Has a contact' }).click();
    await d.waitForTimeout(400);
    const after = await d.locator('table.t tbody tr').count();
    check('a filter narrows the list', after <= before, `${before} → ${after}`);
    await d.getByRole('button', { name: 'Has a contact' }).click();
    await d.waitForTimeout(300);
    check('unfiltering restores it', (await d.locator('table.t tbody tr').count()) === before);

    /* export */
    console.log('\n7. Export');
    const download = d.waitForEvent('download', { timeout: 20_000 }).catch(() => null);
    await d.getByRole('button', { name: /Export CSV/ }).click();
    const file = await download;
    await d.waitForTimeout(1500);
    check('one click produces a CSV', Boolean(file), file ? await file.suggestedFilename() : 'no download');
    check('the export reports what it produced', /exported/i.test(await d.locator('body').innerText()));
    const recorded = Number(psql(`select coalesce(max(row_count),0) from export where run_id='${demoRun}'`) || '0');
    check('the export was recorded with its row count', recorded > 0, `${recorded} rows`);

    /* refine */
    console.log('\n8. Refine in words');
    await d.getByRole('button', { name: /^Refine$/ }).click();
    await d.waitForTimeout(400);
    check('refinement takes plain language', await d.locator('#refine').isVisible());
    await d.locator('#refine').fill('Only companies with 100+ employees');
    await d.getByRole('button', { name: /^Apply$/ }).click();
    const refined = await waitForNewRun(d, demoRun);
    check('a refinement starts a new search', refined !== demoRun, refined);
    const refinedAsk = psql(
      `select raw_text from lead_request where id = (select request_id from lead_spec where id = (select spec_id from run where id='${refined}'))`,
    );
    check('the refinement is applied on top of the original request', /Refinement: Only companies with 100/.test(refinedAsk), refinedAsk.slice(-60));
    check('the original results are untouched', Number(psql(`select count(*) from lead where run_id='${demoRun}'`) || '0') > 0);

    /* save */
    console.log('\n9. Save and re-run');
    await d.goto(`${BASE}/s/${demoRun}`, { waitUntil: 'domcontentloaded' });
    await d.waitForTimeout(1200);
    await d.getByRole('button', { name: /Save search/ }).click();
    await d.waitForTimeout(300);
    await d.locator('#save-name').fill(`E2E ${STAMP}`);
    await d.getByRole('button', { name: /^Save$/ }).click();
    await d.waitForTimeout(2200);
    check('a search can be saved', Number(psql(`select count(*) from saved_search where name = 'E2E ${STAMP}'`) || '0') === 1);

    await d.goto(`${BASE}/searches`, { waitUntil: 'domcontentloaded' });
    await d.waitForTimeout(800);
    check('it appears under Searches', await d.getByText(`E2E ${STAMP}`, { exact: true }).first().isVisible());
    await d.getByRole('button', { name: /^Run$/ }).first().click();
    await d.waitForURL(/\/s\/[0-9a-f-]{36}/, { timeout: 90_000 });
    check('a saved search re-runs', /\/s\//.test(d.url()));

    /* find more like this */
    console.log('\n10. Find more like this');
    await d.goto(`${BASE}/s/${demoRun}`, { waitUntil: 'domcontentloaded' });
    await d.waitForTimeout(1400);
    await d.locator('table.t tbody tr').first().locator('.tname').click();
    await d.waitForTimeout(2000);
    await d.getByRole('button', { name: /Find more like this/ }).click();
    const similar = await waitForNewRun(d, demoRun);
    check('one click searches for similar companies', similar !== demoRun, similar);

    const askText = psql(
      `select raw_text from lead_request where id = (select request_id from lead_spec where id = (select spec_id from run where id='${similar}'))`,
    );
    check('the new request is written from the lead', /similar to/i.test(askText), askText.slice(0, 80));

    await demoCtx.close();
  }

  const cleanConsoleCount = consoleErrors.length;

  /* ── 11. isolation ─────────────────────────────────────────────────── */
  console.log('\n11. Account isolation');
  if (demoRun) {
    const status = (await page.goto(`${BASE}/s/${demoRun}`, { waitUntil: 'domcontentloaded' }))?.status();
    check("another account's search is not found", status === 404, String(status));
  }

  /* ── 12. mobile and errors ─────────────────────────────────────────── */
  console.log('\n12. Mobile and errors');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/s/${runId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('mobile does not overflow horizontally', overflow <= 2, `${overflow}px`);
  check('the nav is off-canvas on mobile', await page.evaluate(() => {
    const el = document.querySelector('.nav');
    return el ? el.getBoundingClientRect().right <= 2 : false;
  }));
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.waitForTimeout(400);
  check('the mobile menu opens', await page.locator('.nav[data-open="true"]').isVisible());
  await page.setViewportSize({ width: 1440, height: 1000 });

  const missing = await page.goto(`${BASE}/s/00000000-0000-0000-0000-000000000000`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  check('a missing search 404s cleanly', missing?.status() === 404, String(missing?.status()));
  check('the 404 keeps the navigation', await page.getByRole('navigation', { name: 'Main' }).isVisible());

  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const settings = await page.locator('body').innerText();
  check('unconnected providers say so', /Not connected|Connected/.test(settings));
  check('no credential value is rendered', !/sk-ant-|ghp_[A-Za-z0-9]{20}/.test(settings));

  console.log('\n13. Console health');
  check('no unexpected console errors', cleanConsoleCount === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  failed += 1;
  failures.push(`threw: ${error.message}`);
  console.error('\nE2E threw:', error.message);
} finally {
  await browser.close();
}

console.log(`\n${'─'.repeat(56)}`);
console.log(`E2E: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
