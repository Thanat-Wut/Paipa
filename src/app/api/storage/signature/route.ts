import { randomUUID } from "node:crypto";
import { getOptionalIdentity } from "@/lib/identity-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwnedStoragePath, validateImageUpload } from "@/lib/storage-path";

function configurationMessage(error: unknown) {
  return error instanceof Error && error.message.includes("SUPABASE_SECRET_KEY")
    ? "Server storage requires SUPABASE_SECRET_KEY."
    : "Signature storage is temporarily unavailable.";
}

export async function POST(request: Request) {
  const identity = await getOptionalIdentity();
  if (!identity) return Response.json({ message: "Paipa identity is required." }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ message: "Signature image is required." }, { status: 400 });
  const validationError = validateImageUpload("signature", file);
  if (validationError) return Response.json({ message: validationError }, { status: 400 });

  const path = `${identity.id}/${randomUUID()}.png`;
  try {
    const { error } = await createAdminClient().storage.from("signatures").upload(path, file, {
      contentType: "image/png",
      cacheControl: "3600",
      upsert: false,
    });
    if (error) return Response.json({ message: "Signature upload failed." }, { status: 502 });
    return Response.json({ path }, { status: 201 });
  } catch (error) {
    return Response.json({ message: configurationMessage(error) }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const identity = await getOptionalIdentity();
  if (!identity) return Response.json({ message: "Paipa identity is required." }, { status: 401 });
  const form = await request.formData();
  const path = form.get("path");
  if (typeof path !== "string" || !isOwnedStoragePath("signature", identity.id, path)) {
    return Response.json({ message: "Invalid signature object path." }, { status: 400 });
  }

  try {
    const { error } = await createAdminClient().storage.from("signatures").remove([path]);
    if (error) return Response.json({ message: "Signature cleanup failed." }, { status: 502 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ message: configurationMessage(error) }, { status: 503 });
  }
}
