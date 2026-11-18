'use client';

export type CustomValue = string | number | boolean | null;
export type AssetCategory = { id: string; name: string; parentId?: string | null; assetTypes?: Array<{ id: string; name: string }>; customFields?: Array<{ id: string; key: string; name: string; type: string; required: boolean; options?: string[] | null }> };

export function AdvancedAssetFields({ category, assetTypeId, values, onTypeChange, onValuesChange }: { category?: AssetCategory; assetTypeId: string; values: Record<string, CustomValue>; onTypeChange: (id: string) => void; onValuesChange: (values: Record<string, CustomValue>) => void }) {
  const fields = category?.customFields || [], types = category?.assetTypes || [];
  if (!fields.length && !types.length) return null;
  const change = (key: string, value: CustomValue) => onValuesChange({ ...values, [key]: value });
  return <fieldset className="card section-card full-field"><legend>Informações específicas da categoria</legend><div className="form-grid">
    {types.length > 0 && <label className="form-field"><span>Tipo de ativo (opcional)</span><select value={assetTypeId} onChange={event => onTypeChange(event.target.value)}><option value="">Sem tipo específico</option>{types.map(type => <option value={type.id} key={type.id}>{type.name}</option>)}</select></label>}
    {fields.map(field => <label className="form-field" key={field.id}><span>{field.name}{field.required ? ' *' : ''}</span>
      {field.type === 'SELECT' || field.type === 'BOOLEAN'
        ? <select required={field.required} value={values[field.key] === null || values[field.key] === undefined ? '' : String(values[field.key])} onChange={event => change(field.key, event.target.value === '' ? null : field.type === 'BOOLEAN' ? event.target.value === 'true' : event.target.value)}><option value="">Selecione</option>{(field.type === 'BOOLEAN' ? ['true', 'false'] : field.options || []).map(value => <option key={value} value={value}>{field.type === 'BOOLEAN' ? value === 'true' ? 'Sim' : 'Não' : value}</option>)}</select>
        : <input required={field.required} type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'} step={field.type === 'NUMBER' ? 'any' : undefined} value={values[field.key] === undefined || values[field.key] === null ? '' : String(values[field.key])} onChange={event => change(field.key, event.target.value === '' ? null : field.type === 'NUMBER' ? Number(event.target.value) : event.target.value)} />}
    </label>)}
  </div></fieldset>;
}
