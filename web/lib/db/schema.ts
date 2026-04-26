import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// =====================================================================
// Auth.js standard tables (Drizzle adapter conventions)
// =====================================================================

export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
});

export const accounts = sqliteTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
  }),
);

export const sessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.identifier, table.token] }),
  }),
);

// =====================================================================
// Social layer (Phase 4)
// =====================================================================
// target_id is the canonical "domain:<id>/<kind>:<id>" string from
// lib/target-id.ts. target_type is the same `kind` value, denormalized for
// indexing/filtering. Keep them in lockstep when inserting.

export type TargetType =
  | "table"
  | "relationship"
  | "gotcha"
  | "sql_example"
  | "annotation";

export const votes = sqliteTable(
  "votes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: text("target_type").$type<TargetType>().notNull(),
    targetId: text("target_id").notNull(),
    value: integer("value").notNull(), // -1 or 1
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userTargetIdx: uniqueIndex("votes_user_target_uidx").on(
      table.userId,
      table.targetId,
    ),
    targetIdx: uniqueIndex("votes_target_idx").on(
      table.targetId,
      table.userId,
    ),
  }),
);

export const comments = sqliteTable("comments", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  targetType: text("target_type").$type<TargetType>().notNull(),
  targetId: text("target_id").notNull(),
  bodyMd: text("body_md").notNull(),
  parentId: text("parent_id"), // nullable — one level of nesting
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type AnnotationKind =
  | "gotcha"
  | "sql_example"
  | "s4_change"
  | "note";

export type AnnotationStatus = "proposed" | "accepted" | "rejected";

export const annotations = sqliteTable("annotations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  targetType: text("target_type").$type<TargetType>().notNull(),
  targetId: text("target_id").notNull(),
  kind: text("kind").$type<AnnotationKind>().notNull(),
  bodyMd: text("body_md").notNull(),
  // Optional metadata. severity for gotchas/s4 (low|medium|high), title for
  // sql_example. Stored as TEXT so the schema is the same across kinds.
  severity: text("severity"),
  title: text("title"),
  status: text("status")
    .$type<AnnotationStatus>()
    .notNull()
    .$default(() => "proposed"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
