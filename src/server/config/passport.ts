import { PassportStatic } from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as SamlStrategy } from '@node-saml/passport-saml';
import bcrypt from 'bcrypt';
import db from '../database';

// passport-oauth2 doesn't ship its own types; declare the module to avoid TS7016
let OAuth2Strategy: any;
try {
  OAuth2Strategy = require('passport-oauth2').Strategy;
} catch {
  // OAuth2 not available — SSO won't be enabled
}

export function initializePassport(passport: PassportStatic) {
  // Local Strategy
  passport.use(
    new LocalStrategy(
      {
        usernameField: 'username',
        passwordField: 'password',
      },
      async (username, password, done) => {
        try {
          const user = await db('users')
            .where('username', username)
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

  // OAuth2 Strategy (for SSO)
  if (process.env.SSO_ENABLED === 'true' && process.env.OAUTH2_CLIENT_ID && OAuth2Strategy) {
    passport.use(
      'oauth2',
      new OAuth2Strategy(
        {
          authorizationURL: process.env.OAUTH2_AUTH_URL || '',
          tokenURL: process.env.OAUTH2_TOKEN_URL || '',
          clientID: process.env.OAUTH2_CLIENT_ID,
          clientSecret: process.env.OAUTH2_CLIENT_SECRET || '',
          callbackURL: process.env.OAUTH2_CALLBACK_URL || '',
        },
        async (accessToken: any, refreshToken: any, profile: any, done: any) => {
          try {
            // Try to find user by external ID
            let user = await db('users')
              .where('external_id', profile.id)
              .where('auth_provider', 'oauth2')
              .first();

            if (!user) {
              // Create new user
              const [inserted] = await db('users')
                .insert({
                  username: profile.username || profile.id,
                  email: profile.email || `${profile.id}@external.com`,
                  external_id: profile.id,
                  auth_provider: 'oauth2',
                  first_name: profile.name?.givenName,
                  last_name: profile.name?.familyName,
                })
                .returning('*');

              if (!inserted || typeof inserted === 'number') {
                const id = typeof inserted === 'number' ? inserted : (inserted as any);
                user = await db('users').where('id', id).first();
              } else {
                user = inserted;
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

  // SAML Strategy (for SSO)
  if (process.env.SAML_ENABLED === 'true' && process.env.SAML_ENTRY_POINT) {
    passport.use(
      new SamlStrategy(
        {
          entryPoint: process.env.SAML_ENTRY_POINT,
          issuer: process.env.SAML_ISSUER || 'xeonb-crm',
          callbackUrl: process.env.SAML_CALLBACK_URL || '',
          idpCert: process.env.SAML_CERT || '',
          wantAssertionsSigned: false,
        },
        // Verify callback (login)
        async (profile: any, done: any) => {
          try {
            const samlId = profile.nameID || profile.id;
            
            let user = await db('users')
              .where('external_id', samlId)
              .where('auth_provider', 'saml')
              .first();

            if (!user) {
              const [inserted] = await db('users')
                .insert({
                  username: profile.email || samlId,
                  email: profile.email || `${samlId}@external.com`,
                  external_id: samlId,
                  auth_provider: 'saml',
                  first_name: profile.firstName,
                  last_name: profile.lastName,
                })
                .returning('*');

              if (!inserted || typeof inserted === 'number') {
                const id = typeof inserted === 'number' ? inserted : (inserted as any);
                user = await db('users').where('id', id).first();
              } else {
                user = inserted;
              }
            }

            return done(null, user);
          } catch (error) {
            return done(error as Error);
          }
        },
        // Logout callback (required by @node-saml/passport-saml v5)
        async (profile: any, done: any) => {
          return done(null);
        }
      )
    );
  }
}
