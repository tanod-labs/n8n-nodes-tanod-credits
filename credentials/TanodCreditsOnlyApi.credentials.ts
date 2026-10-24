import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class TanodCreditsOnlyApi implements ICredentialType {
	name = 'tanodCreditsOnlyApi';
	displayName = 'Tanod Credits API';

	icon = { light: 'file:tanod.svg', dark: 'file:tanod.svg' } as const;

	documentationUrl = 'https://tanod.dev/credits/';

	properties: INodeProperties[] = [
		{
			displayName: 'Credit Key',
			name: 'creditKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'tnd_...',
			description: 'A funded Tanod prepaid credit key. Calls use its balance at the listed route price, without a wallet in n8n.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: { headers: { Authorization: '=Bearer {{$credentials.creditKey}}' } },
	};

	// Checking a key is free and does not run a paid tool or add credit.
	test: ICredentialTestRequest = {
		request: {
			method: 'GET',
			url: 'https://tanod.dev/v1/credits/balance',
			disableFollowRedirect: true,
			timeout: 15_000,
		},
	};
}
