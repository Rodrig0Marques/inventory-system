'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Entry = { id: string; action: string; entity: string; entityId?: string; createdAt: string; user?: { name: string } | null; oldValue?: unknown; newValue?: unknown };
export default function AuditPage() {
  const [items, setItems] = useState<Entry[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [entity, setEntity] = useState(''), [action, setAction] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState({ entity: '', action: '' });
  async function load(nextPage: number, filters = applied) {
    setLoading(true); setError('');
    try { const result = await api<{ items: Entry[]; total: number }>(`/audit?${new URLSearchParams({ page: String(nextPage), entity: filters.entity, action: filters.action })}`); setItems(result.items); setTotal(result.total); setPage(nextPage); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível consultar a auditoria.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(1); }, []);
  function search(event: FormEvent) { event.preventDefault(); const filters = { entity, action }; setApplied(filters); void load(1, filters); }
  return <><div className="page-head"><div><div className="eyebrow">Administração</div><h1>Auditoria</h1><p className="page-description">Consulte alterações, responsáveis e os valores registrados antes e depois.</p></div></div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    <form className="card section-card toolbar" onSubmit={search}><label className="form-field"><span>Tipo de registro</span><select value={entity} onChange={event => setEntity(event.target.value)}><option value="">Todos</option>{['Asset','AssetComponent','ItemProfile','NonPatrimonialItem','Category','Folder','Pool','User'].map(value => <option key={value}>{value}</option>)}</select></label><label className="form-field"><span>Ação</span><input value={action} onChange={event => setAction(event.target.value)} placeholder="Ex.: ARCHIVE, UPDATE, IMPORT_CREATE" /></label><button className="primary" disabled={loading}>Consultar</button></form>
    <section className="card section-card"><div className="table-wrap"><table><thead><tr><th>Data</th><th>Responsável</th><th>Ação</th><th>Registro</th><th>Alterações</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('pt-BR')}</td><td>{item.user?.name || 'Usuário removido / sistema'}</td><td>{item.action}</td><td>{item.entity}<div className="entity-subtitle">{item.entityId}</div></td><td><details><summary>Ver antes / depois</summary><strong>Antes</strong><pre style={{ maxWidth: 500, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(item.oldValue, null, 2) || '—'}</pre><strong>Depois</strong><pre style={{ maxWidth: 500, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(item.newValue, null, 2) || '—'}</pre></details></td></tr>)}{!items.length && <tr><td colSpan={5}><div className="empty-state">{loading ? 'Carregando…' : 'Nenhum registro encontrado.'}</div></td></tr>}</tbody></table></div><div className="stock-pagination"><button className="secondary" disabled={loading || page === 1} onClick={() => void load(page - 1)}>Anterior</button><span>{total} registros · Página {page}</span><button className="secondary" disabled={loading || page * 50 >= total} onClick={() => void load(page + 1)}>Próxima</button></div></section>
  </>;
}
