'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Icon } from '../../components/Icon';
import { Dialog } from '../../components/Dialog';
import { downloadCsv } from '../../lib/csv';
import { api } from '../../lib/api';
import { getSessionUser, hasPermission } from '../../lib/session';
import { AdvancedAssetFields, type AssetCategory, type CustomValue } from '../../components/AdvancedAssetFields';

type Pool = { id: string; name: string };
type Folder = { id: string; name: string; poolId: string };
type Category = AssetCategory;
type AssetStatus = 'AVAILABLE' | 'IN_USE' | 'RESERVED' | 'MAINTENANCE' | 'DAMAGED' | 'LOST' | 'LOANED' | 'DISPOSED' | 'SOLD' | 'INACTIVE';
type GlobalAsset = {
  id: string; patrimonyNumber: string; name: string; description?: string | null; status: string;
  manufacturer?: string | null; model?: string | null; location?: string | null; responsible?: string | null;
  pool: Pool; category: Category; folder?: { id: string; name: string } | null;
};
type Asset = {
  id: string; patrimonyNumber: string; name: string; description?: string | null; manufacturer?: string | null;
  model?: string | null; purchasePrice?: string | number | null; status: AssetStatus; location?: string | null;
  responsible?: string | null; pool: Pool; category: Category; archivedAt?: string | null;
};

type Filters = { search: string; poolId: string; categoryId: string; status: string; archived: string; includeDescendants: string };
type SavedView = { id: string; name: string; filters: Filters };

const emptyForm = {
  patrimonyNumber: '', name: '', description: '', manufacturer: '', model: '', purchasePrice: '',
  location: '', responsible: '', poolId: '', folderId: '', categoryId: '',
};
const emptyFilters: Filters = { search: '', poolId: '', categoryId: '', status: '', archived: 'false', includeDescendants: 'true' };
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
function statusClass(status: string) { return `asset-status asset-status-${status.toLowerCase()}`; }

export default function AssetsPage() {
  return <Suspense fallback={<div className="chart-placeholder" role="status">Carregando inventário…</div>}><AssetsContent /></Suspense>;
}

function AssetsContent() {
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
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
  const [showCreate, setShowCreate] = useState(false);
  const [customValues, setCustomValues] = useState<Record<string, CustomValue>>({});
  const [assetTypeId, setAssetTypeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [structureLoading, setStructureLoading] = useState(true);
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [saveDialog, setSaveDialog] = useState(false);
  const [viewName, setViewName] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<Asset | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [reactivating, setReactivating] = useState('');
  const loadVersion = useRef(0);
  const viewStorageKey = useRef('');

  useEffect(() => {
    const revealForm = () => {
      if (window.location.hash === '#new-asset') {
        setShowCreate(true);
        requestAnimationFrame(() => document.getElementById('new-asset')?.scrollIntoView({ block: 'start' }));
      }
    };
    revealForm();
    window.addEventListener('hashchange', revealForm);
    return () => window.removeEventListener('hashchange', revealForm);
  }, []);
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
  const [globalPage, setGlobalPage] = useState(1);
  const [globalTotal, setGlobalTotal] = useState(0);
  const [globalQuery, setGlobalQuery] = useState('');
  const [ambiguousCodes, setAmbiguousCodes] = useState<string[]>([]);
  const pageSize = 50;

  const availableFolders = useMemo(() => folders.filter(folder => folder.poolId === form.poolId), [folders, form.poolId]);

  async function loadAssets(nextFilters = appliedFilters, nextPage = page, signal?: AbortSignal) {
    const version = ++loadVersion.current;
    setLoading(true);
    const params = new URLSearchParams();
    if (nextFilters.search.trim()) params.set('search', nextFilters.search.trim());
    if (nextFilters.poolId) params.set('poolId', nextFilters.poolId);
    if (nextFilters.categoryId) params.set('categoryId', nextFilters.categoryId);
    if (nextFilters.status) params.set('status', nextFilters.status);
    params.set('page', String(nextPage));
    params.set('archived', nextFilters.archived);
    params.set('includeDescendants', nextFilters.includeDescendants);
    params.set('pageSize', String(pageSize));
    try {
      const result = await api<{ items: Asset[]; total: number }>(`/assets?${params.toString()}`, { signal });
      if (version !== loadVersion.current || signal?.aborted) return;
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
      if (nextPage > lastPage) { syncUrl(nextFilters, lastPage); return; }
      setItems(result.items); setTotal(result.total);
    } finally { if (version === loadVersion.current && !signal?.aborted) setLoading(false); }
  }

  function syncUrl(next: Filters, nextPage = 1) {
    const params = new URLSearchParams();
    if (next.search.trim()) params.set('search', next.search.trim());
    if (next.poolId) params.set('poolId', next.poolId);
    if (next.categoryId) params.set('categoryId', next.categoryId);
    if (next.status) params.set('status', next.status);
    if (next.archived !== 'false') params.set('archived', next.archived);
    if (next.includeDescendants !== 'true') params.set('includeDescendants', next.includeDescendants);
    if (nextPage > 1) params.set('page', String(nextPage));
    const query = params.toString();
    const target = query ? `/assets?${query}` : '/assets';
    if (query === queryString) return loadAssets(next, nextPage).catch(e => setError(e.message));
    // Next preserves its own internal state and updates useSearchParams here.
    window.history.pushState({ inventoryCanGoBack: true }, '', target);
  }

  useEffect(() => {
    const session = getSessionUser();
    setCanCreate(hasPermission('ASSET_CREATE', session));
    setCanEdit(hasPermission('ASSET_EDIT', session));
    setCanDelete(hasPermission('ASSET_DELETE', session));
    setCanGlobalLookup(hasPermission('GLOBAL_ASSET_LOOKUP', session));

    viewStorageKey.current = `inventory_asset_views_${session?.id || 'local'}`;
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(viewStorageKey.current) || '[]');
      if (Array.isArray(stored)) setSavedViews(stored.filter((item): item is SavedView => Boolean(item && typeof item.id === 'string' && typeof item.name === 'string' && item.filters && Object.keys(emptyFilters).every(key => typeof item.filters[key] === 'string'))).slice(0, 8));
      const preferred = localStorage.getItem('inventory_asset_view');
      setView(preferred === 'cards' || (preferred !== 'table' && window.matchMedia('(max-width: 700px)').matches) ? 'cards' : 'table');
    } catch { /* A preferência local não impede a consulta do inventário. */ }

    Promise.all([api<Pool[]>('/pools'), api<Folder[]>('/folders'), api<Category[]>('/categories')])
      .then(([poolData, folderData, categoryData]) => {
        setPools(poolData); setFolders(folderData); setCategories(categoryData);
        setForm(current => ({ ...current, poolId: current.poolId || poolData[0]?.id || '', categoryId: current.categoryId || categoryData[0]?.id || '' }));
      })
      .catch(() => setError('Não foi possível carregar a estrutura.'))
      .finally(() => setStructureLoading(false));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(queryString);
    const initial: Filters = {
      search: params.get('search') || '', poolId: params.get('poolId') || '', categoryId: params.get('categoryId') || '',
      status: params.get('status') || '', archived: ['true', 'all'].includes(params.get('archived') || '') ? params.get('archived')! : 'false',
      includeDescendants: params.get('includeDescendants') === 'false' ? 'false' : 'true',
    };
    const requestedPage = Number(params.get('page'));
    const nextPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const controller = new AbortController();
    setFilters(initial); setAppliedFilters(initial); setPage(nextPage); setError('');
    void loadAssets(initial, nextPage, controller.signal).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Não foi possível carregar os ativos.'); });
    return () => { controller.abort(); };
    // The URL is the source of truth, including browser back/forward and quick search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  async function applyFilters(event?: FormEvent) {
    event?.preventDefault(); setError('');
    void syncUrl(filters);
  }

  async function clearFilters() {
    setFilters(emptyFilters); setError(''); void syncUrl(emptyFilters);
  }

  async function changePage(nextPage: number) {
    void syncUrl(appliedFilters, nextPage);
  }

  async function globalLookup(event?: FormEvent, nextPage = 1) {
    event?.preventDefault();
    const patrimony = nextPage === 1 ? globalPatrimony.trim() : globalQuery;
    if (!patrimony || globalSearching) return;
    setGlobalSearching(true); setGlobalError(''); setGlobalSearched(false);
    try {
      const result = await api<{ items: GlobalAsset[]; notFound: string[]; total: number; ambiguous: string[] }>(`/assets/global-lookup?patrimony=${encodeURIComponent(patrimony)}&page=${nextPage}&pageSize=50`);
      setGlobalResults(result.items); setGlobalNotFound(result.notFound || []); setGlobalSearched(true);
      setGlobalQuery(patrimony); setGlobalPage(nextPage); setGlobalTotal(result.total); setAmbiguousCodes(result.ambiguous);
    } catch (e) {
      setGlobalResults([]); setGlobalNotFound([]); setGlobalSearched(true);
      setGlobalError(e instanceof Error ? e.message : 'Falha ao consultar os patrimônios.');
    } finally { setGlobalSearching(false); }
  }

  async function create(event: FormEvent) {
    event.preventDefault(); if (saving) return; setError(''); setSuccess(''); setSaving(true);
    try {
      await api('/assets', { method: 'POST', body: JSON.stringify({
        customValues, assetTypeId: assetTypeId || null,
        patrimonyNumber: form.patrimonyNumber, name: form.name, description: form.description || null,
        manufacturer: form.manufacturer || null, model: form.model || null,
        purchasePrice: form.purchasePrice ? Number(form.purchasePrice) : null, location: form.location || null,
        responsible: form.responsible || null, poolId: form.poolId, folderId: form.folderId || null, categoryId: form.categoryId,
      }) });
      setSuccess('Ativo cadastrado com sucesso.');
      setCustomValues({}); setAssetTypeId('');
      setForm(current => ({ ...emptyForm, poolId: current.poolId, categoryId: current.categoryId }));
      await loadAssets(appliedFilters, page);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao cadastrar ativo.'); }
    finally { setSaving(false); }
  }

  async function removeAsset() {
    if (!archiveTarget || archiving) return;
    setArchiveError(''); setSuccess(''); setArchiving(true);
    try {
      const result = await api<{ message: string }>(`/assets/${archiveTarget.id}`, { method: 'DELETE' });
      setArchiveTarget(null); setSuccess(result.message);
      await loadAssets(appliedFilters, page).catch(() => setError('Ativo arquivado. Atualize a lista para consultar os dados atuais.'));
    } catch (e) { setArchiveError(e instanceof Error ? e.message : 'Falha ao arquivar ativo.'); }
    finally { setArchiving(false); }
  }

  async function reactivate(asset: Asset) {
    if (reactivating) return;
    setReactivating(asset.id); setError(''); setSuccess('');
    try { await api(`/assets/${asset.id}/reactivate`, { method: 'POST' }); setSuccess('Ativo reativado.'); await loadAssets(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao reativar ativo.'); }
    finally { setReactivating(''); }
  }

  function persistViews(next: SavedView[]) {
    try { localStorage.setItem(viewStorageKey.current, JSON.stringify(next)); setSavedViews(next); return true; }
    catch { setError('Não foi possível salvar a visualização neste navegador.'); return false; }
  }

  function saveView(event: FormEvent) {
    event.preventDefault();
    const name = viewName.trim();
    if (!name) return;
    const next = [{ id: crypto.randomUUID(), name, filters: { ...appliedFilters } }, ...savedViews.filter(item => item.name !== name)].slice(0, 8);
    if (persistViews(next)) { setSaveDialog(false); setViewName(''); setSuccess('Visualização salva neste navegador.'); }
  }

  function exportPage() {
    downloadCsv(`ativos-pagina-${page}.csv`, [
      ['Patrimônio', 'Nome', 'Fabricante', 'Modelo', 'Preço', 'Localização', 'Responsável', 'Status', 'Setor', 'Categoria', 'Arquivado'],
      ...items.map(asset => [asset.patrimonyNumber, asset.name, asset.manufacturer, asset.model, asset.purchasePrice == null ? '' : String(asset.purchasePrice).replace('.', ','), asset.location, asset.responsible, statusLabel(asset.status), asset.pool.name, asset.category.name, asset.archivedAt ? 'Sim' : 'Não']),
    ]);
  }

  const hasStructure = pools.length > 0 && categories.length > 0;
  const activeFilters = [
    { key: 'search', label: appliedFilters.search ? `Busca: ${appliedFilters.search}` : '' },
    { key: 'poolId', label: appliedFilters.poolId ? `Setor: ${pools.find(p => p.id === appliedFilters.poolId)?.name || 'Selecionado'}` : '' },
    { key: 'categoryId', label: appliedFilters.categoryId ? `Categoria: ${categories.find(c => c.id === appliedFilters.categoryId)?.name || 'Selecionada'}` : '' },
    { key: 'status', label: appliedFilters.status ? statusLabel(appliedFilters.status) : '' },
    { key: 'archived', label: appliedFilters.archived === 'true' ? 'Arquivados' : appliedFilters.archived === 'all' ? 'Incluindo arquivados' : '' },
    { key: 'includeDescendants', label: appliedFilters.includeDescendants === 'false' ? 'Sem subcategorias' : '' },
  ].filter(item => item.label);

  return <>
    <div className="page-head"><div className="page-head-content"><div className="eyebrow">Patrimônio</div><h1>Ativos</h1><div className="page-description">Consulte e gerencie os patrimônios. Use os filtros para recortar por Setor, categoria e status.</div></div><div className="overview-actions"><div className="count-pill">{total} ativo(s)</div>{canCreate && <button type="button" className="primary" onClick={() => { setShowCreate(!showCreate); if (!showCreate) requestAnimationFrame(() => document.getElementById('new-asset')?.scrollIntoView({ block: 'start' })); }} aria-expanded={showCreate} aria-controls="new-asset">{showCreate ? 'Fechar cadastro' : '+ Novo ativo'}</button>}</div></div>
    {(error || success) && <div className={`notice dismissible-notice ${error ? 'notice-error' : 'notice-success'}`} role={error ? 'alert' : 'status'}><span>{error || success}</span><button type="button" className="icon-button" aria-label="Dispensar mensagem" onClick={() => { setError(''); setSuccess(''); }}><Icon name="close" /></button></div>}

    {savedViews.length > 0 && <nav className="saved-views" aria-label="Visualizações salvas"><span><Icon name="bookmark" />Suas visualizações</span>{savedViews.map(saved => <div className="saved-view" key={saved.id}><button type="button" onClick={() => { setError(''); void syncUrl(saved.filters); }}>{saved.name}</button><button type="button" onClick={() => persistViews(savedViews.filter(item => item.id !== saved.id))} aria-label={`Remover visualização ${saved.name}`}><Icon name="close" /></button></div>)}</nav>}

    <section className="card section-card asset-filter-card">
      <div className="section-heading"><div className="filter-title"><span className="heading-icon"><Icon name="filter" /></span><div><h2>Encontre o ativo certo</h2><p>Combine filtros para consultar o patrimônio dos seus setores.</p></div></div><button type="button" className="text-button" disabled={loading} onClick={() => setSaveDialog(true)}><Icon name="bookmark" />Salvar visualização</button></div>
      <form className="asset-filter-grid" onSubmit={applyFilters}>
        <label className="form-field"><span>Buscar</span><input value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} placeholder="Patrimônio, nome, fabricante, modelo..." /></label>
        <label className="form-field"><span>Setor</span><select value={filters.poolId} onChange={e => setFilters({ ...filters, poolId: e.target.value })}><option value="">Todos os meus Setores</option>{pools.map(pool => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></label>
        <label className="form-field"><span>Categoria</span><select value={filters.categoryId} onChange={e => setFilters({ ...filters, categoryId: e.target.value })}><option value="">Todas as categorias</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="form-field"><span>Status</span><select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">Todos</option>{statusOptions.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
        <label className="form-field"><span>Situação do cadastro</span><select value={filters.archived} onChange={e => setFilters({ ...filters, archived: e.target.value })}><option value="false">Ativos no inventário</option><option value="true">Arquivados</option><option value="all">Todos</option></select></label><label className="toggle-row"><input type="checkbox" checked={filters.includeDescendants === "true"} onChange={e => setFilters({ ...filters, includeDescendants: String(e.target.checked) })} /><span>Incluir subcategorias</span></label><div className="asset-filter-actions"><button className="primary" disabled={loading}><Icon name="search" />{loading ? 'Consultando…' : 'Aplicar filtros'}</button><button type="button" className="secondary" onClick={clearFilters} disabled={loading}>Limpar</button></div>
      </form>
      {activeFilters.length > 0 && <div className="active-filters" aria-label="Filtros aplicados"><span>Aplicados</span>{activeFilters.map(filter => <button type="button" key={filter.key} onClick={() => void syncUrl({ ...appliedFilters, [filter.key]: emptyFilters[filter.key as keyof Filters] })} aria-label={`Remover filtro ${filter.label}`}>{filter.label}<Icon name="close" /></button>)}</div>}
    </section>

    {canGlobalLookup && <details className="card section-card global-lookup-panel"><summary><span><Icon name="search" /><strong>Consulta global por patrimônio</strong><small>Localize códigos exatos em todos os setores</small></span><Icon name="chevron-down" /></summary>
      <div className="section-heading"><div><h2>Consulta global por patrimônio</h2><p>Cole até 50 códigos exatos, separados por linha, vírgula ou ponto e vírgula. A consulta não amplia sua listagem normal.</p></div></div>
      <form className="global-lookup-form" onSubmit={event => void globalLookup(event)}>
        <textarea aria-label="Códigos de patrimônio para consulta global" rows={4} value={globalPatrimony} onChange={e => { setGlobalPatrimony(e.target.value); setGlobalSearched(false); setGlobalError(''); }} placeholder={'C0595\nC0594\nC0593'} maxLength={5000} />
        <button className="secondary" disabled={globalSearching || !globalPatrimony.trim()}>{globalSearching ? 'Consultando...' : 'Consultar em todos os Setores'}</button>
      </form>
      {globalError && <div className="notice notice-error">{globalError}</div>}
      {globalSearched && !globalError && globalResults.length === 0 && <div className="empty-state">Nenhum dos patrimônios informados foi encontrado.</div>}
      {globalNotFound.length > 0 && <div className="notice notice-warning"><strong>Não encontrados:</strong> {globalNotFound.join(', ')}</div>}
      {ambiguousCodes.length > 0 && globalSearched && <div className="notice notice-info">Códigos em mais de um Setor: {ambiguousCodes.join(", ")}. Confira o Setor para identificar o ativo.</div>}
      {globalSearched && globalTotal > 50 && <div className="stock-pagination"><button type="button" className="secondary" disabled={globalSearching || globalPage === 1} onClick={() => void globalLookup(undefined, globalPage - 1)}>Anterior</button><span>{globalTotal} resultados · Página {globalPage}</span><button type="button" className="secondary" disabled={globalSearching || globalPage * 50 >= globalTotal} onClick={() => void globalLookup(undefined, globalPage + 1)}>Próxima</button></div>}
      {globalResults.length > 0 && <div className="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Ativo</th><th>Setor</th><th>Categoria</th><th>Status</th><th>Localização</th><th>Responsável</th></tr></thead><tbody>{globalResults.map(item => <tr key={item.id}><td><span className="patrimony-code">{item.patrimonyNumber}</span></td><td><div className="entity-title">{item.name}</div><div className="entity-subtitle">{[item.manufacturer, item.model].filter(Boolean).join(' - ') || item.description || '-'}</div></td><td><span className="pool-badge">{item.pool.name}</span>{item.folder && <div className="entity-subtitle">{item.folder.name}</div>}</td><td>{item.category.name}</td><td>{statusLabel(item.status)}</td><td>{item.location || '-'}</td><td>{item.responsible || '-'}</td></tr>)}</tbody></table></div>}
    </details>}

    {canCreate && !structureLoading && !hasStructure && <div className="notice notice-warning">Para cadastrar ativos, crie pelo menos um <Link href="/pools">Setor</Link> e uma <Link href="/structure">categoria</Link>.</div>}
    {canCreate && <section className="card section-card form-section" id="new-asset" hidden={!showCreate}>
      <div className="section-heading"><div><h2>Novo ativo</h2><p>Ativos são patrimônios principais. Componentes e peças ficam em Estoque e componentes.</p></div><button type="button" className="secondary" onClick={() => { setShowCreate(false); window.scrollTo({ top: 0 }); }}>Fechar cadastro</button></div>
      <form onSubmit={create} className="form-grid asset-form">
        <div className="form-field"><label htmlFor="new-asset-poolId">Setor *</label><select id="new-asset-poolId" value={form.poolId} onChange={e => setForm({ ...form, poolId: e.target.value, folderId: '' })} required disabled={!pools.length}><option value="">Selecione</option>{pools.map(pool => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></div>
        <div className="form-field"><label htmlFor="new-asset-folderId">Pasta</label><select id="new-asset-folderId" value={form.folderId} onChange={e => setForm({ ...form, folderId: e.target.value })}><option value="">Sem pasta</option>{availableFolders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div>
        <div className="form-field"><label htmlFor="new-asset-categoryId">Categoria *</label><select id="new-asset-categoryId" value={form.categoryId} onChange={e => { setForm({ ...form, categoryId: e.target.value }); setCustomValues({}); setAssetTypeId(''); }} required disabled={!categories.length}><option value="">Selecione</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
        <div className="form-field"><label htmlFor="new-asset-patrimonyNumber">Patrimônio *</label><input id="new-asset-patrimonyNumber" value={form.patrimonyNumber} onChange={e => setForm({ ...form, patrimonyNumber: e.target.value })} required /></div>
        <div className="form-field"><label htmlFor="new-asset-name">Nome *</label><input id="new-asset-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
        <div className="form-field"><label htmlFor="new-asset-manufacturer">Fabricante</label><input id="new-asset-manufacturer" value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} /></div>
        <div className="form-field"><label htmlFor="new-asset-model">Modelo</label><input id="new-asset-model" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} /></div>
        <div className="form-field"><label htmlFor="new-asset-purchasePrice">Preço</label><input id="new-asset-purchasePrice" type="number" min="0" step="0.01" value={form.purchasePrice} onChange={e => setForm({ ...form, purchasePrice: e.target.value })} /></div>
        <div className="form-field"><label htmlFor="new-asset-location">Localização</label><input id="new-asset-location" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></div>
        <div className="form-field"><label htmlFor="new-asset-responsible">Responsável</label><input id="new-asset-responsible" value={form.responsible} onChange={e => setForm({ ...form, responsible: e.target.value })} /></div>
        <div className="form-field full-field"><label htmlFor="new-asset-description">Descrição</label><textarea id="new-asset-description" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <AdvancedAssetFields category={categories.find(category => category.id === form.categoryId)} assetTypeId={assetTypeId} values={customValues} onTypeChange={setAssetTypeId} onValuesChange={setCustomValues} />
        <div className="actions full-field"><button className="primary" disabled={!hasStructure || saving}>{saving ? 'Cadastrando...' : 'Cadastrar ativo'}</button></div>
      </form>
    </section>}

    <section className="card section-card asset-results" aria-busy={loading}>
      <div className="results-toolbar"><div><h2>Inventário de ativos <span className="result-count">{loading ? '…' : total.toLocaleString('pt-BR')}</span></h2><p>Patrimônios organizados. Informações sempre à mão.</p></div><div className="results-actions">
        <button type="button" className="secondary export-button" disabled={loading || !items.length} onClick={exportPage}><Icon name="download" />Exportar página</button>
        <div className="segmented-control view-toggle" role="group" aria-label="Visualização dos ativos">{(['table', 'cards'] as const).map(mode => <button type="button" key={mode} aria-label={mode === 'table' ? 'Visualizar em tabela' : 'Visualizar em cartões'} aria-pressed={view === mode} onClick={() => { setView(mode); try { localStorage.setItem('inventory_asset_view', mode); } catch {} }}><Icon name={mode === 'table' ? 'list' : 'grid'} /></button>)}</div>
      </div></div>
      {loading ? <div className="asset-list-loading" role="status" aria-label="Carregando ativos">{Array.from({ length: 5 }, (_, index) => <div className="skeleton" key={index} />)}</div> : items.length === 0 ? <div className="empty-state illustrated-empty"><span className="empty-icon"><Icon name="search" /></span><strong>{error ? 'A consulta não foi concluída.' : activeFilters.length ? 'Nenhum ativo com esses filtros.' : 'Tudo pronto para o primeiro ativo.'}</strong><span>{error ? 'Tente atualizar a consulta para continuar.' : activeFilters.length ? 'Experimente outro termo ou remova alguns filtros.' : 'Comece a organizar o patrimônio dos seus setores.'}</span>{error ? <button type="button" className="secondary" onClick={() => { setError(''); void loadAssets().catch(e => setError(e.message)); }}>Tentar novamente</button> : activeFilters.length ? <button type="button" className="secondary" onClick={clearFilters}>Limpar filtros</button> : canCreate && <button type="button" className="primary" onClick={() => { setShowCreate(true); requestAnimationFrame(() => document.getElementById('new-asset')?.scrollIntoView({ block: 'start' })); }}><Icon name="plus" />Cadastrar ativo</button>}</div>
      : view === 'cards' ? <div className="asset-card-grid">{items.map(asset => <article className="asset-preview-card" key={asset.id}>
        <div className="asset-preview-top"><span className="asset-preview-icon"><Icon name="box" /></span><span className={statusClass(asset.status)}>{statusLabel(asset.status)}</span></div>
        <span className="patrimony-code">{asset.patrimonyNumber}</span><Link href={`/assets/${asset.id}`} className="asset-preview-name">{asset.name}</Link><p>{[asset.manufacturer, asset.model].filter(Boolean).join(' · ') || asset.category.name}</p>
        <dl><div><dt>Setor</dt><dd>{asset.pool.name}</dd></div><div><dt>Responsável</dt><dd>{asset.responsible || 'Não informado'}</dd></div><div><dt>Valor de aquisição</dt><dd>{formatPrice(asset.purchasePrice)}</dd></div></dl>
        <div className="asset-preview-footer"><Link className="text-link" href={`/assets/${asset.id}`}>Ver detalhes <Icon name="arrow" /></Link>{asset.archivedAt ? <span className="archived-label">Arquivado</span> : <div className="row-actions">{canEdit && <Link className="table-action" href={`/assets/${asset.id}/edit`}>Editar</Link>}{canDelete && <button type="button" className="icon-danger" aria-label={`Arquivar ativo ${asset.patrimonyNumber}`} onClick={() => { setArchiveError(''); setArchiveTarget(asset); }}>Arquivar</button>}</div>}</div>
        {canDelete && asset.archivedAt && <button type="button" className="secondary" disabled={Boolean(reactivating)} onClick={() => void reactivate(asset)}>{reactivating === asset.id ? 'Reativando…' : 'Reativar ativo'}</button>}
      </article>)}</div> : <div className="table-wrap asset-data-table" role="region" aria-label="Ativos cadastrados" tabIndex={0}><table><thead><tr><th>Patrimônio / ativo</th><th>Fabricante / modelo</th><th>Valor de aquisição</th><th>Localização</th><th>Responsável</th><th>Status</th><th>Setor / categoria</th>{(canEdit || canDelete) && <th className="align-right">Ações</th>}</tr></thead><tbody>
        {items.map(asset => <tr key={asset.id}><td><div className="asset-name-cell"><span className="table-asset-icon"><Icon name="box" /></span><div><Link className="entity-title" href={`/assets/${asset.id}`}>{asset.name}</Link><div className="entity-subtitle"><span className="patrimony-code">{asset.patrimonyNumber}</span>{asset.archivedAt && <span className="archived-label">Arquivado</span>}</div></div></div></td><td>{asset.manufacturer || '—'}<div className="entity-subtitle">{asset.model || '—'}</div></td><td className="numeric-cell">{formatPrice(asset.purchasePrice)}</td><td>{asset.location || '—'}</td><td>{asset.responsible || '—'}</td><td><span className={statusClass(asset.status)}>{statusLabel(asset.status)}</span></td><td><Link href={`/assets?poolId=${encodeURIComponent(asset.pool.id)}`} className="pool-badge">{asset.pool.name}</Link><div className="entity-subtitle">{asset.category.name}</div></td>{(canEdit || canDelete) && <td className="align-right"><div className="row-actions">{canEdit && !asset.archivedAt && <Link className="table-action" href={`/assets/${asset.id}/edit`}>Editar</Link>}{canDelete && (asset.archivedAt ? <button type="button" className="table-action" disabled={Boolean(reactivating)} onClick={() => void reactivate(asset)}>{reactivating === asset.id ? 'Reativando…' : 'Reativar'}</button> : <button type="button" className="icon-danger" onClick={() => { setArchiveError(''); setArchiveTarget(asset); }}>Arquivar</button>)}</div></td>}</tr>)}
      </tbody></table></div>}
      <div className="results-footer"><span role="status">{loading ? 'Atualizando resultados…' : total ? `Exibindo ${((page - 1) * pageSize + 1).toLocaleString('pt-BR')}–${Math.min(page * pageSize, total).toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} ativos` : 'Nenhum ativo para exibir'}</span><div className="pagination-controls"><button type="button" className="icon-button" aria-label="Página anterior" disabled={loading || page === 1} onClick={() => void changePage(page - 1)}><Icon name="arrow-left" /></button><span>Página {page} de {Math.max(1, Math.ceil(total / pageSize))}</span><button type="button" className="icon-button" aria-label="Próxima página" disabled={loading || page * pageSize >= total} onClick={() => void changePage(page + 1)}><Icon name="arrow" /></button></div></div>
    </section>

    <Dialog open={saveDialog} onClose={() => setSaveDialog(false)} title="Salvar visualização" description="Guarde os filtros aplicados para usar novamente neste navegador. Até 8 visualizações por conta.">
      <form className="stack-form" onSubmit={saveView}><label className="form-field"><span>Nome da visualização</span><input autoFocus value={viewName} onChange={event => setViewName(event.target.value)} placeholder="Ex.: Notebooks disponíveis" maxLength={48} required /></label><div className="dialog-actions"><button type="button" className="secondary" onClick={() => setSaveDialog(false)}>Cancelar</button><button className="primary" disabled={!viewName.trim()}><Icon name="bookmark" />Salvar filtros</button></div></form>
    </Dialog>
    <Dialog open={Boolean(archiveTarget)} onClose={() => setArchiveTarget(null)} busy={archiving} title="Arquivar este ativo?" description="O cadastro e o histórico serão preservados. Você pode reativar o patrimônio depois.">
      <div className="archive-preview"><span className="asset-preview-icon"><Icon name="box" /></span><div><strong>{archiveTarget?.name}</strong><small>{archiveTarget?.patrimonyNumber} · {archiveTarget?.pool.name}</small></div></div>
      {archiveError && <div className="notice notice-error" role="alert">{archiveError}</div>}
      <div className="dialog-actions"><button type="button" className="secondary" autoFocus disabled={archiving} onClick={() => setArchiveTarget(null)}>Manter no inventário</button><button type="button" className="danger-button" disabled={archiving} onClick={() => void removeAsset()}>{archiving ? 'Arquivando…' : 'Arquivar ativo'}</button></div>
    </Dialog>
  </>;
}
