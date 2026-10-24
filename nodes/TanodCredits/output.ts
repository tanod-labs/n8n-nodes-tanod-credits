import type { IDataObject } from 'n8n-workflow';

export function outputFieldLabel(field: string): string {
	return field.split('_').map((word) => {
		if (['url', 'mx', 'srt', 'vtt'].includes(word)) return word.toUpperCase();
		return word.charAt(0).toUpperCase() + word.slice(1);
	}).join(' ');
}

const COMMON = ['operation', 'untrusted_content'];
export const FIELDS: Record<string, string[]> = {
	toMarkdown: ['markdown', 'format', 'pages', 'characters', 'size', 'truncated', 'title', 'note'],
	pdfTables: ['tables', 'table_count', 'format', 'pages_processed', 'file', 'files', 'warnings', 'size'],
	ocrImage: ['text', 'confidence_mean', 'words', 'lang', 'width', 'height', 'truncated', 'url'],
	pdfToWord: ['file', 'input_pages', 'converted_pages', 'pages_without_text', 'warnings', 'fidelity_note', 'output_bytes'],
	officeToPdf: ['file', 'format', 'pages', 'active_content_removed', 'fidelity_note', 'output_bytes'],
	pageToMarkdown: ['markdown', 'title', 'url', 'final_url', 'status', 'truncated', 'format'],
	screenshot: ['file', 'url', 'format', 'width', 'height', 'full_page', 'height_capped', 'output_bytes'],
	speechToText: ['text', 'language', 'duration', 'segments', 'srt', 'vtt', 'truncated', 'translated_to_english'],
	translate: ['text', 'source_lang', 'target_lang', 'detected', 'chars', 'engine'],
	verifyEmail: ['email', 'verdict', 'reasons', 'syntax_valid', 'domain', 'has_mx', 'smtp_checked', 'notes'],
};

export const OUTPUT_FIELDS = [...new Set([
	...COMMON, ...Object.values(FIELDS).flat(), 'input_bytes', 'input_pages', 'output_bytes',
	'columns_detected', 'sheets', 'slides', 'pages_failed', 'file_count', 'pages_without_text',
	'language_probability', 'text_language', 'model', 'speakers', 'chapters', 'chapters_info',
	'final_url', 'dark_mode', 'local_part', 'mx_hosts', 'null_mx', 'implicit_mx', 'disposable',
	'role_account', 'free_provider', 'warnings',
])].sort((a, b) => outputFieldLabel(a).localeCompare(outputFieldLabel(b)));

/** Only project top-level response fields; returned content remains untrusted. */
export function selectOutput(json: IDataObject, operation: string, mode: string, selected: string[]): IDataObject {
	if (mode === 'raw') return json;
	const fields = mode === 'selected'
		? [...COMMON, ...selected.filter((field) => OUTPUT_FIELDS.includes(field))]
		: [...COMMON, ...(FIELDS[operation] || [])];
	return Object.fromEntries([...new Set(fields)]
		.filter((field) => Object.prototype.hasOwnProperty.call(json, field))
		.map((field) => [field, json[field]]));
}
