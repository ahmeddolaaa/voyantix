import { listEventTypes } from "@/lib/actions/event-types";
import { EventTypesScreen } from "@/components/admin/EventTypesScreen";

export default async function EventTypesAdminPage() {
  const eventTypes = await listEventTypes({ includeInactive: true });

  if (!eventTypes.ok) {
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
          {eventTypes.message}
        </div>
      </div>
    );
  }

  return <EventTypesScreen initialEventTypes={eventTypes.data} />;
}