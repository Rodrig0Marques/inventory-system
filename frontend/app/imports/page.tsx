'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, getToken } from '../../lib/api';
import { getSessionUser, hasPermission } from '../../lib/session';

type ImportMode = 'ASSET' | 'NON_PATRIMONIAL';
type Job = {
  id: string;
  kind?: ImportMode;
  fileName: string;
  totalRows: number;
  successRows: number;
  errorRows: number;
  createdAt: string;
};
type PreviewRow = {
  row: number;
  patrimonyNumber?: string;
  internalCode?: string;
  name: string;
  pool: string;
  category: string;
  quantity?: number | null;
  action?: 'CREATE' | 'UPDATE';
  valid: boolean;
  errors: string[];
};
type Preview = { fileName: string; totalRows: number; validRows: number; errorRows: number; rows: PreviewRow[] };

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

export default function ImportsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mode, setMode] = useState<ImportMode>('ASSET');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [canAssets, setCanAssets] = useState(false);
  const [canNonPatrimonial, setCanNonPatrimonial] = useState(false);

  const canEdit = mode === 'ASSET' ? canAssets : canNonPatrimonial;
  const visibleJobs = useMemo(() => jobs.filter(job => (job.kind || 'ASSET') === mode), [jobs, mode]);

  async function load() { setJobs(await api<Job[]>('/imports')); }

  useEffect(() => {
    const session = getSessionUser();
    const assetPermission = hasPermission('IMPORT_ASSETS', session);
    const nonPatrimonialPermission = hasPermission('IMPORT_NON_PATRIMONIAL', session);
    setCanAssets(assetPermission);
    setCanNonPatrimonial(nonPatrimonialPermission);
    if (!assetPermission && nonPatrimonialPermission) setMode('NON_PATRIMONIAL');
    load().catch(() => setError('Não foi possível carregar as importações.'));
  }, []);

  function switchMode(next: ImportMode) {
    setMode(next); setFile(null); setPreview(null); setMessage(''); setError('');
  }

  function selectFile(nextFile: File | null) {
    setFile(nextFile); setPreview(null); setMessage(''); setError('');
  }

  function endpoint(suffix = '') {
    return mode === 'ASSET' ? `/imports/assets${suffix}` : `/imports/non-patrimonial${suffix}`;
  }

  async function analyze(event: FormEvent) {
    event.preventDefault(); if (!file) return;
    setMessage(''); setError(''); setPreview(null); setAnalyzing(true);
    try {
      const body = new FormData(); body.append('file', file);
      const response = await fetch(`${API_URL}${endpoint('/preview')}`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Falha ao analisar o arquivo.');
      setPreview(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao analisar o arquivo.'); }
    finally { setAnalyzing(false); }
  }

  async function importValidRows() {
    if (!file || !preview || preview.validRows === 0) return;
    setMessage(''); setError(''); setUploading(true);
    try {
      const body = new FormData(); body.append('file', file);
      const response = await fetch(`${API_URL}${endpoint()}`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body });
      const data = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(data.message || 'Falha na importação.');
      const entity = mode === 'ASSET' ? 'ativo(s)' : 'item(ns) não patrimoniado(s)';
      setMessage(`Importação concluída: ${data.successRows} ${entity} processado(s) e ${data.errorRows} linha(s) rejeitada(s).`);
      setFile(null); setPreview(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha na importação.'); }
    finally { setUploading(false); }
  }

  async function downloadTemplate() {
    setDownloading(true); setError('');
    try {
      const path = mode === 'ASSET' ? '/imports/template' : '/imports/non-patrimonial/template';
      const response = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message || 'Não foi possível baixar o modelo.'); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = mode === 'ASSET' ? 'modelo_importacao_ativos.xlsx' : 'modelo_importacao_itens_nao_patrimoniados.xlsx';
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível baixar o modelo.'); }
    finally { setDownloading(false); }
  }

  const assetMode = mode === 'ASSET';

  return <>
    <div className="page-head">
      <div><div className="eyebrow">Carga em lote</div><h1>Importações</h1><div className="page-description">Importe arquivos CSV, XLS, XLSX ou XML com validação prévia de Setor e Categoria.</div></div>
      {canEdit && <button className="secondary-link" type="button" onClick={downloadTemplate} disabled={downloading}>{downloading ? 'Gerando modelo...' : 'Baixar modelo XLSX'}</button>}
    </div>

    <div className="stock-tabs import-mode-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={assetMode} className={assetMode ? 'primary' : 'secondary'} onClick={() => switchMode('ASSET')}>Ativos patrimoniais</button>
      <button type="button" role="tab" aria-selected={!assetMode} className={!assetMode ? 'primary' : 'secondary'} onClick={() => switchMode('NON_PATRIMONIAL')}>Itens não patrimoniados</button>
    </div>

    {(error || message) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || message}</div>}
    {!canEdit && <div className="notice notice-info">Você pode consultar o histórico, mas não possui permissão para importar {assetMode ? 'ativos patrimoniais' : 'itens não patrimoniados'}.</div>}

    {canEdit && <section className="import-layout">
      <div className="card form-card">
        <div className="card-heading"><div className="card-icon">UP</div><div><h2>Analisar arquivo</h2><p>{assetMode ? 'Valide os ativos antes da gravação.' : 'Cadastre ou atualize itens sem exigir patrimônio.'}</p></div></div>
        <form onSubmit={analyze} className="stack-form">
          <div className="form-field"><label>Arquivo</label><input key={`${mode}-${file?.name || 'empty'}`} className="file-input" type="file" accept=".csv,.xls,.xlsx,.xml" onChange={e => selectFile(e.target.files?.[0] || null)} required />
            <div className="field-help">{assetMode
              ? 'Colunas: patrimônio, nome, setor, categoria, descrição, fabricante, modelo, preço, localização e responsável.'
              : 'Colunas: codigo_interno (opcional), nome, setor, categoria, quantidade, descrição, fabricante, modelo, localização e responsável.'}</div>
          </div>
          <button className="primary full-button" disabled={analyzing || !file}>{analyzing ? 'Analisando...' : 'Analisar arquivo'}</button>
        </form>
      </div>

      <div className="card import-help"><div className="eyebrow">Como funciona</div><h2>{assetMode ? 'Importação de patrimônio' : 'Importação sem patrimônio'}</h2><div className="step-list">
        <div className="step-item"><span>1</span><div><strong>Baixe o modelo</strong><p>O XLSX inclui os Setores e Categorias disponíveis.</p></div></div>
        <div className="step-item"><span>2</span><div><strong>{assetMode ? 'Informe o patrimônio' : 'Código interno é opcional'}</strong><p>{assetMode ? 'O patrimônio identifica o ativo dentro do Setor.' : 'Sem código, o sistema cria NP-XXXXXX. Com código existente, atualiza o item.'}</p></div></div>
        <div className="step-item"><span>3</span><div><strong>XML também é aceito</strong><p>{assetMode ? '<ativos><ativo>...</ativo></ativos>' : '<itens><item>...</item></itens>'}</p></div></div>
        <div className="step-item"><span>4</span><div><strong>Pré-validação</strong><p>Linhas inválidas são rejeitadas sem criar Setores ou Categorias automaticamente.</p></div></div>
      </div></div>
    </section>}

    {canEdit && preview && <section className="card section-card import-preview-card">
      <div className="section-heading preview-heading"><div><div className="eyebrow">Pré-validação</div><h2>{preview.fileName}</h2><p>Revise o resultado antes de gravar.</p></div><div className="preview-actions"><button className="ghost-button" type="button" onClick={() => setPreview(null)} disabled={uploading}>Cancelar</button><button className="primary" type="button" onClick={importValidRows} disabled={uploading || preview.validRows === 0}>{uploading ? 'Importando...' : `Importar ${preview.validRows} linha(s) válida(s)`}</button></div></div>
      <div className="preview-summary"><div className="preview-stat"><span>Total</span><strong>{preview.totalRows}</strong></div><div className="preview-stat preview-stat-success"><span>Válidos</span><strong>{preview.validRows}</strong></div><div className="preview-stat preview-stat-error"><span>Rejeitados</span><strong>{preview.errorRows}</strong></div></div>
      {preview.errorRows > 0 && <div className="notice notice-warning import-warning">As linhas rejeitadas não serão cadastradas. Corrija o arquivo se quiser processá-las.</div>}
      <div className="table-wrap preview-table-wrap"><table><thead><tr><th>Linha</th><th>{assetMode ? 'Patrimônio' : 'Código interno'}</th><th>Nome</th><th>Setor</th><th>Categoria</th>{!assetMode && <th>Quantidade</th>}<th>Ação</th><th>Validação</th></tr></thead><tbody>
        {preview.rows.map(row => <tr key={`${row.row}-${row.patrimonyNumber || row.internalCode || row.name}`} className={!row.valid ? 'invalid-import-row' : undefined}><td>{row.row}</td><td><div className="entity-title">{(assetMode ? row.patrimonyNumber : row.internalCode) || (assetMode ? '-' : 'Gerar automaticamente')}</div></td><td>{row.name || '-'}</td><td>{row.pool || '-'}</td><td>{row.category || '-'}</td>{!assetMode && <td>{row.quantity ?? '-'}</td>}<td>{row.valid ? <span className={`import-action ${row.action === 'UPDATE' ? 'import-action-update' : 'import-action-create'}`}>{row.action === 'UPDATE' ? 'Atualizar' : 'Criar'}</span> : '-'}</td><td>{row.valid ? <span className="validation-ok">Válido</span> : <div className="validation-errors">{row.errors.map((item, index) => <div key={index}>{item}</div>)}</div>}</td></tr>)}
      </tbody></table></div>
    </section>}

    <section className="card section-card"><div className="section-heading"><div><h2>Histórico</h2><p>Últimas cargas de {assetMode ? 'ativos patrimoniais' : 'itens não patrimoniados'}.</p></div></div><div className="table-wrap"><table><thead><tr><th>Arquivo</th><th>Total</th><th>Sucesso</th><th>Erros</th><th>Data</th></tr></thead><tbody>
      {visibleJobs.map(job => <tr key={job.id}><td><div className="entity-title">{job.fileName}</div></td><td>{job.totalRows}</td><td><span className="success-count">{job.successRows}</span></td><td><span className={job.errorRows ? 'error-count' : 'soft-badge'}>{job.errorRows}</span></td><td>{new Date(job.createdAt).toLocaleString('pt-BR')}</td></tr>)}
      {!visibleJobs.length && <tr><td colSpan={5}><div className="empty-state">Nenhuma importação deste tipo realizada.</div></td></tr>}
    </tbody></table></div></section>
  </>;
}
