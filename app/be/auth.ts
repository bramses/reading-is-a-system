import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

export const ADMIN_PASSWORD_ENV = "CONTENT_ADMIN_PASSWORD";

const ADMIN_SESSION_COOKIE = "reading-is-a-system-admin";
const SESSION_LABEL = "reading-is-a-system-content-editor";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function getAdminPassword() {
  return process.env[ADMIN_PASSWORD_ENV] ?? "";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionValue(password: string) {
  return createHmac("sha256", password).update(SESSION_LABEL).digest("hex");
}

export function hasAdminPassword() {
  return getAdminPassword().length > 0;
}

export function verifyPassword(password: string) {
  const configuredPassword = getAdminPassword();

  return (
    configuredPassword.length > 0 && safeEqual(password, configuredPassword)
  );
}

export async function isAdminAuthenticated() {
  const configuredPassword = getAdminPassword();

  if (!configuredPassword) {
    return false;
  }

  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? "";

  return safeEqual(session, sessionValue(configuredPassword));
}

export async function setAdminSession() {
  const configuredPassword = getAdminPassword();

  if (!configuredPassword) {
    throw new Error(`${ADMIN_PASSWORD_ENV} is not set.`);
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, sessionValue(configuredPassword), {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/be",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

export async function requireAdmin() {
  if (!(await isAdminAuthenticated())) {
    throw new Error("Unauthorized.");
  }
}
