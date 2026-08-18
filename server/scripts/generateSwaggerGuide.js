import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openApiDocument from "../docs/openapi.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(here, "../../docs");
const outputFile = path.join(outputDirectory, "SwiftOpsBD-Swagger-API-Testing-Guide.html");
const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const code = (value) => `<code>${escapeHtml(value)}</code>`;

const createdOperations = new Set([
  "POST /api/v1/care-plans",
  "POST /api/v1/care-requests/{requestId}/respond",
  "POST /api/v1/shifts/clock-in",
  "POST /api/v1/medical-documents",
  "POST /api/v1/communications/conversations",
  "POST /api/v1/communications/support-conversation",
  "POST /api/v1/communications/conversations/{conversationId}/messages",
  "POST /api/v1/incidents",
  "POST /api/v1/payments/care-plans/{carePlanId}/billing",
  "POST /api/v1/payments/invoices/{invoiceId}/checkout",
  "POST /api/v1/payments/withdrawals",
  "POST /api/v1/admin/payments/invoices",
  "POST /api/v1/admin/payments/assignment-payouts",
  "POST /api/v1/admin/communications/conversations/{conversationId}/messages",
  "POST /api/v1/admin/directory/clients/{clientId}/renew-care",
]);

const operations = Object.entries(openApiDocument.paths).flatMap(
  ([route, methods]) => Object.entries(methods).map(([method, operation]) => ({
    route, method, operation,
  })),
);

const requestExample = (operation) => {
  const content = operation.requestBody?.content || {};
  if (content["multipart/form-data"]) return "Choose a valid local file in the file field.";
  const example = content["application/json"]?.example;
  return example ? JSON.stringify(example, null, 2) : "No request body";
};

const expected = ({ route, method, operation }) => {
  if (route.endsWith("stripe/webhook")) return "Signed Stripe event accepted; use Stripe CLI, not Swagger Execute.";
  if (route.includes("sslcommerz/")) return "Validated provider callback or result redirect.";
  if (operation.requestBody?.content?.["multipart/form-data"]) return "File metadata returned; authorized listing/download now contains the upload.";
  if (route.includes("/download") || route.endsWith("/photo")) return "Binary file with correct content type; unrelated accounts receive 403/404.";
  if (method === "get") return `JSON data for: ${operation.summary}.`;
  if (method === "delete") return "Confirmation returned and the following list/GET no longer contains the resource.";
  return `${operation.summary} is confirmed; re-run its related GET to verify persistence.`;
};

const phases = [
  ["0 — Start and public routes", "No token", [
    ["GET /api/v1/health", "200; data.status=ok, version=v1 and requestId exists."],
    ["GET /api/v1/directory/caregivers", "200; only approved, visible, non-suspended caregivers."],
    ["GET public caregiver photo", "200 image when a real photo exists; otherwise 404."],
  ]],
  ["1 — Identity and roles", "New Firebase user", [
    ["POST /api/v1/users/bootstrap", "200; users/{uid} created or synchronized."],
    ["GET /api/v1/users/me", "200; authenticated account and protected role."],
    ["POST /api/v1/users/me/account-type", "200; one-time client/caregiver role selection."],
    ["GET permissions and PATCH me", "200; allowed fields change, protected claims do not."],
  ]],
  ["2 — Caregiver onboarding", "Caregiver, then admin", [
    ["GET onboarding/me", "200; onboarding record exists."],
    ["PUT profile", "200; services, postal code, hourly rate and identity saved."],
    ["POST files/{kind}", "201; photo/NID/license/resume stored privately."],
    ["PUT assessment and POST submit", "200; record becomes review-ready."],
    ["Admin GET onboarding and files", "200; submitted evidence appears only to admin."],
    ["Admin PATCH caregiver review", "200; verification becomes approved."],
    ["Admin PATCH directory visibility", "200; approved active caregiver becomes public."],
  ]],
  ["3 — Client onboarding", "Client, then admin", [
    ["GET client-onboarding/me", "200; client record exists."],
    ["PUT profile and contact", "200; identity, contact and Bangladesh map pin saved."],
    ["POST files/{kind}", "201; NID/medical files stored privately."],
    ["POST submit", "200; record becomes review-ready."],
    ["Admin GET and PATCH client review", "200; client becomes approved."],
  ]],
  ["4 — Care plan, deposit and matching", "Approved client, then admin", [
    ["POST care-plans", "201; save planId and schedule fields."],
    ["POST care-plan billing", "201; locked 35% deposit and 65% balance created."],
    ["POST invoice checkout", "201; Stripe hosted URL returned."],
    ["Complete Stripe test checkout", "Webhook marks deposit paid exactly once."],
    ["POST care plan submit", "200/201; paid verified request becomes open."],
    ["Admin GET care-requests", "200; request appears under Open."],
    ["Admin PATCH request assign", "200; request moves to Assigned."],
  ]],
  ["5 — Assignment and schedules", "Caregiver, client and admin", [
    ["GET available requests and POST respond", "200 then 201; response recorded once."],
    ["GET assignments/mine", "200; exactly the assigned users can see it."],
    ["PATCH assignment confirm", "200; assignment becomes confirmed."],
    ["GET assignment visits", "200; service-date calendar visits generated."],
  ]],
  ["6 — Maps, shifts, visits and attendance", "Role shown by Swagger", [
    ["Map autocomplete/reverse/route", "200; normalized Bangladesh address and route data."],
    ["POST shift clock-in", "201; one active server-timed shift."],
    ["POST visit clock-in", "200; confirmed visit active with geofence evidence."],
    ["PATCH progress/location", "200; assigned tasks, notes and GPS update."],
    ["POST visit complete", "200; report/duration saved and removed from live visits."],
    ["POST shift clock-out", "200; caregiver removed from active shifts."],
    ["GET attendance/mine", "200; real totals, calendar and duty state."],
  ]],
  ["7 — Medical documents and communication", "Client/caregiver/admin", [
    ["POST and GET medical documents", "201 then 200; only owned medical files appear."],
    ["Admin GET documents", "200; system document index includes real files."],
    ["POST assignment conversation/message", "201; only both participants can read."],
    ["POST support conversation/message", "201; admin-addressed support flow works."],
  ]],
  ["8 — Final payment and caregiver payout", "Client, admin, caregiver", [
    ["Checkout final 65% invoice", "201; Stripe URL, webhook and paid invoice."],
    ["GET both invoice links/PDF", "200 for client owner/admin."],
    ["Admin GET payout quotes", "200; 85% caregiver share and platform margin."],
    ["Admin POST assignment payout", "201; caregiver wallet earning updates."],
    ["GET caregiver payslip", "200 protected PDF."],
  ]],
  ["9 — Incidents, dashboard and reports", "User then admin", [
    ["POST incident/SOS", "201; affected visit and participants stored."],
    ["Admin GET/PATCH incident", "200; review/escalation/resolution history."],
    ["GET admin dashboard overview", "200; real operational/financial totals."],
    ["GET admin reports overview", "200; date-bounded report."],
  ]],
];

const phaseHtml = phases.map(([title, token, steps]) => `
<section><h3>Phase ${escapeHtml(title)}</h3><p><strong>Token:</strong> ${escapeHtml(token)}</p>
<table><thead><tr><th>Operation</th><th>Expected result</th></tr></thead><tbody>
${steps.map(([operation, result]) => `<tr><td>${code(operation)}</td><td>${escapeHtml(result)}</td></tr>`).join("")}
</tbody></table></section>`).join("");

const catalogHtml = openApiDocument.tags.map(({ name }) => {
  const tagged = operations.filter(({ operation }) => operation.tags.includes(name));
  if (!tagged.length) return "";
  const rows = tagged.map((entry) => {
    const { route, method, operation } = entry;
    const access = operation.security?.length ? operation.description || "Authenticated" : "Public";
    const status = createdOperations.has(`${method.toUpperCase()} ${route}`) ? "201" : "200";
    return `<tr><td><span class="method ${method}">${method.toUpperCase()}</span> ${code(route)}<br><small>${escapeHtml(operation.summary)}</small></td><td>${escapeHtml(access)}</td><td><pre>${escapeHtml(requestExample(operation))}</pre></td><td><strong>${status}</strong><br>${escapeHtml(expected(entry))}</td></tr>`;
  }).join("");
  return `<section class="catalog"><h3>${escapeHtml(name)}</h3><table><thead><tr><th>Method and path</th><th>Access</th><th>Swagger input</th><th>Expected</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}).join("");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SwiftOpsBD Swagger API Testing Guide</title>
<style>:root{--blue:#0649ad;--navy:#101c2d;--line:#cbd5e1;--soft:#eef4ff;--red:#b91c1c}*{box-sizing:border-box}body{margin:0;color:var(--navy);font:14px/1.55 Arial,sans-serif;background:#f8fafc}main{max-width:1120px;margin:auto;background:white;padding:42px}h1{font-size:34px;color:var(--blue);margin:0}h2{margin-top:38px;border-bottom:2px solid var(--blue);padding-bottom:8px;color:var(--blue)}h3{margin-top:26px}.cover{padding:50px 0 35px;border-bottom:5px solid var(--blue)}.meta{color:#475569}.notice{border-left:5px solid var(--blue);background:var(--soft);padding:15px 18px;margin:18px 0}.danger{border-color:var(--red);background:#fff1f2}code,pre{font-family:Consolas,monospace}code{background:#edf2f7;padding:2px 5px;border-radius:4px}pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}table{width:100%;border-collapse:collapse;margin:12px 0 22px;page-break-inside:auto}th,td{border:1px solid var(--line);padding:9px;vertical-align:top;text-align:left}th{background:#e8f0ff;color:#0b3f8f}tr{page-break-inside:avoid}.method{display:inline-block;min-width:52px;padding:2px 6px;color:white;text-align:center;border-radius:4px;font-weight:bold}.get{background:#1677c8}.post{background:#198754}.put{background:#b7791f}.patch{background:#7c3aed}.delete{background:#dc2626}.checklist li{list-style:"☐  "}.page-break{page-break-before:always}.catalog h3{background:var(--navy);color:white;padding:10px 12px}footer{margin-top:40px;border-top:1px solid var(--line);padding-top:15px;color:#64748b}@media print{body{background:white;font-size:10px}main{max-width:none;padding:16mm}h2{page-break-after:avoid}.catalog{page-break-before:always}a{color:inherit;text-decoration:none}}</style></head><body><main>
<header class="cover"><h1>SwiftOpsBD Swagger API Testing Guide</h1><p>Complete localhost and deployment verification handbook</p><p class="meta">OpenAPI 3.1 • ${operations.length} operations • Generated ${new Date().toISOString().slice(0, 10)}</p></header>
<h2>1. Purpose and safety</h2><p>Test sequentially because later APIs depend on IDs and states created earlier. This covers Firebase Authentication, Firestore, Supabase private files, Barikoi maps, Stripe test Checkout and all three user roles.</p><div class="notice danger"><strong>Never enter:</strong> Firebase service-account JSON, Stripe/Supabase secrets, real card data, CVV, PIN or OTP. Swagger needs only Firebase ID tokens and test values.</div>
<h2>2. Prerequisites and startup</h2><ul class="checklist"><li>Node.js 22+</li><li>Private backend .env configured and ignored</li><li>Firebase/Firestore ready</li><li>Supabase private bucket ready for file tests</li><li>Barikoi key ready</li><li>Stripe test keys ready</li></ul><h3>Backend terminal</h3><pre>cd /d/SoftwareProject/swyftopsbd-api<br>npm install<br>npm run dev</pre><p>Expect: ${code("SwiftOpsBD API listening on http://localhost:4000")}</p><h3>Stripe terminal (payment phases)</h3><pre>stripe listen --forward-to localhost:4000/api/v1/payments/stripe/webhook</pre><p>Put its whsec value only in backend .env and restart the API.</p>
<h2>3. Swagger site</h2><ol><li>Open ${code("http://localhost:4000/api-docs")}.</li><li>Expand a category and operation.</li><li>Click <strong>Try it out</strong>.</li><li>Fill safe path/query/body values.</li><li>Click <strong>Execute</strong>.</li><li>Check URL, status and response body.</li><li>Save returned IDs privately for later steps.</li></ol><p>OpenAPI JSON: ${code("http://localhost:4000/api-docs.json")}</p>
<h2>4. Firebase authorization</h2><ol><li>Log into the frontend as the role being tested.</li><li>Open F12 → Network.</li><li>Select an API request such as /api/v1/users/me.</li><li>In Request Headers copy only the value after Authorization: Bearer.</li><li>In Swagger click Authorize, paste only the token, and confirm.</li></ol><p>If a call suddenly returns 401, refresh/sign in, copy a new Firebase token and authorize again. Client, caregiver and admin require separate tokens.</p>
<h2>5. Status codes</h2><table><thead><tr><th>Code</th><th>Expected meaning/action</th></tr></thead><tbody><tr><td>200</td><td>Read/update/action succeeded; inspect data and verify through GET.</td></tr><tr><td>201</td><td>Created; save the returned ID.</td></tr><tr><td>400</td><td>Bad body/query/upload.</td></tr><tr><td>401</td><td>Token missing, invalid or expired.</td></tr><tr><td>403</td><td>Wrong role/ownership; expected during security testing.</td></tr><tr><td>404</td><td>ID absent or intentionally hidden from this user.</td></tr><tr><td>409</td><td>State conflict or repeated one-time action.</td></tr><tr><td>422</td><td>Read error.fields and correct validation.</td></tr><tr><td>500</td><td>Copy requestId and inspect the API terminal/configuration.</td></tr></tbody></table>
<h2>6. End-to-end order</h2>${phaseHtml}
<h2 class="page-break">7. Negative security tests</h2><ul><li>No token on protected endpoint → 401.</li><li>Client token on caregiver/admin endpoint → 403.</li><li>User A reading user B assignment/document → 403/404.</li><li>Unsupported or oversized upload → 400.</li><li>Coordinates outside Bangladesh → validation failure.</li><li>Unsigned Stripe webhook through Swagger → rejection.</li><li>Repeat payment/response/complete action → no duplicate record.</li></ul>
<h2>8. Final checklist</h2><ul class="checklist"><li>Automated backend tests pass</li><li>All three role tokens tested</li><li>Both onboarding workflows approved</li><li>Real caregiver appears publicly</li><li>Deposit creates matching request</li><li>Assignment appears for both users</li><li>Clock-in/out updates live operations and attendance</li><li>Private documents reject unrelated users</li><li>Stripe settles once and invoices download</li><li>Payout/payslip correct</li><li>Incident and reports update</li><li>No secrets entered or committed</li></ul>
<h2 class="page-break">9. Every Swagger operation</h2><p>Replace IDs in braces with IDs returned during earlier phases.</p>${catalogHtml}<footer>SwiftOpsBD API testing handbook. Keep credentials, tokens and record IDs private.</footer></main></body></html>`;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputFile, html, "utf8");
console.log(`Generated ${outputFile}`);
