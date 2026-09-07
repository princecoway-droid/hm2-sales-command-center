import { z } from "zod";

import { HM_STATUSES } from "@/types/models";
import { naturalNumber, requiredText } from "@/lib/validation/utils";

/**
 * HM master record.
 * Mirrors the constraints on `public.hms`.
 */
export const hmSchema = z.object({
  name: requiredText("Name", 120),
  /**
   * The Coway identifier, and the key the Stage 8 Excel import matches on.
   *
   * Required here even though the column carries a sequence-backed default:
   * the default exists so a direct database insert cannot violate NOT NULL, not
   * so the form can leave it blank. Uppercased before it is sent, which is what
   * the database's own trigger would do anyway - doing it here means the PA
   * sees the stored value in the field they just typed into.
   */
  hm_code: requiredText("HM Code", 32)
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => /^[A-Z0-9][A-Z0-9._/-]{0,31}$/.test(value),
      "HM Code may use letters, digits and . _ - / only, with no spaces.",
    ),
  office: requiredText("Office", 120),
  photo_url: z
    .union([z.url("Photo URL must be a valid URL."), z.literal("")])
    .nullish()
    .transform((value) => (value ? value : null)),
  status: z.enum(HM_STATUSES, { error: "Status must be active or inactive." }),
  display_order: naturalNumber("Display order").default(0),
});

export type HMInput = z.infer<typeof hmSchema>;

/** Partial edit of an existing HM. */
export const hmUpdateSchema = hmSchema.partial();

export type HMUpdateInput = z.infer<typeof hmUpdateSchema>;
