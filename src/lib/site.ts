import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;
export type Page = CollectionEntry<'pages'>;
export type Tag = CollectionEntry<'tags'>;
export type Author = CollectionEntry<'authors'>;

export const SITE = {
  name: 'POZa Linią',
  logo: { src: '/media/website/logo_light.png', width: 500, height: 500 },
  favicon: '/media/website/favicon.ico',
  /** Publii: „Tags posts per page” */
  tagPostsPerPage: 5,
};

export const postUrl = (slug: string) => `/post/${slug}/`;
export const tagUrl = (slug: string) => `/post/tags/${slug}/`;
export const authorUrl = (slug: string) => `/post/authors/${slug}/`;
export const pageUrl = (page: Page) => `/${page.data.parent ? `${page.data.parent}/` : ''}${page.id}/`;

/** Wpis ukryty ma własną stronę, ale nie pojawia się na listach (tagi, osoby autorskie, strona główna). */
export const isListed = (post: Post) => !post.data.hidden;
export const isOnHomepage = (post: Post) => isListed(post) && !post.data.excludeFromHomepage;

/** Widoczne wpisy z danym tagiem (strona tagu powstaje tylko, gdy są jakieś). */
export const postsWithTag = (posts: Post[], tag: string) =>
  posts.filter((post) => isListed(post) && post.data.tags.includes(tag));

const newestFirst = (a: Post, b: Post) =>
  b.data.date.getTime() - a.data.date.getTime() || (b.data.publiiId ?? 0) - (a.data.publiiId ?? 0);

export async function getPosts() {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  return posts.sort(newestFirst);
}

export async function getPages() {
  return getCollection('pages', ({ data }) => !data.draft);
}

export async function getLookups() {
  const [posts, tags, authors] = await Promise.all([getPosts(), getCollection('tags'), getCollection('authors')]);
  return {
    posts,
    tags,
    authors,
    postBySlug: new Map(posts.map((post) => [post.id, post])),
    postByPubliiId: new Map(
      posts.flatMap((post) => (post.data.publiiId === undefined ? [] : [[post.data.publiiId, post] as const])),
    ),
    tagBySlug: new Map(tags.map((tag) => [tag.id, tag])),
    authorBySlug: new Map(authors.map((author) => [author.id, author])),
  };
}

export type Lookups = Awaited<ReturnType<typeof getLookups>>;
