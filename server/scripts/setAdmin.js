import "dotenv/config";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, db } from "../firebaseAdmin.js";

const email = process.argv[2];
const role = process.argv[3] || "super_admin";
const expectedUid = process.argv[4];
const adminRoles = new Set([
  "super_admin",
  "admin",
  "operations_manager",
  "verification_officer",
  "finance_officer",
  "support_agent",
  "analyst",
]);

if (!email) {
  console.error(
    "Usage: npm run admin:set -- admin@example.com [role] [expectedFirebaseUid]",
  );
  process.exit(1);
}

if (!adminRoles.has(role)) {
  console.error(`Unknown administrator role: ${role}`);
  process.exit(1);
}

try {
  const user = await adminAuth.getUserByEmail(email);

  if (expectedUid && user.uid !== expectedUid) {
    throw new Error(
      `UID mismatch. Firebase returned ${user.uid}; expected ${expectedUid}.`,
    );
  }

  await adminAuth.setCustomUserClaims(user.uid, {
    ...user.customClaims,
    admin: true,
    role,
  });

  const userReference = db.collection("users").doc(user.uid);
  const existingProfile = await userReference.get();
  await userReference.set(
    {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || email.split("@")[0],
      role,
      admin: true,
      status: "active",
      emailVerified: user.emailVerified,
      updatedAt: FieldValue.serverTimestamp(),
      ...(!existingProfile.exists
        ? { createdAt: FieldValue.serverTimestamp() }
        : {}),
    },
    { merge: true },
  );

  const updatedUser = await adminAuth.getUser(user.uid);
  console.log(
    JSON.stringify(
      {
        success: true,
        uid: updatedUser.uid,
        email: updatedUser.email,
        customClaims: updatedUser.customClaims,
        firestoreProfile: `users/${updatedUser.uid}`,
        message: "Sign out and sign in again to receive the updated token.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
