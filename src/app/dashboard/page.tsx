import AuthGate from "@/components/AuthGate";
import EmptyState from "@/components/EmptyState";
import { Card, CardSectionLabel } from "@/components/ui/Card";

const mobilityMetrics = [
  {
    label: "Walking Speed",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l7.5-7.5 6 6L21 6" />
      </svg>
    ),
  },
  {
    label: "Step Length",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    label: "Arm Swing",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    ),
  },
];

export default function DashboardPage() {
  return (
    <AuthGate>
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">
        Mobility Dashboard
      </h1>
      <p className="text-zinc-500 dark:text-zinc-400 mb-8 text-sm">
        Your patient&apos;s movement data will appear here after a session.
      </p>

      {/* Today's Mobility Analytics */}
      <section aria-labelledby="analytics-heading" className="mb-10">
        <CardSectionLabel id="analytics-heading">
          Today&apos;s Mobility Analytics
        </CardSectionLabel>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {mobilityMetrics.map(({ label, icon }) => (
            <Card key={label}>
              <div className="flex items-center gap-2 mb-3 text-zinc-400 dark:text-zinc-500">
                {icon}
                <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
              </div>
              <p className="text-3xl font-semibold text-zinc-300 dark:text-zinc-600 mb-1">—</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">Waiting for session data</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Previous PDF Reports */}
      <section aria-labelledby="reports-heading">
        <CardSectionLabel id="reports-heading">
          Previous PDF Reports
        </CardSectionLabel>

        <Card padding="none">
          <EmptyState
            title="No reports yet"
            description="PDF reports will be generated after you complete a mobility session."
          />
        </Card>
      </section>
    </AuthGate>
  );
}
