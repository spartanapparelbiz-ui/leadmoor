import { EmptyState } from '@/components/EmptyState';
import { IconSearch } from '@/components/Icons';

/**
 * A 404 inside the app.
 *
 * Rendered within the shell so the user keeps their navigation rather than being ejected to a bare
 * page. A record that belongs to another workspace lands here too — it is genuinely not found, as
 * far as this workspace is concerned, and saying anything more would confirm it exists.
 */
export default function AppNotFound() {
  return (
    <div className="page page--narrow">
      <EmptyState
        icon={<IconSearch />}
        title="Not found"
        body="That search, run, company, or lead does not exist in this workspace. It may have been deleted, or the link may point at another workspace's data."
        hints={[
          'Deleted records leave the audit trail intact — check the run they belonged to.',
          'Switching workspaces changes what is visible; the sidebar shows which one you are in.',
        ]}
        action={{ href: '/leads', label: 'Browse leads' }}
        secondary={{ href: '/', label: 'Start a search' }}
      />
    </div>
  );
}
