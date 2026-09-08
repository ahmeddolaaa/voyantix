import { listVessels } from "@/lib/actions/vessels";
import { VesselsScreen } from "@/components/admin/VesselsScreen";

export default async function VesselsAdminPage() {
  const vessels = await listVessels({ includeInactive: true });

  if (!vessels.ok) {
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
          {vessels.message}
        </div>
      </div>
    );
  }

  return <VesselsScreen initialVessels={vessels.data} />;
}
