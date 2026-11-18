'use client';

import Link from 'next/link';
import { CiaLogo } from './CiaLogo';
import { Icon } from './Icon';
import { CommandMenu } from './CommandMenu';
import { AccountMenu } from './AccountMenu';
import { navigation } from '../lib/navigation';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { clearSession, getSessionUser, setSessionUser, type SessionUser } from '../lib/session';

type Theme = 'light' | 'dark';
const THEME_KEY = 'inventory_theme';

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'dark') {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>;
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [theme, setTheme] = useState<Theme>('light');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const lastPath = useRef<string | null>(null);
  const traversingHistory = useRef(false);

  useEffect(() => {
    const onPopState = () => { traversingHistory.current = window.location.pathname !== lastPath.current; };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    // Mark entries reached inside the app without changing Next's history data.
    // Existing entries retain their marker when traversed or reloaded.
    if (lastPath.current && lastPath.current !== pathname && !traversingHistory.current) {
      window.history.replaceState({ ...window.history.state, inventoryCanGoBack: lastPath.current !== '/login' }, '');
    }
    lastPath.current = pathname;
    traversingHistory.current = false;
  }, [pathname]);

  function goBack() {
    if (window.history.state?.inventoryCanGoBack) {
      router.back();
      return;
    }
    const segments = pathname.split('/').filter(Boolean);
    const fallback = segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : '/';
    // Replacing a direct entry does not create a previous in-app history entry.
    traversingHistory.current = true;
    router.replace(fallback);
  }

  useEffect(() => {
    setCollapsed(localStorage.getItem('inventory_sidebar_collapsed') === 'true');
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && window.location.pathname !== '/login') {
        event.preventDefault(); setCommandOpen(current => !current);
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);

  function toggleSidebar() {
    setCollapsed(current => {
      localStorage.setItem('inventory_sidebar_collapsed', String(!current));
      return !current;
    });
  }

  useEffect(() => { setMenuOpen(false); setCommandOpen(false); }, [pathname]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const update = () => { setIsMobile(media.matches); if (!media.matches) setMenuOpen(false); };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.querySelector<HTMLAnchorElement>('.sidebar-nav a[aria-current="page"]')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); }
      if (event.key === 'Tab') {
        const focusable = [menuButton.current, ...Array.from(document.querySelectorAll<HTMLElement>('.sidebar a, .sidebar button'))].filter((element): element is HTMLElement => Boolean(element?.getClientRects().length));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('keydown', close); document.body.style.overflow = previousOverflow; };
  }, [menuOpen]);

  useEffect(() => {
    const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    setTheme(current);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
    setTheme(next);
  }

  useEffect(() => {
    if (pathname === '/login') {
      setReady(false); setUser(null);
      return;
    }

    const stored = getSessionUser();
    const token = localStorage.getItem('inventory_token');
    if (!token) {
      setReady(false);
      router.replace('/login');
      return;
    }

    if ((pathname.startsWith('/users') || pathname.startsWith('/audit')) && stored && stored.role !== 'ADMIN') {
      setReady(false);
      router.replace('/');
      return;
    }

    if (stored) setUser(stored);

    let live = true;
    api<SessionUser>('/auth/me')
      .then(current => {
        if (!live) return;
        setSessionUser(current);
        setUser(current);
        if ((pathname.startsWith('/users') || pathname.startsWith('/audit')) && current.role !== 'ADMIN') {
          setReady(false);
          router.replace('/');
          return;
        }
        setReady(true);
      })
      .catch(() => {
        // O helper da API já redireciona para login em caso de 401.
        if (live && stored && !((pathname.startsWith('/users') || pathname.startsWith('/audit')) && stored.role !== 'ADMIN')) setReady(true);
      });
    return () => { live = false; };
  }, [pathname, router]);

  if (pathname === '/login') return <>
    <button
      type="button"
      className="theme-toggle theme-toggle-login"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
      title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
    >
      <ThemeIcon theme={theme} />
      <span>{theme === 'dark' ? 'Claro' : 'Escuro'}</span>
    </button>
    {children}
  </>;
  if (!ready) return <main className="center app-loading" role="status" aria-label="Carregando inventário"><CiaLogo size={52} /><div className="loader" /><p>Preparando seu espaço de trabalho…</p></main>;

  const visibleLinks = navigation.filter(item => !item.roles || (user && item.roles.includes(user.role)));
  const currentPage = navigation.find(item => item.href === pathname || (item.href !== '/' && pathname.startsWith(item.href + '/')))?.label || 'Inventário';

  return (
    <div className={`app-shell modern-workspace${menuOpen ? ' menu-open' : ''}${collapsed ? ' sidebar-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">Pular para o conteúdo</a>
      {menuOpen && <button className="sidebar-overlay" aria-label="Fechar menu" onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }} />}
      <aside className="sidebar" id="main-navigation" aria-label="Menu principal" inert={isMobile && !menuOpen}>
        <div className="brand-wrap">
          <CiaLogo size={42} />
          <div className="brand-copy">
            <div className="brand">Inventário<span className="brand-dot">.</span></div>
            <div className="sidebar-muted">Gestão patrimonial</div>
          </div>
          <button
            type="button"
            className="theme-toggle sidebar-theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
          >
            <ThemeIcon theme={theme} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Módulos do inventário">
          {['Workspace', 'Organização', 'Administração'].map(group => visibleLinks.some(item => item.group === group) && <div className="nav-group" key={group}>
          <div className="nav-label">{group}</div>
          {visibleLinks.filter(item => item.group === group).map(item => (
            <Link key={item.href} href={item.href} title={collapsed && !isMobile ? item.label : undefined} aria-label={item.label} onClick={() => setMenuOpen(false)} aria-current={(pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'))) ? 'page' : undefined} className={(pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'))) ? 'active' : ''}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              <span className="nav-active-dot" aria-hidden="true" />
            </Link>
          ))}
          </div>)}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-command" type="button" onClick={() => { setMenuOpen(false); setCommandOpen(true); }} title="Busca rápida (Ctrl K)"><Icon name="command" /><span>Busca rápida</span><kbd>Ctrl K</kbd></button>
          <div className="workspace-card"><span className="workspace-emblem"><Icon name="shield" /></span><div><strong>Cia do Crédito</strong><small>Espaço corporativo</small></div><span className="workspace-dot" aria-hidden="true" /></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-location">
            <button ref={menuButton} type="button" className="menu-button" aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen(!menuOpen)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>
            <button type="button" className="sidebar-collapse" onClick={toggleSidebar} aria-label={collapsed ? 'Expandir navegação' : 'Recolher navegação'} aria-expanded={!collapsed}><Icon name="panel" /></button>
            {pathname !== '/' && <button type="button" className="page-back-button" onClick={goBack} aria-label="Voltar à página anterior" title="Voltar à página anterior"><Icon name="arrow-left" /><span>Voltar</span></button>}
            <span className="breadcrumb-root"><Link href="/">Workspace</Link><span aria-hidden="true">/</span></span><strong className="breadcrumb-current">{currentPage}</strong>
          </div>
          <div className="topbar-actions" inert={isMobile && menuOpen}>
            <button type="button" className="command-trigger" onClick={() => setCommandOpen(true)} aria-label="Abrir busca rápida"><Icon name="search" /><span>Buscar no inventário…</span><kbd>Ctrl K</kbd></button>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}
              title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
            >
              <ThemeIcon theme={theme} />
              <span>{theme === 'dark' ? 'Claro' : 'Escuro'}</span>
            </button>
            <AccountMenu user={user} onSignOut={() => { clearSession(); setReady(false); setUser(null); router.replace('/login'); }} />
          </div>
        </header>
        {!online && <div className="connection-notice" role="status"><Icon name="alert" />Você está sem conexão. Reconecte para consultar ou salvar alterações.</div>}
        <div className="content" id="main-content" tabIndex={-1} inert={isMobile && menuOpen}>{children}</div>
      </main>
      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} user={user} />
    </div>
  );
}
