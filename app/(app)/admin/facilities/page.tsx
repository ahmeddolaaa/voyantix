import { listFacilities, listPortChoices } from "@/lib/actions/facilities";
import { FacilitiesScreen } from "@/components/admin/FacilitiesScreen";

/**
 * Facilities administration.
 *
 * Inactive facilities are included: this is the administrative view, where
 * a deactivated berth still needs to be visible and reactivatable. Port
 * choices are fetched separately because the form offers active ports only,
 * while the table shows whichever port each facility actually sits at.
 */
export default async function FacilitiesAdminPage() {
  const [facilities, ports] = await Promise.all([
    listFacilities({ includeInactive: true }),
    listPortChoices(),
  ]);

  if (!facilities.ok) {
    return (
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div
          role="alert"
          className="rounded-md px-4 py-3 text-[13px]"
          style={{
            background: "var(--rust-soft)",
            border: "1px solid var(--rust)",
            color: "var(--rust)",
          }}
        >
          {facilities.message}
        </div>
      </div>
    );
  }

  return (
    <FacilitiesScreen
      initialFacilities={facilities.data}
      portChoices={ports.ok ? ports.data : []}
    />
  );
}
