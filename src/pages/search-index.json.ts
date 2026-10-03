// Indeks wyszukiwarki (/szukaj/): widoczne wpisy i strony z pełnym tekstem
import type { APIRoute } from 'astro';
import { plainText } from '../lib/content';
import { getLookups, getPages, isListed, pageUrl, postUrl } from '../lib/site';

export const GET: APIRoute = async () => {
  const { posts, tagBySlug, authorBySlug } = await getLookups();
  const authorName = (slug?: string) => (slug && slug !== 'admin' ? authorBySlug.get(slug)?.data.name : undefined);

  const entries = [
    ...posts.filter(isListed).map((post) => ({
      url: postUrl(post.id),
      title: post.data.title + (post.data.note ? ` [${post.data.note}]` : ''),
      authors: [authorName(post.data.author), authorName(post.data.coauthor)].filter(Boolean).join(', '),
      tags: post.data.tags.map((tag) => tagBySlug.get(tag)?.data.name ?? '').filter(Boolean).join(', '),
      text: plainText(post.body ?? ''),
    })),
    ...(await getPages()).map((page) => ({
      url: pageUrl(page),
      title: page.data.title,
      authors: '',
      tags: '',
      text: plainText(page.body ?? ''),
    })),
  ];

  return new Response(JSON.stringify(entries), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
