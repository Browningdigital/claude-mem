// ── Sales Engine API ──
export const API_URL = import.meta.env.VITE_API_URL || 'https://sales.devin-b58.workers.dev';

// ── PayPal Config ──
export const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID || '';
export const PAYPAL_MODE = import.meta.env.VITE_PAYPAL_MODE || 'sandbox';

// ── Brand ──
export const BRAND = {
  name: 'Browning Digital',
  tagline: 'AI Infrastructure That Works While You Sleep',
  url: 'https://browningdigital.com',
  email: 'devin@browningdigital.com',
};
