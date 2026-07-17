const RENTAL_STATUS = {
  CANCELADO: 0,
  AGENDADO: 1,
  ENVIADO: 2,
  DEVOLVIDO: 3,
};

// Status que ocupam estoque/calendário — usado em toda checagem de disponibilidade
// e nos cancelamentos automáticos, pra não duplicar o array [1, 2] em cada arquivo.
const ACTIVE_STATUSES = [RENTAL_STATUS.AGENDADO, RENTAL_STATUS.ENVIADO];

module.exports = { RENTAL_STATUS, ACTIVE_STATUSES };
