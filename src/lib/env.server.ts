import "server-only";

interface ServerEnv {
  RESEND_API_KEY: string;
  ALERTS_FROM_EMAIL: string;
  FEATHERLESS_API_KEY: string;
  FEATHERLESS_BASE_URL: string;
  FEATHERLESS_MODEL: string;
}

export function getServerEnv(): ServerEnv {
  const required = [
    "RESEND_API_KEY",
    "ALERTS_FROM_EMAIL",
    "FEATHERLESS_API_KEY",
    "FEATHERLESS_BASE_URL",
    "FEATHERLESS_MODEL",
  ] as const;

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
    FEATHERLESS_API_KEY: process.env.FEATHERLESS_API_KEY!,
    FEATHERLESS_BASE_URL: process.env.FEATHERLESS_BASE_URL!,
    FEATHERLESS_MODEL: process.env.FEATHERLESS_MODEL!,
  };
}
