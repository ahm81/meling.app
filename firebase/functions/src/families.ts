import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  Collections,
  CreateFamilyRequest,
  paths,
  type CreateFamilyResponse,
  type FamilyDoc,
  type MemberDoc,
} from "@meling/shared";

export const createFamily = onCall<unknown, Promise<CreateFamilyResponse>>(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Du må være logget inn.");
  }

  const parsed = CreateFamilyRequest.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.message);
  }
  const { name, displayName } = parsed.data;

  const db = getFirestore();
  const familyRef = db.collection(Collections.families).doc();

  const family: FamilyDoc = { name, ownerId: uid, memberIds: [uid] };
  const member: MemberDoc = { displayName, role: "parent" };

  await db.runTransaction(async (tx) => {
    tx.set(familyRef, { ...family, createdAt: FieldValue.serverTimestamp() });
    tx.set(db.doc(paths.member(familyRef.id, uid)), {
      ...member,
      joinedAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      db.doc(paths.user(uid)),
      { displayName, familyIds: FieldValue.arrayUnion(familyRef.id) },
      { merge: true },
    );
  });

  return { familyId: familyRef.id };
});
