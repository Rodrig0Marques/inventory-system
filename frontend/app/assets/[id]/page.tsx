'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { canManage, getSessionUser } from '../../../lib/session';
import { requestId } from '../../../lib/inventory';

type Asset = { id: string; poolId: string; name: string; patrimonyNumber: string; description?: string; manufacturer?: string; model?: string; location?: string; responsible?: string; pool: { name: string }; category: { name: string }; folder?: { name: string } };
type Component = { id: string; quantity: number; origin: string; installedAt: string; profile: { name: string; specifications?: string; category: { name: string } } };
export default function AssetDetails() {
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<Asset | null>(null), [components, setComponents] = useState<Component[]>([]);
  const [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false), [editable, setEditable] = useState(false);
  const [target, setTarget] = useState<Component | null>(null), [quantity, setQuantity] = useState(1), [notes, setNotes] = useState('');
  const [disposition, setDisposition] = useState('RETURN_TO_STOCK');
  const pending = useRef<{ signature: string; id: string } | null>(null);
  const load = useCallback(async () => { const [a,c] = await Promise.all([api<Asset>(`/assets/${id}`), api<Component[]>(`/stock/assets/${id}/components`)]); setAsset(a); setComponents(c); }, [id]);
  useEffect(() => { setEditable(canManage(getSessionUser()?.role)); load().catch(e => setError(e.message)); }, [load]);
  async function remove(e: FormEvent) {
    e.preventDefault(); if (!target || busy) return;
    if (!window.confirm(disposition === 'RETURN_TO_STOCK' ? 'Devolver as unidades ao estoque disponível? O total permanece igual.' : 'Dar baixa nas unidades instaladas? O total será reduzido.')) return;
    setBusy(true); setError(''); setSuccess('');
    const body = { quantity, disposition, notes }; const signature = JSON.stringify([target.id, body]);
    if (pending.current?.signature !== signature) pending.current = { signature, id: requestId() };
    try {
      const r = await api<{ message: string }>(`/stock/components/${target.id}/remove`, { method: 'POST', body: JSON.stringify({ ...body, requestId: pending.current.id }) });
      setSuccess(r.message); setTarget(null); pending.current = null; await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao remover componente.'); }
    finally { setBusy(false); }
  }
  return <>
    <Link className="table-action asset-detail-back" href="/assets">Voltar aos ativos</Link>
    {error && <div className="notice notice-error" role="alert">{error}</div>}{success && <div className="notice notice-success" role="status">{success}</div>}
    {asset && <><div className="page-head asset-detail-page-head"><div className="page-head-content"><div className="eyebrow">{asset.patrimonyNumber}</div><h1>{asset.name}</h1><div className="page-description">{asset.pool.name} / {asset.category.name}{asset.folder ? ` / ${asset.folder.name}` : ''}</div></div>{editable && <Link className="primary button-link" href={`/stock?poolId=${asset.poolId}&assetId=${id}`}>Associar componentes</Link>}</div>
      <section className="card section-card"><dl className="asset-detail-grid">{[['Fabricante',asset.manufacturer],['Modelo',asset.model],['Localização',asset.location],['Responsável',asset.responsible],['Descrição',asset.description]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || '-'}</dd></div>)}</dl></section>
      <section className="card section-card"><div className="section-heading"><div><h2>Componentes instalados</h2><p>Essas unidades contam no total do estoque, mas não no disponível.</p></div><span className="count-pill">{components.reduce((n,c) => n+c.quantity,0)} unidade(s)</span></div><div className="table-wrap"><table><thead><tr><th>Perfil / especificações</th><th>Quantidade</th><th>Origem</th><th>Registrado em</th>{editable && <th>Ações</th>}</tr></thead><tbody>{components.map(c => <tr key={c.id}><td><strong>{c.profile.name}</strong><div className="entity-subtitle">{c.profile.specifications || c.profile.category.name}</div></td><td>{c.quantity}</td><td>{c.origin === 'FROM_STOCK' ? 'Retirado do estoque' : 'Já instalado (entrada no total)'}</td><td>{new Date(c.installedAt).toLocaleDateString('pt-BR')}</td>{editable && <td><button type="button" className="table-action" onClick={() => { setTarget(c); setQuantity(c.quantity); setNotes(''); setDisposition('RETURN_TO_STOCK'); }}>Devolver / baixar</button></td>}</tr>)}{!components.length && <tr><td colSpan={editable ? 5 : 4}><div className="empty-state">Nenhum componente associado.</div></td></tr>}</tbody></table></div></section>
    </>}
    {!asset && !error && <div className="empty-state">Carregando ativo...</div>}
    {target && <div className="modal-backdrop"><div className="modal-card"><div className="modal-heading"><h2>{target.profile.name}</h2><button type="button" className="modal-close" onClick={() => setTarget(null)}>×</button></div><form className="stack-form" onSubmit={remove}>
      <label className="form-field">Destino<select value={disposition} onChange={e => setDisposition(e.target.value)}><option value="RETURN_TO_STOCK">Devolver ao estoque disponível</option><option value="RETIRE_INSTALLED">Dar baixa (retirar do inventário)</option></select></label>
      <label className="form-field">Quantidade<input type="number" min={1} max={target.quantity} value={quantity} required onChange={e => setQuantity(Number(e.target.value))} /></label>
      <label className="form-field">Motivo<textarea required minLength={3} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></label><button disabled={busy}>{busy ? 'Salvando...' : 'Confirmar movimentação'}</button>
    </form></div></div>}
  </>;
}
