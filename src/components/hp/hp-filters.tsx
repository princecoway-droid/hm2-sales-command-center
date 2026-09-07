"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { hpListingPath } from "@/lib/routes";
import type { HpListingViewModel } from "@/lib/view-models/hp-listing";

type HpFiltersProps = {
  month: HpListingViewModel["month"];
  filters: HpListingViewModel["filters"];
};

/**
 * Search, HM and Active/All.
 *
 * The filters live in the URL, not in component state, for the same reason the
 * month does everywhere else in this application: a filtered list can be
 * bookmarked, refreshed and pasted into a chat, and - the reason that actually
 * matters here - the dashboard's Active HP figures link straight into this page
 * with the filters already set. A control that kept its state locally could not
 * be arrived at that way.
 *
 * Changing a filter is therefore a NAVIGATION, and every change resets to page
 * one: staying on page 3 of a list that now has one page shows an empty screen
 * and no explanation.
 */
export function HpFilters({ month, filters }: HpFiltersProps) {
  const router = useRouter();

  function go(next: {
    hmId?: string | null;
    activeOnly?: boolean;
    search?: string | null;
  }) {
    router.push(
      hpListingPath({
        month: month.param,
        hmId: next.hmId === undefined ? filters.hmId : next.hmId,
        activeOnly:
          next.activeOnly === undefined ? filters.activeOnly : next.activeOnly,
        search: next.search === undefined ? filters.search : next.search,
      }),
    );
  }

  return (
    <form
      // Keyed on the search that is currently in the URL, so arriving here from
      // a "clear the filters" link or a browser Back remounts the field with
      // the right value. That is what an effect syncing state to a prop would
      // have been for, without the extra render.
      key={filters.search}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get("q");
        go({ search: typeof value === "string" ? value : "" });
      }}
    >
      {/* Uncontrolled: the field's value only matters when the form is
          submitted, and the URL is where it lives the rest of the time. */}
      <Field
        label="Search"
        name="q"
        type="search"
        defaultValue={filters.search}
        placeholder="HP name or HP code"
        hint="Press Enter to search."
        autoComplete="off"
      />

      <SelectField
        label="HM"
        name="hm"
        value={filters.hmId ?? ""}
        onChange={(event) => go({ hmId: event.target.value || null })}
        options={[
          { value: "", label: "All HMs" },
          ...filters.hms.map((hm) => ({ value: hm.id, label: hm.label })),
        ]}
      />

      <div className="flex items-end gap-2">
        <div className="w-40">
          <SelectField
            label="Show"
            name="active"
            value={filters.activeOnly ? "active" : "all"}
            onChange={(event) => go({ activeOnly: event.target.value === "active" })}
            options={[
              { value: "active", label: "Active only" },
              { value: "all", label: "All HP" },
            ]}
          />
        </div>

        {/* A real submit button, so the search runs on a phone where there is
            no Enter key in reach and the keyboard's "go" is the only affordance. */}
        <Button type="submit" variant="secondary" className="mb-0.5">
          Search
        </Button>
      </div>
    </form>
  );
}
