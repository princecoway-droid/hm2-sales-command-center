import { z } from "zod";

import { HM_STATUSES } from "@/types/models";
import { naturalNumber, requiredText } from "@/lib/validation/utils";

/**
 * HM master record.
 * Mirrors the constraints on `public.hms`.
 */
export const hmSchema = z.object({
  name: requiredText("Name", 120),
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
