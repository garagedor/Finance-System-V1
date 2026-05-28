// Users in this project have mixed _id types: some are stored as ObjectId
// (the original CRM rows), some are strings (rows created post-RBAC). Browser
// URLs and JSON bodies always carry the string form. This helper produces a
// Mongo filter that matches either representation.

import { ObjectId } from "mongodb";
import type { Filter } from "mongodb";

/** Build a Mongo filter that matches `_id` against either the raw string OR
 *  its ObjectId equivalent when the string is a valid 24-char hex id. */
export function userIdFilter<T extends { _id?: unknown }>(id: string): Filter<T> {
  const clauses: Filter<T>[] = [{ _id: id } as unknown as Filter<T>];
  if (ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)) {
    clauses.push({ _id: new ObjectId(id) } as unknown as Filter<T>);
  }
  return { $or: clauses } as Filter<T>;
}
