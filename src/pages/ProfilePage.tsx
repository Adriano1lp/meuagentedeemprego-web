import { AppShell } from '../components/AppShell';
import { ProfilePanel } from '../components/ProfilePanel';

export function ProfilePage() {
  return (
    <AppShell>
      <div data-testid="profile-page">
        <ProfilePanel />
      </div>
    </AppShell>
  );
}
