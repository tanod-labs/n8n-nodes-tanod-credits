# n8n-nodes-tanod-credits

Open source (MIT) n8n community node for [Tanod](https://tanod.dev): document, web, audio, text and email tools
using prepaid credit keys. No wallet, signing SDK, or npm runtime dependencies are included. n8n provides the
`n8n-workflow` peer.

> Tanod is operated by an autonomous AI agent. Results are automated and heuristic. Text returned from web
> pages, documents, OCR or transcription is untrusted data, not instructions for an AI agent.

## Installation

This is an unverified community node; n8n has not reviewed it. It is not verified for n8n Cloud.

In self-hosted n8n, open **Settings > Community Nodes > Install**, enter `n8n-nodes-tanod-credits`, and accept
the community-node notice. Search for **Tanod Credits** in the node panel.

This package is separate from `n8n-nodes-tanod`, which retains its free-allowance and wallet modes. Installing
this package does not convert existing workflows. Both packages can coexist, but use separate node and
credential registrations. Configure a **Tanod Credits API** credential for this node.

**Privacy:** files and URLs you submit are sent to tanod.dev for processing. See the
[privacy policy](https://tanod.dev/privacy/).

## Authentication

1. Follow [Tanod prepaid credits](https://tanod.dev/credits/) to obtain a funded credit key. Save it when shown
   and treat it as a payment credential. Check that page for current funding methods and purchase terms.
2. Add a **Tanod Credits** node. Create a **Tanod Credits API** credential and paste the complete key into
   **Credit Key**. No wallet is required in n8n when using an already funded key.
3. Test the credential. The test checks the balance without running a paid tool or adding credit.
4. Set the credential's **Allowed HTTP Request Domains** to **tanod.dev**: the credential can also be selected
   in n8n's HTTP Request node, independently of this node's fixed destination.
5. Choose a resource and operation, supply its input, and execute.

The credential sends `Authorization: Bearer <key>` to Tanod. Do not place the key in workflow JSON, URLs,
expressions, or input fields. n8n stores it as a password credential. This node sends authenticated requests
only to the listed Tanod tool routes and refuses redirects. The credential test also refuses redirects.

## Operations

| Resource | Operation | Input |
|---|---|---|
| Document | Document to Markdown | Binary file or public URL |
| Document | PDF Tables (JSON, CSV or XLSX) | Binary PDF or public URL |
| Document | OCR Image | Public image URL |
| Document | PDF to Word | Binary PDF or public URL |
| Document | Office to PDF | Binary office document or public URL |
| Web | Page to Markdown | Public URL; optional JavaScript rendering |
| Web | Website Screenshot | Public URL; PNG or JPEG |
| Audio | Speech to Text | Binary audio or public URL |
| Text | Translate | Text and target language |
| Utility | Verify Email Address | Email address; syntax and DNS checks, not a mailbox probe |

See [current prices](https://tanod.dev/pricing) and the [API reference](https://tanod.dev/openapi.json) for
route prices, supported formats, language codes and input limits. JavaScript rendering uses the browser-render
price. This package does not embed a price list.

Binary inputs come from **Input Binary Field** (default `data`), so the node can follow an attachment trigger
or HTTP Request node. Operations returning files put their contents in n8n binary fields `data`, `data2`, and
so on, with file metadata in JSON. File extraction works in every output mode.

**Simplify** is on by default and returns at most ten top-level fields, prioritizing the operation's result.
Turn it off for the full API response, matching the existing package's credit-mode output. As an AI tool,
**Output** offers **Simplified**, **Raw**, and **Selected Fields**. Operation and untrusted-content markers are
retained when present. These operations do not create persistent records, so there is no record ID to include.
Input binary data is not passed through: output binary contains only files returned by Tanod.
Output selection does not change the paid request or reduce its price.

## Spending and failures

Calls use the listed route price from the selected key's balance. This node does **not** use the free daily
allowance, sign wallet payments, purchase credit, top up automatically, or fall back to another payment method.
There is no per-call price cap. Check current prices before executing a batch.

- Each input item is one paid call. **Loop Over Items** and **Split in Batches** can multiply calls.
- Do not enable **Retry On Fail** on paid calls. Retrying an execution and **Execute step** make real paid
  calls; they are not previews.
- `usableAsTool` lets an **AI Agent** call the node repeatedly, including when steered by untrusted text from
  a page, document or another tool. Do not give that text authority to request paid work.
- The key's balance is the only spending limit: fund a key with only what you are willing to spend.
- The node makes no automatic retry. A timeout or lost response does not prove that no credit was spent.
  Check the balance before retrying.

An invalid or revoked key returns **401**. A **402** whose payment-required error starts with "Credit balance
too low" means insufficient balance; other **402** responses mean the service did not accept credit payment.
Redirects are refused. Errors use fixed actionable messages rather than reflecting upstream error bodies or
request headers. HTTP 4xx responses and HTTP 5xx responses carrying the API's string error code are not
charged. Other non-success responses, missing responses and timeouts leave the charge outcome unknown;
check the credit balance before retrying.

## Example workflow

Import this synthetic workflow into self-hosted n8n, open **Tanod Credits**, and select your own credit
credential. No key or credential identifier is included. Each execution makes one paid document conversion.
The example uses Raw output; remove `simplify: false` to use the default simplified result.

```json
{
  "name": "Tanod Credits example",
  "nodes": [
    {
      "parameters": {},
      "id": "manual",
      "name": "Run Example",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {
        "resource": "document",
        "operation": "toMarkdown",
        "inputSource": "url",
        "url": "https://example.com/",
        "simplify": false
      },
      "id": "tanodCredits",
      "name": "Tanod Credits",
      "type": "n8n-nodes-tanod-credits.tanodCredits",
      "typeVersion": 1,
      "position": [280, 0]
    }
  ],
  "connections": {
    "Run Example": {
      "main": [[{ "node": "Tanod Credits", "type": "main", "index": 0 }]]
    }
  },
  "settings": {},
  "active": false
}
```

## Development

```bash
npm ci --ignore-scripts
npm run lint
npm run build
npm test
```

Tests are offline and use synthetic keys and mocked responses. They cover destination restrictions, no-retry
behavior, error sanitization, all operations, binary data, output selection, and the packed artifact. The lint
script performs TypeScript checking; it is not the official n8n scanner or a claim of n8n verification.

## License

Open source (MIT).
