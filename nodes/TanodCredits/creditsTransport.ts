import type { IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { OPS } from './operations';

const ORIGIN = 'https://tanod.dev';
const KEY = /^tnd_[A-Za-z0-9_-]{43}$/;
const ERROR_MESSAGES: Record<string, string> = {
	too_large: 'the input is too large. Use a smaller file or shorter input.',
	body_too_large: 'the input is too large. Use a smaller file or shorter input.',
	input_too_large: 'the input is too large. Use a smaller file or shorter input.',
	document_too_large: 'the document is too large. Use a smaller document or fewer pages.',
	output_too_large: 'the result is too large. Select fewer pages or use a smaller input.',
	response_too_large: 'the result is too large. Select fewer pages or use a smaller input.',
	unsupported_format: 'the file format is not supported. Check the operation and use a supported format.',
	unsupported_content_type: 'the file type is not supported. Use a supported file or URL.',
	unsupported_encoding: 'the file encoding is not supported. Use a supported encoding.',
	pdf_encrypted: 'the PDF is encrypted. Remove its password before submitting it.',
	encrypted_document: 'the document is encrypted. Remove its password before submitting it.',
	unsupported_encryption: 'the file encryption is not supported. Remove its password before submitting it.',
	rate_limited: 'the request limit was reached. Wait before trying again.',
	busy: 'the service is at capacity. Try again later.',
	queue_full: 'the service is at capacity. Try again later.',
	timeout: 'the service took too long to respond. Try again later.',
	micro_unavailable: 'the service is temporarily unavailable. Try again later.',
};

/** No wallet SDK, automatic retries, free-tier fallback, or configurable credential destination. */
export async function tanodCreditRequest(
	ctx: IExecuteFunctions,
	path: string,
	body: Record<string, unknown>,
): Promise<unknown> {
	// Exact route membership (not a prefix) rejects origins, queries, traversal and top-ups.
	if (!OPS.some((op) => op.path === path)) {
		throw new NodeOperationError(ctx.getNode(), 'Unsupported Tanod credit-key operation. Not charged.');
	}
	let key: unknown;
	try {
		key = (await ctx.getCredentials('tanodCreditsOnlyApi')).creditKey;
	} catch {
		throw new NodeOperationError(ctx.getNode(), 'Select a Tanod prepaid credit key credential. Not charged.');
	}
	if (typeof key !== 'string' || key.length !== 47 || !KEY.test(key)) {
		throw new NodeOperationError(ctx.getNode(), 'The Tanod prepaid credit key must be tnd_ followed by 43 letters, digits, underscores or hyphens. Not charged.');
	}

	const options: IHttpRequestOptions = {
		method: 'POST',
		url: ORIGIN + path,
		body,
		headers: { accept: 'application/json' },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		disableFollowRedirect: true,
		timeout: 120_000,
	};
	let response;
	try {
		// n8n injects the credential's Authorization header, not a URL/body/query field.
		response = await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'tanodCreditsOnlyApi', options);
	} catch {
		// A lost response has an unknown charge outcome; HTTP exceptions can expose the key.
		throw new NodeOperationError(ctx.getNode(), 'Tanod credit request could not be completed or timed out. No automatic retry was made. The charge outcome is unknown; check the credit balance before retrying.');
	}
	const status = response?.statusCode;
	if (status === 200) return response.body;
	if (status === 401) throw new NodeOperationError(ctx.getNode(), 'Tanod 401: the prepaid credit key is invalid or revoked. Check the credential. Not charged.');
	if (status === 402) {
		// This check depends on the text prefix of brand.credits_insufficient.
		// PaymentRequired.error is a string; recognize the prefix but never echo it.
		const message = typeof response.body?.error === 'string' && response.body.error.startsWith('Credit balance too low')
			? 'the prepaid balance is insufficient for this call. Add credit at https://tanod.dev/credits/.'
			: 'credit payment not accepted by the service right now; check https://tanod.dev/credits/.';
		throw new NodeOperationError(ctx.getNode(), `Tanod 402: ${message} Not charged. No wallet payment or automatic retry was attempted.`);
	}
	if (Number.isInteger(status) && status >= 300 && status < 400) {
		throw new NodeOperationError(ctx.getNode(), 'Tanod refused a redirect. The credit key was not forwarded. The charge outcome is unknown; check the credit balance before retrying.');
	}
	// Only own allowlisted tokens select fixed text; upstream bodies and unknown codes stay private.
	const code = response?.body?.error?.code;
	const clientError = Number.isInteger(status) && status >= 400 && status < 500;
	const apiServerError = Number.isInteger(status) && status >= 500 && status < 600 && typeof code === 'string';
	if (clientError || apiServerError) {
		const message = typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
			? ERROR_MESSAGES[code]
			: apiServerError
				? 'the service did not return a result. Try again later.'
				: 'the credit-key call was not accepted. Check the input before trying again.';
		throw new NodeOperationError(ctx.getNode(), `Tanod ${status}: ${message} Not charged.`);
	}
	// A proxy or response-rendering error can arrive after the API committed a charge.
	if (Number.isInteger(status) && status >= 100 && status <= 599) {
		throw new NodeOperationError(ctx.getNode(), `Tanod ${status}: the service did not return a result. The charge outcome is unknown; check the credit balance before retrying.`);
	}
	throw new NodeOperationError(ctx.getNode(), 'Tanod returned no valid response status. The charge outcome is unknown; check the credit balance before retrying.');
}
