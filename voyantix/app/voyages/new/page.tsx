import { CompanyBar } from "@/components/CompanyBar";
import { Card, PageTitle, PrimaryButton } from "@/components/ui";
import { createVoyage, listLookups } from "@/lib/actions/voyages";

export default async function NewVoyagePage() {
  const { vessels, ports, contractTerms } = await listLookups();

  return (
    <div className="flex flex-col min-h-screen">
      <CompanyBar active="portfolio" />
      <div className="flex-1 max-w-2xl w-full mx-auto px-8 py-8">
        <PageTitle>New Voyage</PageTitle>
        <p className="text-[13px] mt-1 mb-6" style={{ color: "var(--steel)" }}>
          Create a voyage to begin tracking laytime.
        </p>

        <Card>
          <form action={createVoyage} className="flex flex-col gap-4">
            <Field label="Voyage Reference">
              <input name="voyageReference" required className="input" placeholder="VOY-002" />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Vessel">
                <select name="vesselId" required className="input">
                  {vessels.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Port">
                <select name="portId" required className="input">
                  {ports.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Contract Terms">
              <select name="contractTermsId" className="input">
                <option value="">— none —</option>
                {contractTerms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.termsReference}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-3 gap-4">
              <Field label="Arrival Time">
                <input type="datetime-local" name="arrivalTime" className="input" />
              </Field>
              <Field label="NOR Tender">
                <input type="datetime-local" name="norTender" className="input" />
              </Field>
              <Field label="NOR Acceptance">
                <input type="datetime-local" name="norAcceptance" className="input" />
              </Field>
            </div>

            <div className="mt-2">
              <PrimaryButton type="submit">Save Voyage</PrimaryButton>
            </div>
          </form>
        </Card>
      </div>

      <style>{`
        .input {
          border: 1px solid var(--line);
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 13px;
          background: var(--card);
          color: var(--ink);
          width: 100%;
        }
        .input:focus {
          outline: 2px solid var(--brass);
          outline-offset: 1px;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium" style={{ color: "var(--ink-soft)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}
