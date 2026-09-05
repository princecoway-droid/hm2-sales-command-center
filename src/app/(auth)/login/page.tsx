import type { Metadata } from "next";

import { LoginForm } from "@/app/(auth)/login/login-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { hasPublicSupabaseConfig } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const nextParam = searchParams.next;
  const next = typeof nextParam === "string" ? nextParam : undefined;

  if (!hasPublicSupabaseConfig()) {
    return (
      <Card>
        <CardBody>
          <Alert tone="warning" title="Supabase is not configured">
            <p>
              Copy <code className="font-mono">.env.example</code> to{" "}
              <code className="font-mono">.env.local</code>, fill in{" "}
              <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>,
              then restart the dev server.
            </p>
          </Alert>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">
            Manager and PA access. Accounts are provisioned by your manager.
          </p>
        </div>

        <LoginForm next={next} />
      </CardBody>
    </Card>
  );
}
