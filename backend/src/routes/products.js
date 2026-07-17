const express = require('express');
const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { createNuvemshopClient } = require('../config/nuvemshop');
const { ACTIVE_STATUSES } = require('../lib/rentalStatus');

const router = express.Router();
router.use(requireAuth);

// ─── Helper: busca produtos da Nuvemshop (paginado) ──────────────────────────
async function fetchNuvemshopProducts(store) {
  const client = createNuvemshopClient(store.nuvemshopId, store.accessToken);
  const products = [];
  let page = 1;

  while (true) {
    const { data } = await client.get('/products', {
      params: { per_page: 200, page, fields: 'id,name,images' },
      timeout: 10000,
    });

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

// ─── Helper: busca produto alugável da própria loja ou lança 404 ─────────────
async function findOwnedProduct(id, storeId) {
  const product = await prisma.rentableProduct.findFirst({
    where: { id: Number(id), storeId },
  });
  if (!product) {
    throw new AppError('Produto não encontrado.', 404, 'NOT_FOUND');
  }
  return product;
}

// ─── Helper: valida os campos numéricos de um produto alugável ───────────────
function validateProductFields({ status, diasAntes, diasDepois, estoque }) {
  const errors = [];
  const checkNonNegativeInt = (label, value) => {
    if (value === undefined) return;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) errors.push(`${label} deve ser um número inteiro não-negativo.`);
  };

  if (status !== undefined && ![0, 1].includes(Number(status))) {
    errors.push('status deve ser 0 (inativo) ou 1 (ativo).');
  }
  checkNonNegativeInt('diasAntes', diasAntes);
  checkNonNegativeInt('diasDepois', diasDepois);
  checkNonNegativeInt('estoque', estoque);

  return errors;
}

const PRODUCTS_MAX_PAGE_SIZE = 100;
const PRODUCTS_DEFAULT_PAGE_SIZE = 20;

// Colunas ordenáveis — nuvemshopName/status/estoque/createdAt são colunas reais
// de RentableProduct; qtdeAlugada é um agregado calculado (soma de aluguéis
// ativos), sem coluna própria. A quantidade de produtos alugáveis por loja é
// pequena e limitada (não cresce por pedido, ao contrário dos aluguéis) — dá
// pra buscar tudo e ordenar/paginar em memória com segurança, sem precisar de
// SQL bruto pra ordenar por um valor calculado.
const PRODUCT_SORTABLE_FIELDS = ['nuvemshopName', 'status', 'estoque', 'qtdeAlugada', 'createdAt'];

// ─── GET /api/products ── lista produtos alugáveis (sem chamada externa) ─────
router.get('/', async (req, res, next) => {
  try {
    const [products, rentalAggs] = await Promise.all([
      prisma.rentableProduct.findMany({ where: { storeId: req.store.id } }),
      prisma.rental.groupBy({
        by: ['productId'],
        where: { storeId: req.store.id, status: { in: ACTIVE_STATUSES } },
        _sum: { quantity: true },
      }),
    ]);

    const rentalMap = new Map(rentalAggs.map((r) => [r.productId, r._sum.quantity || 0]));
    let all = products.map((p) => ({ ...p, qtdeAlugada: rentalMap.get(p.productId) || 0 }));

    const search = String(req.query.search || '').trim().toLowerCase();
    if (search) {
      all = all.filter((p) => (p.nuvemshopName || p.productId || '').toLowerCase().includes(search));
    }

    const sortBy = PRODUCT_SORTABLE_FIELDS.includes(req.query.sortBy) ? req.query.sortBy : 'createdAt';
    const sortMul = req.query.sortDir === 'desc' ? -1 : 1;
    all.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av instanceof Date || bv instanceof Date) {
        return sortMul * (new Date(av).getTime() - new Date(bv).getTime());
      }
      if (typeof av === 'string' || typeof bv === 'string') {
        return sortMul * String(av || '').localeCompare(String(bv || ''));
      }
      return sortMul * ((av || 0) - (bv || 0));
    });

    const total = all.length;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(PRODUCTS_MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize, 10) || PRODUCTS_DEFAULT_PAGE_SIZE));
    const pageItems = all.slice((page - 1) * pageSize, page * pageSize);

    res.json({
      products: pageItems,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    });
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

    const validationErrors = validateProductFields({ status, diasAntes, diasDepois, estoque });
    if (validationErrors.length) {
      throw new AppError(validationErrors.join(' '), 400, 'INVALID_FIELDS');
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
      const client = createNuvemshopClient(req.store.nuvemshopId, req.store.accessToken);
      const { data } = await client.get(`/products/${productId}`, {
        params: { fields: 'id,name,images' },
        timeout: 8000,
      });
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

    const validationErrors = validateProductFields({ status, diasAntes, diasDepois, estoque });
    if (validationErrors.length) {
      throw new AppError(validationErrors.join(' '), 400, 'INVALID_FIELDS');
    }

    await findOwnedProduct(id, req.store.id);

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

    await findOwnedProduct(id, req.store.id);

    await prisma.rentableProduct.delete({ where: { id: Number(id) } });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
