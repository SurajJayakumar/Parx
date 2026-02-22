import { signInAnonymously, type User } from "firebase/auth";
import { auth } from "./client";

export async function ensureUser(): Promise<User> {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  const { user } = await signInAnonymously(auth);
  return user;
}
