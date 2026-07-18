# SwiftOpsBD Caregiver Onboarding API

The API is an Express server backed by Firebase Authentication, Cloud Firestore,
and Cloud Storage for Firebase.

## Firebase setup

1. Open the `swiftopsbd` project in Firebase Console.
2. Open **Firestore Database**, choose **Create database**, select **Production
   mode**, choose the nearest suitable location, and create the default database.
3. Open **Storage**, choose **Get started**, and create the default bucket. Cloud
   Storage for Firebase requires the Blaze plan. Configure a billing budget alert.
4. Open **Project settings → Service accounts → Generate new private key**.
   Store the downloaded JSON outside this repository.
5. In PowerShell, set the credential path for the current terminal:

   ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\secure\swiftopsbd-service-account.json"
   ```

6. Copy `.env.example` to `.env` and fill in the existing web app values. The
   default server project and bucket names are already set for `swiftopsbd`.
7. Deploy the locked client-access rules when Firebase CLI is available:

   ```bash
   firebase deploy --only firestore:rules,storage
   ```

The service account JSON is a server secret. Never paste it into React code,
send it in chat, or commit it to GitHub.

## Run locally

Use two terminals:

```bash
npm run api:dev
npm run dev
```

Vite proxies `/api` to `http://localhost:4000`.

## Authentication

Every protected endpoint expects a current Firebase ID token:

```http
Authorization: Bearer FIREBASE_ID_TOKEN
```

The React service obtains this token from the signed-in Firebase user. The API
verifies it with Firebase Admin and uses the verified `uid` as the caregiver ID.

## Caregiver endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Server health check |
| `GET` | `/api/onboarding/me` | Create or return the signed-in caregiver record |
| `PUT` | `/api/onboarding/profile` | Save profile draft |
| `PUT` | `/api/onboarding/assessment` | Save assessment draft |
| `POST` | `/api/onboarding/files/:kind` | Upload one private file as multipart field `file` |
| `DELETE` | `/api/onboarding/files/:kind` | Delete one previously uploaded file |
| `POST` | `/api/onboarding/submit` | Validate and submit the completed onboarding record |

Supported file kinds:

- `profilePhoto`
- `resume`
- `nidFront`
- `nidBack`
- `referenceLetter`
- `licenseCRP`
- `licenseAHLC`
- `licenseRNLC`

Files are limited to 5MB and validated by MIME type.

## Administrator endpoints

Administrator endpoints require a Firebase custom claim named `admin`.

```bash
npm run admin:set -- admin@example.com
```

The administrator must sign out and back in after the claim is added.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/onboarding?status=under_review` | List records by review status |
| `PATCH` | `/api/admin/onboarding/:caregiverId/review` | Approve or request changes |
| `GET` | `/api/admin/onboarding/:caregiverId/files/:kind/url` | Create a private 15-minute review URL |

Review request:

```json
{
  "decision": "approved",
  "feedback": "Profile and documents verified."
}
```

`decision` accepts `approved` or `changes_required`.

## Firestore structure

Collection:

```text
caregiverOnboarding/{firebaseUid}
```

Each document contains:

- profile fields and private photo metadata
- credential and Storage object metadata
- assessment answers
- computed progress and completion flags
- submission/review status and timestamps
- administrator review feedback

Actual file bytes are stored under:

```text
caregiver-onboarding/{firebaseUid}/{fileKind}/...
```
