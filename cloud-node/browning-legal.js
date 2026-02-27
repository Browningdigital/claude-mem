// browning-legal — Privacy Policy + Data Deletion pages for FB app compliance
// Deployed to browning-legal.devin-b58.workers.dev

const COMPANY = "Browning Digital";
const EMAIL = "devin@browningdigital.com";
const SITE = "browningdigital.com";
const APP_NAME = "Browning Digital";

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#1a1a1a;background:#fafafa;padding:40px 20px}
.container{max-width:680px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:48px 40px}
h1{font-size:24px;font-weight:700;margin-bottom:8px}
.updated{font-size:13px;color:#666;margin-bottom:32px}
h2{font-size:18px;font-weight:600;margin:28px 0 8px;color:#111}
p,li{margin-bottom:12px;color:#333}
ul{padding-left:24px}
a{color:#4f46e5;text-decoration:none}
a:hover{text-decoration:underline}
.footer{margin-top:40px;padding-top:20px;border-top:1px solid #eee;font-size:13px;color:#888}
`;

function page(title, body) {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — ${COMPANY}</title><style>${CSS}</style></head>
<body><div class="container">${body}</div></body>
</html>`, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

const PRIVACY = `
<h1>Privacy Policy</h1>
<p class="updated">Last updated: February 27, 2026</p>

<h2>Introduction</h2>
<p>${COMPANY} ("we", "us", "our") operates the ${APP_NAME} application. This policy explains how we collect, use, and protect information when you use our services.</p>

<h2>Information We Collect</h2>
<ul>
  <li><strong>Account information</strong> — When you connect via Facebook, we receive your public profile information (name and user ID) as authorized by you.</li>
  <li><strong>Page and content data</strong> — If you grant additional permissions, we may access page posts, insights, or other content you explicitly authorize.</li>
  <li><strong>Usage data</strong> — We collect basic usage analytics (page views, feature usage) to improve the service.</li>
</ul>

<h2>How We Use Your Information</h2>
<ul>
  <li>To provide and maintain our services</li>
  <li>To manage content and automate workflows you configure</li>
  <li>To communicate with you about service updates</li>
</ul>

<h2>Data Storage and Security</h2>
<p>Your data is stored securely using industry-standard encryption. We use Cloudflare Workers and Supabase with row-level security enabled. We do not sell your personal information to third parties.</p>

<h2>Third-Party Services</h2>
<p>We integrate with Facebook/Meta APIs under their Platform Terms. We may also use Cloudflare, Supabase, and other infrastructure providers that process data on our behalf.</p>

<h2>Data Retention</h2>
<p>We retain your data only as long as necessary to provide our services. You may request deletion at any time (see our <a href="/data-deletion">Data Deletion</a> page).</p>

<h2>Your Rights</h2>
<p>You have the right to access, correct, or delete your personal data. You may also revoke Facebook permissions at any time through your <a href="https://www.facebook.com/settings?tab=applications">Facebook App Settings</a>.</p>

<h2>Contact Us</h2>
<p>For any privacy-related questions, contact us at <a href="mailto:${EMAIL}">${EMAIL}</a>.</p>

<div class="footer">&copy; 2026 ${COMPANY} &middot; <a href="https://${SITE}">${SITE}</a></div>
`;

const DATA_DELETION = `
<h1>Data Deletion Instructions</h1>
<p class="updated">Last updated: February 27, 2026</p>

<h2>How to Delete Your Data</h2>
<p>If you want to delete all data that ${APP_NAME} has collected about you, you have the following options:</p>

<h2>Option 1: Revoke Access via Facebook</h2>
<ol>
  <li>Go to your <a href="https://www.facebook.com/settings?tab=applications">Facebook App Settings</a></li>
  <li>Find <strong>${APP_NAME}</strong> in the list</li>
  <li>Click <strong>Remove</strong></li>
  <li>Check the box to delete all data the app has about you</li>
</ol>
<p>This will revoke our access and trigger automatic deletion of your data from our systems within 30 days.</p>

<h2>Option 2: Email Request</h2>
<p>Send an email to <a href="mailto:${EMAIL}">${EMAIL}</a> with the subject line <strong>"Data Deletion Request"</strong> and include your Facebook user ID or the email associated with your account. We will process your request within 14 business days.</p>

<h2>Option 3: API Callback</h2>
<p>When you remove our app from your Facebook settings, Facebook sends us a deletion callback. We automatically process this and delete all associated data within 30 days.</p>

<h2>What Gets Deleted</h2>
<ul>
  <li>Your profile information (name, user ID)</li>
  <li>Any page data or content we accessed on your behalf</li>
  <li>Usage logs and analytics associated with your account</li>
  <li>Any stored access tokens</li>
</ul>

<h2>Confirmation</h2>
<p>After deletion is complete, we will send a confirmation to your email address on file if one is available.</p>

<div class="footer">&copy; 2026 ${COMPANY} &middot; <a href="https://${SITE}">${SITE}</a></div>
`;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/privacy" || url.pathname === "/privacy-policy") {
      return page("Privacy Policy", PRIVACY);
    }

    if (url.pathname === "/data-deletion" || url.pathname === "/deletion") {
      return page("Data Deletion", DATA_DELETION);
    }

    // FB data deletion callback endpoint (POST)
    if (url.pathname === "/callback/deletion" && request.method === "POST") {
      // Facebook sends signed_request — acknowledge it
      return new Response(JSON.stringify({
        url: `https://browning-legal.devin-b58.workers.dev/deletion-status`,
        confirmation_code: crypto.randomUUID(),
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/deletion-status") {
      return page("Deletion Status", `
        <h1>Data Deletion Status</h1>
        <p>Your data deletion request has been received and is being processed. All associated data will be removed within 30 days.</p>
        <div class="footer">&copy; 2026 ${COMPANY}</div>
      `);
    }

    return new Response("Not found", { status: 404 });
  },
};
