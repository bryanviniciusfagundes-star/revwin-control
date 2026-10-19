import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Operations from './pages/Operations';
import Results from './pages/Results';
import ComingSoon from './pages/ComingSoon';
import ImportPage from './pages/Import';

export default function App() {
  const { session, loading } = useAuth();

  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  if (!session) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="operacoes" element={<Operations />} />
        <Route path="resultados" element={<Results />} />
        <Route path="importar" element={<ImportPage />} />
        <Route path="historico" element={<ComingSoon title="Histórico" stage="Etapa 3" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
