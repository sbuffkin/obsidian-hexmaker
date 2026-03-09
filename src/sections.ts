import { App, TFile } from "obsidian";

/** Insert a wiki-link under the named ### section, creating the section if absent. */
export async function addLinkToSection(app: App, filePath: string, section: string, linkText: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return;
	let content = await app.vault.read(file);

	const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
	const match = headingRegex.exec(content);

	if (!match) {
		content = content.trimEnd() + `\n\n### ${section}\n\n${linkText}\n`;
		await app.vault.modify(file, content);
		return;
	}

	const afterHeading = match.index + match[0].length;
	const nextHeadingMatch = /\n###? /m.exec(content.slice(afterHeading));
	const sectionEnd = nextHeadingMatch ? afterHeading + nextHeadingMatch.index : content.length;
	const sectionContent = content.slice(afterHeading, sectionEnd);

	if (sectionContent.includes(linkText)) return; // already present

	const trimmedSection = sectionContent.trimEnd();
	const insertAt = afterHeading + trimmedSection.length;
	content = content.slice(0, insertAt) + "\n\n" + linkText + content.slice(insertAt);
	await app.vault.modify(file, content);
}

/** Return all wiki-link targets found under a named ### section. */
export async function getLinksInSection(app: App, filePath: string, section: string): Promise<string[]> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return [];
	const content = await app.vault.read(file);

	const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
	const match = headingRegex.exec(content);
	if (!match) return [];

	const afterHeading = match.index + match[0].length;
	const nextHeadingMatch = /\n###? /m.exec(content.slice(afterHeading));
	const sectionEnd = nextHeadingMatch ? afterHeading + nextHeadingMatch.index : content.length;
	const sectionContent = content.slice(afterHeading, sectionEnd);

	const links: string[] = [];
	const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
	let m;
	while ((m = linkRegex.exec(sectionContent)) !== null) {
		links.push(m[1]);
	}
	return links;
}

/** Return the plain text body of a named ### section (stops at next heading or ---). */
export async function getSectionContent(app: App, filePath: string, section: string): Promise<string> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return "";
	const content = await app.vault.read(file);

	const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
	const match = headingRegex.exec(content);
	if (!match) return "";

	const afterHeading = match.index + match[0].length;
	const nextBoundary = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
	const sectionEnd = nextBoundary ? afterHeading + nextBoundary.index : content.length;
	return content.slice(afterHeading, sectionEnd).trim();
}

/** Read a file once and return all text and link section content in a single pass. */
export async function getAllSectionData(
	app: App,
	filePath: string,
): Promise<{ text: Map<string, string>; links: Map<string, string[]> }> {
	const text  = new Map<string, string>();
	const links = new Map<string, string[]>();
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return { text, links };
	const content = await app.vault.read(file);

	// Find every ### heading and capture the body up to the next boundary
	const headingRegex = /^###\s+(.+?)\s*$/gm;
	const boundaryRegex = /\n(?:#{1,6} |-{3,})/m;
	const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
	let m: RegExpExecArray | null;
	while ((m = headingRegex.exec(content)) !== null) {
		const name = m[1].toLowerCase();
		const afterHeading = m.index + m[0].length;
		const nextBoundary = boundaryRegex.exec(content.slice(afterHeading));
		const sectionEnd = nextBoundary ? afterHeading + nextBoundary.index : content.length;
		const body = content.slice(afterHeading, sectionEnd);

		// Collect wiki-links
		const sectionLinks: string[] = [];
		let lm: RegExpExecArray | null;
		const lr = new RegExp(linkRegex.source, "g");
		while ((lm = lr.exec(body)) !== null) sectionLinks.push(lm[1]);

		links.set(name, sectionLinks);
		text.set(name, body.trim());
	}
	return { text, links };
}

/** Replace the body of a named ### section in-place. */
export async function setSectionContent(app: App, filePath: string, section: string, newText: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return;
	let content = await app.vault.read(file);

	const headingRegex = new RegExp(`^###\\s+${section}\\s*$`, "mi");
	const match = headingRegex.exec(content);
	if (!match) return;

	const afterHeading = match.index + match[0].length;
	const nextBoundary = /\n(?:#{1,6} |-{3,})/m.exec(content.slice(afterHeading));
	const sectionEnd = nextBoundary ? afterHeading + nextBoundary.index : content.length;

	const replacement = newText.trim() ? `\n\n${newText.trim()}\n` : "\n";
	await app.vault.modify(file, content.slice(0, afterHeading) + replacement + content.slice(sectionEnd));
}
