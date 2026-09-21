'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { defaultPermissionsForRole, getSessionUser, roleLabel, type PermissionCode, type UserRole } from '../../lib/session';

type UserRecord = {
  id: string; name: string; email: string; role: UserRole; active: boolean; permissions: PermissionCode[];
  createdAt: string; updatedAt: string;
  poolAccess: Array<{ poolId: string; pool: { name: string; active: boolean } }>;
};
type UserForm = {
  poolIds: string[]; name: string; email: string; password: string; role: UserRole; active: boolean; permissions: PermissionCode[];
};

type PermissionOption = { code: PermissionCode; label: string; description: string };
const permissionGroups: Array<{ title: string; permissions: PermissionOption[] }> = [
  { title: 'Consulta', permissions: [
    { code: 'GLOBAL_ASSET_LOOKUP', label: 'Consulta global por patrimônio', description: 'Localiza até 50 patrimônios exatos em qualquer Setor sem liberar a listagem global.' },
    { code: 'GLOBAL_DASHBOARD_STATS', label: 'Indicadores globais no Dashboard', description: 'Total, valor patrimonial, em uso e disponíveis considerando todos os Setores.' },
  ] },
  { title: 'Ativos', permissions: [
    { code: 'ASSET_CREATE', label: 'Cadastrar ativos', description: 'Cria patrimônios nos Setores permitidos.' },
    { code: 'ASSET_EDIT', label: 'Editar ativos', description: 'Altera cadastro, status e classificação dos ativos permitidos.' },
    { code: 'ASSET_MOVE', label: 'Movimentar ativos', description: 'Move ativos entre Setores/pastas aos quais o usuário possui acesso.' },
    { code: 'ASSET_DELETE', label: 'Excluir ativos', description: 'Exclui ativos quando as regras de integridade permitem.' },
    { code: 'IMPORT_ASSETS', label: 'Importar ativos', description: 'Analisa e importa planilhas para os Setores permitidos.' },
  ] },
  { title: 'Itens não patrimoniados', permissions: [
    { code: 'NON_PATRIMONIAL_CREATE', label: 'Cadastrar itens não patrimoniados', description: 'Cadastra itens sem código patrimonial nos Setores permitidos.' },
    { code: 'NON_PATRIMONIAL_EDIT', label: 'Editar itens não patrimoniados', description: 'Altera descrição, categoria, localização e responsável.' },
    { code: 'NON_PATRIMONIAL_MOVE', label: 'Movimentar itens não patrimoniados', description: 'Registra entradas, baixas, ajustes e transferências entre Setores permitidos.' },
    { code: 'NON_PATRIMONIAL_ARCHIVE', label: 'Arquivar itens não patrimoniados', description: 'Arquiva itens com saldo zerado, preservando o histórico.' },
    { code: 'IMPORT_NON_PATRIMONIAL', label: 'Importar itens não patrimoniados', description: 'Importa CSV, XLS, XLSX ou XML sem exigir patrimônio.' },
  ] },
  { title: 'Setores e estrutura', permissions: [
    { code: 'POOL_CREATE', label: 'Criar Setor', description: 'Cria um novo Setor e recebe acesso automático a ele.' },
    { code: 'POOL_EDIT', label: 'Editar / inativar Setor', description: 'Altera Setores aos quais o usuário possui acesso.' },
    { code: 'POOL_DELETE', label: 'Excluir Setor', description: 'Exclui Setores vazios aos quais o usuário possui acesso.' },
    { code: 'CATEGORY_CREATE', label: 'Criar categoria', description: 'Cria categorias globais do catálogo.' },
    { code: 'CATEGORY_EDIT', label: 'Editar categoria', description: 'Renomeia e reorganiza categorias globais.' },
    { code: 'CATEGORY_DELETE', label: 'Excluir categoria', description: 'Exclui categorias globais sem vínculos.' },
    { code: 'FOLDER_CREATE', label: 'Criar pasta', description: 'Cria pastas e subpastas dentro dos Setores permitidos.' },
    { code: 'FOLDER_DELETE', label: 'Excluir pasta', description: 'Exclui pastas vazias dentro dos Setores permitidos.' },
  ] },
  { title: 'Estoque e componentes', permissions: [
    { code: 'STOCK_MANAGE', label: 'Gerenciar estoque e componentes', description: 'Cria perfis, movimenta saldo e associa/remove componentes nos Setores permitidos.' },
  ] },
];

const emptyForm: UserForm = { poolIds: [], name: '', email: '', password: '', role: 'VIEWER', active: true, permissions: [] };

export default function UsersPage() {
  const router = useRouter();
  const [pools, setPools] = useState<Array<{ id: string; name: string; active: boolean }>>([]);
  const [items, setItems] = useState<UserRecord[]>([]);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<UserRecord | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const currentUser = getSessionUser();

  const load = async () => {
    const [users, poolData] = await Promise.all([api<UserRecord[]>('/users'), api<Array<{ id: string; name: string; active: boolean }>>('/pools')]);
    setItems(users); setPools(poolData);
  };

  useEffect(() => {
    const session = getSessionUser();
    if (session && session.role !== 'ADMIN') { router.replace('/'); return; }
    load().catch(e => setError(e instanceof Error ? e.message : 'Não foi possível carregar os usuários.'));
  }, [router]);

  function resetForm() { setEditingId(null); setForm(emptyForm); }
  function startEdit(user: UserRecord) {
    setEditingId(user.id);
    setForm({ name: user.name, email: user.email, password: '', role: user.role, active: user.active, permissions: user.permissions || [], poolIds: user.poolAccess.map(p => p.poolId) });
    setError(''); setSuccess(''); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function changeRole(role: UserRole) {
    setForm(current => ({ ...current, role, permissions: role === 'ADMIN' ? [] : defaultPermissionsForRole(role), poolIds: role === 'ADMIN' ? [] : current.poolIds }));
  }
  function togglePermission(code: PermissionCode, enabled: boolean) {
    setForm(current => ({ ...current, permissions: enabled ? [...new Set([...current.permissions, code])] : current.permissions.filter(item => item !== code) }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    try {
      const body = { name: form.name, email: form.email, role: form.role, active: form.active, permissions: form.permissions, poolIds: form.poolIds };
      if (editingId) {
        await api<UserRecord>(`/users/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
        setSuccess('Usuário atualizado com sucesso.');
      } else {
        await api<UserRecord>('/users', { method: 'POST', body: JSON.stringify({ ...body, password: form.password }) });
        setSuccess('Usuário criado com sucesso.');
      }
      resetForm(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao salvar o usuário.'); }
    finally { setSaving(false); }
  }

  async function toggleActive(user: UserRecord) {
    const action = user.active ? 'desativar' : 'ativar';
    if (!window.confirm(`Deseja ${action} o usuário "${user.name}"?`)) return;
    setError(''); setSuccess('');
    try { await api(`/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ active: !user.active }) }); setSuccess(`Usuário ${user.active ? 'desativado' : 'ativado'} com sucesso.`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : `Falha ao ${action} o usuário.`); }
  }
  async function remove(user: UserRecord) {
    if (!window.confirm(`Excluir definitivamente o usuário "${user.name}" (${user.email})?`)) return;
    setError(''); setSuccess('');
    try { const result = await api<{ message: string }>(`/users/${user.id}`, { method: 'DELETE' }); setSuccess(result.message); if (editingId === user.id) resetForm(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao excluir o usuário.'); }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault(); if (!passwordTarget) return;
    setError(''); setSuccess(''); setSaving(true);
    try { const result = await api<{ message: string }>(`/users/${passwordTarget.id}/password`, { method: 'PUT', body: JSON.stringify({ password: newPassword }) }); setPasswordTarget(null); setNewPassword(''); setSuccess(result.message); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao alterar a senha.'); }
    finally { setSaving(false); }
  }

  return <>
    <div className="page-head"><div className="page-head-content"><div className="eyebrow">Administração</div><h1>Usuários</h1><div className="page-description">Setores definem o que o usuário enxerga; permissões adicionais definem o que ele pode fazer.</div></div><div className="count-pill">{items.length} usuário(s)</div></div>
    {(error || success) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || success}</div>}

    <section className="users-layout">
      <div className="card form-card user-form-card"><div className="card-heading"><div className="card-icon">{editingId ? 'E' : '+'}</div><div><h2>{editingId ? 'Editar usuário' : 'Novo usuário'}</h2><p>{editingId ? 'Ajuste o escopo e as ações permitidas.' : 'Crie uma conta com o menor acesso necessário.'}</p></div></div>
        <form onSubmit={submit} className="stack-form">
          <div className="form-field"><label>Nome *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
          <div className="form-field"><label>E-mail *</label><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></div>
          {!editingId && <div className="form-field"><label>Senha inicial *</label><input type="password" minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required /><div className="field-help">O usuário poderá entrar imediatamente após a criação.</div></div>}
          <div className="form-field"><label>Perfil base *</label><select value={form.role} onChange={e => changeRole(e.target.value as UserRole)}><option value="VIEWER">Visualizador</option><option value="MANAGER">Gestor</option><option value="ADMIN">Administrador</option></select><div className="field-help">O perfil serve como modelo inicial. As permissões abaixo controlam as ações efetivas.</div></div>

          <fieldset className="pool-permissions"><legend>Setores permitidos</legend>{form.role === 'ADMIN' ? <p>Administradores acessam todos os Setores.</p> : <><p>Sem seleção, o usuário não enxerga ativos ou estoque de nenhum Setor.</p>{pools.map(pool => <label className="permission-check" key={pool.id}><input type="checkbox" checked={form.poolIds.includes(pool.id)} onChange={e => setForm({ ...form, poolIds: e.target.checked ? [...form.poolIds, pool.id] : form.poolIds.filter(id => id !== pool.id) })} /><span>{pool.name}{pool.active ? '' : ' (inativo)'}</span></label>)}</>}</fieldset>

          <fieldset className="pool-permissions permission-groups"><legend>Permissões adicionais</legend>{form.role === 'ADMIN' ? <p>Administradores possuem todas as permissões operacionais e acesso global.</p> : permissionGroups.map(group => <div className="permission-group" key={group.title}><h3>{group.title}</h3>{group.permissions.map(permission => <label className="permission-check permission-check-detailed" key={permission.code}><input type="checkbox" checked={form.permissions.includes(permission.code)} onChange={e => togglePermission(permission.code, e.target.checked)} /><span><strong>{permission.label}</strong><br /><small>{permission.description}</small></span></label>)}</div>)}</fieldset>

          {editingId && <label className="toggle-row"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /><span><strong>Usuário ativo</strong><small>Usuários inativos não conseguem entrar.</small></span></label>}
          <div className="form-actions-row">{editingId && <button type="button" className="secondary" onClick={resetForm}>Cancelar</button>}<button className="primary" disabled={saving}>{saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Criar usuário'}</button></div>
        </form>
      </div>

      <div className="card users-info-card"><div className="eyebrow">Modelo</div><h2>Escopo x permissões</h2><div className="permission-list"><div><span className="role-badge role-admin">Administrador</span><p>Acesso total e gestão de usuários.</p></div><div><span className="role-badge role-manager">Gestor</span><p>Começa com permissões operacionais comuns, mas você pode marcar ou desmarcar ações.</p></div><div><span className="role-badge role-viewer">Visualizador</span><p>Começa sem ações de escrita e pode receber somente as permissões necessárias.</p></div></div><div className="notice notice-info">Exemplo: um Visualizador do RH pode receber apenas <strong>Criar Setor</strong>, <strong>Consulta global por patrimônio</strong> e <strong>Indicadores globais</strong>, sem ganhar edição ou exclusão de ativos.</div></div>
    </section>

    <section className="card section-card"><div className="section-heading"><div><h2>Usuários cadastrados</h2><p>Resumo do escopo e das permissões explícitas.</p></div></div><div className="table-wrap"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Setores permitidos</th><th>Permissões</th><th>Status</th><th>Criado em</th><th className="align-right">Ações</th></tr></thead><tbody>
      {items.map(user => { const isSelf = currentUser?.id === user.id; return <tr key={user.id}><td><div className="user-cell"><div className="table-avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><div className="entity-title">{user.name}{isSelf ? ' (você)' : ''}</div><div className="entity-subtitle">{user.email}</div></div></div></td><td><span className={`role-badge role-${user.role.toLowerCase()}`}>{roleLabel(user.role)}</span></td><td>{user.role === 'ADMIN' ? 'Todos os Setores' : user.poolAccess.map(p => p.pool.name).join(', ') || 'Nenhum Setor liberado'}</td><td>{user.role === 'ADMIN' ? 'Todas (Admin)' : `${user.permissions.length} permissão(ões)`}</td><td><span className={`status-badge ${user.active ? 'status-active' : 'status-inactive'}`}><span />{user.active ? 'Ativo' : 'Inativo'}</span></td><td>{new Date(user.createdAt).toLocaleDateString('pt-BR')}</td><td className="align-right"><div className="row-actions"><button type="button" className="table-action" onClick={() => startEdit(user)}>Editar</button><button type="button" className="table-action" onClick={() => { setPasswordTarget(user); setNewPassword(''); }}>Senha</button><button type="button" className="table-action" disabled={isSelf} onClick={() => toggleActive(user)}>{user.active ? 'Desativar' : 'Ativar'}</button><button type="button" className="icon-danger" disabled={isSelf} onClick={() => remove(user)}>Excluir</button></div></td></tr>; })}
      {items.length === 0 && <tr><td colSpan={7}><div className="empty-state">Nenhum usuário cadastrado.</div></td></tr>}
    </tbody></table></div></section>

    {passwordTarget && <div className="modal-backdrop" onMouseDown={() => setPasswordTarget(null)}><div className="modal-card" onMouseDown={e => e.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">Segurança</div><h2>Alterar senha</h2><p>Defina uma nova senha para <strong>{passwordTarget.name}</strong>.</p></div><button type="button" className="modal-close" onClick={() => setPasswordTarget(null)}>×</button></div><form onSubmit={changePassword} className="stack-form"><div className="form-field"><label>Nova senha *</label><input type="password" value={newPassword} minLength={8} onChange={e => setNewPassword(e.target.value)} autoFocus required /></div><div className="form-actions-row"><button type="button" className="secondary" onClick={() => setPasswordTarget(null)}>Cancelar</button><button className="primary" disabled={saving}>Alterar senha</button></div></form></div></div>}
  </>;
}
