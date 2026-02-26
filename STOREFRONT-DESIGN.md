# STOREFRONT & SALES PAGE DESIGN — Per-Project Context
# Only load this in projects that build customer-facing pages.
# Do NOT put this in the global CLAUDE.md.

## THE RULE
Never use SvelteKit, React, Next.js, or any JS framework for storefronts, product pages, sales funnels, landing pages, checkout flows, or upsell sequences. Pure HTML/CSS/JS only. Zero build step. Cloudflare Pages. Dark mode default.

## CONVERSION PATTERNS TO STUDY
- **Gumroad**: Clean, minimal, product-forward. One CTA. Social proof baked in.
- **Sellix**: Dark mode aesthetic, trust signals, instant checkout.
- **Shopify top themes** (Dawn, Prestige, Impulse): Urgency, hero copy, benefit bullets, sticky CTAs.
- **Drop culture** (Supreme, FOG Essentials): Scarcity, waitlists, countdown drops.
- **Apple product pages**: Progressive disclosure, scroll-triggered reveals.
- **Stripe Checkout**: Trust and simplicity patterns.

## DESIGN PRINCIPLES
1. Bleeding-edge native CSS: scroll-driven animations, View Transitions, @property gradients, container queries, mesh gradients
2. Copy hierarchy: headline sells → subhead qualifies → bullets prove → CTA closes
3. Social proof is structural (purchase counts, testimonials = load-bearing, not decorative)
4. Mobile-first, thumb-zone optimized. Sticky bottom CTAs. 70%+ traffic is mobile.
5. Under 50KB total. Inline critical CSS. No layout shift. No loading spinners.
6. Checkout is sacred: minimal fields, multiple payment options, trust badges near pay button
7. Upsell while wallet is open: post-purchase upsells, order bumps, bundle offers
8. Dark mode default. Light mode optional.

## ANTI-PATTERNS (NEVER)
- Component libraries (Shadcn, DaisyUI)
- Nav bars with 6+ links on sales pages
- Generic stock illustrations or abstract SVG blobs
- Price below the fold on mobile
- "Learn More" when you mean "Buy Now"
- Sales pages over 100KB without justification
- Loading spinners (too slow = redesign)
