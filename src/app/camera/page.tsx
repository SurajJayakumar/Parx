import { Card, CardSectionLabel } from "@/components/ui/Card";
import CameraCapture from "@/components/CameraCapture";

const liveMetrics = [
  {
    label: "Walking Speed",
    unit: "m/s",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l7.5-7.5 6 6L21 6" />
      </svg>
    ),
  },
  {
    label: "Step Cadence",
    unit: "steps/min",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    label: "Arm Swing (L)",
    unit: "°",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
      </svg>
    ),
  },
  {
    label: "Arm Swing (R)",
    unit: "°",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15l4.875-4.875L18 15M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
      </svg>
    ),
  },
];

export default function CameraPage() {
  return (
    <>
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">
        Live Camera
      </h1>
      <p className="text-zinc-500 dark:text-zinc-400 mb-8 text-sm">
        Real-time movement capture for motor analysis.
      </p>

      {/* Camera preview */}
      <div className="mx-auto w-full max-w-2xl mb-8">
        <CameraCapture />
      </div>

      {/* Live Metrics */}
      <section aria-labelledby="live-metrics-heading" className="mb-8">
        <CardSectionLabel id="live-metrics-heading">Live Metrics</CardSectionLabel>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {liveMetrics.map(({ label, unit, icon }) => (
            <Card key={label}>
              <div className="flex items-center gap-2 mb-3 text-zinc-400 dark:text-zinc-500">
                {icon}
                <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
              </div>
              <p className="text-3xl font-semibold text-zinc-300 dark:text-zinc-600 mb-1">—</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">{unit} · awaiting feed</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Disclaimer */}
      <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
        Screening tool — not a medical diagnosis.
      </p>
    </>
  );
}
