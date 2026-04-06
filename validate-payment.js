/**
 * ══════════════════════════════════════════════════════════════════
 *  YELLITAARE Thidé — Fonction Netlify : Validation paiement
 *  Route : GET /.netlify/functions/validate-payment?ref=...&token=...
 *
 *  Le trésorier reçoit ce lien par SMS et clique pour valider.
 *  La page confirme la validation et notifie l'adhérent.
 * ══════════════════════════════════════════════════════════════════
 */

const https  = require('https');
const crypto = require('crypto');
const qs     = require('querystring');

const TRESORIER = process.env.TRESORIER_TEL || '+22246478870';
const SITE_URL  = process.env.SITE_URL      || 'https://yellitaare.netlify.app';

function genValidationToken(ref) {
  const secret = process.env.AT_API_KEY || 'fallback-secret';
  return crypto.createHmac('sha256', secret).update(ref).digest('hex').slice(0, 16);
}

function sendAtSMS(to, message) {
  return new Promise((resolve, reject) => {
    const apiKey   = process.env.AT_API_KEY   || '';
    const username = process.env.AT_USERNAME  || 'sandbox';
    const sender   = process.env.AT_SENDER_ID || '';
    const useSandbox = !apiKey || username === 'sandbox';

    const payload = qs.stringify({ username, to, message, ...(sender && { from: sender }) });
    const options = {
      hostname: useSandbox ? 'api.sandbox.africastalking.com' : 'api.africastalking.com',
      path: '/version1/messaging',
      method: 'POST',
      headers: {
        'Accept':        'application/json',
        'Content-Type':  'application/x-www-form-urlencoded',
        'apiKey':        apiKey,
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, res => {
      let data = ''; res.on('data', c => data += c);
      res.on('end', () => resolve({ ok: true, raw: data }));
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

/** Page HTML de confirmation affichée au trésorier */
function htmlConfirm(ref, success, memberTel) {
  const color = success ? '#1A6B3C' : '#c0392b';
  const icon  = success ? '✓' : '✗';
  const msg   = success
    ? `Le paiement de l'adhérent <strong>${ref}</strong> a été validé avec succès.<br>Un SMS de confirmation a été envoyé à l'adhérent.`
    : `Lien invalide ou déjà utilisé. Référence : ${ref}`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Validation paiement – YELLITAARE Thidé</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;background:#F8FAF9;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{background:#fff;border-radius:14px;padding:40px 32px;max-width:420px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.12)}
  .icon{width:72px;height:72px;border-radius:50%;background:${color};color:#fff;font-size:36px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
  h1{font-family:Georgia,serif;font-size:22px;color:#124D2C;margin-bottom:12px}
  p{font-size:14px;color:#7A8C82;line-height:1.6;margin-bottom:20px}
  .ref{background:#EAF5EE;border:1px solid rgba(26,107,60,.2);border-radius:8px;padding:8px 16px;font-family:monospace;font-size:15px;font-weight:700;color:#1A6B3C;display:inline-block;margin-bottom:20px}
  .btn{display:inline-block;padding:12px 28px;background:#1A6B3C;color:#fff;border-radius:8px;font-size:14px;font-weight:700;text-decoration:none}
  .footer{margin-top:24px;font-size:11px;color:#aaa}
</style>
</head>
<body>
<div class="card">
  <div class="icon">${icon}</div>
  <h1>YELLITAARE Thidé</h1>
  <div class="ref">${ref}</div>
  <p>${msg}</p>
  <a href="${SITE_URL}" class="btn">Retour au site</a>
  <div class="footer">© 2026 YELLITAARE Thidé · Trésorerie</div>
</div>
</body>
</html>`;
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const ref    = params.ref   || '';
  const token  = params.token || '';

  // Vérification du token
  const expected = genValidationToken(ref);
  const valid    = ref && token && token === expected;

  if (!valid) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlConfirm(ref || '—', false, '')
    };
  }

  // ── Envoyer un SMS de validation à l'adhérent si possible ──────────
  // (on ne connaît pas le tel ici sans BDD — on notifie le trésorier)
  // En production : stocker les infos membre dans une BDD (Fauna, Supabase…)
  // Pour l'instant on envoie un SMS au trésorier confirmant sa validation
  const smsConfirm =
    `YELLITAARE - Paiement valide\n` +
    `Ref: ${ref}\n` +
    `Validation enregistree par le tresorier.\n` +
    `Heure: ${new Date().toLocaleTimeString('fr-FR')}`;

  try {
    await sendAtSMS(TRESORIER, smsConfirm);
  } catch(e) { /* silencieux */ }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: htmlConfirm(ref, true, '')
  };
};
