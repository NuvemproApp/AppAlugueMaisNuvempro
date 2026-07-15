const express = require('express');
const prisma = require('../lib/prisma');

const router = express.Router();

// ─── CORS aberto: chamado do domínio do lojista (vitrine Nuvemshop) ───────────
router.use(function (req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
router.options('*', function (_req, res) { res.sendStatus(204); });

// ─── Cache em memória para lookup de loja (evita hit no DB a cada request) ────
var _storeCache = {};
var STORE_CACHE_TTL = 120000; // 2 minutos

async function findStore(nuvemshopId) {
  var now = Date.now();
  var hit = _storeCache[nuvemshopId];
  if (hit && now - hit.ts < STORE_CACHE_TTL) return hit.store;

  var store = await prisma.store.findUnique({
    where: { nuvemshopId: String(nuvemshopId) },
    select: { id: true },
  });

  _storeCache[nuvemshopId] = { store: store, ts: now };
  return store;
}

// ─── GET /storefront/:storeId/rentable-ids ─────────────────────────────────────
// Retorna IDs Nuvemshop de todos os produtos alugáveis ativos da loja.
// Chamado uma vez por carregamento de página — cacheia na CDN por 30 s.
router.get('/:storeId/rentable-ids', async function (req, res) {
  try {
    var store = await findStore(req.params.storeId);
    if (!store) return res.json({ ids: [] });

    var products = await prisma.rentableProduct.findMany({
      where: { storeId: store.id, status: 1 },
      select: { productId: true },
    });

    var ids = products
      .map(function (p) { return parseInt(p.productId, 10); })
      .filter(Boolean);

    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json({ ids: ids });
  } catch (err) {
    console.error('[storefront] rentable-ids:', err.message);
    res.json({ ids: [] });
  }
});

// ─── GET /storefront/:storeId/products/:productId/config ───────────────────────
// Retorna a configuração do produto alugável (diasAntes, diasDepois, estoque).
router.get('/:storeId/products/:productId/config', async function (req, res) {
  try {
    var store = await findStore(req.params.storeId);
    if (!store) return res.json({ enabled: false });

    var product = await prisma.rentableProduct.findUnique({
      where: {
        storeId_productId: {
          storeId: store.id,
          productId: String(req.params.productId),
        },
      },
    });

    if (!product || product.status !== 1) return res.json({ enabled: false });

    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json({
      enabled: true,
      diasAntes: product.diasAntes,
      diasDepois: product.diasDepois,
      estoque: product.estoque,
    });
  } catch (err) {
    console.error('[storefront] config:', err.message);
    res.json({ enabled: false });
  }
});

// ─── GET /storefront/:storeId/products/:productId/availability ──────────────────
// Params: ?from=YYYY-MM-DD&to=YYYY-MM-DD&qty=N
// Verifica disponibilidade considerando o intervalo [from, to] e estoque.
// Quando o modelo de Aluguéis for implementado, subtrai os bookings do período.
router.get('/:storeId/products/:productId/availability', async function (req, res) {
  try {
    var store = await findStore(req.params.storeId);
    if (!store) return res.json({ available: false, remaining: 0, booked: 0 });

    var product = await prisma.rentableProduct.findUnique({
      where: {
        storeId_productId: {
          storeId: store.id,
          productId: String(req.params.productId),
        },
      },
    });

    if (!product || product.status !== 1) {
      return res.json({ available: false, remaining: 0, booked: 0 });
    }

    var qty = Math.max(1, parseInt(req.query.qty, 10) || 1);

    // Calcula o pico de aluguel concurrent no intervalo [from, to].
    // Mesmo algoritmo do C# (iteração dia a dia):
    //   para cada dia do intervalo, soma as quantidades dos aluguéis que o cobrem.
    //   booked = máximo diário → determina o estoque disponível no período.
    // Status considerados como ocupados: 1=agendado, 2=enviado.
    var fromDate = req.query.from ? new Date(req.query.from + 'T00:00:00') : null;
    var toDate   = req.query.to   ? new Date(req.query.to   + 'T23:59:59') : null;

    var booked = 0;

    if (fromDate && toDate && !isNaN(fromDate) && !isNaN(toDate)) {
      var overlapping = await prisma.rental.findMany({
        where: {
          storeId:          store.id,
          productId:        String(req.params.productId),
          status:           { in: [1, 2] },
          reservationStart: { lte: toDate },
          reservationEnd:   { gte: fromDate },
        },
        select: { quantity: true, reservationStart: true, reservationEnd: true },
      });

      if (overlapping.length > 0) {
        var MS_PER_DAY = 86400000;
        var fromMs = fromDate.getTime();
        var toMs   = toDate.getTime();

        for (var dayMs = fromMs; dayMs <= toMs; dayMs += MS_PER_DAY) {
          var dayBooked = 0;
          for (var ri = 0; ri < overlapping.length; ri++) {
            var r = overlapping[ri];
            if (r.reservationStart.getTime() <= dayMs && dayMs <= r.reservationEnd.getTime()) {
              dayBooked += r.quantity;
            }
          }
          if (dayBooked > booked) booked = dayBooked;
        }
      }
    }

    var remaining = Math.max(0, product.estoque - booked);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      available: remaining >= qty,
      remaining: remaining,
      booked:    booked,
    });
  } catch (err) {
    console.error('[storefront] availability:', err.message);
    res.json({ available: false, remaining: 0, booked: 0 });
  }
});

module.exports = router;
