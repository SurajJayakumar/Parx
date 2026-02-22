import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { ensureUser } from "@/lib/firebase/auth";

export type UserProfile = {
  caregiverEmail: string;
  patientName: string;
  emailNotificationsEnabled: boolean;
  updatedAt?: any;
};

export async function getUserProfile(): Promise<UserProfile | null> {
  const user = await ensureUser();
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return null;
  }

  return snap.data() as UserProfile;
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  const user = await ensureUser();
  const ref = doc(db, "users", user.uid);

  await setDoc(
    ref,
    { ...profile, updatedAt: serverTimestamp() },
    { merge: true }
  );
}
