'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { api, getToken } from '../lib/api';

type Rejection = { row: number; message: string; data?: Record<string, unknown> };
type Report = { id: string; fileName: string; totalRows: number; successRows: number; errorRows: number; createdAt: string; errors: Rejection[] };
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

export function ImportReport({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [report, setReport] = useState<Report | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [downloading, setDownloading] = useState(false), [page, setPage] = useState(1);
  const dialog = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setReport(null); setPage(1);
    api<Report>(`/imports/${encodeURIComponent(jobId)}`, { signal: controller.signal }).then(setReport)
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Falha ao consultar o resultado.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [jobId]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  async function download() {
    if (!report) return;
    setDownloading(true); setError('');
    try {
      const response = await fetch(`${API_URL}/imports/${encodeURIComponent(jobId)}/errors.csv`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message || 'Falha ao baixar as linhas rejeitadas.'); }
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = 'linhas_rejeitadas.csv'; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao baixar o relatório.'); }
    finally { setDownloading(false); }
  }

  return <div className="modal-backdrop"><div className="modal-card" style={{ width: 'min(920px, 100%)' }} ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <div className="modal-heading"><div><h2 id={titleId}>Resultado da importação</h2>{report && <p style={{ overflowWrap: 'anywhere' }}>{report.fileName} · {new Date(report.createdAt).toLocaleString('pt-BR')}</p>}</div><button ref={closeButton} type="button" className="modal-close" aria-label="Fechar resultado da importação" onClick={onClose}>×</button></div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {loading && <p role="status">Carregando resultado…</p>}
    {report && <>
      <div className="preview-summary"><div className="preview-stat"><span>Total</span><strong>{report.totalRows}</strong></div><div className="preview-stat preview-stat-success"><span>Processadas</span><strong>{report.successRows}</strong></div><div className="preview-stat preview-stat-error"><span>Rejeitadas</span><strong>{report.errorRows}</strong></div></div>
      {report.errorRows > 0 ? <>
        <p className="field-help">Baixe as linhas rejeitadas, corrija os motivos indicados e analise o arquivo novamente. As linhas processadas não estão nesse arquivo.</p>
        <button type="button" className="secondary" disabled={downloading || !report.errors.length} onClick={() => void download()}>{downloading ? 'Baixando…' : 'Baixar linhas rejeitadas (CSV)'}</button>
        <div className="table-wrap"><table><thead><tr><th>Linha original</th><th>Motivo da rejeição</th><th>Dados enviados</th></tr></thead><tbody>{report.errors.slice((page - 1) * 50, page * 50).map((entry, index) => <tr key={`${entry.row}-${index}`}><td>{entry.row}</td><td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{entry.message}</td><td>{entry.data ? <details><summary>Ver dados da linha</summary><pre style={{ maxWidth: 400, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(entry.data, null, 2)}</pre></details> : 'Dados da linha indisponíveis nesta importação antiga.'}</td></tr>)}</tbody></table></div>
        {!report.errors.length && <p className="notice notice-info">Esta importação antiga não possui detalhes das rejeições.</p>}
        {report.errors.length > 50 && <div className="stock-pagination"><button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} · {report.errors.length} rejeições</span><button className="secondary" disabled={page * 50 >= report.errors.length} onClick={() => setPage(page + 1)}>Próxima</button></div>}
      </> : <p className="notice notice-success">Todas as linhas foram processadas.</p>}
    </>}
  </div></div>;
}
