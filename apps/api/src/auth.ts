import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";

const ceremonyCookieName = "kp_auth_ceremony";
const sessionCookieName = "kp_session";
const ceremonyLifetimeSeconds = 5 * 60;
const sessionLifetimeSeconds = 8 * 60 * 60;

const registrationOptionsRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  crossDevice: z.boolean().optional(),
});

const loginOptionsRequestSchema = z
  .object({
    crossDevice: z.boolean().optional(),
  })
  .optional();

const credentialResponseSchema = z
  .object({
    id: z.string().min(1),
  })
  .passthrough();

const pinRegisterRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  pin: z.string().regex(/^[0-9]{6}$/, "PIN must be 6 digits"),
});

const pinLoginRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  pin: z.string().regex(/^[0-9]{6}$/, "PIN must be 6 digits"),
});

const emailSendOtpRequestSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(100).optional(),
});

const emailVerifyOtpRequestSchema = z.object({
  code: z.string().regex(/^[0-9]{6}$/, "Code must be 6 digits"),
  pin: z
    .string()
    .regex(/^[0-9]{6}$/)
    .optional(),
});

type Ceremony = {
  kind: "registration" | "login" | "email_otp";
  challenge: string;
  expiresAt: number;
  accountId?: string;
  displayName?: string;
  email?: string;
  crossDevice?: boolean;
};

type Session = {
  accountId: string;
  expiresAt: number;
};

type CredentialRow = {
  id: string;
  account_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string[];
  device_type?: string | null;
  backed_up?: boolean;
  created_at?: string;
};

type AccountRow = {
  id: string;
  display_name: string;
  created_at: string;
};

export interface AuthConfig {
  rpID: string;
  rpName: string;
  webOrigin: string;
  sessionSecret: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  resendApiKey?: string;
  resendFromEmail?: string;
}

export function loadAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const required = (name: string): string => {
    const value = environment[name]?.trim();
    if (!value) {
      throw new Error(`${name} is required`);
    }
    return value;
  };

  const config: AuthConfig = {
    rpID: required("RP_ID"),
    rpName: required("RP_NAME"),
    webOrigin: required("WEB_ORIGIN"),
    sessionSecret: required("SESSION_SECRET"),
    supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    resendApiKey: environment.RESEND_API_KEY?.trim() || undefined,
    resendFromEmail:
      environment.RESEND_FROM_EMAIL?.trim() ||
      "KarenPay <onboarding@resend.dev>",
  };

  z.string().url().parse(config.webOrigin);
  z.string().url().parse(config.supabaseUrl);
  if (config.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  return config;
}

export function hashPinSecret(pin: string, salt: Uint8Array = randomBytes(16)): Uint8Array {
  const derived = scryptSync(pin, salt, 32);
  return Buffer.concat([Buffer.from(salt), derived]);
}

export function verifyPinSecret(pin: string, storedBytes: Uint8Array): boolean {
  if (storedBytes.length !== 48) {
    return false;
  }
  const salt = storedBytes.subarray(0, 16);
  const expected = storedBytes.subarray(16, 48);
  const actual = scryptSync(pin, salt, 32);
  return timingSafeEqual(expected, actual);
}

function buildPinCredentialId(displayName: string): string {
  const normalized = displayName.trim().toLowerCase().replace(/\s+/g, " ");
  const digest = createHash("sha256")
    .update(normalized, "utf8")
    .digest("base64url");
  return `pin:${digest}`;
}

function buildEmailCredentialId(email: string): string {
  const normalized = email.trim().toLowerCase();
  const digest = createHash("sha256")
    .update(normalized, "utf8")
    .digest("base64url");
  return `email:${digest}`;
}

class SupabaseAuthStore {
  constructor(private readonly config: AuthConfig) {}

  async createAccount(id: string, displayName: string): Promise<void> {
    await this.request("accounts", {
      method: "POST",
      body: JSON.stringify({ id, display_name: displayName }),
    });
  }

  async createCredential(
    accountId: string,
    credential: WebAuthnCredential,
    deviceType: string,
    backedUp: boolean,
  ): Promise<void> {
    await this.request("passkey_credentials", {
      method: "POST",
      body: JSON.stringify({
        account_id: accountId,
        credential_id: credential.id,
        public_key: encodeBytea(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        device_type: deviceType,
        backed_up: backedUp,
      }),
    });
  }

  async getCredential(credentialId: string): Promise<CredentialRow | undefined> {
    const rows = await this.request<CredentialRow[]>(
      `passkey_credentials?select=id,account_id,credential_id,public_key,counter,transports,device_type&credential_id=eq.${encodeURIComponent(credentialId)}`,
    );
    return rows[0];
  }

  async getAccount(accountId: string): Promise<AccountRow | undefined> {
    const rows = await this.request<AccountRow[]>(
      `accounts?select=id,display_name,created_at&id=eq.${encodeURIComponent(accountId)}`,
    );
    return rows[0];
  }

  async getAccountCredentials(accountId: string): Promise<CredentialRow[]> {
    return this.request<CredentialRow[]>(
      `passkey_credentials?select=id,account_id,credential_id,device_type,backed_up,created_at&account_id=eq.${encodeURIComponent(accountId)}&order=created_at.desc`,
    );
  }

  async updateCredential(
    id: string,
    counter: number,
    deviceType: string,
    backedUp: boolean,
  ): Promise<void> {
    await this.request(`passkey_credentials?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        counter,
        device_type: deviceType,
        backed_up: backedUp,
      }),
    });
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${this.config.supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.config.supabaseServiceRoleKey,
        Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`Supabase request failed with status ${response.status}`);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

async function sendResendOtpEmail(
  config: AuthConfig,
  toEmail: string,
  code: string,
): Promise<{ sentViaResend: boolean }> {
  const apiKey = config.resendApiKey ?? process.env.RESEND_API_KEY?.trim();
  const fromEmail =
    config.resendFromEmail ??
    process.env.RESEND_FROM_EMAIL?.trim() ??
    "KarenPay <onboarding@resend.dev>";

  if (!apiKey) {
    console.log(
      `[KarenPay Dev Email OTP] To: ${toEmail} | 6-Digit Code: ${code} (Set RESEND_API_KEY in .env to send live emails)`,
    );
    return { sentViaResend: false };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject: `Your KarenPay verification code: ${code}`,
      html: `<div style="font-family: sans-serif; color: #1F0D09; background: #FFF2E7; padding: 24px; border-radius: 16px;">
        <h2 style="margin-top: 0;">KarenPay Verification Code</h2>
        <p style="font-size: 16px;">Use the 6-digit code below to sign in or complete your KarenPay account setup:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #B82D14; margin: 16px 0;">${code}</p>
        <p style="font-size: 14px; color: #5C2418;">This code expires in 5 minutes.</p>
      </div>`,
      text: `Your KarenPay 6-digit verification code is: ${code}. It expires in 5 minutes.`,
    }),
  });

  if (!res.ok) {
    console.log(
      `[KarenPay Fallback Email OTP] Resend status ${res.status} for ${toEmail} | 6-Digit Code: ${code}`,
    );
    return { sentViaResend: false };
  }

  return { sentViaResend: true };
}

export function createAuthRouter(config: AuthConfig): Router {
  const router = Router();
  const store = new SupabaseAuthStore(config);

  // 1. WebAuthn Passkey & Cross-Device QR Registration
  router.post("/register/options", async (request, response) => {
    try {
      const { displayName, crossDevice } =
        registrationOptionsRequestSchema.parse(request.body);
      const accountId = randomUUID();
      const options = await generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpID,
        userID: new TextEncoder().encode(accountId),
        userName: accountId,
        userDisplayName: displayName,
        attestationType: "none",
        authenticatorSelection: crossDevice
          ? {
              authenticatorAttachment: "cross-platform",
              residentKey: "preferred",
              userVerification: "preferred",
            }
          : {
              residentKey: "preferred",
              userVerification: "required",
            },
      });
      setCeremony(response, config.sessionSecret, {
        kind: "registration",
        challenge: options.challenge,
        accountId,
        displayName,
        crossDevice: Boolean(crossDevice),
        expiresAt: expiresAt(ceremonyLifetimeSeconds),
      });
      response.json(options);
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  router.post("/register/verify", async (request, response) => {
    try {
      const ceremony = getCeremony(
        request,
        config.sessionSecret,
        "registration",
      );
      const credentialResponse = credentialResponseSchema.parse(request.body);
      const verification = await verifyRegistrationResponse({
        response: credentialResponse as unknown as RegistrationResponseJSON,
        expectedChallenge: ceremony.challenge,
        expectedOrigin: config.webOrigin,
        expectedRPID: config.rpID,
        requireUserVerification: !ceremony.crossDevice,
      });
      if (!verification.verified || !verification.registrationInfo) {
        throw new Error("Passkey registration verification failed");
      }

      const info = verification.registrationInfo;
      await store.createAccount(ceremony.accountId!, ceremony.displayName!);
      await store.createCredential(
        ceremony.accountId!,
        info.credential,
        info.credentialDeviceType,
        info.credentialBackedUp,
      );
      clearCookie(response, ceremonyCookieName);
      setSession(response, config.sessionSecret, ceremony.accountId!);
      response.status(201).json({
        verified: true,
        accountId: ceremony.accountId,
        displayName: ceremony.displayName,
      });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  // 2. WebAuthn Passkey & Cross-Device QR Login
  router.post("/login/options", async (request, response) => {
    try {
      const parsed = loginOptionsRequestSchema.parse(request.body ?? {});
      const crossDevice = Boolean(parsed?.crossDevice);
      const options = await generateAuthenticationOptions({
        rpID: config.rpID,
        userVerification: crossDevice ? "preferred" : "required",
      });
      setCeremony(response, config.sessionSecret, {
        kind: "login",
        challenge: options.challenge,
        crossDevice,
        expiresAt: expiresAt(ceremonyLifetimeSeconds),
      });
      response.json(options);
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  router.post("/login/verify", async (request, response) => {
    try {
      const ceremony = getCeremony(request, config.sessionSecret, "login");
      const credentialResponse = credentialResponseSchema.parse(request.body);
      const credential = await store.getCredential(credentialResponse.id);
      if (!credential) {
        throw new Error("Unknown passkey credential");
      }
      const verification = await verifyAuthenticationResponse({
        response: credentialResponse as unknown as AuthenticationResponseJSON,
        expectedChallenge: ceremony.challenge,
        expectedOrigin: config.webOrigin,
        expectedRPID: config.rpID,
        requireUserVerification: !ceremony.crossDevice,
        credential: {
          id: credential.credential_id,
          publicKey: decodeBytea(credential.public_key),
          counter: credential.counter,
          transports: credential.transports,
        },
      });
      if (
        !verification.verified ||
        (!ceremony.crossDevice && !verification.authenticationInfo.userVerified)
      ) {
        throw new Error("Passkey login verification failed");
      }

      const info = verification.authenticationInfo;
      await store.updateCredential(
        credential.id,
        info.newCounter,
        info.credentialDeviceType,
        info.credentialBackedUp,
      );
      clearCookie(response, ceremonyCookieName);
      setSession(response, config.sessionSecret, credential.account_id);
      response.json({ verified: true, accountId: credential.account_id });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  // 3. 6-Digit PIN Fallback Registration & Login (for devices without biometrics)
  router.post("/pin/register", async (request, response) => {
    try {
      const { displayName, pin } = pinRegisterRequestSchema.parse(request.body);
      const credentialId = buildPinCredentialId(displayName);
      const existing = await store.getCredential(credentialId);
      if (existing) {
        return response.status(409).json({
          code: "ACCOUNT_EXISTS",
          message:
            "An account with that name already has a PIN. Please sign in instead.",
          spoken:
            "An account with that name already has a PIN. Please sign in instead.",
        });
      }

      const accountId = randomUUID();
      const pinBytes = hashPinSecret(pin);
      await store.createAccount(accountId, displayName);
      await store.createCredential(
        accountId,
        {
          id: credentialId,
          publicKey: pinBytes as WebAuthnCredential["publicKey"],
          counter: 0,
          transports: ["internal"],
        },
        "pin",
        false,
      );

      setSession(response, config.sessionSecret, accountId);
      return response.status(201).json({
        verified: true,
        accountId,
        displayName,
        spoken: "Your 6-digit PIN is ready.",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return response.status(400).json({
          code: "INVALID_PIN_REQUEST",
          message: "Please enter your name and a 6-digit PIN.",
          spoken: "Please enter your name and a 6-digit PIN.",
        });
      }
      return response.status(500).json({
        code: "PIN_REGISTER_FAILED",
        message: "Could not create your PIN account. Please try again.",
        spoken: "Could not create your PIN account. Please try again.",
      });
    }
  });

  router.post("/pin/login", async (request, response) => {
    try {
      const { displayName, pin } = pinLoginRequestSchema.parse(request.body);
      const credentialId = buildPinCredentialId(displayName);
      const credential = await store.getCredential(credentialId);
      if (!credential) {
        return response.status(401).json({
          code: "AUTH_FAILED",
          message: "No account found with that name and PIN.",
          spoken: "No account found with that name and PIN.",
        });
      }

      const storedBytes = decodeBytea(credential.public_key);
      if (!verifyPinSecret(pin, storedBytes)) {
        return response.status(401).json({
          code: "AUTH_FAILED",
          message: "Incorrect 6-digit PIN. Please try again.",
          spoken: "Incorrect 6-digit PIN. Please try again.",
        });
      }

      await store.updateCredential(
        credential.id,
        credential.counter + 1,
        "pin",
        false,
      );
      setSession(response, config.sessionSecret, credential.account_id);
      return response.json({
        verified: true,
        accountId: credential.account_id,
        displayName,
        spoken: "Signed in with your 6-digit PIN.",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return response.status(400).json({
          code: "INVALID_PIN_REQUEST",
          message: "Please enter your name and 6-digit PIN.",
          spoken: "Please enter your name and 6-digit PIN.",
        });
      }
      return response.status(500).json({
        code: "PIN_LOGIN_FAILED",
        message: "Could not sign in with your PIN. Please try again.",
        spoken: "Could not sign in with your PIN. Please try again.",
      });
    }
  });

  // 4. Resend Email 6-Digit One-Time Code (OTP) Fallback
  router.post("/email/send-otp", async (request, response) => {
    try {
      const { email, displayName } = emailSendOtpRequestSchema.parse(
        request.body,
      );
      const code = String(randomInt(100000, 1000000));
      const codeDigest = createHash("sha256")
        .update(code, "utf8")
        .digest("base64url");

      const { sentViaResend } = await sendResendOtpEmail(config, email, code);

      setCeremony(response, config.sessionSecret, {
        kind: "email_otp",
        challenge: codeDigest,
        email: email.toLowerCase(),
        displayName: displayName?.trim() || email.split("@")[0] || "Account",
        expiresAt: expiresAt(ceremonyLifetimeSeconds),
      });

      const isLocalDev =
        config.rpID === "localhost" || config.webOrigin.includes("localhost");

      return response.json({
        sent: true,
        sentViaResend,
        ...(isLocalDev && !sentViaResend ? { devOtpCode: code } : {}),
        spoken: sentViaResend
          ? `We sent a 6-digit verification code to ${email}.`
          : `Verification code generated for ${email}.`,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return response.status(400).json({
          code: "INVALID_EMAIL",
          message: "Please enter a valid email address.",
          spoken: "Please enter a valid email address.",
        });
      }
      return response.status(500).json({
        code: "OTP_SEND_FAILED",
        message: "Could not send verification email. Please try again.",
        spoken: "Could not send verification email. Please try again.",
      });
    }
  });

  router.post("/email/verify-otp", async (request, response) => {
    try {
      const ceremony = getCeremony(request, config.sessionSecret, "email_otp");
      const { code, pin } = emailVerifyOtpRequestSchema.parse(request.body);
      const actualDigest = createHash("sha256")
        .update(code, "utf8")
        .digest("base64url");

      const expectedBuf = Buffer.from(ceremony.challenge);
      const actualBuf = Buffer.from(actualDigest);
      if (
        expectedBuf.length !== actualBuf.length ||
        !timingSafeEqual(expectedBuf, actualBuf)
      ) {
        return response.status(401).json({
          code: "INVALID_OTP",
          message: "The 6-digit verification code is incorrect.",
          spoken: "The 6-digit verification code is incorrect.",
        });
      }

      const emailCredId = buildEmailCredentialId(ceremony.email!);
      const existingCred = await store.getCredential(emailCredId);

      let accountId: string;
      const resolvedName = ceremony.displayName ?? "Account";

      if (existingCred) {
        accountId = existingCred.account_id;
        await store.updateCredential(
          existingCred.id,
          existingCred.counter + 1,
          "email_otp",
          false,
        );
      } else {
        accountId = randomUUID();
        const secretBytes = pin ? hashPinSecret(pin) : randomBytes(48);
        await store.createAccount(accountId, resolvedName);
        await store.createCredential(
          accountId,
          {
            id: emailCredId,
            publicKey: secretBytes as WebAuthnCredential["publicKey"],
            counter: 1,
            transports: ["internal"],
          },
          "email_otp",
          false,
        );
        if (pin) {
          const pinCredId = buildPinCredentialId(resolvedName);
          const existingPin = await store.getCredential(pinCredId);
          if (!existingPin) {
            await store.createCredential(
              accountId,
              {
                id: pinCredId,
                publicKey: secretBytes as WebAuthnCredential["publicKey"],
                counter: 0,
                transports: ["internal"],
              },
              "pin",
              false,
            );
          }
        }
      }

      clearCookie(response, ceremonyCookieName);
      setSession(response, config.sessionSecret, accountId);
      return response.status(existingCred ? 200 : 201).json({
        verified: true,
        accountId,
        displayName: resolvedName,
        spoken: "Email verified. You are now signed in.",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return response.status(400).json({
          code: "INVALID_OTP",
          message: "Please enter the 6-digit verification code.",
          spoken: "Please enter the 6-digit verification code.",
        });
      }
      return response.status(400).json({
        code: "OTP_VERIFY_FAILED",
        message:
          "Verification code expired or could not be verified. Please request a new code.",
        spoken:
          "Verification code expired or could not be verified. Please request a new code.",
      });
    }
  });

  router.post("/logout", (request, response) => {
    const session = getSignedValue<Session>(
      request,
      config.sessionSecret,
      sessionCookieName,
    );
    if (!session || session.expiresAt <= Date.now()) {
      clearCookie(response, sessionCookieName);
      return response.status(204).end();
    }
    clearCookie(response, sessionCookieName);
    return response.status(204).end();
  });

  router.get("/me", async (request, response) => {
    const accountId = getAuthenticatedAccountId(request, config.sessionSecret);
    if (!accountId) {
      return response.status(401).json({
        code: "AUTH_REQUIRED",
        message: "Please sign in to view your account.",
        spoken: "Please sign in to view your account.",
      });
    }
    try {
      const [account, credentials] = await Promise.all([
        store.getAccount(accountId),
        store.getAccountCredentials(accountId),
      ]);
      if (!account) {
        return response.status(404).json({
          code: "ACCOUNT_NOT_FOUND",
          message: "Account not found.",
          spoken: "Account not found.",
        });
      }
      return response.json({
        accountId: account.id,
        displayName: account.display_name,
        createdAt: account.created_at,
        rpID: config.rpID,
        credentials: credentials.map((c) => ({
          id: c.id,
          credentialId: c.credential_id,
          deviceType: c.device_type ?? "singleDevice",
          backedUp: Boolean(c.backed_up),
          createdAt: c.created_at ?? account.created_at,
        })),
      });
    } catch {
      return response.status(500).json({
        code: "PROFILE_FETCH_FAILED",
        message: "Your account profile could not be loaded.",
        spoken: "Your account profile could not be loaded.",
      });
    }
  });

  return router;
}

/** Returns the authenticated account ID from the signed session cookie. */
export function getAuthenticatedAccountId(
  request: Request,
  secret: string,
): string | undefined {
  const session = getSignedValue<Session>(request, secret, sessionCookieName);
  return session && session.expiresAt > Date.now()
    ? session.accountId
    : undefined;
}

function getCeremony(
  request: Request,
  secret: string,
  kind: Ceremony["kind"],
): Ceremony {
  const ceremony = getSignedValue<Ceremony>(
    request,
    secret,
    ceremonyCookieName,
  );
  if (!ceremony || ceremony.kind !== kind || ceremony.expiresAt <= Date.now()) {
    throw new Error("Passkey ceremony has expired or is invalid");
  }
  return ceremony;
}

function setCeremony(
  response: Response,
  secret: string,
  ceremony: Ceremony,
): void {
  setSignedCookie(
    response,
    ceremonyCookieName,
    ceremony,
    secret,
    ceremonyLifetimeSeconds,
  );
}

function setSession(
  response: Response,
  secret: string,
  accountId: string,
): void {
  setSignedCookie(
    response,
    sessionCookieName,
    { accountId, expiresAt: expiresAt(sessionLifetimeSeconds) },
    secret,
    sessionLifetimeSeconds,
  );
}

function setSignedCookie(
  response: Response,
  name: string,
  value: object,
  secret: string,
  maxAge: number,
): void {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  response.cookie(name, `${encoded}.${signature}`, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/api/v1",
    maxAge: maxAge * 1000,
  });
}

function getSignedValue<T>(
  request: Request,
  secret: string,
  name: string,
): T | undefined {
  const raw = parseCookies(request.headers.cookie)[name];
  if (!raw) {
    return undefined;
  }
  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) {
    return undefined;
  }
  const expected = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }
  return Object.fromEntries(
    header.split(";").map((part) => {
      const index = part.indexOf("=");
      return index < 0
        ? [part.trim(), ""]
        : [
            part.slice(0, index).trim(),
            decodeURIComponent(part.slice(index + 1)),
          ];
    }),
  );
}

function clearCookie(response: Response, name: string): void {
  response.clearCookie(name, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/api/v1",
  });
}

function expiresAt(seconds: number): number {
  return Date.now() + seconds * 1000;
}

function encodeBytea(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

function decodeBytea(value: string): WebAuthnCredential["publicKey"] {
  if (!value.startsWith("\\x")) {
    throw new Error("Stored passkey public key is not PostgreSQL bytea hex");
  }
  return new Uint8Array(
    Buffer.from(value.slice(2), "hex"),
  ) as WebAuthnCredential["publicKey"];
}

function sendAuthError(response: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    response.status(400).json({
      code: "INVALID_AUTH_REQUEST",
      message: "Please provide a valid display name.",
      spoken: "Please provide a valid display name.",
    });
    return;
  }
  response.status(400).json({
    code: "AUTH_FAILED",
    message: "Passkey authentication failed. Please try again.",
    spoken: "Passkey authentication failed. Please try again.",
  });
}
