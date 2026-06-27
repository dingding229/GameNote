import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ledgerDocuments = sqliteTable("ledger_documents", {
  id: text("id").primaryKey().notNull(),
  account: text("account"),
  records: text("records").notNull().default("[]"),
  updatedAt: text("updated_at").notNull(),
});
