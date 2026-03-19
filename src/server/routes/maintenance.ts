import { Router, Response } from "express";
import { body, validationResult } from "express-validator";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import db from "../database";
import asseticClient from "../services/asseticClient";
import asseticLocationHierarchyService from "../services/asseticLocationHierarchyService";

const router = Router();

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
    body("workRequestSubtypeId").optional().trim(),
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
        workRequestSubtypeId,
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
      const asseticEnabled = await asseticClient.isEnabled();

      if (asseticEnabled) {
        if (!workRequestSourceId) {
          return res.status(400).json({
            error:
              "Request Source is required when Assetic integration is enabled.",
          });
        }

        const asseticPayload: any = {
          Description: title + (description ? `\n\n${description}` : ""),
          WorkRequestSourceId: workRequestSourceId,
          Location: location || null,
          SupportingInformation: supportingInformation || null,
          ExternalIdentifier: externalIdentifier || null,
          WorkRequestPriorityId: workRequestPriorityId || null,
          WorkRequestSubTypeId: workRequestSubtypeId || null,
        };

        if (resolvedAssetGuid) {
          asseticPayload.AssetId = resolvedAssetGuid;
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

        if (streetAddress || citySuburb || state) {
          asseticPayload.WorkRequestPhysicalLocation = {
            Address: {
              StreetNumber: streetNumber || null,
              StreetAddress: streetAddress || null,
              CitySuburb: citySuburb || null,
              State: state || null,
              ZipPostcode: zipPostcode || null,
              Country: country || null,
            },
            OtherLocation: otherLocation || null,
            WhereLocation: whereLocation || null,
          };
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
          asseticWorkRequestId =
            asseticResult?.Id ||
            asseticResult?.id ||
            asseticResult?.data?.Id ||
            asseticResult?.data?.id ||
            null;
        } catch (asseticErr: any) {
          const msg =
            asseticErr?.response?.data?.Message ||
            asseticErr?.response?.data?.message ||
            "Failed to create work request in Assetic.";
          console.error("Assetic WR creation failed:", msg);
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
          work_request_source_id: workRequestSourceId || null,
          requestor_display_name: requestorDisplayName || null,
          requestor_first_name: requestorFirstName || null,
          requestor_surname: requestorSurname || null,
          requestor_email: requestorEmail || null,
          requestor_phone: requestorPhone || null,
          requestor_mobile: requestorMobile || null,
          requestor_type_id: requestorTypeId || null,
          work_request_subtype_id: workRequestSubtypeId || null,
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

/**
 * POST /api/maintenance/work-orders
 * Create a work order from a maintenance request
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
    body("scheduledDate").optional().isISO8601(),
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
      } = req.body;

      // Verify the maintenance request exists
      const reqCheck = await db("maintenance_requests")
        .where("id", requestId)
        .first();
      if (!reqCheck) {
        return res.status(404).json({ error: "Maintenance request not found" });
      }

      // Carry asset info and priority from the parent request so nothing is lost
      // when transitioning from work request → work order.
      const inheritedPriority = priority || reqCheck.priority || "medium";
      const inheritedAssetGuid = reqCheck.assetic_asset_guid || null;
      const inheritedAssetName =
        reqCheck.asset_display_name || reqCheck.asset_name || null;
      const inheritedAssetLocation = reqCheck.location || null;

      const [inserted] = await db("work_orders")
        .insert({
          request_id: requestId,
          assigned_to: assignedTo || null,
          craft: craft || null,
          work_group: workGroup || null,
          title,
          description: description || null,
          priority: inheritedPriority,
          scheduled_date: scheduledDate || null,
          // Asset fields carried from the maintenance request
          assetic_asset_guid: inheritedAssetGuid,
          asset_name: inheritedAssetName,
          asset_location: inheritedAssetLocation,
        })
        .returning("*");

      // Update the maintenance request status to in_progress
      await db("maintenance_requests")
        .where("id", requestId)
        .update({ status: "in_progress", updated_at: db.fn.now() });

      // For MySQL/MSSQL that don't support RETURNING, fetch the inserted row
      if (!inserted || typeof inserted === "number") {
        const id = typeof inserted === "number" ? inserted : (inserted as any);
        const row = await db("work_orders").where("id", id).first();
        return res.status(201).json(row);
      }

      res.status(201).json(inserted);
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
 * GET /api/maintenance/assetic/work-request-types
 * Get available work request types from Assetic API
 */
router.get(
  "/assetic/work-request-types",
  async (_req: AuthRequest, res: Response) => {
    try {
      const enabled = await asseticClient.isEnabled();
      if (!enabled) {
        return res
          .status(503)
          .json({ error: "Assetic integration is not enabled" });
      }

      const types = await asseticClient.getWorkRequestTypes();
      // Log the first item so we can verify the field names in production
      if (types?.ResourceList?.length > 0) {
        console.log(
          "[WorkRequestTypes] Sample item:",
          JSON.stringify(types.ResourceList[0]),
        );
      }
      res.json(types);
    } catch (error) {
      console.error("Error fetching work request types:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch work request types from Assetic" });
    }
  },
);

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
