'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../../../../lib/api';
import { categoryPath } from '../../../../lib/inventory';
import { getSessionUser, hasPermission } from '../../../../lib/session';

type AssetStatus =
  | 'AVAILABLE'
  | 'IN_USE'
  | 'RESERVED'
  | 'MAINTENANCE'
  | 'DAMAGED'
  | 'LOST'
  | 'LOANED'
  | 'DISPOSED'
  | 'SOLD'
  | 'INACTIVE';

type Pool = { id: string; name: string; active?: boolean };
type Folder = { id: string; name: string; poolId: string; parentId?: string | null };
type Category = { id: string; name: string; parentId?: string | null };

type Asset = {
  id: string;
  patrimonyNumber: string;
  name: string;
  description?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  purchasePrice?: string | number | null;
  status: AssetStatus;
  location?: string | null;
  responsible?: string | null;
  poolId: string;
  folderId?: string | null;
  categoryId: string;
};

type AssetForm = {
  patrimonyNumber: string;
  name: string;
  description: string;
  manufacturer: string;
  model: string;
  purchasePrice: string;
  status: AssetStatus;
  location: string;
  responsible: string;
  poolId: string;
  folderId: string;
  categoryId: string;
};

const statusOptions: Array<{ value: AssetStatus; label: string }> = [
  { value: 'AVAILABLE', label: 'Disponível' },
  { value: 'IN_USE', label: 'Em uso' },
  { value: 'RESERVED', label: 'Reservado' },
  { value: 'MAINTENANCE', label: 'Em manutenção' },
  { value: 'DAMAGED', label: 'Danificado' },
  { value: 'LOST', label: 'Perdido' },
  { value: 'LOANED', label: 'Emprestado' },
  { value: 'DISPOSED', label: 'Baixado / descartado' },
  { value: 'SOLD', label: 'Vendido' },
  { value: 'INACTIVE', label: 'Inativo' },
];

function toForm(asset: Asset): AssetForm {
  return {
    patrimonyNumber: asset.patrimonyNumber,
    name: asset.name,
    description: asset.description || '',
    manufacturer: asset.manufacturer || '',
    model: asset.model || '',
    purchasePrice: asset.purchasePrice === null || asset.purchasePrice === undefined ? '' : String(asset.purchasePrice),
    status: asset.status,
    location: asset.location || '',
    responsible: asset.responsible || '',
    poolId: asset.poolId,
    folderId: asset.folderId || '',
    categoryId: asset.categoryId,
  };
}

export default function EditAssetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [form, setForm] = useState<AssetForm | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [canMove, setCanMove] = useState(false);

  useEffect(() => {
    const session = getSessionUser();
    if (!hasPermission('ASSET_EDIT', session)) {
      router.replace(`/assets/${id}`);
      return;
    }
    setCanMove(hasPermission('ASSET_MOVE', session));

    Promise.all([
      api<Asset>(`/assets/${id}`),
      api<Pool[]>('/pools'),
      api<Folder[]>('/folders'),
      api<Category[]>('/categories'),
    ])
      .then(([asset, poolData, folderData, categoryData]) => {
        setForm(toForm(asset));
        setPools(poolData);
        setFolders(folderData);
        setCategories(categoryData);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Não foi possível carregar o ativo.'))
      .finally(() => setLoading(false));
  }, [id, router]);

  const availableFolders = useMemo(
    () => folders.filter(folder => folder.poolId === form?.poolId),
    [folders, form?.poolId],
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || saving) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await api(`/assets/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          patrimonyNumber: form.patrimonyNumber,
          name: form.name,
          description: form.description || null,
          manufacturer: form.manufacturer || null,
          model: form.model || null,
          purchasePrice: form.purchasePrice.trim() ? Number(form.purchasePrice.replace(',', '.')) : null,
          status: form.status,
          location: form.location || null,
          responsible: form.responsible || null,
          poolId: form.poolId,
          folderId: form.folderId || null,
          categoryId: form.categoryId,
        }),
      });

      setSuccess('Ativo atualizado com sucesso.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao atualizar o ativo.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="empty-state">Carregando ativo...</div>;

  return <>
    <Link className="table-action asset-detail-back" href={`/assets/${id}`}>Voltar aos detalhes</Link>

    <div className="page-head">
      <div className="page-head-content">
        <div className="eyebrow">Patrimônio</div>
        <h1>Editar ativo</h1>
        <div className="page-description">Atualize os dados cadastrais, a localização e a classificação do patrimônio.</div>
      </div>
    </div>

    {(error || success) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || success}</div>}

    {form && <section className="card section-card">
      <div className="section-heading">
        <div>
          <h2>{form.patrimonyNumber} - {form.name}</h2>
          <p>As permissões de Setor também são validadas pelo servidor antes de salvar.</p>
        </div>
      </div>

      <form onSubmit={save} className="form-grid asset-form">
        <div className="form-field">
          <label>Setor *</label>
          <select required disabled={!canMove} value={form.poolId} onChange={e => setForm({ ...form, poolId: e.target.value, folderId: '' })}>
            <option value="">Selecione</option>
            {pools.map(pool => <option key={pool.id} value={pool.id}>{pool.name}{pool.active === false ? ' (inativo)' : ''}</option>)}
          </select>
          <div className="field-help">{canMove ? 'Ativos com componentes instalados não podem ser transferidos de Setor até os componentes serem devolvidos ou baixados.' : 'Sua conta pode editar o ativo, mas não possui permissão para movimentá-lo entre Setores.'}</div>
        </div>

        <div className="form-field">
          <label>Pasta</label>
          <select value={form.folderId} onChange={e => setForm({ ...form, folderId: e.target.value })}>
            <option value="">Sem pasta</option>
            {availableFolders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </div>

        <div className="form-field">
          <label>Categoria *</label>
          <select required value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">Selecione</option>
            {categories.map(category => <option key={category.id} value={category.id}>{categoryPath(categories, category.id)}</option>)}
          </select>
        </div>

        <div className="form-field">
          <label>Patrimônio *</label>
          <input required maxLength={100} value={form.patrimonyNumber} onChange={e => setForm({ ...form, patrimonyNumber: e.target.value })} />
        </div>

        <div className="form-field">
          <label>Nome *</label>
          <input required maxLength={200} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </div>

        <div className="form-field">
          <label>Status *</label>
          <select required value={form.status} onChange={e => setForm({ ...form, status: e.target.value as AssetStatus })}>
            {statusOptions.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
          <div className="field-help">Baixar, vender, marcar como perdido ou inativar um ativo com componentes instalados exige resolver os componentes primeiro.</div>
        </div>

        <div className="form-field">
          <label>Fabricante</label>
          <input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} />
        </div>

        <div className="form-field">
          <label>Modelo</label>
          <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} />
        </div>

        <div className="form-field">
          <label>Preço</label>
          <input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={e => setForm({ ...form, purchasePrice: e.target.value })} />
        </div>

        <div className="form-field">
          <label>Localização</label>
          <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
        </div>

        <div className="form-field">
          <label>Responsável</label>
          <input value={form.responsible} onChange={e => setForm({ ...form, responsible: e.target.value })} />
        </div>

        <div className="form-field full-field">
          <label>Descrição</label>
          <textarea rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>

        <div className="form-actions-row full-field">
          <Link className="secondary-link" href={`/assets/${id}`}>Cancelar</Link>
          <button className="primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
        </div>
      </form>
    </section>}
  </>;
}
