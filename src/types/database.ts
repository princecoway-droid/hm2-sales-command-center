/**
 * Supabase database types.
 *
 * This file mirrors the shape the Supabase CLI emits so it can be replaced
 * wholesale once the schema is applied to a project:
 *
 *   npm run db:types          # from the local stack (needs `npm run db:start`)
 *   npm run db:types:remote   # from the hosted project in SUPABASE_PROJECT_ID
 *
 * Until then it is maintained by hand against supabase/migrations. Keep the two
 * in step: every client is generic over `Database`, so a drift here shows up as
 * a type error at the call site rather than a runtime surprise.
 *
 * Application code should import the friendlier aliases from `@/types/models`
 * rather than reaching into this file directly.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Audit columns shared by every table that records who changed what. */
type AuditColumns = {
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

type AuditInsert = Partial<AuditColumns>;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: Database["public"]["Enums"]["user_role"];
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          role: Database["public"]["Enums"]["user_role"];
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          role?: Database["public"]["Enums"]["user_role"];
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };

      hms: {
        Row: {
          id: string;
          name: string;
          /** The Coway identifier. Unique, uppercased and trimmed by trigger. */
          hm_code: string;
          office: string;
          photo_url: string | null;
          status: Database["public"]["Enums"]["hm_status"];
          display_order: number;
          created_at: string;
          updated_at: string;
        };
        /**
         * `hm_code` is optional here only because the column carries a
         * sequence-backed default for direct database access. The application's
         * own form requires it - see `hmSchema`.
         */
        Insert: {
          id?: string;
          name: string;
          hm_code?: string;
          office: string;
          photo_url?: string | null;
          status?: Database["public"]["Enums"]["hm_status"];
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          hm_code?: string;
          office?: string;
          photo_url?: string | null;
          status?: Database["public"]["Enums"]["hm_status"];
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      months: {
        Row: {
          id: string;
          year: number;
          month: number;
          label: string;
          quarter: number;
          created_at: string;
        };
        /** `label` and `quarter` are derived by a database trigger. */
        Insert: {
          id?: string;
          year: number;
          month: number;
          label?: string;
          quarter?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          year?: number;
          month?: number;
          label?: string;
          quarter?: number;
          created_at?: string;
        };
        Relationships: [];
      };

      sales_weeks: {
        Row: {
          id: string;
          month_id: string;
          week_number: number;
          week_label: string;
          start_date: string;
          end_date: string;
          created_at: string;
        };
        /** `week_label` defaults to `W<week_number>` via a database trigger. */
        Insert: {
          id?: string;
          month_id: string;
          week_number: number;
          week_label?: string;
          start_date: string;
          end_date: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          month_id?: string;
          week_number?: number;
          week_label?: string;
          start_date?: string;
          end_date?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sales_weeks_month_id_fkey";
            columns: ["month_id"];
            isOneToOne: false;
            referencedRelation: "months";
            referencedColumns: ["id"];
          },
        ];
      };

      hm_monthly_performance: {
        Row: {
          id: string;
          hm_id: string;
          month_id: string;
          net_units: number;
          target_net_units: number;
          recruitment: number;
          active_hp: number;
          shi_percentage: number;
          extrade_units: number;
          non_extrade_units: number;
        } & AuditColumns;
        Insert: {
          id?: string;
          hm_id: string;
          month_id: string;
          net_units?: number;
          target_net_units?: number;
          recruitment?: number;
          active_hp?: number;
          shi_percentage?: number;
          extrade_units?: number;
          non_extrade_units?: number;
        } & AuditInsert;
        Update: {
          id?: string;
          hm_id?: string;
          month_id?: string;
          net_units?: number;
          target_net_units?: number;
          recruitment?: number;
          active_hp?: number;
          shi_percentage?: number;
          extrade_units?: number;
          non_extrade_units?: number;
        } & AuditInsert;
        Relationships: [
          {
            foreignKeyName: "hm_monthly_performance_hm_id_fkey";
            columns: ["hm_id"];
            isOneToOne: false;
            referencedRelation: "hms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hm_monthly_performance_month_id_fkey";
            columns: ["month_id"];
            isOneToOne: false;
            referencedRelation: "months";
            referencedColumns: ["id"];
          },
        ];
      };

      hm_weekly_performance: {
        Row: {
          id: string;
          hm_id: string;
          week_id: string;
          keyin_units: number;
        } & AuditColumns;
        Insert: {
          id?: string;
          hm_id: string;
          week_id: string;
          keyin_units?: number;
        } & AuditInsert;
        Update: {
          id?: string;
          hm_id?: string;
          week_id?: string;
          keyin_units?: number;
        } & AuditInsert;
        Relationships: [
          {
            foreignKeyName: "hm_weekly_performance_hm_id_fkey";
            columns: ["hm_id"];
            isOneToOne: false;
            referencedRelation: "hms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hm_weekly_performance_week_id_fkey";
            columns: ["week_id"];
            isOneToOne: false;
            referencedRelation: "sales_weeks";
            referencedColumns: ["id"];
          },
        ];
      };

      group_monthly_metrics: {
        Row: {
          id: string;
          month_id: string;
          shi_percentage: number;
        } & AuditColumns;
        Insert: {
          id?: string;
          month_id: string;
          shi_percentage?: number;
        } & AuditInsert;
        Update: {
          id?: string;
          month_id?: string;
          shi_percentage?: number;
        } & AuditInsert;
        Relationships: [
          {
            foreignKeyName: "group_monthly_metrics_month_id_fkey";
            columns: ["month_id"];
            isOneToOne: true;
            referencedRelation: "months";
            referencedColumns: ["id"];
          },
        ];
      };

      hps: {
        Row: {
          id: string;
          /** The Coway identifier. Unique, uppercased and trimmed by trigger. */
          hp_code: string;
          hp_name: string;
          /** The HM who owns this HP TODAY. History lives on the monthly row. */
          hm_id: string;
        } & AuditColumns;
        Insert: {
          id?: string;
          hp_code: string;
          hp_name: string;
          hm_id: string;
        } & AuditInsert;
        Update: {
          id?: string;
          hp_code?: string;
          hp_name?: string;
          hm_id?: string;
        } & AuditInsert;
        Relationships: [
          {
            foreignKeyName: "hps_hm_id_fkey";
            columns: ["hm_id"];
            isOneToOne: false;
            referencedRelation: "hms";
            referencedColumns: ["id"];
          },
        ];
      };

      hp_monthly_performance: {
        Row: {
          id: string;
          month_id: string;
          hp_id: string;
          /** Which HM this HP reported to IN THIS MONTH. Never rewritten later. */
          hm_id: string;
          w1_key_in: number;
          w2_key_in: number;
          w3_key_in: number;
          w4_key_in: number;
          /** W1+W2+W3+W4. A database CHECK refuses any other value. */
          total_key_in: number;
          /** TOTAL NET for this month only - never lifetime or cumulative. */
          total_net: number;
        } & AuditColumns;
        Insert: {
          id?: string;
          month_id: string;
          hp_id: string;
          hm_id: string;
          w1_key_in?: number;
          w2_key_in?: number;
          w3_key_in?: number;
          w4_key_in?: number;
          total_key_in?: number;
          total_net?: number;
        } & AuditInsert;
        Update: {
          id?: string;
          month_id?: string;
          hp_id?: string;
          hm_id?: string;
          w1_key_in?: number;
          w2_key_in?: number;
          w3_key_in?: number;
          w4_key_in?: number;
          total_key_in?: number;
          total_net?: number;
        } & AuditInsert;
        Relationships: [
          {
            foreignKeyName: "hp_monthly_performance_month_id_fkey";
            columns: ["month_id"];
            isOneToOne: false;
            referencedRelation: "months";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hp_monthly_performance_hp_id_fkey";
            columns: ["hp_id"];
            isOneToOne: false;
            referencedRelation: "hps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hp_monthly_performance_hm_id_fkey";
            columns: ["hm_id"];
            isOneToOne: false;
            referencedRelation: "hms";
            referencedColumns: ["id"];
          },
        ];
      };

      hp_import_runs: {
        Row: {
          id: string;
          month_id: string;
          file_name: string;
          rows_processed: number;
          new_hp_count: number;
          updated_hp_count: number;
          active_hp_count: number;
          inactive_hp_count: number;
          status: string;
          /** Stamped from auth.uid() by a trigger; never trusted from a client. */
          imported_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          month_id: string;
          file_name: string;
          rows_processed?: number;
          new_hp_count?: number;
          updated_hp_count?: number;
          active_hp_count?: number;
          inactive_hp_count?: number;
          status?: string;
          imported_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          month_id?: string;
          file_name?: string;
          rows_processed?: number;
          new_hp_count?: number;
          updated_hp_count?: number;
          active_hp_count?: number;
          inactive_hp_count?: number;
          status?: string;
          imported_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hp_import_runs_month_id_fkey";
            columns: ["month_id"];
            isOneToOne: false;
            referencedRelation: "months";
            referencedColumns: ["id"];
          },
        ];
      };

      share_links: {
        Row: {
          id: string;
          token: string;
          month_id: string;
          created_by: string | null;
          created_at: string;
          expires_at: string | null;
          revoked_at: string | null;
          is_active: boolean;
          last_accessed_at: string | null;
        };
        Insert: {
          id?: string;
          token: string;
          month_id: string;
          /** Stamped from auth.uid() by a trigger; never trusted from a client. */
          created_by?: string | null;
          created_at?: string;
          expires_at?: string | null;
          revoked_at?: string | null;
          is_active?: boolean;
          last_accessed_at?: string | null;
        };
        Update: {
          id?: string;
          /** Frozen after insert by a trigger. Present only for completeness. */
          token?: string;
          month_id?: string;
          created_by?: string | null;
          created_at?: string;
          expires_at?: string | null;
          revoked_at?: string | null;
          is_active?: boolean;
          last_accessed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "share_links_month_id_fkey";
            columns: ["month_id"];
            isOneToOne: false;
            referencedRelation: "months";
            referencedColumns: ["id"];
          },
        ];
      };
    };

    /**
     * Both are `security_invoker`, so RLS applies to the caller exactly as it
     * does on the tables underneath them. Neither is writable.
     */
    Views: {
      /** Active HP per HM per month. The single source of the figure. */
      hm_monthly_hp_summary: {
        Row: {
          month_id: string;
          hm_id: string;
          /**
           * HP rows for this HM and month. The presence of a row here is what
           * separates "0 active" from "no HP data" - there is no row at all for
           * an HM nothing has been imported for.
           */
          hp_count: number;
          /** HP rows with total_key_in >= 1. */
          active_hp: number;
          hp_total_key_in: number;
          hp_total_net: number;
          /** Latest write to any of this HM's HP rows for the month. */
          hp_updated_at: string | null;
        };
        Relationships: [];
      };

      /** One HP row of one month, with the HP and HM identities joined. */
      hp_monthly_report: {
        Row: {
          id: string;
          month_id: string;
          hp_id: string;
          hm_id: string;
          hp_code: string;
          hp_name: string;
          hm_name: string;
          hm_code: string;
          w1_key_in: number;
          w2_key_in: number;
          w3_key_in: number;
          w4_key_in: number;
          total_key_in: number;
          total_net: number;
          is_active: boolean;
          updated_at: string;
        };
        Relationships: [];
      };
    };

    Functions: {
      current_profile_role: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      is_manager: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_staff: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      /**
       * One of the two functions `anon` may execute.
       *
       * Returns one reporting month of public-safe records for a valid, active,
       * unexpired token, or `null` for every failure - so a caller cannot tell
       * "no such token" from "revoked" from "expired". Typed as `Json` because
       * it is a projection built in SQL rather than a table row; the shape it
       * actually returns is parsed and narrowed in `lib/share/resolve.ts`.
       */
      resolve_share_report: {
        Args: { p_token: string };
        Returns: Json;
      };
      /**
       * The other one: the same token, narrowed to one HM.
       *
       * Returns the token's month exactly as `resolve_share_report` does, plus
       * that ONE HM's monthly figures for the previous month and the earlier
       * months of the quarter - enough for month-over-month and QTD, and never
       * enough for a second group report. `null` for every failure, including
       * an HM the token's month is not about. Narrowed in
       * `lib/share/resolve-hm.ts`.
       */
      resolve_share_hm_report: {
        Args: { p_token: string; p_hm_id: string };
        Returns: Json;
      };
      /**
       * The whole HP import, in one transaction.
       *
       * NOT `security definer`: every statement inside runs as the caller under
       * the Stage 8 RLS policies. It validates the entire payload before
       * writing anything, so a rejected import leaves the month exactly as it
       * was. Returns the counts the result screen shows; typed as `Json`
       * because it is a projection built in SQL, and narrowed in
       * `lib/import/result.ts`.
       */
      import_hp_month: {
        Args: { p_month_id: string; p_file_name: string; p_rows: Json };
        Returns: Json;
      };
    };

    /**
     * These are CHECK-constrained text columns rather than Postgres enums, so
     * the CLI would emit them as `string`. Narrowing them here buys real safety
     * at the call site; keep the unions in step with the CHECK constraints in
     * supabase/migrations/20260903120000_core_schema.sql.
     */
    Enums: {
      user_role: "manager" | "pa";
      hm_status: "active" | "inactive";
    };

    CompositeTypes: Record<never, never>;
  };
};

type PublicSchema = Database["public"];

/** Row type for a table, e.g. `Tables<"hms">`. */
export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];

/** Insert payload for a table, e.g. `TablesInsert<"hms">`. */
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];

/** Update payload for a table, e.g. `TablesUpdate<"hms">`. */
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];

/** Row type for a view, e.g. `Views<"hp_monthly_report">`. Read-only. */
export type Views<T extends keyof PublicSchema["Views"]> =
  PublicSchema["Views"][T]["Row"];

/** Narrowed union for a CHECK-constrained column, e.g. `Enums<"user_role">`. */
export type Enums<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T];
