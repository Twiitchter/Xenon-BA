import { Router, Response } from "express";
import { body, validationResult } from "express-validator";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import db from "../database";
import asseticClient from "../services/asseticClient";
import asseticLocationHierarchyService from "../services/asseticLocationHierarchyService";

const router = Router();

/**
 * Extract the most informative human-readable message from an Assetic API
 * error response. Handles multiple formats:
 *  - ASP.NET Web API: { Message, ExceptionMessage, ModelState }
 *  - ASP.NET Core: { title, errors }
 *  - Plain string responses
 *  - Fallback: JSON.stringify of the full body
 */
function extractAsseticErrorMessage(errData: any): string {
  if (!errData) return "Failed to create work request in Assetic.";

  if (typeof errData === "string") return errData;

  const parts: string[] = [];

  // Primary message fields
  const primary =
    errData.Message ||
    errData.message ||
    errData.title ||
    errData.Title ||
    errData.error ||
    errData.Error;
  if (primary && typeof primary === "string") parts.push(primary);

  // Exception detail (ASP.NET Web API)
  if (errData.ExceptionMessage && errData.ExceptionMessage !== primary) {
    parts.push(`Detail: ${errData.ExceptionMessage}`);
  }

  // ModelState validation errors (ASP.NET Web API)
  if (errData.ModelState && typeof errData.ModelState === "object") {
    const modelErrs = Object.entries(errData.ModelState).flatMap(
      ([field, msgs]: [string, any]) =>
        Array.isArray(msgs)
          ? msgs.map((m: string) => `${field}: ${m}`)
          : [`${field}: ${String(msgs)}`],
    );
    if (modelErrs.length) parts.push(...modelErrs);
  }

  // ASP.NET Core validation errors
  if (errData.errors && typeof errData.errors === "object") {
    const validErrs = Object.entries(errData.errors).flatMap(
      ([field, msgs]: [string, any]) =>
        Array.isArray(msgs)
          ? msgs.map((m: string) => `${field}: ${m}`)
          : [`${field}: ${String(msgs)}`],
    );
    if (validErrs.length) parts.push(...validErrs);
  }

  if (parts.length > 0) return parts.join(" | ");

  // Last resort: full response JSON
  try {
    const raw = JSON.stringify(errData);
    return raw.length <= 500 ? raw : raw.slice(0, 500) + "…";
  } catch {
    return "Failed to create work request in Assetic. (response unparseable)";
  }
}

function buildAsseticHierarchyError(error: any): {
  status: number;
  message: string;
  log: string;
} {
  const status = error?.response?.status;
  const upstream =
    error?.response?.data?.Message || error?.response?.data?.message;

  if (status === 401 || status === 403) {
    return {
      status: 502,
      message:
        "Assetic rejected hierarchy pull due to insufficient API permissions on /assets or /functionallocations.",
      log: `Assetic hierarchy unauthorized (${status})${upstream ? `: ${upstream}` : ""}`,
    };
  }

  if (status === 404) {
    return {
      status: 502,
      message:
        "Assetic hierarchy endpoint not found. Verify Assetic API URL/version settings.",
      log: `Assetic hierarchy endpoint missing (404)${upstream ? `: ${upstream}` : ""}`,
    };
  }

  return {
    status: 500,
    message: "Failed to fetch location hierarchy from Assetic",
    log: `Assetic hierarchy fetch failed${status ? ` (status ${status})` : ""}${upstream ? `: ${upstream}` : ""}`,
  };
}

// All routes require authentication
router.use(authenticateToken);

// ─── My Items (Combined User View) ─────────────────────────────────────────

/**
 * GET /api/maintenance/my-items
 * Get combined work requests and work orders for the current user
 * When a work order exists for a work request, the work order takes precedence
 */
router.get("/my-items", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { status, priority, limit = 100, offset = 0 } = req.query;

    // Get work requests created by this user
    let wrQuery = db("maintenance_requests as mr")
      .leftJoin("users as u", "mr.requested_by", "u.id")
      .leftJoin("work_orders as wo", "mr.id", "wo.request_id")
      .select(
        "mr.id",
        "mr.title",
        "mr.description",
        "mr.priority",
        "mr.status",
        "mr.category",
        "mr.location",
        "mr.assetic_work_request_id",
        "mr.assetic_friendly_id",
        "mr.requestor_display_name",
        "mr.created_at",
        "mr.updated_at",
        db.raw("? as item_type", ["request"]),
        "wo.id as work_order_id",
        "wo.status as work_order_status",
        "wo.craft as work_order_craft",
        db.raw("NULL as assigned_to_username"),
        db.raw("NULL as scheduled_date"),
      )
      .where("mr.requested_by", userId);

    if (status) {
      wrQuery = wrQuery.where("mr.status", status as string);
    }
    if (priority) {
      wrQuery = wrQuery.where("mr.priority", priority as string);
    }

    const requests = await wrQuery.orderBy("mr.created_at", "desc");

    // Transform and combine results, applying display logic
    const allItems = requests
      .map((r) => ({
        ...r,
        // If work order exists, show work order status
        display_type: r.work_order_id ? "work_order" : "request",
        display_status: r.work_order_id ? r.work_order_status : r.status,
      }))
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

    const total = allItems.length;
    const items = allItems.slice(
      Number(offset),
      Number(offset) + Number(limit),
    );

    res.json({
      items,
      total,
    });
  } catch (error) {
    console.error("Error fetching user items:", error);
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

// Set Assetic logging context for Assetic API calls
router.use((req: AuthRequest, _res: Response, next: Function) => {
  asseticClient.setContext(req.user?.id, "maintenance");
  _res.on("finish", () => asseticClient.clearContext());
  next();
});

// ─── Maintenance Requests ───────────────────────────────────────────────────

/**
 * GET /api/maintenance/requests
 * List maintenance requests
 */
router.get("/requests", async (req: AuthRequest, res: Response) => {
  try {
    const { status, priority, limit = 100, offset = 0 } = req.query;

    let qb = db("maintenance_requests as mr")
      .leftJoin("users as u", "mr.requested_by", "u.id")
      .leftJoin("work_orders as wo", "wo.request_id", "mr.id")
      .select(
        "mr.*",
        "u.username as requested_by_username",
        db.raw("wo.id as work_order_id"),
        db.raw("wo.status as work_order_status"),
        db.raw("wo.craft as work_order_craft"),
      );

    if (status) {
      qb = qb.where("mr.status", status as string);
    }

    if (priority) {
      qb = qb.where("mr.priority", priority as string);
    }

    const requests = await qb
      .orderBy("mr.created_at", "desc")
      .limit(Number(limit))
      .offset(Number(offset));

    res.json({
      requests,
      total: requests.length,
    });
  } catch (error) {
    console.error("Error fetching maintenance requests:", error);
    res.status(500).json({ error: "Failed to fetch maintenance requests" });
  }
});

/**
 * GET /api/maintenance/requests/:id
 * Get a specific maintenance request
 */
router.get("/requests/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const request = await db("maintenance_requests as mr")
      .leftJoin("users as u", "mr.requested_by", "u.id")
      .select("mr.*", "u.username as requested_by_username")
      .where("mr.id", id)
      .first();

    if (!request) {
      return res.status(404).json({ error: "Maintenance request not found" });
    }

    res.json(request);
  } catch (error) {
    console.error("Error fetching maintenance request:", error);
    res.status(500).json({ error: "Failed to fetch maintenance request" });
  }
});

/**
 * POST /api/maintenance/requests
 * Create a new maintenance request
 */
router.post(
  "/requests",
  [
    body("title").isLength({ min: 1 }).trim(),
    body("description").optional().trim(),
    body("priority").optional().isIn(["low", "medium", "high", "critical"]),
    body("category").optional().trim(),
    body("location").optional().trim(),
    body("assetId").optional().isInt(),
    // Assetic asset GUID (assetic_assets.assetic_guid) for linking the request to a physical asset
    body("asseticAssetGuid").optional().trim(),
    // Assetic required fields
    body("workRequestSourceId").optional().trim(),
    // Requestor fields
    body("requestorDisplayName").optional().trim(),
    body("requestorFirstName").optional().trim(),
    body("requestorSurname").optional().trim(),
    body("requestorEmail").optional().isEmail().normalizeEmail(),
    body("requestorPhone").optional().trim(),
    body("requestorMobile").optional().trim(),
    body("requestorTypeId").optional().trim(),
    // Optional Assetic fields
    body("workRequestPriorityId").optional().trim(),
    body("externalIdentifier").optional().trim(),
    body("supportingInformation").optional().trim(),
    // Physical location fields
    body("streetNumber").optional().trim(),
    body("streetAddress").optional().trim(),
    body("citySuburb").optional().trim(),
    body("state").optional().trim(),
    body("zipPostcode").optional().trim(),
    body("country").optional().trim(),
    body("otherLocation").optional().trim(),
    body("whereLocation").optional().trim(),
    // Spatial location
    body("spatialLocation").optional().trim(),
    // Reactive inspection
    body("reactiveInspectorName").optional().trim(),
    body("reactiveInspectionDate").optional().isISO8601(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const {
        title,
        description,
        priority,
        category,
        location,
        assetId,
        workRequestSourceId,
        requestorDisplayName,
        requestorFirstName,
        requestorSurname,
        requestorEmail,
        requestorPhone,
        requestorMobile,
        requestorTypeId,
        workRequestPriorityId,
        externalIdentifier,
        supportingInformation,
        streetNumber,
        streetAddress,
        citySuburb,
        state,
        zipPostcode,
        country,
        otherLocation,
        whereLocation,
        spatialLocation,
        reactiveInspectorName,
        reactiveInspectionDate,
      } = req.body;

      // ── Resolve asset GUID from the synced Assetic asset cache ─────────────
      let resolvedAssetGuid: string | null = null;
      let resolvedAssetName: string | null = null;

      const { asseticAssetGuid } = req.body;
      if (asseticAssetGuid) {
        const cachedAsset = await db("assetic_assets")
          .where("assetic_guid", asseticAssetGuid)
          .select("assetic_guid", "asset_name")
          .first();
        if (cachedAsset) {
          resolvedAssetGuid = cachedAsset.assetic_guid;
          resolvedAssetName = cachedAsset.asset_name || null;
        }
      }

      // ── Push to Assetic first (if integration is enabled) ─────────────────
      // The work request must exist in Assetic before it appears in the portal.
      // If Assetic creation fails we block the local save so the lists stay in sync.
      let asseticWorkRequestId: string | null = null;
      let asseticFriendlyId: string | null = null;
      const asseticEnabled = await asseticClient.isEnabled();

      if (asseticEnabled) {
        if (!workRequestSourceId) {
          return res.status(400).json({
            error:
              "Request Source is required when Assetic integration is enabled.",
          });
        }

        const asseticPayload: any = {
          // Description is Char(250) — truncate to avoid rejection.
          // The title alone goes here; the user's full description goes
          // into SupportingInformation below (which has a larger limit).
          Description: title.slice(0, 250),
          WorkRequestSourceId: workRequestSourceId,
          // Location is Char(100) and mandatory — truncate if the hierarchy path
          // exceeds the limit but preserve as much as possible
          Location: (location || "Not specified").slice(0, 100),
          SupportingInformation: supportingInformation || null,
          ExternalIdentifier: externalIdentifier || null,
          WorkRequestPriorityId: workRequestPriorityId || null,
          // WorkRequestSubTypeId must be null (not empty string) for an Int field
          WorkRequestSubTypeId: null,
          // Automatically set the Incident type based on direction extracted from
          // the location path (e.g. "North", "South", "North West").
          WorkRequestTypeId: await resolveIncidentTypeId(location, null),
          // WorkRequestPhysicalLocation is mandatory per the Assetic API.
          // Address.Country defaults to "Australia" to satisfy Assetic's country
          // validation. When no real street address is provided, StreetAddress
          // is populated from the hierarchy path so the location is meaningful.
          // The full untruncated hierarchy path also goes into WhereLocation.
          WorkRequestPhysicalLocation: {
            Address: {
              StreetNumber: streetNumber || null,
              StreetAddress:
                streetAddress || (location ? location.slice(0, 255) : null),
              CitySuburb: citySuburb || null,
              State: state || null,
              ZipPostcode: zipPostcode || null,
              Country: country || "Australia",
            },
            OtherLocation: otherLocation || null,
            // Full hierarchy path preserved here without truncation
            WhereLocation: whereLocation || location || null,
          },
        };

        // Use ComplexAssetId for internal GUIDs (AssetId is for user-friendly IDs)
        if (resolvedAssetGuid) {
          asseticPayload.ComplexAssetId = resolvedAssetGuid;
        }

        const requestor: any = {};
        if (requestorDisplayName) requestor.DisplayName = requestorDisplayName;
        if (requestorFirstName) requestor.FirstName = requestorFirstName;
        if (requestorSurname) requestor.Surname = requestorSurname;
        if (requestorEmail) requestor.Email = requestorEmail;
        if (requestorPhone) requestor.Phone = requestorPhone;
        if (requestorMobile) requestor.Mobile = requestorMobile;
        if (requestorTypeId) requestor.Types = [{ Id: requestorTypeId }];
        if (Object.keys(requestor).length > 0) {
          asseticPayload.Requestor = requestor;
        }

        if (spatialLocation) {
          asseticPayload.WorkRequestSpatialLocation = {
            PointString: spatialLocation,
          };
        }

        if (reactiveInspectorName) {
          asseticPayload.ReactiveInspector = {
            DisplayName: reactiveInspectorName,
          };
        }
        if (reactiveInspectionDate) {
          asseticPayload.ReactiveInspectionDate = reactiveInspectionDate;
        }

        try {
          const asseticResult =
            await asseticClient.createWorkRequest(asseticPayload);

          // Assetic POST /workrequest returns the GUID as a plain string,
          // not a JSON object. Handle both a raw string and an object response.
          if (typeof asseticResult === "string") {
            asseticWorkRequestId = asseticResult.trim().replace(/^"|"$/g, "");
          } else if (asseticResult && typeof asseticResult === "object") {
            asseticWorkRequestId = asseticResult.Id || asseticResult.id || null;
          }

          console.log(`Assetic WR created — GUID: ${asseticWorkRequestId}`);

          // Fetch the full WR record to get the human-readable FriendlyIdStr (e.g. "WR35").
          // This is a fire-and-continue — if it fails we still save the request.
          if (asseticWorkRequestId) {
            try {
              const wrDetail =
                await asseticClient.getWorkRequest(asseticWorkRequestId);
              asseticFriendlyId =
                wrDetail?.FriendlyIdStr ||
                wrDetail?.FriendlyId ||
                wrDetail?.FriendlyID ||
                wrDetail?.friendlyIdStr ||
                null;
              console.log(`Assetic WR FriendlyId: ${asseticFriendlyId}`);
            } catch (fetchErr: any) {
              console.warn(
                `Could not fetch WR detail for friendly ID (non-fatal): ${fetchErr.message}`,
              );
            }
          }
        } catch (asseticErr: any) {
          const errData = asseticErr?.response?.data;
          const httpStatus = asseticErr?.response?.status ?? null;
          const msg = extractAsseticErrorMessage(errData);
          console.error(
            `Assetic WR creation failed (HTTP ${httpStatus}):`,
            msg,
            "| Raw:",
            JSON.stringify(errData),
          );

          // Persist the failed submission so an admin can edit and retry it
          try {
            await db("failed_work_requests").insert({
              requested_by: req.user?.id ?? null,
              title: title || "",
              description: description || null,
              priority: priority || "medium",
              category: category || null,
              location: location || null,
              assetic_asset_guid: resolvedAssetGuid,
              work_request_source_id: workRequestSourceId || null,
              requestor_display_name: requestorDisplayName || null,
              requestor_first_name: requestorFirstName || null,
              requestor_surname: requestorSurname || null,
              requestor_email: requestorEmail || null,
              requestor_phone: requestorPhone || null,
              requestor_mobile: requestorMobile || null,
              supporting_information: supportingInformation || null,
              external_identifier: externalIdentifier || null,
              assetic_payload: JSON.stringify(asseticPayload),
              error_message: msg,
              assetic_error_response: errData ? JSON.stringify(errData) : null,
              assetic_http_status: httpStatus,
              status: "pending",
              created_at: new Date(),
              updated_at: new Date(),
            });
          } catch (dbErr) {
            console.error("Failed to log failed work request to DB:", dbErr);
          }

          return res.status(502).json({
            error: `Assetic rejected the work request: ${msg}`,
          });
        }
      }

      // ── Save to local database ────────────────────────────────────────────
      const [inserted] = await db("maintenance_requests")
        .insert({
          asset_id: assetId || null,
          assetic_asset_guid: resolvedAssetGuid,
          asset_display_name: resolvedAssetName,
          requested_by: req.user.id,
          title,
          description: description || null,
          priority: priority || "medium",
          category: category || null,
          location: location || null,
          // Assetic sync fields
          assetic_work_request_id: asseticWorkRequestId,
          assetic_friendly_id: asseticFriendlyId,
          work_request_source_id: workRequestSourceId || null,
          requestor_display_name: requestorDisplayName || null,
          requestor_first_name: requestorFirstName || null,
          requestor_surname: requestorSurname || null,
          requestor_email: requestorEmail || null,
          requestor_phone: requestorPhone || null,
          requestor_mobile: requestorMobile || null,
          requestor_type_id: requestorTypeId || null,
          work_request_subtype_id: null,
          work_request_priority_id: workRequestPriorityId || null,
          external_identifier: externalIdentifier || null,
          supporting_information: supportingInformation || null,
          street_number: streetNumber || null,
          street_address: streetAddress || null,
          city_suburb: citySuburb || null,
          state: state || null,
          zip_postcode: zipPostcode || null,
          country: country || null,
          other_location: otherLocation || null,
          where_location: whereLocation || null,
          spatial_location: spatialLocation || null,
          reactive_inspector_name: reactiveInspectorName || null,
          reactive_inspection_date: reactiveInspectionDate || null,
        })
        .returning("*");

      // For MySQL/MSSQL that don't support RETURNING, fetch the inserted row
      if (!inserted || typeof inserted === "number") {
        const id = typeof inserted === "number" ? inserted : (inserted as any);
        const row = await db("maintenance_requests").where("id", id).first();
        return res.status(201).json(row);
      }

      res.status(201).json(inserted);
    } catch (error) {
      console.error("Error creating maintenance request:", error);
      res.status(500).json({ error: "Failed to create maintenance request" });
    }
  },
);

/**
 * PUT /api/maintenance/requests/:id
 * Update a maintenance request
 */
router.put(
  "/requests/:id",
  [
    body("title").optional().isLength({ min: 1 }).trim(),
    body("description").optional().trim(),
    body("priority").optional().isIn(["low", "medium", "high", "critical"]),
    body("status")
      .optional()
      .isIn(["open", "in_progress", "completed", "cancelled"]),
    body("category").optional().trim(),
    body("location").optional().trim(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { title, description, priority, status, category, location } =
        req.body;

      const existing = await db("maintenance_requests").where("id", id).first();
      if (!existing) {
        return res.status(404).json({ error: "Maintenance request not found" });
      }

      const updateData: any = { updated_at: db.fn.now() };
      if (title) updateData.title = title;
      if (description) updateData.description = description;
      if (priority) updateData.priority = priority;
      if (status) updateData.status = status;
      if (category) updateData.category = category;
      if (location) updateData.location = location;

      await db("maintenance_requests").where("id", id).update(updateData);
      const updated = await db("maintenance_requests").where("id", id).first();

      res.json(updated);
    } catch (error) {
      console.error("Error updating maintenance request:", error);
      res.status(500).json({ error: "Failed to update maintenance request" });
    }
  },
);

// ─── Work Orders ────────────────────────────────────────────────────────────

/**
 * GET /api/maintenance/work-orders
 * List work orders
 */
router.get("/work-orders", async (req: AuthRequest, res: Response) => {
  try {
    const { status, craft, work_group, limit = 100, offset = 0 } = req.query;

    let qb = db("work_orders as wo")
      .leftJoin("users as u", "wo.assigned_to", "u.id")
      .leftJoin("maintenance_requests as mr", "wo.request_id", "mr.id")
      .select(
        "wo.*",
        "u.username as assigned_to_username",
        "mr.title as request_title",
      );

    if (status) {
      qb = qb.where("wo.status", status as string);
    }

    if (craft) {
      qb = qb.where("wo.craft", craft as string);
    }

    if (work_group) {
      qb = qb.where("wo.work_group", work_group as string);
    }

    const workOrders = await qb
      .orderBy("wo.created_at", "desc")
      .limit(Number(limit))
      .offset(Number(offset));

    res.json({
      workOrders,
      total: workOrders.length,
    });
  } catch (error) {
    console.error("Error fetching work orders:", error);
    res.status(500).json({ error: "Failed to fetch work orders" });
  }
});

/**
 * GET /api/maintenance/work-orders/:id
 * Get a specific work order
 */
router.get("/work-orders/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const workOrder = await db("work_orders as wo")
      .leftJoin("users as u", "wo.assigned_to", "u.id")
      .leftJoin("maintenance_requests as mr", "wo.request_id", "mr.id")
      .select(
        "wo.*",
        "u.username as assigned_to_username",
        "mr.title as request_title",
      )
      .where("wo.id", id)
      .first();

    if (!workOrder) {
      return res.status(404).json({ error: "Work order not found" });
    }

    res.json(workOrder);
  } catch (error) {
    console.error("Error fetching work order:", error);
    res.status(500).json({ error: "Failed to fetch work order" });
  }
});

// ── Notional Asset Resolution ─────────────────────────────────────────────────
//
// Assets ending in NAN / NAS / NANW are "Notional Assets" — virtual trade buckets
// at the building level (e.g. "LGH Allambie Structure NAN").  When a work order is
// created we swap the specific asset for the appropriate notional asset so that
// trade work accumulates against the right virtual bucket.
//
// Mapping: craft keyword → discipline substring in the notional asset name.
const CRAFT_TO_DISCIPLINE: Array<[RegExp, string]> = [
  [/carpent|joinr?y?|builder|structur|joiner/i, "Structure"],
  [/electri/i, "Electrical Services"],
  [/plumb|hydraulic/i, "Hydraulics & Plumbing"],
  [/mechanical|hvac|air.?con|ventilat/i, "Mechanical"],
  [/refriger|cold.?room/i, "Refrigeration"],
  [/fire/i, "Fire System"],
  [/secur/i, "Security"],
  [/horticul|garden|grounds|landscap/i, "Horticultural"],
  [/generator|genset/i, "Generator"],
  [/lift|elevator/i, "Lift"],
  [/medical.?gas|gas/i, "Medical Gases"],
  [/bms|building.?manag|ctrl/i, "Bld Mgmt and Ctrl"],
  [/cardiac|body.?protect|defib/i, "Body & Cardiac Protection"],
];

function craftToDiscipline(craft: string): string | null {
  for (const [pattern, discipline] of CRAFT_TO_DISCIPLINE) {
    if (pattern.test(craft)) return discipline;
  }
  return null;
}

// Assetic Work Request Types use slightly different discipline names to the
// notional asset discipline strings, so we maintain a separate translation.
// Keys are the notional-asset discipline values; values are the WR type names.
const WR_DISCIPLINE_NAME: Record<string, string> = {
  Structure: "Structure",
  "Electrical Services": "Electrical Services",
  "Hydraulics & Plumbing": "Hydraulics & Plumbing",
  Mechanical: "Mechanical",
  Refrigeration: "Refrigeration",
  "Fire System": "Fire Services",
  Security: "Security",
  Horticultural: "Horticultural",
  Generator: "Generator",
  Lift: "Lift",
  "Medical Gases": "Medical Gases",
  "Bld Mgmt and Ctrl": "Building Management & Control",
  "Body & Cardiac Protection": "Body & Cardiac Protection",
};

/**
 * Look up the Assetic Work Request Type ID (assetic_id) for an Incident of
 * the given direction and optional craft discipline.
 *
 * - directionSource  any string containing direction info: work group name,
 *                    location path, etc.  e.g. "North - Electrician" or
 *                    "LGH > North > Level 2"
 * - craft            optional craft string; when provided the specific
 *                    discipline type is used (e.g. "North - Electrical Services")
 *                    instead of the generic direction-only type ("North").
 *
 * Returns the numeric assetic_id to pass as WorkRequestTypeId, or null.
 */
async function resolveIncidentTypeId(
  directionSource: string | null,
  craft: string | null,
): Promise<number | null> {
  const src = (directionSource || "").toLowerCase();

  let direction: string;
  if (/north.?west|\bnw\b/.test(src)) direction = "North West";
  else if (/\bsouth\b/.test(src)) direction = "South";
  else if (/\bnorth\b/.test(src)) direction = "North";
  else return null; // no recognisable direction

  // Build the full WR type name: "North - Electrical Services" or just "North"
  let typeName = direction;
  if (craft) {
    const naDisc = craftToDiscipline(craft);
    const wrDisc = naDisc ? WR_DISCIPLINE_NAME[naDisc] : null;
    if (wrDisc) typeName = `${direction} - ${wrDisc}`;
  }

  const row = await db("assetic_work_request_types")
    .whereRaw("LTRIM(RTRIM(name)) = ?", [typeName])
    .where("type_name", "Incident")
    .select("assetic_id")
    .first();

  if (row) return Number(row.assetic_id);

  // Fallback: direction-only type if the specific discipline type isn't found
  if (typeName !== direction) {
    const fallback = await db("assetic_work_request_types")
      .whereRaw("LTRIM(RTRIM(name)) = ?", [direction])
      .where("type_name", "Incident")
      .select("assetic_id")
      .first();
    if (fallback) return Number(fallback.assetic_id);
  }

  return null;
}

type ResolvedLabourAssignment = {
  resourceId: string;
  plannedGroupCraftId?: string;
  assignedGroupCraftId?: string;
  groupCraftId?: string;
} | null;

async function resolveResourceIdForIdentity(
  identity: string | null,
): Promise<string | null> {
  const value = (identity || "").trim();
  if (!value) return null;

  const esc = (s: string) => s.replace(/'/g, "''");

  try {
    // First attempt an exact DisplayName match.
    let data = await asseticClient.getResources({
      page: 1,
      pageSize: 20,
      filters: `DisplayName~eq~'${esc(value)}'`,
    });
    let rows: any[] = Array.isArray(data)
      ? data
      : data?.ResourceList || data?.Results || data?.results || [];
    if (rows[0]?.Id) return String(rows[0].Id);

    // Fallback to contains to handle formatting differences.
    data = await asseticClient.getResources({
      page: 1,
      pageSize: 20,
      filters: `DisplayName~contains~'${esc(value)}'`,
    });
    rows = Array.isArray(data)
      ? data
      : data?.ResourceList || data?.Results || data?.results || [];
    if (rows[0]?.Id) return String(rows[0].Id);
  } catch {
    // Non-fatal — caller will handle null and fallback behavior.
  }

  return null;
}

function parseLabourAssignmentFromRow(row: any): ResolvedLabourAssignment {
  if (!row || typeof row !== "object") return null;

  // Different Assetic endpoints return different shapes; accept the common ones.
  const resourceId =
    row?.Resource?.Id ??
    row?.ResourceId ??
    row?.MaintenanceResourceId ??
    row?.Id ??
    null;
  if (resourceId == null) return null;

  return {
    resourceId: String(resourceId),
    plannedGroupCraftId:
      row?.PlannedGroupCraftId != null
        ? String(row.PlannedGroupCraftId)
        : undefined,
    assignedGroupCraftId:
      row?.AssignedGroupCraftId != null
        ? String(row.AssignedGroupCraftId)
        : undefined,
    groupCraftId:
      row?.GroupCraftId != null ? String(row.GroupCraftId) : undefined,
  };
}

/**
 * Resolve the best labour assignment for a work group and craft.
 *
 * Some Assetic tenants require Resource plus group-craft linkage.
 * Prefer direct work-group-scoped lookups to avoid long, sequential scans.
 */
async function resolveLabourAssignment(
  workGroup: string | null,
  craft: string | null,
): Promise<ResolvedLabourAssignment> {
  if (!workGroup) return null;

  const esc = (s: string) => s.replace(/'/g, "''");
  const workGroupFilter = `WorkGroupName~eq~'${esc(workGroup)}'`;
  const craftText = (craft || "").trim().toLowerCase();

  // 1) Fast path: managedresource already models resource↔workgroup assignments.
  let data: any;
  try {
    data = await asseticClient.getManagedResources({
      page: 1,
      pageSize: 500,
      filters: workGroupFilter,
    });
    const rows: any[] = Array.isArray(data)
      ? data
      : data?.ResourceList || data?.Results || data?.results || [];

    let fallback: ResolvedLabourAssignment = null;
    for (const row of rows) {
      const assignment = parseLabourAssignmentFromRow(row);
      if (!assignment) continue;
      if (!fallback) fallback = assignment;

      if (!craftText) return assignment;

      const rowText = `${
        row?.CraftName || ""
      } ${row?.Craft || ""} ${row?.Name || ""} ${row?.DisplayName || ""}`
        .toLowerCase()
        .trim();
      if (rowText.includes(craftText)) return assignment;
    }
    if (fallback) return fallback;
  } catch {
    // fall through to resource endpoint fallback
  }

  // 2) Fallback: query resources directly by work group and optional craft text.
  try {
    const filters = craftText
      ? `${workGroupFilter}~and~DisplayName~contains~'${esc(craft || "")}'`
      : workGroupFilter;
    data = await asseticClient.getResources({
      page: 1,
      pageSize: 500,
      filters,
    });
    const rows: any[] = Array.isArray(data)
      ? data
      : data?.ResourceList || data?.Results || data?.results || [];
    if (rows.length) {
      const assignment = parseLabourAssignmentFromRow(rows[0]);
      if (assignment) return assignment;
    }
  } catch {
    // keep falling through
  }

  return null;
}

/**
 * Given an asset name and a craft name, find the most appropriate Notional
 * Asset (NAN/NAS/NANW) for the same site and trade using name-based matching.
 *
 * Strategy:
 *  1. Extract the site code = first word of the original asset name (e.g. "LGHP")
 *  2. Determine the discipline string from the craft keyword
 *  3. Determine the NAN/NAS/NANW suffix from the direction embedded in the work
 *     group name ("North - Electrician" → NAN) or the asset location field
 *  4. Query assetic_assets restricted to that exact suffix, trying progressively
 *     shorter site code prefixes (LGHP → LGH → LG) until candidates are found.
 *     Each attempt uses "LIKE '{code} %'" (space after code) to avoid a shorter
 *     code (LGH) accidentally matching a longer one (LGHP).
 *  5. Among candidates, prefer the shortest name (fewest words) — this picks the
 *     site-level notional asset over sub-building variants
 *
 * Returns { guid, assetId, name } or null if not found.
 */
async function resolveNotionalAsset(
  originalAssetGuid: string,
  originalAssetName: string | null,
  craft: string,
  workGroup: string | null,
  location: string | null,
): Promise<{ guid: string; assetId: string; name: string } | null> {
  const discipline = craftToDiscipline(craft);
  if (!discipline) return null;

  // Site code is the first word of the asset name, e.g. "LGHP Level 2 Ward 1" → "LGHP"
  const fullCode = (originalAssetName || "").trim().split(/\s+/)[0];
  if (!fullCode) return null;

  // Determine the directional suffix from the work group name first (most reliable),
  // then fall back to the asset location field.
  // Work group examples: "North - Electrician", "South Carpenters", "North West - Plumbing"
  // Location examples: "North", "South", "North West"
  const dirSource = `${workGroup || ""} ${location || ""}`.trim();
  let suffix: string;
  if (/north.?west|\bnw\b/i.test(dirSource)) {
    suffix = "NANW";
  } else if (/\bsouth\b/i.test(dirSource)) {
    suffix = "NAS";
  } else {
    // "North" or anything unrecognised defaults to NAN
    suffix = "NAN";
  }

  // Try progressively shorter site code prefixes until candidates are found.
  // e.g. "LGHP Launceston General Hospital (BUILDING)" has site code "LGHP",
  // but its NAN assets are stored as "LGH Structure NAN" (without the P).
  // Each attempt uses "'{code} %'" (space after code) so "LGH" never matches
  // "LGHP Structure NAN" assets and vice versa.
  for (let len = fullCode.length; len >= 2; len--) {
    const siteCode = fullCode.slice(0, len);
    const candidates = await db("assetic_assets")
      .where("asset_name", "like", `${siteCode} %`)
      .whereRaw("asset_name LIKE ?", [`%${discipline}%`])
      .where("asset_name", "like", `% ${suffix}`)
      .select(
        "assetic_guid as guid",
        "asset_id as assetId",
        "asset_name as name",
      );

    if (candidates.length) {
      // Prefer the site-level asset (shortest name = fewest words between site code and suffix)
      // e.g. "LGH Structure NAN" (3 words) beats "LGH Holman Structure NAN" (4 words)
      candidates.sort(
        (a: any, b: any) =>
          a.name.trim().split(/\s+/).length - b.name.trim().split(/\s+/).length,
      );
      console.log(
        `Notional asset search: siteCode "${siteCode}" (from "${fullCode}") → found "${candidates[0].name}"`,
      );
      return candidates[0];
    }

    console.log(
      `Notional asset search: siteCode "${siteCode}" → no candidates, trying shorter prefix`,
    );
  }

  return null;
}

/**
 * POST /api/maintenance/work-orders
 * Create a work order (locally + in Assetic) from a maintenance request.
 * Failures are logged to failed_work_orders so admins can review and retry.
 */
router.post(
  "/work-orders",
  [
    body("requestId").isInt(),
    body("title").isLength({ min: 1 }).trim(),
    body("description").optional().trim(),
    body("priority").optional().isIn(["low", "medium", "high", "critical"]),
    body("craft").optional().trim(),
    body("workGroup").optional().trim(),
    body("assignedTo").optional().isInt(),
    // Accept full datetime-local strings (YYYY-MM-DDTHH:mm) or plain dates
    body("scheduledDate").optional().trim(),
    body("estimatedDuration").optional().isFloat({ min: 0 }),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const {
        requestId,
        title,
        description,
        priority,
        craft,
        workGroup,
        assignedTo,
        scheduledDate,
        estimatedDuration,
      } = req.body;

      // Verify the maintenance request exists
      const reqCheck = await db("maintenance_requests")
        .where("id", requestId)
        .first();
      if (!reqCheck) {
        return res.status(404).json({ error: "Maintenance request not found" });
      }

      // Inherit asset info and priority from the parent request
      const inheritedPriority = priority || reqCheck.priority || "medium";
      let inheritedAssetGuid = reqCheck.assetic_asset_guid || null;
      let inheritedAssetName =
        reqCheck.asset_display_name || reqCheck.asset_name || null;
      const inheritedAssetLocation =
        reqCheck.location || reqCheck.where_location || null;
      const inheritedWrGuid = reqCheck.assetic_work_request_id || null;

      // Attempt to resolve the Notional Asset (NAN/NAS/NANW) for the given craft.
      // If found, the work order is assigned to that virtual trade bucket instead of
      // the specific asset, which is standard practice for reactive maintenance.
      if (inheritedAssetGuid && craft) {
        try {
          const notional = await resolveNotionalAsset(
            inheritedAssetGuid,
            inheritedAssetName,
            craft,
            workGroup || null,
            inheritedAssetLocation,
          );
          if (notional) {
            console.log(
              `Notional asset resolved: ${notional.name} (assetId: ${notional.assetId}, guid: ${notional.guid}) for craft "${craft}" / workGroup "${workGroup}"`,
            );
            inheritedAssetGuid = notional.guid;
            inheritedAssetName = notional.name;
          } else {
            console.log(
              `No notional asset found for craft "${craft}" / workGroup "${workGroup}" / location "${inheritedAssetLocation}" — using original asset: ${inheritedAssetName} (guid: ${inheritedAssetGuid})`,
            );
          }
        } catch (notionalErr: any) {
          console.warn(
            `Notional asset lookup failed (non-fatal): ${notionalErr.message}`,
          );
        }
      }

      // Normalise dates: Assetic requires a full ISO datetime (T00:00:00 if no
      // time was provided). Plain date strings like "2026-04-01" get midnight appended.
      const normaliseDateTime = (val?: string): string | null => {
        if (!val) return null;
        // Already has time component (T or space separator)
        if (val.includes("T") || val.match(/\d{4}-\d{2}-\d{2} \d{2}:/))
          return val.replace(" ", "T");
        // Plain date — append midnight
        return `${val}T00:00:00`;
      };

      // Convert a normalised datetime string to a JS Date for DB inserts.
      // Passing a Date object avoids SQL Server rejecting ISO strings with
      // timezone suffixes (Z, +HH:MM) that the tedious driver cannot convert.
      const toDbDate = (val: string | null): Date | null => {
        if (!val) return null;
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
      };

      const normScheduledStart = normaliseDateTime(scheduledDate);
      // Finish is identical to start — a single datetime picker covers both ends.
      // The worker's estimated hours is tracked separately via EstimatedDuration.
      const normScheduledFinish = normScheduledStart;

      // ── Assetic integration ───────────────────────────────────────────────
      let asseticWorkOrderId: string | null = null;
      let asseticFriendlyId: string | null = null;
      const asseticEnabled = await asseticClient.isEnabled();

      // Estimated duration (hours). Stored here so it's accessible in both the
      // PREP creation payload and the RFE transition payload below.
      const durationHours = estimatedDuration
        ? Number(estimatedDuration)
        : null;

      if (asseticEnabled) {
        // ── Step 1: Create the work order in PREP status ──────────────────
        // Log the asset being used so failures are easy to diagnose
        console.log(
          `Creating WO for request ${requestId} — asset: "${inheritedAssetName}" (guid: ${inheritedAssetGuid}) | workGroup: "${workGroup}" | craft: "${craft}"`,
        );
        // the subsequent RFE status transition fails. Admins can see the failure
        // and retry the promotion separately.

        // Resolve the Assetic WorkOrderType (Incident + region + discipline).
        // Uses workGroup as the primary direction source (most reliable), falls
        // back to inheritedAssetLocation if workGroup has no region keyword.
        const dirSource =
          `${workGroup || ""} ${inheritedAssetLocation || ""}`.trim();
        const woTypeId = await resolveIncidentTypeId(dirSource, craft || null);
        let labourAssignment = await resolveLabourAssignment(
          workGroup || null,
          craft || null,
        );

        const creatorResourceId = await resolveResourceIdForIdentity(
          req.user?.email || req.user?.username || null,
        );
        if (woTypeId) {
          console.log(
            `Resolved WorkOrderType Id: ${woTypeId} for workGroup "${workGroup}" / craft "${craft}"`,
          );
        } else {
          console.warn(
            `Could not resolve WorkOrderType for workGroup "${workGroup}" / craft "${craft}" — omitting from payload`,
          );
        }
        if (labourAssignment?.resourceId) {
          console.log(
            `Resolved Labour Resource Id: ${labourAssignment.resourceId} for workGroup "${workGroup}" / craft "${craft}"`,
          );
        } else {
          console.warn(
            `Could not resolve Labour Resource for workGroup "${workGroup}" / craft "${craft}"`,
          );
        }

        if (creatorResourceId) {
          console.log(`Resolved Creator/Requestor Resource Id: ${creatorResourceId}`);
          if (!labourAssignment) {
            // Fallback: use the creator's resource when no group/craft-specific
            // labour assignment can be resolved.
            labourAssignment = { resourceId: creatorResourceId };
          }
        } else {
          console.warn(
            `Could not resolve Creator/Requestor Resource from identity "${req.user?.email || req.user?.username || ""}"`,
          );
        }

        const prepPayload: any = {
          Status: "PREP",
          BriefDescription: title.slice(0, 250),
          LocationDescription: inheritedAssetLocation || undefined,
        };

        if (creatorResourceId) {
          prepPayload.CreatorId = creatorResourceId;
          prepPayload.RequestorId = creatorResourceId;
        }

        if (woTypeId) {
          prepPayload.WorkOrderType = { Id: woTypeId };
        }

        if (durationHours) {
          // Assetic stores EstimatedDuration in minutes
          prepPayload.EstimatedDuration = Math.round(durationHours * 60);
        }
        if (inheritedAssetGuid) {
          prepPayload.AssetId = inheritedAssetGuid;
        }
        if (workGroup) {
          prepPayload.WorkOrderWorkGroup = workGroup;
        }

        // Some Assetic configurations require at least one assigned labour resource
        // aligned to the work group / craft when creating the WO.
        if (labourAssignment?.resourceId) {
          const labour: any = {
            QuantityRequired: 1,
            HoursRequired: durationHours || 1,
            MaintenanceResources: [
              {
                Resource: { Id: labourAssignment.resourceId },
                StatusId: 1,
              },
            ],
          };

          if (labourAssignment.plannedGroupCraftId) {
            labour.PlannedGroupCraftId = labourAssignment.plannedGroupCraftId;
          }
          if (labourAssignment.assignedGroupCraftId) {
            labour.MaintenanceResources[0].AssignedGroupCraftId =
              labourAssignment.assignedGroupCraftId;
          }
          if (labourAssignment.groupCraftId) {
            labour.MaintenanceResources[0].GroupCraftId =
              labourAssignment.groupCraftId;
          }

          prepPayload.Labours = [labour];
        }

        // Build supporting information: prepend location + requestor info,
        // then append any extra description provided by the admin.
        const siParts: string[] = [];
        if (inheritedAssetLocation) {
          siParts.push(`Location: ${inheritedAssetLocation}`);
        }
        const requestorParts: string[] = [];
        if (reqCheck.requestor_display_name)
          requestorParts.push(reqCheck.requestor_display_name);
        if (reqCheck.requestor_email)
          requestorParts.push(`Email: ${reqCheck.requestor_email}`);
        if (reqCheck.requestor_phone)
          requestorParts.push(`Ph: ${reqCheck.requestor_phone}`);
        if (reqCheck.requestor_mobile)
          requestorParts.push(`Mob: ${reqCheck.requestor_mobile}`);
        if (requestorParts.length) {
          siParts.push(`Reported by: ${requestorParts.join(" | ")}`);
        }
        if (reqCheck.supporting_information) {
          siParts.push(reqCheck.supporting_information);
        }
        if (description) siParts.push(description);

        if (siParts.length) {
          prepPayload.SupportingInformation = [
            { Description: siParts.join("\n") },
          ];
        }
        if (normScheduledStart || normScheduledFinish) {
          prepPayload.Scheduling = {};
          if (normScheduledStart)
            prepPayload.Scheduling.ScheduledStart = normScheduledStart;
          if (normScheduledFinish)
            prepPayload.Scheduling.ScheduledFinish = normScheduledFinish;
        }
        if (inheritedWrGuid) {
          prepPayload.WorkRequestId = inheritedWrGuid;
        }

        try {
          const asseticResult =
            await asseticClient.createWorkOrder(prepPayload);

          // Response can be a GUID string OR an object with Id
          if (typeof asseticResult === "string") {
            asseticWorkOrderId = asseticResult.trim().replace(/^"|"$/g, "");
          } else if (asseticResult && typeof asseticResult === "object") {
            asseticWorkOrderId = asseticResult.Id || asseticResult.id || null;
          }

          console.log(
            `Assetic WO created (PREP) — GUID: ${asseticWorkOrderId}`,
          );

          // Fetch human-readable FriendlyId
          if (asseticWorkOrderId) {
            try {
              const woDetail =
                await asseticClient.getWorkOrder(asseticWorkOrderId);
              asseticFriendlyId =
                woDetail?.FriendlyId?.toString() ||
                woDetail?.FriendlyIdStr ||
                null;
              console.log(`Assetic WO FriendlyId: ${asseticFriendlyId}`);
            } catch (fetchErr: any) {
              console.warn(
                `Could not fetch WO detail for friendly ID (non-fatal): ${fetchErr.message}`,
              );
            }
          }
        } catch (asseticErr: any) {
          const errData = asseticErr?.response?.data;
          const httpStatus = asseticErr?.response?.status ?? null;
          const msg =
            extractAsseticErrorMessage(errData) ||
            asseticErr?.message ||
            "Assetic work order creation failed";

          console.error(
            `Assetic WO creation (PREP) failed (HTTP ${httpStatus}):`,
            msg,
            "| Raw:",
            JSON.stringify(errData),
          );

          try {
            await db("failed_work_orders").insert({
              request_id: requestId,
              created_by: req.user?.id ?? null,
              title,
              description: description || null,
              priority: inheritedPriority,
              craft: craft || null,
              work_group: workGroup || null,
              assetic_asset_guid: inheritedAssetGuid,
              asset_name: inheritedAssetName,
              asset_location: inheritedAssetLocation,
              scheduled_start: toDbDate(normScheduledStart),
              scheduled_finish: toDbDate(normScheduledFinish),
              assetic_payload: JSON.stringify(prepPayload),
              error_message: msg,
              assetic_error_response: errData ? JSON.stringify(errData) : null,
              assetic_http_status: httpStatus,
              status: "pending",
              created_at: new Date(),
              updated_at: new Date(),
            });
          } catch (dbErr) {
            console.error("Failed to log failed work order to DB:", dbErr);
          }

          // PREP creation failed entirely — nothing was created in Assetic
          return res.status(502).json({
            error: `Assetic rejected the work order: ${msg}`,
            // Asset resolution details so admins can diagnose mismatches
            resolvedAsset: inheritedAssetName
              ? {
                  name: inheritedAssetName,
                  guid: inheritedAssetGuid,
                }
              : null,
          });
        }

        // ── Step 2: Transition PREP → RFE ────────────────────────────────
        // The WO now exists in Assetic. Promote it to RFE (Ready for Execution)
        // so it appears in the work group's mobile app queue. Failure here is
        // non-fatal: the local WO is still saved and the failure is logged for
        // admin review / retry.
        if (asseticWorkOrderId) {
          const rfePayload: any = {
            Id: asseticWorkOrderId,
            Status: "RFE",
          };
          if (durationHours) {
            rfePayload.EstimatedDuration = Math.round(durationHours * 60);
          }

          if (durationHours || labourAssignment?.resourceId) {
            // Labour entry for RFE: one resource, one quantity, with the selected
            // work-group-matched resource when available.
            const labour: any = {
              QuantityRequired: 1,
              HoursRequired: durationHours || 1,
            };
            if (labourAssignment?.resourceId) {
              labour.MaintenanceResources = [
                {
                  Resource: { Id: labourAssignment.resourceId },
                  StatusId: 1,
                },
              ];

              if (labourAssignment.plannedGroupCraftId) {
                labour.PlannedGroupCraftId =
                  labourAssignment.plannedGroupCraftId;
              }
              if (labourAssignment.assignedGroupCraftId) {
                labour.MaintenanceResources[0].AssignedGroupCraftId =
                  labourAssignment.assignedGroupCraftId;
              }
              if (labourAssignment.groupCraftId) {
                labour.MaintenanceResources[0].GroupCraftId =
                  labourAssignment.groupCraftId;
              }
            }
            rfePayload.Labours = [labour];
          }

          try {
            await asseticClient.updateWorkOrder(asseticWorkOrderId, rfePayload);
            console.log(`Assetic WO ${asseticWorkOrderId} promoted to RFE`);
          } catch (rfeErr: any) {
            const errData = rfeErr?.response?.data;
            const httpStatus = rfeErr?.response?.status ?? null;
            const msg =
              extractAsseticErrorMessage(errData) ||
              rfeErr?.message ||
              "Assetic RFE status transition failed";

            console.error(
              `Assetic WO RFE transition failed (HTTP ${httpStatus}):`,
              msg,
              "| Raw:",
              JSON.stringify(errData),
            );

            // Log for admin review — the WO will still be saved locally and in
            // Assetic at PREP status; admin can retry the promotion.
            try {
              await db("failed_assetic_status_changes").insert({
                assetic_work_order_guid: asseticWorkOrderId,
                from_status: "PREP",
                to_status: "RFE",
                assetic_payload: JSON.stringify(rfePayload),
                error_message: msg,
                assetic_error_response: errData
                  ? JSON.stringify(errData)
                  : null,
                assetic_http_status: httpStatus,
                status: "pending",
                created_at: new Date(),
                updated_at: new Date(),
              });
            } catch (dbErr) {
              console.error(
                "Failed to log RFE status change failure to DB:",
                dbErr,
              );
            }
            // Continue — local WO is still created below
          }
        }
      }

      // ── Save to local database ────────────────────────────────────────────
      const insertedRows = await db("work_orders")
        .insert({
          request_id: requestId,
          assigned_to: assignedTo || null,
          craft: craft || null,
          work_group: workGroup || null,
          title,
          description: description || null,
          priority: inheritedPriority,
          scheduled_date: toDbDate(normScheduledStart),
          scheduled_finish: toDbDate(normScheduledFinish),
          assetic_work_order_id: asseticWorkOrderId,
          assetic_friendly_id: asseticFriendlyId,
          // Asset fields carried from the maintenance request
          assetic_asset_guid: inheritedAssetGuid,
          asset_name: inheritedAssetName,
          asset_location: inheritedAssetLocation,
        })
        .returning("id");

      const firstRow = insertedRows[0];
      const newId: number =
        typeof firstRow === "object" && firstRow !== null
          ? (firstRow as any).id
          : Number(firstRow);

      // Update the maintenance request status to in_progress
      await db("maintenance_requests")
        .where("id", requestId)
        .update({ status: "in_progress", updated_at: db.fn.now() });

      // ── Update WR type in Assetic to the specific discipline+direction type ──
      // Now that we know the craft, we can be more specific than the generic
      // directional type that was set on initial WR creation (e.g. "North").
      // Upgrade it to e.g. "North - Electrical Services" if the type exists.
      if (asseticEnabled && inheritedWrGuid && craft) {
        try {
          const dirSource = `${workGroup || ""} ${inheritedAssetLocation || ""}`;
          const specificTypeId = await resolveIncidentTypeId(dirSource, craft);
          if (specificTypeId) {
            await asseticClient.updateWorkRequest(inheritedWrGuid, {
              WorkRequestTypeId: specificTypeId,
            });
            console.log(
              `WR ${inheritedWrGuid} type updated to incident type ${specificTypeId} (craft: ${craft})`,
            );
          }
        } catch (wrTypeErr: any) {
          // Non-fatal — the WO is already saved; log and continue
          console.warn(
            `Could not update WR incident type (non-fatal): ${wrTypeErr.message}`,
          );
        }
      }

      const workOrder = await db("work_orders").where("id", newId).first();
      return res.status(201).json(workOrder);
    } catch (error) {
      console.error("Error creating work order:", error);
      res.status(500).json({ error: "Failed to create work order" });
    }
  },
);

/**
 * PUT /api/maintenance/work-orders/:id
 * Update a work order (status, assignment, craft, etc.)
 */
router.put(
  "/work-orders/:id",
  [
    body("title").optional().isLength({ min: 1 }).trim(),
    body("description").optional().trim(),
    body("priority").optional().isIn(["low", "medium", "high", "critical"]),
    body("status")
      .optional()
      .isIn(["pending", "in_progress", "completed", "cancelled"]),
    body("craft").optional().trim(),
    body("workGroup").optional().trim(),
    body("assignedTo").optional().isInt(),
    body("scheduledDate").optional().isISO8601(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const {
        title,
        description,
        priority,
        status,
        craft,
        workGroup,
        assignedTo,
        scheduledDate,
      } = req.body;

      const existing = await db("work_orders")
        .where("id", id)
        .select("id", "request_id")
        .first();
      if (!existing) {
        return res.status(404).json({ error: "Work order not found" });
      }

      const updateData: any = { updated_at: db.fn.now() };
      if (title) updateData.title = title;
      if (description) updateData.description = description;
      if (priority) updateData.priority = priority;
      if (status) updateData.status = status;
      if (craft) updateData.craft = craft;
      if (workGroup !== undefined) updateData.work_group = workGroup || null;
      if (assignedTo) updateData.assigned_to = assignedTo;
      if (scheduledDate) updateData.scheduled_date = scheduledDate;
      if (status === "completed") updateData.completed_at = db.fn.now();

      await db("work_orders").where("id", id).update(updateData);

      // If work order is completed, update maintenance request status
      if (status === "completed") {
        await db("maintenance_requests")
          .where("id", existing.request_id)
          .update({ status: "completed", updated_at: db.fn.now() });
      }

      const updated = await db("work_orders").where("id", id).first();
      res.json(updated);
    } catch (error) {
      console.error("Error updating work order:", error);
      res.status(500).json({ error: "Failed to update work order" });
    }
  },
);

// ─── Work Order Messages ────────────────────────────────────────────────────

/**
 * GET /api/maintenance/work-orders/:id/messages
 * Get messages for a work order
 */
router.get(
  "/work-orders/:id/messages",
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { limit = 50, offset = 0 } = req.query;

      const messages = await db("work_order_messages as wom")
        .leftJoin("users as u", "wom.sender_id", "u.id")
        .select("wom.*", "u.username as sender_username")
        .where("wom.work_order_id", id)
        .orderBy("wom.created_at", "asc")
        .limit(Number(limit))
        .offset(Number(offset));

      res.json({
        messages,
        total: messages.length,
      });
    } catch (error) {
      console.error("Error fetching work order messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  },
);

/**
 * POST /api/maintenance/work-orders/:id/messages
 * Add a message to a work order
 */
router.post(
  "/work-orders/:id/messages",
  [body("message").isLength({ min: 1 }).trim()],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { message } = req.body;

      // Verify the work order exists
      const woCheck = await db("work_orders").where("id", id).first();
      if (!woCheck) {
        return res.status(404).json({ error: "Work order not found" });
      }

      const [inserted] = await db("work_order_messages")
        .insert({
          work_order_id: id,
          sender_id: req.user.id,
          message,
        })
        .returning("*");

      if (!inserted || typeof inserted === "number") {
        const newId =
          typeof inserted === "number" ? inserted : (inserted as any);
        const row = await db("work_order_messages").where("id", newId).first();
        return res.status(201).json(row);
      }

      res.status(201).json(inserted);
    } catch (error) {
      console.error("Error creating work order message:", error);
      res.status(500).json({ error: "Failed to create message" });
    }
  },
);

// ─── Attachments ─────────────────────────────────────────────────────────────

/**
 * GET /api/maintenance/requests/:id/attachments
 * List attachments for a maintenance request.
 * Returns metadata only — file content is stored in Assetic.
 */
router.get(
  "/requests/:id/attachments",
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      const request = await db("maintenance_requests").where("id", id).first();
      if (!request) {
        return res.status(404).json({ error: "Maintenance request not found" });
      }

      const attachments = await db("work_request_attachments")
        .where("maintenance_request_id", id)
        .orderBy("created_at", "asc");

      res.json({ attachments });
    } catch (error) {
      console.error("Error fetching attachments:", error);
      res.status(500).json({ error: "Failed to fetch attachments" });
    }
  },
);

/**
 * POST /api/maintenance/requests/:id/attachments
 * Upload a file attachment for a maintenance request.
 *
 * Body: { filename: string, mimeType: string, contentBase64: string, fileSizeBytes?: number }
 *
 * The file content (base64) is forwarded directly to the Assetic /api/v2/document endpoint
 * and only the resulting document GUID is stored in the local DB.
 */
router.post(
  "/requests/:id/attachments",
  [
    body("filename").trim().notEmpty(),
    body("mimeType").trim().notEmpty(),
    // contentBase64 can be many MB — just check it's present, not its length
    body("contentBase64").exists().notEmpty(),
    body("fileSizeBytes").optional().isInt({ min: 0 }),
    // Hard limit: 15 MB base64 ≈ 20 MB encoded — reject oversized payloads early
    body("contentBase64").custom((val: string) => {
      if (val && val.length > 20 * 1024 * 1024) {
        throw new Error("File exceeds the 15 MB size limit");
      }
      return true;
    }),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { filename, mimeType, contentBase64, fileSizeBytes } = req.body;

      const request = await db("maintenance_requests").where("id", id).first();
      if (!request) {
        return res.status(404).json({ error: "Maintenance request not found" });
      }

      // Insert a pending record first so the attachment is tracked even if Assetic upload fails
      const insertedRows = await db("work_request_attachments")
        .insert({
          maintenance_request_id: Number(id),
          original_filename: filename,
          mime_type: mimeType,
          file_size: fileSizeBytes || null,
          assetic_upload_status: "pending",
          uploaded_by: req.user.id,
          created_at: new Date(),
        })
        .returning("id");
      // MSSQL returns [{ id: N }], others return [N]
      const firstRow = insertedRows[0];
      const attachmentId: number =
        typeof firstRow === "object" && firstRow !== null
          ? (firstRow as any).id
          : Number(firstRow);

      // Attempt to upload to Assetic if integration is enabled and the WR has been synced
      const asseticEnabled = await asseticClient.isEnabled();
      const wrGuid = request.assetic_work_request_id;

      if (asseticEnabled && wrGuid) {
        try {
          const asseticResult = await asseticClient.uploadDocument(wrGuid, {
            name: filename,
            mimeType,
            contentBase64,
            fileSizeBytes: fileSizeBytes || 0,
          });

          const asseticDocId =
            asseticResult?.Id ||
            asseticResult?.id ||
            asseticResult?.DocumentGuid ||
            null;

          await db("work_request_attachments")
            .where("id", attachmentId)
            .update({
              assetic_document_id: asseticDocId,
              assetic_upload_status: "uploaded",
            });

          const attachment = await db("work_request_attachments")
            .where("id", attachmentId)
            .first();
          return res.status(201).json(attachment);
        } catch (asseticErr: any) {
          const msg =
            asseticErr?.response?.data?.Message ||
            asseticErr?.message ||
            "Assetic upload failed";
          console.error(`Assetic document upload failed for WR ${id}:`, msg);

          await db("work_request_attachments")
            .where("id", attachmentId)
            .update({
              assetic_upload_status: "failed",
              error_message: String(msg).slice(0, 500),
            });

          const attachment = await db("work_request_attachments")
            .where("id", attachmentId)
            .first();
          // Return 207 so the frontend knows the attachment was recorded but sync failed
          return res.status(207).json({
            ...attachment,
            warning:
              "Attachment recorded but failed to sync with Assetic. It will not appear in Assetic.",
          });
        }
      } else {
        // Assetic disabled or WR not yet synced — just mark as uploaded locally
        await db("work_request_attachments")
          .where("id", attachmentId)
          .update({
            assetic_upload_status:
              asseticEnabled && !wrGuid ? "pending" : "uploaded",
          });
      }

      const attachment = await db("work_request_attachments")
        .where("id", attachmentId)
        .first();
      res.status(201).json(attachment);
    } catch (error) {
      console.error("Error uploading attachment:", error);
      res.status(500).json({ error: "Failed to upload attachment" });
    }
  },
);

// ─── Crafts/Trades ──────────────────────────────────────────────────────────

/**
 * GET /api/maintenance/crafts
 * Get list of available crafts/trades for work order assignment
 */
router.get("/crafts", async (_req: AuthRequest, res: Response) => {
  try {
    const result = await db("work_orders")
      .distinct("craft")
      .whereNotNull("craft")
      .orderBy("craft", "asc");

    const crafts = result.map((row: any) => row.craft);

    res.json({ crafts });
  } catch (error) {
    console.error("Error fetching crafts:", error);
    res.status(500).json({ error: "Failed to fetch crafts" });
  }
});

// ─── Assetic Integration Endpoints ─────────────────────────────────────

/**
 * GET /api/maintenance/assetic/location-hierarchy
 * Returns cached Assetic hierarchy structured as regions -> sites -> buildings.
 * Pass ?refresh=true to force a re-fetch from Assetic.
 */
router.get(
  "/assetic/location-hierarchy",
  async (req: AuthRequest, res: Response) => {
    try {
      const enabled = await asseticClient.isEnabled();
      if (!enabled) {
        return res
          .status(503)
          .json({ error: "Assetic integration is not enabled" });
      }

      const forceRefresh =
        String(req.query.refresh || "").toLowerCase() === "true";
      const hierarchy = forceRefresh
        ? await asseticLocationHierarchyService.refreshFromAssetic()
        : await asseticLocationHierarchyService.getOrRefresh();

      res.json(hierarchy);
    } catch (error: any) {
      const mapped = buildAsseticHierarchyError(error);
      console.error(`Error fetching Assetic location hierarchy: ${mapped.log}`);
      res.status(mapped.status).json({ error: mapped.message });
    }
  },
);

/**
 * POST /api/maintenance/work-orders/:id/clone
 * Clone a work order into a new pending work order
 */
router.post(
  "/work-orders/:id/clone",
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const source = await db("work_orders").where("id", id).first();
      if (!source) {
        return res.status(404).json({ error: "Work order not found" });
      }

      const [inserted] = await db("work_orders")
        .insert({
          request_id: source.request_id || null,
          craft: source.craft || null,
          work_group: source.work_group || null,
          title: `${source.title} (Copy)`,
          description: source.description || null,
          priority: source.priority || "medium",
          status: "pending",
          scheduled_date: null,
        })
        .returning("*");

      if (!inserted || typeof inserted === "number") {
        const newId =
          typeof inserted === "number" ? inserted : (inserted as any);
        const row = await db("work_orders").where("id", newId).first();
        return res.status(201).json(row);
      }

      res.status(201).json(inserted);
    } catch (error) {
      console.error("Error cloning work order:", error);
      res.status(500).json({ error: "Failed to clone work order" });
    }
  },
);

/**
 * GET /api/maintenance/assetic/work-groups
 * Get available work groups (labour/trade groups) from Assetic API
 */
router.get("/assetic/work-groups", async (_req: AuthRequest, res: Response) => {
  try {
    const enabled = await asseticClient.isEnabled();
    if (!enabled) {
      return res
        .status(503)
        .json({ error: "Assetic integration is not enabled" });
    }

    // Use pageSize=500 to match the Assetic API collection recommendation and
    // ensure all work groups (including South, North, North West, etc.) are returned
    // in a single request rather than being silently truncated by the default page size.
    const data = await asseticClient.getWorkgroups({ page: 1, pageSize: 500 });
    const groups = Array.isArray(data)
      ? data
      : data?.ResourceList || data?.Results || data?.results || [];
    res.json({ workGroups: groups });
  } catch (error) {
    console.error("Error fetching work groups:", error);
    res.status(502).json({ error: "Failed to fetch work groups from Assetic" });
  }
});

/**
 * GET /api/maintenance/assetic/work-request-sources
 * Get available work request sources from Assetic API
 * This endpoint fetches work requests and extracts unique source IDs
 *
 * NOTE: This is a temporary implementation that samples existing work requests
 * to discover available sources. In production, consider:
 * 1. Caching the sources list (with TTL)
 * 2. Using a dedicated Assetic API endpoint if available
 * 3. Storing sources in the database during sync operations
 */
router.get(
  "/assetic/work-request-sources",
  async (_req: AuthRequest, res: Response) => {
    try {
      const enabled = await asseticClient.isEnabled();
      if (!enabled) {
        return res
          .status(503)
          .json({ error: "Assetic integration is not enabled" });
      }

      // Fetch a sample of work requests to extract source IDs
      const data = await asseticClient.getWorkRequests({ pageSize: 100 });

      // Extract unique source IDs from the response
      interface WorkRequestSource {
        id: string;
        name: string;
      }

      const sources: WorkRequestSource[] = [];
      const seenIds = new Set<string>();

      if (data && data.ResourceList) {
        for (const wr of data.ResourceList) {
          if (wr.WorkRequestSourceId && !seenIds.has(wr.WorkRequestSourceId)) {
            seenIds.add(wr.WorkRequestSourceId);
            sources.push({
              id: wr.WorkRequestSourceId,
              name: wr.WorkRequestSource || `Source ${wr.WorkRequestSourceId}`,
            });
          }
        }
      }

      res.json({ sources });
    } catch (error) {
      console.error("Error fetching work request sources:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch work request sources from Assetic" });
    }
  },
);

export default router;
