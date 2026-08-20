/**
 * The LeadMoor mark: a document with one highlighted line — a claim and the evidence under it.
 * Deliberately geometric and flat; the product's credibility comes from the data, not the logo.
 */
export function Brandmark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brandmark" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="LeadMoor">
      <rect width="24" height="24" rx="5.5" fill="var(--accent)" />
      <rect x="6" y="5" width="12" height="14" rx="1.5" fill="var(--on-accent)" opacity="0.94" />
      <rect x="8.5" y="8" width="7" height="1.5" rx="0.75" fill="var(--accent)" opacity="0.35" />
      <rect x="8.5" y="11" width="7" height="2.2" rx="1.1" fill="var(--accent)" />
      <rect x="8.5" y="15" width="4.5" height="1.5" rx="0.75" fill="var(--accent)" opacity="0.35" />
    </svg>
  );
}
