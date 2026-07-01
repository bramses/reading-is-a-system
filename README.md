# Reading Is a System Static

A Vercel-deployable Next.js site for a small JSON-backed strategy library.

## Content

The site content is in `app/data/site.json`.

- `title` and `subtitle` control the page heading.
- `links.discord`, `links.slides`, `links.github`, and `links.schedule` control the top links.
- `tags` controls the checkbox filters and display order.
- `strategies` controls the filterable cards.
- Each strategy supports `title`, `subtitle`, `body`, `tags`, `pairedWithIds`, `assets`, `youtubeLinks`, `imageUrls`, and `audioFileUrls`.
- `pairedWithIds` is an array of other strategy IDs for in-page navigation.
- `assets` is an array of `{ "label": "...", "url": "..." }` links.
- `imageUrls` render inline in expanded cards.

The Cart is stored in browser `sessionStorage`. Selected strategies can be
printed or saved as a PDF checklist with fields for where you are now and goal.

## Development

```bash
npm run dev
```

Open `http://localhost:3000`.

## Production

```bash
npm run build
```

Deploy the repository to Vercel. Vercel will run the build script and serve the Next.js app.
