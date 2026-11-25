import type { FastifyRequest } from "fastify";
import type { User } from "./domain.js";
import { unauthorized } from "./errors.js";
import type { Store } from "./store.js";

declare module "fastify" {
  interface FastifyRequest {
    user: User;
  }
}

// Fake login, as the assignment allows: "Authorization: Bearer <userId>".
// The id must be one of the seeded teachers or parents.
export function getUser(request: FastifyRequest, store: Store): User {
  const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? "");
  const id = match?.[1];
  const user = id ? (store.teachers.get(id) ?? store.parents.get(id)) : undefined;
  if (!user) throw unauthorized();
  return user;
}
