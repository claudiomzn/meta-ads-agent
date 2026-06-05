import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Layout } from '@/components/Layout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { setUnauthorizedHandler } from '@/services/api';

// Code splitting — cada página carrega sob demanda
const LoginPage        = lazy(() => import('@/pages/LoginPage'));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));
const OnboardingPage   = lazy(() => import('@/pages/OnboardingPage'));
const DashboardPage    = lazy(() => import('@/pages/DashboardPage'));
const CampaignsPage    = lazy(() => import('@/pages/CampaignsPage'));
const CampaignWizard   = lazy(() => import('@/pages/CampaignWizardPage'));
const CampaignDetail   = lazy(() => import('@/pages/CampaignDetailPage'));
const CampaignEdit     = lazy(() => import('@/pages/CampaignEditPage'));
const CopiesPage       = lazy(() => import('@/pages/CopiesPage'));
const AudiencesPage    = lazy(() => import('@/pages/AudiencesPage'));
const ABTestsPage      = lazy(() => import('@/pages/ABTestsPage'));
const AutomationsPage  = lazy(() => import('@/pages/AutomationsPage'));
const AnalysisPage     = lazy(() => import('@/pages/AnalysisPage'));
const InstagramPage    = lazy(() => import('@/pages/InstagramPage'));
const SettingsPage         = lazy(() => import('@/pages/SettingsPage'));
const ROASCalculatorPage      = lazy(() => import('@/pages/ROASCalculatorPage'));
const CreativeAnalysisPage    = lazy(() => import('@/pages/CreativeAnalysisPage'));
const CreativeHistoryPage     = lazy(() => import('@/pages/CreativeHistoryPage'));
const CreativePatternsPage    = lazy(() => import('@/pages/CreativePatternsPage'));
const CreativeDetailPage      = lazy(() => import('@/pages/CreativeDetailPage'));
const AgentPage               = lazy(() => import('@/pages/AgentPage'));
const TemplatesPage           = lazy(() => import('@/pages/TemplatesPage'));

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // Não tenta novamente em erros de autorização ou not found
        if (error instanceof Error && (error.message.includes('401') || error.message.includes('404'))) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});

function PageFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Carregando...
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageFallback />;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout><ErrorBoundary>{children}</ErrorBoundary></Layout>;
}

function AuthHandler({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  useEffect(() => {
    setUnauthorizedHandler(() => navigate('/login', { replace: true }));
  }, [navigate]);

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login"           element={<LoginPage />} />
        <Route path="/reset-password"  element={<ResetPasswordPage />} />
        <Route path="/onboarding"      element={<OnboardingPage />} />
        <Route path="/agent"           element={<ProtectedRoute><AgentPage /></ProtectedRoute>} />
        <Route path="/dashboard"       element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/campaigns"       element={<ProtectedRoute><CampaignsPage /></ProtectedRoute>} />
        <Route path="/campaigns/new"      element={<ProtectedRoute><CampaignWizard /></ProtectedRoute>} />
        <Route path="/campaigns/:id/edit" element={<ProtectedRoute><CampaignEdit /></ProtectedRoute>} />
        <Route path="/campaigns/:id"      element={<ProtectedRoute><CampaignDetail /></ProtectedRoute>} />
        <Route path="/copies"          element={<ProtectedRoute><CopiesPage /></ProtectedRoute>} />
        <Route path="/audiences"       element={<ProtectedRoute><AudiencesPage /></ProtectedRoute>} />
        <Route path="/ab-tests"        element={<ProtectedRoute><ABTestsPage /></ProtectedRoute>} />
        <Route path="/automations"     element={<ProtectedRoute><AutomationsPage /></ProtectedRoute>} />
        <Route path="/analysis"        element={<ProtectedRoute><AnalysisPage /></ProtectedRoute>} />
        <Route path="/instagram"       element={<ProtectedRoute><InstagramPage /></ProtectedRoute>} />
        <Route path="/settings"          element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/roas-calculator"       element={<ProtectedRoute><ROASCalculatorPage /></ProtectedRoute>} />
        <Route path="/creative-analysis"          element={<ProtectedRoute><CreativeAnalysisPage /></ProtectedRoute>} />
        <Route path="/creative-analysis/history"  element={<ProtectedRoute><CreativeHistoryPage /></ProtectedRoute>} />
        <Route path="/creative-analysis/patterns" element={<ProtectedRoute><CreativePatternsPage /></ProtectedRoute>} />
        <Route path="/creative-analysis/:id"      element={<ProtectedRoute><CreativeDetailPage /></ProtectedRoute>} />
        <Route path="/templates"       element={<ProtectedRoute><TemplatesPage /></ProtectedRoute>} />
        <Route path="*"                element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthHandler>
          <AppRoutes />
        </AuthHandler>
      </BrowserRouter>
      <Toaster richColors position="bottom-right" closeButton />
    </QueryClientProvider>
  );
}
