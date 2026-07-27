// Place any global data in this file.
// You can import this data from anywhere in your site by using the `import` keyword.

export const SITE_TITLE = 'Knowledge Base';
export const SITE_URL = 'https://nimesh-nakum.security';
export const SITE_DESCRIPTION =
	'A collection of research, technical articles, and educational series covering Windows Internals, Active Directory, Windows Security, Web Security, and Red Team methodologies.';

export const AUTHOR = {
	name: 'Nimesh Nakum',
	bio: 'Security Researcher & Offensive Security Engineer focused on Windows Internals, Active Directory security, and Red Team operations.',
	github: '',
	linkedin: '',
	medium: '',
	twitter: '',
	email: '',
};

export const NAV_ITEMS = [
	{ label: 'Home', href: '/' },
	{ label: 'Research', href: '/research/' },
	{ label: 'Documentation', href: '/windows-internals/' },
	{ label: 'Projects', href: '/projects/' },
	{ label: 'Writeups', href: '/writeups/' },
	{ label: 'About', href: '/about/' },
];

export const COLLECTIONS_META: Record<
	string,
	{ name: string; description: string; color: string }
> = {
	'windows-internals': {
		name: 'Windows Internals',
		description: 'Deep dive into Windows architecture, processes, threads, memory management, and kernel internals.',
		color: '#3B82F6',
	},
	'active-directory': {
		name: 'Active Directory',
		description: 'Comprehensive coverage of Active Directory internals, authentication protocols, attack vectors, and defense strategies.',
		color: '#8B5CF6',
	},
	'windows-security': {
		name: 'Windows Security',
		description: 'Windows security mechanisms, access control, privilege escalation, and endpoint hardening.',
		color: '#22C55E',
	},
	'web-security': {
		name: 'Web Security',
		description: 'Web application vulnerabilities, bug bounty writeups, and exploitation techniques.',
		color: '#10B981',
	},
	'projects': {
		name: 'Projects',
		description: 'Custom security tools, frameworks, and research projects.',
		color: '#F59E0B',
	},
	'malware-development': {
		name: 'Malware Development',
		description: 'Techniques for malware development, evasion, persistence, and C2 communication.',
		color: '#EF4444',
	},
	'research': {
		name: 'Research',
		description: 'Standalone research articles on offensive security topics, vulnerability analysis, and technique development.',
		color: '#A855F7',
	},
	'writeups': {
		name: 'Writeups',
		description: 'CTF challenges, HackTheBox, TryHackMe, and real-world vulnerability writeups.',
		color: '#10B981',
	},
	'projects': {
		name: 'Projects',
		description: 'Custom security tools, frameworks, and research projects.',
		color: '#6366F1',
	}
};

/** Utility: calculate reading time from raw markdown text */
export function getReadingTime(text: string): string {
	const wordsPerMinute = 200;
	const words = text.split(/\s+/).length;
	const minutes = Math.ceil(words / wordsPerMinute);
	return `${minutes} min read`;
}
