/**
 * Authentication helpers for integration tests.
 * Sets up an admin user and returns a bearer token for authenticated requests.
 */
import type { Express } from "express";
import request from "supertest";

export interface TestUser {
  id: string;
  email: string;
  role: "admin" | "analyst" | "viewer";
  token: string;
}

/**
 * Create the first admin via /api/auth/setup and return credentials.
 * Should only be called once per test DB state (setup returns 409 if users exist).
 */
export async function setupAdmin(
  app: Express,
  email = "admin@test.com",
  password = "Test1234!"
): Promise<TestUser> {
  const res = await request(app)
    .post("/api/auth/setup")
    .send({ email, password });

  if (res.status !== 201) {
    throw new Error(
      `setupAdmin failed (${res.status}): ${JSON.stringify(res.body)}`
    );
  }

  return {
    id: res.body.user.id,
    email: res.body.user.email,
    role: res.body.user.role,
    token: res.body.token,
  };
}

/**
 * Login and return credentials.
 */
export async function loginAs(
  app: Express,
  email: string,
  password: string
): Promise<TestUser> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password });

  if (res.status !== 200) {
    throw new Error(
      `loginAs failed (${res.status}): ${JSON.stringify(res.body)}`
    );
  }

  return {
    id: res.body.user.id,
    email: res.body.user.email,
    role: res.body.user.role,
    token: res.body.token,
  };
}

/** Return Authorization header value for a user token. */
export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
