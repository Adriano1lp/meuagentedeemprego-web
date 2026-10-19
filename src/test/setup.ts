import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

import { resetLoggedOutForTests } from '../auth/loggedOut';
import { resetReturnToMemory } from '../auth/returnTo';
import { resetSessionRuntimeForTests } from '../auth/sessionRefresh';
import { resetBillingReturnMemory } from '../billing/BillingReturn';

afterEach(() => {
  resetReturnToMemory();
  resetBillingReturnMemory();
  resetSessionRuntimeForTests();
  resetLoggedOutForTests();
});
