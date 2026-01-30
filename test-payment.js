#!/usr/bin/env node

/**
 * Script de teste da integração com a API de pagamento
 * Execute: node test-payment.js
 */

// Se estiver testando localmente, certifique-se que as variáveis estão definidas:
// $env:ALLOWPAY_USERNAME = "seu_usuario"
// $env:ALLOWPAY_PASSWORD = "sua_senha"
// $env:ALLOWPAY_POSTBACK_URL = "https://seu-dominio.com/api/freepay/webhook"

const API_URL = process.env.API_URL || "https://popcnh.vercel.app/api/payment/payment.php";
const API_KEY = process.env.ALLOWPAY_USERNAME && process.env.ALLOWPAY_PASSWORD;

const testData = {
  cpf: "07317831905",
  nome: "JUAN PABLO MARCONI",
  email: "sashidoblack@gmail.com",
  phone: "(44) 92802-8281",
  amount: "64.73",
  title: "Taxa de Adesão",
  shipping: {
    street: "Rua Exemplo",
    streetNumber: "100",
    neighborhood: "Centro",
    zipCode: "01001000",
    city: "São Paulo",
    state: "SP",
    complement: "",
  },
};

async function testPaymentAPI() {
  console.log("🧪 Iniciando teste da API de pagamento...\n");
  console.log(`📍 URL: ${API_URL}\n`);
  
  if (API_KEY) {
    console.log("✅ Variáveis de ambiente encontradas (testando localmente)\n");
  } else {
    console.log("⚠️  Testando contra URL do Vercel\n");
  }
  
  console.log("📝 Payload:");
  console.log(JSON.stringify(testData, null, 2));
  console.log("\n---\n");

  try {
    console.log("⏳ Enviando requisição...");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testData),
    });

    const data = await response.json();

    console.log(`\n✓ Status: ${response.status}\n`);

    if (response.ok && data.success) {
      console.log("✅ SUCESSO!\n");
      console.log("📊 Resposta:");
      console.log(JSON.stringify(data, null, 2));
      console.log("\n✨ Dados para gerar QR Code:");
      console.log(`   Transaction ID: ${data.transaction_id}`);
      console.log(`   PIX Code: ${data.pix_code}`);
      console.log(`   Valor: R$ ${(data.amount / 100).toFixed(2)}`);
      console.log(`   Status: ${data.status}`);
    } else {
      console.log("❌ ERRO NA REQUISIÇÃO\n");
      console.log("📊 Resposta:");
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error("💥 ERRO:", error.message);
    console.error("\nDica: Verifique se:");
    console.error("  1. A URL está correta");
    console.error("  2. As variáveis de ambiente estão configuradas no Vercel");
    console.error("  3. O deploy foi feito com sucesso");
  }
}

testPaymentAPI();
