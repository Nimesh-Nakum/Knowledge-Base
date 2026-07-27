import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';

export async function GET(context: any) {
	const [allSeries, allResearch, allWriteups] = await Promise.all([
		getCollection('series').then((c) => c.filter((p) => !p.data.draft)),
		getCollection('research').then((c) => c.filter((p) => !p.data.draft)),
		getCollection('writeups').then((c) => c.filter((p) => !p.data.draft))
	]);

	const items = [
		...allSeries.map((post) => ({
			title: post.data.title,
			description: post.data.description,
			pubDate: post.data.pubDate,
			link: `/series/${post.data.series}/${post.id.split('/').pop()}/`,
		})),
		...allResearch.map((post) => ({
			title: post.data.title,
			description: post.data.description,
			pubDate: post.data.pubDate,
			link: `/research/${post.id}/`,
		})),
		...allWriteups.map((post) => ({
			title: post.data.title,
			description: post.data.description,
			pubDate: post.data.pubDate,
			link: `/writeups/${post.id}/`,
		})),
	].sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());

	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		items,
	});
}
