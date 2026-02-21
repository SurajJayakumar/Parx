import AuthGate from "@/components/AuthGate";
import CameraCapture from "@/components/CameraCapture";

export default function CameraPage() {
  return (
    <AuthGate>
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">
        Live Camera
      </h1>
      <p className="text-zinc-500 dark:text-zinc-400 mb-8 text-sm">
        Real-time movement capture for motor analysis.
      </p>

      <CameraCapture />

      <p className="mt-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Screening tool — not a medical diagnosis.
      </p>
    </AuthGate>
  );
}
