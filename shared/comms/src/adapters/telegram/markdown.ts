/**
 * Markdown to Telegram-compatible HTML converter.
 *
 * Telegram supports a limited subset of HTML:
 * - <b>, <strong> - bold
 * - <i>, <em> - italic
 * - <u> - underline
 * - <s>, <strike>, <del> - strikethrough
 * - <code> - inline code
 * - <pre> - code block
 * - <a href="..."> - links
 * - <blockquote> - block quotes
 *
 * This module converts standard markdown to Telegram-compatible HTML.
 */

import { marked } from 'marked';

/**
 * Tags supported by Telegram's HTML parser.
 */
const SUPPORTED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'pre', 'a', 'blockquote']);

/**
 * Tags that should be unwrapped (content kept, tag removed).
 */
const UNWRAP_TAGS = new Set(['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li']);

/**
 * Tags that should be completely removed (including content).
 */
const REMOVE_TAGS = new Set(['script', 'style', 'img', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);

/**
 * Process HTML to keep only Telegram-supported tags.
 */
function sanitizeForTelegram(html: string): string {
	// Process opening tags with attributes
	let result = html.replace(/<(\w+)(\s[^>]*)?>|<\/(\w+)>/g, (_match, openTag, attrs, closeTag) => {
		const tag = (openTag || closeTag).toLowerCase();

		// Supported tags - keep as-is (but normalize tag name)
		if (SUPPORTED_TAGS.has(tag)) {
			if (closeTag) {
				return `</${tag}>`;
			}
			// For <a> tags, preserve href attribute
			if (tag === 'a' && attrs) {
				const hrefMatch = attrs.match(/href\s*=\s*["']([^"']*)["']/i);
				if (hrefMatch) {
					return `<a href="${hrefMatch[1]}">`;
				}
			}
			return `<${tag}>`;
		}

		// Unwrap tags - remove tag but keep content
		if (UNWRAP_TAGS.has(tag)) {
			// Paragraphs get blank line after
			if (tag === 'p') {
				return closeTag ? '\n\n' : '';
			}
			// Headings get blank line after
			if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
				return closeTag ? '\n\n' : '';
			}
			// List items get bullet point
			if (tag === 'li') {
				return closeTag ? '\n' : '\u2022 ';
			}
			// Lists get blank line after
			if (tag === 'ul' || tag === 'ol') {
				return closeTag ? '\n' : '';
			}
			return '';
		}

		// Remove tags completely - handled separately
		if (REMOVE_TAGS.has(tag)) {
			return '';
		}

		// Unknown tags - unwrap by default
		return '';
	});

	// Clean up extra whitespace
	result = result
		.replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
		.replace(/^\s+|\s+$/g, ''); // Trim

	return result;
}

/**
 * Convert markdown text to Telegram-compatible HTML.
 *
 * @param markdown - The markdown text to convert
 * @returns HTML string safe for Telegram's parse_mode: 'HTML'
 */
export function markdownToTelegramHtml(markdown: string): string {
	// Configure marked for synchronous parsing
	marked.setOptions({
		async: false,
		gfm: true, // GitHub Flavored Markdown
		breaks: false, // Don't convert \n to <br>
	});

	// Parse markdown to HTML
	const html = marked.parse(markdown) as string;

	// Sanitize to Telegram-compatible HTML
	return sanitizeForTelegram(html);
}
