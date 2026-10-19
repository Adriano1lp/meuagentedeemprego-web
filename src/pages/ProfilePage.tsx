import { CircleHelp } from 'lucide-react';

import { AppShell } from '../components/AppShell';
import { ProfilePanel } from '../components/ProfilePanel';
import { SupportLink } from '../components/SupportLink';

export function ProfilePage() {
  return (
    <AppShell>
      <div data-testid="profile-page">
        <ProfilePanel />
        <div className="mt-6 md:hidden">
          <SupportLink data-testid="support-link-profile" className="max-w-full">
            <CircleHelp aria-hidden="true" className="size-4 shrink-0" />
            Ajuda e suporte
          </SupportLink>
        </div>
      </div>
    </AppShell>
  );
}
