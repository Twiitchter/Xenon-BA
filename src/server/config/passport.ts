import { PassportStatic } from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as SamlStrategy } from '@node-saml/passport-saml';
import bcrypt from 'bcrypt';
import db from '../database';
import settingsService from '../services/settingsService';

// passport-oauth2 doesn't ship its own types; declare the module to avoid TS7016
let OAuth2Strategy: any;
try {
  OAuth2Strategy = require('passport-oauth2').Strategy;
} catch {
  // OAuth2 not available — SSO won't be enabled
}

export function initializePassport(passport: PassportStatic) {
  // Local Strategy - supports login by username or email
  passport.use(
    new LocalStrategy(
      {
        usernameField: 'username',
        passwordField: 'password',
      },
      async (username, password, done) => {
        try {
          const user = await db('users')
            .where(function() {
              this.where('username', username).orWhere('email', username);
            })
            .where('auth_provider', 'local')
            .where('is_active', true)
            .first();

          if (!user) {
            return done(null, false, { message: 'Invalid username or password' });
          }

          const isValidPassword = await bcrypt.compare(password, user.password_hash);

          if (!isValidPassword) {
            return done(null, false, { message: 'Invalid username or password' });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  // OAuth2 Strategy — configured from DB settings, auto-creates users
  if (OAuth2Strategy) {
    passport.use(
      'oauth2',
      new OAuth2Strategy(
        {
          authorizationURL: process.env.OAUTH2_AUTH_URL || 'https://placeholder',
          tokenURL: process.env.OAUTH2_TOKEN_URL || 'https://placeholder',
          clientID: process.env.OAUTH2_CLIENT_ID || 'placeholder',
          clientSecret: process.env.OAUTH2_CLIENT_SECRET || '',
          callbackURL: process.env.OAUTH2_CALLBACK_URL || '/api/auth/oauth2/callback',
        },
        async (accessToken: any, refreshToken: any, profile: any, done: any) => {
          try {
            const autoCreate = await settingsService.getBool('sso_auto_create_users', true);
            const defaultRole = await settingsService.get('sso_default_role', 'user');

            // Try to find user by external ID
            let user = await db('users')
              .where('external_id', profile.id)
              .where('auth_provider', 'oauth2')
              .first();

            if (!user) {
              // Also check by email
              const email = profile.emails?.[0]?.value || profile.email || `${profile.id}@external.com`;
              user = await db('users').where('email', email).first();

              if (user) {
                // Link existing account to SSO
                await db('users').where('id', user.id).update({
                  external_id: profile.id,
                  auth_provider: 'oauth2',
                  updated_at: db.fn.now(),
                });
                user = await db('users').where('id', user.id).first();
              } else if (autoCreate) {
                // Auto-create new user
                const [inserted] = await db('users')
                  .insert({
                    username: profile.username || profile.displayName || profile.id,
                    email,
                    external_id: profile.id,
                    auth_provider: 'oauth2',
                    first_name: profile.name?.givenName || profile.displayName?.split(' ')[0] || '',
                    last_name: profile.name?.familyName || '',
                    role: defaultRole,
                    is_active: true,
                  })
                  .returning('*');

                if (!inserted || typeof inserted === 'number') {
                  const id = typeof inserted === 'number' ? inserted : (inserted as any);
                  user = await db('users').where('id', id).first();
                } else {
                  user = inserted;
                }
                console.log(`SSO auto-created user: ${email} (role: ${defaultRole})`);
              } else {
                return done(null, false, { message: 'SSO auto-creation is disabled. Contact your administrator.' });
              }
            }

            return done(null, user);
          } catch (error) {
            return done(error);
          }
        }
      )
    );
  }

  // SAML Strategy — auto-creates users
  if (process.env.SAML_ENTRY_POINT || process.env.SAML_ENABLED === 'true') {
    try {
      passport.use(
        new SamlStrategy(
          {
            entryPoint: process.env.SAML_ENTRY_POINT || 'https://placeholder',
            issuer: process.env.SAML_ISSUER || 'xeonb-maintenance',
            callbackUrl: process.env.SAML_CALLBACK_URL || '/api/auth/saml/callback',
            idpCert: process.env.SAML_CERT || '',
            wantAssertionsSigned: false,
          },
          async (profile: any, done: any) => {
            try {
              const autoCreate = await settingsService.getBool('sso_auto_create_users', true);
              const defaultRole = await settingsService.get('sso_default_role', 'user');
              const samlId = profile.nameID || profile.id;

              let user = await db('users')
                .where('external_id', samlId)
                .where('auth_provider', 'saml')
                .first();

              if (!user) {
                const email = profile.email || `${samlId}@external.com`;
                user = await db('users').where('email', email).first();

                if (user) {
                  await db('users').where('id', user.id).update({
                    external_id: samlId,
                    auth_provider: 'saml',
                    updated_at: db.fn.now(),
                  });
                  user = await db('users').where('id', user.id).first();
                } else if (autoCreate) {
                  const [inserted] = await db('users')
                    .insert({
                      username: profile.email || samlId,
                      email,
                      external_id: samlId,
                      auth_provider: 'saml',
                      first_name: profile.firstName || '',
                      last_name: profile.lastName || '',
                      role: defaultRole,
                      is_active: true,
                    })
                    .returning('*');

                  if (!inserted || typeof inserted === 'number') {
                    const id = typeof inserted === 'number' ? inserted : (inserted as any);
                    user = await db('users').where('id', id).first();
                  } else {
                    user = inserted;
                  }
                  console.log(`SAML auto-created user: ${email} (role: ${defaultRole})`);
                } else {
                  return done(null, false, { message: 'SSO auto-creation is disabled.' });
                }
              }

              return done(null, user);
            } catch (error) {
              return done(error as Error);
            }
          },
          async (profile: any, done: any) => {
            return done(null);
          }
        )
      );
    } catch {
      console.log('SAML strategy not initialized (missing config)');
    }
  }
}
