// Cloudflare Pages Function — POST /api/contact
// Sends Lopalm Technologies contact form submissions through SMTP2GO.
// Required secret: SMTP2GO_API_KEY
// Optional env vars: CONTACT_TO, CONTACT_FROM

const TO_DEFAULT = "info@lopalm.com";
const FROM_DEFAULT = "no-reply@lopalm.com";
const MAX_MESSAGE_LENGTH = 5000;
const MAX_FIELD_LENGTH = 300;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function clean(value, maxLength = MAX_FIELD_LENGTH) {
  return (value || "")
    .toString()
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanMessage(value) {
  return (value || "")
    .toString()
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function isValidEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function hasTooManyLinks(text) {
  const matches = text.match(/https?:\/\//gi);
  return matches && matches.length > 3;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  if (!env.SMTP2GO_API_KEY) {
    return json({ ok: false, error: "Mail service is not configured." }, 500);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  // Honeypot fields. Humans should never fill these. Silently accept and drop.
  const honeypotOne = clean(data.company_url);
  const honeypotTwo = clean(data.website);
  if (honeypotOne || honeypotTwo) {
    return json({ ok: true });
  }

  const name = clean(data.name);
  const email = clean(data.email);
  const phone = clean(data.phone);
  const company = clean(data.company);
  const subject = clean(data.subject, 180);
  const message = cleanMessage(data.message);

  if (!name || !email || !subject || !message) {
    return json({ ok: false, error: "Missing required fields." }, 400);
  }

  if (!isValidEmail(email)) {
    return json({ ok: false, error: "Invalid email address." }, 400);
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return json({ ok: false, error: "Message is too long." }, 400);
  }

  // Simple scam/spam reduction. Adjust or remove if legitimate messages include many links.
  if (hasTooManyLinks(message)) {
    return json({ ok: false, error: "Message contains too many links." }, 400);
  }

  const to = clean(env.CONTACT_TO || TO_DEFAULT);
  const from = clean(env.CONTACT_FROM || FROM_DEFAULT);

  const textBody =
    "New website inquiry\n" +
    "-------------------\n" +
    "Name:    " + name + "\n" +
    "Email:   " + email + "\n" +
    "Phone:   " + (phone || "—") + "\n" +
    "Company: " + (company || "—") + "\n" +
    "Subject: " + subject + "\n\n" +
    message + "\n";

  const htmlBody =
    "<h2>New website inquiry</h2>" +
    "<p><strong>Name:</strong> " + escapeHtml(name) + "</p>" +
    "<p><strong>Email:</strong> " + escapeHtml(email) + "</p>" +
    "<p><strong>Phone:</strong> " + escapeHtml(phone || "—") + "</p>" +
    "<p><strong>Company:</strong> " + escapeHtml(company || "—") + "</p>" +
    "<p><strong>Subject:</strong> " + escapeHtml(subject) + "</p>" +
    "<hr>" +
    "<p>" + escapeHtml(message).replace(/\n/g, "<br>") + "</p>";

  try {
    const res = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Smtp2go-Api-Key": env.SMTP2GO_API_KEY
      },
      body: JSON.stringify({
        sender: from,
        to: [to],
        subject: "[Website] " + subject,
        text_body: textBody,
        html_body: htmlBody,
        custom_headers: [
          { header: "Reply-To", value: email }
        ]
      })
    });

    const out = await res.json().catch(() => ({}));
    const succeeded = out && out.data && Number(out.data.succeeded) > 0;

    if (!res.ok || !succeeded) {
      console.log("SMTP2GO send failed", res.status, JSON.stringify(out));
      return json({ ok: false, error: "Email could not be sent." }, 502);
    }

    return json({ ok: true });
  } catch (error) {
    console.log("SMTP2GO unavailable", error && error.message);
    return json({ ok: false, error: "Mail service unavailable." }, 502);
  }
}

function escapeHtml(value) {
  return value
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
