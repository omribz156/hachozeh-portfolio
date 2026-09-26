import type { AppEnv } from "../../config/env";
import { AuthSessionError } from "./errors";
import { isDevOtpExposed } from "./responses";

type SendAuthOtpEmailInput = {
  identifier: string;
  code: string;
  purpose: "login" | "signup";
  expiresAt: Date;
};

type ResendEmailResponse = {
  id?: string;
  message?: string;
  name?: string;
};

function isResendConfigured(env: AppEnv): boolean {
  return Boolean(env.mail.resendApiKey && env.mail.from);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function authPurposeLabel(purpose: SendAuthOtpEmailInput["purpose"]): string {
  return purpose === "signup" ? "להשלמת ההרשמה" : "לכניסה לחשבון";
}

function formatRequestedAt(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jerusalem"
  }).format(date);
}

function buildAuthOtpEmail(input: SendAuthOtpEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const expiresMinutes = Math.max(
    1,
    Math.round((input.expiresAt.getTime() - Date.now()) / 60_000)
  );
  const escapedCode = escapeHtml(input.code);
  const purpose = authPurposeLabel(input.purpose);
  const requestedAt = formatRequestedAt(new Date());

  return {
    subject: "קוד הכניסה שלך להחוזה",
    text: [
      "החוזה",
      "",
      "קוד כניסה",
      input.code,
      "",
      `הקוד תקף ל-${expiresMinutes} דקות.`,
      "",
      "אין לשתף את הקוד הזה עם אף אחד. יש להזין אותו רק באתר הרשמי של החוזה. אם מישהו מבקש ממך את הקוד, זו עלולה להיות הונאה.",
      "",
      `הבקשה נשלחה ${purpose} ב-${requestedAt}.`,
      "",
      "- צוות החוזה"
    ].join("\n"),
    html: [
      '<div dir="rtl" style="background:#ffffff;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;margin:0;padding:0">',
      '<div style="max-width:440px;margin:0 auto;padding:28px 32px 36px;line-height:1.65">',
      '<h1 style="font-size:34px;line-height:1.1;margin:0 0 44px;font-weight:800">החוזה</h1>',
      '<p style="font-size:14px;margin:0 0 8px;color:#111">קוד כניסה</p>',
      `<p style="font-size:48px;line-height:1;margin:0 0 34px;font-weight:800;letter-spacing:6px;text-align:left" dir="ltr">${escapedCode}</p>`,
      `<p style="font-size:16px;margin:0 0 26px">הקוד תקף ל-${expiresMinutes} דקות.</p>`,
      '<p style="font-size:16px;margin:0 0 26px"><strong>אין לשתף את הקוד הזה עם אף אחד.</strong> יש להזין אותו רק באתר הרשמי של החוזה. אם מישהו מבקש ממך את הקוד, זו עלולה להיות הונאה.</p>',
      `<p style="font-size:16px;margin:0 0 30px">הבקשה נשלחה ${escapeHtml(purpose)} ב-<strong>${escapeHtml(requestedAt)}</strong>.</p>`,
      '<p style="font-size:16px;margin:0;font-weight:700">- צוות החוזה</p>',
      "</div>",
      "</div>"
    ].join("")
  };
}

export function assertAuthMailCanSend(env: AppEnv): void {
  if (isResendConfigured(env)) {
    return;
  }

  // With the dev OTP exposed, the code rides the auth response — no email
  // delivery is needed for the flow to complete.
  if (isDevOtpExposed(env)) {
    return;
  }

  throw new AuthSessionError(
    503,
    "mail_unavailable",
    "Email verification is not configured."
  );
}

export async function sendAuthOtpEmail(
  env: AppEnv,
  input: SendAuthOtpEmailInput
): Promise<{ provider: "dev" | "resend"; messageId: string | null }> {
  // Dev posture: the code rides the auth response, so a provider call is
  // pure quota burn — every spec/smoke auth was spending a real Resend
  // send on a throwaway @navi.local address (hit 80% of the daily cap on
  // 2026-06-11). Skip the provider whenever the dev code is exposed; flip
  // AUTH_DEV_OTP_EXPOSED off to test real delivery on dev.
  if (isDevOtpExposed(env)) {
    return {
      provider: "dev",
      messageId: null
    };
  }

  if (!isResendConfigured(env)) {
    return {
      provider: "dev",
      messageId: null
    };
  }

  const email = buildAuthOtpEmail(input);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.mail.resendApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: env.mail.from,
      to: [input.identifier],
      subject: email.subject,
      text: email.text,
      html: email.html
    })
  });
  const payload = (await response.json().catch(() => ({}))) as ResendEmailResponse;

  if (!response.ok || !payload.id) {
    throw new AuthSessionError(
      502,
      "mail_delivery_failed",
      payload.message || payload.name || "Could not send verification email."
    );
  }

  return {
    provider: "resend",
    messageId: payload.id
  };
}
