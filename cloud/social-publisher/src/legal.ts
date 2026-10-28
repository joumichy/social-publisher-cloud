const SERVICE_NAME = "Stellark Social Publisher";

function page(title: string, body: string): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · ${SERVICE_NAME}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0 auto; max-width: 760px; padding: 48px 24px; line-height: 1.65; }
    h1, h2 { line-height: 1.2; }
    h2 { margin-top: 2rem; }
    .muted { opacity: .7; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p class="muted">Last updated: September 8, 2026</p>
    ${body}
  </main>
</body>
</html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

export function privacyPage(): Response {
  return page("Privacy Policy", `
    <p>${SERVICE_NAME} is an internal publishing service operated by Stellark LLC for authorized brand accounts.</p>
    <h2>Data we process</h2>
    <p>We process social-account identifiers, authorization tokens, publication text, media, scheduling instructions, and provider delivery results solely to publish content requested by authorized account administrators.</p>
    <h2>How data is used</h2>
    <p>Data is used only to authenticate with the selected social platform, schedule and deliver approved publications, report delivery status, retry transient failures, and protect the service from unauthorized use. We do not sell personal data or use social-platform data for advertising profiles.</p>
    <h2>Storage and security</h2>
    <p>Authorization tokens are encrypted at rest. Uploaded media uses access-controlled storage and is removed after the configured retention period once it is no longer required for delivery. Access to the administrative API is restricted by a separate secret.</p>
    <h2>Sharing and retention</h2>
    <p>Content and the minimum required account data are sent to Meta, LinkedIn, or TikTok only when a publication targets that provider. Operational records are retained only as needed for publishing, security, and troubleshooting.</p>
    <h2>Your choices</h2>
    <p>An account administrator may revoke platform access at any time and request deletion using the <a href="/data-deletion">data deletion instructions</a>.</p>
  `);
}

export function termsPage(): Response {
  return page("Terms of Use", `
    <p>${SERVICE_NAME} is available only to people authorized by Stellark LLC and by the owners of the connected social accounts.</p>
    <h2>Authorized use</h2>
    <p>Users may schedule only content they are entitled to publish and must comply with the rules of every destination platform. Access credentials may not be shared or used for unrelated accounts.</p>
    <h2>Publishing responsibility</h2>
    <p>The account administrator remains responsible for approving content, publication timing, audience settings, disclosures, and any platform-specific commercial-content declarations.</p>
    <h2>Service operation</h2>
    <p>Delivery can be delayed or rejected by a platform, connectivity issue, token expiry, moderation decision, or API change. The service records outcomes and may retry temporary failures without changing approved content.</p>
    <h2>Access</h2>
    <p>Access may be suspended when necessary to protect accounts, comply with platform requirements, or prevent unauthorized publication.</p>
  `);
}

export function dataDeletionPage(): Response {
  return page("Data Deletion Instructions", `
    <p>To disconnect ${SERVICE_NAME} and delete data associated with a social account:</p>
    <ol>
      <li>Revoke the Stellark Social Publisher application from the connected platform’s application or business settings.</li>
      <li>Ask your Stellark LLC account administrator to remove the corresponding connection from the publisher.</li>
    </ol>
    <p>After verification of the account and request authority, stored authorization tokens, account metadata, pending publications, and retained media for that connection will be deleted. Records that must be retained for security or legal compliance will be minimized and isolated.</p>
  `);
}
