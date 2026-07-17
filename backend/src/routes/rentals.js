const express = require('express');
const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { RENTAL_STATUS } = require('../lib/rentalStatus');

const router = express.Router();
router.use(requireAuth);

const CRITERIO_FIELD = {
  1: 'orderCreatedAt',
  2: 'reservationStart',
  3: 'reservationEnd',
};

const STATUS_VALUES = Object.values(RENTAL_STATUS);
const MAX_RANGE_MS = 2 * 365 * 86400000; // 2 anos — teto de segurança pro board Kanban

// ─── Helper: busca aluguel da própria loja ou lança 404 ──────────────────────
async function findOwnedRental(id, storeId) {
  const rental = await prisma.rental.findFirst({
    where: { id: Number(id), storeId },
  });
  if (!rental) {
    throw new AppError('Aluguel não encontrado.', 404, 'NOT_FOUND');
  }
  return rental;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

function enrichRental(rental, productMap) {
  const product = productMap.get(rental.productId);
  return {
    ...rental,
    productName: product?.nuvemshopName || rental.productId,
    productImage: product?.nuvemshopImage || null,
  };
}

// ─── GET /api/rentals ──────────────────────────────────────────────────────
// Dois modos, mesmo endpoint:
//   - Board Kanban (sem page/pageSize): filtro de intervalo de data como antes,
//     sem paginação — o board já é naturalmente limitado pelo próprio filtro.
//   - Lista (com page/pageSize): sem filtro de data — mostra TODOS os aluguéis
//     da loja (o board Kanban não deve ser o único lugar onde um aluguel
//     "existe"; uma data fora da janela padrão não pode ficar invisível),
//     paginado, com busca por nome do produto feita no servidor.
router.get('/', async (req, res, next) => {
  try {
    const criterio = CRITERIO_FIELD[Number(req.query.criterio)] ? Number(req.query.criterio) : 1;
    const field = CRITERIO_FIELD[criterio];
    const paginated = req.query.page != null || req.query.pageSize != null;

    const rentableProducts = await prisma.rentableProduct.findMany({
      where: { storeId: req.store.id },
      select: { productId: true, nuvemshopName: true, nuvemshopImage: true },
    });
    const productMap = new Map(rentableProducts.map((p) => [p.productId, p]));

    const where = { storeId: req.store.id };

    if (paginated) {
      const search = String(req.query.search || '').trim().toLowerCase();
      if (search) {
        const matchingIds = rentableProducts
          .filter((p) => (p.nuvemshopName || '').toLowerCase().includes(search))
          .map((p) => p.productId);
        // Nenhum produto bate com a busca — força um where que não retorna nada,
        // em vez de mandar um IN vazio (Prisma trataria como "sem filtro").
        where.productId = { in: matchingIds.length ? matchingIds : ['__nenhum__'] };
      }

      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE));

      const [total, rentals] = await Promise.all([
        prisma.rental.count({ where }),
        prisma.rental.findMany({
          where,
          orderBy: { [field]: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return res.json({
        rentals: rentals.map((r) => enrichRental(r, productMap)),
        total,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
        criterio,
      });
    }

    // Modo board (Kanban): comportamento original, intacto.
    const dataFinal = req.query.dataFinal ? new Date(`${req.query.dataFinal}T23:59:59`) : new Date();
    let dataInicial = req.query.dataInicial
      ? new Date(`${req.query.dataInicial}T00:00:00`)
      : new Date(dataFinal.getTime() - 7 * 86400000);

    // Teto de segurança: um intervalo maior que isso não faz sentido pro board e
    // arrisca devolver dezenas de milhares de linhas de uma vez.
    if (dataFinal.getTime() - dataInicial.getTime() > MAX_RANGE_MS) {
      dataInicial = new Date(dataFinal.getTime() - MAX_RANGE_MS);
    }
    where[field] = { gte: dataInicial, lte: dataFinal };

    const rentals = await prisma.rental.findMany({ where, orderBy: { [field]: 'asc' } });

    res.json({
      rentals: rentals.map((r) => enrichRental(r, productMap)),
      criterio,
      dataInicial,
      dataFinal,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/rentals/:id/status ── atualiza status (drag-and-drop do board) ─
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const status = Number(req.body.status);

    if (!Number.isInteger(status) || !STATUS_VALUES.includes(status)) {
      throw new AppError('status inválido.', 400, 'INVALID_STATUS');
    }

    await findOwnedRental(id, req.store.id);

    const rental = await prisma.rental.update({
      where: { id: Number(id) },
      data: { status },
    });

    res.json({ rental });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
