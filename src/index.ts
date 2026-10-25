import type {
  ExtensionAPI,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runCodemode } from "./core.ts";
import type { BridgeTool } from "./core.ts";
import { registerDurable } from "./durable.ts";

export const CODEMODE_TOOL_NAME = "codemode";

/** Tools scripts must not call (self-recursion). */
const EXCLUDED_TOOLS = new Set([
  "codemode",
  "durable_run",
  "durable_resume",
  "durable_status",
]);

/** Minimal structural view of the callable tools on `ExtensionToolContext`. */
interface CallableTool {
  name: string;
  description: string;
  parameters?: unknown;
  outputSchema?: unknown;
}

interface ToolOutcome {
  result: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
  };
  isError?: boolean;
}

function textOfResult(result: ToolOutcome["result"]): string {
  return (result.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => (b as { text?: string }).text ?? "")
    .join("\n");
}

/** Map the session's callable tools to sandbox tools invoked via `ctx.executeTool`. */
function toBridgeTools(ctx: ExtensionToolContext): BridgeTool[] {
  const callable = (ctx.tools ?? []) as readonly CallableTool[];
  return callable
    .filter((t) => !EXCLUDED_TOOLS.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters,
      execute: async (args: unknown, ctx2: { signal: AbortSignal }) => {
        const outcome = (await ctx.executeTool(t.name, args, {
          signal: ctx2.signal,
        })) as unknown as ToolOutcome;
        if (t.outputSchema && outcome.result.structuredContent !== undefined) {
          return outcome.result.structuredContent;
        }
        const text = textOfResult(outcome.result);
        if (outcome.isError) {
          throw new Error(text || `Tool "${t.name}" failed`);
        }
        return text;
      },
    }));
}

function renderDeclaration(t: CallableTool): string {
  const schema = t.parameters ? JSON.stringify(t.parameters) : "unknown";
  return `${t.name}(args: ${schema}): Promise<unknown>\n// ${t.description}`;
}

/** Discovery globals (upstream registers these as sandbox globals, not prelude built-ins). */
function discoveryGlobals(ctx: ExtensionToolContext): BridgeTool[] {
  const callable = ((ctx.tools ?? []) as readonly CallableTool[]).filter(
    (t) => !EXCLUDED_TOOLS.has(t.name),
  );
  return [
    {
      name: "searchTools",
      description: "Search callable tools by substring over name and description.",
      spread: true,
      execute: async (args) => {
        const [query, searchOptions] = args as [
          unknown,
          { limit?: number; namespace?: string }?,
        ];
        if (typeof query !== "string") {
          throw new Error("searchTools() expects a query string");
        }
        const limit = searchOptions?.limit ?? 8;
        const q = query.toLowerCase();
        const hits = callable
          .filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              t.description.toLowerCase().includes(q),
          )
          .slice(0, limit)
          .map((t) => ({ name: t.name, description: t.description }));
        return JSON.stringify(hits);
      },
    },
    {
      name: "describeTool",
      description: "Show one tool's declaration (name, parameter schema, description).",
      spread: true,
      execute: async (args) => {
        const [name] = args as [unknown];
        if (typeof name !== "string") {
          throw new Error("describeTool() expects a tool name");
        }
        const tool = callable.find((t) => t.name === name);
        return tool ? renderDeclaration(tool) : `unknown tool: ${name}`;
      },
    },
    {
      name: "describeNamespace",
      description: "List tools whose name starts with the given namespace prefix.",
      spread: true,
      execute: async (args) => {
        const [name] = args as [unknown];
        if (typeof name !== "string") {
          throw new Error("describeNamespace() expects a namespace name");
        }
        const hits = callable
          .filter((t) => t.name === name || t.name.startsWith(`${name}__`) || t.name.startsWith(`${name}_`))
          .map((t) => t.name);
        return JSON.stringify(hits);
      },
    },
  ];
}

// Adapted from upstream `DESCRIPTION_INTRO` + `describeGlobals`
// (pi-coding-agent `dist/extensions/codemode/tool.js:49-59`).
const CODEMODE_DESCRIPTION = `Run JavaScript that calls other tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level \`await\` and \`return\` work. No Node, file system, network, or timers.
- \`await tools.<name>({ ...args })\` resolves to a string, or an object if the tool's declaration says so, and rejects with an Error on failure. Calls still running when the script ends are cancelled.
Globals:
- \`text(value)\`, \`console.log(...)\`, and top-level \`return\` add output; \`exit()\` ends the script. \`image()\` also saves the image to a temp file and the result names its path.
- \`store(key, value)\` and \`load(key)\` keep JSON values across codemode calls.
- \`ALL_TOOLS\`, \`await searchTools(query, { limit?, namespace? })\`, \`await describeTool(name)\`, \`await describeNamespace(name)\`: find unlisted tools, such as MCP tools.`;

export default function piV1BridgeExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: CODEMODE_TOOL_NAME,
    label: "Codemode",
    description: CODEMODE_DESCRIPTION,
    parameters: Type.Object({
      code: Type.String({ description: "Raw JavaScript source." }),
    }),
    // Without this, omp scopes `ctx.tools` to nothing and scripts see zero
    // tools. Upstream codemode returns "all" for search/list scripts and the
    // script's words otherwise; scripts always search here, so "all".
    reachesTools: () => "all" as const,
    execute: async (toolCallId, params, signal, _onUpdate, ctx) => {
      const tools = toBridgeTools(ctx);
      const globals = discoveryGlobals(ctx);
      const { resultText, ok, raw } = await runCodemode(
        (params as { code: string }).code,
        tools,
        {
          globals,
          ...(signal ? { signal } : {}),
        },
      );
      void toolCallId;
      const calls = (raw as { calls?: unknown }).calls;
      return {
        content: [{ type: "text", text: resultText }],
        details: { calls },
        ...(ok ? {} : { isError: true }),
      };
    },
  });

  // Durable tools are experimental and OFF by default: parity scope is the
  // codemode tool only (vanilla Pi v1.4 wires neither durable nor chord into
  // the CLI). Set PI_V1_DURABLE=1 in the environment to register them.
  if (process.env.PI_V1_DURABLE === "1") {
    registerDurable(pi, () => []);
  }

  pi.registerCommand("pi-v1-status", {
    description: "Show pi-v1 bridge status (codemode + durable).",
    handler: async (_args, _ctx) => {
      const durableState =
        process.env.PI_V1_DURABLE === "1" ? "durable enabled (PI_V1_DURABLE=1)" : "durable off by default (set PI_V1_DURABLE=1 to enable)";
      return `pi-v1 bridge: codemode registered; ${durableState}.`;
    },
  });
}