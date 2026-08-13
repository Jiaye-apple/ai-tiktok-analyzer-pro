import { Hono } from 'hono';
import type { Env } from '../lib/types';
import { BRAND_NAME, brandTitle, html, page } from '../site/layout';

/**
 * 合规页面：服务条款 / 隐私政策 / 退款政策。
 *
 * 支付服务商（MoR）开户审核会逐条核对这三个页面，且要求在结账前可达，
 * 所以统一放公开路由，不需要登录，页脚也挂了入口。
 *
 * 内容口径必须和 /price 页实际售卖的功能一致 —— 审核会拿网站和申报材料对照。
 */

const r = new Hono<{ Bindings: Env }>();

const LAST_UPDATED = 'August 7, 2026';

const MERCHANT = {
  name: 'AI TikTok Downloader Pro Team',
  email: 'support@poviai.com',
  site: 'https://tiktok.poviai.com',
};

/** 法务长文页统一排版 */
const LEGAL_CSS = `
  main{max-width:820px;padding:40px 20px 60px}
  .legal h1{font-size:28px;margin:0 0 6px}
  .legal .updated{color:var(--muted);font-size:13px;margin-bottom:28px}
  .legal h2{font-size:17px;margin:30px 0 8px}
  .legal p,.legal li{font-size:14.5px;line-height:1.85;color:var(--ink)}
  .legal ul{padding-left:20px;margin:8px 0}
  .legal li{margin:4px 0}
  .legal .box{
    border:1px solid var(--line);border-radius:var(--r-sm);
    padding:14px 16px;margin:18px 0;font-size:14px;line-height:1.8;
  }
  .legal a{color:var(--accent)}
`;

function legalPage(path: string, title: string, bodyHtml: string): Response {
  return html(
    page({
      title: brandTitle(title),
      // 法务页可索引（canonical/hreflang 正常发），只是不进 sitemap
      seo: { path },
      style: LEGAL_CSS,
      body: `<div class="legal card">${bodyHtml}</div>`,
    }),
  );
}

/** 商户主体信息块，三个页面共用 */
const MERCHANT_BOX = `<div class="box">
  <strong>${BRAND_NAME}</strong><br>
  ${MERCHANT.name}<br>
  Contact: <a href="mailto:${MERCHANT.email}">${MERCHANT.email}</a><br>
  Website: <a href="${MERCHANT.site}">${MERCHANT.site}</a>
</div>`;

// ---------------------------------------------------------------- Terms

r.get('/terms', () =>
  legalPage(
    '/terms',
    'Terms & Conditions',
    `<h1>Terms &amp; Conditions</h1>
<p class="updated">Last updated: ${LAST_UPDATED}</p>

<p>These Terms &amp; Conditions ("Terms") govern your access to and use of ${BRAND_NAME}
(the "Service"), a web application and browser extension for TikTok creator research and
AI-assisted content analysis. By creating an account, installing the extension, or purchasing
a plan, you agree to these Terms. If you do not agree, do not use the Service.</p>

${MERCHANT_BOX}

<h2>1. The Service</h2>
<p>${BRAND_NAME} helps marketers, agencies and researchers study publicly available TikTok
creator and content data. Paid features include:</p>
<ul>
  <li><strong>Creator search and ranking</strong> — search public creator profiles and browse category rankings with advanced filters.</li>
  <li><strong>Creator detail analysis</strong> — audience, category and performance breakdowns for a public profile.</li>
  <li><strong>Similar Creator discovery</strong> — find creators related to a target public profile and organise them into lists.</li>
  <li><strong>AI speech-to-text transcription</strong> — convert the audio of a public video into text, and derive structured scripts, summaries and highlights from that text.</li>
  <li><strong>Southeast Asia commerce-video insights</strong> — review public product-promotion videos across supported Southeast Asian markets.</li>
  <li><strong>AI script generation</strong> — generate draft scripts and copy from your own inputs and from transcripts you produced.</li>
  <li><strong>Data export</strong> — export your research results and saved lists.</li>
  <li><strong>Universal Credits</strong> — a prepaid unit consumed by eligible AI analysis and creator-research tasks after the allowances included in your plan are used.</li>
  <li><strong>Video download</strong> — download public videos that you are entitled to use, subject to section 3 below.</li>
</ul>
<p>Features, quotas and prices are described on our <a href="/price">Pricing</a> page and may
change; material changes take effect from your next billing period.</p>

<h2>2. Accounts</h2>
<p>You must be at least 18 years old and provide accurate registration information. You are
responsible for activity under your account and for keeping your credentials secure. Team
plans may include additional seats; the account owner is responsible for all seats.</p>

<h2>3. Acceptable use</h2>
<p>You agree that you will not, and will not permit anyone else to:</p>
<ul>
  <li>use the Service to infringe copyright, trademark, privacy or publicity rights of any person;</li>
  <li>use the Service to circumvent, disable or interfere with any technical protection measure,
      access control or rate limit of TikTok or any other platform;</li>
  <li>redistribute, resell or publicly republish third-party content obtained through the Service
      unless you hold the necessary rights;</li>
  <li>use the Service in violation of TikTok's Terms of Service or any applicable law;</li>
  <li>resell, sublicense or share your account, API access or quota with third parties;</li>
  <li>attempt to reverse engineer, overload, or gain unauthorised access to the Service.</li>
</ul>
<p>You are solely responsible for how you use the outputs of the Service, including transcripts
and generated scripts, and for obtaining any permission required for your intended use.</p>

<h2>4. Subscriptions and renewals</h2>
<p>Plus and Pro are subscriptions billed in advance, monthly or annually, in US dollars. Unless
you cancel, subscriptions renew automatically at the end of each billing period at the then-current
price. Included monthly allowances reset at the start of each monthly cycle and do not roll over.</p>
<p>You can cancel at any time from your account page or by emailing
<a href="mailto:${MERCHANT.email}">${MERCHANT.email}</a>. Cancellation stops future renewals; your
plan stays active until the end of the period you already paid for.</p>

<h2>5. One-time add-on packs</h2>
<p>Add-on packs (transcription uses, Similar Creator tasks, Southeast Asia video views, Universal
Credits) are one-time digital purchases. The purchased quota is credited to your account
automatically after payment, does not reset monthly, and does not expire while your account is
active. Monthly allowances included in a plan are consumed before purchased packs.</p>

<h2>6. Prices, taxes and payment</h2>
<p>All prices are shown in US dollars and exclude applicable taxes unless stated otherwise. Payments
are processed by our payment provider acting as Merchant of Record, which collects and remits
applicable VAT, GST and sales tax and issues your invoice. We do not store your card details.</p>

<h2>7. Refunds</h2>
<p>See our <a href="/refund">Refund Policy</a>, which forms part of these Terms.</p>

<h2>8. Digital delivery</h2>
<p>The Service is delivered digitally. Access and quotas are activated automatically once payment
is confirmed, normally within a few minutes. No physical goods are shipped.</p>

<h2>9. Intellectual property</h2>
<p>The Service, including its software, interface and documentation, belongs to us and is licensed,
not sold. You keep ownership of the content you upload and of the research outputs you generate,
subject to the rights of the original rightsholders in any third-party material you analyse.</p>

<h2>10. Availability and third-party data</h2>
<p>The Service depends on publicly available third-party data and on third-party AI providers.
We do not guarantee uninterrupted availability, and results may be incomplete or inaccurate.
The Service is provided "as is" without warranties of any kind to the extent permitted by law.</p>

<h2>11. Limitation of liability</h2>
<p>To the maximum extent permitted by law, our aggregate liability arising out of or relating to
the Service is limited to the amount you paid us in the twelve months before the event giving rise
to the claim. We are not liable for indirect, incidental or consequential damages, or for lost
profits or data.</p>

<h2>12. Suspension and termination</h2>
<p>We may suspend or terminate access if you breach these Terms, if required by law, or to protect
the Service or other users. You may stop using the Service at any time and request deletion of your
account by contacting us.</p>

<h2>13. Changes to these Terms</h2>
<p>We may update these Terms. The "last updated" date above reflects the current version. Continued
use after an update means you accept the revised Terms.</p>

<h2>14. Governing law</h2>
<p>These Terms are governed by the laws of the People's Republic of China, without regard to
conflict-of-law rules. Nothing here removes any mandatory consumer protection you have under the
law of your country of residence.</p>

<h2>15. Contact</h2>
<p>Questions about these Terms: <a href="mailto:${MERCHANT.email}">${MERCHANT.email}</a>. We reply
within 24 hours on business days.</p>`,
  ),
);

// -------------------------------------------------------------- Privacy

r.get('/privacy', () =>
  legalPage(
    '/privacy',
    'Privacy Policy',
    `<h1>Privacy Policy</h1>
<p class="updated">Last updated: ${LAST_UPDATED}</p>

<p>This policy explains what personal data ${BRAND_NAME} collects, why we collect it, who we share
it with, and the rights you have. It applies to our website, web application and browser extension.</p>

${MERCHANT_BOX}

<h2>1. Data we collect</h2>
<ul>
  <li><strong>Account data</strong> — email address, and, if you sign in with Google, the name,
      email and profile picture Google returns. We never receive your Google password.</li>
  <li><strong>Purchase data</strong> — plan, order id, amount, billing period and invoice records.
      Card numbers are handled by our payment provider and never reach our servers.</li>
  <li><strong>Usage data</strong> — features used, quota consumption, timestamps, request logs,
      IP address, browser and device type, and error diagnostics.</li>
  <li><strong>Content you submit</strong> — public TikTok links, creator lists, saved collections,
      audio you send for transcription and prompts you send for script generation.</li>
  <li><strong>Support data</strong> — messages, feedback and attachments you send us.</li>
</ul>
<p>We do not collect your TikTok password and we do not ask you to log in to TikTok through us.</p>

<h2>2. Why we use it</h2>
<ul>
  <li>to provide the Service, apply your plan quotas and deliver results;</li>
  <li>to process payments, renewals, invoices and refunds;</li>
  <li>to keep the Service secure, prevent abuse and debug failures;</li>
  <li>to answer support requests;</li>
  <li>to comply with legal, tax and accounting obligations.</li>
</ul>
<p>Where required, our legal bases are performance of a contract, our legitimate interest in running
and securing the Service, and compliance with legal obligations.</p>

<h2>3. Service providers we share data with</h2>
<ul>
  <li><strong>Payment provider (Merchant of Record)</strong> — processes your payment, tax and
      invoicing. Receives your email, billing country and order details.</li>
  <li><strong>Google Sign-In</strong> — if you choose to sign in with Google.</li>
  <li><strong>AI processing providers</strong> — audio and text you submit for transcription or
      script generation are sent to third-party AI inference providers to produce the result.</li>
  <li><strong>Cloudflare</strong> — hosting, CDN, database and edge security for this website and API.</li>
</ul>
<p>We do not sell your personal data and we do not share it for cross-context behavioural advertising.</p>

<h2>4. Cookies</h2>
<p>We use strictly necessary cookies to keep you signed in and to remember your language choice.
We do not use advertising cookies. Blocking essential cookies will stop sign-in from working.</p>

<h2>5. Retention</h2>
<p>Account and usage data is kept while your account is active. Transaction and invoice records are
kept as long as tax and accounting law requires. Submitted audio and generated transcripts are kept
so you can access your results, and are deleted when you delete the item or your account.</p>

<h2>6. Your rights</h2>
<p>Depending on where you live, you may have the right to access, correct, export or delete your
personal data, to object to or restrict processing, and to withdraw consent. Email
<a href="mailto:${MERCHANT.email}">${MERCHANT.email}</a> and we will respond within 30 days. You may
also complain to your local data protection authority.</p>

<h2>7. International transfers</h2>
<p>We operate globally and our providers may process data outside your country, including in the
United States and the European Union. Where required we rely on appropriate safeguards such as
standard contractual clauses.</p>

<h2>8. Children</h2>
<p>The Service is not intended for anyone under 18, and we do not knowingly collect data from
children. If you believe a minor has given us data, contact us and we will delete it.</p>

<h2>9. Security</h2>
<p>Traffic is encrypted in transit with TLS, access to production data is restricted, and secrets are
stored in an encrypted secret store. No system is perfectly secure; if a breach affects you we will
notify you as required by law.</p>

<h2>10. Changes</h2>
<p>We may update this policy; the "last updated" date shows the current version. Material changes
will be announced on this page.</p>

<h2>11. Contact</h2>
<p>Privacy questions: <a href="mailto:${MERCHANT.email}">${MERCHANT.email}</a>.</p>`,
  ),
);

// --------------------------------------------------------------- Refund

r.get('/refund', () =>
  legalPage(
    '/refund',
    'Refund Policy',
    `<h1>Refund Policy</h1>
<p class="updated">Last updated: ${LAST_UPDATED}</p>

<p>We want you to get value from ${BRAND_NAME}. This policy explains when we refund and how to
ask for one.</p>

${MERCHANT_BOX}

<h2>1. 7-day refund on first subscription payment</h2>
<p>If you are not satisfied, email us within <strong>7 days</strong> of your first Plus or Pro payment
and we will refund it in full, provided you have used no more than 20% of any monthly allowance
included in that plan. Free trial usage before the purchase does not count.</p>

<h2>2. Renewals</h2>
<p>Renewal payments are generally non-refundable, because you can cancel at any time before the
renewal date. If a renewal was clearly unintended — for example you cancelled but were still charged,
or you were charged twice — contact us and we will refund it.</p>

<h2>3. One-time add-on packs</h2>
<p>Add-on packs are credited to your account immediately and are refundable only if the purchased
quota is still completely unused. Once any part of a pack has been consumed, it cannot be refunded.</p>

<h2>4. Service failures</h2>
<p>If the Service is unavailable for an extended period, or a paid feature does not work as described
and we cannot fix it, we will refund the affected period regardless of the windows above.</p>

<h2>5. What is not refunded</h2>
<ul>
  <li>dissatisfaction with third-party data that is incomplete or has been removed at the source;</li>
  <li>accounts suspended for breaching our <a href="/terms">Terms &amp; Conditions</a>;</li>
  <li>quota already consumed.</li>
</ul>

<h2>6. How to request a refund</h2>
<p>Email <a href="mailto:${MERCHANT.email}">${MERCHANT.email}</a> with the email address on the
account and the order id or invoice number. We reply within 24 hours on business days. Approved
refunds are returned to the original payment method by our payment provider, normally within
5–10 business days depending on your bank.</p>

<h2>7. Chargebacks</h2>
<p>Please contact us before opening a chargeback — most issues are resolved the same day and a
chargeback will suspend your account until it is settled.</p>`,
  ),
);

export default r;
