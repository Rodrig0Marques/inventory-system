'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, getToken } from '../../lib/api';
import { canManage, getSessionUser } from '../../lib/session';

type Job = {
  id: string;
  fileName: string;
  totalRows: number;
  successRows: number;
  errorRows: number;
  createdAt: string;
};

type PreviewRow = {
  row: number;
  patrimonyNumber: string;
  name: string;
  pool: string;
  category: string;
  action?: 'CREATE' | 'UPDATE';
  valid: boolean;
  errors: string[];
};

type Preview = {
  fileName: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: PreviewRow[];
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';

export default function ImportsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  async function load() {
    setJobs(await api<Job[]>('/imports'));
  }

  useEffect(() => {
    setCanEdit(canManage(getSessionUser()?.role));
    load().catch(() => setError('Não foi possível carregar as importações.'));
  }, []);

  function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setPreview(null);
    setMessage('');
    setError('');
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();
    if (!file) return;

    setMessage('');
    setError('');
    setPreview(null);
    setAnalyzing(true);

    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`${API_URL}/imports/assets/preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Falha ao analisar o arquivo.');
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao analisar o arquivo.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function importValidRows() {
    if (!file || !preview || preview.validRows === 0) return;

    setMessage('');
    setError('');
    setUploading(true);

    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`${API_URL}/imports/assets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body,
      });
      const data = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(data.message || 'Falha na importação.');

      setMessage(`Importação concluída: ${data.successRows} ativo(s) importado(s) e ${data.errorRows} linha(s) rejeitada(s).`);
      setFile(null);
      setPreview(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na importação.');
    } finally {
      setUploading(false);
    }
  }

  async function downloadTemplate() {
    setDownloading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/imports/template`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Não foi possível baixar o modelo.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'modelo_importacao_ativos.xlsx';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível baixar o modelo.');
    } finally {
      setDownloading(false);
    }
  }

  return <>
    <div className="page-head">
      <div>
        <div className="eyebrow">Carga em lote</div>
        <h1>Importações</h1>
        <div className="page-description">O Pool e a Categoria são identificados em cada linha e validados antes da gravação.</div>
      </div>
      <button className="secondary-link" type="button" onClick={downloadTemplate} disabled={downloading}>
        {downloading ? 'Gerando modelo...' : 'Baixar modelo XLSX'}
      </button>
    </div>

    {(error || message) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`}>{error || message}</div>}
    {!canEdit && <div className="notice notice-info">Seu perfil é somente leitura. O histórico continua disponível, mas novas importações são restritas a gestores e administradores.</div>}

    {canEdit && <section className="import-layout">
      <div className="card form-card">
        <div className="card-heading">
          <div className="card-icon">UP</div>
          <div><h2>Analisar arquivo</h2><p>Envie a planilha para validar os ativos antes da importação.</p></div>
        </div>
        <form onSubmit={analyze} className="stack-form">
          <div className="form-field">
            <label>Arquivo</label>
            <input
              key={file?.name || 'empty-file'}
              className="file-input"
              type="file"
              accept=".csv,.xls,.xlsx,.xml"
              onChange={e => selectFile(e.target.files?.[0] || null)}
              required
            />
            <div className="field-help">Colunas: patrimônio, nome, pool, categoria, descrição, fabricante, modelo, preço, localização e responsável.</div>
          </div>
          <button className="primary full-button" disabled={analyzing || !file}>
            {analyzing ? 'Analisando...' : 'Analisar arquivo'}
          </button>
        </form>
      </div>

      <div className="card import-help">
        <div className="eyebrow">Como funciona</div><h2>Importação validada</h2>
        <div className="step-list">
          <div className="step-item"><span>1</span><div><strong>Baixe o modelo</strong><p>O arquivo inclui abas com Pools e Categorias disponíveis no momento do download.</p></div></div>
          <div className="step-item"><span>2</span><div><strong>Preencha cada ativo</strong><p>Informe Pool e Categoria em cada linha da planilha.</p></div></div>
          <div className="step-item"><span>3</span><div><strong>Analise o arquivo</strong><p>O sistema verifica nomes, campos obrigatórios, preço e duplicidades.</p></div></div>
          <div className="step-item"><span>4</span><div><strong>Importe os válidos</strong><p>Linhas inválidas são rejeitadas e não criam categorias ou Pools automaticamente.</p></div></div>
        </div>
      </div>
    </section>}

    {canEdit && preview && <section className="card section-card import-preview-card">
      <div className="section-heading preview-heading">
        <div>
          <div className="eyebrow">Pré-validação</div>
          <h2>{preview.fileName}</h2>
          <p>Revise o resultado antes de gravar os ativos.</p>
        </div>
        <div className="preview-actions">
          <button className="ghost-button" type="button" onClick={() => setPreview(null)} disabled={uploading}>Cancelar</button>
          <button className="primary" type="button" onClick={importValidRows} disabled={uploading || preview.validRows === 0}>
            {uploading ? 'Importando...' : `Importar ${preview.validRows} ativo(s) válido(s)`}
          </button>
        </div>
      </div>

      <div className="preview-summary">
        <div className="preview-stat"><span>Total</span><strong>{preview.totalRows}</strong></div>
        <div className="preview-stat preview-stat-success"><span>Válidos</span><strong>{preview.validRows}</strong></div>
        <div className="preview-stat preview-stat-error"><span>Rejeitados</span><strong>{preview.errorRows}</strong></div>
      </div>

      {preview.errorRows > 0 && <div className="notice notice-warning import-warning">
        As linhas rejeitadas não serão cadastradas. Corrija o arquivo se quiser importá-las posteriormente.
      </div>}

      <div className="table-wrap preview-table-wrap">
        <table>
          <thead><tr><th>Linha</th><th>Patrimônio</th><th>Nome</th><th>Pool</th><th>Categoria</th><th>Ação</th><th>Validação</th></tr></thead>
          <tbody>
            {preview.rows.map(row => <tr key={`${row.row}-${row.patrimonyNumber}`} className={!row.valid ? 'invalid-import-row' : undefined}>
              <td>{row.row}</td>
              <td><div className="entity-title">{row.patrimonyNumber || '-'}</div></td>
              <td>{row.name || '-'}</td>
              <td>{row.pool || '-'}</td>
              <td>{row.category || '-'}</td>
              <td>{row.valid ? <span className={`import-action ${row.action === 'UPDATE' ? 'import-action-update' : 'import-action-create'}`}>{row.action === 'UPDATE' ? 'Atualizar' : 'Criar'}</span> : '-'}</td>
              <td>{row.valid
                ? <span className="validation-ok">Válido</span>
                : <div className="validation-errors">{row.errors.map((item, index) => <div key={index}>{item}</div>)}</div>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>}

    <section className="card section-card">
      <div className="section-heading"><div><h2>Histórico</h2><p>Últimas cargas realizadas no sistema.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Arquivo</th><th>Total</th><th>Sucesso</th><th>Erros</th><th>Data</th></tr></thead><tbody>
        {jobs.map(j => <tr key={j.id}><td><div className="entity-title">{j.fileName}</div></td><td>{j.totalRows}</td><td><span className="success-count">{j.successRows}</span></td><td><span className={j.errorRows ? 'error-count' : 'soft-badge'}>{j.errorRows}</span></td><td>{new Date(j.createdAt).toLocaleString('pt-BR')}</td></tr>)}
        {jobs.length === 0 && <tr><td colSpan={5}><div className="empty-state">Nenhuma importação realizada.</div></td></tr>}
      </tbody></table></div>
    </section>
  </>;
}
