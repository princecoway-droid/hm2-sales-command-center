"use client";

import { useFormStatus } from "react-dom";

import { signOutAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <SubmitButton />
    </form>
  );
}
