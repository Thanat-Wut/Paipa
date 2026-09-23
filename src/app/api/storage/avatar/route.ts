import { randomUUID } from "node:crypto";
import { getOptionalIdentity } from "@/lib/identity-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwnedStoragePath, validateImageUpload } from "@/lib/storage-path";

function configurationMessage(error: unknown) {
  return error instanceof Error && error.message.includes("SUPABASE_SECRET_KEY")
    ? "Server storage requires SUPABASE_SECRET_KEY."
    : "Avatar storage is temporarily unavailable.";
}

function extensionFor(type: string) {
  return type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : type === "image/gif" ? "gif" : "png";
}

export async function POST(request: Request) {
  const identity = await getOptionalIdentity();
  if (!identity) return Response.json({ message: "Paipa identity is required." }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ message: "Avatar image is required." }, { status: 400 });
  const validationError = validateImageUpload("avatar", file);
  if (validationError) return Response.json({ message: validationError }, { status: 400 });

  const path = `${identity.id}/${randomUUID()}.${extensionFor(file.type)}`;
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.storage.from("avatars").upload(path, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (error) return Response.json({ message: "Avatar upload failed." }, { status: 502 });
    const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    return Response.json({ path, url, avatarType: file.type === "image/gif" ? "gif" : "image" }, { status: 201 });
  } catch (error) {
    return Response.json({ message: configurationMessage(error) }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const identity = await getOptionalIdentity();
  if (!identity) return Response.json({ message: "Paipa identity is required." }, { status: 401 });
  const form = await request.formData();
  const path = form.get("path");
  if (typeof path !== "string" || !isOwnedStoragePath("avatar", identity.id, path)) {
    return Response.json({ message: "Invalid avatar object path." }, { status: 400 });
  }

  try {
    const { error } = await createAdminClient().storage.from("avatars").remove([path]);
    if (error) return Response.json({ message: "Avatar cleanup failed." }, { status: 502 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ message: configurationMessage(error) }, { status: 503 });
  }
}
