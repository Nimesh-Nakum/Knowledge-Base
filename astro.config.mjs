// @ts-check

import sitemap from '@astrojs/sitemap';
import expressiveCode from 'astro-expressive-code';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://knowledge-base-cs7.pages.dev',
	integrations: [
		expressiveCode({
			themes: ['github-dark'],
			styleOverrides: {
				borderColor: '#222222',
				borderRadius: '0px',
				codeFontFamily: 'var(--font-code)',
				codeFontSize: '0.875rem',
				codeLineHeight: '1.7',
				codePaddingBlock: '1rem',
				codePaddingInline: '1.25rem',
				frames: {
					frameBoxShadowCssValue: 'none',
					editorActiveTabBackground: '#0a0a0a',
					editorBackground: '#000000',
					editorTabBarBackground: '#000000',
					editorTabBarBorderBottomColor: '#222222',
					terminalBackground: '#050505',
					terminalTitlebarBackground: '#050505',
					terminalTitlebarBorderBottomColor: '#222222',
				},
			},
		}),
		sitemap(),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: 'Inter',
			cssVariable: '--font-body',
			fallbacks: ['system-ui', 'sans-serif'],
		},

		{
			provider: fontProviders.google(),
			name: 'JetBrains Mono',
			cssVariable: '--font-code',
			fallbacks: ['monospace'],
		},
	],
});
