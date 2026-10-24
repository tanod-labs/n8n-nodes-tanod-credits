/** Operation schemas follow https://tanod.dev/openapi.json. See https://tanod.dev/pricing for current prices. */
export interface OpDef {
	resource: 'document' | 'web' | 'audio' | 'text' | 'utility';
	value: string;
	name: string;
	description: string;
	action: string;
	path: string;
	/** how a file/URL input is accepted */
	input: 'file-or-url' | 'url' | 'none';
	/** JSON field name carrying the base64 file, when input is file-or-url */
	fileField?: string;
	/** the reply carries a base64 `file` that becomes n8n binary data */
	returnsFile?: boolean;
}

export const OPS: OpDef[] = [
	{
		resource: 'document', value: 'toMarkdown', name: 'Document to Markdown', action: 'Convert document to Markdown',
		description: 'PDF, DOCX, XLSX, PPTX, EPUB, HTML or CSV to Markdown',
		path: '/v1/docs/to-markdown', input: 'file-or-url', fileField: 'file_base64',
	},
	{
		resource: 'document', value: 'pdfTables', name: 'PDF Tables', action: 'Extract PDF tables',
		description: 'Extract tables from a text PDF as JSON, CSV or XLSX',
		path: '/v1/pdf/tables', input: 'file-or-url', fileField: 'file_base64',
	},
	{
		resource: 'document', value: 'ocrImage', name: 'OCR Image', action: 'Extract text from image',
		description: 'Extract text from image URL with Tesseract',
		path: '/v1/ocr', input: 'url',
	},
	{
		resource: 'document', value: 'pdfToWord', name: 'PDF to Word', action: 'Convert PDF to Word',
		description: 'Convert a PDF to a .docx file',
		path: '/v1/pdf/to-docx', input: 'file-or-url', fileField: 'pdf_base64', returnsFile: true,
	},
	{
		resource: 'document', value: 'officeToPdf', name: 'Office to PDF', action: 'Convert office document to PDF',
		description: 'Convert DOCX, XLSX, PPTX, ODT, RTF or text to PDF',
		path: '/v1/docs/to-pdf', input: 'file-or-url', fileField: 'file_base64', returnsFile: true,
	},
	{
		resource: 'web', value: 'pageToMarkdown', name: 'Page to Markdown', action: 'Convert web page to Markdown',
		description: 'Fetch a web page as clean Markdown',
		path: '/v1/render', input: 'url',
	},
	{
		resource: 'web', value: 'screenshot', name: 'Website Screenshot', action: 'Capture website screenshot',
		description: 'Capture a web page as a PNG or JPEG image',
		path: '/v1/web/screenshot', input: 'url', returnsFile: true,
	},
	{
		resource: 'audio', value: 'speechToText', name: 'Speech to Text', action: 'Transcribe speech to text',
		description: 'Transcribe an audio file, with SRT and WebVTT subtitles',
		path: '/v1/audio/transcribe', input: 'file-or-url', fileField: 'file_base64',
	},
	{
		resource: 'text', value: 'translate', name: 'Translate', action: 'Translate text',
		description: 'Translate text between supported languages',
		path: '/v1/text/translate', input: 'none',
	},
	{
		resource: 'utility', value: 'verifyEmail', name: 'Verify Email Address', action: 'Verify email address',
		description: 'Check an email address by syntax and DNS (MX), no mailbox probe',
		path: '/v1/email/verify', input: 'none',
	},
];
