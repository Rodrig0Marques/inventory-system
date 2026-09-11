'use client';

import Link from 'next/link';
import { categoryPath } from '../../lib/inventory';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { canManage, getSessionUser } from '../../lib/session';

type Pool = { id: string; name: string };
type Folder = {
  id: string;
  name: string;
  poolId: string;
  parentId?: string | null;
  pool: Pool;
  _count: { assets: number; children: number };
};
type Category = {
  parentId?: string | null;
  total?: number;
  available?: number;
  id: string;
  name: string;
  description?: string | null;
  _count: { assets: number };
};

export default function StructurePage() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [canAdmin, setCanAdmin] = useState(false);
  const [categoryParent, setCategoryParent] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [categoryDescription, setCategoryDescription] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderPool, setFolderPool] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [canEdit, setCanEdit] = useState(false);

  async function load() {
    const [poolData, folderData, categoryData, stockData] = await Promise.all([
      api<Pool[]>('/pools'),
      api<Folder[]>('/folders'),
      api<Category[]>('/categories'),
      api<{ categories: Array<{ id: string; total: number; available: number }> }>('/stock/catalog'),
    ]);
    setPools(poolData);
    setFolders(folderData);
    setCategories(categoryData.map(c => ({ ...c, ...stockData.categories.find(s => s.id === c.id) })));
    setFolderPool(value => value || poolData[0]?.id || '');
  }

  useEffect(() => {
    setCanEdit(canManage(getSessionUser()?.role));
    setCanAdmin(getSessionUser()?.role === 'ADMIN');
    load().catch(() => setError('Não foi possível carregar a estrutura.'));
  }, []);

  const availableParents = useMemo(() => folders.filter(folder => folder.poolId === folderPool), [folders, folderPool]);

  async function createCategory(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');
    try {
      await api('/categories', {
        method: 'POST',
        body: JSON.stringify({ name: categoryName, description: categoryDescription || null, parentId: categoryParent || null }),
      });
      setCategoryName('');
      setCategoryDescription(''); setCategoryParent('');
      setSuccess('Categoria criada com sucesso.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar categoria.');
    }
  }

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');
    try {
      await api('/folders', {
        method: 'POST',
        body: JSON.stringify({ name: folderName, poolId: folderPool, parentId: parentId || null }),
      });
      setFolderName('');
      setParentId('');
      setSuccess('Pasta criada com sucesso.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar pasta.');
    }
  }

  async function removeCategory(category: Category) {
    if (!window.confirm(`Excluir a categoria "${category.name}"?`)) return;
    setError('');
    setSuccess('');
    try {
      const result = await api<{ message: string }>(`/categories/${category.id}`, { method: 'DELETE' });
      setSuccess(result.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao excluir categoria.');
    }
  }

  async function removeFolder(folder: Folder) {
    if (!window.confirm(`Excluir a pasta "${folder.name}" do pool "${folder.pool.name}"?`)) return;
    setError('');
    setSuccess('');
    try {
      const result = await api<{ message: string }>(`/folders/${folder.id}`, { method: 'DELETE' });
      setSuccess(result.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao excluir pasta.');
    }
  }

  return <>
    <div className="page-head">
      <div>
        <div className="eyebrow">Configuração</div>
        <h1>Estrutura</h1>
        <div className="page-description">Crie categorias e organize os ativos em pastas e subpastas.</div>
      </div>
      <div className="count-pill">{categories.length} categorias / {folders.length} pastas</div>
    </div>

    {(error || success) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || success}</div>}
    {!canEdit && <div className="notice notice-info">Seu perfil é somente leitura. Você pode consultar categorias e pastas, mas não pode alterar a estrutura.</div>}

    {canEdit && <section className="management-grid">
      {canAdmin && <div className="card form-card">
        <div className="card-heading"><div className="card-icon">C</div><div><h2>Nova categoria</h2><p>Defina um novo tipo geral de patrimônio.</p></div></div>
        <form onSubmit={createCategory} className="stack-form">
          <div className="form-field"><label>Categoria pai</label><select value={categoryParent} onChange={e => setCategoryParent(e.target.value)}><option value="">Raiz das categorias</option>{categories.map(c => <option key={c.id} value={c.id}>{categoryPath(categories,c.id)}</option>)}</select><div className="field-help">Exemplo: Memórias / Memória 8gb / 8gb 2666Ghz. Os nomes devem ser únicos no catálogo.</div></div>
          <div className="form-field"><label>Nome</label><input value={categoryName} onChange={e => setCategoryName(e.target.value)} placeholder="Ex.: Projetor, Veículo, Cadeira" required /></div>
          <div className="form-field"><label>Descrição</label><textarea rows={3} value={categoryDescription} onChange={e => setCategoryDescription(e.target.value)} placeholder="Opcional" /></div>
          <button className="primary full-button">Criar categoria</button>
        </form>
      </div>}

      <div className="card form-card">
        <div className="card-heading"><div className="card-icon">P</div><div><h2>Nova pasta</h2><p>Organize os ativos dentro de cada pool.</p></div></div>
        <form onSubmit={createFolder} className="stack-form">
          <div className="form-field"><label>Pool</label><select value={folderPool} onChange={e => { setFolderPool(e.target.value); setParentId(''); }} required><option value="" disabled>Selecione</option>{pools.map(pool => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></div>
          <div className="form-field"><label>Nome da pasta</label><input value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="Ex.: Hardware, Estoque" required /></div>
          <div className="form-field"><label>Pasta pai</label><select value={parentId} onChange={e => setParentId(e.target.value)}><option value="">Raiz do pool</option>{availableParents.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div>
          <button className="primary full-button" disabled={!folderPool}>Criar pasta</button>
        </form>
      </div>
    </section>}

    <div className="notice notice-info">As definições de categorias são compartilhadas e administradas pelo ADMIN. Quantidades, ativos e pastas respeitam os seus Pools permitidos.</div>
    <section className="card section-card">
      <div className="section-heading"><div><h2>Categorias</h2><p>Categorias em uso não podem ser excluídas até que os ativos sejam alterados ou removidos.</p></div></div>
      <div className="category-grid">
        {categories.map(category => <article className="category-item" key={category.id}>
          <div className="category-symbol">{category.name.slice(0, 1).toUpperCase()}</div>
          <div className="category-content"><Link href={`/stock?categoryId=${category.id}`}><strong>{categoryPath(categories,category.id)}</strong></Link><span>{category._count.assets} ativo(s) direto(s) | Componentes: {category.total || 0} no total / {category.available || 0} disponíveis</span></div>
          {canAdmin && <button type="button" className="mini-delete" onClick={() => removeCategory(category)} title="Excluir categoria">Excluir</button>}
        </article>)}
        {categories.length === 0 && <div className="empty-state">Nenhuma categoria cadastrada.</div>}
      </div>
    </section>

    <section className="card section-card">
      <div className="section-heading"><div><h2>Pastas e subpastas</h2><p>Pastas com ativos ou subpastas precisam ser esvaziadas antes da exclusão.</p></div></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Pool</th><th>Pasta</th><th>Pasta pai</th><th>Ativos</th><th>Subpastas</th>{canEdit && <th className="align-right">Ações</th>}</tr></thead>
          <tbody>
            {folders.map(folder => <tr key={folder.id}>
              <td><span className="pool-badge">{folder.pool.name}</span></td>
              <td><div className="entity-title">{folder.name}</div></td>
              <td>{folders.find(item => item.id === folder.parentId)?.name || 'Raiz'}</td>
              <td>{folder._count.assets}</td>
              <td>{folder._count.children}</td>
              {canEdit && <td className="align-right"><button type="button" className="icon-danger" onClick={() => removeFolder(folder)}>Excluir</button></td>}
            </tr>)}
            {folders.length === 0 && <tr><td colSpan={canEdit ? 6 : 5}><div className="empty-state">Nenhuma pasta cadastrada.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </>;
}
