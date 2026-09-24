'use client';

import { CiaLogo } from '../../components/CiaLogo';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setSession, type SessionUser } from '../../lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333'}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message || 'Falha no login.');
        return;
      }

      setSession(data.token, data.user as SessionUser);
      router.push('/');
    } catch {
      setError('Não foi possível conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  }

  return <main className="login">
    <div className="login-backdrop" />
    <section className="login-card">
      <div className="login-brand">
        <CiaLogo size={44} />
        <div><strong>Inventário</strong><span>Gestão patrimonial</span></div>
      </div>
      <div className="login-copy">
        <div className="eyebrow">Acesso interno</div>
        <h1>Bem-vindo.</h1>
        <p>Entre para consultar e administrar os ativos da empresa.</p>
      </div>
      <form onSubmit={submit}>
        <div className="form-field"><label>E-mail</label><input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="username" /></div>
        <div className="form-field"><label>Senha</label><input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" /></div>
        {error && <div className="notice notice-error login-notice">{error}</div>}
        <button className="primary login-button" disabled={loading}>{loading ? 'Entrando...' : 'Entrar no sistema'}</button>
      </form>
      <div className="login-footer"><span className="status-dot" /> Ambiente interno</div>
    </section>
  </main>;
}
