# MCP SDK Dynamic Tool Management & Progressive Disclosure Research

**Date:** 2026-03-23
**SDK version tested locally:** `@modelcontextprotocol/sdk` v1.27.1 (installed in blueprint-extractor-mcp)
**MCP Spec referenced:** 2025-06-18

> Status note (2026-03-24): this feasibility analysis references the original monolithic `MCP/src/index.ts` layout. Since then, the repository has implemented the non-breaking `get_tool_help` approach and completed the server decomposition. Treat file-layout references below as historical context.

---

## 1. Dynamic Tool Registration After `connect()`

### Can tools be registered after `server.connect()`?

**Verified** -- Yes, with a caveat.

The MCP TypeScript SDK (`@modelcontextprotocol/sdk` v1.12+) supports registering new
tools after `server.connect()` has been called, **provided** the `tools` capability was
declared at construction time.

**History of the issue:**
- The SDK originally threw `"Cannot register capabilities after connecting to transport"`
  if you called `registerTool()` post-connect without pre-declaring capabilities.
- **Fix landed in PR #1666** (github.com/modelcontextprotocol/typescript-sdk/issues/893):
  - Eager initialization of request handlers in the constructor when capabilities are
    pre-declared.
  - Guard added to `registerCapabilities()` with `!this.server.transport` check.
  - Idempotent capability registration to skip redundant post-connect calls.

**Pre-fix workaround** (still works but unnecessary on current SDK):
```typescript
// Register dummy tool before connect, then remove after
server.tool("__init", "dummy", async () => ({ content: [] }));
await server.connect(transport);
server.removeTool("__init");
```

**Current recommended pattern:**
```typescript
const server = new McpServer(
  { name: "my-server", version: "1.0.0" },
  { capabilities: { tools: { listChanged: true } } }   // pre-declare
);
await server.connect(transport);

// This now works:
const regTool = server.registerTool("new_tool", {
  description: "Added dynamically",
  inputSchema: { query: z.string() },
}, async (args) => ({ content: [{ type: "text", text: "result" }] }));

server.sendToolListChanged();   // notify the client
```

**Source:** https://github.com/modelcontextprotocol/typescript-sdk/issues/893

### Can tools be deregistered/unregistered at runtime?

**Verified** -- Yes. The `RegisteredTool` type (v1.27.1) exposes these methods:

```typescript
type RegisteredTool = {
  enabled: boolean;
  enable(): void;       // re-shows tool in tools/list
  disable(): void;      // hides tool from tools/list
  update(updates: {     // rename, change schema, swap callback, toggle enabled
    name?: string | null;
    title?: string;
    description?: string;
    paramsSchema?: InputArgs;
    outputSchema?: OutputArgs;
    annotations?: ToolAnnotations;
    callback?: ToolCallback<InputArgs>;
    enabled?: boolean;
  }): void;
  remove(): void;       // fully deregisters the tool
};
```

Key points:
- `disable()` hides the tool from `tools/list` responses without removing it.
- `enable()` restores it.
- `remove()` fully deregisters the tool from the server.
- `update()` can rename, change schema, swap the callback, or toggle enabled state.
- All mutations automatically trigger `notifications/tools/list_changed` to connected clients.

**Source:** Local inspection of `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` (v1.27.1)

### `sendToolListChanged()` API

The `McpServer` class exposes:
```typescript
sendToolListChanged(): void;
```
This sends the `notifications/tools/list_changed` JSON-RPC notification to all connected clients.

---

## 2. Does Claude Re-Query `tools/list` Mid-Session?

### MCP Spec Behavior

**Verified** -- The MCP specification defines the flow:

> "When the list of available tools changes, servers that declared the `listChanged`
> capability SHOULD send a notification: `{ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" }`"

The spec's sequence diagram shows:
```
Server --)Client: tools/list_changed
Client ->>Server: tools/list
Server -->>Client: Updated tools
```

**Source:** https://modelcontextprotocol.io/docs/concepts/tools

### Claude Code CLI Support

**Uncertain / Likely Broken** -- As of March 2026, Claude Code's handling of
`notifications/tools/list_changed` is unreliable.

**Evidence from bug reports:**

Issue #13646 (closed as duplicate of #4118, Dec 2025):
> "Investigation of the minified cli.js source confirms that while Claude Code defines
> the Zod schema for this notification and includes it in the server-to-client
> notification types, **no handler is registered** via setNotificationHandler for
> notifications/tools/list_changed. When the notification arrives, the _onnotification
> method finds no matching handler and no fallbackNotificationHandler, so it returns
> early without action."

Issue #4118 (still **OPEN** as of March 2026):
- Assigned to `ollie-anthropic` (Anthropic team member)
- Labels: `area:mcp`, `enhancement`
- No official Anthropic response visible
- Workaround: `claude mcp remove <server-name>` and `claude mcp add ...`

**Known limitation:** Tools registered mid-chain via dynamic registration on the server
are only available **after** the current message cycle completes. Even if the client did
re-fetch, the tool would not be usable in the same turn it was registered.

**Source:**
- https://github.com/anthropics/claude-code/issues/13646
- https://github.com/anthropics/claude-code/issues/4118
- https://github.com/modelcontextprotocol/typescript-sdk/issues/682

### Claude Desktop Support

**Verified -- NOT Supported.**

MCP maintainer @jspahrsummers stated in the official MCP discussions:
> "You're using it correctly, but Claude Desktop doesn't support this at the moment --
> sorry for the confusion."

GitHub Copilot confirmed as supporting `list_changed` notifications.

**Source:** https://github.com/orgs/modelcontextprotocol/discussions/76

### Summary Table

| Client          | `tools/list_changed` handling | Status          |
|-----------------|-------------------------------|-----------------|
| Claude Code CLI | Handler not registered        | Open bug #4118  |
| Claude Desktop  | Not supported                 | Confirmed by maintainer |
| GitHub Copilot  | Supported                     | Community-confirmed |
| Gemini CLI      | PR #14375 to add support      | In progress     |
| Spring AI       | Supported via `toolsChangeConsumer` | Documented |

---

## 3. Progressive Disclosure in Production MCP Servers

### The Meta-Tool Pattern

**Verified** -- Multiple production-grade MCP servers implement progressive disclosure
using a meta-tool pattern that exposes 2-3 discovery tools instead of N individual tools.

**Speakeasy's Dynamic Toolsets** (benchmarked):
- Three meta-tools: `list_tools`, `describe_tools`, `execute_tool`
- 400-tool server comparison:
  - Static: **405,000 tokens** (exceeds Claude's 200K context window entirely)
  - Progressive discovery: **~6,000 tokens** (list_tools + describe_tools for 3 tools)
  - Semantic search variant: **~5,000 tokens** (2 tools: `find_tools` + `execute_tool`)
- Initial cost: ~2,500 tokens (progressive) vs ~1,300 tokens (semantic) regardless of toolset size
- **100x-160x token reduction** vs static approach

**Source:** https://www.speakeasy.com/blog/100x-token-reduction-dynamic-toolsets

### ProDisco (harche/ProDisco) -- Kubernetes MCP Server

**Verified** -- Progressive disclosure for TypeScript library APIs.

Architecture:
- **2 tools exposed**: `prodisco.searchTools` (discovery) + `prodisco.runSandbox` (execution)
- Methods are extracted from library `.d.ts` files using TypeScript AST parsing
- Upgrading a dependency automatically exposes new methods
- Each MCP session gets isolated Kata VM sandboxes

> "When agents explore a filesystem of TypeScript modules, they only load what they need
> and process data inside the execution environment, then return a concise result to the
> chat. This keeps token usage low, improves latency, and avoids copying large
> intermediate payloads through the model."

**Source:** https://github.com/harche/ProDisco

### MCP Progressive Disclosure Extension (HuggingFace)

**Verified** -- Protocol extension demonstrated at MCP 1st Birthday event.

Two-stage discovery:
1. **Stage 1:** `tools/list` returns ultra-minimal 1-sentence descriptions (empty inputSchema)
2. **Stage 2:** Agent fetches full description via `resource:///tool_descriptions?tools=<name>`

Token savings:
> "Standard Mode: 40,000 tokens loaded upfront.
> Progressive Mode: 500 tokens initial + ~400 per tool fetched = 1,700 tokens for 3 tools used.
> Savings: 96% reduction in typical workflows!"

20 tools tested (9 working + 11 enterprise simulations).

**Source:** https://huggingface.co/spaces/MCP-1st-Birthday/mcp-extension-progressive-disclosure

### mcp-dynamic-proxy (PyPI)

**Likely** -- Reduces initial context from 20-300 tools to 3 core tools for discovery.

**Source:** https://pypi.org/project/mcp-dynamic-proxy/

### SEP Proposal #1888 -- Progressive Disclosure for Typed Library Discovery

**Verified** -- Active proposal in the MCP specification repo for formalizing
progressive disclosure as a protocol extension.

**Source:** https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1888

### GODA MCP Server (Go-based)

**Likely** -- Implements tool categorization achieving 53-75% token reduction as a
workaround for Claude Code's lack of `list_changed` support.

**Source:** https://github.com/anthropics/claude-code/issues/4118 (community comment by kolkov)

---

## 4. ResourceLink Best Practices

### What is ResourceLink?

**Verified** -- MCP spec 2025-06-18 introduced `ResourceLink` as a content type in tool
results, allowing tools to return references to resources rather than embedding large
payloads inline.

```json
{
  "type": "resource_link",
  "uri": "file:///project/src/main.rs",
  "name": "main.rs",
  "description": "Primary application entry point",
  "mimeType": "text/x-rust",
  "annotations": {
    "audience": ["assistant"],
    "priority": 0.9
  }
}
```

> "Resource links returned by tools are not guaranteed to appear in the results of a
> `resources/list` request."

**Source:** https://modelcontextprotocol.io/docs/concepts/tools

### The Dual-Response Pattern

**Verified** -- The recommended approach for large data:

1. Return **preview data** (limited sample) as inline `text` content for LLM analysis
2. Return **ResourceLink** for complete dataset access out-of-band
3. Include metadata: `total_count`, execution timestamp, schema info, expiration

> "This design enables LLMs to perform immediate analysis on representative samples while
> preserving access to complete datasets for comprehensive reporting."

### Recommended Size Thresholds

**Uncertain** -- No explicit KB threshold is defined in the spec or official docs.

Practical guidance from the research literature and community:

| Guideline | Source |
|-----------|--------|
| Cap preview data at **10-100 records** regardless of LLM request | arxiv.org/html/2510.05968v1 |
| Tool results consuming >70-80% of context before analysis is a red flag | arxiv.org/html/2510.05968v1 |
| Models maintain accuracy above 64K tokens only with "substantial latency increases" | arxiv.org/html/2510.05968v1 |
| Enforce server-side limits via query rewriting regardless of LLM-specified params | arxiv.org/html/2510.05968v1 |

**Practical heuristic:** If a tool result would exceed ~4-8 KB of text (roughly 1,000-2,000
tokens), consider returning a ResourceLink with an inline summary instead. For
extraction/analysis tools, this means returning a compact summary + ResourceLink to the
full extracted data.

### Resource Lifecycle for ResourceLinks

- Resources are **ephemeral by default** (garbage-collected)
- Implement expiration timestamps for automatic cleanup
- Support out-of-band retrieval via RESTful endpoints with pagination
- Authentication via OAuth 2.0 Bearer tokens for production deployments

**Source:**
- https://arxiv.org/html/2510.05968v1
- https://modelcontextprotocol.io/docs/concepts/resources

### Production Example: This Codebase (blueprint-extractor-mcp)

The `blueprint-extractor-mcp` server in this repository already imports `ResourceLink`
from `@modelcontextprotocol/sdk/types.js` (line 6 of `MCP/src/index.ts`), indicating
it uses or is prepared to use ResourceLink in tool responses.

---

## 5. Tool Annotations Effectiveness

### The Four Annotations

**Verified** -- Defined in the MCP spec and supported by `@modelcontextprotocol/sdk`:

```typescript
annotations?: {
  readOnlyHint?: boolean;      // Does the tool modify its environment?
  destructiveHint?: boolean;   // If it modifies, is the change destructive?
  idempotentHint?: boolean;    // Safe to call again with same args?
  openWorldHint?: boolean;     // Interacts with external entities?
};
```

### How Clients Use Annotations

**Verified** -- From the official MCP blog post (2026-03-16):

> "The most common use of annotations today is to drive confirmation prompts -- a tool
> marked `readOnlyHint: true` from a trusted server might be auto-approved, while
> `destructiveHint: true` gets a confirmation step, helping clients show dialogs listing
> what's about to be deleted before anything happens."

Documented client behaviors:
1. **Auto-approval:** `readOnlyHint: true` tools from trusted servers skip confirmation
2. **Confirmation prompts:** `destructiveHint: true` triggers user warnings
3. **Graduated trust:** Enterprise servers get policy-driven approvals; untrusted servers
   get informational treatment only
4. **Policy engines:** Annotations feed rules like "open-world tools blocked after
   accessing private data"

### Do Annotations Reduce the Need for Verbose Descriptions?

**Uncertain** -- No direct benchmarks exist comparing tool selection accuracy
with vs. without annotations.

The official blog explicitly states what annotations **cannot** do:
> "An untrusted server can claim `readOnlyHint: true` and delete your files anyway."
> "They aren't enforcement."

Annotations are treated as **untrusted metadata** by clients:
> "Annotations are not guaranteed to faithfully describe tool behavior, and clients MUST
> treat them as untrusted unless they come from a trusted server."

### Benchmarks on Tool Selection Accuracy

**Uncertain** -- No published benchmarks comparing tool selection accuracy with
annotations vs. without.

The closest data point:
> "GitHub's read-only mode is the closest production analog, enabled by about 17% of users."

The blog recommends iterative optimization for tool selection:
> "To measure tool selection accuracy in benchmarks, you can record outcomes including
> which tool was selected and what arguments were passed, then track precision (did the
> right tool run?) and recall (did the tool run when it should?). If the model picks the
> wrong tool, revise descriptions to emphasize the intended scenario or narrow the tool's
> scope, changing one metadata field at a time to attribute improvements."

### Best Practices for Annotations

From the official MCP blog (2026-03-16):

**For server authors:**
- Set `readOnlyHint: true` on read-only tools
- Use `destructiveHint: false` for additive/non-destructive write operations
- Mark `openWorldHint: false` for closed-domain tools
- `idempotentHint: true` enables safe automatic retries

**For client developers:**
> "Treat annotations from untrusted servers as informational and lean on them for UX,
> but keep your actual safety guarantees in deterministic controls."

**Source:** https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/

---

## Key Takeaways for blueprint-extractor-mcp

1. **Dynamic tool registration works** in SDK v1.27.1 (our installed version) --
   tools can be added/removed/disabled after `connect()` when capabilities are
   pre-declared.

2. **Claude Code does NOT reliably handle `tools/list_changed`** as of March 2026
   (bug #4118 still open). Progressive disclosure via `notifications/tools/list_changed`
   will not work with Claude Code CLI today. Mid-chain tool registration will not be
   available in the same turn regardless.

3. **The meta-tool pattern is the proven alternative:** Instead of relying on dynamic
   tool list updates, expose 2-3 meta-tools (`list_tools`, `describe_tools`,
   `execute_tool`) that let the LLM progressively discover and invoke capabilities.
   This achieves 96-160x token reduction and works with all clients.

4. **ResourceLink is appropriate for extraction results** exceeding ~4-8 KB. Return a
   compact summary inline + ResourceLink to the full data. Cap previews at 10-100
   records.

5. **Tool annotations are UX hints, not selection aids.** They help clients decide
   confirmation behavior but do not measurably improve tool selection accuracy. Good
   descriptions remain essential.

---

## Sources

- MCP Tools Specification: https://modelcontextprotocol.io/docs/concepts/tools
- MCP Resources Specification: https://modelcontextprotocol.io/docs/concepts/resources
- TypeScript SDK Issue #893 (post-connect registration fix): https://github.com/modelcontextprotocol/typescript-sdk/issues/893
- TypeScript SDK Issue #682 (mid-chain limitation): https://github.com/modelcontextprotocol/typescript-sdk/issues/682
- Claude Code Issue #4118 (tools/list_changed not handled): https://github.com/anthropics/claude-code/issues/4118
- Claude Code Issue #13646 (duplicate, detailed analysis): https://github.com/anthropics/claude-code/issues/13646
- MCP Discussion #76 (Claude Desktop not supported): https://github.com/orgs/modelcontextprotocol/discussions/76
- Speakeasy Dynamic Toolsets (100x reduction): https://www.speakeasy.com/blog/100x-token-reduction-dynamic-toolsets
- Speakeasy Dynamic Tool Discovery: https://www.speakeasy.com/mcp/tool-design/dynamic-tool-discovery
- ProDisco GitHub: https://github.com/harche/ProDisco
- Progressive Disclosure Extension: https://huggingface.co/spaces/MCP-1st-Birthday/mcp-extension-progressive-disclosure
- MCP SEP #1888 (Progressive Disclosure proposal): https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1888
- ResourceLink Large Dataset Patterns: https://arxiv.org/html/2510.05968v1
- Tool Annotations Blog Post: https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/
- Claude Code MCP Docs: https://code.claude.com/docs/en/mcp

# Progressive Disclosure Research
