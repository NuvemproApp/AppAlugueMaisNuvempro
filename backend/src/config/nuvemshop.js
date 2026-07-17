const axios = require('axios');

const NUVEMSHOP_AUTH_URL = 'https://www.tiendanube.com/apps/authorize/token';
const NUVEMSHOP_API_BASE = 'https://api.tiendanube.com/v1';

/**
 * Exchange authorization code for access token via Nuvemshop OAuth.
 */
async function exchangeCodeForToken(code) {
  const response = await axios.post(NUVEMSHOP_AUTH_URL, {
    client_id: process.env.NUVEMSHOP_CLIENT_ID,
    client_secret: process.env.NUVEMSHOP_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
  });

  return {
    accessToken: response.data.access_token,
    userId: String(response.data.user_id),
    tokenType: response.data.token_type,
  };
}

/**
 * Create an authenticated Nuvemshop API client for a specific store.
 * Uses "Authentication" header as required by Nuvemshop API.
 */
function createNuvemshopClient(storeNuvemshopId, accessToken) {
  const client = axios.create({
    baseURL: `${NUVEMSHOP_API_BASE}/${storeNuvemshopId}`,
    headers: {
      'Authentication': `bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': `${process.env.APP_NAME || 'NuvemProApp'} (${process.env.APP_EMAIL || 'contato@app.com'})`,
    },
    timeout: 15000,
  });

  return client;
}

/**
 * Fetch store info from Nuvemshop API.
 */
async function fetchStoreInfo(storeNuvemshopId, accessToken) {
  const client = createNuvemshopClient(storeNuvemshopId, accessToken);
  const response = await client.get('/store');
  return response.data;
}

// Mapeia o nome do evento (lado Nuvemshop) para o path da nossa rota em nuvemshopWebhooks.js.
// Os eventos de pedido são singulares na API da Nuvemshop, mas nossas rotas Express usam plural.
//
// NÃO incluir aqui store/redact, customers/redact, customers/data_request: esses 3 webhooks
// de LGPD são configurados estaticamente na aba "LGPD" do Partner Portal (uma vez por app,
// aplicado a todas as lojas automaticamente) — registrá-los também por aqui duplicaria a
// entrega do webhook. app/uninstalled e os eventos de pedido não têm campo equivalente na
// Portal, então continuam exigindo registro dinâmico por loja.
const WEBHOOK_EVENT_PATHS = {
  'app/uninstalled': 'app/uninstalled',
  'order/created': 'orders/created',
  'order/cancelled': 'orders/cancelled',
};

/**
 * URL pública do backend para receber webhooks. Railway injeta RAILWAY_PUBLIC_DOMAIN
 * automaticamente em qualquer serviço com domínio público — sem precisar configurar nada
 * manualmente. BACKEND_URL é um override opcional (ex: domínio customizado futuro).
 * Retorna null em dev local (Nuvemshop não alcança localhost, então não há o que registrar).
 */
function getBackendPublicUrl() {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return null;
}

/**
 * Garante que a loja tenha assinatura de todos os webhooks que este app processa.
 * Idempotente: consulta as assinaturas existentes e só cria as que faltam. Se um evento já
 * estiver assinado com uma URL diferente da esperada, apenas loga um aviso (não sobrescreve).
 */
async function registerWebhooks(store) {
  const baseUrl = getBackendPublicUrl();
  if (!baseUrl) return;

  const client = createNuvemshopClient(store.nuvemshopId, store.accessToken);
  const { data: existing } = await client.get('/webhooks');
  const byEvent = new Map((existing || []).map((w) => [w.event, w]));

  for (const [event, path] of Object.entries(WEBHOOK_EVENT_PATHS)) {
    const url = `${baseUrl}/webhooks/${path}`;
    const current = byEvent.get(event);
    if (!current) {
      await client.post('/webhooks', { event, url });
    } else if (current.url !== url) {
      console.warn(`[nuvemshop-webhooks] evento ${event} já registrado com URL diferente: ${current.url} (esperado: ${url})`);
    }
  }
}

/**
 * Remove todas as assinaturas de webhook da loja (best-effort, chamado no app/uninstalled).
 * Nunca lança — se o token já tiver sido revogado pela Nuvemshop, falha silenciosamente.
 */
async function removeAllWebhooks(store) {
  const client = createNuvemshopClient(store.nuvemshopId, store.accessToken);
  const { data: existing } = await client.get('/webhooks');
  await Promise.allSettled((existing || []).map((w) => client.delete(`/webhooks/${w.id}`)));
}

module.exports = {
  exchangeCodeForToken,
  createNuvemshopClient,
  fetchStoreInfo,
  registerWebhooks,
  removeAllWebhooks,
  NUVEMSHOP_AUTH_URL,
  NUVEMSHOP_API_BASE,
};
