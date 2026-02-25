/**
 * BROWNING SALES ENGINE — Zero-Cost Payment Backend
 *
 * Cloudflare Worker that handles the entire payment lifecycle:
 *   - PayPal Orders API v2 (one-time purchases + Pay Later)
 *   - PayPal Subscriptions API (custom installment plans)
 *   - Coinbase Commerce (crypto: BTC, ETH, USDC, etc.)
 *   - Webhook processing for both platforms
 *   - Product catalog from Supabase
 *   - Sales tracking and revenue analytics
 *   - Digital delivery (download links)
 *
 * Architecture:
 *   Storefront (CF Pages) → This Worker (API) → PayPal/Coinbase → Webhooks → Supabase
 *
 * Deploy: wrangler deploy -c wrangler-sales.toml
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_SECRET: string;
  PAYPAL_MODE: string;          // 'sandbox' | 'live'
  COINBASE_API_KEY: string;
  COINBASE_WEBHOOK_SECRET: string;
  STORE_URL: string;            // e.g., https://shop.browningdigital.com
  WEBHOOK_SECRET: string;       // verify PayPal webhooks
}

// ── Types ──

interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  tier: string;
  price: number;
  currency: string;
  pillar: string;
  format: string;
  status: string;
  landing_page_url: string;
  checkout_url: string;
  delivery_url: string;
  content: Record<string, any>;
  metadata: Record<string, any>;
}

interface CheckoutRequest {
  product_slug: string;
  payment_method: 'paypal' | 'coinbase' | 'installment';
  customer_email?: string;
  customer_name?: string;
  installment_count?: number; // 2, 3, or 4
}

// ── Main Router ──

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    try {
      // ── Product Catalog ──
      if (path === '/api/products' && request.method === 'GET') {
        return await handleListProducts(env);
      }
      if (path.startsWith('/api/product/') && request.method === 'GET') {
        const slug = path.split('/')[3];
        return await handleGetProduct(env, slug);
      }

      // ── Checkout ──
      if (path === '/api/checkout' && request.method === 'POST') {
        const body = await request.json() as CheckoutRequest;
        return await handleCheckout(env, body);
      }

      // ── PayPal: Capture after buyer approves ──
      if (path === '/api/paypal/capture' && request.method === 'POST') {
        const { order_id } = await request.json() as { order_id: string };
        return await handlePayPalCapture(env, order_id);
      }

      // ── Webhooks ──
      if (path === '/webhooks/paypal' && request.method === 'POST') {
        return await handlePayPalWebhook(request, env);
      }
      if (path === '/webhooks/coinbase' && request.method === 'POST') {
        return await handleCoinbaseWebhook(request, env);
      }

      // ── Delivery ──
      if (path.startsWith('/api/delivery/') && request.method === 'GET') {
        const saleId = path.split('/')[3];
        const token = url.searchParams.get('token');
        return await handleDelivery(env, saleId, token || '');
      }

      // ── Analytics ──
      if (path === '/api/stats' && request.method === 'GET') {
        return await handleStats(env);
      }

      // ── Health ──
      if (path === '/health') {
        return json({
          status: 'ok',
          service: 'browning-sales-engine',
          paypal_mode: env.PAYPAL_MODE || 'sandbox',
          timestamp: new Date().toISOString(),
        });
      }

      return json({ error: 'Not found' }, 404);
    } catch (err: any) {
      console.error('Sales engine error:', err);
      return json({ error: err.message || 'Internal error' }, 500);
    }
  },
};

// ══════════════════════════════════════
// PRODUCT CATALOG
// ══════════════════════════════════════

async function handleListProducts(env: Env): Promise<Response> {
  const products = await supabaseGet<Product>(env, 'products',
    'status=eq.deployed&order=price.asc&select=id,name,slug,description,tier,price,currency,pillar,format,landing_page_url,metadata');
  return json({ products }, 200, env);
}

async function handleGetProduct(env: Env, slug: string): Promise<Response> {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return json({ error: 'Invalid product slug' }, 400, env);
  }
  const products = await supabaseGet<Product>(env, 'products', `slug=eq.${slug}&status=eq.deployed`);
  if (!products.length) return json({ error: 'Product not found' }, 404, env);
  return json({ product: products[0] }, 200, env);
}

// ══════════════════════════════════════
// CHECKOUT — Route to payment provider
// ══════════════════════════════════════

async function handleCheckout(env: Env, body: CheckoutRequest): Promise<Response> {
  if (!body.product_slug) {
    return json({ error: 'product_slug is required' }, 400, env);
  }

  // Load product
  const products = await supabaseGet<Product>(env, 'products', `slug=eq.${body.product_slug}&status=eq.deployed`);
  if (!products.length) return json({ error: 'Product not found' }, 404, env);
  const product = products[0];

  switch (body.payment_method) {
    case 'paypal':
      return await createPayPalOrder(env, product, body);

    case 'installment':
      return await createPayPalInstallmentPlan(env, product, body);

    case 'coinbase':
      return await createCoinbaseCharge(env, product, body);

    default:
      return json({ error: 'Invalid payment_method. Use: paypal, installment, coinbase' }, 400, env);
  }
}

// ══════════════════════════════════════
// PAYPAL — Orders API v2
// ══════════════════════════════════════

function paypalBaseUrl(env: Env): string {
  return env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getPayPalAccessToken(env: Env): Promise<string> {
  const base = paypalBaseUrl(env);
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`);

  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const data: any = await res.json();
  return data.access_token;
}

async function createPayPalOrder(env: Env, product: Product, body: CheckoutRequest): Promise<Response> {
  const token = await getPayPalAccessToken(env);
  const base = paypalBaseUrl(env);

  // PayPal Pay Later is automatically available when:
  // 1. The PayPal JS SDK includes "enable-funding=paylater"
  // 2. The order amount is $30-$10,000
  // 3. The buyer is in a supported country
  // No extra server-side config needed — the button handles it.

  const orderData = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: product.id,
      description: product.name,
      custom_id: product.slug,
      amount: {
        currency_code: product.currency || 'USD',
        value: product.price.toFixed(2),
        breakdown: {
          item_total: {
            currency_code: product.currency || 'USD',
            value: product.price.toFixed(2),
          },
        },
      },
      items: [{
        name: product.name,
        description: (product.description || '').substring(0, 127),
        unit_amount: {
          currency_code: product.currency || 'USD',
          value: product.price.toFixed(2),
        },
        quantity: '1',
        category: 'DIGITAL_GOODS',
      }],
    }],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          brand_name: 'Browning Digital',
          locale: 'en-US',
          landing_page: 'LOGIN',
          user_action: 'PAY_NOW',
          return_url: `${env.STORE_URL}/success`,
          cancel_url: `${env.STORE_URL}/checkout/${product.slug}`,
        },
      },
    },
    application_context: {
      shipping_preference: 'NO_SHIPPING',
    },
  };

  const res = await fetch(`${base}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(orderData),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal order creation failed: ${err.substring(0, 500)}`);
  }

  const order: any = await res.json();

  // Find the approval link
  const approveLink = order.links?.find((l: any) => l.rel === 'approve' || l.rel === 'payer-action');

  return json({
    success: true,
    payment_method: 'paypal',
    order_id: order.id,
    status: order.status,
    approve_url: approveLink?.href,
    // Client-side can use order_id with PayPal JS SDK buttons
  }, 200, env);
}

async function handlePayPalCapture(env: Env, orderId: string): Promise<Response> {
  if (!orderId || !/^[A-Z0-9]+$/.test(orderId)) {
    return json({ error: 'Invalid order_id' }, 400, env);
  }

  const token = await getPayPalAccessToken(env);
  const base = paypalBaseUrl(env);

  const res = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const err = await res.text();
    return json({ error: `Capture failed: ${err.substring(0, 300)}` }, 400, env);
  }

  const capture: any = await res.json();
  const captureUnit = capture.purchase_units?.[0]?.payments?.captures?.[0];

  if (capture.status === 'COMPLETED' && captureUnit) {
    // Record the sale
    const productSlug = capture.purchase_units[0]?.custom_id;
    const payer = capture.payer;

    const saleRecord = {
      product_name: capture.purchase_units[0]?.description || productSlug,
      amount: parseFloat(captureUnit.amount?.value || '0'),
      currency: captureUnit.amount?.currency_code || 'USD',
      source: 'paypal',
      customer_email: payer?.email_address || '',
      customer_name: payer?.name ? `${payer.name.given_name} ${payer.name.surname}` : '',
      payment_id: captureUnit.id,
      metadata: {
        paypal_order_id: orderId,
        capture_id: captureUnit.id,
        product_slug: productSlug,
      },
    };

    // Match product for product_id
    if (productSlug) {
      const products = await supabaseGet<Product>(env, 'products', `slug=eq.${productSlug}`);
      if (products.length) {
        (saleRecord as any).product_id = products[0].id;
      }
    }

    await supabaseInsert(env, 'product_sales', saleRecord);

    // Generate delivery token
    const deliveryToken = generateDeliveryToken(saleRecord.payment_id);

    return json({
      success: true,
      status: 'completed',
      sale: saleRecord,
      delivery_url: `${env.STORE_URL}/delivery?id=${saleRecord.payment_id}&token=${deliveryToken}`,
    }, 200, env);
  }

  return json({
    success: false,
    status: capture.status,
    details: capture,
  }, 200, env);
}

// ══════════════════════════════════════
// PAYPAL — Installment Plans (Subscriptions API)
// ══════════════════════════════════════

async function createPayPalInstallmentPlan(env: Env, product: Product, body: CheckoutRequest): Promise<Response> {
  const token = await getPayPalAccessToken(env);
  const base = paypalBaseUrl(env);
  const installments = Math.min(Math.max(body.installment_count || 3, 2), 4);
  const installmentAmount = (product.price / installments).toFixed(2);

  // Step 1: Create a billing plan
  const planData = {
    product_id: product.id, // PayPal catalog product (create separately if needed)
    name: `${product.name} — ${installments}-Payment Plan`,
    description: `Pay ${installmentAmount} ${product.currency || 'USD'} x ${installments} installments`,
    billing_cycles: [{
      frequency: {
        interval_unit: 'MONTH',
        interval_count: 1,
      },
      tenure_type: 'REGULAR',
      sequence: 1,
      total_cycles: installments,
      pricing_scheme: {
        fixed_price: {
          value: installmentAmount,
          currency_code: product.currency || 'USD',
        },
      },
    }],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee: {
        value: '0',
        currency_code: product.currency || 'USD',
      },
      setup_fee_failure_action: 'CANCEL',
      payment_failure_threshold: 2,
    },
  };

  // First, ensure we have a PayPal catalog product
  const catalogProduct = await ensurePayPalCatalogProduct(env, token, product);

  planData.product_id = catalogProduct.id;

  const planRes = await fetch(`${base}/v1/billing/plans`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(planData),
  });

  if (!planRes.ok) {
    const err = await planRes.text();
    throw new Error(`PayPal plan creation failed: ${err.substring(0, 300)}`);
  }

  const plan: any = await planRes.json();

  // Step 2: Create subscription
  const subscriptionData = {
    plan_id: plan.id,
    subscriber: {
      email_address: body.customer_email || undefined,
      name: body.customer_name ? { given_name: body.customer_name } : undefined,
    },
    application_context: {
      brand_name: 'Browning Digital',
      locale: 'en-US',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'SUBSCRIBE_NOW',
      return_url: `${env.STORE_URL}/success?plan=true`,
      cancel_url: `${env.STORE_URL}/checkout/${product.slug}`,
    },
  };

  const subRes = await fetch(`${base}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(subscriptionData),
  });

  if (!subRes.ok) {
    const err = await subRes.text();
    throw new Error(`PayPal subscription creation failed: ${err.substring(0, 300)}`);
  }

  const subscription: any = await subRes.json();
  const approveLink = subscription.links?.find((l: any) => l.rel === 'approve');

  return json({
    success: true,
    payment_method: 'installment',
    plan_id: plan.id,
    subscription_id: subscription.id,
    installments,
    per_installment: installmentAmount,
    total: product.price.toFixed(2),
    approve_url: approveLink?.href,
  }, 200, env);
}

async function ensurePayPalCatalogProduct(env: Env, token: string, product: Product): Promise<any> {
  const base = paypalBaseUrl(env);

  // Try to create (PayPal deduplicates by external_id)
  const res = await fetch(`${base}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: product.name,
      description: (product.description || '').substring(0, 255),
      type: 'DIGITAL',
      category: 'SOFTWARE',
    }),
  });

  return res.json();
}

// ══════════════════════════════════════
// COINBASE COMMERCE — Crypto Payments
// ══════════════════════════════════════

async function createCoinbaseCharge(env: Env, product: Product, body: CheckoutRequest): Promise<Response> {
  if (!env.COINBASE_API_KEY) {
    return json({ error: 'Crypto payments not configured. Set COINBASE_API_KEY.' }, 503, env);
  }

  const chargeData = {
    name: product.name,
    description: product.description || `${product.name} — Digital Product`,
    pricing_type: 'fixed_price',
    local_price: {
      amount: product.price.toFixed(2),
      currency: product.currency || 'USD',
    },
    metadata: {
      product_id: product.id,
      product_slug: product.slug,
      customer_email: body.customer_email || '',
      customer_name: body.customer_name || '',
    },
    redirect_url: `${env.STORE_URL}/success?method=crypto`,
    cancel_url: `${env.STORE_URL}/checkout/${product.slug}`,
  };

  const res = await fetch('https://api.commerce.coinbase.com/charges', {
    method: 'POST',
    headers: {
      'X-CC-Api-Key': env.COINBASE_API_KEY,
      'X-CC-Version': '2018-03-22',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chargeData),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Coinbase charge creation failed: ${err.substring(0, 300)}`);
  }

  const charge: any = await res.json();

  return json({
    success: true,
    payment_method: 'coinbase',
    charge_id: charge.data.id,
    charge_code: charge.data.code,
    checkout_url: charge.data.hosted_url,
    expires_at: charge.data.expires_at,
    pricing: charge.data.pricing,
    // Buyer goes to hosted_url — supports BTC, ETH, USDC, DAI, DOGE, LTC, etc.
  }, 200, env);
}

// ══════════════════════════════════════
// WEBHOOKS
// ══════════════════════════════════════

async function handlePayPalWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const eventType = event.event_type;

  // Handle payment captures
  if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
    const capture = event.resource;
    const amount = parseFloat(capture?.amount?.value || '0');

    if (amount > 0) {
      await supabaseInsert(env, 'product_sales', {
        product_name: capture?.custom_id || 'PayPal Purchase',
        amount,
        currency: capture?.amount?.currency_code || 'USD',
        source: 'paypal',
        customer_email: '',
        payment_id: capture?.id || event.id,
        metadata: { webhook_event: eventType, paypal_event_id: event.id },
      });
    }
  }

  // Handle subscription payments
  if (eventType === 'PAYMENT.SALE.COMPLETED') {
    const sale = event.resource;
    const amount = parseFloat(sale?.amount?.total || '0');

    if (amount > 0) {
      await supabaseInsert(env, 'product_sales', {
        product_name: 'Installment Payment',
        amount,
        currency: sale?.amount?.currency || 'USD',
        source: 'paypal_subscription',
        payment_id: sale?.id || event.id,
        metadata: {
          webhook_event: eventType,
          subscription_id: sale?.billing_agreement_id,
        },
      });
    }
  }

  return json({ received: true });
}

async function handleCoinbaseWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();

  // Verify webhook signature
  const signature = request.headers.get('X-CC-Webhook-Signature');
  if (env.COINBASE_WEBHOOK_SECRET && signature) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(env.COINBASE_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expectedSig = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (expectedSig !== signature) {
      return json({ error: 'Invalid signature' }, 401);
    }
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const charge = event.event?.data;
  const type = event.event?.type;

  if (type === 'charge:confirmed' || type === 'charge:resolved') {
    const metadata = charge?.metadata || {};
    const pricing = charge?.pricing?.local;

    await supabaseInsert(env, 'product_sales', {
      product_id: metadata.product_id || null,
      product_name: charge?.name || metadata.product_slug || 'Crypto Purchase',
      amount: parseFloat(pricing?.amount || '0'),
      currency: pricing?.currency || 'USD',
      source: 'coinbase',
      customer_email: metadata.customer_email || '',
      customer_name: metadata.customer_name || '',
      payment_id: charge?.code || event.id,
      metadata: {
        charge_id: charge?.id,
        charge_code: charge?.code,
        crypto_payments: charge?.payments,
      },
    });
  }

  return json({ received: true });
}

// ══════════════════════════════════════
// DELIVERY
// ══════════════════════════════════════

async function handleDelivery(env: Env, saleId: string, token: string): Promise<Response> {
  if (!saleId || !token) {
    return json({ error: 'Missing sale ID or token' }, 400, env);
  }

  // Verify token
  const expectedToken = generateDeliveryToken(saleId);
  if (token !== expectedToken) {
    return json({ error: 'Invalid delivery token' }, 403, env);
  }

  // Look up the sale
  const sales = await supabaseGet(env, 'product_sales', `payment_id=eq.${saleId}`);
  if (!sales.length) {
    return json({ error: 'Sale not found' }, 404, env);
  }

  const sale = sales[0] as any;

  // Look up the product for delivery URL
  let deliveryUrl = '';
  if (sale.product_id) {
    const products = await supabaseGet<Product>(env, 'products', `id=eq.${sale.product_id}`);
    if (products.length) {
      deliveryUrl = products[0].delivery_url || '';
    }
  }

  return json({
    success: true,
    product_name: sale.product_name,
    delivery_url: deliveryUrl,
    purchased_at: sale.created_at,
  }, 200, env);
}

function generateDeliveryToken(saleId: string): string {
  // Simple HMAC-like token — in production, use crypto.subtle
  let hash = 0;
  const str = `browning-delivery-${saleId}-2026`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ══════════════════════════════════════
// ANALYTICS
// ══════════════════════════════════════

async function handleStats(env: Env): Promise<Response> {
  const sales = await supabaseGet(env, 'product_sales',
    'order=created_at.desc&limit=100&select=amount,currency,source,created_at');

  const total = (sales as any[]).reduce((sum, s) => sum + parseFloat(s.amount || 0), 0);
  const count = sales.length;

  const bySource: Record<string, { count: number; total: number }> = {};
  for (const s of sales as any[]) {
    const src = s.source || 'unknown';
    if (!bySource[src]) bySource[src] = { count: 0, total: 0 };
    bySource[src].count++;
    bySource[src].total += parseFloat(s.amount || 0);
  }

  return json({
    total_revenue: total.toFixed(2),
    total_sales: count,
    by_source: bySource,
    currency: 'USD',
  }, 200, env);
}

// ══════════════════════════════════════
// SUPABASE HELPERS
// ══════════════════════════════════════

async function supabaseGet<T = any>(env: Env, table: string, filter: string): Promise<T[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase GET ${table} failed: ${res.status}`);
  return res.json();
}

async function supabaseInsert(env: Env, table: string, data: any): Promise<any> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase INSERT ${table} failed: ${res.status}`);
  return res.json();
}

function corsHeaders(env?: Env): Record<string, string> {
  const origin = env?.STORE_URL || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data: any, status = 200, env?: Env): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env),
    },
  });
}
