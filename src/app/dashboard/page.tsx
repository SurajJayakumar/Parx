import AuthGate from "@/components/AuthGate";
import { CardSectionLabel } from "@/components/ui/Card";
import ReportsList from "@/components/ReportsList";
import DashboardMetricsCharts from "@/components/DashboardMetricsCharts";

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
        <DashboardMetricsCharts />
      </section>

      {/* Reports */}
      <section aria-labelledby="reports-heading">
        <CardSectionLabel id="reports-heading">
          Reports
        </CardSectionLabel>

        <ReportsList />
      </section>
    </AuthGate>
  );
}
