import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Browser identities and authorization states are hashed; OAuth tokens are
// encrypted by the API server before any database write.
export const yahooSessionsTable = pgTable("yahoo_sessions", {
  idHash: text("id_hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  pendingStateHash: text("pending_state_hash"),
  pendingStateExpiresAt: timestamp("pending_state_expires_at", { withTimezone: true }),
  pendingRedirectUri: text("pending_redirect_uri"),
  encryptedTokens: text("encrypted_tokens"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
});

export const insertYahooSessionSchema = createInsertSchema(yahooSessionsTable);
export type InsertYahooSession = z.infer<typeof insertYahooSessionSchema>;
export type YahooSession = typeof yahooSessionsTable.$inferSelect;