'use client';

import { CiaLogo } from '../../components/CiaLogo';
import { Icon } from '../../components/Icon';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setSession, type SessionUser } from '../../lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);

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

  return <main className={`login login-redesign${motionPaused ? ' motion-paused' : ''}`}>
    <div className="auth-frame">
      <aside className="login-story auth-story">
        <div className="auth-wordmark"><CiaLogo size={48} /><div><strong>Cia do crédito</strong><small>INVENTÁRIO CORPORATIVO</small></div></div>
        <div className="auth-intro"><span className="auth-tag"><span />Tudo conectado. Tudo organizado.</span><h2>Seu patrimônio,<br /><em>em boa companhia.</em></h2><p>Mais clareza para cuidar de cada recurso.<br />Mais tempo para o que move a empresa.</p></div>
        <div className="auth-illustration" aria-hidden="true">
          <div className="auth-orbit orbit-outer"><span className="orbit-dot dot-one" /></div>
          <div className="auth-orbit orbit-inner"><span className="orbit-dot dot-two" /></div>
          <svg className="auth-connectors" viewBox="0 0 500 260" fill="none"><path d="M100 80h70q20 0 20 20v15h60M395 65h-50q-20 0-20 20v30h-75M370 205h-60q-20 0-20-20v-55h-40" stroke="currentColor" strokeDasharray="4 6" /></svg>
          <div className="auth-hub"><CiaLogo size={94} /></div>
          <div className="auth-node node-assets"><span><Icon name="box" /></span><div><strong>Ativos</strong><small>Cada bem, no seu lugar.</small></div><Icon name="check" /></div>
          <div className="auth-node node-stock"><span><Icon name="layers" /></span><div><strong>Estoque</strong><small>Recursos conectados.</small></div></div>
          <div className="auth-node node-sectors"><span><Icon name="grid" /></span><div><strong>Setores</strong><small>Uma visão compartilhada.</small></div></div>
        </div>
        <div className="auth-story-footer"><Icon name="shield" /><span>Organização em cada detalhe.</span><span className="auth-footer-line" /></div>
      </aside>
      <section className="login-card auth-card">
        <div className="auth-mobile-brand"><CiaLogo size={42} /><strong>Cia do Crédito</strong></div>
        <div className="auth-form-heading"><span className="auth-section-label">SEU ESPAÇO DE GESTÃO</span><h1>Bom ter você<br />por aqui.</h1><p>Acesse sua conta para acompanhar<br className="auth-desktop-break" /> o inventário da empresa.</p></div>
        <form onSubmit={submit}>
          <div className="form-field"><label htmlFor="email">E-mail corporativo</label><div className="auth-input"><Icon name="mail" /><input id="email" name="email" required value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="username" placeholder="voce@empresa.com.br" /></div></div>
          <div className="form-field"><label htmlFor="password">Senha</label><div className="password-field auth-input"><Icon name="lock" /><input id="password" name="password" required value={password} onChange={e => setPassword(e.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Sua senha de acesso" /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showPassword}><Icon name={showPassword ? 'eye-off' : 'eye'} /></button></div></div>
          {error && <div className="notice notice-error login-notice" role="alert">{error}</div>}
          <button className="primary login-button" disabled={loading} aria-busy={loading}><span>{loading ? 'Acessando sua conta…' : 'Acessar inventário'}</span>{loading ? <span className="auth-button-spinner" /> : <Icon name="arrow" />}</button>
        </form>
        <p className="auth-help">Precisa de acesso? <span>Fale com o administrador.</span></p>
        <div className="auth-security"><span><Icon name="shield" /></span><div><strong>Um ambiente da Cia do Crédito</strong><small>Acesso exclusivo para pessoas autorizadas.</small></div></div>
      </section>
    </div>
    <footer className="auth-bottom"><span>Cia do Crédito · Gestão patrimonial</span><button type="button" className="auth-motion-control" aria-pressed={motionPaused} onClick={() => setMotionPaused(current => !current)}>{motionPaused ? 'Ativar animações' : 'Pausar animações'}</button></footer>
  </main>;
}
