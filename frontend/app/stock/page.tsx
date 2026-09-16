'use client';

import Link from 'next/link';
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { canManage, getSessionUser } from '../../lib/session';
import { categoryPath, descendantIds, requestId, type CategoryNode } from '../../lib/inventory';

type Pool = { id: string; name: string; active: boolean };
type Totals = { total: number; available: number; installed: number };
type Category = CategoryNode & Totals & { profileCount: number; assetCount: number; description?: string | null };
type Profile = Totals & { id: string; name: string; poolId: string; categoryId: string; description?: string; specifications?: string; manufacturer?: string; model?: string; pool: Pool };
type Catalog = { profiles: Profile[]; categories: Category[]; totals: Totals };
type Asset = { id: string; name: string; patrimonyNumber: string; poolId: string };
type Part = { profileId: string; quantity: number; origin: 'FROM_STOCK' | 'REGISTER_INSTALLED' };
type Movement = { id: string; type: string; quantity: number; availableAfter: number; createdAt: string; notes?: string; profile: { name: string; pool: { name: string } } };
const blankProfile = { name: '', categoryId: '', description: '', manufacturer: '', model: '', specifications: '', initialAvailable: 0 };
const initial: Catalog = { profiles: [], categories: [], totals: { total: 0, available: 0, installed: 0 } };
const number = (value: number) => value.toLocaleString('pt-BR');
const labels: Record<string, string> = { RECEIPT: 'Entrada', WITHDRAWAL: 'Baixa do disponível', INSTALL_FROM_STOCK: 'Instalação com retirada', REGISTER_INSTALLED: 'Registro já instalado', RETURN_TO_STOCK: 'Devolução', RETIRE_INSTALLED: 'Baixa de instalado' };
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label>; }

function Components({ value, onChange, profiles, count }: { value: Part[]; onChange: (p: Part[]) => void; profiles: Profile[]; count: number }) {
  return <div className="component-editor">
    <div className="section-heading"><div><h3>Componentes por equipamento</h3><p>O mesmo perfil pode ser utilizado em diversos equipamentos.</p></div><button type="button" className="secondary" disabled={!profiles.length || value.length >= 30} onClick={() => onChange([...value, { profileId: '', quantity: 1, origin: 'FROM_STOCK' }])}>+ Componente</button></div>
    {value.map((part, index) => <div className="component-line" key={index}>
      <Field label="Perfil"><select required value={part.profileId} onChange={e => onChange(value.map((p,i) => i === index ? { ...p, profileId: e.target.value } : p))}><option value="">Selecione</option>{profiles.map(p => <option value={p.id} key={p.id}>{p.name} ({p.available} disponíveis)</option>)}</select></Field>
      <Field label="Unidades por ativo"><input required type="number" min={1} max={10000} value={part.quantity} onChange={e => onChange(value.map((p,i) => i === index ? { ...p, quantity: Number(e.target.value) } : p))} /></Field>
      <Field label="Origem das unidades"><select value={part.origin} onChange={e => onChange(value.map((p,i) => i === index ? { ...p, origin: e.target.value as Part['origin'] } : p))}><option value="FROM_STOCK">Retirar do estoque disponível</option><option value="REGISTER_INSTALLED">Já instalado / sem retirar do estoque</option></select></Field>
      <button type="button" className="icon-danger" onClick={() => onChange(value.filter((_,i) => i !== index))}>Remover</button>
      <small className="component-impact">{number((part.quantity || 0) * count)} unidade(s) no lote. {part.origin === 'FROM_STOCK' ? 'Disponível diminui; total permanece igual.' : 'Disponível permanece igual; total aumenta.'}</small>
    </div>)}
    {value.some(p => p.origin === 'REGISTER_INSTALLED') && <div className="notice notice-info">Use <strong>já instalado</strong> somente para unidades reais que ainda não estejam contabilizadas no sistema. Essa opção não duplica uma unidade disponível.</div>}
  </div>;
}

export default function StockPage() {
  const [pools, setPools] = useState<Pool[]>([]), [poolId, setPoolId] = useState('');
  const [catalog, setCatalog] = useState<Catalog>(initial), [categoryId, setCategoryId] = useState('');
  const [tab, setTab] = useState<'catalog' | 'assign' | 'batch' | 'movements'>('catalog');
  const [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false);
  const [canEdit, setCanEdit] = useState(false), [canAdmin, setCanAdmin] = useState(false), [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(blankProfile), [editing, setEditing] = useState(''), [showProfile, setShowProfile] = useState(false);
  const [parts, setParts] = useState<Part[]>([]), [selected, setSelected] = useState<Record<string, Asset>>({});
  const [assets, setAssets] = useState<Asset[]>([]), [assetTotal, setAssetTotal] = useState(0), [assetPage, setAssetPage] = useState(1), [search, setSearch] = useState('');
  const [batchText, setBatchText] = useState(''), [batch, setBatch] = useState({ categoryId: '', folderPrefix: '', manufacturer: '', model: '', location: '', responsible: '' });
  const [adjustment, setAdjustment] = useState<{ profile: Profile; type: 'RECEIPT' | 'WITHDRAWAL' } | null>(null);
  const [categoryEditor, setCategoryEditor] = useState<{ id: string; name: string; parentId: string; description: string } | null>(null);
  const [quantity, setQuantity] = useState(1), [notes, setNotes] = useState('');
  const [movements, setMovements] = useState<Movement[]>([]), [movementPage, setMovementPage] = useState(1), [movementTotal, setMovementTotal] = useState(0);
  const pending = useRef<{ signature: string; id: string } | null>(null);

  const refresh = useCallback(async () => {
    const data = await api<Catalog>(`/stock/catalog${poolId ? `?poolId=${encodeURIComponent(poolId)}` : ''}`);
    setCatalog(data);
  }, [poolId]);
  useEffect(() => {
    const role = getSessionUser()?.role;
    setCanEdit(canManage(role));
    setCanAdmin(role === 'ADMIN');
    api<Pool[]>('/pools').then(setPools).catch(e => setError(e.message));
    const q = new URLSearchParams(window.location.search);
    if (q.get('poolId')) setPoolId(q.get('poolId')!);
    if (q.get('categoryId')) setCategoryId(q.get('categoryId')!);
    if (q.get('assetId')) api<Asset>(`/assets/${encodeURIComponent(q.get('assetId')!)}`).then(a => { setPoolId(a.poolId); setSelected({ [a.id]: a }); setTab('assign'); }).catch(e => setError(e.message));
  }, []);
  useEffect(() => { let live = true; setLoading(true); refresh().catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, [refresh]);
  useEffect(() => {
    if (tab !== 'assign' || !poolId) return;
    let live = true;
    api<{ items: Asset[]; total: number }>(`/assets?poolId=${encodeURIComponent(poolId)}&page=${assetPage}&pageSize=25&search=${encodeURIComponent(search)}`).then(r => { if (live) { setAssets(r.items); setAssetTotal(r.total); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [tab, poolId, search, assetPage]);
  useEffect(() => {
    if (tab !== 'movements') return;
    let live = true;
    api<{ items: Movement[]; total: number }>(`/stock/movements?page=${movementPage}${poolId ? `&poolId=${encodeURIComponent(poolId)}` : ''}`).then(r => { if (live) { setMovements(r.items); setMovementTotal(r.total); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [tab, poolId, movementPage, success]);

  const scope = categoryId ? descendantIds(catalog.categories, categoryId) : null;
  const visibleProfiles = catalog.profiles.filter(p => !scope || scope.has(p.categoryId));
  const children = catalog.categories.filter(c => (c.parentId || '') === categoryId);
  const currentCategory = catalog.categories.find(c => c.id === categoryId);
  const batchRows = useMemo(() => batchText.split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter((s,i) => !(i === 0 && /^patrimonio\s*;/i.test(s))).map(line => { const [patrimonyNumber = '', name = '', folderPath = '', ...extra] = line.split(';').map(s => s.trim()); return { patrimonyNumber, name, folderPath, invalid: !patrimonyNumber || !name || extra.length > 0 }; }), [batchText]);

  async function post(path: string, data: object) {
    const signature = JSON.stringify([path, data]);
    if (pending.current?.signature !== signature) pending.current = { signature, id: requestId() };
    return api<{ message?: string }>(path, { method: 'POST', body: JSON.stringify({ ...data, requestId: pending.current.id }) });
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setSuccess('');
    try { await work(); pending.current = null; await refresh().catch(() => setError('Operação concluída. Atualize a página para recarregar os saldos.')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir a operação.'); }
    finally { setBusy(false); }
  }
  function changePool(id: string) { setPoolId(id); setSelected({}); setParts([]); setAssetPage(1); setMovementPage(1); setEditing(''); setShowProfile(false); setError(''); setSuccess(''); }
  function editProfile(p: Profile) { setEditing(p.id); setProfile({ name: p.name, categoryId: p.categoryId, description: p.description || '', manufacturer: p.manufacturer || '', model: p.model || '', specifications: p.specifications || '', initialAvailable: 0 }); setPoolId(p.poolId); setShowProfile(true); }
  function editCategory(id: string) {
    const category = catalog.categories.find(c => c.id === id);
    if (!category) return;
    setCategoryEditor({ id: category.id, name: category.name, parentId: category.parentId || '', description: category.description || '' });
  }
  async function saveCategory(e: FormEvent) {
    e.preventDefault();
    if (!categoryEditor) return;
    await run(async () => {
      await api(`/categories/${categoryEditor.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: categoryEditor.name,
          description: categoryEditor.description || null,
          parentId: categoryEditor.parentId || null,
        }),
      });
      setCategoryEditor(null);
      setSuccess('Categoria atualizada com sucesso.');
    });
  }
  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      if (editing) { const { initialAvailable, ...data } = profile; await api(`/stock/profiles/${editing}`, { method: 'PUT', body: JSON.stringify(data) }); }
      else await post('/stock/profiles', { ...profile, poolId });
      setProfile(blankProfile); setEditing(''); setShowProfile(false); setSuccess('Perfil salvo. O perfil descreve o item; não é contado como uma unidade.');
    });
  }
  async function assign(e: FormEvent) {
    e.preventDefault();
    const count = Object.keys(selected).length;
    if (!window.confirm(`Associar os componentes a ${count} equipamento(s)? Confira a origem de cada unidade antes de continuar.`)) return;
    await run(async () => { await post('/stock/assign', { poolId, assetIds: Object.keys(selected), components: parts }); setSelected({}); setParts([]); setSuccess('Componentes associados; saldos atualizados.'); });
  }
  async function createBatch(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm(`Cadastrar ${batchRows.length} ativo(s), criar/reutilizar as pastas e associar os componentes? Uma falha cancela o lote inteiro.`)) return;
    await run(async () => { const r = await post('/assets/batch', { ...batch, poolId, assets: batchRows.map(({ invalid, ...row }) => row), components: parts }); setBatchText(''); setParts([]); setSuccess(r.message || 'Lote cadastrado.'); });
  }

  return <>
    <div className="page-head"><div><div className="eyebrow">Inventário por setor</div><h1>Estoque e componentes</h1><div className="page-description">Especificações reutilizáveis, unidades disponíveis e componentes instalados.</div></div>
      <Field label="Pool / setor"><select value={poolId} onChange={e => changePool(e.target.value)}><option value="">Todos os meus Pools</option>{pools.map(p => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (inativo)'}</option>)}</select></Field></div>
    {(error || success) && <div role="status" className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || success}</div>}
    {!pools.length && !loading && <div className="notice notice-info">Nenhum Pool disponível. Solicite ao administrador a liberação dos seus Pools em Usuários.</div>}
    <div className="stock-kpis">{[['Total de componentes', catalog.totals.total], ['Disponíveis em estoque', catalog.totals.available], ['Instalados em ativos', catalog.totals.installed]].map(([label, value]) => <div className="card stock-kpi" key={label}><span>{label}</span><strong>{number(Number(value))}</strong></div>)}</div>
    <p className="field-help">Total = disponíveis + instalados. Computadores e outros ativos principais aparecem separadamente; um perfil técnico não entra na contagem.</p>
    <div className="stock-tabs" role="tablist">{(['catalog','assign','batch','movements'] as const).filter(t => canEdit || !['assign','batch'].includes(t)).map(t => <button role="tab" aria-selected={tab === t} type="button" className={tab === t ? 'primary' : 'secondary'} key={t} onClick={() => { setTab(t); setError(''); }}>{({ catalog: 'Catálogo', assign: 'Associar a ativos', batch: 'Cadastro em lote', movements: 'Movimentações' })[t]}</button>)}</div>

    {tab === 'catalog' && <>
      <section className="card section-card"><div className="section-heading"><div><h2>Categorias e especificações</h2><p>Clique para navegar pelos níveis e conferir os totais acumulados.</p></div><Link className="table-action" href="/structure">Gerenciar estrutura</Link></div>
        <div className="stock-breadcrumb"><button type="button" onClick={() => setCategoryId('')}>Todas as categorias</button>{currentCategory && <><span>/ {categoryPath(catalog.categories, categoryId)}</span><button type="button" onClick={() => setCategoryId(currentCategory.parentId || '')}>Voltar um nível</button></>}</div>
        <div className="stock-category-grid">{children.map(c => <button type="button" className="stock-category" key={c.id} onClick={() => setCategoryId(c.id)}><strong>{c.name}</strong><span>Componentes: <b>{number(c.total)}</b></span><span>Disponíveis: <b>{number(c.available)}</b> | Instalados: <b>{number(c.installed)}</b></span><small>Ativos principais: {number(c.assetCount)} | Perfis: {c.profileCount}</small></button>)}</div>
        {currentCategory && <div className="notice notice-info">{currentCategory.name}: {number(currentCategory.total)} componentes no total, {number(currentCategory.available)} disponíveis e {number(currentCategory.installed)} instalados, incluindo subcategorias.</div>}
      </section>
      <section className="card section-card"><div className="section-heading"><div><h2>Perfis de itens</h2><p>Crie, por exemplo, um perfil de memória com capacidade e especificação técnica.</p></div>{canEdit && <button type="button" disabled={!poolId} onClick={() => { setEditing(''); setProfile({ ...blankProfile, categoryId }); setShowProfile(!showProfile); }}>+ Novo perfil</button>}</div>
        {canEdit && !poolId && <p className="field-help">Selecione um Pool no topo para criar perfis ou movimentar unidades.</p>}
        {canEdit && showProfile && <form onSubmit={saveProfile} className="stock-profile-form">
          <div className="stock-form-grid"><Field label="Nome do perfil *"><input required maxLength={200} value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} /></Field>
          <div className="form-field"><label>Categoria / subcategoria *</label><div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><select style={{ flex: '1 1 320px' }} required value={profile.categoryId} onChange={e => setProfile({ ...profile, categoryId: e.target.value })}><option value="">Selecione</option>{catalog.categories.map(c => <option key={c.id} value={c.id}>{categoryPath(catalog.categories, c.id)}</option>)}</select>{canAdmin && profile.categoryId && <button type="button" className="secondary" onClick={() => editCategory(profile.categoryId)}>Editar categoria</button>}</div></div>
          <Field label="Fabricante"><input value={profile.manufacturer} onChange={e => setProfile({ ...profile, manufacturer: e.target.value })} /></Field><Field label="Modelo"><input value={profile.model} onChange={e => setProfile({ ...profile, model: e.target.value })} /></Field>
          <Field label="Especificações técnicas"><textarea rows={2} value={profile.specifications} onChange={e => setProfile({ ...profile, specifications: e.target.value })} /></Field>
          {!editing && <Field label="Saldo inicial disponível"><input type="number" required min={0} max={1000000} value={profile.initialAvailable} onChange={e => setProfile({ ...profile, initialAvailable: Number(e.target.value) })} /></Field>}</div>
          {editing && <p className="field-help">Alterar o perfil atualiza a descrição dos componentes que o utilizam. O saldo não é alterado aqui.</p>}
          <div className="form-actions-row"><button type="button" className="secondary" onClick={() => setShowProfile(false)}>Cancelar</button><button disabled={busy || !poolId}>{busy ? 'Salvando...' : 'Salvar perfil'}</button></div>
        </form>}
        <div className="table-wrap"><table><thead><tr><th>Perfil / especificações</th><th>Pool</th><th>Categoria</th><th>Disponível</th><th>Instalado</th><th>Total</th>{canEdit && <th>Ações</th>}</tr></thead><tbody>
          {visibleProfiles.map(p => <tr key={p.id}><td><strong>{p.name}</strong><div className="entity-subtitle stock-specs">{p.specifications || [p.manufacturer, p.model].filter(Boolean).join(' - ')}</div></td><td>{p.pool.name}</td><td>{categoryPath(catalog.categories, p.categoryId)}</td><td>{number(p.available)}</td><td>{number(p.installed)}</td><td><b>{number(p.total)}</b></td>{canEdit && <td><div className="row-actions"><button type="button" className="table-action" onClick={() => editProfile(p)}>Editar</button><button type="button" className="table-action" onClick={() => { setAdjustment({ profile: p, type: 'RECEIPT' }); setQuantity(1); setNotes(''); }}>Entrada / baixa</button><button type="button" className="icon-danger" disabled={busy || p.total > 0} onClick={() => { if (window.confirm('Arquivar este perfil sem saldo? O histórico permanece.')) run(async () => { await api(`/stock/profiles/${p.id}`, { method: 'DELETE' }); setSuccess('Perfil arquivado.'); }); }}>Arquivar</button></div></td>}</tr>)}
          {!visibleProfiles.length && <tr><td colSpan={canEdit ? 7 : 6}><div className="empty-state">{loading ? 'Carregando...' : 'Nenhum perfil neste recorte. Cadastre a estrutura e crie o primeiro perfil.'}</div></td></tr>}
        </tbody></table></div>
      </section>
    </>}

    {tab === 'assign' && canEdit && <section className="card section-card"><div className="section-heading"><div><h2>Associar componentes a ativos existentes</h2><p>Selecione os equipamentos e a quantidade por equipamento. O lote inteiro é validado antes da gravação.</p></div></div>
      {!poolId ? <div className="notice notice-info">Selecione um Pool no topo.</div> : <form onSubmit={assign}>
        <Field label="Buscar equipamento"><input value={search} onChange={e => { setSearch(e.target.value); setAssetPage(1); }} placeholder="Patrimônio ou nome" /></Field>
        <div className="asset-picker">{assets.map(a => <label key={a.id}><input type="checkbox" checked={!!selected[a.id]} onChange={e => setSelected(prev => { const next = { ...prev }; if (e.target.checked) next[a.id] = a; else delete next[a.id]; return next; })} /><span><b>{a.patrimonyNumber}</b> {a.name}</span><Link className="table-action" href={`/assets/${a.id}`}>Detalhes</Link></label>)}</div>
        <div className="stock-pagination"><button type="button" className="secondary" disabled={assetPage === 1} onClick={() => setAssetPage(assetPage - 1)}>Anterior</button><span>Página {assetPage} | {assetTotal} ativos | {Object.keys(selected).length} selecionados</span><button type="button" className="secondary" disabled={assetPage * 25 >= assetTotal} onClick={() => setAssetPage(assetPage + 1)}>Próxima</button></div>
        <Components value={parts} onChange={setParts} profiles={catalog.profiles} count={Object.keys(selected).length} />
        <div className="form-actions-row"><button type="button" className="secondary" onClick={() => setSelected({})}>Limpar seleção</button><button disabled={busy || !Object.keys(selected).length || Object.keys(selected).length > 200 || !parts.length}>{busy ? 'Associando...' : `Associar a ${Object.keys(selected).length} ativo(s)`}</button></div>
      </form>}
    </section>}

    {tab === 'batch' && canEdit && <section className="card section-card"><div className="section-heading"><div><h2>Cadastrar equipamentos em lote</h2><p>Até 200 equipamentos com a mesma configuração. Pastas e subpastas são criadas ou reutilizadas dentro do Pool.</p></div></div>
      {!poolId ? <div className="notice notice-info">Selecione o Pool de destino no topo.</div> : <form onSubmit={createBatch}>
        <div className="stock-form-grid"><Field label="Categoria dos equipamentos *"><select required value={batch.categoryId} onChange={e => setBatch({ ...batch, categoryId: e.target.value })}><option value="">Selecione</option>{catalog.categories.map(c => <option key={c.id} value={c.id}>{categoryPath(catalog.categories,c.id)}</option>)}</select></Field><Field label="Pasta base (opcional)"><input value={batch.folderPrefix} onChange={e => setBatch({ ...batch, folderPrefix: e.target.value })} placeholder="Computadores / Setor cadastro" /></Field>
          <Field label="Fabricante"><input value={batch.manufacturer} onChange={e => setBatch({ ...batch, manufacturer: e.target.value })} /></Field><Field label="Modelo"><input value={batch.model} onChange={e => setBatch({ ...batch, model: e.target.value })} /></Field><Field label="Localização"><input value={batch.location} onChange={e => setBatch({ ...batch, location: e.target.value })} /></Field><Field label="Responsável"><input value={batch.responsible} onChange={e => setBatch({ ...batch, responsible: e.target.value })} /></Field></div>
        <Field label="Uma linha por equipamento: patrimonio;nome;pasta"><textarea className="batch-input" rows={7} value={batchText} onChange={e => setBatchText(e.target.value)} placeholder={'PC-001;Computador 01;Sala A\nPC-002;Computador 02;Sala A\nPC-003;Computador 03;Sala B / Mesa 1'} required /></Field>
        <p className="field-help">A terceira coluna é opcional. Use / para subpastas; não use ; dentro de um nome. Patrimônios existentes não são atualizados por este lote.</p>
        {batchRows.length > 0 && <div className="table-wrap batch-preview"><table><thead><tr><th>Patrimônio</th><th>Nome</th><th>Pasta resultante</th><th>Leitura</th></tr></thead><tbody>{batchRows.slice(0,200).map((r,i) => <tr key={i}><td>{r.patrimonyNumber}</td><td>{r.name}</td><td>{[batch.folderPrefix,r.folderPath].filter(Boolean).join(' / ') || 'Raiz'}</td><td>{r.invalid ? 'Corrigir linha' : 'OK'}</td></tr>)}</tbody></table></div>}
        <Components value={parts} onChange={setParts} profiles={catalog.profiles} count={batchRows.length} />
        <div className="notice notice-info">Nenhum item do lote será gravado se houver patrimônio duplicado, pasta inválida, falta de permissão ou estoque insuficiente. Associar componentes é opcional.</div>
        <div className="form-actions-row"><button disabled={busy || !batchRows.length || batchRows.length > 200 || batchRows.some(r => r.invalid)}>{busy ? 'Cadastrando...' : `Cadastrar ${batchRows.length} ativo(s)`}</button></div>
      </form>}
    </section>}

    {tab === 'movements' && <section className="card section-card"><div className="section-heading"><div><h2>Movimentações de componentes</h2><p>Histórico dos Pools aos quais você tem acesso.</p></div></div><div className="table-wrap"><table><thead><tr><th>Data</th><th>Pool</th><th>Perfil</th><th>Operação</th><th>Quantidade</th><th>Disponível após</th><th>Observação</th></tr></thead><tbody>{movements.map(m => <tr key={m.id}><td>{new Date(m.createdAt).toLocaleString('pt-BR')}</td><td>{m.profile.pool.name}</td><td>{m.profile.name}</td><td>{labels[m.type] || m.type}</td><td>{m.quantity}</td><td>{m.availableAfter}</td><td>{m.notes || '-'}</td></tr>)}{!movements.length && <tr><td colSpan={7}><div className="empty-state">Nenhuma movimentação.</div></td></tr>}</tbody></table></div><div className="stock-pagination"><button className="secondary" disabled={movementPage === 1} onClick={() => setMovementPage(movementPage - 1)}>Anterior</button><span>Página {movementPage} | {movementTotal} registros</span><button className="secondary" disabled={movementPage * 50 >= movementTotal} onClick={() => setMovementPage(movementPage + 1)}>Próxima</button></div></section>}

    {categoryEditor && <div className="modal-backdrop"><div className="modal-card"><div className="modal-heading"><div><h2>Editar categoria</h2><p>Altere o nome, a descrição ou a posição da categoria na hierarquia.</p></div><button type="button" className="modal-close" onClick={() => setCategoryEditor(null)}>×</button></div>
      <form className="stack-form" onSubmit={saveCategory}>
        <Field label="Nome *"><input required maxLength={200} value={categoryEditor.name} onChange={e => setCategoryEditor({ ...categoryEditor, name: e.target.value })} /></Field>
        <Field label="Categoria pai"><select value={categoryEditor.parentId} onChange={e => setCategoryEditor({ ...categoryEditor, parentId: e.target.value })}><option value="">Raiz das categorias</option>{catalog.categories.filter(c => !descendantIds(catalog.categories, categoryEditor.id).has(c.id)).map(c => <option key={c.id} value={c.id}>{categoryPath(catalog.categories, c.id)}</option>)}</select></Field>
        <Field label="Descrição"><textarea rows={3} maxLength={4000} value={categoryEditor.description} onChange={e => setCategoryEditor({ ...categoryEditor, description: e.target.value })} /></Field>
        <p className="field-help">Renomear ou mover a categoria altera o caminho exibido nos perfis e ativos vinculados, sem alterar os saldos.</p>
        <div className="form-actions-row"><button type="button" className="secondary" onClick={() => setCategoryEditor(null)}>Cancelar</button><button disabled={busy}>{busy ? 'Salvando...' : 'Salvar categoria'}</button></div>
      </form>
    </div></div>}

    {adjustment && <div className="modal-backdrop"><div className="modal-card"><div className="modal-heading"><div><h2>Saldo disponível</h2><p>{adjustment.profile.name} | {adjustment.profile.pool.name}</p></div><button type="button" className="modal-close" onClick={() => setAdjustment(null)}>×</button></div>
      <form className="stack-form" onSubmit={e => { e.preventDefault(); run(async () => { await post(`/stock/profiles/${adjustment.profile.id}/stock`, { type: adjustment.type, quantity, notes }); setAdjustment(null); setSuccess('Movimentação registrada.'); }); }}>
        <Field label="Operação"><select value={adjustment.type} onChange={e => setAdjustment({ ...adjustment, type: e.target.value as 'RECEIPT' | 'WITHDRAWAL' })}><option value="RECEIPT">Entrada de novas unidades</option><option value="WITHDRAWAL">Baixa do inventário (não instalar)</option></select></Field>
        <Field label="Quantidade"><input type="number" min={1} max={1000000} required value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></Field><Field label="Motivo *"><textarea minLength={3} maxLength={2000} required value={notes} onChange={e => setNotes(e.target.value)} /></Field><p className="field-help">Para instalar em um computador, use Associar a ativos; não use baixa do inventário.</p><button disabled={busy}>{busy ? 'Salvando...' : 'Registrar movimentação'}</button>
      </form></div></div>}
  </>;
}
