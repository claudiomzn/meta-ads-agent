import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Megaphone, FileText, Users, FlaskConical, Bot, LogOut, Settings, Brain, Instagram } from 'lucide-react';
import { MCPStatusBadge } from './MCPStatusBadge';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/campaigns', icon: Megaphone, label: 'Campanhas' },
  { to: '/analysis', icon: Brain, label: 'Análise IA' },
  { to: '/instagram', icon: Instagram, label: 'Instagram' },
  { to: '/copies', icon: FileText, label: 'Copies' },
  { to: '/audiences', icon: Users, label: 'Públicos' },
  { to: '/ab-tests', icon: FlaskConical, label: 'Testes A/B' },
  { to: '/automations', icon: Bot, label: 'Automações' },
  { to: '/settings', icon: Settings, label: 'Configurações' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col bg-white border-r">
        {/* Logo */}
        <div className="flex items-center gap-2 px-6 py-5 border-b">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1877F2]">
            <span className="text-sm font-bold text-white">f</span>
          </div>
          <span className="font-semibold text-gray-900">Meta Ads Agent</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ to, icon: Icon, label }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                pathname === to || pathname.startsWith(to + '/')
                  ? 'bg-[#e7f0fd] text-[#1877F2]'
                  : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>

        {/* User */}
        <div className="border-t px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <button onClick={handleLogout} className="ml-2 rounded p-1 text-gray-400 hover:text-gray-600">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center justify-between border-b bg-white px-6">
          <div />
          <MCPStatusBadge />
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
