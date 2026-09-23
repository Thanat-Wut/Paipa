import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const expected = {
  projectHost: "ltkqcjtdzlbtyqwurynp.supabase.co",
  identityId: "8728c49a-4f4a-4cc6-b10e-5ae4d4366540",
  tripId: "57bcd696-b632-4d79-84a9-6140ad6d393d",
  memberId: "f15c3c30-e89d-469d-8984-08bec5559c3a",
  inviteId: "33a54ccc-204e-485c-b208-61de80e316ca",
  signaturePaths: [
    "8728c49a-4f4a-4cc6-b10e-5ae4d4366540/1de854bd-2cc8-4fde-a87b-ce650c021049.png",
    "8728c49a-4f4a-4cc6-b10e-5ae4d4366540/ee0175f6-7761-44f3-888b-b71a803bafa3.png",
  ],
};

function requireConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || new URL(url).hostname !== expected.projectHost) {
    throw new Error("Refusing cleanup: configure the exact confirmed Supabase project URL.");
  }
  if (!key) throw new Error("Refusing cleanup: set server-only SUPABASE_SECRET_KEY outside tracked files.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function assertEqual(actual, wanted, label) {
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`Refusing cleanup: ${label} no longer matches the confirmed fixture.`);
  }
}

async function rows(client, table, select) {
  const { data, error } = await client.from(table).select(select);
  if (error) throw new Error(`Could not verify ${table}: ${error.message}`);
  return data ?? [];
}

async function listFolder(client, bucket) {
  const { data, error } = await client.storage.from(bucket).list(expected.identityId, { limit: 100 });
  if (error) throw new Error(`Could not inspect ${bucket} fixture objects: ${error.message}`);
  return (data ?? []).map((item) => `${expected.identityId}/${item.name}`).sort();
}

const client = requireConfig();

// Require the entire project to still match the single confirmed test fixture.
const profiles = await rows(client, "profiles", "id,display_name");
const trips = await rows(client, "trips", "id,owner_id,name");
const members = await rows(client, "trip_members", "id,trip_id,user_id,role,attendance,signature_path,commitment_signed_at");
const invites = await rows(client, "trip_invites", "id,trip_id,created_by,usage_count");
assertEqual(profiles, [{ id: expected.identityId, display_name: "owner" }], "profiles");
assertEqual(trips, [{ id: expected.tripId, owner_id: expected.identityId, name: "Ohio" }], "trips");
assertEqual(members, [{
  id: expected.memberId,
  trip_id: expected.tripId,
  user_id: expected.identityId,
  role: "owner",
  attendance: "maybe",
  signature_path: null,
  commitment_signed_at: null,
}], "trip_members");
assertEqual(invites, [{
  id: expected.inviteId,
  trip_id: expected.tripId,
  created_by: expected.identityId,
  usage_count: 0,
}], "trip_invites");
assertEqual(await listFolder(client, "signatures"), expected.signaturePaths.slice().sort(), "signature objects");
assertEqual(await listFolder(client, "avatars"), [], "avatar objects");

const { data: authResult, error: authError } = await client.auth.admin.getUserById(expected.identityId);
if (authError || authResult.user?.id !== expected.identityId) {
  throw new Error("Refusing cleanup: the exact confirmed Auth test account could not be verified.");
}

// The Storage API must remove file bytes before the relational fixture is deleted.
const { error: signatureRemovalError } = await client.storage.from("signatures").remove(expected.signaturePaths);
if (signatureRemovalError) throw new Error(`Could not remove confirmed signature objects: ${signatureRemovalError.message}`);
assertEqual(await listFolder(client, "signatures"), [], "signature cleanup");

const { error: tripDeleteError } = await client.from("trips").delete().eq("id", expected.tripId);
if (tripDeleteError) throw new Error(`Could not remove confirmed test trip: ${tripDeleteError.message}`);
const { error: profileDeleteError } = await client.from("profiles").delete().eq("id", expected.identityId);
if (profileDeleteError) throw new Error(`Could not remove confirmed test profile: ${profileDeleteError.message}`);
const { error: authDeleteError } = await client.auth.admin.deleteUser(expected.identityId);
if (authDeleteError) throw new Error(`Could not remove confirmed test Auth user: ${authDeleteError.message}`);
const { data: remainingAuthUser, error: authVerifyError } = await client.auth.admin.getUserById(expected.identityId);
if (remainingAuthUser.user || !authVerifyError || (authVerifyError.status !== 404 && authVerifyError.code !== "user_not_found")) {
  throw new Error("Cleanup verification failed: confirmed test Auth user remains or could not be verified absent.");
}

for (const [table, filterColumn, value] of [
  ["trips", "id", expected.tripId],
  ["trip_members", "trip_id", expected.tripId],
  ["trip_invites", "trip_id", expected.tripId],
  ["profiles", "id", expected.identityId],
]) {
  const projection = [...new Set(["id", filterColumn])].join(",");
  const remaining = await rows(client, table, projection);
  if (remaining.some((row) => row[filterColumn] === value)) {
    throw new Error(`Cleanup verification failed: confirmed fixture remains in ${table}.`);
  }
}
assertEqual(await listFolder(client, "signatures"), [], "signature cleanup verification");
assertEqual(await listFolder(client, "avatars"), [], "avatar cleanup verification");

console.log("Confirmed Paipa test fixture cleanup verified.");
