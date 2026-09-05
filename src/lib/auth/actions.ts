"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { failure, type ActionState } from "@/lib/result";
import { DEFAULT_AUTHENTICATED_ROUTE, ROUTES } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { credentialsSchema } from "@/lib/validation/auth";
import { toFieldErrors } from "@/lib/validation/utils";

/**
 * Signs a manager or PA in.
 *
 * Shaped for `useActionState`: takes the previous state, returns the next one.
 * On success it redirects, which throws, so nothing after it runs.
 */
export async function signInAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return failure(
      "Check the highlighted fields and try again.",
      toFieldErrors(parsed.error),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately vague: distinguishing "no such user" from "wrong password"
    // hands an attacker a list of valid accounts.
    return failure("Incorrect email or password.");
  }

  const nextParam = formData.get("next");
  const destination =
    typeof nextParam === "string" && isSafeRedirect(nextParam)
      ? nextParam
      : DEFAULT_AUTHENTICATED_ROUTE;

  revalidatePath("/", "layout");
  redirect(destination);
}

/** Signs the current user out and returns them to the login page. */
export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect(ROUTES.login);
}

/**
 * Only same-origin, path-relative redirects are honoured, so a crafted
 * `?next=https://evil.example` cannot turn login into an open redirect.
 */
function isSafeRedirect(target: string): boolean {
  return target.startsWith("/") && !target.startsWith("//");
}
