// Espelha backend/src/lib/rentalStatus.js — mantém os dois em sincronia se o enum mudar.
export const RENTAL_STATUS_META = [
  { status: 0, labelKey: 'rentals.columnCancelado', appearance: 'danger' },
  { status: 1, labelKey: 'rentals.columnAgendado', appearance: 'warning' },
  { status: 2, labelKey: 'rentals.columnEnviado', appearance: 'success' },
  { status: 3, labelKey: 'rentals.columnDevolvido', appearance: 'neutral' },
];

export const RENTAL_STATUS_MAP = new Map(RENTAL_STATUS_META.map((s) => [s.status, s]));
