"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { signInAction } from "@/lib/auth/actions";
import { fieldError, initialActionState } from "@/lib/result";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(signInAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.status === "error" && state.message ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        required
        error={fieldError(state, "email")}
      />

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={fieldError(state, "password")}
      />

      <SubmitButton />
    </form>
  );
}
