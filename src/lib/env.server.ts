import "server-only";

interface ServerEnv {
  RESEND_API_KEY: string;
  ALERTS_FROM_EMAIL: string;
}

export function getServerEnv(): ServerEnv {
  const required = ["RESEND_API_KEY", "ALERTS_FROM_EMAIL"] as const;

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required server environment variable(s):\n  ${missing.join("\n  ")}\n` +
        `Ensure these are set in your .env.local (or production environment).`
    );
  }

  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY!,
    ALERTS_FROM_EMAIL: process.env.ALERTS_FROM_EMAIL!,
  };
}
