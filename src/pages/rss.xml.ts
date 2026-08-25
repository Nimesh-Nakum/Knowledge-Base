import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';

export async function GET(context: any) {
	const collections = [
		'windows-internals',
		'active-directory',
		'windows-security',
		'web-security',
		'malware-development',
		'research',
		'writeups',
		'projects',
	];

	let allPosts: any[] = [];
	for (const col of collections) {
		try {
			const items = await getCollection(col as any);
			const filtered = items.filter((p: any) => !p.data.draft && !p.data.noindex);
			allPosts.push(
				...filtered.map((post: any) => ({
					title: post.data.title,
					description: post.data.description,
					pubDate: post.data.pubDate,
					link: `/${col}/${post.id.split('/').pop()}/`,
				}))
			);
		} catch (e) {}
	}

	allPosts.sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());

	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		items: allPosts,
	});
}
