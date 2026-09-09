import { notFound } from "next/navigation";
import { getHolidayCalendar } from "@/lib/actions/holiday-calendars";
import { listHolidays } from "@/lib/actions/holidays";
import { HolidayCalendarDetailScreen } from "@/components/admin/HolidayCalendarDetailScreen";

export default async function HolidayCalendarDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const calendar = await getHolidayCalendar(id);
  if (!calendar.ok) {
    if (calendar.code === "NOT_FOUND") notFound();
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
          {calendar.message}
        </div>
      </div>
    );
  }

  const days = await listHolidays(id);
  if (!days.ok) {
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
          {days.message}
        </div>
      </div>
    );
  }

  return (
    <HolidayCalendarDetailScreen
      calendar={calendar.data}
      initialDays={days.data}
    />
  );
}