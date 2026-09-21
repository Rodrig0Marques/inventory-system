'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { getSessionUser, hasPermission } from '../../lib/session';

type Pool = {
  id: string; name: string; description?: string | null; active: boolean;
  _count: { assets: number; folders: number; nonPatrimonialItems?: number };
  stock?: { total: number; available: number; installed: number };
};

export default function PoolsPage() {
  const [items, setItems] = useState<Pool[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const load = () => api<Pool[]>('/pools').then(setItems);

  useEffect(() => {
    const session = getSessionUser();
    setCanCreate(hasPermission('POOL_CREATE', session));
    setCanEdit(hasPermission('POOL_EDIT', session));
    setCanDelete(hasPermission('POOL_DELETE', session));
    load().catch(() => setError('Não foi possível carregar os Setores.'));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    try {
      await api('/pools', { method: 'POST', body: JSON.stringify({ name, description: description || null }) });
      setName(''); setDescription(''); setSuccess('Setor criado com sucesso e liberado para o seu usuário.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao criar Setor.'); }
    finally { setSaving(false); }
  }

  async function toggle(pool: Pool) {
    if (!window.confirm(`${pool.active ? 'Inativar' : 'Reativar'} o Setor "${pool.name}"?`)) return;
    setError(''); setSuccess('');
    try { await api(`/pools/${pool.id}`, { method: 'PUT', body: JSON.stringify({ active: !pool.active }) }); setSuccess('Status do Setor atualizado.'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao atualizar Setor.'); }
  }

  async function remove(pool: Pool) {
    if (!window.confirm(`Excluir o Setor "${pool.name}"? Setores com ativos, pastas ou histórico não podem ser excluídos.`)) return;
    setError(''); setSuccess('');
    try { const result = await api<{ message: string }>(`/pools/${pool.id}`, { method: 'DELETE' }); setSuccess(result.message); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao excluir Setor.'); }
  }

  return <>
    <div className="page-head"><div className="page-head-content"><div className="eyebrow">Organização</div><h1>Setores</h1><div className="page-description">Separe o patrimônio por área, unidade ou finalidade. Ativos e estoque são consultados em telas próprias.</div></div><div className="count-pill">{items.length} setor(es)</div></div>
    {(error || success) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || success}</div>}

    <div className={canCreate ? 'split-layout' : ''}>
      {canCreate && <section className="card form-card"><div className="card-heading"><div className="card-icon">+</div><div><h2>Novo Setor</h2><p>Quem cria um Setor recebe acesso a ele automaticamente.</p></div></div><form onSubmit={create} className="stack-form"><div className="form-field"><label>Nome</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: ALN Almenara" required /></div><div className="form-field"><label>Descrição</label><textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição opcional" /></div><button className="primary full-button" disabled={saving}>{saving ? 'Criando...' : 'Criar Setor'}</button></form></section>}

      <section className="card"><div className="card-heading compact-heading"><div><h2>Setores cadastrados</h2><p>Use “Ver ativos” para patrimônios e “Ver estoque” para componentes.</p></div></div><div className="table-wrap"><table><thead><tr><th>Setor</th><th>Pastas</th><th>Ativos</th><th>Não patrim.</th><th>Componentes</th><th>Status</th><th className="align-right">Ações</th></tr></thead><tbody>
        {items.map(pool => <tr key={pool.id}><td><Link className="entity-title" href={`/pools/${pool.id}`}>{pool.name}</Link><div className="entity-subtitle">{pool.description || 'Sem descrição'}</div></td><td><span className="soft-badge">{pool._count.folders}</span></td><td><span className="soft-badge">{pool._count.assets}</span></td><td><span className="soft-badge">{pool._count.nonPatrimonialItems || 0}</span></td><td>{pool.stock?.total || 0} no total<br /><small>{pool.stock?.available || 0} disponíveis / {pool.stock?.installed || 0} instalados</small></td><td><span className={`status-badge ${pool.active ? 'status-active' : 'status-inactive'}`}><span />{pool.active ? 'Ativo' : 'Inativo'}</span></td><td className="align-right"><div className="row-actions"><Link className="table-action" href={`/assets?poolId=${encodeURIComponent(pool.id)}`}>Ver ativos</Link><Link className="table-action" href={`/non-patrimonial?poolId=${encodeURIComponent(pool.id)}`}>Ver não patrim.</Link><Link className="table-action" href={`/stock?poolId=${encodeURIComponent(pool.id)}`}>Ver estoque</Link>{canEdit && <button type="button" className="table-action" onClick={() => toggle(pool)}>{pool.active ? 'Inativar' : 'Reativar'}</button>}{canDelete && <button type="button" className="icon-danger" onClick={() => remove(pool)}>Excluir</button>}</div></td></tr>)}
        {items.length === 0 && <tr><td colSpan={7}><div className="empty-state">Nenhum Setor cadastrado.</div></td></tr>}
      </tbody></table></div></section>
    </div>
  </>;
}
