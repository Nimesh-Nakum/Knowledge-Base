import { getCollection } from 'astro:content';

export async function GET() {
	const [allSeries, allResearch, allWriteups, allProjects] = await Promise.all([
		getCollection('series').then((c) => c.filter((p) => !p.data.draft)),
		getCollection('research').then((c) => c.filter((p) => !p.data.draft)),
		getCollection('writeups').then((c) => c.filter((p) => !p.data.draft)),
		getCollection('projects').then((c) => c.filter((p) => !p.data.draft))
	]);

	const index = [
		...allSeries.map((p) => ({
			title: p.data.title,
			description: p.data.description,
			tags: p.data.tags,
			href: `/series/${p.data.series}/${p.id.split('/').pop()}/`,
			type: 'Series',
		})),
		...allResearch.map((p) => ({
			title: p.data.title,
			description: p.data.description,
			tags: p.data.tags,
			href: `/research/${p.id}/`,
			type: 'Research',
		})),
		...allWriteups.map((p) => ({
			title: p.data.title,
			description: p.data.description,
			tags: p.data.tags,
			href: `/writeups/${p.id}/`,
			type: 'Writeup',
		})),
		...allProjects.map((p) => ({
			title: p.data.title,
			description: p.data.description,
			tags: p.data.tags,
			href: `/projects/${p.id}/`,
			type: 'Project',
		})),
	];

	return new Response(JSON.stringify(index), {
		headers: { 'Content-Type': 'application/json' },
	});
}
