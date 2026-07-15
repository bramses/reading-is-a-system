# Reading is a System

Read more widely, deeply, and effectively by treating reading as a system. A small Next.js site for building a personal library of reading strategies, filtering it down to the ones that fit your goals, and turning your picks into a printable action plan.

**Live site:** https://reading-is-a-system.vercel.app

<!-- TODO: add a screenshot of the strategy explorer here before publishing -->

## What's here

- **Strategy library** — browse reading strategies as filterable cards, tagged by category (comprehension, throughput, store, search, synthesize, share, digilog, bad-habits).
- **Cart + checklist** — add strategies to a cart (kept in your browser's `sessionStorage`) and export your picks as a printable / PDF checklist with fields for where you are now and what you're aiming for.
- **Starter Pack** (`/starter-pack`) — a curated, ordered walkthrough of a handful of strategies for readers who want a fast on-ramp instead of the full library.
- **Strategy Game** (`/strategy-game`) — an interactive, prompt-based exercise built from the strategy set.
- **Reading Journal** (`/reading-journal`) — a viewer for a curated list of YouTube videos, with titles resolved live via the YouTube oEmbed API.
- **Content editor** (`/be`) — a password-protected page for editing the strategy library without hand-editing JSON.

## Content

All site content — strategies, tags, links, Starter Pack order, Reading Journal videos, and the header marquee text — lives in [`app/data/site.json`](app/data/site.json) and is typed in [`app/site-types.ts`](app/site-types.ts).

- `title` and `subtitle` control the page heading.
- `links.newsletter`, `links.slides`, `links.github`, `links.schedule`, `links.bookClub`, and `links.kofi` control the top links. All six are required.
- `tags` controls the checkbox filters and their display order.
- `starterPackStrategyIds` controls which strategies appear in the Starter Pack, and in what order.
- `readingJournalYoutubeUrls` controls which videos show up on the Reading Journal page.
- `marqueeItems` controls the scrolling header text.
- `strategies` controls the filterable cards. Each strategy supports `title`, `subtitle`, `body`, `tags`, `pairedWithIds`, `assets`, `youtubeLinks`, `imageUrls`, and `audioFileUrls`.
- `pairedWithIds` is an array of other strategy IDs, used for in-page navigation between related strategies.
- `assets` and `youtubeLinks` are arrays of `{ "label": "...", "url": "..." }` links.
- `imageUrls` render inline in expanded cards.

### Content editor

The password-protected content editor at `/be` writes updates directly to `app/data/site.json`.

Set `CONTENT_ADMIN_PASSWORD` in your Vercel project's Environment Variables, and set the same key in `.env.local` for local development. Do not prefix it with `NEXT_PUBLIC_`.

This works well locally or on a persistent Node host. Vercel's serverless filesystem is not durable storage, so if you're editing content in production on Vercel, back it with Git, Blob, KV, or a database rather than relying on filesystem writes surviving between deploys.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production

```bash
npm run build
npm run start
```

Deploy the repository to Vercel — it will run the build script and serve the Next.js app. The live instance is at https://reading-is-a-system.vercel.app.

## Support

If this is useful to you, consider [buying me a coffee on Ko-fi](https://ko-fi.com/bramses), or check out the [newsletter](https://buttondown.com/bramses) and [book club](https://calendar.app.google/kXBcqxRAY7znvfgJA).
