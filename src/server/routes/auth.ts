import { Router, Request, Response } from 'express';
import passport from 'passport';
import bcrypt from 'bcrypt';
import { body, validationResult } from 'express-validator';
import db from '../database';
import { generateToken } from '../middleware/auth';

const router = Router();

/**
 * POST /api/auth/register
 * Register a new user with local authentication
 */
router.post(
  '/register',
  [
    body('username').isLength({ min: 3 }).trim(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { username, email, password, firstName, lastName } = req.body;

      // Check if user already exists
      const existingUser = await db('users')
        .where('username', username)
        .orWhere('email', email)
        .select('id')
        .first();

      if (existingUser) {
        return res.status(409).json({ error: 'Username or email already exists' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user
      const [inserted] = await db('users')
        .insert({
          username,
          email,
          password_hash: passwordHash,
          first_name: firstName,
          last_name: lastName,
          auth_provider: 'local',
        })
        .returning(['id', 'username', 'email', 'first_name', 'last_name', 'created_at']);

      // For MySQL/MSSQL that don't support RETURNING, fetch the inserted user
      let user = inserted;
      if (!user || typeof user === 'number') {
        const id = typeof user === 'number' ? user : (user as any);
        user = await db('users')
          .where('id', id)
          .select('id', 'username', 'email', 'first_name', 'last_name', 'created_at')
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
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

/**
 * POST /api/auth/login
 * Login with username and password
 */
router.post(
  '/login',
  [body('username').trim(), body('password').exists()],
  (req: Request, res: Response, next: Function) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    passport.authenticate('local', { session: false }, (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ error: 'Authentication error' });
      }

      if (!user) {
        return res.status(401).json({ error: info?.message || 'Invalid credentials' });
      }

      const token = generateToken(user);

      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
        },
        token,
      });
    })(req, res, next);
  }
);

/**
 * GET /api/auth/oauth2
 * Initiate OAuth2 SSO login
 */
router.get('/oauth2', passport.authenticate('oauth2'));

/**
 * GET /api/auth/oauth2/callback
 * OAuth2 callback
 */
router.get(
  '/oauth2/callback',
  passport.authenticate('oauth2', { session: false }),
  (req: Request, res: Response) => {
    const token = generateToken(req.user);
    // Redirect to frontend with token
    res.redirect(`/login/success?token=${token}`);
  }
);

/**
 * GET /api/auth/saml
 * Initiate SAML SSO login
 */
router.get('/saml', passport.authenticate('saml'));

/**
 * POST /api/auth/saml/callback
 * SAML callback
 */
router.post(
  '/saml/callback',
  passport.authenticate('saml', { session: false }),
  (req: Request, res: Response) => {
    const token = generateToken(req.user);
    res.json({ token, user: req.user });
  }
);

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', async (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    const user = await db('users')
      .where('id', decoded.id)
      .select('id', 'username', 'email', 'first_name', 'last_name')
      .first();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
