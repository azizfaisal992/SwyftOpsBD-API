# SwiftOpsBD API

Express REST API for caregiver onboarding. Firebase Authentication ID tokens
protect the endpoints, Cloud Firestore stores onboarding records, and Cloud
Storage stores private caregiver documents.

See [API.md](./API.md) for setup, endpoints, security and local-development
instructions.

## Local development

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\secure\swiftopsbd-service-account.json"
npm install
npm run dev
```
