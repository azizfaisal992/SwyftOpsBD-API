import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { readFileSync } from "node:fs";

const parseServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8"));
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) {
    return JSON.parse(
      readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_FILE, "utf8"),
    );
  }
  return null;
};

const serviceAccount = parseServiceAccount();
const projectId = process.env.FIREBASE_PROJECT_ID || "swiftopsbd";
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || "swiftopsbd.firebasestorage.app";

const app = getApps()[0] || initializeApp({
  credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
  projectId,
  storageBucket,
});

export const adminAuth = getAuth(app);
export const db = getFirestore(app);
db.settings({
  // REST avoids indefinite gRPC connection hangs on restricted Windows,
  // campus and hosted networks while preserving Firestore semantics.
  preferRest: true,
});
export const bucket = getStorage(app).bucket(storageBucket);
