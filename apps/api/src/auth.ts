import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";

const ceremonyCookieName = "kp_auth_ceremony";
const sessionCookieName = "kp_session";
const ceremonyLifetimeSeconds = 5 * 60;
const sessionLifetimeSeconds = 8 * 60 * 60;

const registrationOptionsRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
});

const credentialResponseSchema = z.object({
  id: z.string().min(1),
}).passthrough();

type Ceremony = {
  kind: "registration" | "login";
  challenge: string;
  expiresAt: number;
  accountId?: string;
  displayName?: string;
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
};

export interface AuthConfig {
  rpID: string;
  rpName: string;
  webOrigin: string;
  sessionSecret: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

export function loadAuthConfig(environment: NodeJS.ProcessEnv = process.env): AuthConfig {
  const required = (name: string): string => {
    const value = environment[name]?.trim();
    if (!value) {
      throw new Error(`${name} is required`);
    }
    return value;
  };

  const config = {
    rpID: required("RP_ID"),
    rpName: required("RP_NAME"),
    webOrigin: required("WEB_ORIGIN"),
    sessionSecret: required("SESSION_SECRET"),
    supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  };

  z.string().url().parse(config.webOrigin);
  z.string().url().parse(config.supabaseUrl);
  if (config.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  return config;
}

class SupabaseAuthStore {
  constructor(private readonly config: AuthConfig) {}

  async createAccount(id: string, displayName: string): Promise<void> {
    await this.request("accounts", {
      method: "POST",
      body: JSON.stringify({ id, display_name: displayName }),
    });
  }

  async createCredential(accountId: string, credential: WebAuthnCredential, deviceType: string, backedUp: boolean): Promise<void> {
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
      `passkey_credentials?select=id,account_id,credential_id,public_key,counter,transports&credential_id=eq.${encodeURIComponent(credentialId)}`,
    );
    return rows[0];
  }

  async updateCredential(id: string, counter: number, deviceType: string, backedUp: boolean): Promise<void> {
    await this.request(`passkey_credentials?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        counter,
        device_type: deviceType,
        backed_up: backedUp,
      }),
    });
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
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

export function createAuthRouter(config: AuthConfig): Router {
  const router = Router();
  const store = new SupabaseAuthStore(config);

  router.post("/register/options", async (request, response) => {
    try {
      const { displayName } = registrationOptionsRequestSchema.parse(request.body);
      const accountId = randomUUID();
      const options = await generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpID,
        userID: new TextEncoder().encode(accountId),
        userName: accountId,
        userDisplayName: displayName,
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
      });
      setCeremony(response, config.sessionSecret, {
        kind: "registration",
        challenge: options.challenge,
        accountId,
        displayName,
        expiresAt: expiresAt(ceremonyLifetimeSeconds),
      });
      response.json(options);
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  router.post("/register/verify", async (request, response) => {
    try {
      const ceremony = getCeremony(request, config.sessionSecret, "registration");
      const credentialResponse = credentialResponseSchema.parse(request.body);
      const verification = await verifyRegistrationResponse({
        response: credentialResponse as unknown as RegistrationResponseJSON,
        expectedChallenge: ceremony.challenge,
        expectedOrigin: config.webOrigin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
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
      response.status(201).json({ verified: true, accountId: ceremony.accountId });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  router.post("/login/options", async (_request, response) => {
    try {
      const options = await generateAuthenticationOptions({
        rpID: config.rpID,
        userVerification: "required",
      });
      setCeremony(response, config.sessionSecret, {
        kind: "login",
        challenge: options.challenge,
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
        requireUserVerification: true,
        credential: {
          id: credential.credential_id,
          publicKey: decodeBytea(credential.public_key),
          counter: credential.counter,
          transports: credential.transports,
        },
      });
      if (!verification.verified || !verification.authenticationInfo.userVerified) {
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

  router.post("/logout", (request, response) => {
    const session = getSignedValue<Session>(request, config.sessionSecret, sessionCookieName);
    if (!session || session.expiresAt <= Date.now()) {
      clearCookie(response, sessionCookieName);
      return response.status(204).end();
    }
    clearCookie(response, sessionCookieName);
    return response.status(204).end();
  });

  return router;
}

function getCeremony(request: Request, secret: string, kind: Ceremony["kind"]): Ceremony {
  const ceremony = getSignedValue<Ceremony>(request, secret, ceremonyCookieName);
  if (!ceremony || ceremony.kind !== kind || ceremony.expiresAt <= Date.now()) {
    throw new Error("Passkey ceremony has expired or is invalid");
  }
  return ceremony;
}

function setCeremony(response: Response, secret: string, ceremony: Ceremony): void {
  setSignedCookie(response, ceremonyCookieName, ceremony, secret, ceremonyLifetimeSeconds);
}

function setSession(response: Response, secret: string, accountId: string): void {
  setSignedCookie(response, sessionCookieName, { accountId, expiresAt: expiresAt(sessionLifetimeSeconds) }, secret, sessionLifetimeSeconds);
}

function setSignedCookie(response: Response, name: string, value: object, secret: string, maxAge: number): void {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  response.cookie(name, `${encoded}.${signature}`, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/api/v1/auth",
    maxAge: maxAge * 1000,
  });
}

function getSignedValue<T>(request: Request, secret: string, name: string): T | undefined {
  const raw = parseCookies(request.headers.cookie)[name];
  if (!raw) {
    return undefined;
  }
  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) {
    return undefined;
  }
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
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
  return Object.fromEntries(header.split(";").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part.trim(), ""] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }));
}

function clearCookie(response: Response, name: string): void {
  response.clearCookie(name, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/api/v1/auth",
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
  return new Uint8Array(Buffer.from(value.slice(2), "hex")) as WebAuthnCredential["publicKey"];
}

function sendAuthError(response: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: "Invalid authentication request" });
    return;
  }
  response.status(400).json({ error: "Passkey authentication failed" });
}
