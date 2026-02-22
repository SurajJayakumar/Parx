This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## API Endpoints

### `POST /api/alerts/weekly`

Sends a weekly summary email to a caregiver via Resend. Expected JSON body:

| Field | Type | Required | Description |
|---|---|---|---|
| `caregiverEmail` | `string` | ✓ | Recipient email address |
| `patientName` | `string` | ✓ | Patient's display name |
| `weekRange` | `string` | ✓ | Human-readable week label, e.g. `"Feb 17–23, 2026"` |
| `metrics` | `Record<string, number>` | ✓ | Flat map of metric name → value |
| `trendSummary` | `string` | ✓ | Short prose description of observed trends |
| `dashboardUrl` | `string (url)` | ✓ | Link to the caregiver's dashboard |
| `reportUrl` | `string (url)` | — | Link to the full weekly report (optional) |

**Hook this endpoint to Vercel Cron weekly.** Add the following to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/alerts/weekly",
      "schedule": "0 8 * * 1"
    }
  ]
}
```

> The cron expression above fires every Monday at 08:00 UTC. Adjust the schedule and supply the POST body from your cron handler or a Vercel Edge Function that fetches caregiver records and calls this endpoint for each patient.

---

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
