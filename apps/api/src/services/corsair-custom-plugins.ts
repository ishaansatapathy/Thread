/**
 * Thread-defined Corsair plugins for Google Forms, Slides and Classroom.
 *
 * Corsair ships no @corsair-dev package for these, so these are hand-built
 * plugin objects matching the same shape @corsair-dev/googledrive etc. use —
 * `id`, `oauthConfig` and `authConfig` are all Corsair needs to run the OAuth
 * connect/callback flow and store an encrypted refresh token per tenant.
 * Each plugin's `id` extends Corsair's open `AllProviders` type (it accepts
 * any string), so this is a supported extension point, not a hack.
 *
 * No `endpoints` are defined: every call goes through the direct-REST
 * googleFetch() path in workspace.ts (reading keys.get_access_token /
 * get_refresh_token / get_integration_credentials directly), the same way
 * Drive uploads and Sheets multi-row writes already bypass the pinned
 * plugin packages' broken endpoints. Without `endpoints`, `keyBuilder` is
 * never invoked, so it's safely omitted.
 */
export type CustomPluginOptions = { permissions?: { mode: "cautious" } };

function customGoogleOAuthPlugin(id: string, scopes: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site symmetry with the other Workspace plugin factories
  return (_options: CustomPluginOptions = {}) =>
    ({
      id,
      authConfig: { oauth_2: {} },
      oauthConfig: {
        providerName: "Google",
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scopes,
        authParams: { access_type: "offline", prompt: "consent" },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
}

export const googleforms = customGoogleOAuthPlugin("googleforms", [
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/forms.responses.readonly",
]);

export const googleslides = customGoogleOAuthPlugin("googleslides", [
  "https://www.googleapis.com/auth/presentations",
]);

export const googleclassroom = customGoogleOAuthPlugin("googleclassroom", [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me",
  "https://www.googleapis.com/auth/classroom.coursework.students",
  "https://www.googleapis.com/auth/classroom.announcements",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
]);
