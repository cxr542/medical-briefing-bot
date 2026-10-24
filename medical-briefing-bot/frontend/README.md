This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Use the current main branch: protected pages read articles through authenticated
server routes. The old direct anonymous Supabase dashboard cannot read production
data. Link to the existing Vercel project and use its development configuration;
never copy a service-role key into a `NEXT_PUBLIC_` variable.

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

## Install on a phone (PWA)

Open https://medical-briefing-bot.vercel.app over HTTPS. On iPhone use Safari's
Share > Add to Home Screen; on Android use Chrome's Add to Home Screen / Install
app menu. The existing customer login remains required. Installation help is
available on both login and dashboard. No push notification subscription is added.

The service worker registers in production only. It stores only the static
offline explanation and bear icon, never articles, authenticated HTML, API
responses or credentials. Offline navigation shows a retry link; article reading
requires a connection. Generate icons with `node scripts/generate-pwa-icons.mjs`.
Use `npm test`, `npm run lint`, `npx tsc --noEmit` and a production build before
release. Verify manifest/icons, login protection and offline recovery in a browser.

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
