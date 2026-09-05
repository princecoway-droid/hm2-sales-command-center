import type { Metadata } from "next";

import { SignOutButton } from "@/components/layout/sign-out-button";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "No access" };

/**
 * Reached in two situations, both worth distinguishing from "please sign in":
 *
 *   * The Supabase Auth account exists but has no active profile - it has not
 *     been provisioned yet, or it has been deactivated.
 *   * A PA opened a manager-only area.
 */
export default async function NoAccessPage() {
  const user = await getCurrentUser();

  return (
    <Card>
      <CardBody className="space-y-4">
        <Alert tone="warning" title="You do not have access to that area">
          {user ? (
            <p>
              You are signed in as{" "}
              <span className="font-medium">{user.profile.full_name}</span>. That
              page needs a different role.
            </p>
          ) : (
            <p>
              Your account is not set up for this application yet. Ask your
              manager to provision it, then sign in again.
            </p>
          )}
        </Alert>

        <SignOutButton />
      </CardBody>
    </Card>
  );
}
