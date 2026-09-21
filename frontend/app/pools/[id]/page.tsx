'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { getSessionUser, hasPermission } from '../../../lib/session';

type PoolDetails = {
  id: string; name: string; description?: string | null; active: boolean; categoryCount: number;
  _count: { assets: number; folders: number; nonPatrimonialItems?: number };
  stock: { total: number; available: number; installed: number };
};

export default function PoolDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [pool, setPool] = useState<PoolDetails | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', active: true });

  async function load() {
    const data = await api<PoolDetails>(`/pools/${id}`);
    setPool(data);
    setForm({ name: data.name, description: data.description || '', active: data.active });
  }

  useEffect(() => {
    const session = getSessionUser();
    setCanEdit(hasPermission('POOL_EDIT', session));
    setCanDelete(hasPermission('POOL_DELETE', session));
    load().catch(e => setError(e instanceof Error ? e.message : 'Não foi possível carregar o Setor.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!pool || saving) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      await api(`/pools/${pool.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: form.name, description: form.description || null, active: form.active }),
      });
      await load();
      setEditing(false);
      setSuccess('Setor atualizado com sucesso.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao atualizar o Setor.');
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!pool || !window.confirm(`Excluir o Setor "${pool.name}"? Setores com ativos, pastas ou perfis de estoque não podem ser excluídos.`)) return;
    setError(''); setSuccess('');
    try {
      await api(`/pools/${pool.id}`, { method: 'DELETE' });
      router.replace('/pools');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao excluir o Setor.');
    }
  }

  return <>
    <Link className="table-action asset-detail-back" href="/pools">Voltar aos Setores</Link>
    {(error || success) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || success}</div>}
    {pool && <>
      <div className="page-head asset-detail-page-head">
        <div className="page-head-content"><div className="eyebrow">Setor</div><h1>{pool.name}</h1><div className="page-description">{pool.description || 'Sem descrição cadastrada.'}</div></div>
        <div className="row-actions"><span className={`status-badge ${pool.active ? 'status-active' : 'status-inactive'}`}><span />{pool.active ? 'Ativo' : 'Inativo'}</span>{canEdit && <button type="button" className="table-action" onClick={() => setEditing(true)}>Editar</button>}{canDelete && <button type="button" className="icon-danger" onClick={remove}>Excluir</button>}</div>
      </div>

      <section className="grid pool-kpi-grid">
        <div className="card kpi-card"><div className="kpi-icon kpi-blue">A</div><div><div className="label">Ativos</div><div className="kpi">{pool._count.assets}</div></div></div>
        <div className="card kpi-card"><div className="kpi-icon kpi-violet">N</div><div><div className="label">Não patrimoniados</div><div className="kpi">{pool._count.nonPatrimonialItems || 0}</div></div></div>
        <div className="card kpi-card"><div className="kpi-icon kpi-violet">C</div><div><div className="label">Componentes</div><div className="kpi">{pool.stock.total}</div></div></div>
        <div className="card kpi-card"><div className="kpi-icon kpi-green">K</div><div><div className="label">Categorias em uso</div><div className="kpi">{pool.categoryCount}</div></div></div>
        <div className="card kpi-card"><div className="kpi-icon kpi-orange">P</div><div><div className="label">Pastas</div><div className="kpi">{pool._count.folders}</div></div></div>
      </section>

      <section className="card section-card"><div className="section-heading"><div><h2>Ações rápidas</h2><p>Ativos e componentes permanecem separados para facilitar a consulta.</p></div></div><div className="pool-quick-actions"><Link className="primary button-link" href={`/assets?poolId=${encodeURIComponent(pool.id)}`}>Ver ativos deste Setor</Link><Link className="secondary-link" href={`/non-patrimonial?poolId=${encodeURIComponent(pool.id)}`}>Ver itens não patrimoniados</Link><Link className="secondary-link" href={`/stock?poolId=${encodeURIComponent(pool.id)}`}>Ver estoque deste Setor</Link></div></section>

      {editing && <div className="modal-backdrop" onMouseDown={() => setEditing(false)}><div className="modal-card" onMouseDown={e => e.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">Setor</div><h2>Editar {pool.name}</h2><p>Altere identificação, descrição ou status do agrupamento.</p></div><button type="button" className="modal-close" onClick={() => setEditing(false)}>×</button></div><form className="stack-form" onSubmit={save}><div className="form-field"><label>Nome *</label><input required minLength={2} maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div><div className="form-field"><label>Descrição</label><textarea rows={4} maxLength={4000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div><label className="toggle-row"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /><span><strong>Setor ativo</strong><small>Ao inativar, Gestores e Visualizadores deixam de enxergar o Setor até a reativação.</small></span></label><div className="form-actions-row"><button type="button" className="secondary" onClick={() => setEditing(false)}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button></div></form></div></div>}
    </>}
    {!pool && !error && <div className="empty-state">Carregando Setor...</div>}
  </>;
}
