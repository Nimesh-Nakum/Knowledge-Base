import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const docSchema = z.object({
	title: z.string(),
	description: z.string(),
	pubDate: z.coerce.date(),
	updatedDate: z.coerce.date().optional(),
	series: z.string().optional(),
	part: z.number().optional(),
	order: z.number().default(1),
	tags: z.array(z.string()).default([]),
	author: z.string().default('Nimesh Nakum'),
	difficulty: z.enum(['beginner', 'easy', 'intermediate', 'medium', 'advanced', 'hard', 'insane']).default('intermediate'),
	draft: z.boolean().default(false),
	noindex: z.boolean().default(false),
	readingTime: z.string().optional(),
	slug: z.string().optional()
});

const windowsInternals = defineCollection({
	loader: glob({ base: './src/content/windows-internals', pattern: '**/*.{md,mdx}' }),
	schema: docSchema,
});

const activeDirectory = defineCollection({
	loader: glob({ base: './src/content/active-directory', pattern: '**/*.{md,mdx}' }),
	schema: docSchema,
});

const windowsSecurity = defineCollection({
	loader: glob({ base: './src/content/windows-security', pattern: '**/*.{md,mdx}' }),
	schema: docSchema,
});

const webSecurity = defineCollection({
	loader: glob({ base: './src/content/web-security', pattern: '**/*.{md,mdx}' }),
	schema: docSchema,
});

const malwareDevelopment = defineCollection({
	loader: glob({ base: './src/content/malware-development', pattern: '**/*.{md,mdx}' }),
	schema: docSchema,
});

const research = defineCollection({
	loader: glob({ base: './src/content/research', pattern: '**/*.{md,mdx}' }),
	schema: docSchema,
});

const writeups = defineCollection({
	loader: glob({ base: './src/content/writeups', pattern: '**/*.{md,mdx}' }),
	schema: docSchema,
});

const projects = defineCollection({
	loader: glob({ base: './src/content/projects', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.coerce.date(),
		tags: z.array(z.string()).default([]),
		github: z.string().default(''),
		docs: z.string().default(''),
		status: z.enum(['active', 'completed', 'archived']).default('active'),
		technologies: z.array(z.string()).default([]),
		draft: z.boolean().default(false),
		noindex: z.boolean().default(false),
	}),
});

export const collections = {
	'windows-internals': windowsInternals,
	'active-directory': activeDirectory,
	'windows-security': windowsSecurity,
	'web-security': webSecurity,
	'malware-development': malwareDevelopment,
	research,
	writeups,
	projects,
};
