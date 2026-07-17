const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const prisma = require('../lib/prisma');
const { removeAllWebhooks } = require('../config/nuvemshop');

const router = express.Router();

/**
 * Valida o HMAC do webhook (header x-linkedstore-hmac-sha256 = HMAC-SHA256 do raw
 * body com o client_secret). Tolerante a encoding (hex ou base64) e timing-safe.
 * Retorna: true = confere | false = header presente mas NÃO confere | null = não
 * dá para verificar (sem secret/header/raw body — ex.: chamada manual/dev).
 */
function checkHmac(req) {
  const secret = process.env.NUVEMSHOP_CLIENT_SECRET;
  const header = req.headers['x-linkedstore-hmac-sha256'];
  if (!secret || !header || !req.rawBody) return null;
  const hex = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const b64 = crypto.createHmac('sha256', secret).update(req.rawBody).digest('base64');
  const safeEq = (a, b) => {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  };
  return safeEq(header, hex) || safeEq(header, b64);
}

/**
 * Webhooks da Nuvemshop. Configurados no Partner Portal apontando para estas URLs.
 * Body: { store_id, event } (JSON). Responder 200 é obrigatório para a homologação.
 *
 * HMAC (header x-linkedstore-hmac-sha256) é hardening futuro — exige raw body nesta
 * rota. Por ora processamos sem verificação estrita: as ações são não-destrutivas
 * (apenas sinalizam a desinstalação; a exclusão de dados é manual no admin).
 */

// Marca a data de desinstalação na loja. Idempotente: não sobrescreve data anterior.
// Também tenta (best-effort) remover as assinaturas de webhook da loja na Nuvemshop —
// se o token já tiver sido revogado nesse momento, falha silenciosamente.
async function markUninstalled(storeId) {
  if (!storeId) return;
  try {
    const store = await prisma.store.findFirst({
      where: { nuvemshopId: String(storeId), uninstalledAt: null },
    });
    if (!store) return;

    await prisma.store.update({
      where: { id: store.id },
      data: { uninstalledAt: new Date() },
    });

    try {
      await removeAllWebhooks(store);
    } catch (err) {
      console.error('[nuvemshop-webhook] removeAllWebhooks falhou (best-effort):', err.message);
    }
  } catch (err) {
    console.error('[nuvemshop-webhook] markUninstalled falhou:', err.message);
  }
}

/**
 * POST /webhooks/app/uninstalled — a loja desinstalou o app.
 */
router.post('/app/uninstalled', async (req, res) => {
  if (checkHmac(req) === false) {
    console.warn('[nuvemshop] app/uninstalled com HMAC invalido — ignorado');
    return res.status(401).json({ error: 'Invalid HMAC.' });
  }
  const storeId = req.body?.store_id;
  console.log(`[nuvemshop] app/uninstalled store_id=${storeId}`);
  await markUninstalled(storeId);
  res.status(200).json({ success: true });
});

/**
 * POST /webhooks/store/redact — LGPD: solicitação de exclusão ~48h após desinstalação.
 * Também marca a desinstalação (rede de segurança caso app/uninstalled não chegue).
 */
router.post('/store/redact', async (req, res) => {
  // LGPD exige sempre 200 (homologação) — em HMAC inválido apenas logamos e
  // NÃO marcamos a desinstalação, evitando poluição por requisição forjada.
  const hmac = checkHmac(req);
  const storeId = req.body?.store_id;
  console.log(`[nuvemshop][LGPD] store/redact store_id=${storeId} hmac=${hmac}`);
  if (hmac !== false) await markUninstalled(storeId);
  res.status(200).json({ success: true });
});

/**
 * POST /webhooks/customers/redact — LGPD (não armazenamos PII de clientes da loja).
 */
router.post('/customers/redact', (req, res) => {
  console.log(`[nuvemshop][LGPD] customers/redact store_id=${req.body?.store_id}`);
  res.status(200).json({ success: true });
});

/**
 * POST /webhooks/customers/data_request — LGPD (não armazenamos PII de clientes da loja).
 */
router.post('/customers/data_request', (req, res) => {
  console.log(`[nuvemshop][LGPD] customers/data_request store_id=${req.body?.store_id}`);
  res.status(200).json({ success: true, data: [] });
});

// ─── Rótulos da data do evento em todos os idiomas suportados ────────────────
const EVENT_DATE_LABELS = ['Data do Evento', 'Fecha del Evento'];

/**
 * Extrai a data do evento das propriedades de um produto do pedido.
 * A NS retorna properties como array de { name, value }.
 * Cobre pt-BR ("Data do Evento") e es-AR/es-MX ("Fecha del Evento").
 */
function extractEventDate(properties) {
  if (!Array.isArray(properties)) return null;
  const prop = properties.find(
    (p) => EVENT_DATE_LABELS.includes((p.name || '').trim())
  );
  return prop ? (prop.value || '').trim() : null;
}

/**
 * Busca o pedido completo na API da Nuvemshop.
 * Usamos api.tiendanube.com — funciona para BR e LATAM.
 */
async function fetchNsOrder(store, orderId) {
  const { data } = await axios.get(
    `https://api.tiendanube.com/v1/${store.nuvemshopId}/orders/${orderId}`,
    {
      headers: {
        Authentication: `bearer ${store.accessToken}`,
        'User-Agent': `AlugueMais (${process.env.APP_EMAIL || 'contato@aluguemais.nuvempro.com'})`,
      },
      timeout: 15000,
    }
  );
  return data;
}

/**
 * Processa um pedido recém-criado:
 *   - verifica quais produtos são alugáveis
 *   - extrai a data do evento de cada um
 *   - calcula o intervalo de reserva (eventDate ± diasAntes/diasDepois)
 *   - cria (ou ignora se já existir) o registro de aluguel
 *
 * Sempre retorna sem lançar — erros são logados, nunca propagados ao caller.
 */
async function processOrderCreated(storeNsId, orderId) {
  // 1. Loja deve existir e estar instalada
  const store = await prisma.store.findUnique({
    where: { nuvemshopId: String(storeNsId) },
    select: { id: true, nuvemshopId: true, accessToken: true, uninstalledAt: true },
  });
  if (!store || store.uninstalledAt) {
    console.log(`[order/created] loja ${storeNsId} não encontrada ou desinstalada — ignorado`);
    return;
  }

  // 2. Pedido completo via API NS (inclui products[].properties)
  const order = await fetchNsOrder(store, orderId);
  if (!order || !Array.isArray(order.products) || !order.products.length) {
    console.log(`[order/created] pedido ${orderId} vazio ou inválido — ignorado`);
    return;
  }

  // 3. Produtos alugáveis da loja (uma única query)
  const rentables = await prisma.rentableProduct.findMany({
    where: { storeId: store.id, status: 1 },
    select: { productId: true, diasAntes: true, diasDepois: true },
  });
  if (!rentables.length) return;

  const rentableMap = new Map(rentables.map((r) => [r.productId, r]));

  // 4. Para cada produto do pedido, registra o aluguel se for alugável
  for (const item of order.products) {
    const productId = String(item.product_id);
    const rentable = rentableMap.get(productId);
    if (!rentable) continue;

    // Extrai a data do evento (multi-idioma)
    const rawDate = extractEventDate(item.properties);
    if (!rawDate) {
      console.warn(
        `[order/created] produto ${productId} pedido ${orderId}: ` +
        `propriedade "Data do Evento" ausente nas properties`
      );
      continue;
    }

    // Parse robusto: aceita 'YYYY-MM-DD' e ISO completo
    const eventDate = new Date(rawDate.includes('T') ? rawDate : rawDate + 'T00:00:00');
    if (isNaN(eventDate.getTime())) {
      console.warn(`[order/created] data inválida "${rawDate}" produto ${productId} pedido ${orderId}`);
      continue;
    }

    const reservationStart = new Date(eventDate.getTime() - rentable.diasAntes  * 86400000);
    const reservationEnd   = new Date(eventDate.getTime() + rentable.diasDepois * 86400000);

    // Upsert idempotente: reenvio de webhook não cria duplicata
    await prisma.rental.upsert({
      where: {
        storeId_orderId_productId: {
          storeId: store.id,
          orderId: String(orderId),
          productId,
        },
      },
      update: {}, // já existe → não sobrescreve (webhook retentado)
      create: {
        storeId:        store.id,
        productId,
        orderId:        String(orderId),
        orderNumber:    order.number   || 0,
        status:         1,             // 1 = agendado
        quantity:       item.quantity  || 1,
        eventDate,
        reservationStart,
        reservationEnd,
        customerName:   order.customer?.name || null,
        orderCreatedAt: order.created_at ? new Date(order.created_at) : new Date(),
      },
    });

    console.log(
      `[order/created] aluguel registrado ` +
      `store=${store.id} order=${orderId} product=${productId} ` +
      `evento=${rawDate} reserva=[${reservationStart.toISOString().slice(0, 10)},${reservationEnd.toISOString().slice(0, 10)}]`
    );
  }
}

/**
 * POST /webhooks/orders/created — novo pedido na loja.
 * Percorre os produtos e registra aluguéis para os alugáveis.
 * Sempre responde 200: a NS não deve retentar por falhas internas.
 */
router.post('/orders/created', async (req, res) => {
  const hmac = checkHmac(req);
  if (hmac === false) {
    console.warn('[nuvemshop] orders/created com HMAC inválido — ignorado');
    return res.status(401).json({ error: 'Invalid HMAC.' });
  }

  const storeId = req.body?.store_id;
  const orderId = req.body?.id;

  if (!storeId || !orderId) {
    console.warn('[nuvemshop] orders/created payload inválido:', req.body);
    return res.status(200).json({ success: true });
  }

  console.log(`[nuvemshop] orders/created store_id=${storeId} order_id=${orderId}`);

  try {
    await processOrderCreated(storeId, orderId);
  } catch (err) {
    console.error(`[order/created] erro store=${storeId} order=${orderId}:`, err.message);
  }

  res.status(200).json({ success: true });
});

/**
 * POST /webhooks/orders/cancelled — pedido cancelado na Nuvemshop.
 * Cancela automaticamente os aluguéis desse pedido que ainda estejam
 * agendados (1) ou enviados (2) — nunca mexe em aluguéis já devolvidos (3),
 * que já concluíram seu ciclo antes do cancelamento chegar.
 * Sempre responde 200: a NS não deve retentar por falhas internas.
 */
router.post('/orders/cancelled', async (req, res) => {
  const hmac = checkHmac(req);
  if (hmac === false) {
    console.warn('[nuvemshop] orders/cancelled com HMAC inválido — ignorado');
    return res.status(401).json({ error: 'Invalid HMAC.' });
  }

  const storeNsId = req.body?.store_id;
  const orderId = req.body?.id;

  if (!storeNsId || !orderId) {
    console.warn('[nuvemshop] orders/cancelled payload inválido:', req.body);
    return res.status(200).json({ success: true });
  }

  console.log(`[nuvemshop] orders/cancelled store_id=${storeNsId} order_id=${orderId}`);

  try {
    const store = await prisma.store.findUnique({
      where: { nuvemshopId: String(storeNsId) },
      select: { id: true },
    });

    if (store) {
      const { count } = await prisma.rental.updateMany({
        where: { storeId: store.id, orderId: String(orderId), status: { in: [1, 2] } },
        data: { status: 0 }, // 0 = cancelado
      });
      console.log(`[order/cancelled] ${count} aluguel(éis) cancelado(s) store=${store.id} order=${orderId}`);
    }
  } catch (err) {
    console.error(`[order/cancelled] erro store_ns=${storeNsId} order=${orderId}:`, err.message);
  }

  res.status(200).json({ success: true });
});

module.exports = router;
