<script lang="ts">
  import { API_URL, PAYPAL_CLIENT_ID, BRAND } from '$lib/config';

  // ── State ──
  let showCheckout = $state(false);
  let paymentMethod = $state<'paypal' | 'installment' | 'coinbase'>('paypal');
  let loading = $state(false);
  let email = $state('');
  let name = $state('');
  let checkoutError = $state('');
  let activeFaq = $state(-1);
  let salesCount = $state(127);

  const PRODUCT_SLUG = 'zero-cost-ai-infra';
  const PRICE = 47;

  async function handleCheckout() {
    if (!email) { checkoutError = 'Email is required for delivery'; return; }
    loading = true;
    checkoutError = '';

    try {
      const res = await fetch(`${API_URL}/api/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_slug: PRODUCT_SLUG,
          payment_method: paymentMethod,
          customer_email: email,
          customer_name: name,
          installment_count: paymentMethod === 'installment' ? 3 : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) { checkoutError = data.error || 'Checkout failed'; return; }

      if (data.approve_url) window.location.href = data.approve_url;
      else if (data.checkout_url) window.location.href = data.checkout_url;
    } catch (err: any) {
      checkoutError = err.message || 'Network error';
    } finally {
      loading = false;
    }
  }

  function toggleFaq(i: number) {
    activeFaq = activeFaq === i ? -1 : i;
  }

  const faqs = [
    { q: 'Why Oracle Cloud instead of AWS?', a: 'Oracle\'s Always Free tier gives you 4 OCPU + 24GB RAM permanently — not a trial. No other provider matches this. The provisioner handles capacity constraints with automatic retry across regions.' },
    { q: 'What if Oracle doesn\'t have capacity?', a: 'The provisioner includes automatic retry with exponential backoff across multiple availability domains. It keeps trying until capacity opens. Chicago and Phoenix regions have the best availability.' },
    { q: 'Can I use GPT-4 or other LLMs?', a: 'The architecture is model-agnostic. The task-watcher is built around Claude Code CLI, but you\'d modify one script to call your preferred model. Everything else stays the same.' },
    { q: 'Is this secure?', a: 'Cloudflare Tunnel means zero exposed ports. Zero Trust Access policies control who reaches your services. All API keys are stored as environment variables, never in code.' },
    { q: 'What\'s my actual monthly cost?', a: 'Infrastructure: $0. The only cost is LLM API usage — typically $5-15/month for 10-20 tasks/day.' },
    { q: 'What if I get stuck?', a: '48-hour guarantee: can\'t get it running? I\'ll help you debug it personally or refund you. No questions.' },
  ];
</script>

<svelte:head>
  <title>Zero-Cost AI Infrastructure Kit — {BRAND.name}</title>
  <meta name="description" content="Deploy a fully autonomous AI agent on free-tier cloud infrastructure. 4 CPU, 24GB RAM, $0/month forever." />
  <meta property="og:title" content="Your AI Agent Runs 24/7 for $0/Month" />
  <meta property="og:description" content="The complete toolkit to deploy autonomous AI on Oracle Cloud's free ARM tier. No DevOps. No monthly bills." />
  <meta property="og:type" content="product" />
</svelte:head>

<!-- PRODUCT PAGE — Gumroad-inspired layout -->
<div class="page">

  <!-- Top bar -->
  <header class="topbar">
    <a href="/" class="brand">{BRAND.name}</a>
    <a href="mailto:{BRAND.email}" class="contact">Contact</a>
  </header>

  <main class="product-layout">
    <!-- LEFT: Product visual + details -->
    <div class="product-col">

      <!-- Product cover -->
      <div class="cover">
        <div class="cover-inner">
          <div class="cover-badge">STARTER KIT</div>
          <div class="cover-title">Zero-Cost<br/>AI Infrastructure</div>
          <div class="cover-specs">
            <span>4 OCPU</span>
            <span class="dot"></span>
            <span>24GB RAM</span>
            <span class="dot"></span>
            <span>$0/mo forever</span>
          </div>
          <div class="cover-grid">
            <div class="grid-item">Auto-Provisioner</div>
            <div class="grid-item">Cloudflare Tunnel</div>
            <div class="grid-item">Task Dispatcher</div>
            <div class="grid-item">Cron Scheduler</div>
            <div class="grid-item">Chat Relay</div>
            <div class="grid-item">Agent Identity</div>
          </div>
          <div class="cover-footer">browningdigital.com</div>
        </div>
      </div>

      <!-- Description -->
      <section class="description">
        <h2>Stop paying for AI infrastructure.</h2>
        <p>
          This is the exact system I use to run fully autonomous AI agents on
          <strong>$0/month infrastructure</strong>. Oracle Cloud's free ARM tier gives you
          a real server — 4 CPU cores, 24GB RAM, 200GB SSD — permanently free.
        </p>
        <p>
          The kit includes everything: auto-provisioning scripts that handle Oracle's
          capacity lottery, Cloudflare Tunnel for secure access from anywhere, a task
          dispatch system, scheduled automation, and a chat relay so you can talk to
          your agent from your phone.
        </p>
        <p>
          No DevOps experience needed. Run one script. Your AI agent is live in 15 minutes.
        </p>
      </section>

      <!-- What's included -->
      <section class="whats-in">
        <h3>What's included</h3>
        <div class="included-list">
          <div class="included-item">
            <div class="item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            </div>
            <div>
              <strong>Auto-Provisioning Engine</strong>
              <p>One command launches an Oracle Cloud ARM instance. Automatic retry across availability domains when capacity is limited.</p>
            </div>
          </div>
          <div class="included-item">
            <div class="item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <div>
              <strong>Cloudflare Tunnel + Zero Trust</strong>
              <p>Secure access from anywhere — no exposed ports, no security holes. Access your agent from your phone, laptop, anywhere.</p>
            </div>
          </div>
          <div class="included-item">
            <div class="item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <div>
              <strong>Task Dispatch System</strong>
              <p>Queue tasks via API. Your agent picks them up in seconds and executes autonomously with retry logic.</p>
            </div>
          </div>
          <div class="included-item">
            <div class="item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div>
              <strong>Scheduled Automation</strong>
              <p>Cron-based scheduler for recurring tasks — daily reports, content processing, data extraction. All hands-free.</p>
            </div>
          </div>
          <div class="included-item">
            <div class="item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div>
              <strong>Chat Relay (iPhone-ready)</strong>
              <p>WebSocket server lets you talk to your running agent from any device. Real-time streaming responses.</p>
            </div>
          </div>
          <div class="included-item">
            <div class="item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div>
              <strong>Agent Identity Framework</strong>
              <p>Pre-built CLAUDE.md system — define your agent's personality, goals, permissions, and operating rules.</p>
            </div>
          </div>
          <div class="included-item">
            <div class="item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            </div>
            <div>
              <strong>Systemd Services + Health Monitoring</strong>
              <p>Auto-restart on failure, hardened security, watchdog supervision. Your agent stays alive.</p>
            </div>
          </div>
          <div class="included-item">
            <div class="item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div>
              <strong>Complete Setup Guide</strong>
              <p>Step-by-step documentation. Create your free accounts, run the provisioner, agent goes live.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Creator -->
      <section class="creator">
        <div class="creator-avatar">DB</div>
        <div class="creator-info">
          <strong>Devin Browning</strong>
          <p>Founder, Browning Digital. This exact infrastructure runs my autonomous content engine, credit repair platform, and multiple SaaS products — all on $0/month cloud spend.</p>
        </div>
      </section>

      <!-- FAQ -->
      <section class="faq">
        <h3>FAQ</h3>
        {#each faqs as faq, i}
          <button class="faq-item" class:open={activeFaq === i} onclick={() => toggleFaq(i)}>
            <div class="faq-q">
              {faq.q}
              <span class="faq-toggle">{activeFaq === i ? '−' : '+'}</span>
            </div>
            {#if activeFaq === i}
              <p class="faq-a">{faq.a}</p>
            {/if}
          </button>
        {/each}
      </section>
    </div>

    <!-- RIGHT: Purchase card (sticky) -->
    <aside class="purchase-col">
      <div class="purchase-card" class:checkout-mode={showCheckout}>

        {#if !showCheckout}
          <!-- Product info -->
          <div class="purchase-header">
            <h1 class="product-title">Zero-Cost AI Infrastructure Kit</h1>
            <div class="price-row">
              <span class="price">$47</span>
              <span class="price-note">USD</span>
            </div>
          </div>

          <div class="purchase-meta">
            <div class="meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              One-time purchase
            </div>
            <div class="meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              48-hour guarantee
            </div>
            <div class="meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Instant download
            </div>
          </div>

          <button class="buy-btn" onclick={() => showCheckout = true}>
            I want this!
          </button>

          <div class="sales-count">{salesCount}+ people bought this</div>

          <div class="savings-callout">
            <div class="savings-title">You're saving $1,800/year</div>
            <div class="savings-sub">vs. typical cloud hosting costs for the same specs</div>
          </div>

        {:else}
          <!-- Checkout overlay -->
          <div class="checkout-inner">
            <button class="checkout-back" onclick={() => showCheckout = false}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            </button>
            <div class="checkout-product">
              <strong>Zero-Cost AI Infrastructure Kit</strong>
              <span class="checkout-price">$47</span>
            </div>

            <form onsubmit={(e) => { e.preventDefault(); handleCheckout(); }}>
              <div class="field">
                <label for="name">Name</label>
                <input type="text" id="name" bind:value={name} placeholder="Your name" autocomplete="name" />
              </div>
              <div class="field">
                <label for="email">Email <span class="req">*</span></label>
                <input type="email" id="email" bind:value={email} placeholder="you@example.com" required autocomplete="email" />
              </div>

              <div class="methods">
                <button type="button" class="method" class:sel={paymentMethod === 'paypal'}
                  onclick={() => paymentMethod = 'paypal'}>
                  <span class="m-label">PayPal</span>
                  <span class="m-sub">or debit/credit</span>
                </button>
                <button type="button" class="method" class:sel={paymentMethod === 'installment'}
                  onclick={() => paymentMethod = 'installment'}>
                  <span class="m-label">3 Payments</span>
                  <span class="m-sub">$15.67/mo</span>
                </button>
                <button type="button" class="method" class:sel={paymentMethod === 'coinbase'}
                  onclick={() => paymentMethod = 'coinbase'}>
                  <span class="m-label">Crypto</span>
                  <span class="m-sub">BTC, ETH, USDC</span>
                </button>
              </div>

              {#if checkoutError}
                <div class="err">{checkoutError}</div>
              {/if}

              <button type="submit" class="pay-btn" disabled={loading}>
                {#if loading}
                  Processing...
                {:else if paymentMethod === 'installment'}
                  Pay $15.67 today
                {:else if paymentMethod === 'coinbase'}
                  Pay with Crypto
                {:else}
                  Pay
                {/if}
              </button>
            </form>

            <div class="secure-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Secure checkout &bull; Instant delivery &bull; 48hr guarantee
            </div>
          </div>
        {/if}
      </div>
    </aside>
  </main>
</div>

<style>
  /* ═══ DESIGN TOKENS ═══ */
  :root {
    --pink: #ff90e8;
    --pink-soft: rgba(255, 144, 232, 0.08);
    --coral: #ff6b6b;
    --yellow: #ffd43b;
    --green: #51cf66;
    --blue: #339af0;
    --purple: #845ef7;
    --bg: #fff;
    --bg-soft: #fafafa;
    --bg-card: #fff;
    --text: #1a1a2e;
    --text-2: #555;
    --text-3: #999;
    --border: #e8e8e8;
    --radius: 12px;
    --shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04);
    --shadow-lg: 0 4px 24px rgba(0,0,0,0.08);
    --max-w: 1040px;
  }

  /* ═══ RESET + BASE ═══ */
  .page {
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
  }

  /* ═══ TOP BAR ═══ */
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 32px;
    max-width: var(--max-w);
    margin: 0 auto;
  }
  .brand {
    font-weight: 700;
    font-size: 15px;
    color: var(--text);
    text-decoration: none;
  }
  .contact {
    font-size: 14px;
    color: var(--text-3);
    text-decoration: none;
  }
  .contact:hover { color: var(--text); }

  /* ═══ TWO-COLUMN LAYOUT ═══ */
  .product-layout {
    display: grid;
    grid-template-columns: 1fr 380px;
    gap: 48px;
    max-width: var(--max-w);
    margin: 0 auto;
    padding: 0 32px 80px;
    align-items: start;
  }

  .product-col {
    min-width: 0;
  }

  .purchase-col {
    position: sticky;
    top: 24px;
  }

  /* ═══ PRODUCT COVER ═══ */
  .cover {
    border-radius: var(--radius);
    overflow: hidden;
    margin-bottom: 40px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    aspect-ratio: 16/10;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cover-inner {
    text-align: center;
    padding: 40px 32px;
    color: #fff;
  }
  .cover-badge {
    display: inline-block;
    padding: 4px 14px;
    background: rgba(255, 144, 232, 0.15);
    border: 1px solid rgba(255, 144, 232, 0.3);
    border-radius: 100px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: var(--pink);
    margin-bottom: 16px;
  }
  .cover-title {
    font-size: clamp(28px, 4vw, 40px);
    font-weight: 900;
    line-height: 1.1;
    letter-spacing: -0.03em;
    margin-bottom: 16px;
  }
  .cover-specs {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    font-size: 13px;
    color: rgba(255,255,255,0.7);
    margin-bottom: 24px;
    font-weight: 500;
  }
  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(255,255,255,0.3);
  }
  .cover-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    max-width: 360px;
    margin: 0 auto 20px;
  }
  .grid-item {
    padding: 8px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.8);
  }
  .cover-footer {
    font-size: 11px;
    color: rgba(255,255,255,0.3);
    letter-spacing: 0.05em;
  }

  /* ═══ DESCRIPTION ═══ */
  .description {
    margin-bottom: 40px;
  }
  .description h2 {
    font-size: 24px;
    font-weight: 800;
    margin-bottom: 16px;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  .description p {
    color: var(--text-2);
    font-size: 16px;
    line-height: 1.7;
    margin-bottom: 12px;
  }

  /* ═══ WHAT'S INCLUDED ═══ */
  .whats-in {
    margin-bottom: 40px;
  }
  .whats-in h3 {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .included-list {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .included-item {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }
  .item-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: var(--pink-soft);
    color: #e64ba8;
  }
  .item-icon svg {
    width: 18px;
    height: 18px;
  }
  .included-item strong {
    display: block;
    font-size: 15px;
    font-weight: 700;
    margin-bottom: 2px;
  }
  .included-item p {
    color: var(--text-2);
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
  }

  /* ═══ CREATOR ═══ */
  .creator {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    padding: 24px;
    background: var(--bg-soft);
    border-radius: var(--radius);
    margin-bottom: 40px;
  }
  .creator-avatar {
    flex-shrink: 0;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--pink), var(--purple));
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 16px;
  }
  .creator-info strong {
    font-size: 15px;
    display: block;
    margin-bottom: 4px;
  }
  .creator-info p {
    color: var(--text-2);
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
  }

  /* ═══ FAQ ═══ */
  .faq { margin-bottom: 40px; }
  .faq h3 {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .faq-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    padding: 16px 0;
    cursor: pointer;
    font-family: inherit;
    color: inherit;
  }
  .faq-q {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 15px;
    font-weight: 600;
  }
  .faq-toggle {
    font-size: 18px;
    color: var(--text-3);
    flex-shrink: 0;
    margin-left: 12px;
  }
  .faq-a {
    margin-top: 12px;
    color: var(--text-2);
    font-size: 14px;
    line-height: 1.6;
  }

  /* ═══ PURCHASE CARD ═══ */
  .purchase-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 28px;
    box-shadow: var(--shadow-lg);
  }

  .purchase-header {
    margin-bottom: 20px;
  }
  .product-title {
    font-size: 20px;
    font-weight: 800;
    line-height: 1.2;
    letter-spacing: -0.02em;
    margin-bottom: 12px;
  }
  .price-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .price {
    font-size: 40px;
    font-weight: 900;
    letter-spacing: -0.03em;
  }
  .price-note {
    font-size: 14px;
    color: var(--text-3);
  }

  .purchase-meta {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 24px;
  }
  .meta-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--text-2);
  }
  .meta-item svg { color: var(--green); flex-shrink: 0; }

  .buy-btn {
    width: 100%;
    padding: 16px;
    background: var(--pink);
    color: #000;
    border: none;
    border-radius: 8px;
    font-size: 17px;
    font-weight: 700;
    cursor: pointer;
    transition: transform 0.1s, box-shadow 0.2s;
    box-shadow: 0 2px 12px rgba(255, 144, 232, 0.25);
    font-family: inherit;
  }
  .buy-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(255, 144, 232, 0.35);
  }

  .sales-count {
    text-align: center;
    font-size: 13px;
    color: var(--text-3);
    margin-top: 12px;
  }

  .savings-callout {
    margin-top: 20px;
    padding: 16px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
    text-align: center;
  }
  .savings-title {
    font-size: 15px;
    font-weight: 700;
    color: #166534;
    margin-bottom: 2px;
  }
  .savings-sub {
    font-size: 12px;
    color: #4ade80;
  }

  /* ═══ CHECKOUT MODE ═══ */
  .checkout-inner {
    position: relative;
  }
  .checkout-back {
    position: absolute;
    top: 0;
    left: 0;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-3);
    padding: 0;
  }
  .checkout-back:hover { color: var(--text); }

  .checkout-product {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 16px;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--border);
    padding-left: 28px;
  }
  .checkout-product strong {
    font-size: 14px;
  }
  .checkout-price {
    font-weight: 800;
    font-size: 18px;
  }

  .field {
    margin-bottom: 14px;
  }
  .field label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
    margin-bottom: 4px;
  }
  .field input {
    width: 100%;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 15px;
    font-family: inherit;
    color: var(--text);
    background: var(--bg);
    transition: border-color 0.15s;
  }
  .field input:focus {
    outline: none;
    border-color: var(--pink);
    box-shadow: 0 0 0 3px rgba(255, 144, 232, 0.1);
  }
  .req { color: var(--coral); }

  .methods {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 16px;
  }
  .method {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 12px 8px;
    background: var(--bg);
    border: 2px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
    transition: border-color 0.15s;
  }
  .method:hover { border-color: #ccc; }
  .method.sel { border-color: var(--pink); background: var(--pink-soft); }
  .m-label { font-size: 13px; font-weight: 700; color: var(--text); }
  .m-sub { font-size: 11px; color: var(--text-3); }

  .err {
    padding: 10px 14px;
    background: #fff5f5;
    border: 1px solid #fecaca;
    border-radius: 8px;
    color: var(--coral);
    font-size: 13px;
    margin-bottom: 12px;
  }

  .pay-btn {
    width: 100%;
    padding: 14px;
    background: #000;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 0.15s;
  }
  .pay-btn:hover:not(:disabled) { opacity: 0.85; }
  .pay-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .secure-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-top: 14px;
    font-size: 12px;
    color: var(--text-3);
  }

  /* ═══ RESPONSIVE ═══ */
  @media (max-width: 768px) {
    .product-layout {
      grid-template-columns: 1fr;
      padding: 0 16px 40px;
      gap: 24px;
    }

    .purchase-col {
      position: relative;
      top: 0;
      order: -1;
    }

    .topbar { padding: 16px; }

    .cover-grid { grid-template-columns: repeat(2, 1fr); }
    .cover-inner { padding: 32px 20px; }

    .methods { grid-template-columns: 1fr; }
  }
</style>
