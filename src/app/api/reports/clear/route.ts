export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminDb, hasAdminCredentials } from "@/lib/firebase/admin";

export async function DELETE(req: NextRequest) {
  if (!hasAdminCredentials) {
    return NextResponse.json({ ok: false, error: "Server not configured." }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const uid = searchParams.get("uid");

  if (!uid) {
    return NextResponse.json({ ok: false, error: "uid is required." }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const reportsRef = db.collection("users").doc(uid).collection("reports");
    const snap = await reportsRef.get();

    // Firestore batch writes are limited to 500 operations each
    const BATCH_SIZE = 499;
    const docs = snap.docs;

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      docs.slice(i, i + BATCH_SIZE).forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }

    return NextResponse.json({ ok: true, deleted: docs.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
