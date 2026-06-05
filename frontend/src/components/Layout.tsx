import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Megaphone, FileText, Users, FlaskConical, Bot, LogOut, Settings, Brain, Instagram, Calculator, Palette, ChevronDown, ChevronRight, LayoutTemplate, Menu, X } from 'lucide-react';
import { MCPStatusBadge } from './MCPStatusBadge';
import { GlobalAlertsBell } from './GlobalAlertsBell';
import { SessionExpiryBanner } from './SessionExpiryBanner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  children?: { to: string; label: string }[];
}

const NAV: NavItem[] = [
  { to: '/agent',             icon: Bot,              label: 'Agente IA' },
  { to: '/dashboard',         icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/campaigns',         icon: Megaphone,        label: 'Campanhas' },
  { to: '/templates',         icon: LayoutTemplate,   label: 'Templates' },
  { to: '/analysis',          icon: Brain,            label: 'Análise IA' },
  { to: '/roas-calculator',   icon: Calculator,       label: 'Calculadora ROAS' },
  {
    to: '/creative-analysis',
    icon: Palette,
    label: 'Criativos IA',
    children: [
      { to: '/creative-analysis',          label: 'Nova Análise' },
      { to: '/creative-analysis/history',  label: 'Histórico' },
      { to: '/creative-analysis/patterns', label: 'Padrões' },
    ],
  },
  { to: '/instagram',         icon: Instagram,        label: 'Instagram' },
  { to: '/copies',            icon: FileText,         label: 'Copies' },
  { to: '/audiences',         icon: Users,            label: 'Públicos' },
  { to: '/ab-tests',          icon: FlaskConical,     label: 'Testes A/B' },
  { to: '/automations',       icon: Bot,              label: 'Automações' },
  { to: '/settings',          icon: Settings,         label: 'Configurações' },
];

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = pathname === item.to || pathname.startsWith(item.to + '/');
  const [open, setOpen] = useState(isActive);

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            isActive ? 'bg-[#e7f0fd] text-[#1877F2]' : 'text-gray-600 hover:bg-gray-100',
          )}
        >
          <item.icon className="h-4 w-4 flex-shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        {open && (
          <div className="ml-7 mt-0.5 space-y-0.5">
            {item.children.map((child) => (
              <Link
                key={child.to}
                to={child.to}
                className={cn(
                  'block rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  pathname === child.to
                    ? 'bg-[#e7f0fd] text-[#1877F2]'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
                )}
              >
                {child.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      to={item.to}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        isActive ? 'bg-[#e7f0fd] text-[#1877F2]' : 'text-gray-600 hover:bg-gray-100',
      )}
    >
      <item.icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Fecha sidebar ao mudar de rota (mobile)
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  // Fecha sidebar ao pressionar Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setSidebarOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center justify-between gap-2 px-6 py-5 border-b">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1877F2]">
            <span className="text-sm font-bold text-white">f</span>
          </div>
          <span className="font-semibold text-gray-900">Meta Ads Agent</span>
        </div>
        {/* Botão fechar — só aparece no mobile */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="md:hidden rounded p-1 text-gray-400 hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => (
          item.to === '/agent'
            ? (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition-colors mb-2',
                  pathname === '/agent'
                    ? 'bg-[#1877F2] text-white'
                    : 'bg-[#1877F2]/10 text-[#1877F2] hover:bg-[#1877F2]/20',
                )}
              >
                <item.icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{item.label}</span>
                <span className="text-[10px] font-bold bg-[#1877F2]/20 text-[#1877F2] px-1.5 py-0.5 rounded-full">
                  {pathname === '/agent' ? '●' : 'NOVO'}
                </span>
              </Link>
            )
            : <NavLink key={item.to} item={item} pathname={pathname} />
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
    </>
  );

  return (
    <div className="flex h-screen bg-gray-50">

      {/* ── Overlay mobile ──────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar desktop (sempre visível) ─────────────────────────────── */}
      <aside className="hidden md:flex w-60 flex-col bg-white border-r flex-shrink-0">
        {sidebarContent}
      </aside>

      {/* ── Sidebar mobile (drawer deslizante) ──────────────────────────── */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-40 w-72 flex flex-col bg-white border-r shadow-xl transition-transform duration-300 md:hidden',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        {sidebarContent}
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="flex h-14 items-center justify-between border-b bg-white px-4 md:px-6 flex-shrink-0">
          {/* Hamburger — só aparece em mobile */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100 transition-colors"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden md:block" />
          <div className="flex items-center gap-2">
            <GlobalAlertsBell />
            <MCPStatusBadge />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>

      {/* Banner de aviso de expiração de sessão */}
      <SessionExpiryBanner />
    </div>
  );
}
