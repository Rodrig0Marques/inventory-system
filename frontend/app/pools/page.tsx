'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { canManage, getSessionUser } from '../../lib/session';

type Pool = {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
  _count: { assets: number; folders: number };
};

export default function PoolsPage() {
  const [items, setItems] = useState<Pool[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  const load = () => api<Pool[]>('/pools').then(setItems);

  useEffect(() => {
    setCanEdit(canManage(getSessionUser()?.role));
    load().catch(() => setError('Não foi possível carregar os pools.'));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await api('/pools', { method: 'POST', body: JSON.stringify({ name, description: description || null }) });
      setName('');
      setDescription('');
      setSuccess('Pool criado com sucesso.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar pool.');
    } finally {
      setLoading(false);
    }
  }

  async function remove(pool: Pool) {
    const extra = pool._count.folders > 0 ? `\n\nAs ${pool._count.folders} pasta(s) vazia(s) deste pool também serão removidas.` : '';
    if (!window.confirm(`Excluir o pool "${pool.name}"?${extra}`)) return;

    setError('');
    setSuccess('');
    try {
      const result = await api<{ message: string }>(`/pools/${pool.id}`, { method: 'DELETE' });
      setSuccess(result.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao excluir pool.');
    }
  }

  return <>
    <div className="page-head">
      <div>
        <div className="eyebrow">Organização</div>
        <h1>Pools</h1>
        <div className="page-description">Separe o patrimônio por área, departamento ou finalidade.</div>
      </div>
      <div className="count-pill">{items.length} pool(s)</div>
    </div>

    {(error || success) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || success}</div>}
    {!canEdit && <div className="notice notice-info">Seu perfil é somente leitura. Você pode consultar os pools, mas não pode criá-los ou excluí-los.</div>}

    <div className={canEdit ? 'split-layout' : ''}>
      {canEdit && <section className="card form-card">
        <div className="card-heading">
          <div className="card-icon">+</div>
          <div><h2>Novo pool</h2><p>Crie um novo agrupamento para os ativos.</p></div>
        </div>
        <form onSubmit={create} className="stack-form">
          <div className="form-field"><label>Nome</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: TI, RH, Administrativo" required /></div>
          <div className="form-field"><label>Descrição</label><textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição opcional do pool" /></div>
          <button className="primary full-button" disabled={loading}>{loading ? 'Criando...' : 'Criar pool'}</button>
        </form>
      </section>}

      <section className="card">
        <div className="card-heading compact-heading">
          <div><h2>Pools cadastrados</h2><p>Visualize os agrupamentos existentes.</p></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Pool</th><th>Pastas</th><th>Ativos</th>{canEdit && <th className="align-right">Ações</th>}</tr></thead>
            <tbody>
              {items.map(item => <tr key={item.id}>
                <td><div className="entity-title">{item.name}</div><div className="entity-subtitle">{item.description || 'Sem descrição'}</div></td>
                <td><span className="soft-badge">{item._count.folders}</span></td>
                <td><span className="soft-badge">{item._count.assets}</span></td>
                {canEdit && <td className="align-right"><button type="button" className="icon-danger" onClick={() => remove(item)} title="Excluir pool">Excluir</button></td>}
              </tr>)}
              {items.length === 0 && <tr><td colSpan={canEdit ? 4 : 3}><div className="empty-state">Nenhum pool cadastrado.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </>;
}
