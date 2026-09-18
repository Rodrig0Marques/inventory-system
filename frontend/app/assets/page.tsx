'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { getSessionUser, hasPermission } from '../../lib/session';

type Pool = { id: string; name: string };
type Folder = { id: string; name: string; poolId: string };
type Category = { id: string; name: string };
type AssetStatus = 'AVAILABLE' | 'IN_USE' | 'RESERVED' | 'MAINTENANCE' | 'DAMAGED' | 'LOST' | 'LOANED' | 'DISPOSED' | 'SOLD' | 'INACTIVE';
type GlobalAsset = {
  id: string; patrimonyNumber: string; name: string; description?: string | null; status: string;
  manufacturer?: string | null; model?: string | null; location?: string | null; responsible?: string | null;
  pool: Pool; category: Category; folder?: { id: string; name: string } | null;
};
type Asset = {
  id: string; patrimonyNumber: string; name: string; description?: string | null; manufacturer?: string | null;
  model?: string | null; purchasePrice?: string | number | null; status: AssetStatus; location?: string | null;
  responsible?: string | null; pool: Pool; category: Category;
};

type Filters = { search: string; poolId: string; categoryId: string; status: string };

const emptyForm = {
  patrimonyNumber: '', name: '', description: '', manufacturer: '', model: '', purchasePrice: '',
  location: '', responsible: '', poolId: '', folderId: '', categoryId: '',
};
const emptyFilters: Filters = { search: '', poolId: '', categoryId: '', status: '' };
const statusOptions: Array<{ value: AssetStatus; label: string }> = [
  { value: 'AVAILABLE', label: 'Disponível' }, { value: 'IN_USE', label: 'Em uso' }, { value: 'RESERVED', label: 'Reservado' },
  { value: 'MAINTENANCE', label: 'Em manutenção' }, { value: 'DAMAGED', label: 'Danificado' }, { value: 'LOST', label: 'Perdido' },
  { value: 'LOANED', label: 'Emprestado' }, { value: 'DISPOSED', label: 'Baixado / descartado' }, { value: 'SOLD', label: 'Vendido' },
  { value: 'INACTIVE', label: 'Inativo' },
];

function formatPrice(value: Asset['purchasePrice']) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number) : '-';
}
function statusLabel(status: string) { return statusOptions.find(item => item.value === status)?.label || status; }
function statusClass(status: string) { return ['AVAILABLE', 'IN_USE'].includes(status) ? `asset-status asset-status-${status.toLowerCase()}` : 'asset-status'; }

export default function AssetsPage() {
  const [items, setItems] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pools, setPools] = useState<Pool[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canGlobalLookup, setCanGlobalLookup] = useState(false);
  const [globalPatrimony, setGlobalPatrimony] = useState('');
  const [globalResults, setGlobalResults] = useState<GlobalAsset[]>([]);
  const [globalNotFound, setGlobalNotFound] = useState<string[]>([]);
  const [globalSearched, setGlobalSearched] = useState(false);
  const [globalSearching, setGlobalSearching] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const pageSize = 50;

  const availableFolders = useMemo(() => folders.filter(folder => folder.poolId === form.poolId), [folders, form.poolId]);

  async function loadAssets(nextFilters = appliedFilters, nextPage = page) {
    const params = new URLSearchParams();
    if (nextFilters.search.trim()) params.set('search', nextFilters.search.trim());
    if (nextFilters.poolId) params.set('poolId', nextFilters.poolId);
    if (nextFilters.categoryId) params.set('categoryId', nextFilters.categoryId);
    if (nextFilters.status) params.set('status', nextFilters.status);
    params.set('page', String(nextPage));
    params.set('pageSize', String(pageSize));
    const result = await api<{ items: Asset[]; total: number }>(`/assets?${params.toString()}`);
    setItems(result.items);
    setTotal(result.total);
  }

  function syncUrl(next: Filters) {
    const params = new URLSearchParams();
    if (next.search.trim()) params.set('search', next.search.trim());
    if (next.poolId) params.set('poolId', next.poolId);
    if (next.categoryId) params.set('categoryId', next.categoryId);
    if (next.status) params.set('status', next.status);
    const query = params.toString();
    window.history.replaceState(null, '', query ? `/assets?${query}` : '/assets');
  }

  useEffect(() => {
    const session = getSessionUser();
    setCanCreate(hasPermission('ASSET_CREATE', session));
    setCanEdit(hasPermission('ASSET_EDIT', session));
    setCanDelete(hasPermission('ASSET_DELETE', session));
    setCanGlobalLookup(hasPermission('GLOBAL_ASSET_LOOKUP', session));

    const params = new URLSearchParams(window.location.search);
    const initial: Filters = {
      search: params.get('search') || '', poolId: params.get('poolId') || '',
      categoryId: params.get('categoryId') || '', status: params.get('status') || '',
    };
    setFilters(initial);
    setAppliedFilters(initial);

    Promise.all([api<Pool[]>('/pools'), api<Folder[]>('/folders'), api<Category[]>('/categories')])
      .then(([poolData, folderData, categoryData]) => {
        setPools(poolData); setFolders(folderData); setCategories(categoryData);
        setForm(current => ({ ...current, poolId: current.poolId || poolData[0]?.id || '', categoryId: current.categoryId || categoryData[0]?.id || '' }));
      })
      .catch(() => setError('Não foi possível carregar a estrutura.'));

    loadAssets(initial, 1).catch(() => setError('Não foi possível carregar os ativos.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyFilters(event?: FormEvent) {
    event?.preventDefault(); setError('');
    setAppliedFilters(filters); setPage(1); syncUrl(filters);
    try { await loadAssets(filters, 1); } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao filtrar ativos.'); }
  }

  async function clearFilters() {
    setFilters(emptyFilters); setAppliedFilters(emptyFilters); setPage(1); syncUrl(emptyFilters);
    try { await loadAssets(emptyFilters, 1); } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar ativos.'); }
  }

  async function changePage(nextPage: number) {
    setPage(nextPage);
    try { await loadAssets(appliedFilters, nextPage); } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar a página.'); }
  }

  async function globalLookup(event: FormEvent) {
    event.preventDefault();
    const patrimony = globalPatrimony.trim();
    if (!patrimony || globalSearching) return;
    setGlobalSearching(true); setGlobalError(''); setGlobalSearched(false);
    try {
      const result = await api<{ items: GlobalAsset[]; notFound: string[] }>(`/assets/global-lookup?patrimony=${encodeURIComponent(patrimony)}`);
      setGlobalResults(result.items); setGlobalNotFound(result.notFound || []); setGlobalSearched(true);
    } catch (e) {
      setGlobalResults([]); setGlobalNotFound([]); setGlobalSearched(true);
      setGlobalError(e instanceof Error ? e.message : 'Falha ao consultar os patrimônios.');
    } finally { setGlobalSearching(false); }
  }

  async function create(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess(''); setSaving(true);
    try {
      await api('/assets', { method: 'POST', body: JSON.stringify({
        patrimonyNumber: form.patrimonyNumber, name: form.name, description: form.description || null,
        manufacturer: form.manufacturer || null, model: form.model || null,
        purchasePrice: form.purchasePrice ? Number(form.purchasePrice) : null, location: form.location || null,
        responsible: form.responsible || null, poolId: form.poolId, folderId: form.folderId || null, categoryId: form.categoryId,
      }) });
      setSuccess('Ativo cadastrado com sucesso.');
      setForm(current => ({ ...emptyForm, poolId: current.poolId, categoryId: current.categoryId }));
      await loadAssets(appliedFilters, page);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao cadastrar ativo.'); }
    finally { setSaving(false); }
  }

  async function removeAsset(asset: Asset) {
    if (!window.confirm(`Deseja excluir o ativo ${asset.patrimonyNumber} - ${asset.name}?`)) return;
    setError(''); setSuccess('');
    try {
      const result = await api<{ message: string }>(`/assets/${asset.id}`, { method: 'DELETE' });
      setSuccess(result.message); await loadAssets(appliedFilters, page);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao excluir ativo.'); }
  }

  const hasStructure = pools.length > 0 && categories.length > 0;

  return <>
    <div className="page-head"><div className="page-head-content"><div className="eyebrow">Patrimônio</div><h1>Ativos</h1><div className="page-description">Consulte e gerencie os patrimônios. Use os filtros para recortar por Pool, categoria e status.</div></div><div className="count-pill">{total} ativo(s)</div></div>
    {(error || success) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || success}</div>}

    <section className="card section-card asset-filter-card">
      <div className="section-heading"><div><h2>Filtros</h2><p>A listagem respeita somente os Pools liberados para sua conta.</p></div></div>
      <form className="asset-filter-grid" onSubmit={applyFilters}>
        <label className="form-field"><span>Buscar</span><input value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} placeholder="Patrimônio, nome, fabricante, modelo..." /></label>
        <label className="form-field"><span>Pool</span><select value={filters.poolId} onChange={e => setFilters({ ...filters, poolId: e.target.value })}><option value="">Todos os meus Pools</option>{pools.map(pool => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></label>
        <label className="form-field"><span>Categoria</span><select value={filters.categoryId} onChange={e => setFilters({ ...filters, categoryId: e.target.value })}><option value="">Todas as categorias</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="form-field"><span>Status</span><select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">Todos</option>{statusOptions.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
        <div className="asset-filter-actions"><button className="primary">Filtrar</button><button type="button" className="secondary" onClick={clearFilters}>Limpar</button></div>
      </form>
    </section>

    {canGlobalLookup && <section className="card section-card">
      <div className="section-heading"><div><h2>Consulta por patrimônio</h2><p>Cole até 50 códigos exatos, separados por linha, vírgula ou ponto e vírgula. A consulta não amplia sua listagem normal.</p></div></div>
      <form className="global-lookup-form" onSubmit={globalLookup}>
        <textarea rows={4} value={globalPatrimony} onChange={e => { setGlobalPatrimony(e.target.value); setGlobalSearched(false); setGlobalError(''); }} placeholder={'C0595\nC0594\nC0593'} maxLength={5000} />
        <button className="secondary" disabled={globalSearching || !globalPatrimony.trim()}>{globalSearching ? 'Consultando...' : 'Consultar em todos os Pools'}</button>
      </form>
      {globalError && <div className="notice notice-error">{globalError}</div>}
      {globalSearched && !globalError && globalResults.length === 0 && <div className="empty-state">Nenhum dos patrimônios informados foi encontrado.</div>}
      {globalNotFound.length > 0 && <div className="notice notice-warning"><strong>Não encontrados:</strong> {globalNotFound.join(', ')}</div>}
      {globalResults.length > 0 && <div className="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Ativo</th><th>Pool</th><th>Categoria</th><th>Status</th><th>Localização</th><th>Responsável</th></tr></thead><tbody>{globalResults.map(item => <tr key={item.id}><td><span className="patrimony-code">{item.patrimonyNumber}</span></td><td><div className="entity-title">{item.name}</div><div className="entity-subtitle">{[item.manufacturer, item.model].filter(Boolean).join(' - ') || item.description || '-'}</div></td><td><span className="pool-badge">{item.pool.name}</span>{item.folder && <div className="entity-subtitle">{item.folder.name}</div>}</td><td>{item.category.name}</td><td>{statusLabel(item.status)}</td><td>{item.location || '-'}</td><td>{item.responsible || '-'}</td></tr>)}</tbody></table></div>}
    </section>}

    {canCreate && !hasStructure && <div className="notice notice-warning">Para cadastrar ativos, crie pelo menos um <Link href="/pools">Pool</Link> e uma <Link href="/structure">categoria</Link>.</div>}
    {canCreate && <section className="card section-card form-section">
      <div className="section-heading"><div><h2>Novo ativo</h2><p>Ativos são patrimônios principais. Componentes e peças ficam em Estoque e componentes.</p></div></div>
      <form onSubmit={create} className="form-grid asset-form">
        <div className="form-field"><label>Pool *</label><select value={form.poolId} onChange={e => setForm({ ...form, poolId: e.target.value, folderId: '' })} required disabled={!pools.length}><option value="">Selecione</option>{pools.map(pool => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></div>
        <div className="form-field"><label>Pasta</label><select value={form.folderId} onChange={e => setForm({ ...form, folderId: e.target.value })}><option value="">Sem pasta</option>{availableFolders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div>
        <div className="form-field"><label>Categoria *</label><select value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })} required disabled={!categories.length}><option value="">Selecione</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
        <div className="form-field"><label>Patrimônio *</label><input value={form.patrimonyNumber} onChange={e => setForm({ ...form, patrimonyNumber: e.target.value })} required /></div>
        <div className="form-field"><label>Nome *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
        <div className="form-field"><label>Fabricante</label><input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} /></div>
        <div className="form-field"><label>Modelo</label><input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} /></div>
        <div className="form-field"><label>Preço</label><input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={e => setForm({ ...form, purchasePrice: e.target.value })} /></div>
        <div className="form-field"><label>Localização</label><input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></div>
        <div className="form-field"><label>Responsável</label><input value={form.responsible} onChange={e => setForm({ ...form, responsible: e.target.value })} /></div>
        <div className="form-field full-field"><label>Descrição</label><textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="actions full-field"><button className="primary" disabled={!hasStructure || saving}>{saving ? 'Cadastrando...' : 'Cadastrar ativo'}</button></div>
      </form>
    </section>}

    <section className="card section-card">
      <div className="section-heading"><div><h2>Ativos cadastrados</h2><p>{total} patrimônio(s) no recorte atual.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Nome</th><th>Fabricante</th><th>Modelo</th><th>Preço</th><th>Localização</th><th>Responsável</th><th>Status</th><th>Pool</th><th>Categoria</th>{(canEdit || canDelete) && <th className="align-right">Ações</th>}</tr></thead><tbody>
        {items.map(asset => <tr key={asset.id}><td><span className="patrimony-code">{asset.patrimonyNumber}</span></td><td><Link className="entity-title" href={`/assets/${asset.id}`}>{asset.name}</Link><div className="entity-subtitle">Ver detalhes e componentes</div></td><td>{asset.manufacturer || '-'}</td><td>{asset.model || '-'}</td><td>{formatPrice(asset.purchasePrice)}</td><td>{asset.location || '-'}</td><td>{asset.responsible || '-'}</td><td><span className={statusClass(asset.status)}>{statusLabel(asset.status)}</span></td><td><Link href={`/assets?poolId=${encodeURIComponent(asset.pool.id)}`} className="pool-badge">{asset.pool.name}</Link></td><td>{asset.category.name}</td>{(canEdit || canDelete) && <td className="align-right"><div className="row-actions">{canEdit && <Link className="table-action" href={`/assets/${asset.id}/edit`}>Editar</Link>}{canDelete && <button type="button" className="icon-danger" onClick={() => removeAsset(asset)}>Excluir</button>}</div></td>}</tr>)}
        {items.length === 0 && <tr><td colSpan={(canEdit || canDelete) ? 11 : 10}><div className="empty-state">Nenhum ativo encontrado.</div></td></tr>}
      </tbody></table></div>
      {total > pageSize && <div className="stock-pagination"><button type="button" className="secondary" disabled={page === 1} onClick={() => changePage(page - 1)}>Anterior</button><span>Página {page} | {total} ativos</span><button type="button" className="secondary" disabled={page * pageSize >= total} onClick={() => changePage(page + 1)}>Próxima</button></div>}
    </section>
  </>;
}
