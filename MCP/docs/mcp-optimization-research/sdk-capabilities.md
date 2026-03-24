# MCP SDK Capabilities Research

**Date:** 2026-03-23
**SDK Version Examined:** `@modelcontextprotocol/sdk` v1.27.1 (installed locally)
**Sources:** GitHub issues, SDK source code, MCP spec, blog posts, community discussions

---

## 1. Dynamic Tool Registration After Connect

### Finding: Supported (with caveats)

### Evidence

- **SDK source code** (`dist/esm/server/mcp.js`, lines 605-652, 698-704, 764-768)
- [GitHub Issue #893](https://github.com/modelcontextprotocol/typescript-sdk/issues/893) - "McpServer re-registers capabilities after connect"
- [GitHub Issue #836](https://github.com/modelcontextprotocol/typescript-sdk/issues/836) - "Dynamic Tool Registration Based on Authentication Context"
- [SDK server docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)

### Details

**The low-level `Server` class blocks post-connect capability registration:**

```javascript
// server/index.js line 86-91
registerCapabilities(capabilities) {
    if (this.transport) {
        throw new Error('Cannot register capabilities after connecting to transport');
    }
    this._capabilities = mergeCapabilities(this._capabilities, capabilities);
}
```

This means `Server.registerCapabilities()` throws after `connect()`. However, the high-level `McpServer` class has a workaround pattern:

**The `McpServer.registerTool()` / `McpServer.tool()` methods CAN work post-connect IF the tool capability handlers were already initialized before connect.** The `setToolRequestHandlers()` method (called on first tool registration) calls `registerCapabilities()` -- but it only does this once:

```javascript
setToolRequestHandlers() {
    if (this._toolHandlersInitialized) { return; }  // guard
    this.server.registerCapabilities({ tools: { listChanged: true } });
    // ... set up ListTools and CallTool handlers ...
    this._toolHandlersInitialized = true;
}
```

**Workaround (confirmed in Issue #893):** Register at least one dummy tool BEFORE `connect()`, then remove it after connect. This forces early handler initialization:

```javascript
server.tool("__init", "dummy", async () => ({ content: [] }));
await server.connect(transport);
// Remove dummy -- now dynamic registration works
// Register new tools freely:
server.tool("real-tool", "desc", async () => ({ content: [{ type: "text", text: "ok" }] }));
```

**The SDK automatically sends `notifications/tools/list_changed`:**

```javascript
// mcp.js lines 764-768
sendToolListChanged() {
    if (this.isConnected()) {
        this.server.sendToolListChanged();
    }
}
```

This is called automatically when:
- A new tool is registered (`_createRegisteredTool`, line 651)
- A tool is updated via `tool.update({...})` (line 646)
- A tool is enabled/disabled via `tool.enable()` / `tool.disable()` (lines 618-619)
- A tool is removed via `tool.remove()` (line 620, sets name to null)

**Tool enable/disable API (v1.27.1):**

Each registered tool returns an object with methods:
- `tool.enable()` - makes tool visible in `tools/list`
- `tool.disable()` - hides tool from `tools/list` (returns error if called)
- `tool.remove()` - deletes the tool entirely
- `tool.update({...})` - modify title, description, schema, annotations, enabled state

All of these trigger `sendToolListChanged()` automatically.

**PR #1666 (referenced in Issue #893):** Proposes eagerly initializing handlers during construction when capabilities are pre-declared, which would remove the need for the dummy-tool workaround. Status: proposed solution, check if merged.

### Practical Implications for blueprint-extractor-mcp

Dynamic tool registration after connect IS feasible in SDK v1.27.1 using the dummy-tool workaround. The `enable()`/`disable()` pattern is even cleaner: register ALL tools upfront, disable non-core ones, then `enable()` them on demand. Each state change auto-sends the notification.

---

## 2. Claude tools/list Re-query Behavior

### Finding: Supported in Claude Code >=2.1.0; Claude Desktop status unclear

### Evidence

- [GitHub Issue #4118](https://github.com/anthropics/claude-code/issues/4118) - "Capture MCP Tools Changed notifications" (open, 71 upvotes)
- [GitHub Issue #13646](https://github.com/anthropics/claude-code/issues/13646) - "MCP tool list not refreshed" (closed as duplicate of #4118)
- [MCP Discussion #76](https://github.com/orgs/modelcontextprotocol/discussions/76) - official discussion on `notifications/tools/list_changed`
- [Blog: "tools/listChanged Is a Bug, Not a Feature"](https://www.seuros.com/blog/tools-list-changed-bug-not-feature/) - confirms fix in Claude Code 2.1.0
- [VentureBeat: Claude Code 2.1.0](https://venturebeat.com/orchestration/claude-code-2-1-0-arrives-with-smoother-workflows-and-smarter-agents/) - release announcement
- [Claude Code changelog](https://code.claude.com/docs/en/changelog)

### Details

**Timeline of events:**

| Date | Event |
|------|-------|
| Nov 2024 | MCP spec v1 includes `notifications/tools/list_changed` |
| Jul 2025 | MCP Discussion #76: maintainer confirms "Claude Desktop doesn't support this at the moment" |
| Dec 2025 | Issue #13646 filed: Claude Code ignores the notification, no handler registered |
| Jan 2026 | Claude Code 2.1.0 released with `list_changed` notification support |
| Mar 2026 | Issue #4118 still technically open (71 upvotes) |

**MCP spec message flow (from spec 2025-06-18):**

```
Server --)Client: notifications/tools/list_changed
Client ->>Server: tools/list
Server -->>Client: Updated tools
```

**Claude Code 2.1.0+:** Confirmed working. When an MCP server sends `notifications/tools/list_changed`, Claude Code automatically re-fetches the tools list and updates available capabilities without requiring `/mcp` reconnect.

**Claude Desktop (web app):** The Claude Desktop support page documents MCP support but does not specifically confirm or deny `list_changed` handling. The web-based Claude API with MCP connector may behave differently. The MCP Discussion #76 from July 2025 explicitly said Claude Desktop did NOT support it; whether that has changed since Claude Code 2.1.0 is unconfirmed.

**Other clients:**
- GitHub Copilot: Confirmed supported
- VS Code: Supported via [Issue #243944](https://github.com/microsoft/vscode/issues/243944)
- Cursor: Community reports suggest partial support
- Pydantic AI / LibreChat / Gemini CLI: Open issues requesting support

**Key limitation:** The notification only triggers when tool metadata changes (name, description, parameters). Internal logic updates without metadata modifications won't generate notifications.

### Practical Implications for blueprint-extractor-mcp

For Claude Code users (>=2.1.0), dynamic tool visibility changes via `enable()`/`disable()` WILL be detected. For Claude Desktop, this remains uncertain -- the safest approach is to register all tools upfront but use the progressive disclosure pattern at the tool-call level rather than relying on `list_changed`.

---

## 3. Progressive Disclosure Examples

### ProDisco (Progressive Disclosure Kubernetes MCP Server)

- **Pattern:** Two-tool architecture: `prodisco.searchTools` (discovery) + `prodisco.runSandbox` (execution)
- **Source:** [github.com/harche/ProDisco](https://github.com/harche/ProDisco)
- **How it works:** Indexes TypeScript library `.d.ts` files via AST parsing. Agents search for methods/types, then write code to execute in a sandboxed environment. Only console output returns to the LLM.
- **Relevance:** Direct model for blueprint-extractor-mcp. Instead of exposing 20+ tools, expose `searchBlueprints` + `extractBlueprint` with discovery-first flow.
- **Token impact:** Only discovery results enter context; full data stays server-side until sandbox execution.

### Blockscout MCP Server

- **Pattern:** Two-phase metadata-first approach for smart contracts
- **Source:** [blog.blockscout.com/mcp-explained-part-2-optimizations](https://www.blog.blockscout.com/mcp-explained-part-2-optimizations/)
- **How it works:**
  - **Phase 1:** Returns contract metadata and file structure WITHOUT source code contents
  - **Phase 2:** Model requests individual files after understanding project composition
  - Response slicing: returns only first 10 items instead of full pages
  - Truncation of long hex strings and nested structures
- **Relevance:** Directly applicable pattern. Return blueprint metadata/structure first, then individual node details on demand.
- **Additional pattern:** `__unlock_blockchain_analysis__` initialization tool that establishes operational context before reasoning begins.

### Agentic-MCP (Three-Layer Lazy Loading)

- **Pattern:** Three progressive layers: Server Metadata -> Tool Inventory -> Detailed Schemas
- **Source:** [github.com/cablate/mcp-progressive-agentskill](https://github.com/cablate/mcp-progressive-agentskill)
- **How it works:**
  - Layer 1: Load server metadata only (~50-100 tokens)
  - Layer 2: Load tool names + brief descriptions (~200-400 tokens)
  - Layer 3: Load complete input schemas for specific tools (~300-500 tokens per tool)
- **Token savings:** 86% reduction example (20 tools, only 2 needed: 850 vs 6,000 tokens)
- **Relevance:** Validates the lazy-loading approach. Could apply to blueprint-extractor by exposing lightweight tool descriptions first.

### SEP #1888: Standardized Meta-Tool

- **Pattern:** Standardized `<library>.searchTools` + `<library>.getTypeDefinitions` meta-tools
- **Source:** [GitHub Issue #1888](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1888), [Discussion #631](https://github.com/orgs/modelcontextprotocol/discussions/631)
- **How it works:** Two modes -- operations mode (search by resource type, action, scope, risk level) and types mode (retrieve machine-readable type definitions). Consolidated from original two-tool approach based on real-world usage.
- **Relevance:** The standardized meta-tool pattern is the direction MCP is heading. Aligning with this pattern future-proofs the implementation.

### Speakeasy: Progressive vs Semantic Search

- **Pattern:** Comparative analysis of progressive discovery (hierarchical) vs semantic search (embeddings) for dynamic MCP toolsets
- **Source:** [speakeasy.com/blog/100x-token-reduction-dynamic-toolsets](https://www.speakeasy.com/blog/100x-token-reduction-dynamic-toolsets)
- **Key data:**

| Toolset Size | Progressive Initial | Semantic Initial | Static Initial |
|---|---|---|---|
| 40 tools | 1,600 tokens | 1,300 tokens | 43,300 tokens |
| 100 tools | 2,400 tokens | 1,300 tokens | 128,900 tokens |
| 400 tools | 2,500 tokens | 1,300 tokens | 405,100 tokens |

- **Progressive search meta-tools:** `list_tools` (prefix-based), `describe_tools` (detailed schemas), `execute_tool` (run)
- **Relevance:** Shows progressive approach scales well. For blueprint-extractor's ~20 tools, even the static approach is viable, but progressive would reduce initial token overhead from ~6,000 to ~1,600 tokens.

### Anthropic Engineering: Code Execution with MCP

- **Pattern:** Anthropic's official guidance describing tools as a "filesystem that models can explore incrementally"
- **Source:** [anthropic.com/engineering/code-execution-with-mcp](https://www.anthropic.com/engineering/code-execution-with-mcp)
- **Relevance:** Official Anthropic endorsement of the progressive disclosure pattern.

---

## 4. ResourceLink Best Practices

### Finding: ResourceLink is the recommended pattern for large data; clients do NOT auto-fetch universally

### Evidence

- [MCP Spec 2025-06-18: Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) - official ResourceLink content type
- [arxiv:2510.05968](https://arxiv.org/html/2510.05968v1) - "Extending ResourceLink: Patterns for Large Dataset Processing"
- [Pydantic AI Issue #3099](https://github.com/pydantic/pydantic-ai/issues/3099) - "Better handling of MCP tool ResourceLinks"
- [MCP Spec: Resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources) - resource annotations

### Details

**ResourceLink in tool responses (MCP spec 2025-06-18):**

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

Key spec notes:
- Resource links returned by tools are NOT guaranteed to appear in `resources/list` results
- Tools can return a mix of inline content (text, image, audio) and resource_link references
- All content types support optional annotations (audience, priority, lastModified)

**When to use inline data vs ResourceLink URIs:**

| Scenario | Approach | Rationale |
|---|---|---|
| Small text results (<1KB) | Inline `type: "text"` | Immediate availability for LLM reasoning |
| Preview/summary data (10-100 records) | Inline text | Sufficient for LLM analysis without full dataset |
| Large datasets (>10KB) | `resource_link` URI | Preserves context window; client fetches on demand |
| Complete source files | `resource_link` URI | Avoid context pollution |
| Binary data (images, blobs) | `resource_link` or inline `base64` | ResourceLink preferred for large binaries |
| Structured query results | Dual: inline preview + ResourceLink for full | Best of both worlds per arxiv:2510.05968 |

**Size thresholds (from multiple sources):**

- MCP server content must be under **1MB** total
- Upload endpoint enforces **50MB** limit
- Preview samples: cap at **10-100 records** regardless of LLM-specified parameters
- arxiv paper recommends: "servers should cap data at a reasonable threshold (typically 10-100 records)"
- Inline data for LLM reasoning; ResourceLink for exports, visualizations, complete datasets

**Auto-fetch behavior (critical finding -- varies by client):**

| Client | Auto-fetch ResourceLink? | Notes |
|---|---|---|
| Pydantic AI | **Yes** (currently) | Transparently downloads all ResourceLinks; Issue #3099 proposes changing this |
| Claude Desktop | **No** (explicit selection) | Requires users to explicitly select resources |
| Claude Code | **Unclear** | No definitive documentation on ResourceLink auto-fetch |
| MCP Spec | **Does not mandate** | Spec is ambiguous; does not require auto-fetch |

The community consensus (Pydantic AI #3099) is moving toward:
- Leave ResourceLinks as references by default
- Expose a `read_resource` tool for selective fetching
- Include metadata hints (e.g., `_meta.retrieval_tool`) to help agents understand how to fetch

**Dual Response Pattern (arxiv:2510.05968):**

The recommended pattern combines both inline and ResourceLink:

1. Return limited preview data inline (for LLM reasoning)
2. Return a `resource_link` with URI for complete dataset retrieval
3. Include `QueryMetadata` (total_count, expiration, column definitions)
4. Client applications retrieve full data via RESTful endpoints that bypass the LLM context

Key requirements:
- Apply complete query specifications with limits, not random sampling
- Implement aggressive resource expiration to prevent accumulation
- Use OAuth 2.0 Bearer tokens for multi-tenant access
- Advertise capabilities during MCP initialization

### Practical Implications for blueprint-extractor-mcp

For blueprint extraction results:
- **Metadata/summaries:** Return inline (node counts, class hierarchy overview, widget tree summary)
- **Full blueprint JSON:** Return as ResourceLink URI
- **Individual node details:** Inline for targeted queries, ResourceLink for bulk exports
- **Threshold:** If extracted data exceeds ~5-10KB of text, use ResourceLink
- Do NOT assume Claude will auto-fetch ResourceLinks; design for explicit follow-up requests

---

## Confidence Summary

| Question | Confidence | Evidence Quality |
|----------|-----------|-----------------|
| Dynamic registration | High | SDK source code examined directly; Issue #893 confirms workaround; enable/disable/remove API verified in v1.27.1 |
| tools/list re-query | High (Claude Code), Medium (Claude Desktop) | Claude Code 2.1.0 confirmed via changelog + blog; Claude Desktop status unclear post-2025 |
| Progressive examples | High | 5+ real implementations found with source code; Speakeasy benchmarks provide quantitative data |
| ResourceLink | Medium-High | MCP spec examined; arxiv paper provides patterns; auto-fetch behavior varies and spec is ambiguous |

---

## Key Recommendations for blueprint-extractor-mcp

1. **Register all tools before connect, use enable/disable for progressive disclosure.** This avoids the `registerCapabilities` post-connect error and leverages the clean `tool.enable()`/`tool.disable()` API with automatic `list_changed` notifications.

2. **Don't rely solely on `list_changed` for discovery.** Claude Desktop support is uncertain. Instead, implement a meta-tool pattern (e.g., `searchBlueprints`) that works regardless of client notification support.

3. **Follow the Blockscout two-phase pattern:** Return blueprint metadata/structure first (Phase 1), then individual file/node contents on explicit request (Phase 2). This maps naturally to `listBlueprints` -> `extractBlueprint(specific_node)`.

4. **Use the Dual Response Pattern for large results:** Inline preview (first 10-100 items) + ResourceLink URI for complete data. This preserves context window while enabling full data access.

5. **Target the ProDisco two-tool model as the ideal end state:** `searchTools` + `runSandbox` equivalent for blueprint extraction. Minimal tool surface, maximum discovery capability.
