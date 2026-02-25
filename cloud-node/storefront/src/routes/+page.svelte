<script lang="ts">
  import { API_URL, PAYPAL_CLIENT_ID, BRAND } from '$lib/config';

  let showCheckout = $state(false);
  let paymentMethod = $state<'paypal' | 'installment' | 'coinbase'>('paypal');
  let loading = $state(false);
  let email = $state('');
  let name = $state('');
  let checkoutError = $state('');

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

      if (!res.ok) {
        checkoutError = data.error || 'Checkout failed';
        return;
      }

      // Redirect to payment provider
      if (data.approve_url) {
        window.location.href = data.approve_url;
      } else if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch (err: any) {
      checkoutError = err.message || 'Network error';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Zero-Cost AI Infrastructure — {BRAND.name}</title>
  <meta name="description" content="Deploy a fully autonomous AI agent on free-tier cloud infrastructure. 4 CPU, 24GB RAM, $0/month forever." />
  <meta property="og:title" content="Your AI Agent Runs 24/7 on Infrastructure That Costs $0/Month" />
  <meta property="og:description" content="Deploy a fully autonomous AI agent on Oracle Cloud's free ARM tier. No DevOps. No monthly bills." />
  <meta property="og:type" content="product" />
</svelte:head>

<!-- ══════ HERO ══════ -->
<section class="hero">
  <div class="hero-glow"></div>
  <nav class="nav">
    <div class="nav-brand">{BRAND.name}</div>
    <a href="#get-it" class="nav-cta">Get the Kit</a>
  </nav>

  <div class="hero-content">
    <div class="badge">ZERO-COST INFRASTRUCTURE</div>
    <h1>Your AI Agent Runs 24/7 on Infrastructure That Costs <span class="accent">$0/Month</span></h1>
    <p class="hero-sub">
      Deploy a fully autonomous AI agent on Oracle Cloud's free ARM tier —
      <strong>4 CPU cores, 24GB RAM, forever free.</strong> No DevOps experience required.
    </p>

    <div class="hero-stats">
      <div class="stat">
        <span class="stat-value">4</span>
        <span class="stat-label">CPU Cores</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <span class="stat-value">24GB</span>
        <span class="stat-label">RAM</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <span class="stat-value">$0</span>
        <span class="stat-label">Monthly</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <span class="stat-value">24/7</span>
        <span class="stat-label">Autonomous</span>
      </div>
    </div>

    <a href="#get-it" class="hero-cta">
      Get the Starter Kit — $47
      <span class="cta-sub">One-time. No subscription.</span>
    </a>
  </div>
</section>

<!-- ══════ PROBLEM ══════ -->
<section class="section" id="problem">
  <div class="container">
    <div class="problem-grid">
      <div class="problem-text">
        <h2>You're Paying Too Much for AI Infrastructure</h2>
        <p>
          You want an AI agent that works autonomously — processing data, generating content,
          monitoring systems, executing tasks while you sleep.
        </p>
        <p>
          But cloud infrastructure costs <strong>$50-200/month</strong>, and setting it up takes
          <strong>days of DevOps work</strong> you don't want to do.
        </p>
        <p>
          You've looked at AWS, GCP, Azure. They all want your credit card and your
          first-born child. Trial tiers expire. Bills surprise you.
        </p>
      </div>
      <div class="cost-comparison">
        <div class="cost-card bad">
          <div class="cost-label">Typical cloud setup</div>
          <div class="cost-price">$150<span>/mo</span></div>
          <ul>
            <li>EC2/GCE instance</li>
            <li>Networking & load balancer</li>
            <li>Database hosting</li>
            <li>Monitoring tools</li>
          </ul>
          <div class="cost-annual">= $1,800/year</div>
        </div>
        <div class="cost-card good">
          <div class="cost-label">This starter kit</div>
          <div class="cost-price">$0<span>/mo</span></div>
          <ul>
            <li>Oracle ARM (free forever)</li>
            <li>Cloudflare Tunnel (free)</li>
            <li>Supabase DB (free tier)</li>
            <li>Built-in monitoring</li>
          </ul>
          <div class="cost-annual">= $0/year</div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ══════ WHAT'S INSIDE ══════ -->
<section class="section dark" id="features">
  <div class="container">
    <h2 class="section-title">Everything You Need. Nothing You Don't.</h2>
    <p class="section-sub">Production-ready scripts and templates. Not a tutorial — a working system.</p>

    <div class="feature-grid">
      <div class="feature-card">
        <div class="feature-icon">&#9889;</div>
        <h3>Auto-Provisioning</h3>
        <p>One command spins up an Oracle Cloud ARM instance. Automatic retry when capacity is limited. Handles everything.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#128274;</div>
        <h3>Cloudflare Tunnel</h3>
        <p>Secure access from anywhere. No exposed ports, no security holes. Access your agent from your phone.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#128640;</div>
        <h3>Task Dispatch System</h3>
        <p>Queue tasks via API. Your agent picks them up within 30 seconds and executes autonomously.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#128338;</div>
        <h3>Scheduled Automation</h3>
        <p>Built-in cron system for recurring tasks. Daily reports, content processing, data extraction — all hands-free.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#128172;</div>
        <h3>Chat Relay</h3>
        <p>WebSocket server lets you talk to your running agent from any device. Real-time streaming responses.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">&#129504;</div>
        <h3>Agent Identity</h3>
        <p>Pre-built CLAUDE.md template. Define your agent's personality, goals, permissions, and operating rules.</p>
      </div>
    </div>
  </div>
</section>

<!-- ══════ ARCHITECTURE ══════ -->
<section class="section">
  <div class="container">
    <h2 class="section-title">Battle-Tested Architecture</h2>
    <p class="section-sub">This exact setup runs our autonomous content engine in production.</p>
    <div class="arch-diagram">
      <pre>
┌─────────────────────────────────────┐
│  Oracle Cloud ARM (Free Tier)       │
│  4 OCPU  |  24GB RAM  |  200GB SSD │
│                                     │
│  ┌─────────────┐  ┌──────────────┐  │
│  │ Claude Code  │  │ Task Watcher │  │
│  │  (headless)  │◄─│  (polls DB)  │  │
│  └─────────────┘  └──────────────┘  │
│         ▲                ▲          │
│  ┌──────┴──────┐  ┌──────┴───────┐  │
│  │ Chat Relay  │  │  Scheduler   │  │
│  │ (WebSocket) │  │  (systemd)   │  │
│  └─────────────┘  └──────────────┘  │
│         ▲                           │
│  ┌──────┴──────────────────────┐    │
│  │  Cloudflare Tunnel          │    │
│  │  (Zero Trust Access)        │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
          ▲
┌─────────┴───────────────────────────┐
│  Supabase (Free Tier)               │
│  Tasks  |  State  |  Memory  |  Logs│
└─────────────────────────────────────┘</pre>
    </div>
  </div>
</section>

<!-- ══════ SOCIAL PROOF ══════ -->
<section class="section dark">
  <div class="container">
    <div class="proof">
      <div class="proof-quote">
        "Built and battle-tested at Browning Digital. This exact infrastructure runs our
        autonomous content engine, processes hundreds of documents daily, and manages
        multiple SaaS products — all on zero-cost infrastructure."
      </div>
      <div class="proof-author">
        <strong>Devin Browning</strong> — Founder, Browning Digital
      </div>
    </div>
  </div>
</section>

<!-- ══════ PRICING / CTA ══════ -->
<section class="section" id="get-it">
  <div class="container">
    <h2 class="section-title">Stop Paying for Infrastructure</h2>

    {#if !showCheckout}
      <div class="pricing-card">
        <div class="pricing-header">
          <div class="pricing-name">Starter Kit</div>
          <div class="pricing-price">
            <span class="currency">$</span>47
          </div>
          <div class="pricing-sub">One-time purchase. No subscription. No upsells.</div>
        </div>

        <div class="pricing-includes">
          <div class="include-item">Auto-provisioning scripts (Oracle Cloud ARM)</div>
          <div class="include-item">Cloudflare Tunnel setup & configuration</div>
          <div class="include-item">Task dispatch system (API + queue + executor)</div>
          <div class="include-item">Scheduled automation (cron-like dispatcher)</div>
          <div class="include-item">Chat relay server (WebSocket, mobile-friendly)</div>
          <div class="include-item">Agent identity framework (CLAUDE.md template)</div>
          <div class="include-item">Systemd services (auto-restart, health monitoring)</div>
          <div class="include-item">Session continuity (Supabase persistence)</div>
          <div class="include-item">Complete setup guide + architecture docs</div>
        </div>

        <button class="buy-btn" onclick={() => showCheckout = true}>
          Get Instant Access — $47
        </button>

        <div class="guarantee">
          <strong>48-hour guarantee:</strong> Can't get it running? I'll help you debug it personally or refund you. No questions.
        </div>
      </div>

    {:else}
      <!-- CHECKOUT FORM -->
      <div class="checkout-card">
        <div class="checkout-header">
          <h3>Complete Your Purchase</h3>
          <p>Zero-Cost AI Infrastructure Starter Kit — $47</p>
        </div>

        <form onsubmit={(e) => { e.preventDefault(); handleCheckout(); }}>
          <div class="form-group">
            <label for="name">Name</label>
            <input type="text" id="name" bind:value={name} placeholder="Your name" />
          </div>

          <div class="form-group">
            <label for="email">Email <span class="required">*</span></label>
            <input type="email" id="email" bind:value={email} placeholder="you@example.com" required />
            <span class="form-hint">Product delivered to this email</span>
          </div>

          <div class="payment-methods">
            <label for="method-paypal">Payment Method</label>
            <div class="method-grid">
              <button type="button" class="method-btn" class:active={paymentMethod === 'paypal'}
                onclick={() => paymentMethod = 'paypal'}>
                <span class="method-icon">&#128179;</span>
                <span class="method-name">PayPal</span>
                <span class="method-note">or Pay Later</span>
              </button>
              <button type="button" class="method-btn" class:active={paymentMethod === 'installment'}
                onclick={() => paymentMethod = 'installment'}>
                <span class="method-icon">&#128197;</span>
                <span class="method-name">3 Payments</span>
                <span class="method-note">$15.67/mo</span>
              </button>
              <button type="button" class="method-btn" class:active={paymentMethod === 'coinbase'}
                onclick={() => paymentMethod = 'coinbase'}>
                <span class="method-icon">&#9830;</span>
                <span class="method-name">Crypto</span>
                <span class="method-note">BTC, ETH, USDC</span>
              </button>
            </div>
          </div>

          {#if checkoutError}
            <div class="error-msg">{checkoutError}</div>
          {/if}

          <button type="submit" class="buy-btn checkout-submit" disabled={loading}>
            {#if loading}
              Processing...
            {:else if paymentMethod === 'installment'}
              Start 3-Payment Plan — $15.67 today
            {:else if paymentMethod === 'coinbase'}
              Pay with Crypto — $47
            {:else}
              Pay with PayPal — $47
            {/if}
          </button>

          <button type="button" class="back-btn" onclick={() => showCheckout = false}>
            &larr; Back
          </button>
        </form>

        <div class="checkout-security">
          <span>&#128274; Secure checkout</span>
          <span>&#128274; 48-hour guarantee</span>
          <span>&#128274; Instant delivery</span>
        </div>
      </div>
    {/if}
  </div>
</section>

<!-- ══════ FAQ ══════ -->
<section class="section dark" id="faq">
  <div class="container">
    <h2 class="section-title">Frequently Asked</h2>
    <div class="faq-list">
      <details class="faq-item">
        <summary>Why Oracle Cloud instead of AWS/GCP/Azure?</summary>
        <p>Oracle's Always Free tier includes ARM instances with 4 OCPU and 24GB RAM — permanently free, not a trial. No other provider offers this. The provisioner handles capacity constraints with automatic retry.</p>
      </details>
      <details class="faq-item">
        <summary>What if Oracle doesn't have capacity?</summary>
        <p>The provisioner includes automatic retry with backoff across multiple availability domains. It keeps trying until capacity opens up. Chicago and Phoenix regions have the best availability.</p>
      </details>
      <details class="faq-item">
        <summary>Can I use GPT-4 or other LLMs instead of Claude?</summary>
        <p>The task-watcher is built around Claude Code CLI, but the architecture works with any LLM. You'd modify one script to call your preferred model. The infrastructure is model-agnostic.</p>
      </details>
      <details class="faq-item">
        <summary>Is this secure?</summary>
        <p>Yes. Cloudflare Tunnel means no ports are exposed to the internet. Zero Trust Access policies control who can reach your services. All API keys are stored as environment variables, never in code.</p>
      </details>
      <details class="faq-item">
        <summary>What's my total monthly cost?</summary>
        <p>Infrastructure: $0. The only cost is your LLM API usage. A typical agent running 10-20 tasks/day costs about $5-15/month in API calls.</p>
      </details>
      <details class="faq-item">
        <summary>What if I get stuck?</summary>
        <p>48-hour guarantee: if you can't get it running, email me and I'll help you debug it personally or refund you. No questions asked.</p>
      </details>
    </div>
  </div>
</section>

<!-- ══════ FOOTER ══════ -->
<footer class="footer">
  <div class="container">
    <div class="footer-content">
      <div class="footer-brand">{BRAND.name}</div>
      <div class="footer-links">
        <a href="mailto:{BRAND.email}">{BRAND.email}</a>
      </div>
    </div>
  </div>
</footer>

<style>
  /* ══════ TOKENS ══════ */
  :root {
    --accent: #00d4ff;
    --accent-glow: rgba(0, 212, 255, 0.15);
    --success: #00ff88;
    --danger: #ff4466;
    --surface-1: #0a0a0f;
    --surface-2: #111118;
    --surface-3: #1a1a25;
    --surface-4: #242435;
    --border: #2a2a3a;
    --text-1: #f0f0f8;
    --text-2: #a0a0b8;
    --text-3: #606078;
    --radius: 16px;
    --radius-sm: 10px;
    --max-width: 1100px;
  }

  /* ══════ LAYOUT ══════ */
  .container { max-width: var(--max-width); margin: 0 auto; padding: 0 24px; }
  .section { padding: 100px 0; }
  .section.dark { background: var(--surface-2); }
  .section-title {
    font-size: clamp(28px, 5vw, 42px);
    font-weight: 800;
    text-align: center;
    margin-bottom: 12px;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }
  .section-sub { text-align: center; color: var(--text-2); font-size: 18px; margin-bottom: 60px; }

  /* ══════ NAV ══════ */
  .nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    max-width: var(--max-width);
    margin: 0 auto;
    position: relative;
    z-index: 10;
  }
  .nav-brand { font-weight: 700; font-size: 16px; color: var(--accent); letter-spacing: -0.01em; }
  .nav-cta {
    padding: 10px 22px;
    background: var(--accent);
    color: #000;
    text-decoration: none;
    border-radius: 100px;
    font-size: 14px;
    font-weight: 600;
    transition: transform 0.15s, box-shadow 0.15s;
  }
  .nav-cta:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(0, 212, 255, 0.3); }

  /* ══════ HERO ══════ */
  .hero {
    min-height: 90vh;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }
  .hero-glow {
    position: absolute;
    top: -200px;
    left: 50%;
    transform: translateX(-50%);
    width: 800px;
    height: 600px;
    background: radial-gradient(ellipse, rgba(0, 212, 255, 0.08) 0%, transparent 70%);
    pointer-events: none;
  }
  .hero-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 0 24px 80px;
    max-width: 800px;
    margin: 0 auto;
    position: relative;
    z-index: 2;
  }
  .badge {
    display: inline-block;
    padding: 6px 16px;
    background: var(--accent-glow);
    border: 1px solid rgba(0, 212, 255, 0.2);
    border-radius: 100px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: var(--accent);
    margin-bottom: 24px;
  }
  .hero h1 {
    font-size: clamp(32px, 6vw, 56px);
    font-weight: 900;
    line-height: 1.1;
    letter-spacing: -0.03em;
    margin-bottom: 20px;
  }
  .accent { color: var(--accent); }
  .hero-sub {
    font-size: clamp(16px, 2.5vw, 20px);
    color: var(--text-2);
    max-width: 600px;
    margin-bottom: 40px;
  }

  /* Stats bar */
  .hero-stats {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 20px 40px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 40px;
  }
  .stat { text-align: center; }
  .stat-value { display: block; font-size: 28px; font-weight: 800; color: var(--accent); }
  .stat-label { display: block; font-size: 12px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-divider { width: 1px; height: 40px; background: var(--border); }

  /* Hero CTA */
  .hero-cta {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    padding: 18px 48px;
    background: var(--accent);
    color: #000;
    text-decoration: none;
    border-radius: var(--radius-sm);
    font-size: 18px;
    font-weight: 700;
    transition: transform 0.15s, box-shadow 0.2s;
    box-shadow: 0 4px 30px rgba(0, 212, 255, 0.2);
  }
  .hero-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 40px rgba(0, 212, 255, 0.35); }
  .cta-sub { font-size: 12px; font-weight: 500; opacity: 0.7; margin-top: 2px; }

  /* ══════ PROBLEM ══════ */
  .problem-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: center; }
  .problem-text h2 { font-size: 32px; font-weight: 800; margin-bottom: 20px; letter-spacing: -0.02em; }
  .problem-text p { color: var(--text-2); margin-bottom: 16px; font-size: 17px; }

  .cost-comparison { display: flex; gap: 20px; }
  .cost-card {
    flex: 1;
    padding: 28px 24px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
  }
  .cost-card.bad { background: var(--surface-2); }
  .cost-card.good { background: var(--surface-3); border-color: var(--accent); box-shadow: 0 0 30px rgba(0, 212, 255, 0.08); }
  .cost-label { font-size: 13px; color: var(--text-3); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
  .cost-price { font-size: 40px; font-weight: 900; margin-bottom: 16px; }
  .cost-card.bad .cost-price { color: var(--danger); }
  .cost-card.good .cost-price { color: var(--success); }
  .cost-price span { font-size: 16px; color: var(--text-3); }
  .cost-card ul { list-style: none; margin-bottom: 16px; }
  .cost-card li { padding: 6px 0; color: var(--text-2); font-size: 14px; }
  .cost-card li::before { content: "  "; margin-right: 8px; }
  .cost-card.bad li::before { content: "- "; color: var(--text-3); }
  .cost-card.good li::before { content: "✓ "; color: var(--success); }
  .cost-annual { font-size: 14px; color: var(--text-3); border-top: 1px solid var(--border); padding-top: 12px; }

  /* ══════ FEATURES ══════ */
  .feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  .feature-card {
    padding: 32px 28px;
    background: var(--surface-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    transition: border-color 0.2s, transform 0.15s;
  }
  .feature-card:hover { border-color: rgba(0, 212, 255, 0.3); transform: translateY(-2px); }
  .feature-icon { font-size: 28px; margin-bottom: 16px; }
  .feature-card h3 { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
  .feature-card p { color: var(--text-2); font-size: 15px; line-height: 1.5; }

  /* ══════ ARCHITECTURE ══════ */
  .arch-diagram {
    max-width: 600px;
    margin: 0 auto;
    padding: 32px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .arch-diagram pre {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    color: var(--accent);
    line-height: 1.4;
    overflow-x: auto;
  }

  /* ══════ PROOF ══════ */
  .proof {
    max-width: 700px;
    margin: 0 auto;
    text-align: center;
  }
  .proof-quote {
    font-size: 20px;
    font-style: italic;
    color: var(--text-2);
    line-height: 1.7;
    margin-bottom: 24px;
  }
  .proof-author { color: var(--text-3); font-size: 15px; }
  .proof-author strong { color: var(--text-1); }

  /* ══════ PRICING ══════ */
  .pricing-card, .checkout-card {
    max-width: 520px;
    margin: 40px auto 0;
    background: var(--surface-2);
    border: 2px solid var(--accent);
    border-radius: var(--radius);
    padding: 40px 36px;
    box-shadow: 0 0 60px rgba(0, 212, 255, 0.08);
  }
  .pricing-header { text-align: center; margin-bottom: 32px; }
  .pricing-name { font-size: 14px; color: var(--accent); font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
  .pricing-price { font-size: 72px; font-weight: 900; letter-spacing: -0.04em; }
  .currency { font-size: 36px; vertical-align: super; color: var(--text-3); }
  .pricing-sub { color: var(--text-3); font-size: 14px; margin-top: 4px; }

  .pricing-includes { margin-bottom: 32px; }
  .include-item {
    padding: 10px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    color: var(--text-2);
    font-size: 15px;
  }
  .include-item::before { content: "✓  "; color: var(--success); font-weight: 600; }

  .buy-btn {
    width: 100%;
    padding: 18px;
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 18px;
    font-weight: 700;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.2s;
    box-shadow: 0 4px 30px rgba(0, 212, 255, 0.2);
  }
  .buy-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 40px rgba(0, 212, 255, 0.35); }
  .buy-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  .guarantee {
    text-align: center;
    margin-top: 20px;
    font-size: 13px;
    color: var(--text-3);
  }
  .guarantee strong { color: var(--success); }

  /* ══════ CHECKOUT ══════ */
  .checkout-header { text-align: center; margin-bottom: 28px; }
  .checkout-header h3 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .checkout-header p { color: var(--text-3); }

  .form-group { margin-bottom: 20px; }
  .form-group label { display: block; font-size: 13px; color: var(--text-3); margin-bottom: 6px; font-weight: 500; }
  .form-group input {
    width: 100%;
    padding: 14px 16px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-1);
    font-size: 16px;
    font-family: inherit;
    transition: border-color 0.15s;
  }
  .form-group input:focus { outline: none; border-color: var(--accent); }
  .form-hint { font-size: 12px; color: var(--text-3); margin-top: 4px; display: block; }
  .required { color: var(--danger); }

  .payment-methods { margin-bottom: 24px; }
  .payment-methods > label { display: block; font-size: 13px; color: var(--text-3); margin-bottom: 10px; font-weight: 500; }
  .method-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .method-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 16px 12px;
    background: var(--surface-1);
    border: 2px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-2);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    font-family: inherit;
  }
  .method-btn:hover { border-color: var(--text-3); }
  .method-btn.active { border-color: var(--accent); background: var(--accent-glow); }
  .method-icon { font-size: 22px; }
  .method-name { font-size: 13px; font-weight: 600; color: var(--text-1); }
  .method-note { font-size: 11px; color: var(--text-3); }

  .error-msg {
    background: rgba(255, 68, 102, 0.1);
    border: 1px solid rgba(255, 68, 102, 0.3);
    border-radius: var(--radius-sm);
    padding: 12px 16px;
    color: var(--danger);
    font-size: 14px;
    margin-bottom: 16px;
  }

  .checkout-submit { margin-bottom: 12px; }
  .back-btn {
    width: 100%;
    padding: 12px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-3);
    font-size: 14px;
    cursor: pointer;
    font-family: inherit;
  }
  .back-btn:hover { border-color: var(--text-3); color: var(--text-2); }

  .checkout-security {
    display: flex;
    justify-content: center;
    gap: 20px;
    margin-top: 20px;
    font-size: 12px;
    color: var(--text-3);
  }

  /* ══════ FAQ ══════ */
  .faq-list { max-width: 700px; margin: 0 auto; }
  .faq-item {
    border-bottom: 1px solid var(--border);
    padding: 0;
  }
  .faq-item summary {
    padding: 20px 0;
    font-size: 17px;
    font-weight: 600;
    cursor: pointer;
    color: var(--text-1);
    list-style: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .faq-item summary::after { content: "+"; font-size: 20px; color: var(--accent); }
  .faq-item[open] summary::after { content: "−"; }
  .faq-item p { padding: 0 0 20px; color: var(--text-2); font-size: 15px; line-height: 1.6; }

  /* ══════ FOOTER ══════ */
  .footer { padding: 40px 0; border-top: 1px solid var(--border); }
  .footer-content { display: flex; justify-content: space-between; align-items: center; }
  .footer-brand { font-weight: 600; color: var(--text-3); }
  .footer-links a { color: var(--text-3); text-decoration: none; font-size: 14px; }
  .footer-links a:hover { color: var(--accent); }

  /* ══════ RESPONSIVE ══════ */
  @media (max-width: 768px) {
    .problem-grid { grid-template-columns: 1fr; gap: 40px; }
    .cost-comparison { flex-direction: column; }
    .feature-grid { grid-template-columns: 1fr; }
    .hero-stats { flex-wrap: wrap; gap: 16px; padding: 16px 20px; }
    .stat-divider { display: none; }
    .method-grid { grid-template-columns: 1fr; }
    .pricing-card, .checkout-card { padding: 28px 20px; }
    .checkout-security { flex-direction: column; align-items: center; gap: 8px; }
  }
</style>
