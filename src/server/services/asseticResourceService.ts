import db from "../database";
import asseticClient from "./asseticClient";
import settingsService from "./settingsService";

/**
 * User profile fields used when creating the Assetic resource record.
 * All fields are optional — only those that are non-null are sent.
 */
export interface AsseticResourceProfile {
  displayName?: string | null;
  firstName?: string | null;
  surname?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
}

/**
 * Ensure a user has a corresponding Assetic Resource record, and cache
 * the Assetic resource ID in `users.assetic_resource_id` so subsequent
 * calls skip the Assetic API entirely.
 *
 * Strategy:
 *  1. Fast path  — `users.assetic_resource_id` is already set → return it.
 *  2. Slow path  — call `GET /resource?ExternalId=<userId>`:
 *       a. Found   → cache the ID and return it.
 *       b. Not found → call `POST /resource` to create, cache, return.
 *
 * Uses the XeonB user ID (string) as the Assetic `ExternalID` so the two
 * systems can be reliably linked across requests.
 *
 * @param userId   XeonB internal user ID.
 * @param profile  Optional profile fields to use when creating the resource.
 * @returns The Assetic resource ID, or null if Assetic is disabled or the
 *          operation fails (errors are logged but never thrown).
 */
export async function ensureAsseticResource(
  userId: number,
  profile?: AsseticResourceProfile,
): Promise<string | null> {
  // Guard: only run when Assetic integration is enabled.
  const enabled = await settingsService.getBool("assetic_sync_enabled");
  if (!enabled) return null;

  const externalId = String(userId);

  try {
    // ── 1. Fast path: resource already provisioned ─────────────────────────
    const userRow = await db("users")
      .where("id", userId)
      .select("assetic_resource_id")
      .first();

    if (userRow?.assetic_resource_id) {
      return userRow.assetic_resource_id as string;
    }

    // ── 2. Slow path: look up in Assetic ───────────────────────────────────
    const existing = await asseticClient.getResourceByExternalId(externalId);

    if (existing) {
      const rawId = existing.Id ?? existing.id;
      if (!rawId) {
        console.warn(
          `[asseticResourceService] Existing resource for user ${externalId} returned no usable ID — skipping cache`,
        );
        return null;
      }
      const resourceId = String(rawId);
      await cacheResourceId(userId, resourceId);
      return resourceId;
    }

    // ── 3. Create resource in Assetic ──────────────────────────────────────
    const payload: any = {
      ExternalID: externalId,
      Status: "Active",
      Types: [{ Type: "Customer" }],
    };

    if (profile?.displayName) payload.DisplayName = profile.displayName;
    if (profile?.firstName) payload.FirstName = profile.firstName;
    if (profile?.surname) payload.Surname = profile.surname;
    if (profile?.email) payload.Email = profile.email;
    if (profile?.phone) payload.Phone = profile.phone;
    if (profile?.mobile) payload.Mobile = profile.mobile;

    let created: any;
    try {
      created = await asseticClient.createResource(payload);
    } catch (createErr: any) {
      // Assetic returns 500 when a resource with the same name already exists.
      // In that case try to recover by looking up the existing record via email.
      const errBody = createErr?.response?.data;
      const errMsg: string =
        (typeof errBody === "string"
          ? errBody
          : Object.values(errBody ?? {}).join(" ")) ?? "";
      if (
        createErr?.response?.status === 500 &&
        errMsg.toLowerCase().includes("already exists") &&
        profile?.email
      ) {
        console.warn(
          `[asseticResourceService] Create failed (already exists) for user ${externalId} — falling back to email lookup`,
        );
        const byEmail = await asseticClient.getResourceByEmail(profile.email);
        if (byEmail) {
          const rawId2 = byEmail.Id ?? byEmail.id;
          if (rawId2) {
            const resourceId2 = String(rawId2);
            await cacheResourceId(userId, resourceId2);
            return resourceId2;
          }
        }
      }
      throw createErr;
    }

    const rawCreatedId = created?.Id ?? created?.id;
    if (!rawCreatedId) {
      console.warn(
        `[asseticResourceService] Created resource for user ${externalId} returned no usable ID — skipping cache`,
      );
      return null;
    }
    const resourceId = String(rawCreatedId);

    await cacheResourceId(userId, resourceId);
    console.log(
      `[asseticResourceService] Resource created for user ${externalId}: ${resourceId}`,
    );
    return resourceId;
  } catch (err: any) {
    console.warn(
      `[asseticResourceService] Failed to ensure resource for user ${externalId} (non-fatal):`,
      err?.response?.data ?? err?.message,
    );
    return null;
  }
}

/**
 * Trigger Assetic resource provisioning as a fire-and-forget background
 * task.  Intended to be called from login / registration handlers so that
 * the resource is ready before the user ever submits a work request.
 *
 * @param userId   XeonB internal user ID.
 * @param profile  Profile fields available at login time.
 */
export function triggerAsseticResourceProvisioning(
  userId: number,
  profile?: AsseticResourceProfile,
): void {
  ensureAsseticResource(userId, profile).catch((err) =>
    console.warn(
      `[asseticResourceService] Background provisioning failed for user ${userId}:`,
      err?.message,
    ),
  );
}

/** Persist the Assetic resource ID into the local users row. */
async function cacheResourceId(
  userId: number,
  resourceId: string,
): Promise<void> {
  try {
    await db("users")
      .where("id", userId)
      .update({ assetic_resource_id: resourceId, updated_at: db.fn.now() });
  } catch (err: any) {
    console.warn(
      `[asseticResourceService] Failed to cache assetic_resource_id for user ${userId}:`,
      err?.message,
    );
  }
}
