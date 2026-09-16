'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { clearSession, getSessionUser, roleLabel, setSessionUser, type SessionUser, type UserRole } from '../lib/session';

type IconName = 'dashboard' | 'assets' | 'pools' | 'structure' | 'imports' | 'users';
type NavItem = { href: string; label: string; icon: IconName; roles?: UserRole[] };

const links: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/assets', label: 'Ativos', icon: 'assets' },
  { href: '/stock', label: 'Estoque e componentes', icon: 'assets' },
  { href: '/pools', label: 'Pools', icon: 'pools' },
  { href: '/structure', label: 'Estrutura', icon: 'structure' },
  { href: '/imports', label: 'Importações', icon: 'imports' },
  { href: '/users', label: 'Usuários', icon: 'users', roles: ['ADMIN'] },
];

function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    assets: <><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
    pools: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>,
    structure: <><path d="M4 5h6l2 2h8v12H4z" /><path d="M8 11h8M8 15h5" /></>,
    imports: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  };

  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    if (pathname === '/login') {
      setReady(true);
      return;
    }

    setReady(false);
    const stored = getSessionUser();
    const token = localStorage.getItem('inventory_token');
    if (!token) {
      router.replace('/login');
      return;
    }

    if (pathname.startsWith('/users') && stored && stored.role !== 'ADMIN') {
      router.replace('/');
      return;
    }

    if (stored) setUser(stored);

    api<SessionUser>('/auth/me')
      .then(current => {
        setSessionUser(current);
        setUser(current);
        if (pathname.startsWith('/users') && current.role !== 'ADMIN') {
          router.replace('/');
          return;
        }
        setReady(true);
      })
      .catch(() => {
        // O helper da API já redireciona para login em caso de 401.
        if (stored && !(pathname.startsWith('/users') && stored.role !== 'ADMIN')) setReady(true);
      });
  }, [pathname, router]);

  if (pathname === '/login') return <>{children}</>;
  if (!ready) return <main className="center"><div className="loader" /></main>;

  const visibleLinks = links.filter(item => !item.roles || (user && item.roles.includes(user.role)));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-wrap">
          <div className="brand-mark">C</div>
          <div>
            <div className="brand">Inventário</div>
            <div className="sidebar-muted">Gestão patrimonial</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-label">Menu</div>
          {visibleLinks.map(item => (
            <Link key={item.href} href={item.href} className={(pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'))) ? 'active' : ''}>
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="session-card">
            <div className="user-avatar">{user?.name?.slice(0, 1).toUpperCase() || 'U'}</div>
            <div className="session-user-copy">
              <strong>{user?.name || 'Usuário'}</strong>
              <small>{user ? roleLabel(user.role) : 'Sessão ativa'}</small>
            </div>
          </div>
          <button className="logout-button" onClick={() => { clearSession(); router.push('/login'); }}>
            Sair da conta
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <strong>Inventário corporativo</strong>
            <span>Controle centralizado de ativos</span>
          </div>
          <div className="topbar-user">
            <div className="topbar-avatar">{user?.name?.slice(0, 1).toUpperCase() || 'U'}</div>
            <div><strong>{user?.name || 'Usuário'}</strong><span>{user ? roleLabel(user.role) : ''}</span></div>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
