'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { roleLabel, type SessionUser } from '../lib/session';
import { Icon } from './Icon';

export function AccountMenu({ user, onSignOut }: { user: SessionUser | null; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const signOut = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const pathname = usePathname();
  const initials = user?.name?.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U';

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    signOut.current?.focus();

    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); setOpen(false); trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return <div className="topbar-user" ref={container}>
    <button ref={trigger} type="button" className="account-trigger" title={user?.name || 'Minha conta'} aria-label="Abrir menu da conta" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(current => !current)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}><span className="user-avatar" aria-hidden="true">{initials}</span></button>
    {open && <div className="account-popover">
      <div className="account-identity"><strong>{user?.name || 'Usuário'}</strong>{user?.email && <span>{user.email}</span>}<small>{user ? roleLabel(user.role) : 'Sessão ativa'}</small></div>
      <div id={menuId} role="menu" aria-label="Minha conta" onKeyDown={event => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); signOut.current?.focus(); }
      }}><button ref={signOut} type="button" role="menuitem" className="account-signout" onClick={() => { setOpen(false); onSignOut(); }}><Icon name="logout" />Sair da conta</button></div>
    </div>}
  </div>;
}
