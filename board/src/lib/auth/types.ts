/** Safe browser-facing session data. Identity IDs and cookie hashes stay on the server. */
export type SessionDto = { displayName: string; isAdmin: boolean; expiresAt: string };
