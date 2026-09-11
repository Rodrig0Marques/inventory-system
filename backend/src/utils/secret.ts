export function jwtSecret(value: string | undefined): string {
  if (!value || Buffer.byteLength(value, 'utf8') < 32 || /change-me|coloque-uma-chave|SUA_CHAVE|gere-uma-chave/i.test(value)) {
    throw new Error('Configure JWT_SECRET no .env com uma chave aleatória de pelo menos 32 bytes. Gere uma com: openssl rand -hex 32. O valor padrão de exemplo não é aceito na v7.');
  }
  return value;
}
