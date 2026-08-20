import Link from 'next/link';

/**
 * Empty state.
 *
 * An empty screen is a teaching moment, not a dead end: it says what belongs here, why nothing is
 * here yet, and gives a specific next action rather than a shrug.
 */
export function EmptyState({
  icon,
  title,
  body,
  hints = [],
  action,
  secondary,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  hints?: string[];
  action?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <div className="empty">
      {icon ? (
        <span className="empty__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="empty__title">{title}</p>
      <p className="empty__body">{body}</p>

      {action || secondary ? (
        <div className="row g-8 wrap" style={{ justifyContent: 'center', marginTop: 4 }}>
          {action ? (
            <Link href={action.href} className="btn btn--primary btn--sm">
              {action.label}
            </Link>
          ) : null}
          {secondary ? (
            <Link href={secondary.href} className="btn btn--sm">
              {secondary.label}
            </Link>
          ) : null}
        </div>
      ) : null}

      {hints.length > 0 ? (
        <div className="empty__hints">
          {hints.map((hint) => (
            <p key={hint} className="hint">
              {hint}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
