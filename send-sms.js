/**
 * ══════════════════════════════════════════════════════════════════
 *  YELLITAARE Thidé — Fonction Netlify : Envoi SMS
 *  Route : POST /.netlify/functions/send-sms
 *
 *  Variables d'environnement requises (Netlify Dashboard > Site > 
 *  Build & Deploy > Environment variables) :
 *    AT_API_KEY    → Clé API Africa's Talking
 *    AT_USERNAME   → Nom d'utilisateur Africa's Talking (ex: "yellitaare")
 *    AT_SENDER_ID  → Expéditeur (ex: "YELLITAARE" — optionnel, selon pays)
 *    TRESORIER_TEL → Numéro trésorier avec indicatif (+22246478870)
 *    SITE_URL      → URL du site (ex: https://yellitaare.netlify.app)
 * ══════════════════════════════════════════════════════════════════
 */

const https = require('https');
const querystring = require('querystring');
const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────────────────
const AT_BASE     = 'api.africastalking.com';
const AT_SANDBOX  = 'api.sandbox.africastalking.com'; // tests sans frais
const TRESORIER   = process.env.TRESORIER_TEL || '+22246478870';
const SITE_URL    = process.env.SITE_URL      || 'https://yellitaare.netlify.app';

// ── Helpers ─────────────────────────────────────────────────────────

/** Génère un token de validation unique lié à la référence */
function genValidationToken(ref) {
  const secret = process.env.AT_API_KEY || 'fallback-secret';
  return crypto.createHmac('sha256', secret).update(ref).digest('hex').slice(0, 16);
}

/** Appel API Africa's Talking */
function sendAtSMS(to, message) {
  return new Promise((resolve, reject) => {
    const apiKey   = process.env.AT_API_KEY || '';
    const username = process.env.AT_USERNAME || 'sandbox';
    const sender   = process.env.AT_SENDER_ID || '';
    const useSandbox = !apiKey || username === 'sandbox';

    const payload = querystring.stringify({
      username,
      to,
      message,
      ...(sender && { from: sender })
    });

    const options = {
      hostname: useSandbox ? AT_SANDBOX : AT_BASE,
      path: '/version1/messaging',
      method: 'POST',
      headers: {
        'Accept':         'application/json',
        'Content-Type':   'application/x-www-form-urlencoded',
        'apiKey':         apiKey,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const status = json?.SMSMessageData?.Recipients?.[0]?.status;
          if (status === 'Success') resolve({ ok: true, status, sandbox: useSandbox });
          else resolve({ ok: false, status, raw: data, sandbox: useSandbox });
        } catch(e) {
          resolve({ ok: false, raw: data, sandbox: useSandbox });
        }
      });
    });

    req.on('error', err => reject(err));
    req.write(payload);
    req.end();
  });
}

/** Formate le numéro mauritanien */
function formatTel(tel) {
  const clean = tel.replace(/\s/g, '').replace(/^00/, '+');
  if (clean.startsWith('+')) return clean;
  if (clean.startsWith('222')) return '+' + clean;
  return '+222' + clean;
}

// ── Handler principal ────────────────────────────────────────────────
exports.handler = async (event) => {
  // CORS
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON invalide' }) };
  }

  const {
    action,
    reference, nom, telephone, zone,
    categorie, montant, paiement, ref_transaction, date
  } = body;

  if (!reference || !nom || !telephone) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Données manquantes' }) };
  }

  const token       = genValidationToken(reference);
  const telMembre   = formatTel(telephone);
  const validateUrl = `${SITE_URL}/.netlify/functions/validate-payment?ref=${encodeURIComponent(reference)}&token=${token}`;

  // ─────────────────────────────────────────────────────────────────
  //  ACTION : confirm_member — SMS de validation envoyé à l'adhérent
  //  (déclenché depuis le TDB du trésorier)
  // ─────────────────────────────────────────────────────────────────
  if (action === 'confirm_member') {
    const smsConfirmation =
      `YELLITAARE Thide\n` +
      `Bonjour ${nom.split(' ')[0]},\n` +
      `Votre paiement a ete VALIDE\n` +
      `par le Tresorier YELLITAARE.\n` +
      `Ref: ${reference}\n` +
      `Montant: ${montant} (${paiement})\n` +
      `Statut: Membre actif\n` +
      `Espace membre: ${SITE_URL}/espace-membre.html?ref=${encodeURIComponent(reference)}`;

    const res = await sendAtSMS(telMembre, smsConfirmation).catch(e=>({ok:false,error:e.message}));
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, action: 'confirm_member', membre: res })
    };
  }

  // ─────────────────────────────────────────────────────────────────
  //  SMS 1 → TRÉSORIER (notification + lien de validation)
  // ─────────────────────────────────────────────────────────────────
  const smsTresorier =
    `YELLITAARE - Nouvel adhérent:\n` +
    `Nom: ${nom}\n` +
    `Tél: ${telMembre}\n` +
    `Zone: ${zone || '-'}\n` +
    `Cat: ${categorie || '-'}\n` +
    `Montant: ${montant || '-'}\n` +
    `Paiement: ${paiement || '-'}\n` +
    `Réf tx: ${ref_transaction || 'N/A'}\n` +
    `Réf: ${reference}\n` +
    `✓ Valider: ${validateUrl}`;

  // ─────────────────────────────────────────────────────────────────
  //  SMS 2 → MEMBRE (confirmation d'enregistrement)
  // ─────────────────────────────────────────────────────────────────
  const smsMembre =
    `YELLITAARE Thidé\n` +
    `Bonjour ${nom.split(' ')[0]},\n` +
    `Votre adhesion est enregistree.\n` +
    `Ref: ${reference}\n` +
    `Montant: ${montant} (${paiement})\n` +
    `Statut: En attente de validation\n` +
    `Espace membre: ${SITE_URL}/espace-membre.html`;

  // ─────────────────────────────────────────────────────────────────
  //  Envois parallèles
  // ─────────────────────────────────────────────────────────────────
  const results = await Promise.allSettled([
    sendAtSMS(TRESORIER, smsTresorier),
    sendAtSMS(telMembre,  smsMembre)
  ]);

  const resTresorier = results[0].status === 'fulfilled' ? results[0].value : { ok: false, error: results[0].reason?.message };
  const resMembre    = results[1].status === 'fulfilled' ? results[1].value : { ok: false, error: results[1].reason?.message };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      tresorier: resTresorier,
      membre:    resMembre,
      token,                    // renvoyé pour stockage côté client
      validateUrl
    })
  };
};
