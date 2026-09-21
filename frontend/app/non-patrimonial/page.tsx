'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { categoryPath } from '../../lib/inventory';
import { getSessionUser, hasPermission } from '../../lib/session';

type Pool = { id: string; name: string; active?: boolean };
type Category = { id: string; name: string; parentId?: string | null };
type Item = {
  id: string;
  internalCode: string;
  name: string;
  description?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  quantity: number;
  location?: string | null;
  responsible?: string | null;
  poolId: string;
  categoryId: string;
  active: boolean;
  pool: Pool;
  category: Category;
  _count?: { movements: number };
};

type Movement = {
  id: string;
  type: 'INITIAL' | 'ENTRY' | 'EXIT' | 'ADJUSTMENT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'IMPORT_SET';
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  notes?: string | null;
  createdAt: string;
};

type ItemForm = {
  name: string;
  description: string;
  manufacturer: string;
  model: string;
  quantity: number;
  location: string;
  responsible: string;
  poolId: string;
  categoryId: string;
};

type StockAction = { item: Item; type: 'ENTRY' | 'EXIT' | 'ADJUSTMENT' } | null;
type TransferAction = { item: Item } | null;

const emptyForm: ItemForm = {
  name: '', description: '', manufacturer: '', model: '', quantity: 1,
  location: '', responsible: '', poolId: '', categoryId: '',
};

export default function NonPatrimonialPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<ItemForm>(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [search, setSearch] = useState('');
  const [poolFilter, setPoolFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'true' | 'false' | 'all'>('true');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canMove, setCanMove] = useState(false);
  const [canArchive, setCanArchive] = useState(false);
  const [stockAction, setStockAction] = useState<StockAction>(null);
  const [stockQuantity, setStockQuantity] = useState(1);
  const [stockNotes, setStockNotes] = useState('');
  const [transferAction, setTransferAction] = useState<TransferAction>(null);
  const [transferPoolId, setTransferPoolId] = useState('');
  const [transferQuantity, setTransferQuantity] = useState(1);
  const [transferNotes, setTransferNotes] = useState('');
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const categoryOptions = useMemo(
    () => [...categories].sort((a, b) => categoryPath(categories, a.id).localeCompare(categoryPath(categories, b.id), 'pt-BR')),
    [categories],
  );

  async function loadItems() {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (poolFilter) params.set('poolId', poolFilter);
    if (categoryFilter) params.set('categoryId', categoryFilter);
    params.set('active', activeFilter);
    const query = params.toString();
    setItems(await api<Item[]>(`/non-patrimonial${query ? `?${query}` : ''}`));
  }

  async function loadBase() {
    const [poolData, categoryData] = await Promise.all([
      api<Pool[]>('/pools'),
      api<Category[]>('/categories'),
    ]);
    setPools(poolData);
    setCategories(categoryData);
    setForm(current => ({ ...current, poolId: current.poolId || poolData.find(p => p.active !== false)?.id || '' }));
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPoolFilter(params.get('poolId') || '');
    setCategoryFilter(params.get('categoryId') || '');
    const session = getSessionUser();
    setCanCreate(hasPermission('NON_PATRIMONIAL_CREATE', session));
    setCanEdit(hasPermission('NON_PATRIMONIAL_EDIT', session));
    setCanMove(hasPermission('NON_PATRIMONIAL_MOVE', session));
    setCanArchive(hasPermission('NON_PATRIMONIAL_ARCHIVE', session));
    Promise.all([loadBase(), loadItems()]).catch(e => setError(e instanceof Error ? e.message : 'Não foi possível carregar os itens.'));
  }, []);

  useEffect(() => {
    loadItems().catch(e => setError(e instanceof Error ? e.message : 'Não foi possível aplicar os filtros.'));
  }, [poolFilter, categoryFilter, activeFilter]);

  function resetForm() {
    setEditingId('');
    setForm({ ...emptyForm, poolId: pools.find(p => p.active !== false)?.id || '' });
  }

  function startEdit(item: Item) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      description: item.description || '',
      manufacturer: item.manufacturer || '',
      model: item.model || '',
      quantity: item.quantity,
      location: item.location || '',
      responsible: item.responsible || '',
      poolId: item.poolId,
      categoryId: item.categoryId,
    });
    setError(''); setSuccess('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(''); setSuccess(''); setSaving(true);
    try {
      if (editingId) {
        await api(`/non-patrimonial/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: form.name,
            description: form.description || null,
            manufacturer: form.manufacturer || null,
            model: form.model || null,
            location: form.location || null,
            responsible: form.responsible || null,
            categoryId: form.categoryId,
          }),
        });
        setSuccess('Item atualizado com sucesso. O saldo é alterado pela ação Movimentar.');
      } else {
        await api('/non-patrimonial', {
          method: 'POST',
          body: JSON.stringify({ ...form, description: form.description || null, manufacturer: form.manufacturer || null, model: form.model || null, location: form.location || null, responsible: form.responsible || null }),
        });
        setSuccess('Item não patrimoniado cadastrado. O código interno foi gerado automaticamente.');
      }
      resetForm();
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar o item.');
    } finally { setSaving(false); }
  }

  async function submitStock(event: FormEvent) {
    event.preventDefault(); if (!stockAction) return;
    setError(''); setSuccess(''); setSaving(true);
    try {
      await api(`/non-patrimonial/${stockAction.item.id}/stock`, {
        method: 'POST',
        body: JSON.stringify({ type: stockAction.type, quantity: stockQuantity, notes: stockNotes }),
      });
      setStockAction(null); setStockNotes(''); setStockQuantity(1);
      setSuccess('Movimentação registrada com sucesso.');
      await loadItems();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao movimentar o item.'); }
    finally { setSaving(false); }
  }

  async function submitTransfer(event: FormEvent) {
    event.preventDefault(); if (!transferAction) return;
    setError(''); setSuccess(''); setSaving(true);
    try {
      await api(`/non-patrimonial/${transferAction.item.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ toPoolId: transferPoolId, quantity: transferQuantity, notes: transferNotes }),
      });
      setTransferAction(null); setTransferPoolId(''); setTransferNotes(''); setTransferQuantity(1);
      setSuccess('Transferência registrada com sucesso.');
      await loadItems();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao transferir o item.'); }
    finally { setSaving(false); }
  }

  async function openHistory(item: Item) {
    setHistoryItem(item); setMovements([]); setLoadingHistory(true); setError('');
    try { setMovements(await api<Movement[]>(`/non-patrimonial/${item.id}/movements`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar o histórico.'); }
    finally { setLoadingHistory(false); }
  }

  async function archive(item: Item) {
    if (!window.confirm(`Arquivar "${item.name}"? O histórico será preservado.`)) return;
    setError(''); setSuccess('');
    try {
      const result = await api<{ message: string }>(`/non-patrimonial/${item.id}`, { method: 'DELETE' });
      setSuccess(result.message); await loadItems();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao arquivar o item.'); }
  }

  async function reactivate(item: Item) {
    setError(''); setSuccess('');
    try { await api(`/non-patrimonial/${item.id}/reactivate`, { method: 'POST' }); setSuccess('Item reativado.'); await loadItems(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao reativar o item.'); }
  }

  const showForm = canCreate || (canEdit && !!editingId);

  return <>
    <div className="page-head">
      <div className="page-head-content">
        <div className="eyebrow">Controle por quantidade</div>
        <h1>Itens não patrimoniados</h1>
        <div className="page-description">Controle xícaras, garrafas, utensílios, materiais de apoio e outros itens sem exigir código patrimonial.</div>
      </div>
      <div className="count-pill">{items.length} registro(s)</div>
    </div>

    {(error || success) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || success}</div>}
    {!canCreate && !canEdit && !canMove && !canArchive && <div className="notice notice-info">Sua conta possui acesso somente para consulta nesta área.</div>}

    {showForm && <section className="card section-card form-section">
      <div className="section-heading"><div><h2>{editingId ? 'Editar item' : 'Novo item não patrimoniado'}</h2><p>O código interno NP-XXXXXX é gerado automaticamente e não é um número de patrimônio.</p></div></div>
      <form onSubmit={submit} className="form-grid asset-form">
        {!editingId && <div className="form-field"><label>Setor *</label><select required value={form.poolId} onChange={e => setForm({ ...form, poolId: e.target.value })}><option value="">Selecione</option>{pools.filter(p => p.active !== false).map(pool => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></div>}
        <div className="form-field"><label>Categoria *</label><select required value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })}><option value="">Selecione</option>{categoryOptions.map(category => <option key={category.id} value={category.id}>{categoryPath(categories, category.id)}</option>)}</select></div>
        <div className="form-field"><label>Nome *</label><input required maxLength={200} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Xícara de café" /></div>
        {!editingId && <div className="form-field"><label>Quantidade inicial *</label><input required type="number" min={0} max={1000000} value={form.quantity} onChange={e => setForm({ ...form, quantity: Number(e.target.value) })} /></div>}
        <div className="form-field"><label>Fabricante</label><input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} /></div>
        <div className="form-field"><label>Modelo</label><input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} /></div>
        <div className="form-field"><label>Localização</label><input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Ex.: Copa" /></div>
        <div className="form-field"><label>Responsável</label><input value={form.responsible} onChange={e => setForm({ ...form, responsible: e.target.value })} /></div>
        <div className="form-field full-field"><label>Descrição</label><textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="form-actions-row full-field">{editingId && <button type="button" className="secondary" onClick={resetForm}>Cancelar</button>}<button className="primary" disabled={saving}>{saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Cadastrar item'}</button></div>
      </form>
    </section>}

    <section className="card section-card">
      <div className="section-heading"><div><h2>Itens cadastrados</h2><p>Use os filtros para consultar os itens por Setor, categoria ou situação.</p></div></div>
      <div className="toolbar non-patrimonial-toolbar">
        <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadItems()} placeholder="Código interno, nome, fabricante, localização..." />
        <select value={poolFilter} onChange={e => setPoolFilter(e.target.value)}><option value="">Todos os meus Setores</option>{pools.map(pool => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="">Todas as categorias</option>{categoryOptions.map(category => <option key={category.id} value={category.id}>{categoryPath(categories, category.id)}</option>)}</select>
        <select value={activeFilter} onChange={e => setActiveFilter(e.target.value as typeof activeFilter)}><option value="true">Ativos</option><option value="false">Arquivados</option><option value="all">Todos</option></select>
        <button className="secondary" type="button" onClick={() => loadItems()}>Buscar</button>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Código</th><th>Item</th><th>Setor</th><th>Categoria</th><th>Qtd.</th><th>Localização</th><th>Responsável</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          {items.map(item => <tr key={item.id}>
            <td><span className="patrimony-code">{item.internalCode}</span></td>
            <td><div className="entity-title">{item.name}</div><div className="entity-subtitle">{[item.manufacturer, item.model].filter(Boolean).join(' - ') || item.description || '-'}</div></td>
            <td><span className="pool-badge">{item.pool.name}</span></td>
            <td>{categoryPath(categories, item.categoryId)}</td>
            <td><strong>{item.quantity.toLocaleString('pt-BR')}</strong></td>
            <td>{item.location || '-'}</td><td>{item.responsible || '-'}</td>
            <td><span className={`status-badge ${item.active ? 'status-active' : 'status-inactive'}`}><span />{item.active ? 'Ativo' : 'Arquivado'}</span></td>
            <td><div className="row-actions">
              {item.active && canEdit && <button className="table-action" type="button" onClick={() => startEdit(item)}>Editar</button>}
              {item.active && canMove && <button className="table-action" type="button" onClick={() => { setStockAction({ item, type: 'ENTRY' }); setStockQuantity(1); setStockNotes(''); }}>Movimentar</button>}
              {item.active && canMove && <button className="table-action" type="button" disabled={item.quantity === 0} onClick={() => { setTransferAction({ item }); setTransferQuantity(1); setTransferPoolId(''); setTransferNotes(''); }}>Transferir</button>}
              <button className="table-action" type="button" onClick={() => openHistory(item)}>Histórico</button>
              {item.active && canArchive && <button className="icon-danger" type="button" disabled={item.quantity > 0} title={item.quantity > 0 ? 'Zere ou transfira o saldo antes de arquivar.' : 'Arquivar'} onClick={() => archive(item)}>Arquivar</button>}
              {!item.active && canEdit && <button className="table-action" type="button" onClick={() => reactivate(item)}>Reativar</button>}
            </div></td>
          </tr>)}
          {!items.length && <tr><td colSpan={9}><div className="empty-state">Nenhum item não patrimoniado encontrado.</div></td></tr>}
        </tbody>
      </table></div>
    </section>

    {stockAction && <div className="modal-backdrop" onMouseDown={() => setStockAction(null)}><div className="modal-card" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-heading"><div><div className="eyebrow">Saldo</div><h2>Movimentar {stockAction.item.name}</h2><p>Saldo atual: <strong>{stockAction.item.quantity}</strong></p></div><button type="button" className="modal-close" onClick={() => setStockAction(null)}>×</button></div>
      <form className="stack-form" onSubmit={submitStock}>
        <div className="form-field"><label>Operação</label><select value={stockAction.type} onChange={e => setStockAction({ ...stockAction, type: e.target.value as 'ENTRY' | 'EXIT' | 'ADJUSTMENT' })}><option value="ENTRY">Entrada</option><option value="EXIT">Baixa</option><option value="ADJUSTMENT">Ajustar saldo para</option></select></div>
        <div className="form-field"><label>{stockAction.type === 'ADJUSTMENT' ? 'Novo saldo' : 'Quantidade'}</label><input type="number" min={stockAction.type === 'ADJUSTMENT' ? 0 : 1} max={1000000} required value={stockQuantity} onChange={e => setStockQuantity(Number(e.target.value))} /></div>
        <div className="form-field"><label>Motivo *</label><textarea required minLength={3} maxLength={2000} rows={3} value={stockNotes} onChange={e => setStockNotes(e.target.value)} /></div>
        <button className="primary" disabled={saving}>Registrar movimentação</button>
      </form>
    </div></div>}

    {transferAction && <div className="modal-backdrop" onMouseDown={() => setTransferAction(null)}><div className="modal-card" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-heading"><div><div className="eyebrow">Transferência</div><h2>{transferAction.item.name}</h2><p>Origem: {transferAction.item.pool.name} | Saldo: {transferAction.item.quantity}</p></div><button type="button" className="modal-close" onClick={() => setTransferAction(null)}>×</button></div>
      <form className="stack-form" onSubmit={submitTransfer}>
        <div className="form-field"><label>Setor de destino *</label><select required value={transferPoolId} onChange={e => setTransferPoolId(e.target.value)}><option value="">Selecione</option>{pools.filter(pool => pool.id !== transferAction.item.poolId && pool.active !== false).map(pool => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></div>
        <div className="form-field"><label>Quantidade *</label><input type="number" min={1} max={transferAction.item.quantity} required value={transferQuantity} onChange={e => setTransferQuantity(Number(e.target.value))} /></div>
        <div className="form-field"><label>Motivo *</label><textarea required minLength={3} maxLength={2000} rows={3} value={transferNotes} onChange={e => setTransferNotes(e.target.value)} /></div>
        <button className="primary" disabled={saving}>Transferir</button>
      </form>
    </div></div>}

    {historyItem && <div className="modal-backdrop" onMouseDown={() => setHistoryItem(null)}><div className="modal-card non-patrimonial-history-modal" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-heading"><div><div className="eyebrow">Histórico</div><h2>{historyItem.internalCode} · {historyItem.name}</h2><p>Últimas movimentações registradas.</p></div><button type="button" className="modal-close" onClick={() => setHistoryItem(null)}>×</button></div>
      {loadingHistory ? <div className="empty-state">Carregando...</div> : <div className="table-wrap"><table><thead><tr><th>Data</th><th>Operação</th><th>Qtd.</th><th>Antes</th><th>Depois</th><th>Motivo</th></tr></thead><tbody>
        {movements.map(movement => <tr key={movement.id}><td>{new Date(movement.createdAt).toLocaleString('pt-BR')}</td><td>{({ INITIAL: 'Saldo inicial', ENTRY: 'Entrada', EXIT: 'Baixa', ADJUSTMENT: 'Ajuste', TRANSFER_OUT: 'Transferência - saída', TRANSFER_IN: 'Transferência - entrada', IMPORT_SET: 'Ajuste por importação' } as Record<Movement['type'], string>)[movement.type]}</td><td>{movement.quantity}</td><td>{movement.quantityBefore}</td><td>{movement.quantityAfter}</td><td>{movement.notes || '-'}</td></tr>)}
        {!movements.length && <tr><td colSpan={6}><div className="empty-state">Nenhuma movimentação registrada.</div></td></tr>}
      </tbody></table></div>}
    </div></div>}
  </>;
}
