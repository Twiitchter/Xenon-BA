import { PassportStatic } from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import { Strategy as SamlStrategy } from 'passport-saml';
import bcrypt from 'bcrypt';
import { query } from '../database';

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
          const result = await query(
            'SELECT * FROM users WHERE username = $1 AND auth_provider = $2 AND is_active = true',
            [username, 'local']
          );

          if (result.rows.length === 0) {
            return done(null, false, { message: 'Invalid username or password' });
          }

          const user = result.rows[0];
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
  if (process.env.SSO_ENABLED === 'true' && process.env.OAUTH2_CLIENT_ID) {
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
        async (accessToken, refreshToken, profile, done) => {
          try {
            // Try to find user by external ID
            let result = await query(
              'SELECT * FROM users WHERE external_id = $1 AND auth_provider = $2',
              [profile.id, 'oauth2']
            );

            let user;
            if (result.rows.length === 0) {
              // Create new user
              const insertResult = await query(
                `INSERT INTO users (username, email, external_id, auth_provider, first_name, last_name) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [
                  profile.username || profile.id,
                  profile.email || `${profile.id}@external.com`,
                  profile.id,
                  'oauth2',
                  profile.name?.givenName,
                  profile.name?.familyName,
                ]
              );
              user = insertResult.rows[0];
            } else {
              user = result.rows[0];
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
          cert: process.env.SAML_CERT || '',
        },
        async (profile, done) => {
          try {
            const samlId = profile.nameID || profile.id;
            
            let result = await query(
              'SELECT * FROM users WHERE external_id = $1 AND auth_provider = $2',
              [samlId, 'saml']
            );

            let user;
            if (result.rows.length === 0) {
              const insertResult = await query(
                `INSERT INTO users (username, email, external_id, auth_provider, first_name, last_name) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [
                  profile.email || samlId,
                  profile.email || `${samlId}@external.com`,
                  samlId,
                  'saml',
                  profile.firstName,
                  profile.lastName,
                ]
              );
              user = insertResult.rows[0];
            } else {
              user = result.rows[0];
            }

            return done(null, user);
          } catch (error) {
            return done(error as Error);
          }
        }
      )
    );
  }
}
