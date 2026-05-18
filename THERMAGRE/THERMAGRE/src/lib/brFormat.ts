/** Apenas dígitos, limitado a `max` caracteres */
export function onlyDigits(value: string, max: number): string {
  return value.replace(/\D/g, '').slice(0, max);
}

/**00000-000 */
export function formatCep(digits: string): string {
  const d = onlyDigits(digits, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** 000.000.000-00 */
export function formatCpf(digits: string): string {
  const d = onlyDigits(digits, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** (00) 0000-0000 ou (00) 00000-0000 (até 11 dígitos nacionais) */
export function formatPhoneBr(digits: string): string {
  const d = onlyDigits(digits, 11);
  if (d.length === 0) return '';
  const dd = d.slice(0, 2);
  const rest = d.slice(2);
  if (d.length <= 2) return `(${dd}`;
  if (rest.length === 0) return `(${dd}) `;
  if (rest.length <= 8) {
    const g1 = rest.slice(0, 4);
    const g2 = rest.slice(4);
    return g2.length ? `(${dd}) ${g1}-${g2}` : `(${dd}) ${g1}`;
  }
  const g1 = rest.slice(0, 5);
  const g2 = rest.slice(5);
  return `(${dd}) ${g1}-${g2}`;
}

export function validateCpf(cpf: string): boolean {
  const digits = onlyDigits(cpf, 11);
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]!, 10) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(digits[9]!, 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]!, 10) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(digits[10]!, 10);
}
