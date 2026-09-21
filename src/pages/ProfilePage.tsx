import { AppHeader } from '../components/AppHeader';
import { ProfilePanel } from '../components/ProfilePanel';

export function ProfilePage() {
  return (
    <div
      data-testid="profile-page"
      className="mx-auto min-h-dvh max-w-3xl px-5 py-5"
    >
      <AppHeader />
      <ProfilePanel />
    </div>
  );
}
