'use client';

import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api';
import { requestId } from '../lib/inventory';

type Profile = { id: string; name: string; poolId: string; available: number; pool: { name: string } };
type Pool = { id: string; name: string; active?: boolean };

export function AvailableStockTransfer({ profile, pools, onSuccess }: { profile: Profile; pools: Pool[]; onSuccess: (message: string) => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [toPoolId, setToPoolId] = useState(''), [quantity, setQuantity] = useState(1), [notes, setNotes] = useState('');
  const pending = useRef<{ signature: string; id: string } | null>(null);
  const dialog = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const destinations = pools.filter(pool => pool.id !== profile.poolId && pool.active !== false);

  function close() { if (!busy) { setOpen(false); trigger.current?.focus(); } }
  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLSelectElement>('select')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { setOpen(false); trigger.current?.focus(); }
      if (event.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled)');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, busy]);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    const data = { toPoolId, quantity, notes }, signature = JSON.stringify(data);
    if (pending.current?.signature !== signature) pending.current = { signature, id: requestId() };
    try {
      const result = await api<{ message: string }>(`/stock/profiles/${profile.id}/transfer`, { method: 'POST', body: JSON.stringify({ ...data, requestId: pending.current.id }) });
      pending.current = null; setOpen(false); trigger.current?.focus(); onSuccess(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível transferir os componentes.'); }
    finally { setBusy(false); }
  }

  return <><button ref={trigger} type="button" className="table-action" disabled={profile.available < 1 || !destinations.length} title={!destinations.length ? 'É necessário acesso a outro Setor ativo.' : 'Transferir unidades disponíveis para outro Setor'} onClick={() => { pending.current = null; setToPoolId(''); setQuantity(1); setNotes(''); setError(''); setOpen(true); }}>Transferir disponíveis</button>
    {open && <div className="modal-backdrop"><div className="modal-card" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal-heading"><div><h2 id={titleId}>Transferir componentes disponíveis</h2><p>{profile.name} · Origem: {profile.pool.name}</p></div><button type="button" className="modal-close" aria-label="Fechar transferência" disabled={busy} onClick={close}>×</button></div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <form className="stack-form" onSubmit={submit}>
        <label className="form-field"><span>Setor de destino *</span><select required disabled={busy} value={toPoolId} onChange={e => setToPoolId(e.target.value)}><option value="">Selecione</option>{destinations.map(pool => <option value={pool.id} key={pool.id}>{pool.name}</option>)}</select></label>
        <label className="form-field"><span>Quantidade *</span><input type="number" min={1} max={profile.available} required disabled={busy} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></label>
        <label className="form-field"><span>Motivo *</span><textarea minLength={3} maxLength={2000} required disabled={busy} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        <p className="field-help">Disponível na origem: {profile.available} → {Math.max(0, profile.available - quantity)}. O destino recebe {quantity} unidade(s). O total global e os componentes instalados permanecem iguais.</p>
        <p className="field-help">O perfil será criado no destino se necessário. Um perfil existente deve ter a mesma categoria e especificações técnicas.</p>
        <div className="form-actions-row"><button type="button" className="secondary" disabled={busy} onClick={close}>Cancelar</button><button className="primary" disabled={busy || !toPoolId}>{busy ? 'Transferindo…' : 'Confirmar transferência'}</button></div>
      </form>
    </div></div>}
  </>;
}
