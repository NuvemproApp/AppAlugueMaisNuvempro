const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { removeAllWebhooks, createNuvemshopClient } = require('../config/nuvemshop');
const { RENTAL_STATUS, ACTIVE_STATUSES } = require('../lib/rentalStatus');

const router = express.Router();

/**
 * Valida o HMAC do webhook (header x-linkedstore-hmac-sha256 = HMAC-SHA256 do raw
 * body com o client_secret). Tolerante a encoding (hex ou base64) e timing-safe.
 * Retorna: true = confere | false = header presente mas NÃO confere | null = não
 * dá para verificar (sem secret/header/raw body — ex.: chamada manual/dev).
 *
 * IMPORTANTE: todo handler que muta dados deve exigir `checkHmac(req) === true`
 * (nunca apenas `!== false`) — `null` significa "não verificável", não "confie
 * mesmo assim". Tratar `null` como passável permite que qualquer requisição sem
 * o header de assinatura seja aceita como se fosse da Nuvemshop.
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
 * Webhooks da Nuvemshop. Configurados no Partner Portal (LGPD) ou registrados
 * dinamicamente via config/nuvemshop.js (app/uninstalled, order/created, order/cancelled).
 * Body: { store_id, event } (JSON). Responder 200 é obrigatório para a homologação.
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
  if (checkHmac(req) !== true) {
    console.warn('[nuvemshop] app/uninstalled sem HMAC válido — ignorado');
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
  // LGPD exige sempre 200 (homologação) — em HMAC não confirmado apenas logamos e
  // NÃO marcamos a desinstalação, evitando poluição por requisição forjada.
  const hmac = checkHmac(req);
  const storeId = req.body?.store_id;
  console.log(`[nuvemshop][LGPD] store/redact store_id=${storeId} hmac=${hmac}`);
  if (hmac === true) await markUninstalled(storeId);
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
 * Confirmado contra a API de pedidos em produção (GET /orders/:id): properties
 * vem como OBJETO plano { "Data do Evento": "2026-08-14" }, não como array de
 * { name, value } — mantém suporte a array defensivamente, caso outra versão
 * da API ou um contexto diferente (ex.: carrinho) retorne nesse formato.
 * Cobre pt-BR ("Data do Evento") e es-AR/es-MX ("Fecha del Evento").
 */
function extractEventDate(properties) {
  if (!properties) return null;

  if (Array.isArray(properties)) {
    const prop = properties.find(
      (p) => EVENT_DATE_LABELS.includes((p.name || '').trim())
    );
    return prop ? String(prop.value || '').trim() : null;
  }

  if (typeof properties === 'object') {
    for (const label of EVENT_DATE_LABELS) {
      if (properties[label] != null) return String(properties[label]).trim();
    }
  }

  return null;
}

/**
 * Busca o pedido completo na API da Nuvemshop.
 */
async function fetchNsOrder(store, orderId) {
  const client = createNuvemshopClient(store.nuvemshopId, store.accessToken);
  const { data } = await client.get(`/orders/${orderId}`, { timeout: 15000 });
  return data;
}

/**
 * Soma a quantidade de aluguéis ativos (agendado/enviado) de um produto cujo
 * intervalo de reserva sobrepõe [reservationStart, reservationEnd].
 */
async function sumOverlappingQuantity(storeId, productId, reservationStart, reservationEnd) {
  const overlapping = await prisma.rental.findMany({
    where: {
      storeId,
      productId,
      status: { in: ACTIVE_STATUSES },
      reservationStart: { lte: reservationEnd },
      reservationEnd: { gte: reservationStart },
    },
    select: { quantity: true },
  });
  return overlapping.reduce((sum, r) => sum + (r.quantity || 0), 0);
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

  // 2. Pedido completo via API NS (inclui products[].properties e status atual do pedido)
  const order = await fetchNsOrder(store, orderId);
  if (!order || !Array.isArray(order.products) || !order.products.length) {
    console.log(`[order/created] pedido ${orderId} vazio ou inválido — ignorado`);
    return;
  }

  // Se por essa altura o pedido já está cancelado (ex.: order/cancelled processado
  // antes deste webhook, ou cancelamento automático quase imediato), registra o
  // aluguel direto como cancelado em vez de agendado — evita a corrida onde
  // orders/cancelled não encontra nada pra cancelar porque o Rental ainda não existia.
  const initialStatus = order.cancelled_at ? RENTAL_STATUS.CANCELADO : RENTAL_STATUS.AGENDADO;

  // 3. Produtos alugáveis da loja (uma única query, já com o estoque configurado)
  const rentables = await prisma.rentableProduct.findMany({
    where: { storeId: store.id, status: 1 },
    select: { productId: true, diasAntes: true, diasDepois: true, estoque: true },
  });
  if (!rentables.length) return;

  const rentableMap = new Map(rentables.map((r) => [r.productId, r]));

  // 4. Para cada produto do pedido, registra o aluguel se for alugável.
  // Usa o índice do item como parte da identidade do aluguel (junto ao id da NS,
  // se existir) — dois itens do mesmo produto no mesmo pedido não colidem mais.
  for (let index = 0; index < order.products.length; index++) {
    const item = order.products[index];
    const productId = String(item.product_id);
    const rentable = rentableMap.get(productId);
    if (!rentable) continue;

    const lineItemId = String(item.id ?? index);

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
    // A API de pedidos retorna quantity como string (ex: "3") — sem o parseInt,
    // a soma de estoque faz concatenação em vez de aritmética, e o Prisma
    // rejeita a string num campo Int no create.
    const quantity = parseInt(item.quantity, 10) || 1;

    // Checagem de capacidade: não bloqueia a criação (o pedido já foi pago), mas
    // deixa um alerta visível nos logs quando o total sobreposto excede o estoque
    // configurado — decisão de negócio de como agir fica com o lojista por ora.
    if (initialStatus !== RENTAL_STATUS.CANCELADO) {
      const alreadyBooked = await sumOverlappingQuantity(store.id, productId, reservationStart, reservationEnd);
      if (alreadyBooked + quantity > rentable.estoque) {
        console.warn(
          `[order/created] ESTOQUE EXCEDIDO produto ${productId} pedido ${orderId}: ` +
          `${alreadyBooked + quantity} reservado(s) sobrepondo o período, estoque configurado=${rentable.estoque}`
        );
      }
    }

    // Upsert idempotente: reenvio de webhook não cria duplicata
    await prisma.rental.upsert({
      where: {
        storeId_orderId_productId_lineItemId: {
          storeId: store.id,
          orderId: String(orderId),
          productId,
          lineItemId,
        },
      },
      update: {}, // já existe → não sobrescreve (webhook retentado)
      create: {
        storeId:        store.id,
        productId,
        orderId:        String(orderId),
        lineItemId,
        orderNumber:    order.number   || 0,
        status:         initialStatus,
        quantity,
        eventDate,
        reservationStart,
        reservationEnd,
        // Confirmado contra a API em produção: o pedido não tem campo "customer" —
        // o nome do cliente vem em contact_name (fallback billing_name / endereço).
        customerName:   order.contact_name || order.billing_name || order.shipping_address?.name || null,
        orderCreatedAt: order.created_at ? new Date(order.created_at) : new Date(),
      },
    });

    console.log(
      `[order/created] aluguel registrado ` +
      `store=${store.id} order=${orderId} product=${productId} item=${lineItemId} ` +
      `status=${initialStatus} evento=${rawDate} reserva=[${reservationStart.toISOString().slice(0, 10)},${reservationEnd.toISOString().slice(0, 10)}]`
    );
  }
}

/**
 * POST /webhooks/orders/created — novo pedido na loja.
 * Percorre os produtos e registra aluguéis para os alugáveis.
 * Sempre responde 200: a NS não deve retentar por falhas internas.
 */
router.post('/orders/created', async (req, res) => {
  if (checkHmac(req) !== true) {
    console.warn('[nuvemshop] orders/created sem HMAC válido — ignorado');
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
 * agendados ou enviados — nunca mexe em aluguéis já devolvidos, que já
 * concluíram seu ciclo antes do cancelamento chegar.
 * Sempre responde 200: a NS não deve retentar por falhas internas.
 */
router.post('/orders/cancelled', async (req, res) => {
  if (checkHmac(req) !== true) {
    console.warn('[nuvemshop] orders/cancelled sem HMAC válido — ignorado');
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
        where: { storeId: store.id, orderId: String(orderId), status: { in: ACTIVE_STATUSES } },
        data: { status: RENTAL_STATUS.CANCELADO },
      });
      console.log(`[order/cancelled] ${count} aluguel(éis) cancelado(s) store=${store.id} order=${orderId}`);
    }
  } catch (err) {
    console.error(`[order/cancelled] erro store_ns=${storeNsId} order=${orderId}:`, err.message);
  }

  res.status(200).json({ success: true });
});

module.exports = router;
