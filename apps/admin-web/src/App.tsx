import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { supabaseConfigured } from './lib/supabase';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { EmergencyProvider } from './hooks/useEmergency';
import { MapDataProvider } from './hooks/useMapData';
import { ApiHealthProvider } from './hooks/useApiHealth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Setup from './pages/Setup';
import NotStaff from './pages/NotStaff';
import Overview from './pages/Overview';
import Emergency from './pages/Emergency';
import Reports from './pages/Reports';
import MapPage from './pages/MapPage';
import UsersPage from './pages/UsersPage';
import SettingsPage from './pages/SettingsPage';
import type { RoleName } from './types';

function Guard({ roles, children }: { roles: RoleName[]; children: ReactNode }) {
  const { hasRole } = useAuth();
  if (!hasRole(...roles)) {
    return (
      <div className="tile max-w-md">
        <h1 className="text-lg font-bold">Not available for your role</h1>
        <p className="mt-1 text-sm text-muted">Your account does not have access to this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function Gate() {
  const { session, loading, roles } = useAuth();
  if (loading) return <p className="p-8 text-muted" role="status">Loading&hellip;</p>;
  if (!session) return <Login />;
  if (roles.length === 0) return <NotStaff />;
  return (
    <ApiHealthProvider>
      <MapDataProvider>
        <EmergencyProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Overview />} />
              <Route path="emergency" element={<Guard roles={['admin', 'responder']}><Emergency /></Guard>} />
              <Route path="reports" element={<Guard roles={['admin', 'maintenance', 'map_editor']}><Reports /></Guard>} />
              <Route path="map" element={<MapPage />} />
              <Route path="users" element={<Guard roles={['admin']}><UsersPage /></Guard>} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<p className="text-muted">Page not found.</p>} />
            </Route>
          </Routes>
        </EmergencyProvider>
      </MapDataProvider>
    </ApiHealthProvider>
  );
}

export default function App() {
  if (!supabaseConfigured) return <Setup />;
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
