import { Router, Request, Response } from "express";
import passport from "passport";
import bcrypt from "bcrypt";
import { body, validationResult } from "express-validator";
import db from "../database";
import { generateToken } from "../middleware/auth";

const router = Router();

/**
 * POST /api/auth/register
 * Register a new user with local authentication
 */
router.post(
  "/register",
  [
    body("username").isLength({ min: 3 }).trim(),
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 8 }),
    body("firstName").optional().trim(),
    body("lastName").optional().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { username, email, password, firstName, lastName } = req.body;

      // Check if user already exists
      const existingUser = await db("users")
        .where("username", username)
        .orWhere("email", email)
        .select("id")
        .first();

      if (existingUser) {
        return res
          .status(409)
          .json({ error: "Username or email already exists" });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user
      const [inserted] = await db("users")
        .insert({
          username,
          email,
          password_hash: passwordHash,
          first_name: firstName,
          last_name: lastName,
          auth_provider: "local",
        })
        .returning([
          "id",
          "username",
          "email",
          "first_name",
          "last_name",
          "created_at",
        ]);

      // For MySQL/MSSQL that don't support RETURNING, fetch the inserted user
      let user = inserted;
      if (!user || typeof user === "number") {
        const id = typeof user === "number" ? user : (user as any);
        user = await db("users")
          .where("id", id)
          .select(
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "created_at",
          )
          .first();
      }

      const token = generateToken(user);

      res.status(201).json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
        },
        token,
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  },
);

/**
 * POST /api/auth/login
 * Login with username and password
 */
router.post(
  "/login",
  [body("username").trim(), body("password").exists()],
  (req: Request, res: Response, next: Function) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    passport.authenticate(
      "local",
      { session: false },
      (err: any, user: any, info: any) => {
        if (err) {
          return res.status(500).json({ error: "Authentication error" });
        }

        if (!user) {
          return res
            .status(401)
            .json({ error: info?.message || "Invalid credentials" });
        }

        const token = generateToken(user);

        res.json({
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role || "user",
          },
          token,
        });
      },
    )(req, res, next);
  },
);

/**
 * GET /api/auth/sso
 * Unified SSO entry point - redirects to configured SSO provider
 */
router.get("/sso", (req: Request, res: Response) => {
  if (process.env.SSO_ENABLED === "true" && process.env.OAUTH2_CLIENT_ID) {
    return res.redirect("/api/auth/oauth2");
  }
  if (process.env.SAML_ENABLED === "true" && process.env.SAML_ENTRY_POINT) {
    return res.redirect("/api/auth/saml");
  }
  return res.status(404).json({
    error: "SSO is not configured. Please contact your administrator.",
  });
});

/**
 * GET /api/auth/oauth2
 * Initiate OAuth2 SSO login
 */
router.get("/oauth2", passport.authenticate("oauth2"));

/**
 * GET /api/auth/oauth2/callback
 * OAuth2 callback
 */
router.get(
  "/oauth2/callback",
  passport.authenticate("oauth2", { session: false }),
  (req: Request, res: Response) => {
    const token = generateToken(req.user);
    // Redirect to frontend with token
    res.redirect(`/login/success?token=${token}`);
  },
);

/**
 * GET /api/auth/saml
 * Initiate SAML SSO login
 */
router.get("/saml", passport.authenticate("saml"));

/**
 * POST /api/auth/saml/callback
 * SAML callback
 */
router.post(
  "/saml/callback",
  passport.authenticate("saml", { session: false }),
  (req: Request, res: Response) => {
    const token = generateToken(req.user);
    res.json({ token, user: req.user });
  },
);

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get("/me", async (req: Request, res: Response) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const jwt = require("jsonwebtoken");
    const decoded: any = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key",
    );

    const user = await db("users")
      .where("id", decoded.id)
      .select(
        "id",
        "username",
        "email",
        "first_name",
        "last_name",
        "role",
        "department",
        "phone",
        "display_name",
        "pref_region_id",
        "pref_region_name",
        "pref_site_id",
        "pref_site_name",
        "pref_building_id",
        "pref_building_name",
        "pref_floor_id",
        "pref_floor_name",
      )
      .first();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role || "user",
      department: user.department || null,
      phone: user.phone || null,
      displayName: user.display_name || null,
      prefRegionId: user.pref_region_id || null,
      prefRegionName: user.pref_region_name || null,
      prefSiteId: user.pref_site_id || null,
      prefSiteName: user.pref_site_name || null,
      prefBuildingId: user.pref_building_id || null,
      prefBuildingName: user.pref_building_name || null,
      prefFloorId: user.pref_floor_id || null,
      prefFloorName: user.pref_floor_name || null,
    });
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
});

/**
 * PUT /api/auth/profile
 * Update the authenticated user's own preferred location settings.
 * Users can update their display name and preferred location without needing admin rights.
 */
router.put(
  "/profile",
  [
    body("department").optional().trim(),
    body("phone").optional().trim(),
    body("displayName").optional().trim(),
    body("prefRegionId").optional().trim(),
    body("prefRegionName").optional().trim(),
    body("prefSiteId").optional().trim(),
    body("prefSiteName").optional().trim(),
    body("prefBuildingId").optional().trim(),
    body("prefBuildingName").optional().trim(),
    body("prefFloorId").optional().trim(),
    body("prefFloorName").optional().trim(),
  ],
  async (req: Request, res: Response) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token provided" });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const jwt = require("jsonwebtoken");
      const decoded: any = jwt.verify(
        token,
        process.env.JWT_SECRET || "your-secret-key",
      );

      const {
        department,
        phone,
        displayName,
        prefRegionId,
        prefRegionName,
        prefSiteId,
        prefSiteName,
        prefBuildingId,
        prefBuildingName,
        prefFloorId,
        prefFloorName,
      } = req.body;

      const updateData: any = { updated_at: db.fn.now() };
      if (department !== undefined) updateData.department = department || null;
      if (phone !== undefined) updateData.phone = phone || null;
      if (displayName !== undefined)
        updateData.display_name = displayName || null;
      if (prefRegionId !== undefined)
        updateData.pref_region_id = prefRegionId || null;
      if (prefRegionName !== undefined)
        updateData.pref_region_name = prefRegionName || null;
      if (prefSiteId !== undefined)
        updateData.pref_site_id = prefSiteId || null;
      if (prefSiteName !== undefined)
        updateData.pref_site_name = prefSiteName || null;
      if (prefBuildingId !== undefined)
        updateData.pref_building_id = prefBuildingId || null;
      if (prefBuildingName !== undefined)
        updateData.pref_building_name = prefBuildingName || null;
      if (prefFloorId !== undefined)
        updateData.pref_floor_id = prefFloorId || null;
      if (prefFloorName !== undefined)
        updateData.pref_floor_name = prefFloorName || null;

      await db("users").where("id", decoded.id).update(updateData);

      const updated = await db("users")
        .where("id", decoded.id)
        .select(
          "id",
          "username",
          "email",
          "first_name",
          "last_name",
          "role",
          "department",
          "phone",
          "display_name",
          "pref_region_id",
          "pref_region_name",
          "pref_site_id",
          "pref_site_name",
          "pref_building_id",
          "pref_building_name",
          "pref_floor_id",
          "pref_floor_name",
        )
        .first();

      res.json({
        id: updated.id,
        username: updated.username,
        email: updated.email,
        firstName: updated.first_name,
        lastName: updated.last_name,
        role: updated.role || "user",
        department: updated.department || null,
        phone: updated.phone || null,
        displayName: updated.display_name || null,
        prefRegionId: updated.pref_region_id || null,
        prefRegionName: updated.pref_region_name || null,
        prefSiteId: updated.pref_site_id || null,
        prefSiteName: updated.pref_site_name || null,
        prefBuildingId: updated.pref_building_id || null,
        prefBuildingName: updated.pref_building_name || null,
        prefFloorId: updated.pref_floor_id || null,
        prefFloorName: updated.pref_floor_name || null,
      });
    } catch (error) {
      res.status(401).json({ error: "Invalid token" });
    }
  },
);

export default router;
