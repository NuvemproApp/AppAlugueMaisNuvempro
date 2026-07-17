const express = require('express');
const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const CRITERIO_FIELD = {
  1: 'orderCreatedAt',
  2: 'reservationStart',
  3: 'reservationEnd',
};

const STATUS_VALUES = [0, 1, 2, 3];

// ─── GET /api/rentals ── lista aluguéis da loja para o board Kanban ──────────
router.get('/', async (req, res, next) => {
  try {
    const criterio = CRITERIO_FIELD[Number(req.query.criterio)] ? Number(req.query.criterio) : 1;
    const field = CRITERIO_FIELD[criterio];

    const dataFinal = req.query.dataFinal ? new Date(`${req.query.dataFinal}T23:59:59`) : new Date();
    const dataInicial = req.query.dataInicial
      ? new Date(`${req.query.dataInicial}T00:00:00`)
      : new Date(dataFinal.getTime() - 7 * 86400000);

    const [rentals, rentableProducts] = await Promise.all([
      prisma.rental.findMany({
        where: {
          storeId: req.store.id,
          [field]: { gte: dataInicial, lte: dataFinal },
        },
        orderBy: { [field]: 'asc' },
      }),
      prisma.rentableProduct.findMany({
        where: { storeId: req.store.id },
        select: { productId: true, nuvemshopName: true },
      }),
    ]);

    const nameMap = new Map(rentableProducts.map((p) => [p.productId, p.nuvemshopName]));

    const enriched = rentals.map((r) => ({
      ...r,
      productName: nameMap.get(r.productId) || r.productId,
    }));

    res.json({ rentals: enriched, criterio, dataInicial, dataFinal });
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

    const existing = await prisma.rental.findFirst({
      where: { id: Number(id), storeId: req.store.id },
    });
    if (!existing) {
      throw new AppError('Aluguel não encontrado.', 404, 'NOT_FOUND');
    }

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
