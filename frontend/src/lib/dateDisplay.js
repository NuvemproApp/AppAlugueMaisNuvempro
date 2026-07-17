import { format } from 'date-fns';

export function toInputDate(date) {
  return format(date, 'yyyy-MM-dd');
}

// As datas de aluguel são armazenadas como "dia calendário" em UTC (sem hora real
// associada) — usar o dia/mês/ano LOCAL do navegador aqui deslocaria a data em ±1
// dia pra quem estiver num fuso diferente de UTC. Lemos os componentes UTC direto.
export function formatDisplayDate(value) {
  if (!value) return '—';
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '—';
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return '—';
  }
}
