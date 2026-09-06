import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import { ConsentGate } from './components/ConsentGate';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';

export function App() {
  const { isAuthenticated } = useAuth();

  return (
    <ConsentGate>
      <Routes>
        <Route
          path="/"
          element={isAuthenticated ? <HomePage /> : <AuthPage />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ConsentGate>
  );
}
