'use client';

import { useFormStatus } from 'react-dom';

/** A submit button that reports real in-flight state rather than a decorative spinner. */
export function SubmitButton({
  children,
  pendingLabel,
  className = 'btn btn--primary',
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? (pendingLabel ?? 'Working…') : children}
    </button>
  );
}
