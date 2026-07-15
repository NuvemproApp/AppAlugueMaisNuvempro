const express = require('express');
const axios = require('axios');
const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── Helper: busca produtos da Nuvemshop (paginado) ──────────────────────────
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

// ─── Helper: extrai nome e imagem de um produto NS ───────────────────────────
function extractNameImage(nsProduct) {
  const name = nsProduct?.name
    ? (nsProduct.name.pt || nsProduct.name.es || Object.values(nsProduct.name)[0] || '')
    : '';
  const image = nsProduct?.images?.[0]?.src || null;
  return { name, image };
}

// ─── GET /api/products ── lista produtos alugáveis (sem chamada externa) ─────
router.get('/', async (req, res, next) => {
  try {
    const products = await prisma.rentableProduct.findMany({
      where: { storeId: req.store.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ products });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/products/nuvemshop ── produtos NS disponíveis para adicionar ───
// Chamado apenas na abertura do modal de criação.
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
      .map((p) => {
        const { name, image } = extractNameImage(p);
        return { id: String(p.id), name: name || String(p.id), image };
      });

    res.json({ products: available });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/products ── cadastra produto alugável ─────────────────────────
// Busca nome+imagem da Nuvemshop uma única vez e salva no registro.
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

    // Busca nome e imagem da Nuvemshop para cache local
    let nuvemshopName = null;
    let nuvemshopImage = null;
    try {
      const { data } = await axios.get(
        `https://api.tiendanube.com/v1/${req.store.nuvemshopId}/products/${productId}`,
        {
          params: { fields: 'id,name,images' },
          headers: {
            Authentication: `bearer ${req.store.accessToken}`,
            'User-Agent': `AlugueMais (${process.env.APP_EMAIL || 'contato@aluguemais.nuvempro.com'})`,
          },
          timeout: 8000,
        }
      );
      const extracted = extractNameImage(data);
      nuvemshopName = extracted.name || null;
      nuvemshopImage = extracted.image || null;
    } catch (_) {
      // Se a API falhar, salva sem cache — será exibido o productId como fallback
    }

    const product = await prisma.rentableProduct.create({
      data: {
        storeId: req.store.id,
        productId: String(productId),
        nuvemshopName,
        nuvemshopImage,
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

// ─── PATCH /api/products/:id ── atualiza campos editáveis ────────────────────
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
