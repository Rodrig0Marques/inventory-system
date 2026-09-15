'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { canManage, getSessionUser } from '../lib/session';

type Pool = { id: string; name: string };
type Folder = { id: string; name: string; poolId: string };
type Category = { id: string; name: string };
type Asset = {
  id: string;
  patrimonyNumber: string;
  name: string;
  description?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  purchasePrice?: string | number | null;
  location?: string | null;
  responsible?: string | null;
  pool: Pool;
  category: Category;
};

const emptyForm = {
  patrimonyNumber: '', name: '', description: '', manufacturer: '', model: '', purchasePrice: '',
  location: '', responsible: '', poolId: '', folderId: '', categoryId: '',
};

function formatPrice(value: Asset['purchasePrice']) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number);
}

export default function AssetsPage() {
  const [items, setItems] = useState<Asset[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  const availableFolders = folders.filter(folder => folder.poolId === form.poolId);

  const load = async (term = '') => {
    const [assets, poolData, folderData, categoryData] = await Promise.all([
      api<{ items: Asset[] }>(`/assets?search=${encodeURIComponent(term)}`),
      api<Pool[]>('/pools'),
      api<Folder[]>('/folders'),
      api<Category[]>('/categories'),
    ]);
    setItems(assets.items);
    setPools(poolData);
    setFolders(folderData);
    setCategories(categoryData);
    setForm(current => ({
      ...current,
      poolId: current.poolId || poolData[0]?.id || '',
      categoryId: current.categoryId || categoryData[0]?.id || '',
    }));
  };

  useEffect(() => {
    setCanEdit(canManage(getSessionUser()?.role));
    load().catch(() => setError('Não foi possível carregar os ativos.'));
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api('/assets', {
        method: 'POST',
        body: JSON.stringify({
          patrimonyNumber: form.patrimonyNumber,
          name: form.name,
          description: form.description || null,
          manufacturer: form.manufacturer || null,
          model: form.model || null,
          purchasePrice: form.purchasePrice ? Number(form.purchasePrice) : null,
          location: form.location || null,
          responsible: form.responsible || null,
          poolId: form.poolId,
          folderId: form.folderId || null,
          categoryId: form.categoryId,
        }),
      });
      setSuccess('Ativo cadastrado com sucesso.');
      setForm(current => ({ ...emptyForm, poolId: current.poolId, categoryId: current.categoryId }));
      await load(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao cadastrar ativo.');
    } finally {
      setSaving(false);
    }
  }

  async function removeAsset(asset: Asset) {
    if (!window.confirm(`Deseja excluir o ativo ${asset.patrimonyNumber} - ${asset.name}?`)) return;
    setError('');
    setSuccess('');
    try {
      const result = await api<{ message: string }>(`/assets/${asset.id}`, { method: 'DELETE' });
      setSuccess(result.message);
      await load(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao excluir ativo.');
    }
  }

  const hasStructure = pools.length > 0 && categories.length > 0;

  return <>
    <div className="page-head">
      <div className="page-head-content">
        <div className="eyebrow">Patrimônio</div>
        <h1>Ativos</h1>
        <div className="page-description">Cadastre, consulte e organize os itens da empresa.</div>
      </div>
      <div className="count-pill">{items.length} resultado(s)</div>
    </div>

    {(error || success) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || success}</div>}

    {!canEdit && <div className="notice notice-info">Seu perfil é somente leitura. Você pode consultar e pesquisar os ativos, mas não pode alterá-los.</div>}
    {canEdit && !hasStructure && <div className="notice notice-warning">Para cadastrar ativos, crie pelo menos um <Link href="/pools">pool</Link> e uma <Link href="/structure">categoria</Link>.</div>}

    {canEdit && <section className="card section-card form-section">
      <div className="section-heading"><div><h2>Novo ativo</h2><p>Preencha apenas as informações necessárias para o patrimônio.</p></div></div>
      <form onSubmit={create} className="form-grid asset-form">
        <div className="form-field"><label>Pool *</label><select value={form.poolId} onChange={e => setForm({ ...form, poolId: e.target.value, folderId: '' })} required disabled={!pools.length}><option value="">Selecione</option>{pools.map(pool => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></div>
        <div className="form-field"><label>Pasta</label><select value={form.folderId} onChange={e => setForm({ ...form, folderId: e.target.value })}><option value="">Sem pasta</option>{availableFolders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div>
        <div className="form-field"><label>Categoria *</label><select value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })} required disabled={!categories.length}><option value="">Selecione</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
        <div className="form-field"><label>Patrimônio *</label><input value={form.patrimonyNumber} onChange={e => setForm({ ...form, patrimonyNumber: e.target.value })} placeholder="Ex.: PAT-00125" required /></div>
        <div className="form-field"><label>Nome *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Notebook Dell" required /></div>
        <div className="form-field"><label>Fabricante</label><input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} placeholder="Ex.: Dell" /></div>
        <div className="form-field"><label>Modelo</label><input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Ex.: Latitude 5450" /></div>
        <div className="form-field"><label>Preço</label><input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={e => setForm({ ...form, purchasePrice: e.target.value })} placeholder="0,00" /></div>
        <div className="form-field"><label>Localização</label><input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Ex.: Matriz - Sala TI" /></div>
        <div className="form-field"><label>Responsável</label><input value={form.responsible} onChange={e => setForm({ ...form, responsible: e.target.value })} placeholder="Nome do responsável" /></div>
        <div className="form-field full-field"><label>Descrição</label><textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Observações sobre o ativo" /></div>
        <div className="actions full-field"><button className="primary" disabled={!hasStructure || saving}>{saving ? 'Cadastrando...' : 'Cadastrar ativo'}</button></div>
      </form>
    </section>}

    <section className="card section-card">
      <div className="section-heading"><div><h2>Ativos cadastrados</h2><p>Use a busca para localizar um patrimônio rapidamente.</p></div></div>
      <div className="toolbar search-toolbar">
        <input placeholder="Buscar patrimônio, nome, fabricante, modelo..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(search); }} />
        <button className="secondary" onClick={() => load(search)}>Buscar</button>
        {search && <button className="ghost-button" onClick={() => { setSearch(''); load(''); }}>Limpar</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Patrimônio</th><th>Nome</th><th>Fabricante</th><th>Modelo</th><th>Preço</th><th>Localização</th><th>Responsável</th><th>Pool</th><th>Categoria</th>{canEdit && <th className="align-right">Ações</th>}</tr></thead>
          <tbody>
            {items.map(item => <tr key={item.id}>
              <td><span className="patrimony-code">{item.patrimonyNumber}</span></td>
              <td><Link className="entity-title" href={`/assets/${item.id}`}>{item.name}</Link><div className="entity-subtitle">Ver detalhes e componentes</div></td>
              <td>{item.manufacturer || '-'}</td>
              <td>{item.model || '-'}</td>
              <td>{formatPrice(item.purchasePrice)}</td>
              <td>{item.location || '-'}</td>
              <td>{item.responsible || '-'}</td>
              <td><span className="pool-badge">{item.pool.name}</span></td>
              <td>{item.category.name}</td>
              {canEdit && <td className="align-right"><button type="button" className="icon-danger" onClick={() => removeAsset(item)}>Excluir</button></td>}
            </tr>)}
            {items.length === 0 && <tr><td colSpan={canEdit ? 10 : 9}><div className="empty-state">Nenhum ativo encontrado.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </>;
}
