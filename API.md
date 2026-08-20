# SwiftOpsBD REST API

## Architecture

The browser authenticates with Firebase Authentication and sends its Firebase
ID token as a Bearer token. The Express API verifies that token, enforces the
account role, writes structured data to Firestore, and handles private files.

```text
React frontend -> Express /api/v1 -> Firebase Auth + Firestore + private files
```

Firestore browser access remains denied. Firebase Admin performs all database
operations through the authenticated API.

## OpenAPI and Swagger testing

With the API running locally, open the interactive Swagger UI:

```text
http://localhost:4000/api-docs
```

The OpenAPI 3.1 JSON document is served from:

```text
http://localhost:4000/api-docs.json
```

Public routes can be executed immediately. For protected routes, obtain a
Firebase ID token from an authenticated SwiftOpsBD browser session, select
**Authorize**, and paste the ID token. Swagger automatically sends it as an
`Authorization: Bearer ...` header. Different client, caregiver and admin
tokens are required to test their respective role-protected operations.

Stripe webhooks must be tested with the Stripe CLI because Swagger cannot
produce a valid `Stripe-Signature`. Never paste backend secrets, service-account
JSON, payment-card data, PINs, CVVs or OTPs into the documentation interface.

## Private file storage

Local development may use:

```env
FILE_STORAGE_PROVIDER=local
LOCAL_UPLOAD_DIR=uploads
```

Actual file bytes are written under the ignored backend `uploads/` directory.
This is only for localhost.

Deployment uses a private Supabase Storage bucket:

```env
FILE_STORAGE_PROVIDER=supabase
SUPABASE_URL=https://your-project-reference.supabase.co
SUPABASE_SECRET_KEY=backend_sb_secret_key
SUPABASE_STORAGE_BUCKET=swiftops-private-documents
SUPABASE_SIGNED_URL_TTL_SECONDS=900
```

The bucket must remain private. The Express API holds the Supabase secret,
continues to verify Firebase ID tokens and roles, and returns a short-lived
signed download URL only after its ownership/admin checks pass. Firestore
stores the file name, MIME type, size, owner, object path and
`storageProvider: "supabase"`; Supabase stores the bytes.

Recommended bucket restrictions:

```text
Maximum file size: 10 MB
Allowed types:
application/pdf
image/jpeg
image/png
image/webp
application/msword
application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

The Supabase secret key must never be sent to the frontend or
stored in a `VITE_` environment variable.

## Authentication

Every protected endpoint requires:

```http
Authorization: Bearer FIREBASE_ID_TOKEN
```

Roles are stored in protected Firebase custom claims and mirrored in
`users/{uid}`. Current public roles are `client` and `caregiver`. Administrator
roles require the protected `admin: true` claim.

## Health and identity

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/health` | API health |
| `POST` | `/api/v1/users/bootstrap` | Create/synchronize the signed-in account |
| `GET` | `/api/v1/users/me` | Current account |
| `PATCH` | `/api/v1/users/me` | Update shared account fields |
| `POST` | `/api/v1/users/me/account-type` | Select client or caregiver once |
| `GET` | `/api/v1/users/me/permissions` | Effective permissions |

## Caregiver onboarding

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/onboarding/me` | Create/read caregiver onboarding |
| `PUT` | `/api/v1/onboarding/profile` | Save caregiver profile |
| `PUT` | `/api/v1/onboarding/assessment` | Save assessment |
| `POST` | `/api/v1/onboarding/files/:kind` | Upload a private document |
| `DELETE` | `/api/v1/onboarding/files/:kind` | Delete a private document |
| `POST` | `/api/v1/onboarding/submit` | Submit for verification |

Firestore:

```text
caregiverOnboarding/{firebaseUid}
```

Private files:

```text
caregiver-onboarding/{firebaseUid}/{fileKind}/...
```

## Client onboarding (Sprint 2)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/client-onboarding/me` | Create/read client onboarding |
| `PUT` | `/api/v1/client-onboarding/profile` | Save profile and NID number |
| `PUT` | `/api/v1/client-onboarding/contact` | Save contact and pinned location |
| `POST` | `/api/v1/client-onboarding/files/nidFront` | Upload NID front |
| `POST` | `/api/v1/client-onboarding/files/nidBack` | Upload NID back |
| `POST` | `/api/v1/client-onboarding/files/medicalReport` | Upload one optional report |
| `DELETE` | `/api/v1/client-onboarding/files/:kind` | Delete NID front/back |
| `DELETE` | `/api/v1/client-onboarding/files/medicalReport/:fileId` | Delete report |
| `POST` | `/api/v1/client-onboarding/submit` | Lock and submit for review |

Submission body:

```json
{
  "confirmed": true
}
```

Firestore:

```text
clientOnboarding/{firebaseUid}
```

Private files:

```text
client-onboarding/{firebaseUid}/{fileKind}/...
```

NID images and reports are limited to 5 MB per file. At most 10 optional
medical reports may be attached.

## Client medical documents

The medication portal combines medical reports uploaded during client
onboarding with later prescriptions, medication schedules, lab results and
medical reports. NID and other identity documents are intentionally excluded.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/medical-documents/mine` | List the client's medical-only upload history and instructions |
| `POST` | `/api/v1/medical-documents` | Upload one protected PDF or medical image up to 10 MB |
| `PUT` | `/api/v1/medical-documents/instructions` | Save medication instructions for the care team |
| `GET` | `/api/v1/medical-documents/:documentId/download?source=` | Download an owned protected medical file |

Portal uploads are stored as:

```text
clientMedicalDocuments/{documentId}
clientMedicationInstructions/{clientId}
```

The browser refreshes this authenticated API periodically and immediately
inserts successful uploads, providing a near-real-time recent-upload panel
without opening direct Firestore browser access.

## Care plans and matching (Sprint 3)

Sprint 3 publishes a verified client's care plan as a request, lets approved
caregivers respond, and lets an administrator assign the final caregiver.
Payment is intentionally left pending until the finance sprint creates a
server-side invoice and SSLCommerz/bKash transaction.

### Client care plans

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/care-plans` | List the signed-in client's plans |
| `POST` | `/api/v1/care-plans` | Create a validated draft |
| `GET` | `/api/v1/care-plans/requests/mine` | List the client's published requests |
| `GET` | `/api/v1/care-plans/:planId` | Read an owned plan |
| `PUT` | `/api/v1/care-plans/:planId` | Update an owned draft |
| `POST` | `/api/v1/care-plans/:planId/submit` | Publish the plan as an open request |

A client may create drafts after submitting onboarding. Publishing requires
`clientOnboarding/{uid}.verificationStatus == "approved"`.

Each care plan stores the complete client-selected schedule:

```json
{
  "hoursPerWeek": 20,
  "preferredDays": ["Mon", "Wed", "Fri"],
  "preferredTime": "Mornings",
  "preferredStartTime": "09:30",
  "serviceStartDate": "2026-08-03"
}
```

`preferredStartTime` is the exact local visit time and `serviceStartDate`
controls when generated visits may begin. Assignment creation copies these
fields into the canonical assignment and generates four weeks of visit records
in the `Asia/Dhaka` timezone.

### Caregiver request queue

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/care-requests/available` | List matching open requests not yet answered |
| `GET` | `/api/v1/care-requests/:requestId` | Read an available request |
| `POST` | `/api/v1/care-requests/:requestId/respond` | Accept or decline once |

Only approved caregivers can access this queue. A response body is:

```json
{
  "decision": "accepted",
  "note": "Available for the requested morning schedule."
}
```

### Administrator matching

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/admin/care-requests` | List all care requests |
| `GET` | `/api/v1/admin/care-requests/:requestId` | Read request, responses and ranked caregivers |
| `PATCH` | `/api/v1/admin/care-requests/:requestId` | Hold, reopen, decline or assign |

Supported actions are `hold`, `reopen`, `decline`, `assign` and `auto_match`.
Manual assignment includes an approved Firebase caregiver UID:

```json
{
  "action": "assign",
  "caregiverId": "FIREBASE_CAREGIVER_UID"
}
```

## Bangladesh maps and service geofencing (Sprint 7)

Barikoi is called only by the API for address data and routing. This keeps the
private provider key outside browser requests. The frontend uses its separate
public map token only to render Barikoi map tiles.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/maps/autocomplete?q=` | Search Bangladesh addresses (minimum 3 characters) |
| `GET` | `/api/v1/maps/reverse-geocode?latitude=&longitude=` | Convert a selected pin into an address |
| `GET` | `/api/v1/maps/route?originLatitude=&originLongitude=&destinationLatitude=&destinationLongitude=&profile=car` | Return distance, duration and GeoJSON route |

All map endpoints require a Firebase bearer token and validate that coordinates
are inside Bangladesh. Client onboarding persists the service latitude and
longitude. Those coordinates are copied into the care request, assignment and
generated visits so later records do not depend on mutable profile data.

Visit clock-in calculates a Haversine distance from the assigned service
location. It records `withinGeofence`, `distanceFromServiceMeters` and a
150-metre radius. An outside-geofence clock-in is retained for safety and audit
purposes instead of silently discarding the visit.

Required backend environment:

```env
BARIKOI_API_KEY=replace_with_private_barikoi_api_key
BARIKOI_API_BASE_URL=https://barikoi.xyz
```

Firestore records:

```text
carePlans/{carePlanId}
careRequests/{careRequestId}
careRequests/{careRequestId}/responses/{caregiverUid}
```

Care-request states are `open`, `held`, `assigned`, `declined` and
`cancelled`. A caregiver acceptance is stored as a response while the request
remains open for administrator confirmation. Assignment is the authoritative
state transition.

## Assignments and schedules

Assigning or auto-matching an approved caregiver creates:

- `assignments/{requestId}` as the canonical client-caregiver relationship.
- Up to four weeks of `visits/{requestId}_{YYYY-MM-DD}` schedule records.
- An `assigned` care request and care plan.

The assignment is immediately `confirmed` when the selected caregiver already
accepted the request. Otherwise it is `pending_confirmation` until that
caregiver confirms it.

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/assignments/mine` | Client, caregiver | List owned assignments |
| `GET` | `/api/v1/assignments/visits/mine?from=&to=` | Client, caregiver | List owned scheduled visits |
| `GET` | `/api/v1/assignments/attendance/mine` | Client | Real attendance totals, calendar visits and assigned-caregiver duty status |
| `GET` | `/api/v1/assignments/:assignmentId` | Client, caregiver | Assignment and visit details |
| `GET` | `/api/v1/assignments/:assignmentId/caregiver-verification` | Client | Safe approved verification summary for the assigned caregiver |
| `GET` | `/api/v1/assignments/:assignmentId/caregiver-photo` | Client | Protected assigned-caregiver profile photo |
| `PATCH` | `/api/v1/assignments/:assignmentId/confirm` | Caregiver | Confirm a pending assignment |
| `GET` | `/api/v1/admin/assignments` | Admin | List all assignments |
| `GET` | `/api/v1/admin/assignments/visits?from=&to=` | Admin | Calendar visit feed |
| `GET` | `/api/v1/admin/assignments/shifts?status=active` | Admin | Caregiver on-duty feed with latest GPS |

All schedules use the `Asia/Dhaka` timezone and store local service date,
start/end time and duration separately. Clock-in, clock-out and care-report
submission are handled by the Sprint 6 visit-execution API below.

The client verification summary is derived from the current
`caregiverOnboarding/{caregiverId}` record rather than the older assignment
snapshot. It exposes approval status, review dates, credential categories and
completion flags only. NID images, resume contents, assessment answers,
addresses and internal review feedback remain private.

The client attendance response calculates total hours only from authenticated,
completed visits with server clock-in and clock-out timestamps. It reports
whether any caregiver assigned to that client currently has an active shift,
but does not expose a caregiver's general shift GPS. Live GPS is included only
for an active visit belonging to that client.

## Visit execution and attendance (Sprint 6)

Sprint 6 records caregiver work using server timestamps. Browser GPS is
captured when available, but a denied location permission does not discard the
care record. Only the caregiver assigned to a confirmed assignment can change
a visit. Clients can read their completed reports, and administrators can
monitor active visits through the assignment visit feed.

### Caregiver shift clock

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/shifts/mine` | List the caregiver's shift history |
| `GET` | `/api/v1/shifts/active` | Restore the current shift after refresh |
| `POST` | `/api/v1/shifts/clock-in` | Start one authenticated shift |
| `POST` | `/api/v1/shifts/clock-out` | Finish the active shift and calculate duration |
| `PATCH` | `/api/v1/shifts/location` | Update the active shift GPS heartbeat |

Clock-in and clock-out accept an optional location object:

```json
{
  "location": {
    "latitude": 23.8103,
    "longitude": 90.4125,
    "accuracy": 18,
    "capturedAt": "2026-07-27T10:00:00.000Z"
  }
}
```

### Assigned visit execution

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/visits/mine?status=` | List visits owned by the client or caregiver |
| `GET` | `/api/v1/visits/active/mine` | Restore the user's active visit |
| `GET` | `/api/v1/visits/:visitId` | Read one owned visit |
| `POST` | `/api/v1/visits/:visitId/clock-in` | Start a confirmed scheduled visit |
| `PATCH` | `/api/v1/visits/:visitId/progress` | Save assigned tasks and care notes |
| `PATCH` | `/api/v1/visits/:visitId/location` | Update the active visit GPS heartbeat |
| `POST` | `/api/v1/visits/:visitId/complete` | Clock out, submit the report and calculate duration |

Only tasks already present on the assignment may be marked complete. A
caregiver cannot run two active visits simultaneously. Visit and shift
durations are derived from server-controlled timestamps rather than values
provided by the browser.

While a caregiver is clocked in, the frontend sends throttled location
heartbeats. Active visit GPS is visible only to the assigned client and
administrators. General on-duty GPS is available only to administrators.

## Payments and finance (Sprint 8)

Sprint 8 stores all money as numeric BDT amounts rounded to two decimal places.
Invoice totals are calculated by the API, never accepted as a client-provided
total. Firebase authentication and role claims isolate client billing,
caregiver wallets and administrator finance operations.

### Client and caregiver payment endpoints

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/payments/summary` | Client, caregiver | Role-specific wallet, invoices and transactions |
| `GET` | `/api/v1/payments/invoices` | Client | List owned invoices |
| `GET` | `/api/v1/payments/transactions` | Client, caregiver | List owned finance records |
| `POST` | `/api/v1/payments/invoices/:invoiceId/checkout` | Client | Create a hosted Stripe test Checkout or demo bKash session |
| `POST` | `/api/v1/payments/sessions/:sessionId/simulate` | Client | Complete a local test payment; disabled in production |
| `GET` | `/api/v1/payments/payslips/:recordType/:recordId` | Owner, admin | Download a completed transaction, earning or payout PDF |
| `POST` | `/api/v1/payments/withdrawals` | Caregiver | Request a withdrawal against available balance |

### Administrator finance endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/admin/payments/overview` | Reconciled billing, payout and margin totals |
| `GET` | `/api/v1/admin/payments/invoices` | List all client invoices |
| `POST` | `/api/v1/admin/payments/invoices` | Create a server-priced client invoice |
| `GET` | `/api/v1/admin/payments/payouts` | List caregiver withdrawal requests |
| `POST` | `/api/v1/admin/payments/earnings` | Credit a caregiver for a priced visit or adjustment |
| `PATCH` | `/api/v1/admin/payments/payouts/:payoutId` | Process or reject a payout |

Local testing uses:

```env
PAYMENT_MODE=test
PAYMENT_GATEWAY=mock
```

No card number, CVV, bKash PIN or OTP is stored by SwiftOpsBD. A production
gateway integration must redirect to the provider-hosted checkout, validate
the provider callback server-to-server, verify amount/currency/invoice ID and
use an idempotency key before marking an invoice paid.

### SSLCommerz hosted checkout

Set `PAYMENT_MODE=sandbox` and provide the SSLCommerz sandbox store ID and
password. The API creates a hosted session and returns `GatewayPageURL`; React
redirects the client to that URL. The following unauthenticated callback
endpoints must be publicly reachable over HTTPS:

```text
POST /api/v1/payments/sslcommerz/success
POST /api/v1/payments/sslcommerz/fail
POST /api/v1/payments/sslcommerz/cancel
POST /api/v1/payments/sslcommerz/ipn
```

Success and IPN messages are not trusted directly. The backend calls the
SSLCommerz Order Validation API and verifies status, transaction ID, invoice
ID, exact BDT amount, currency and risk level before marking an invoice paid.
Repeated successful callbacks return the already-recorded payment rather than
crediting it twice.

The simplified bKash phone-number panel requires `BKASH_MODE=demo` and is
always disabled when `NODE_ENV=production`. It records a demo payment and
masked phone suffix only; it does not represent a real bKash merchant
transaction. This allows local SSLCommerz sandbox testing and the bKash UI
demo to coexist without enabling fake wallet payments after deployment.

### Stripe test Checkout

Set `PAYMENT_MODE=gateway`, `PAYMENT_GATEWAY=stripe`, and
`PAYMENT_CURRENCY=USD`. Store only Stripe test credentials on the backend:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

The frontend requests a hosted Checkout Session and redirects to Stripe. For
local development, forward signed webhook events with:

```text
stripe listen --forward-to localhost:4000/api/v1/payments/stripe/webhook
```

The webhook verifies Stripe's signature, local session ID, invoice ID, exact
amount, currency, and paid status before finalizing the Firestore transaction.
Repeated events use the local payment session ID as the transaction ID and do
not credit the invoice twice.

Sprint 8 uses these Firestore collections:

```text
invoices/{invoiceId}
paymentSessions/{sessionId}
transactions/{transactionId}
caregiverLedger/{ledgerId}
payouts/{payoutId}
```

## Secure messaging and notifications (Sprint 9)

Sprint 9 creates one private conversation per accepted assignment. The backend
derives both participants from the stored assignment; clients cannot select an
arbitrary caregiver ID and caregivers cannot select an arbitrary client ID.
Only those two Firebase users can read or send assignment messages.
Administrators cannot list an assignment conversation, fetch its messages or
reply to it.

Each client or caregiver also has a separate `support` conversation explicitly
addressed to SwiftOpsBD administrators. Administrators can read and reply only
inside these support conversations. A support reply creates a private in-app
notification for that user.

### Client and caregiver endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/communications/conversations` | List the signed-in user's assignment conversations and unread counts |
| `POST` | `/api/v1/communications/conversations` | Create or restore the conversation for an owned `assignmentId` |
| `POST` | `/api/v1/communications/support-conversation` | Create or restore the signed-in user's admin-support conversation |
| `GET` | `/api/v1/communications/conversations/:id/messages` | Read messages from an owned conversation |
| `POST` | `/api/v1/communications/conversations/:id/messages` | Send a text message as the authenticated participant |
| `PATCH` | `/api/v1/communications/conversations/:id/read` | Update the participant's server-side read marker |
| `GET` | `/api/v1/communications/notifications?unread=true` | List private in-app notifications |
| `PATCH` | `/api/v1/communications/notifications/:id/read` | Mark one owned notification read |
| `PATCH` | `/api/v1/communications/notifications/read-all` | Mark all owned notifications read |

Create/restore body:

```json
{
  "assignmentId": "assignment-document-id"
}
```

Send-message body:

```json
{
  "body": "I have arrived and will begin the scheduled visit."
}
```

### Administrator oversight endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/admin/communications/conversations?flagged=true` | List all or flagged support conversations only |
| `GET` | `/api/v1/admin/communications/conversations/:id/messages` | Read an explicit support conversation |
| `POST` | `/api/v1/admin/communications/conversations/:id/messages` | Reply to the support-conversation owner |
| `PATCH` | `/api/v1/admin/communications/conversations/:id/flag` | Add or remove an audit flag |
| `PATCH` | `/api/v1/admin/communications/conversations/:id/support` | Assign the conversation to the current support admin |

Firestore records:

```text
conversations/{conversationId}
conversations/{conversationId}/messages/{messageId}
notifications/{notificationId}
```

Message sender identity, role and name come from the verified Firebase token,
not the browser request. Message text is limited to 4,000 characters. This
sprint stores text only; private file attachments will use the protected
document-storage adapter in a later sprint and must never be represented by a
client-supplied public URL.

The current protection is server-enforced participant authorization plus HTTPS
in transit and Firebase/Google encryption at rest. It must not be described as
cryptographic end-to-end encryption because the API stores message text and
can technically process it. True E2EE requires per-user device keys, public-key
exchange, encrypted conversation keys, key recovery and encrypted attachment
handling; that should be delivered as a separate audited security sprint.

## Disputes, incidents and emergency SOS (Sprint 11)

Sprint 11 replaces the administrator's dummy incident queue with Firestore
records and an audited resolution workflow. A client or caregiver may report
only an incident linked to a visit or transaction they own. Participant IDs
are derived by the API from those protected records and are never trusted from
the request body.

An emergency SOS submitted from a caregiver visit records the visit,
assignment, client, caregiver and available Bangladesh GPS coordinates. It is
created directly in `in_review` with `critical` severity. This workflow alerts
SwiftOpsBD operations; it does not replace calling Bangladesh emergency
services.

### Client and caregiver endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/incidents/mine` | List incidents involving the signed-in user |
| `GET` | `/api/v1/incidents/:incidentId` | Read one owned incident |
| `POST` | `/api/v1/incidents` | Report an SOS, complaint, payment dispute or no-show |

SOS body:

```json
{
  "type": "sos",
  "visitId": "authenticated-owned-visit-id",
  "location": {
    "latitude": 23.8103,
    "longitude": 90.4125,
    "accuracy": 18,
    "capturedAt": "2026-07-29T10:00:00.000Z"
  }
}
```

### Administrator endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/admin/incidents` | Filter the queue by type, severity or status |
| `GET` | `/api/v1/admin/incidents/:incidentId` | Read linked profiles, visit and transaction |
| `PATCH` | `/api/v1/admin/incidents/:incidentId` | Assign, review, escalate, resolve or reopen |

Resolution requires a decision and internal notes. Every state change appends
an actor, timestamp and explanation to the incident timeline.

```text
incidents/{incidentId}
```

Firestore records:

```text
visits/{visitId}
caregiverShifts/{shiftId}
```

## Administrator verification

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v1/admin/onboarding?status=under_review` | Caregiver queue |
| `PATCH` | `/api/v1/admin/onboarding/:caregiverId/review` | Review caregiver |
| `GET` | `/api/v1/admin/onboarding/:caregiverId/files/:kind/url` | Protected caregiver document location |
| `GET` | `/api/v1/admin/onboarding/:caregiverId/files/:kind/download` | Read a local private caregiver document |
| `GET` | `/api/v1/admin/client-onboarding?status=under_review` | Client queue |
| `PATCH` | `/api/v1/admin/client-onboarding/:clientId/review` | Review client |
| `GET` | `/api/v1/admin/client-onboarding/:clientId/files/:kind/url` | Protected document location |
| `GET` | `/api/v1/admin/client-onboarding/:clientId/files/:kind/download` | Read a local private document |

Review body:

```json
{
  "decision": "approved",
  "feedback": "Identity and documents verified."
}
```

`decision` accepts `approved`, `changes_required` or `rejected`. Approval
unlocks care-request publishing for clients and care-request discovery for
caregivers. `changes_required` unlocks the submitted onboarding record so the
user can correct it and resubmit. `rejected` is a final locked decision. Every
decision is mirrored to `users/{uid}.verificationStatus`.

## Security rules

`firestore.rules` and `storage.rules` deny all direct browser access. Do not
place service-account JSON or storage service keys in the React application.
