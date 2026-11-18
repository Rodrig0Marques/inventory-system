import { fail } from '../../utils/access.js';

export type FieldDefinition = { key: string; name: string; type: string; required: boolean; options: unknown };

// Validate the effective values, including values retained during a partial edit.
export function validateCustomValues(fields: FieldDefinition[], values: Record<string, unknown>) {
  const definitions = new Map(fields.map(field => [field.key, field]));
  for (const key of Object.keys(values)) if (!definitions.has(key)) fail(400, `Campo personalizado desconhecido: ${key}.`);
  for (const field of fields) {
    const value = values[field.key];
    const empty = value === null || value === undefined || value === '';
    if (empty) { if (field.required) fail(400, `O campo ${field.name} é obrigatório.`); continue; }
    const valid = field.type === 'TEXT' ? typeof value === 'string'
      : field.type === 'NUMBER' ? typeof value === 'number' && Number.isFinite(value)
      : field.type === 'BOOLEAN' ? typeof value === 'boolean'
      : field.type === 'DATE' ? typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
      : field.type === 'SELECT' ? typeof value === 'string' && Array.isArray(field.options) && field.options.includes(value)
      : false;
    if (!valid) fail(400, `Valor inválido para o campo ${field.name} (${field.type}).`);
  }
}
