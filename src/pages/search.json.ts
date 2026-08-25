import { getCollection } from 'astro:content';

export async function GET() {
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

	let index: any[] = [];
	for (const col of collections) {
		try {
			const items = await getCollection(col as any);
			const filtered = items.filter((p: any) => !p.data.draft && !p.data.noindex);
			index.push(
				...filtered.map((p: any) => ({
					title: p.data.title,
					description: p.data.description,
					tags: p.data.tags,
					href: `/${col}/${p.id.split('/').pop()}/`,
					type: col,
				}))
			);
		} catch (e) {}
	}

	return new Response(JSON.stringify(index), {
		headers: { 'Content-Type': 'application/json' },
	});
}
