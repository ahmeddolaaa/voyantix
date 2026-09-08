import { listPorts } from "@/lib/actions/ports";
import { listHolidayCalendarOptions } from "@/lib/actions/ports-support";
import { PortsScreen } from "@/components/admin/PortsScreen";

/**
 * Ports administration.
 *
 * Data is fetched on the server inside the authorized action, so the tenant
 * scope comes from the session and never from anything the browser sends.
 * Inactive ports are included here because this is the administrative view —
 * an operator picking a port for a new voyage sees only active ones.
 */
export default async function PortsAdminPage() {
  const [ports, calendars] = await Promise.all([
    listPorts({ includeInactive: true }),
    listHolidayCalendarOptions(),
  ]);

  if (!ports.ok) {
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
          {ports.message}
        </div>
      </div>
    );
  }

  return (
    <PortsScreen
      initialPorts={ports.data}
      calendars={calendars.ok ? calendars.data : []}
    />
  );
}
