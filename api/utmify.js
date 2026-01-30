// api/utmify.js
// Função para enviar eventos de venda para a UTMify
// Requer a variável de ambiente UTMIFY_API_TOKEN

const fetch = require('node-fetch');

const UTMIFY_API_URL = 'https://api.utmify.com.br/api-credentials/orders';

async function sendUtmifyEvent({ order_id, status, name, email, phone, utm_source, utm_medium, utm_campaign, utm_term, utm_content }) {
  const token = process.env.UTMIFY_API_TOKEN;
  if (!token) throw new Error('UTMIFY_API_TOKEN não configurado');

  const payload = {
    order_id,
    status,
    name,
    email,
    phone,
  };
  if (utm_source) payload.utm_source = utm_source;
  if (utm_medium) payload.utm_medium = utm_medium;
  if (utm_campaign) payload.utm_campaign = utm_campaign;
  if (utm_term) payload.utm_term = utm_term;
  if (utm_content) payload.utm_content = utm_content;

  const res = await fetch(UTMIFY_API_URL, {
    method: 'POST',
    headers: {
      'x-api-token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erro ao enviar evento para UTMify: ${res.status} - ${text}`);
  }

  return await res.json();
}

module.exports = { sendUtmifyEvent };
