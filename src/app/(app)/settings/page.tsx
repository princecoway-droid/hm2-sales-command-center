import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireManager } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Settings" };

/** Manager-only. A PA who reaches this URL is sent to /no-access. */
export default async function SettingsPage() {
  await requireManager();

  return (
    <>
      <PageHeader title="Settings" description="Manager-only configuration." />

      <Card>
        <CardHeader
          title="Where things live"
          description="Month-scoped configuration sits on the screen that uses it."
        />
        <CardBody>
          <ul className="space-y-3 text-sm text-slate-600">
            <li>
              <span className="font-medium text-slate-900">
                Reporting months
              </span>{" "}
              and the{" "}
              <span className="font-medium text-slate-900">sales calendar</span>{" "}
              are configured on{" "}
              <Link
                href={ROUTES.dataEntry}
                className="font-medium text-sky-700 hover:text-sky-800"
              >
                Data Entry
              </Link>
              , alongside the figures they scope. Both belong to a single month,
              and separating them from the grid would mean navigating away
              mid-entry to fix a week that is one row out.
            </li>
            <li>
              <span className="font-medium text-slate-900">
                Health Managers
              </span>{" "}
              — the master list, photos and activation live on{" "}
              <Link
                href={ROUTES.hmManagement}
                className="font-medium text-sky-700 hover:text-sky-800"
              >
                HM Management
              </Link>
              .
            </li>
            <li>
              <span className="font-medium text-slate-900">Users</span> — manager
              and PA accounts are still provisioned from the Supabase dashboard.
              HMs have no login.
            </li>
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
