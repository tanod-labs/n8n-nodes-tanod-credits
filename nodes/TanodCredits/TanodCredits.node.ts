import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { OPS, type OpDef } from './operations';
import { tanodCreditRequest } from './creditsTransport';
import { OUTPUT_FIELDS, outputFieldLabel, selectOutput } from './output';

const RESOURCES = [
	{ name: 'Document', value: 'document' },
	{ name: 'Web', value: 'web' },
	{ name: 'Audio', value: 'audio' },
	{ name: 'Text', value: 'text' },
	{ name: 'Utility', value: 'utility' },
].sort((a, b) => a.name.localeCompare(b.name));

const show = (resource: string, ...ops: string[]) => ({
	show: { resource: [resource], ...(ops.length ? { operation: ops } : {}) },
});

const opProps: INodeProperties[] = RESOURCES.map((r) => ({
	displayName: 'Operation',
	name: 'operation',
	type: 'options' as const,
	noDataExpression: true,
	displayOptions: { show: { resource: [r.value] } },
	options: OPS.filter((o) => o.resource === r.value).sort((a, b) => a.name.localeCompare(b.name)).map((o) => ({
		name: o.name,
		value: o.value,
		description: o.description,
		action: o.action,
	})),
	default: OPS.find((o) => o.resource === r.value)!.value,
}));

const fileOps = OPS.filter((o) => o.input === 'file-or-url').map((o) => o.value);
const urlOps = OPS.filter((o) => o.input === 'url').map((o) => o.value);

export class TanodCredits implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tanod Credits',
		name: 'tanodCredits',
		icon: { light: 'file:tanod.svg', dark: 'file:tanod.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Document, web, audio, text and email tools paid with a Tanod prepaid credit key',
		defaults: { name: 'Tanod Credits' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'tanodCreditsOnlyApi', required: true }],
		properties: [
			{
				displayName: 'Each input item is one paid call; the key balance is the only spending limit. Do not enable Retry On Fail on paid calls.',
				name: 'spendNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: RESOURCES,
				default: 'document',
			},
			...opProps,

			// ---- file or URL input
			{
				displayName: 'Input Source',
				name: 'inputSource',
				type: 'options',
				displayOptions: { show: { operation: fileOps } },
				options: [
					{ name: 'Binary Data', value: 'binary' },
					{ name: 'URL', value: 'url' },
				],
				default: 'binary',
				description: 'Where the file comes from',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				displayOptions: { show: { operation: fileOps, inputSource: ['binary'] } },
				description: 'Name of the binary property that holds the file',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. https://example.com/file',
				displayOptions: { show: { operation: fileOps, inputSource: ['url'] } },
				description: 'Public http(s) URL',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. https://example.com',
				displayOptions: { show: { operation: urlOps } },
				description: 'Public http(s) URL',
			},

			// ---- operation specific options
			{
				displayName: 'Pages',
				name: 'pages',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1-5,9',
				displayOptions: show('document', 'pdfTables', 'pdfToWord'),
				description: 'Pages to process (N, N-M, N-, -M, last; comma-separated). Empty means all.',
			},
			{
				displayName: 'Output Format',
				name: 'tablesFormat',
				type: 'options',
				options: [
					{ name: 'CSV (Binary)', value: 'csv' },
					{ name: 'JSON', value: 'json' },
					{ name: 'XLSX (Binary)', value: 'xlsx' },
				],
				default: 'json',
				displayOptions: show('document', 'pdfTables'),
			},
			{
				displayName: 'Language',
				name: 'ocrLang',
				type: 'string',
				default: 'eng',
				displayOptions: show('document', 'ocrImage'),
				description: 'Tesseract language code (only eng is installed)',
			},
			{
				displayName: 'Run JavaScript',
				name: 'js',
				type: 'boolean',
				default: false,
				displayOptions: show('web', 'pageToMarkdown'),
				description:
					'Whether to render the page in a headless browser first. This uses the browser-render price; see https://tanod.dev/pricing.',
			},
			{
				displayName: 'Image Format',
				name: 'shotFormat',
				type: 'options',
				options: [
					{ name: 'PNG', value: 'png' },
					{ name: 'JPEG', value: 'jpeg' },
				],
				default: 'png',
				displayOptions: show('web', 'screenshot'),
			},
			{
				displayName: 'Width',
				name: 'width',
				type: 'number',
				typeOptions: { minValue: 320, maxValue: 1920 },
				default: 1280,
				displayOptions: show('web', 'screenshot'),
			},
			{
				displayName: 'Height',
				name: 'height',
				type: 'number',
				typeOptions: { minValue: 200, maxValue: 1600 },
				default: 800,
				displayOptions: show('web', 'screenshot'),
			},
			{
				displayName: 'Full Page',
				name: 'fullPage',
				type: 'boolean',
				default: false,
				displayOptions: show('web', 'screenshot'),
			},
			{
				displayName: 'Spoken Language',
				name: 'language',
				type: 'string',
				default: '',
				placeholder: 'e.g. en',
				displayOptions: show('audio', 'speechToText'),
				description: 'ISO 639-1 code. Empty means detect automatically.',
			},
			{
				displayName: 'Translate to English',
				name: 'translateToEnglish',
				type: 'boolean',
				default: false,
				displayOptions: show('audio', 'speechToText'),
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: show('text', 'translate'),
				description: 'Text to translate',
			},
			{
				displayName: 'Target Language',
				name: 'target',
				type: 'string',
				default: 'es',
				required: true,
				displayOptions: show('text', 'translate'),
				description: 'Target language code, for example es or fr',
			},
			{
				displayName: 'Source Language',
				name: 'source',
				type: 'string',
				default: '',
				displayOptions: show('text', 'translate'),
				description: 'Empty means detect automatically',
			},
			{
				displayName: 'Email Address',
				name: 'email',
				type: 'string',
				placeholder: 'e.g. name@example.com',
				default: '',
				required: true,
				displayOptions: show('utility', 'verifyEmail'),
			},

			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				displayOptions: { show: { '@tool': [false] } },
				description: 'Whether to return a simplified version of the response instead of the raw data',
			},
			{
				displayName: 'Output',
				name: 'outputMode',
				type: 'options',
				noDataExpression: true,
				default: 'simplified',
				displayOptions: { show: { '@tool': [true] } },
				options: [
					{ name: 'Raw', value: 'raw' },
					{ name: 'Selected Fields', value: 'selected' },
					{ name: 'Simplified', value: 'simplified' },
				],
				description: 'Choose the response fields returned to the AI agent',
			},
			{
				displayName: 'Fields',
				name: 'outputFields',
				type: 'multiOptions',
				default: [],
				displayOptions: { show: { '@tool': [true], outputMode: ['selected'] } },
				options: OUTPUT_FIELDS.map((field) => ({ name: outputFieldLabel(field), value: field })),
				description: 'Response fields to include when present. Operation and untrusted-content markers are always retained when present.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const def = OPS.find((o) => o.value === operation);
				if (!def) throw new NodeOperationError(this.getNode(), 'Unsupported Tanod operation.', { itemIndex: i });
				const mode = this.isToolExecution?.()
					? this.getNodeParameter('outputMode', i, 'simplified') as string
					: this.getNodeParameter('simplify', i, true) ? 'simplified' : 'raw';
				const selected = this.getNodeParameter('outputFields', i, []) as string[];
				if (!['raw', 'simplified', 'selected'].includes(mode) || !Array.isArray(selected)) {
					throw new NodeOperationError(this.getNode(), 'Choose a supported output mode and fields.', { itemIndex: i });
				}
				const body = await buildBody(this, i, def);
				const reply = await tanodCreditRequest(this, def.path, body);
				if (!reply || typeof reply !== 'object' || Array.isArray(reply)) {
					throw new NodeOperationError(this.getNode(), 'Tanod returned an unexpected response. Check the credit balance before retrying.', { itemIndex: i });
				}
				const json = reply as IDataObject;
				const binary: INodeExecutionData['binary'] = {};
				let n = 0;
				const take = async (f: IDataObject) => {
					if (typeof f.data_base64 !== 'string') return;
					const buf = Buffer.from(f.data_base64, 'base64');
					const key = n === 0 ? 'data' : `data${n + 1}`;
					binary[key] = await this.helpers.prepareBinaryData(
						buf,
						(f.name as string) || undefined,
						(f.content_type as string) || undefined,
					);
					n++;
					delete f.data_base64;
				};
				if (json.file && typeof json.file === 'object') await take(json.file as IDataObject);
				if (Array.isArray(json.files)) for (const f of json.files as IDataObject[]) await take(f);

				out.push({
					json: selectOutput(json, operation, mode, selected),
					...(n ? { binary } : {}),
					pairedItem: { item: i },
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (this.continueOnFail()) {
					out.push({ json: { error: message }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), message, { itemIndex: i });
			}
		}
		return [out];
	}
}

async function buildBody(ctx: IExecuteFunctions, i: number, def: OpDef): Promise<IDataObject> {
	const body: IDataObject = {};
	const p = (name: string, fallback?: unknown) => ctx.getNodeParameter(name, i, fallback);

	if (def.input === 'file-or-url') {
		const source = p('inputSource', 'binary') as string;
		if (source === 'binary') {
			const prop = p('binaryPropertyName', 'data') as string;
			const meta = ctx.helpers.assertBinaryData(i, prop);
			const buf = await ctx.helpers.getBinaryDataBuffer(i, prop);
			body[def.fileField as string] = buf.toString('base64');
			if (meta.fileName && def.value !== 'pdfTables' && def.value !== 'speechToText' && def.value !== 'pdfToWord') {
				body.filename = meta.fileName;
			}
		} else {
			body.url = p('url') as string;
		}
	} else if (def.input === 'url') {
		body.url = p('url') as string;
	}

	switch (def.value) {
		case 'pdfTables': {
			const pages = p('pages', '') as string;
			if (pages) body.pages = pages;
			body.format = p('tablesFormat', 'json');
			break;
		}
		case 'pdfToWord': {
			const pages = p('pages', '') as string;
			if (pages) body.pages = pages;
			break;
		}
		case 'ocrImage':
			body.lang = p('ocrLang', 'eng');
			break;
		case 'pageToMarkdown':
			body.format = 'markdown';
			body.js = p('js', false);
			break;
		case 'screenshot':
			body.format = p('shotFormat', 'png');
			body.width = p('width', 1280);
			body.height = p('height', 800);
			body.full_page = p('fullPage', false);
			break;
		case 'speechToText': {
			const lang = p('language', '') as string;
			if (lang) body.language = lang;
			if (p('translateToEnglish', false)) body.translate_to_english = true;
			break;
		}
		case 'translate': {
			body.text = p('text');
			body.target = p('target');
			const src = p('source', '') as string;
			if (src) body.source = src;
			break;
		}
		case 'verifyEmail':
			body.email = p('email');
			break;
	}
	if (def.returnsFile || def.value === 'pdfTables') body.output = 'base64';
	return body;
}
