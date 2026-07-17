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

// orderCreatedAt é um timestamp de verdade (momento em que o pedido foi criado,
// com fuso embutido no ISO da Nuvemshop) — diferente de eventDate/reservationStart/
// End, que são "dia calendário" puro. Aqui queremos a hora local do navegador,
// não os componentes UTC (isso seria o comportamento errado só pras datas de
// aluguel, que não têm hora real associada).
export function formatDisplayDateTime(value) {
  if (!value) return '—';
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '—';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  } catch {
    return '—';
  }
}
