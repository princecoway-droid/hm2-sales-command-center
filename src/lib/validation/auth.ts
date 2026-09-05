import { z } from "zod";

/** Login credentials. */
export const credentialsSchema = z.object({
  // Trim and lowercase BEFORE the format check, not after. Chaining
  // `z.email().trim()` would validate the raw string first and reject a
  // pasted address with a stray leading space.
  email: z
    .string({ error: "Enter your email address." })
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address.")),
  // Length rules belong to Supabase Auth (see supabase/config.toml). Requiring
  // more than "not blank" here would only leak the policy on the login form.
  password: z.string().min(1, "Enter your password."),
});

export type CredentialsInput = z.infer<typeof credentialsSchema>;
