import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { readSiteData } from "../site-data";
import type { ResourceLink, SiteData, Strategy } from "../site-types";
import { loginToEditor, logoutOfEditor, saveSiteContent } from "./actions";
import {
  ADMIN_PASSWORD_ENV,
  hasAdminPassword,
  isAdminAuthenticated,
} from "./auth";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Content editor",
  robots: {
    follow: false,
    index: false,
  },
};

type AdminPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type FieldProps = {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  type?: string;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function listText(items: string[]) {
  return items.join("\n");
}

function resourceLinksText(links: ResourceLink[]) {
  return links.map((link) => `${link.label} | ${link.url}`).join("\n");
}

function statusText(status: string | undefined, message: string | undefined) {
  switch (status) {
    case "bad-password":
      return "Password did not match.";
    case "error":
      return message ?? "The content could not be saved.";
    case "saved":
      return "Saved app/data/site.json.";
    case "signed-in":
      return "Signed in.";
    case "signed-out":
      return "Signed out.";
    default:
      return "";
  }
}

function TextField({
  label,
  name,
  defaultValue = "",
  required = true,
  type = "text",
}: FieldProps) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold uppercase">{label}</span>
      <input
        className="w-full border border-[#c8c0ae] bg-white px-3 py-2 text-base outline-none focus:border-[#22201b]"
        defaultValue={defaultValue}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}

function TextAreaField({
  label,
  name,
  defaultValue = "",
  required = true,
  rows = 4,
}: FieldProps & { rows?: number }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold uppercase">{label}</span>
      <textarea
        className="w-full resize-y border border-[#c8c0ae] bg-white px-3 py-2 text-base leading-7 outline-none focus:border-[#22201b]"
        defaultValue={defaultValue}
        name={name}
        required={required}
        rows={rows}
      />
    </label>
  );
}

function PageLinksEditor({ site }: { site: SiteData }) {
  return (
    <section className="riso-panel grid gap-5 p-4 sm:p-5">
      <div>
        <h2 className="text-xl font-semibold">Page</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField defaultValue={site.title} label="Title" name="title" />
        <TextAreaField
          defaultValue={site.subtitle}
          label="Subtitle"
          name="subtitle"
          rows={3}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          defaultValue={site.links.newsletter}
          label="Newsletter link"
          name="link_newsletter"
          type="url"
        />
        <TextField
          defaultValue={site.links.slides}
          label="Slides link"
          name="link_slides"
          type="url"
        />
        <TextField
          defaultValue={site.links.github}
          label="GitHub link"
          name="link_github"
          type="url"
        />
        <TextField
          defaultValue={site.links.schedule}
          label="Schedule link"
          name="link_schedule"
          type="url"
        />
        <TextField
          defaultValue={site.links.bookClub}
          label="Book club link"
          name="link_bookClub"
          type="url"
        />
        <TextField
          defaultValue={site.links.kofi}
          label="Ko-fi link"
          name="link_kofi"
          type="url"
        />
      </div>
      <TextAreaField
        defaultValue={listText(site.tags)}
        label="Tag order"
        name="tags"
        rows={5}
      />
      <TextAreaField
        defaultValue={listText(site.starterPackStrategyIds)}
        label="Starter pack strategy IDs"
        name="starterPackStrategyIds"
        required={false}
        rows={4}
      />
      <TextAreaField
        defaultValue={listText(site.readingJournalYoutubeUrls)}
        label="Reading journal YouTube URLs"
        name="readingJournalYoutubeUrls"
        required={false}
        rows={5}
      />
      <TextAreaField
        defaultValue={listText(site.marqueeItems)}
        label="Scrolling ticker items"
        name="marqueeItems"
        required={false}
        rows={5}
      />
    </section>
  );
}

function StrategyEditor({
  index,
  strategy,
}: {
  index: number;
  strategy: Strategy;
}) {
  const prefix = `strategy_${index}`;

  return (
    <article className="riso-panel grid gap-5 p-4 sm:p-5">
      <input name="strategyIndex" type="hidden" value={index} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">{strategy.title}</h3>
          <p className="mt-1 text-sm text-[#4a463c]">{strategy.id}</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            className="size-4 accent-[#8f3f35]"
            name={`${prefix}_delete`}
            type="checkbox"
          />
          Delete
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField defaultValue={strategy.id} label="ID" name={`${prefix}_id`} />
        <TextField
          defaultValue={strategy.title}
          label="Title"
          name={`${prefix}_title`}
        />
      </div>
      <TextAreaField
        defaultValue={strategy.subtitle}
        label="Subtitle"
        name={`${prefix}_subtitle`}
        rows={3}
      />
      <TextAreaField
        defaultValue={strategy.body}
        label="Body"
        name={`${prefix}_body`}
        rows={7}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <TextAreaField
          defaultValue={listText(strategy.tags)}
          label="Tags"
          name={`${prefix}_tags`}
          rows={4}
        />
        <TextAreaField
          defaultValue={listText(strategy.pairedWithIds)}
          label="Paired strategy IDs"
          name={`${prefix}_pairedWithIds`}
          required={false}
          rows={4}
        />
      </div>
      <TextAreaField
        defaultValue={resourceLinksText(strategy.assets)}
        label="Assets"
        name={`${prefix}_assets`}
        required={false}
        rows={4}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <TextAreaField
          defaultValue={resourceLinksText(strategy.youtubeLinks)}
          label="YouTube links"
          name={`${prefix}_youtubeLinks`}
          required={false}
          rows={4}
        />
        <TextAreaField
          defaultValue={listText(strategy.imageUrls)}
          label="Image URLs"
          name={`${prefix}_imageUrls`}
          required={false}
          rows={4}
        />
        <TextAreaField
          defaultValue={listText(strategy.audioFileUrls)}
          label="Audio URLs"
          name={`${prefix}_audioFileUrls`}
          required={false}
          rows={4}
        />
      </div>
    </article>
  );
}

function NewStrategyEditor() {
  return (
    <section className="riso-panel grid gap-5 p-4 sm:p-5">
      <div>
        <h2 className="text-xl font-semibold">New Strategy</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="ID" name="new_id" required={false} />
        <TextField label="Title" name="new_title" required={false} />
      </div>
      <TextAreaField
        label="Subtitle"
        name="new_subtitle"
        required={false}
        rows={3}
      />
      <TextAreaField label="Body" name="new_body" required={false} rows={7} />
      <div className="grid gap-4 md:grid-cols-2">
        <TextAreaField label="Tags" name="new_tags" required={false} rows={4} />
        <TextAreaField
          label="Paired strategy IDs"
          name="new_pairedWithIds"
          required={false}
          rows={4}
        />
      </div>
      <TextAreaField
        label="Assets"
        name="new_assets"
        required={false}
        rows={4}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <TextAreaField
          label="YouTube links"
          name="new_youtubeLinks"
          required={false}
          rows={4}
        />
        <TextAreaField
          label="Image URLs"
          name="new_imageUrls"
          required={false}
          rows={4}
        />
        <TextAreaField
          label="Audio URLs"
          name="new_audioFileUrls"
          required={false}
          rows={4}
        />
      </div>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="riso-app min-h-screen bg-[#f2ede1] text-[#22201b]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
        {children}
      </div>
    </main>
  );
}

function StatusBanner({ text }: { text: string }) {
  if (!text) {
    return null;
  }

  return (
    <p className="border border-[#c8c0ae] bg-[#f8f4ea] px-3 py-2 text-sm font-medium">
      {text}
    </p>
  );
}

function LoginPage({ status }: { status: string }) {
  return (
    <Shell>
      <section className="riso-panel mx-auto grid w-full max-w-lg gap-5 p-5">
        <div>
          <h1 className="text-2xl font-semibold">Content editor</h1>
          <p className="mt-2 text-sm leading-6 text-[#4a463c]">/be</p>
        </div>
        <StatusBanner text={status} />
        {hasAdminPassword() ? (
          <form action={loginToEditor} className="grid gap-4">
            <TextField label="Password" name="password" type="password" />
            <button
              className="riso-button"
              type="submit"
            >
              Sign in
            </button>
          </form>
        ) : (
          <p className="border border-[#8f3f35] bg-white px-3 py-2 text-sm leading-6">
            Set {ADMIN_PASSWORD_ENV} in Vercel before using this page.
          </p>
        )}
      </section>
    </Shell>
  );
}

function EditorPage({ site, status }: { site: SiteData; status: string }) {
  return (
    <Shell>
      <header className="flex flex-col gap-4 border-b border-[#22201b] pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-[#4a463c]">/be</p>
          <h1 className="mt-2 text-3xl font-semibold">Content editor</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="riso-button"
            href="/"
          >
            Open site
          </Link>
          <form action={logoutOfEditor}>
            <button
              className="riso-button"
              type="submit"
            >
              Log out
            </button>
          </form>
        </div>
      </header>

      <StatusBanner text={status} />

      <form action={saveSiteContent} className="grid gap-6">
        <PageLinksEditor site={site} />

        <section className="grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold">Strategies</h2>
            <p className="text-sm text-[#4a463c]">
              {site.strategies.length} total
            </p>
          </div>
          <div className="grid gap-4">
            {site.strategies.map((strategy, index) => (
              <StrategyEditor
                index={index}
                key={strategy.id}
                strategy={strategy}
              />
            ))}
          </div>
        </section>

        <NewStrategyEditor />

        <div className="sticky bottom-0 border-t border-[#22201b] bg-[#f2ede1] py-4">
          <button
            className="riso-button riso-button-primary w-full sm:w-auto"
            type="submit"
          >
            Save JSON
          </button>
        </div>
      </form>
    </Shell>
  );
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  await connection();

  const params = (await searchParams) ?? {};
  const status = statusText(
    firstParam(params.status),
    firstParam(params.message),
  );

  if (!(await isAdminAuthenticated())) {
    return <LoginPage status={status} />;
  }

  const site = await readSiteData();

  return <EditorPage site={site} status={status} />;
}
