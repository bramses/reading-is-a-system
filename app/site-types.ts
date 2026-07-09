export type ResourceLink = {
  label: string;
  url: string;
};

export type Strategy = {
  id: string;
  title: string;
  subtitle: string;
  tags: string[];
  pairedWithIds: string[];
  body: string;
  assets: ResourceLink[];
  youtubeLinks: ResourceLink[];
  imageUrls: string[];
  audioFileUrls: string[];
};

export type SiteData = {
  title: string;
  subtitle: string;
  links: {
    newsletter: string;
    slides: string;
    github: string;
    schedule: string;
    bookClub: string;
    kofi: string;
  };
  tags: string[];
  starterPackStrategyIds: string[];
  readingJournalYoutubeUrls: string[];
  marqueeItems: string[];
  strategies: Strategy[];
};
