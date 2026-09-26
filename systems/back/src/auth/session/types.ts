export type AuthPurpose = "login" | "signup";

export type AuthChallengeRow = {
  id: string;
  identifier_type: string;
  identifier_normalized: string;
  purpose: AuthPurpose;
  code_hash: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  last_sent_at: Date;
  expires_at: Date;
};

export type SessionSummaryRow = {
  session_id: string;
  user_id: string;
  created_at: Date;
  last_seen_at: Date | null;
  expires_at: Date;
  session_status: string;
  user_status: string;
  identifier_display: string | null;
};

export type UserIdentityRow = {
  identity_id: string;
  user_id: string;
  user_status: string;
};

export type UserIdentityType = "email" | "google";

export type RecentStartRow = {
  recent_count: string;
};

export type AccountRow = {
  id: string;
  status: string;
  balance_cached: string;
};

export type LedgerHeadRow = {
  sequence_number: string;
  transaction_hash: string;
};

export type AuthResult = {
  createdUser: boolean;
  starterGrantAmount: string | null;
};

export type AuthStartResponse = {
  challengeId: string;
  purpose: AuthPurpose;
  channel: "email";
  identifierHint: string;
  expiresAt: string;
  nextStep: "otp";
  devCode?: string;
};

export type SessionResponse = {
  actor: {
    userId: string;
    mode: "session";
  } | null;
  session: {
    authenticated: boolean;
    expiresAt: string | null;
  };
  identity: {
    channel: "email" | "google";
    identifierHint: string;
  } | null;
  authResult?: AuthResult;
};

export type SessionSummaryResult = {
  payload: SessionResponse;
  setCookie: string | null;
};
