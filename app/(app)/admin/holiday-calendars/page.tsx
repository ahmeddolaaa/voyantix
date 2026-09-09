import { listHolidayCalendars } from "@/lib/actions/holiday-calendars";
import { HolidayCalendarsScreen } from "@/components/admin/HolidayCalendarsScreen";

export default async function HolidayCalendarsAdminPage() {
  const calendars = await listHolidayCalendars({ includeInactive: true });

  if (!calendars.ok) {
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
          {calendars.message}
        </div>
      </div>
    );
  }

  return <HolidayCalendarsScreen initialCalendars={calendars.data} />;
}