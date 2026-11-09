import { markdown } from '#lib/changelog.js';

export const prerender = true;
export const GET = () => new Response(markdown(), { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
