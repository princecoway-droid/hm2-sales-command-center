import type { Metadata } from "next";

import { HmManagementTable } from "@/components/hm/hm-management-table";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { isManager, requirePaOrManager } from "@/lib/auth/session";
import { listHms } from "@/lib/data/hms";

export const metadata: Metadata = { title: "HM Management" };

/**
 * The HM master list.
 *
 * Manager and PA both maintain it; only a manager may delete a record outright,
 * matching the Stage 1 RLS policy. `canDelete` decides what the UI offers - the
 * database decides what actually happens.
 */
export default async function HmManagementPage() {
  const user = await requirePaOrManager();
  const result = await listHms();

  const activeCount = result.ok
    ? result.data.filter((hm) => hm.status === "active").length
    : 0;

  return (
    <>
      <PageHeader
        title="HM Management"
        description="The Health Manager master list. Data entry shows active HMs; deactivating someone keeps every record they ever had."
      />

      <Card>
        <CardHeader
          title="Health Managers"
          description={
            result.ok
              ? `${activeCount} active of ${result.data.length} record${result.data.length === 1 ? "" : "s"}`
              : "Could not load the list"
          }
        />
        <CardBody>
          {!result.ok ? (
            <Alert tone="error" title="Database read failed">
              <p>{result.error}</p>
              <p className="mt-1">
                Check that the migrations in{" "}
                <code className="font-mono">supabase/migrations</code> have been
                applied and that your profile is active.
              </p>
            </Alert>
          ) : (
            <HmManagementTable hms={result.data} canDelete={isManager(user)} />
          )}
        </CardBody>
      </Card>
    </>
  );
}
