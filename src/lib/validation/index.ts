/**
 * Validation schemas for every core entity.
 *
 * Each schema mirrors the constraints declared in supabase/migrations. When a
 * constraint changes, change the schema in the same commit - the database is
 * the enforcement point, and these exist to explain a rejection in a sentence
 * the PA can act on.
 */

export * from "@/lib/validation/utils";
export * from "@/lib/validation/auth";
export * from "@/lib/validation/hm";
export * from "@/lib/validation/month";
export * from "@/lib/validation/sales-week";
export * from "@/lib/validation/performance";
export * from "@/lib/validation/data-entry";
