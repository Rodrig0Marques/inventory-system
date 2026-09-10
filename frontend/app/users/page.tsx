'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { getSessionUser, roleLabel, type UserRole } from '../../lib/session';

type UserRecord = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type UserForm = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  active: boolean;
};

const emptyForm: UserForm = {
  name: '',
  email: '',
  password: '',
  role: 'VIEWER',
  active: true,
};

export default function UsersPage() {
  const router = useRouter();
  const [items, setItems] = useState<UserRecord[]>([]);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<UserRecord | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const currentUser = getSessionUser();

  const load = () => api<UserRecord[]>('/users').then(setItems);

  useEffect(() => {
    const session = getSessionUser();
    if (session && session.role !== 'ADMIN') {
      router.replace('/');
      return;
    }
    load().catch(e => setError(e instanceof Error ? e.message : 'Não foi possível carregar os usuários.'));
  }, [router]);

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function startEdit(user: UserRecord) {
    setEditingId(user.id);
    setForm({ name: user.name, email: user.email, password: '', role: user.role, active: user.active });
    setError('');
    setSuccess('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      if (editingId) {
        await api<UserRecord>(`/users/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            role: form.role,
            active: form.active,
          }),
        });
        setSuccess('Usuário atualizado com sucesso.');
      } else {
        await api<UserRecord>('/users', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        setSuccess('Usuário criado com sucesso.');
      }

      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar o usuário.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: UserRecord) {
    const action = user.active ? 'desativar' : 'ativar';
    if (!window.confirm(`Deseja ${action} o usuário "${user.name}"?`)) return;

    setError('');
    setSuccess('');
    try {
      await api(`/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: !user.active }),
      });
      setSuccess(`Usuário ${user.active ? 'desativado' : 'ativado'} com sucesso.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Falha ao ${action} o usuário.`);
    }
  }

  async function remove(user: UserRecord) {
    if (!window.confirm(`Excluir definitivamente o usuário "${user.name}" (${user.email})?`)) return;

    setError('');
    setSuccess('');
    try {
      const result = await api<{ message: string }>(`/users/${user.id}`, { method: 'DELETE' });
      setSuccess(result.message);
      if (editingId === user.id) resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao excluir o usuário.');
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (!passwordTarget) return;

    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const result = await api<{ message: string }>(`/users/${passwordTarget.id}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password: newPassword }),
      });
      setPasswordTarget(null);
      setNewPassword('');
      setSuccess(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao alterar a senha.');
    } finally {
      setSaving(false);
    }
  }

  return <>
    <div className="page-head">
      <div>
        <div className="eyebrow">Administração</div>
        <h1>Usuários</h1>
        <div className="page-description">Controle quem pode acessar e administrar o inventário.</div>
      </div>
      <div className="count-pill">{items.length} usuário(s)</div>
    </div>

    {(error || success) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || success}</div>}

    <section className="users-layout">
      <div className="card form-card user-form-card">
        <div className="card-heading">
          <div className="card-icon">{editingId ? 'E' : '+'}</div>
          <div>
            <h2>{editingId ? 'Editar usuário' : 'Novo usuário'}</h2>
            <p>{editingId ? 'Atualize os dados e o perfil de acesso.' : 'Crie uma nova conta de acesso ao sistema.'}</p>
          </div>
        </div>

        <form onSubmit={submit} className="stack-form">
          <div className="form-field"><label>Nome *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nome do usuário" required /></div>
          <div className="form-field"><label>E-mail *</label><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="usuario@empresa.com.br" required /></div>
          {!editingId && <div className="form-field"><label>Senha inicial *</label><input type="password" minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Mínimo de 8 caracteres" required /><div className="field-help">O usuário poderá entrar imediatamente após a criação.</div></div>}
          <div className="form-field"><label>Perfil de acesso *</label><select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as UserRole })}><option value="VIEWER">Visualizador</option><option value="MANAGER">Gestor</option><option value="ADMIN">Administrador</option></select></div>
          {editingId && <label className="toggle-row"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /><span><strong>Usuário ativo</strong><small>Usuários inativos não conseguem entrar no sistema.</small></span></label>}

          <div className="form-actions-row">
            {editingId && <button type="button" className="secondary" onClick={resetForm}>Cancelar</button>}
            <button className="primary" disabled={saving}>{saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Criar usuário'}</button>
          </div>
        </form>
      </div>

      <div className="card users-info-card">
        <div className="eyebrow">Perfis</div>
        <h2>Níveis de acesso</h2>
        <div className="permission-list">
          <div><span className="role-badge role-admin">Administrador</span><p>Acesso total, incluindo gerenciamento de usuários.</p></div>
          <div><span className="role-badge role-manager">Gestor</span><p>Pode criar, alterar e excluir ativos, pools, categorias, pastas e importações.</p></div>
          <div><span className="role-badge role-viewer">Visualizador</span><p>Pode consultar o inventário, mas não pode fazer alterações.</p></div>
        </div>
      </div>
    </section>

    <section className="card section-card">
      <div className="section-heading">
        <div><h2>Usuários cadastrados</h2><p>Contas que possuem ou possuíram acesso ao inventário.</p></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Usuário</th><th>Perfil</th><th>Status</th><th>Criado em</th><th className="align-right">Ações</th></tr></thead>
          <tbody>
            {items.map(user => {
              const isSelf = currentUser?.id === user.id;
              return <tr key={user.id}>
                <td><div className="user-cell"><div className="table-avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><div className="entity-title">{user.name}{isSelf ? ' (você)' : ''}</div><div className="entity-subtitle">{user.email}</div></div></div></td>
                <td><span className={`role-badge role-${user.role.toLowerCase()}`}>{roleLabel(user.role)}</span></td>
                <td><span className={`status-badge ${user.active ? 'status-active' : 'status-inactive'}`}><span />{user.active ? 'Ativo' : 'Inativo'}</span></td>
                <td>{new Date(user.createdAt).toLocaleDateString('pt-BR')}</td>
                <td className="align-right"><div className="row-actions">
                  <button type="button" className="table-action" onClick={() => startEdit(user)}>Editar</button>
                  <button type="button" className="table-action" onClick={() => { setPasswordTarget(user); setNewPassword(''); }}>Senha</button>
                  <button type="button" className="table-action" disabled={isSelf} onClick={() => toggleActive(user)}>{user.active ? 'Desativar' : 'Ativar'}</button>
                  <button type="button" className="icon-danger" disabled={isSelf} onClick={() => remove(user)}>Excluir</button>
                </div></td>
              </tr>;
            })}
            {items.length === 0 && <tr><td colSpan={5}><div className="empty-state">Nenhum usuário cadastrado.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    {passwordTarget && <div className="modal-backdrop" onMouseDown={() => setPasswordTarget(null)}>
      <div className="modal-card" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-heading"><div><div className="eyebrow">Segurança</div><h2>Alterar senha</h2><p>Defina uma nova senha para <strong>{passwordTarget.name}</strong>.</p></div><button type="button" className="modal-close" onClick={() => setPasswordTarget(null)}>×</button></div>
        <form onSubmit={changePassword} className="stack-form">
          <div className="form-field"><label>Nova senha *</label><input type="password" value={newPassword} minLength={8} onChange={e => setNewPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" autoFocus required /></div>
          <div className="form-actions-row"><button type="button" className="secondary" onClick={() => setPasswordTarget(null)}>Cancelar</button><button className="primary" disabled={saving}>Alterar senha</button></div>
        </form>
      </div>
    </div>}
  </>;
}
