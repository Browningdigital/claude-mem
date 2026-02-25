<script lang="ts">
  import { API_URL, BRAND } from '$lib/config';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';

  let status = $state<'loading' | 'success' | 'error'>('loading');
  let deliveryUrl = $state('');
  let productName = $state('');

  onMount(async () => {
    // After PayPal redirect, we need to capture the payment
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token'); // PayPal order ID
    const isPlan = params.get('plan');
    const isCrypto = params.get('method') === 'crypto';

    if (isCrypto || isPlan) {
      // Crypto and subscription payments are confirmed via webhooks
      status = 'success';
      productName = 'Zero-Cost AI Infrastructure Starter Kit';
      return;
    }

    if (token) {
      try {
        // Capture PayPal payment
        const res = await fetch(`${API_URL}/api/paypal/capture`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: token }),
        });
        const data = await res.json();

        if (data.success) {
          status = 'success';
          productName = data.sale?.product_name || 'Your purchase';
          deliveryUrl = data.delivery_url || '';
        } else {
          status = 'error';
        }
      } catch {
        status = 'error';
      }
    } else {
      status = 'success';
      productName = 'Zero-Cost AI Infrastructure Starter Kit';
    }
  });
</script>

<svelte:head>
  <title>Purchase Complete — {BRAND.name}</title>
</svelte:head>

<div class="success-page">
  {#if status === 'loading'}
    <div class="card">
      <div class="spinner"></div>
      <h2>Processing your payment...</h2>
      <p>Please don't close this page.</p>
    </div>

  {:else if status === 'success'}
    <div class="card">
      <div class="check-mark">&#10003;</div>
      <h1>You're In!</h1>
      <p class="product-name">{productName}</p>
      <p class="message">
        Your purchase is confirmed. Check your email for the download link and setup instructions.
      </p>

      {#if deliveryUrl}
        <a href={deliveryUrl} class="download-btn">
          Download Now
        </a>
      {/if}

      <div class="next-steps">
        <h3>What's Next</h3>
        <ol>
          <li>Download the starter kit</li>
          <li>Create free accounts: Oracle Cloud, Cloudflare, Supabase</li>
          <li>Run the provisioner script — it handles everything else</li>
          <li>Your AI agent is live in ~15 minutes</li>
        </ol>
      </div>

      <div class="support">
        Need help? <a href="mailto:{BRAND.email}">{BRAND.email}</a>
      </div>
    </div>

  {:else}
    <div class="card">
      <div class="error-icon">!</div>
      <h2>Something went wrong</h2>
      <p>Your payment may still have gone through. Check your email or contact us.</p>
      <a href="mailto:{BRAND.email}" class="support-btn">Contact Support</a>
      <a href="/" class="back-link">&larr; Back to store</a>
    </div>
  {/if}
</div>

<style>
  .success-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 24px;
  }

  .card {
    max-width: 520px;
    width: 100%;
    text-align: center;
    background: #111118;
    border: 1px solid #2a2a3a;
    border-radius: 16px;
    padding: 48px 36px;
  }

  .check-mark {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: rgba(0, 255, 136, 0.1);
    border: 2px solid #00ff88;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 36px;
    color: #00ff88;
    margin: 0 auto 24px;
  }

  .error-icon {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: rgba(255, 68, 102, 0.1);
    border: 2px solid #ff4466;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 36px;
    color: #ff4466;
    margin: 0 auto 24px;
    font-weight: 800;
  }

  h1 { font-size: 32px; font-weight: 800; margin-bottom: 8px; }
  h2 { font-size: 24px; font-weight: 700; margin-bottom: 12px; }

  .product-name { color: #00d4ff; font-size: 16px; font-weight: 600; margin-bottom: 16px; }
  .message { color: #a0a0b8; font-size: 16px; margin-bottom: 32px; }

  .download-btn {
    display: inline-block;
    padding: 16px 40px;
    background: #00d4ff;
    color: #000;
    text-decoration: none;
    border-radius: 10px;
    font-size: 17px;
    font-weight: 700;
    margin-bottom: 32px;
    transition: transform 0.15s;
  }
  .download-btn:hover { transform: translateY(-2px); }

  .next-steps {
    text-align: left;
    background: #0a0a0f;
    border: 1px solid #2a2a3a;
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 24px;
  }
  .next-steps h3 { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
  .next-steps ol { padding-left: 20px; color: #a0a0b8; font-size: 14px; }
  .next-steps li { margin-bottom: 8px; }

  .support { color: #606078; font-size: 14px; }
  .support a { color: #00d4ff; text-decoration: none; }

  .support-btn {
    display: inline-block;
    padding: 12px 32px;
    background: transparent;
    border: 1px solid #2a2a3a;
    border-radius: 10px;
    color: #a0a0b8;
    text-decoration: none;
    margin: 16px 0;
    font-size: 14px;
  }
  .back-link { display: block; margin-top: 16px; color: #606078; text-decoration: none; font-size: 14px; }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #2a2a3a;
    border-top-color: #00d4ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 24px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
