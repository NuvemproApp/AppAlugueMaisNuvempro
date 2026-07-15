const express = require('express');
const axios = require('axios');
const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── Helper: busca todos os produtos da Nuvemshop (paginado) ─────────────────
async function fetchNuvemshopProducts(store) {
  const products = [];
  let page = 1;

  while (true) {
    const { data } = await axios.get(
      `https://api.tiendanube.com/v1/${store.nuvemshopId}/products`,
      {
        params: { per_page: 200, page, fields: 'id,name,images' },
        headers: {
          Authentication: `bearer ${store.accessToken}`,
          'User-Agent': `AlugueMais (${process.env.APP_EMAIL || 'contato@aluguemais.nuvempro.com'})`,
        },
        timeout: 10000,
      }
    );

    if (!data || data.length === 0) break;
    products.push(...data);
    if (data.length < 200) break;
    page++;
  }

  return products;
}

// ─── GET /api/products ── lista produtos alugáveis com dados enriquecidos ────
router.get('/', async (req, res, next) => {
  try {
    const rentable = await prisma.rentableProduct.findMany({
      where: { storeId: req.store.id },
      orderBy: { createdAt: 'desc' },
    });

    if (rentable.length === 0) {
      return res.json({ products: [] });
    }

    // Busca dados da Nuvemshop para enriquecer a resposta
    let nsProducts = [];
    try {
      nsProducts = await fetchNuvemshopProducts(req.store);
    } catch (_) {
      // Se a API da Nuvemshop falhar, retorna sem enriquecimento
    }

    const nsMap = {};
    nsProducts.forEach((p) => { nsMap[String(p.id)] = p; });

    const enriched = rentable.map((r) => {
      const ns = nsMap[r.productId] || null;
      const name = ns?.name
        ? (ns.name.pt || ns.name.es || Object.values(ns.name)[0] || r.productId)
        : r.productId;
      const image = ns?.images?.[0]?.src || null;
      return { ...r, nuvemshopName: name, nuvemshopImage: image };
    });

    res.json({ products: enriched });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/products/nuvemshop ── produtos NS disponíveis (não alugáveis) ─
router.get('/nuvemshop', async (req, res, next) => {
  try {
    const [nsProducts, rentable] = await Promise.all([
      fetchNuvemshopProducts(req.store),
      prisma.rentableProduct.findMany({
        where: { storeId: req.store.id },
        select: { productId: true },
      }),
    ]);

    const rentableIds = new Set(rentable.map((r) => r.productId));

    const available = nsProducts
      .filter((p) => !rentableIds.has(String(p.id)))
      .map((p) => ({
        id: String(p.id),
        name: p.name?.pt || p.name?.es || Object.values(p.name || {})[0] || String(p.id),
        image: p.images?.[0]?.src || null,
      }));

    res.json({ products: available });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/products ── cadastra produto alugável ─────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { productId, status = 1, diasAntes = 0, diasDepois = 0, estoque = 1 } = req.body;

    if (!productId) {
      throw new AppError('productId é obrigatório.', 400, 'MISSING_PRODUCT_ID');
    }

    const existing = await prisma.rentableProduct.findUnique({
      where: { storeId_productId: { storeId: req.store.id, productId: String(productId) } },
    });
    if (existing) {
      throw new AppError('Produto já cadastrado como alugável.', 409, 'PRODUCT_ALREADY_EXISTS');
    }

    const product = await prisma.rentableProduct.create({
      data: {
        storeId: req.store.id,
        productId: String(productId),
        status: Number(status),
        diasAntes: Number(diasAntes),
        diasDepois: Number(diasDepois),
        estoque: Number(estoque),
      },
    });

    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/products/:id ── atualiza produto alugável ────────────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, diasAntes, diasDepois, estoque } = req.body;

    const existing = await prisma.rentableProduct.findFirst({
      where: { id: Number(id), storeId: req.store.id },
    });
    if (!existing) {
      throw new AppError('Produto não encontrado.', 404, 'NOT_FOUND');
    }

    const updated = await prisma.rentableProduct.update({
      where: { id: Number(id) },
      data: {
        ...(status !== undefined && { status: Number(status) }),
        ...(diasAntes !== undefined && { diasAntes: Number(diasAntes) }),
        ...(diasDepois !== undefined && { diasDepois: Number(diasDepois) }),
        ...(estoque !== undefined && { estoque: Number(estoque) }),
      },
    });

    res.json({ product: updated });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/products/:id ── remove produto alugável ─────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.rentableProduct.findFirst({
      where: { id: Number(id), storeId: req.store.id },
    });
    if (!existing) {
      throw new AppError('Produto não encontrado.', 404, 'NOT_FOUND');
    }

    await prisma.rentableProduct.delete({ where: { id: Number(id) } });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
