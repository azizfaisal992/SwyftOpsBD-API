# SwiftOpsBD API

Express REST API for SwiftOpsBD identity, caregiver/client onboarding, care
plans and caregiver matching. Firebase Authentication ID tokens protect the
endpoints, Cloud Firestore stores records, and a private storage adapter stores
uploaded files.

See [API.md](./API.md) for setup, endpoints, security and local-development
instructions.

## Local development

Create a private `.env` file:

```env
NODE_ENV=development
API_PORT=4000
CLIENT_ORIGIN=http://localhost:5173
FIREBASE_PROJECT_ID=swiftopsbd
GOOGLE_APPLICATION_CREDENTIALS=C:/path/to/service-account.json
FILE_STORAGE_PROVIDER=local
LOCAL_UPLOAD_DIR=uploads
BARIKOI_API_KEY=replace_with_private_barikoi_api_key
BARIKOI_API_BASE_URL=https://barikoi.xyz
PAYMENT_MODE=test
PAYMENT_GATEWAY=mock
```

Then run:

```bash
npm install
npm run dev
```

Interactive REST API documentation is available while the server is running:

```text
http://localhost:4000/api-docs
```

The machine-readable OpenAPI 3.1 document is available at:

```text
http://localhost:4000/api-docs.json
```

Protected operations require a Firebase ID token. In Swagger UI, select
**Authorize** and paste the ID token only; the interface adds the `Bearer`
prefix. Never enter Firebase service-account, Stripe, Supabase, card, PIN, CVV
or OTP secrets into Swagger.

The service-account JSON, `.env` and runtime `uploads/` directory must never be
committed.

## Private production file storage

Firebase Authentication and Firestore remain the identity and record database.
Production NID images, licenses, resumes, PDFs, medical reports and medication
documents use a separate **private Supabase Storage bucket**:

```env
FILE_STORAGE_PROVIDER=supabase
SUPABASE_URL=https://your-project-reference.supabase.co
SUPABASE_SECRET_KEY=your_backend_only_sb_secret_key
SUPABASE_STORAGE_BUCKET=swiftops-private-documents
SUPABASE_SIGNED_URL_TTL_SECONDS=900
```

Create `swiftops-private-documents` in the Supabase Storage dashboard with
**Public bucket disabled**, a 10 MB file limit, and only the MIME types used by
the application. The secret key belongs only in the API host's
protected environment. Never put it in Vercel frontend variables, a `VITE_`
variable, GitHub, or client code.

Existing localhost files can be inspected and migrated without deleting the
local copies:

```bash
npm run storage:migrate
npm run storage:migrate -- --apply
```

Run the first command as a dry run. Run `--apply` only after the Supabase
bucket and API secrets are configured and the listed local files are present.

Sprint 9 messaging uses the existing Firestore database and requires no paid
Firebase messaging product. The React portals call the REST API and refresh
active conversations periodically. Assignment messages are visible only to
the assigned client and caregiver. Administrators can access only separate
support conversations explicitly addressed to the admin team.

`PAYMENT_MODE=test` enables the local Sprint 8 payment simulator. It never
charges a card or bKash wallet. Production checkout must remain disabled until
verified Stripe or bKash merchant credentials and callback URLs are added.

For Stripe dummy payments, use `PAYMENT_MODE=gateway`, set
`PAYMENT_GATEWAY=stripe`, `PAYMENT_CURRENCY=USD`, and configure the test-only
`STRIPE_SECRET_KEY` and signed `STRIPE_WEBHOOK_SECRET`. The bKash number form
remains a demo-only local workflow. Completed client payments, caregiver
earnings and caregiver payouts expose authenticated downloadable PDF payslips.
