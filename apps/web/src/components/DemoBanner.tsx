/**
 * Demo runs are labeled wherever they appear so they can never pass for a real search.
 * Only `scripts/demo.ts` sets the `is_demo` flag; no application code path can.
 */
export function DemoBanner() {
  return (
    <p className="notice" style={{ marginTop: 24, marginBottom: 0 }} role="note">
      <strong>Demo data.</strong> This run was produced by the real pipeline against a fixture corpus of
      fictional <code className="mono">.example</code> companies, for local evaluation. Every claim and citation
      is a genuine output of the validator — the companies themselves are not real.
    </p>
  );
}
