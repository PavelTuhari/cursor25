/** Session and wire types for the account area. */

export interface Session {
  userId: string;
  token: string;
  refreshToken: string | null;
  /** ISO timestamp; null when the server does not send an expiry. */
  expiresAt: string | null;
  phone: string | null;
  email: string | null;
  displayName: string | null;
}

export interface CodeRequest {
  requestId: string | null;
  resendAfterSeconds: number;
  expiresInSeconds: number;
  /** Only sent by dev/staging backends so QA can sign in without a real SMS. */
  devCode?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number;
  user?: {
    id: string;
    phone?: string | null;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
}

export interface CodeResponse {
  request_id?: string | null;
  resend_after_seconds?: number;
  expires_in_seconds?: number;
  dev_code?: string;
}

export type AuthErrorCode =
  | 'invalid_phone'
  | 'invalid_code'
  | 'invalid_credentials'
  | 'too_many_requests'
  | 'network'
  | 'not_configured'
  | 'unknown';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
