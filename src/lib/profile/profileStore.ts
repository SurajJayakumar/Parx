import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";

export type UserProfile = {
  caregiverEmail: string;
  patientName: string;
  emailNotificationsEnabled: boolean;
  updatedAt?: any;
};

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return null;
  }

  return snap.data() as UserProfile;
}

export async function saveUserProfile(uid: string, profile: Omit<UserProfile, "updatedAt">): Promise<void> {
  const ref = doc(db, "users", uid);

  await setDoc(
    ref,
    { ...profile, updatedAt: serverTimestamp() },
    { merge: true }
  );
}
