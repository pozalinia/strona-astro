import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Identyfikator = nazwa pliku (slug z Publii), bez dodatkowego przetwarzania
const fileId = ({ entry }: { entry: string }) => entry.replace(/\.(md|json)$/, '');

const image = z.object({
  src: z.string(),
  alt: z.string().default(''),
  caption: z.string().default(''),
  credits: z.string().default(''),
  width: z.number().optional(),
  height: z.number().optional(),
});

const posts = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/posts', generateId: fileId }),
  schema: z.object({
    publiiId: z.number().optional(),
    title: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    author: z.string().default('admin'),
    template: z.enum(['default', 'poem', 'review', 'text']).default('default'),
    tags: z.array(z.string()).default([]),
    /** Tag, którego grafika jest nagłówkiem wiersza/recenzji/tekstu */
    mainTag: z.string().optional(),
    draft: z.boolean().default(false),
    /** Ma własną stronę, ale nie pojawia się na listach */
    hidden: z.boolean().default(false),
    excludeFromHomepage: z.boolean().default(false),
    featured: z.boolean().default(false),
    featuredImage: image.optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    customTitle: z.string().optional(),
    secondTextTitle: z.string().optional(),
    coauthor: z.string().optional(),
    coauthorText: z.string().optional(),
    /** Slug wpisu; pusta wartość = brak strzałki */
    prevPost: z.string().optional(),
    nextPost: z.string().optional(),
    releasePost: z.string().optional(),
    reviewPost: z.string().optional(),
    displayCustomNav: z.boolean().default(true),
    displayAuthorBio: z.boolean().default(false),
    /** html = treść przeniesiona z Publii, markdown = nowe wpisy */
    format: z.enum(['html', 'markdown']).default('markdown'),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/pages', generateId: fileId }),
  schema: z.object({
    publiiId: z.number().optional(),
    title: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    author: z.string().default('admin'),
    template: z.enum(['default', 'empty']).default('default'),
    /** Ścieżka strony nadrzędnej, np. "wydania" */
    parent: z.string().optional(),
    draft: z.boolean().default(false),
    displayAuthor: z.boolean().default(false),
    displayAuthorBio: z.boolean().default(false),
    featuredImage: image.optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    format: z.enum(['html', 'markdown']).default('markdown'),
  }),
});

const tags = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/tags', generateId: fileId }),
  schema: z.object({
    publiiId: z.number().optional(),
    name: z.string(),
    description: z.string().optional(),
    image: image.optional(),
    hidden: z.boolean().default(false),
    displayFeaturedImage: z.boolean().default(true),
    displayPostCounter: z.boolean().default(false),
    displayDescription: z.boolean().default(false),
    displayPostList: z.boolean().default(true),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
  }),
});

const authors = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/authors', generateId: fileId }),
  schema: z.object({
    publiiId: z.number().optional(),
    name: z.string(),
    description: z.string().optional(),
    website: z.string().optional(),
  }),
});

export const collections = { posts, pages, tags, authors };
