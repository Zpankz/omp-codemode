// @bun
// node_modules/typebox/build/system/memory/metrics.mjs
var Metrics = {
  assign: 0,
  create: 0,
  clone: 0,
  discard: 0,
  update: 0
};

// node_modules/typebox/build/guard/guard.mjs
function IsArray(value) {
  return Array.isArray(value);
}
function IsNull(value) {
  return IsEqual(value, null);
}
function IsObject(value) {
  return IsEqual(typeof value, "object") && !IsNull(value);
}
function IsEqual(left, right) {
  return left === right;
}
function IsClassInstance(value) {
  if (!IsObject(value))
    return false;
  const proto = globalThis.Object.getPrototypeOf(value);
  if (IsNull(proto))
    return false;
  return IsEqual(typeof proto.constructor, "function") && !(IsEqual(proto.constructor, globalThis.Object) || IsEqual(proto.constructor.name, "Object"));
}
function IsUnsafePropertyKey(key) {
  return IsEqual(key, "__proto__") || IsEqual(key, "constructor") || IsEqual(key, "prototype");
}
function HasPropertyKey(value, key) {
  return IsUnsafePropertyKey(key) ? Object.prototype.hasOwnProperty.call(value, key) : (key in value);
}
function Keys(value) {
  return Object.getOwnPropertyNames(value);
}
function Symbols(value) {
  return Object.getOwnPropertySymbols(value);
}
// node_modules/typebox/build/guard/globals.mjs
function IsTypeArray(value) {
  return globalThis.ArrayBuffer.isView(value);
}
function IsRegExp(value) {
  return value instanceof globalThis.RegExp;
}
function IsSet(value) {
  return value instanceof globalThis.Set;
}
function IsMap(value) {
  return value instanceof globalThis.Map;
}
// node_modules/typebox/build/system/settings/settings.mjs
var settings = {
  immutableTypes: false,
  maxErrors: 8,
  maxInstantiationCount: 128,
  useAcceleration: true,
  exactOptionalPropertyTypes: false,
  enumerableKind: false,
  correctiveParse: false,
  unionPrioritySort: true
};
function Get() {
  return settings;
}
// node_modules/typebox/build/system/memory/freeze.mjs
function Freeze(value) {
  return Get().immutableTypes ? Object.freeze(value) : value;
}
// node_modules/typebox/build/system/memory/clone.mjs
function FromClassInstance(value) {
  return value;
}
function IsSchemaObject(value) {
  return HasPropertyKey(value, "~kind") || HasPropertyKey(value, "~unsafe");
}
function FromSchemaObject(value) {
  const result = {};
  for (const key of Keys(value)) {
    if (IsUnsafePropertyKey(key))
      continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    descriptor.value = FromValue(descriptor.value);
    if (IsEqual(descriptor.enumerable, true)) {
      result[key] = descriptor.value;
    } else {
      Object.defineProperty(result, key, descriptor);
    }
  }
  return result;
}
function FromPlainObject(value) {
  const result = {};
  for (const key of Keys(value)) {
    if (IsUnsafePropertyKey(key))
      continue;
    result[key] = FromValue(value[key]);
  }
  for (const key of Symbols(value)) {
    result[key] = FromValue(value[key]);
  }
  return result;
}
function FromObject(value) {
  return IsClassInstance(value) ? FromClassInstance(value) : IsSchemaObject(value) ? FromSchemaObject(value) : FromPlainObject(value);
}
function FromArray(value) {
  return value.map((element) => FromValue(element));
}
function FromTypedArray(value) {
  return value.slice();
}
function FromRegExp(value) {
  return new RegExp(value.source, value.flags);
}
function FromMap(value) {
  return new Map(FromValue([...value.entries()]));
}
function FromSet(value) {
  return new Set(FromValue([...value.values()]));
}
function FromValue(value) {
  return IsTypeArray(value) ? FromTypedArray(value) : IsRegExp(value) ? FromRegExp(value) : IsMap(value) ? FromMap(value) : IsSet(value) ? FromSet(value) : IsArray(value) ? FromArray(value) : IsObject(value) ? FromObject(value) : value;
}
function Clone(value) {
  Metrics.clone += 1;
  return FromValue(value);
}
// node_modules/typebox/build/system/memory/create.mjs
function MergeHidden(left, right) {
  for (const key of Object.keys(right)) {
    Object.defineProperty(left, key, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: right[key]
    });
  }
  return left;
}
function Merge(left, right) {
  return { ...left, ...right };
}
function Create(hidden, enumerable, options = {}) {
  Metrics.create += 1;
  const withOptions = Merge(enumerable, options);
  const withHidden = Get().enumerableKind ? Merge(withOptions, hidden) : MergeHidden(withOptions, hidden);
  return Freeze(withHidden);
}
// node_modules/typebox/build/system/memory/update.mjs
function Update(current, hidden, enumerable) {
  Metrics.update += 1;
  const settings = Get();
  const result = Clone(current);
  for (const key of Object.keys(hidden)) {
    Object.defineProperty(result, key, {
      configurable: true,
      writable: true,
      enumerable: settings.enumerableKind,
      value: hidden[key]
    });
  }
  for (const key of Object.keys(enumerable)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: enumerable[key]
    });
  }
  return Freeze(result);
}
// node_modules/typebox/build/type/types/schema.mjs
function IsSchema(value) {
  return IsObject(value);
}

// node_modules/typebox/build/type/engine/optional/instantiate_add.mjs
function AddOptionalOperation(type) {
  return Update(type, { "~optional": true }, {});
}
function AddOptionalAction(type, options) {
  const result = Update(AddOptionalOperation(type), {}, options);
  return result;
}

// node_modules/typebox/build/type/action/_add_optional.mjs
function AddOptional(type, options = {}) {
  return AddOptionalAction(type, options);
}

// node_modules/typebox/build/type/types/_optional.mjs
function Optional(type) {
  return AddOptional(type);
}
function IsOptional(value) {
  return IsSchema(value) && HasPropertyKey(value, "~optional");
}

// node_modules/typebox/build/type/types/properties.mjs
function RequiredArray(properties) {
  return Keys(properties).filter((key) => !IsOptional(properties[key]));
}

// node_modules/typebox/build/type/types/object.mjs
function _Object_(properties, options = {}) {
  const requiredKeys = RequiredArray(properties);
  const required = requiredKeys.length > 0 ? { required: requiredKeys } : {};
  return Create({ "~kind": "Object" }, { type: "object", ...required, properties }, options);
}
// node_modules/typebox/build/system/hashing/hash.mjs
var ByteMarker;
(function(ByteMarker) {
  ByteMarker[ByteMarker["Array"] = 0] = "Array";
  ByteMarker[ByteMarker["BigInt"] = 1] = "BigInt";
  ByteMarker[ByteMarker["Boolean"] = 2] = "Boolean";
  ByteMarker[ByteMarker["Date"] = 3] = "Date";
  ByteMarker[ByteMarker["Constructor"] = 4] = "Constructor";
  ByteMarker[ByteMarker["Function"] = 5] = "Function";
  ByteMarker[ByteMarker["Null"] = 6] = "Null";
  ByteMarker[ByteMarker["Number"] = 7] = "Number";
  ByteMarker[ByteMarker["Object"] = 8] = "Object";
  ByteMarker[ByteMarker["RegExp"] = 9] = "RegExp";
  ByteMarker[ByteMarker["String"] = 10] = "String";
  ByteMarker[ByteMarker["Symbol"] = 11] = "Symbol";
  ByteMarker[ByteMarker["TypeArray"] = 12] = "TypeArray";
  ByteMarker[ByteMarker["Undefined"] = 13] = "Undefined";
})(ByteMarker || (ByteMarker = {}));
var Accumulator = BigInt("14695981039346656037");
var [Prime, Size] = [BigInt("1099511628211"), BigInt("18446744073709551616")];
var Bytes = Array.from({ length: 256 }).map((_, i) => BigInt(i));
var F64 = new Float64Array(1);
var F64In = new DataView(F64.buffer);
var F64Out = new Uint8Array(F64.buffer);
var encoder = new TextEncoder;
// node_modules/typebox/build/type/types/integer.mjs
var IntegerPattern = "-?(?:0|[1-9][0-9]*)";
// node_modules/typebox/build/type/types/number.mjs
var NumberPattern = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?";
// node_modules/typebox/build/type/types/string.mjs
var StringPattern = ".*";
function String2(options) {
  return Create({ "~kind": "String" }, { type: "string" }, options);
}

// node_modules/typebox/build/type/types/record.mjs
var IntegerKey = `^${IntegerPattern}$`;
var NumberKey = `^${NumberPattern}$`;
var StringKey = `^${StringPattern}$`;
// node_modules/typebox/build/type/script/token/internal/char.mjs
function Range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => String.fromCharCode(start + i));
}
var Alpha = [
  ...Range(97, 122),
  ...Range(65, 90)
];
var Zero = "0";
var NonZero = Range(49, 57);
var Digit = [Zero, ...NonZero];
var UnderScore = "_";
var DollarSign = "$";

// node_modules/typebox/build/type/script/token/unsigned_integer.mjs
var AllowedDigits = [...Digit, UnderScore];
// node_modules/typebox/build/type/script/token/ident.mjs
var Initial = [...Alpha, UnderScore, DollarSign];
var Remaining = [...Initial, ...Digit];
// node_modules/typebox/build/type/script/token/unsigned_number.mjs
var AllowedDigits2 = [...Digit, UnderScore];
// node_modules/typebox/build/type/engine/helpers/keys.mjs
var integerKeyPattern = new RegExp("^(?:0|[1-9][0-9]*)$");

// node_modules/typebox/build/type/engine/indexed/from_object.mjs
var NumericKeyPattern = new RegExp(IntegerKey);
// src/core.ts
import { join } from "path";

// node_modules/@earendil-works/pi-codemode/dist/identifier.js
function toCodemodeIdentifier(name) {
  let identifier = "";
  for (const char of name) {
    const valid = identifier === "" ? /^[A-Za-z_$]$/.test(char) : /^[A-Za-z0-9_$]$/.test(char);
    identifier += valid ? char : "_";
  }
  return identifier === "" ? "_" : identifier;
}

// node_modules/@earendil-works/pi-codemode/dist/declarations.js
var LOWER_BOUNDS = new Set(["minimum", "exclusiveMinimum", "minLength", "minItems"]);
var UPPER_BOUNDS = new Set(["maximum", "exclusiveMaximum", "maxLength", "maxItems"]);
// node_modules/@earendil-works/pi-codemode/dist/runtime/protocol.js
function isWorkerToHostMessage(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const type = value.type;
  return type === "call" || type === "output" || type === "done" || type === "crash" || type === "started" || type === "idle";
}

// node_modules/@earendil-works/pi-codemode/dist/runtime/execution.js
var DEFAULT_TIMEOUT_MS = 300000;
var IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
var RESERVED_GLOBALS = new Set([
  "tools",
  "ALL_TOOLS",
  "console",
  "text",
  "image",
  "exit",
  "globalThis",
  "store",
  "load"
]);
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function serializeStore(store) {
  const serialized = {};
  for (const [key, value] of Object.entries(store ?? {})) {
    const json = JSON.stringify(value);
    if (json !== undefined)
      serialized[key] = json;
  }
  return serialized;
}

class BridgeError extends Error {
}
function parseBridgeJson(json, what) {
  try {
    return JSON.parse(json);
  } catch {
    throw new BridgeError(`${what} is not valid JSON`);
  }
}
function parseStoreWrites(json) {
  const entries = parseBridgeJson(json, "store writes");
  if (!Array.isArray(entries))
    throw new BridgeError("store writes are not an array");
  const writes = { set: {}, delete: [] };
  for (const entry of entries) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || (entry.length === 2 ? typeof entry[1] !== "string" : entry.length !== 1)) {
      throw new BridgeError("store writes contain a malformed entry");
    }
    const [key, value] = entry;
    if (value === undefined)
      writes.delete.push(key);
    else
      writes.set[key] = parseBridgeJson(value, `store value for ${JSON.stringify(key)}`);
  }
  return writes;
}
function parseScriptError(json) {
  const parsed = parseBridgeJson(json, "script error");
  if (typeof parsed !== "object" || parsed === null)
    throw new BridgeError("script error is not an object");
  const { name, message, stack } = parsed;
  if (typeof message !== "string" || name !== undefined && typeof name !== "string" || stack !== undefined && typeof stack !== "string") {
    throw new BridgeError("script error is malformed");
  }
  return { kind: "script", name, message, stack };
}
function checkGlobals(globals) {
  const names = new Set;
  const namespaces = new Set;
  for (const global of globals) {
    const parts = global.name.split(".");
    if (parts.length > 2 || !parts.every((part) => IDENTIFIER.test(part)) || RESERVED_GLOBALS.has(parts[0])) {
      throw new Error(`Invalid global name "${global.name}"`);
    }
    if (names.has(global.name))
      throw new Error(`Global "${global.name}" is already registered`);
    if (parts.length === 2)
      namespaces.add(parts[0]);
    names.add(global.name);
  }
  for (const name of namespaces) {
    if (names.has(name))
      throw new Error(`Global "${name}" conflicts with the namespace "${name}"`);
  }
}

class Execution {
  promise;
  resolveResult;
  channel;
  unsent = [];
  executors;
  control;
  delivered = new Set;
  signal;
  timer;
  output = [];
  calls = [];
  pending = new Map;
  finished = false;
  constructor(options) {
    this.promise = new Promise((resolve) => {
      this.resolveResult = resolve;
    });
    this.executors = options.executors;
    this.control = options.control;
    this.signal = options.signal;
    if (Number.isFinite(options.timeoutMs)) {
      this.timer = setTimeout(() => {
        this.finish({ kind: "timeout", message: `Execution timed out after ${options.timeoutMs} ms` });
      }, options.timeoutMs);
    }
    if (options.signal) {
      if (options.signal.aborted) {
        this.onAbort();
      } else {
        options.signal.addEventListener("abort", this.onAbort, { once: true });
      }
    }
    if (this.finished)
      return;
    const data = {
      code: options.code,
      tools: options.tools.map((tool) => ({
        name: tool.name,
        jsName: tool.jsName ?? toCodemodeIdentifier(tool.name),
        description: tool.description ?? ""
      })),
      globals: options.globals.map((global) => ({ name: global.name, spread: global.spread === true })),
      memoryLimitBytes: options.memoryLimitBytes,
      store: options.store,
      ...options.deterministic ? { deterministic: options.deterministic } : {}
    };
    const events = {
      message: (message) => this.receive(message),
      failure: (error) => this.finish(error)
    };
    new Promise((resolve) => resolve(options.launch(data, events))).then((channel) => {
      if (this.finished) {
        channel.stop().catch(() => {
          return;
        });
        return;
      }
      this.channel = channel;
      for (const message of this.unsent.splice(0))
        channel.post(message);
    }, (error) => {
      this.finish({ kind: "sandbox", message: errorMessage(error) });
    });
  }
  deliver(seq, now, id, outcome) {
    if (this.finished)
      return;
    if (!Number.isFinite(now))
      throw new Error(`The clock value of result ${seq} is not a finite number`);
    if (!Number.isInteger(seq) || seq < 1 || this.delivered.has(seq)) {
      throw new Error(`Result number ${seq} is not a positive integer used once`);
    }
    const pending = this.pending.get(id);
    if (pending === undefined)
      throw new Error(`Call ${id} is not waiting for a result`);
    if (!outcome.ok && outcome.properties !== undefined) {
      const { properties } = outcome;
      if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
        throw new Error(`The properties of result ${seq} are not an object`);
      }
    }
    const payload = outcome.ok ? outcome.value === undefined ? undefined : JSON.stringify(outcome.value) : outcome.message;
    const properties = !outcome.ok && outcome.properties !== undefined ? JSON.stringify(outcome.properties) : undefined;
    this.delivered.add(seq);
    this.pending.delete(id);
    if (pending.record) {
      pending.record.status = outcome.ok ? "ok" : "error";
      pending.record.durationMs = performance.now() - pending.startedAt;
    }
    this.post({
      type: "result",
      id,
      ok: outcome.ok,
      payload,
      seq,
      now,
      ...properties === undefined ? {} : { properties }
    });
  }
  abort(message) {
    this.finish({ kind: "aborted", message });
    return this.promise;
  }
  onAbort = () => {
    const reason = this.signal?.reason;
    this.finish({ kind: "aborted", message: reason instanceof Error ? reason.message : "Execution aborted" });
  };
  post(message) {
    if (this.channel)
      this.channel.post(message);
    else
      this.unsent.push(message);
  }
  receive(message) {
    try {
      this.handleMessage(message);
    } catch (error) {
      this.finish({
        kind: "sandbox",
        message: error instanceof BridgeError ? `Sandbox bridge broken: ${error.message}. The script may have modified built-ins such as a prototype's toJSON.` : `Sandbox host failed: ${errorMessage(error)}`
      });
    }
  }
  handleMessage(message) {
    if (this.finished)
      return;
    if (!isWorkerToHostMessage(message))
      throw new BridgeError("unknown message from the worker");
    switch (message.type) {
      case "output":
        this.output.push(message.item);
        break;
      case "call":
        if (this.pending.has(message.id))
          throw new BridgeError(`duplicate call id ${message.id}`);
        if (this.control)
          this.forwardCall(message, this.control);
        else
          this.handleCall(message);
        break;
      case "started":
        this.control?.onStarted?.(message.fingerprint);
        break;
      case "idle":
        this.control?.onIdle?.(message.seq, message.issued);
        break;
      case "done":
        this.handleDone(message);
        break;
      case "crash":
        this.finish({ kind: "sandbox", message: message.message });
        break;
    }
  }
  handleDone(message) {
    if (!message.ok) {
      this.finish(parseScriptError(message.error), undefined, undefined, message.during);
      return;
    }
    const value = message.value === undefined ? undefined : parseBridgeJson(message.value, "return value");
    this.finish(undefined, value, parseStoreWrites(message.writes), message.during);
  }
  forwardCall(message, control) {
    const { id, name, target } = message;
    const args = message.args === undefined ? undefined : parseBridgeJson(message.args, "call arguments");
    const record = target === "tool" ? { name, status: "cancelled", durationMs: 0 } : undefined;
    if (record)
      this.calls.push(record);
    this.pending.set(id, { record, startedAt: performance.now(), controller: new AbortController });
    control.onCall({ id, target, name, args });
  }
  async handleCall(message) {
    const { id, name } = message;
    const isTool = message.target === "tool";
    const record = isTool ? { name, status: "cancelled", durationMs: 0 } : undefined;
    if (record)
      this.calls.push(record);
    const pending = { record, startedAt: performance.now(), controller: new AbortController };
    this.pending.set(id, pending);
    let status;
    let reply;
    try {
      const tool = (isTool ? this.executors.tools : this.executors.globals).get(name);
      if (!tool)
        throw new Error(`Unknown ${isTool ? "tool" : "global"} "${name}"`);
      const args = message.args === undefined ? undefined : JSON.parse(message.args);
      const value = await tool.execute(args, { signal: pending.controller.signal });
      reply = { type: "result", id, ok: true, payload: value === undefined ? undefined : JSON.stringify(value) };
      status = "ok";
    } catch (error) {
      reply = { type: "result", id, ok: false, payload: errorMessage(error) };
      status = "error";
    }
    if (!this.pending.delete(id))
      return;
    if (record) {
      record.status = status;
      record.durationMs = performance.now() - pending.startedAt;
    }
    this.post(reply);
  }
  finish(error, value, writes, during) {
    if (this.finished)
      return;
    this.finished = true;
    clearTimeout(this.timer);
    this.signal?.removeEventListener("abort", this.onAbort);
    const now = performance.now();
    for (const pending of this.pending.values()) {
      if (pending.record)
        pending.record.durationMs = now - pending.startedAt;
      pending.controller.abort();
    }
    this.pending.clear();
    this.unsent = [];
    const ended = during === undefined ? {} : { during: { seq: during.seq, issued: during.issued } };
    const result = error ? { ok: false, error, output: this.output, calls: this.calls, ...ended } : {
      ok: true,
      value,
      output: this.output,
      calls: this.calls,
      storeWrites: writes ?? { set: {}, delete: [] },
      ...ended
    };
    if (!this.channel) {
      this.resolveResult(result);
      return;
    }
    this.channel.stop().catch(() => {
      return;
    }).then(() => this.resolveResult(result));
  }
}

class CodemodeSandboxBase {
  toolsByName = new Map;
  globalsByName = new Map;
  timeoutMs;
  memoryLimitBytes;
  launch;
  running = new Set;
  closed = false;
  constructor(options, launch) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.memoryLimitBytes = options.memoryLimitBytes;
    this.launch = launch;
    for (const tool of options.tools ?? [])
      this.registerTool(tool);
    checkGlobals(options.globals ?? []);
    for (const global of options.globals ?? [])
      this.globalsByName.set(global.name, global);
  }
  registerTool(tool) {
    if (this.toolsByName.has(tool.name))
      throw new Error(`Tool "${tool.name}" is already registered`);
    this.toolsByName.set(tool.name, tool);
  }
  unregisterTool(name) {
    return this.toolsByName.delete(name);
  }
  get tools() {
    return [...this.toolsByName.values()];
  }
  get globals() {
    return [...this.globalsByName.values()];
  }
  execute(code, options = {}) {
    if (this.closed)
      return Promise.reject(new Error("Sandbox is closed"));
    const tools = new Map(this.toolsByName);
    const execution = new Execution({
      code,
      tools: [...tools.values()],
      globals: [...this.globalsByName.values()],
      executors: { tools, globals: this.globalsByName },
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      signal: options.signal,
      memoryLimitBytes: this.memoryLimitBytes,
      store: serializeStore(options.store),
      launch: this.launch
    });
    this.running.add(execution);
    return execution.promise.finally(() => this.running.delete(execution));
  }
  start(code, options) {
    if (this.closed)
      throw new Error("Sandbox is closed");
    if (!Number.isFinite(options.startedAt) || options.startedAt < 0) {
      throw new Error("startedAt must be a non-negative number of milliseconds since the epoch");
    }
    if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 4294967295) {
      throw new Error("seed must be a 32-bit unsigned integer");
    }
    const tools = options.tools ?? [];
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
      throw new Error("Tool names must be unique");
    const scriptNames = tools.map((tool) => tool.jsName ?? toCodemodeIdentifier(tool.name));
    if (new Set(scriptNames).size !== tools.length)
      throw new Error("Tool script names must be unique");
    const globals = options.globals ?? [];
    checkGlobals(globals);
    const execution = new Execution({
      code,
      tools,
      globals,
      executors: { tools: new Map, globals: new Map },
      timeoutMs: options.timeoutMs ?? Number.POSITIVE_INFINITY,
      signal: options.signal,
      memoryLimitBytes: this.memoryLimitBytes,
      store: serializeStore(options.store),
      deterministic: { startedAt: options.startedAt, seed: options.seed },
      control: { onStarted: options.onStarted, onCall: options.onCall, onIdle: options.onIdle },
      launch: this.launch
    });
    this.running.add(execution);
    const result = execution.promise.finally(() => this.running.delete(execution));
    return {
      result,
      deliver: (seq, now, id, outcome) => execution.deliver(seq, now, id, outcome),
      get finished() {
        return execution.finished;
      }
    };
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.running].map((execution) => execution.abort("Sandbox closed")));
  }
}
// node_modules/@earendil-works/pi-codemode/dist/runtime/host.js
import { Worker } from "worker_threads";

// node_modules/@earendil-works/pi-codemode/dist/wasm.js
import { readFile } from "fs/promises";
import { createRequire } from "module";
var modules = new Map;
function loadQuickJSWasm(path) {
  const resolved = path ?? createRequire(import.meta.url).resolve("quickjs-wasi/quickjs.wasm");
  let module = modules.get(resolved);
  if (!module) {
    const { WebAssembly: WebAssembly2 } = globalThis;
    module = readFile(resolved).then((bytes) => WebAssembly2.compile(bytes)).catch((error) => {
      modules.delete(resolved);
      throw error;
    });
    modules.set(resolved, module);
  }
  return module;
}

// node_modules/@earendil-works/pi-codemode/dist/runtime/host.js
function defaultWorkerUrl() {
  return new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url);
}
function workerLauncher(options) {
  return async (data, events) => {
    let module;
    try {
      module = await (options.wasm ?? loadQuickJSWasm());
    } catch (error) {
      throw new Error(`Failed to load QuickJS: ${errorMessage(error)}`);
    }
    const interrupt = new SharedArrayBuffer(4);
    const workerData = { ...data, wasm: module, interrupt };
    const releaseWorker = options.acquireWorker?.();
    let worker;
    try {
      worker = new Worker(options.workerUrl ?? defaultWorkerUrl(), { workerData });
    } catch (error) {
      releaseWorker?.();
      throw new Error(`Failed to start worker: ${errorMessage(error)}`);
    }
    if (releaseWorker)
      worker.once("exit", releaseWorker);
    worker.on("message", (message) => {
      if (typeof message === "object" && message !== null && (("watch:import" in message) || ("watch:require" in message)))
        return;
      events.message(message);
    });
    worker.on("error", (error) => {
      events.failure({
        kind: "sandbox",
        name: error instanceof Error ? error.name : undefined,
        message: errorMessage(error)
      });
    });
    worker.on("exit", (code) => {
      events.failure({ kind: "sandbox", message: `Worker exited with code ${code} before the script settled` });
    });
    const stop = async () => {
      Atomics.store(new Int32Array(interrupt), 0, 1);
      worker.terminate().catch(() => {
        return;
      });
      worker.unref();
    };
    try {
      options.onWorkerStarted?.(new Promise((resolve) => worker.once("exit", () => resolve())));
    } catch (error) {
      stop();
      throw error;
    }
    return { post: (message) => worker.postMessage(message), stop };
  };
}

class CodemodeSandbox extends CodemodeSandboxBase {
  constructor(options = {}) {
    super(options, workerLauncher(options));
  }
}
// node_modules/quickjs-wasi/dist/extensions.js
var decoder = new TextDecoder;

// node_modules/quickjs-wasi/dist/index.js
var __disposeResources = function(SuppressedError2) {
  return function(env) {
    function fail(e) {
      env.error = env.hasError ? new SuppressedError2(e, env.error, "An error was suppressed during disposal.") : e;
      env.hasError = true;
    }
    var r, s = 0;
    function next() {
      while (r = env.stack.pop()) {
        try {
          if (!r.async && s === 1)
            return s = 0, env.stack.push(r), Promise.resolve().then(next);
          if (r.dispose) {
            var result = r.dispose.call(r.value);
            if (r.async)
              return s |= 2, Promise.resolve(result).then(next, function(e) {
                fail(e);
                return next();
              });
          } else
            s |= 1;
        } catch (e) {
          fail(e);
        }
      }
      if (s === 1)
        return env.hasError ? Promise.reject(env.error) : Promise.resolve();
      if (env.hasError)
        throw env.error;
    }
    return next();
  };
}(typeof SuppressedError === "function" ? SuppressedError : function(error, suppressed, message) {
  var e = new Error(message);
  return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
var MAX_STACK_SIZE = 512 * 1024;
var EvalFlags = {
  TYPE_GLOBAL: 0,
  TYPE_MODULE: 1 << 0,
  STRICT: 1 << 3,
  COMPILE_ONLY: 1 << 5,
  BACKTRACE_BARRIER: 1 << 6,
  ASYNC: 1 << 7
};
var CompileFlags = {
  STRIP_SOURCE: 1 << 4,
  STRIP_DEBUG: 1 << 5
};
var Intrinsics = {
  DATE: 1 << 0,
  EVAL: 1 << 1,
  REGEXP: 1 << 2,
  JSON: 1 << 3,
  PROXY: 1 << 4,
  MAP_SET: 1 << 5,
  TYPED_ARRAYS: 1 << 6,
  PROMISE: 1 << 7,
  BIG_INT: 1 << 8,
  WEAK_REF: 1 << 9,
  PERFORMANCE: 1 << 10,
  DOM_EXCEPTION: 1 << 11,
  ATOB_BTOA: 1 << 12,
  ALL: 4294967295
};
var wtf8Decoder = new TextDecoder;
var wtf8Encoder = new TextEncoder;

// node_modules/@earendil-works/pi-codemode/dist/runtime/prelude-source.js
var MAX_STORE_VALUE_CHARS = 256 * 1024;
var MAX_STORE_TOTAL_CHARS = 1024 * 1024;
var MAX_OUTPUT_CHARS = 16 * 1024 * 1024;
var MAX_OUTPUT_ITEMS = 1e5;
var IMAGE_HELPER_EXPECTS = 'image expects a non-empty image URL string, an object with image_url, or an image block { type: "image", data, mimeType }';
var PRELUDE_SOURCE = `(function (bridge, toolsJson, globalsJson, storeJson) {
	"use strict";

	// Freeze every object reachable from the built-in globals, plus the intrinsics that are only
	// reachable from instances (iterator and generator prototypes, %TypedArray%).
	//
	// Freezing alone breaks ordinary code through the "override mistake": a data property that is
	// read-only on a prototype cannot be assigned on an instance either, so
	// this.name = "MyError" in an Error subclass would throw. Commonly overridden properties
	// become accessors whose setter defines an own property on the instance instead.
	(function lockdown() {
		const OVERRIDABLE = new Set(["constructor", "name", "message", "toString", "toLocaleString", "valueOf", "toJSON"]);
		const seen = new Set([globalThis]);
		const queue = [];
		const add = (value) => {
			if ((typeof value === "object" && value !== null) || typeof value === "function") {
				if (!seen.has(value)) {
					seen.add(value);
					queue.push(value);
				}
			}
		};

		// Accessors from an object literal have no own prototype object, unlike function expressions,
		// whose prototype.constructor would be converted again without end.
		function allowOverride(object, key, value, enumerable) {
			const { get, set } = Object.getOwnPropertyDescriptor(
				{
					get accessor() {
						return value;
					},
					set accessor(next) {
						if (this === object) {
							throw new TypeError("Cannot assign to read only property '" + String(key) + "' of a built-in");
						}
						if ((typeof this !== "object" || this === null) && typeof this !== "function") return;
						Object.defineProperty(this, key, { value: next, writable: true, enumerable: true, configurable: true });
					},
				},
				"accessor",
			);
			Object.defineProperty(object, key, { get, set, enumerable, configurable: false });
			add(get);
			add(set);
		}

		for (const key of Reflect.ownKeys(globalThis)) {
			const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
			add(descriptor.value);
			add(descriptor.get);
			add(descriptor.set);
			if ("value" in descriptor && descriptor.configurable) {
				Object.defineProperty(globalThis, key, { writable: false, configurable: false });
			}
		}
		add(Object.getPrototypeOf(function* () {}));
		add(Object.getPrototypeOf(async function () {}));
		add(Object.getPrototypeOf(async function* () {}));
		add(Object.getPrototypeOf(Int8Array));
		add(Object.getPrototypeOf([][Symbol.iterator]()));
		add(Object.getPrototypeOf(new Map()[Symbol.iterator]()));
		add(Object.getPrototypeOf(new Set()[Symbol.iterator]()));
		add(Object.getPrototypeOf(""[Symbol.iterator]()));
		add(Object.getPrototypeOf(/a/[Symbol.matchAll]("")));
		if (typeof Iterator === "function") {
			if (typeof Iterator.prototype.map === "function") add(Object.getPrototypeOf([].values().map((x) => x)));
			if (typeof Iterator.from === "function") add(Object.getPrototypeOf(Iterator.from({ next() {} })));
		}

		while (queue.length > 0) {
			const object = queue.pop();
			add(Object.getPrototypeOf(object));
			const descriptors = Object.getOwnPropertyDescriptors(object);
			for (const key of Reflect.ownKeys(descriptors)) {
				const descriptor = descriptors[key];
				if ("value" in descriptor) {
					add(descriptor.value);
					if (
						descriptor.writable &&
						descriptor.configurable &&
						(object === Object.prototype || OVERRIDABLE.has(key))
					) {
						allowOverride(object, key, descriptor.value, descriptor.enumerable);
					}
				} else {
					add(descriptor.get);
					add(descriptor.set);
				}
			}
			Object.freeze(object);
		}
	})();
	const stringify = JSON.stringify;
	const parse = JSON.parse;
	const promiseThen = Promise.prototype.then;
	const ErrorCtor = Error;
	const TypeErrorCtor = TypeError;
	const RangeErrorCtor = RangeError;
	const pending = new Map();
	let nextId = 1;
	let finished = false;
	// Thrown by exit() to unwind the script after it already reported success.
	const EXIT = Object.freeze({});

	function done(ok, payload, writes) {
		if (finished) return;
		finished = true;
		bridge("done", ok, payload, writes);
	}

	function serialize(value) {
		return value === undefined ? undefined : stringify(value);
	}

	// QuickJS stacks list frames only. Prefix "Name: message" like V8 so the
	// text reads the same as a Node error, and drop this prelude's frames.
	function errorText(error) {
		const head = error.message ? error.name + ": " + error.message : String(error.name);
		const frames =
			typeof error.stack === "string"
				? error.stack.split("\\n").filter((line) => line.trim() && !line.includes("codemode-prelude.js"))
				: [];
		return [head, ...frames].join("\\n");
	}

	function format(value) {
		if (typeof value === "string") return value;
		if (value instanceof ErrorCtor) return errorText(value);
		try {
			const json = stringify(value);
			return json === undefined ? String(value) : json;
		} catch {
			return String(value);
		}
	}

	// The host requires string fields. A script can set an error's name or message to anything, so
	// they are coerced, and a value whose coercion throws gets a placeholder.
	function describeError(error) {
		try {
			if (error instanceof ErrorCtor) {
				return stringify({ name: String(error.name), message: String(error.message), stack: errorText(error) });
			}
			return stringify({ message: String(format(error)) });
		} catch {
			return stringify({ message: "The script threw a value that cannot be described" });
		}
	}

	function caller(kind, name, spread) {
		return (...args) =>
			new Promise((resolve, reject) => {
				let json;
				try {
					json = serialize(spread ? args : args[0]);
				} catch (error) {
					reject(error);
					return;
				}
				const id = nextId++;
				pending.set(id, { resolve, reject });
				bridge(kind, id, name, json);
			});
	}

	const tools = Object.create(null);
	const allTools = [];
	for (const { name, jsName, description } of parse(toolsJson)) {
		const fn = caller("call", name);
		// The first tool wins when two names normalize to the same identifier.
		if (!(jsName in tools)) {
			tools[jsName] = fn;
			allTools.push(Object.freeze({ name: jsName, description }));
		}
		if (!(name in tools)) tools[name] = fn;
	}
	Object.freeze(tools);
	Object.freeze(allTools);

	// Reading a member that does not exist throws an error that names the close matches, instead of
	// a later "not a function". \`in\` checks still work.
	const comparable = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
	function guard(target, label, names, hint) {
		return new Proxy(target, {
			get(object, property, receiver) {
				if (typeof property !== "string" || property in object || property in Object.prototype || property === "then" || property === "toJSON") {
					return Reflect.get(object, property, receiver);
				}
				const wanted = comparable(property);
				const exact = names.filter((name) => comparable(name) === wanted);
				const close = exact.length > 0 ? exact : names.filter((name) => wanted && (comparable(name).includes(wanted) || wanted.includes(comparable(name))));
				let message = label + "." + property + " does not exist.";
				if (close.length > 0) message += " Did you mean " + close.slice(0, 5).map((name) => label + "." + name).join(", ") + "?";
				else if (names.length <= 20) message += " Available: " + names.join(", ") + ".";
				if (hint) message += " " + hint;
				message += ' Check for a member with "' + property + '" in ' + label + ".";
				throw new TypeErrorCtor(message);
			},
		});
	}
	const toolsProxy = guard(
		tools,
		"tools",
		allTools.map((tool) => tool.name),
		"ALL_TOOLS lists every tool; searchTools(query) finds tools by topic.",
	);

	const namespaces = new Map();
	for (const { name, spread } of parse(globalsJson)) {
		const fn = caller("global", name, spread);
		const dot = name.indexOf(".");
		if (dot === -1) {
			Object.defineProperty(globalThis, name, { value: fn, enumerable: true });
			continue;
		}
		const namespace = name.slice(0, dot);
		if (!namespaces.has(namespace)) namespaces.set(namespace, Object.create(null));
		namespaces.get(namespace)[name.slice(dot + 1)] = fn;
	}
	for (const [namespace, members] of namespaces) {
		Object.freeze(members);
		const value = guard(members, namespace, Object.keys(members));
		Object.defineProperty(globalThis, namespace, { value, enumerable: true });
	}

	// key -> JSON text. Sizes count key and JSON characters.
	const stored = new Map(Object.entries(parse(storeJson)));
	const writes = new Map();
	let storedChars = 0;
	for (const [key, json] of stored) storedChars += key.length + json.length;

	const STORE_HINT =
		"store() is for small state such as IDs or summaries. Show images with image(), keep large data in variables, or write it to a file with a tool.";

	function checkKey(name, key) {
		if (typeof key !== "string") throw new TypeError(name + "() key must be a string");
	}

	function store(key, value) {
		checkKey("store", key);
		const previous = stored.has(key) ? key.length + stored.get(key).length : 0;
		if (value === undefined) {
			stored.delete(key);
			storedChars -= previous;
			writes.set(key, undefined);
			return;
		}
		let json;
		try {
			json = stringify(value);
		} catch (error) {
			throw new TypeError("store(" + stringify(key) + ") value is not JSON-serializable: " + format(error));
		}
		if (json === undefined) {
			throw new TypeError("store(" + stringify(key) + ") value is not JSON-serializable");
		}
		if (json.length > ${MAX_STORE_VALUE_CHARS}) {
			throw new RangeError(
				"store(" + stringify(key) + ") value has " + json.length + " characters of JSON, more than the limit of ${MAX_STORE_VALUE_CHARS}. " +
					STORE_HINT,
			);
		}
		const next = storedChars - previous + key.length + json.length;
		if (next > ${MAX_STORE_TOTAL_CHARS}) {
			throw new RangeError(
				"store is full: stored values would exceed ${MAX_STORE_TOTAL_CHARS} characters of JSON. Delete keys with store(key, undefined). " +
					STORE_HINT,
			);
		}
		stored.set(key, json);
		storedChars = next;
		writes.set(key, json);
	}

	function load(key) {
		checkKey("load", key);
		const json = stored.get(key);
		return json === undefined ? undefined : parse(json);
	}

	function serializeWrites() {
		const entries = [];
		for (const [key, json] of writes) entries.push(json === undefined ? [key] : [key, json]);
		return stringify(entries);
	}

	Object.defineProperty(globalThis, "store", { value: store, enumerable: true });
	Object.defineProperty(globalThis, "load", { value: load, enumerable: true });

	let outputChars = 0;
	let outputItems = 0;

	// Past the output limits the script fails: done() reports the error, so catching it does not
	// resume output, and the host ends the script.
	function output(kind, data, mimeType) {
		if (finished) return;
		outputChars += data.length;
		outputItems++;
		if (outputChars > ${MAX_OUTPUT_CHARS} || outputItems > ${MAX_OUTPUT_ITEMS}) {
			const error = new RangeErrorCtor(
				"script output exceeded the limit of ${MAX_OUTPUT_CHARS} characters or ${MAX_OUTPUT_ITEMS} text(), image(), and console calls. " +
					"Print a summary instead, or write large data to a file with a tool.",
			);
			done(false, describeError(error));
			throw error;
		}
		bridge("output", kind, data, mimeType);
	}

	// Primitives become their string form, everything else JSON.
	function outputText(value) {
		if (value === undefined || value === null || typeof value !== "object" && typeof value !== "function") {
			return String(value);
		}
		const json = stringify(value);
		return json === undefined ? String(value) : json;
	}

	function text(value) {
		let rendered;
		try {
			rendered = outputText(value);
		} catch (error) {
			throw new TypeErrorCtor(error instanceof ErrorCtor ? error.message : String(error));
		}
		output("text", rendered);
	}

	function imageUrl(value) {
		if (typeof value === "string") return value;
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			throw new TypeErrorCtor(${JSON.stringify(IMAGE_HELPER_EXPECTS)});
		}
		if (value.image_url !== undefined) {
			if (typeof value.image_url !== "string") throw new TypeErrorCtor(${JSON.stringify(IMAGE_HELPER_EXPECTS)});
			return value.image_url;
		}
		if (typeof value.type !== "string") throw new TypeErrorCtor(${JSON.stringify(IMAGE_HELPER_EXPECTS)});
		if (value.type !== "image") {
			throw new TypeErrorCtor('image only accepts image blocks, got "' + value.type + '"');
		}
		if (typeof value.data !== "string" || value.data === "") throw new TypeErrorCtor("image expected image block data");
		if (value.data.toLowerCase().startsWith("data:")) return value.data;
		return "data:;base64," + value.data;
	}

	// Base64 of the signatures of the formats providers accept inline (PNG, JPEG except
	// JPEG-LS, GIF, "RIFF....WEBP"). Signatures start at byte 0, so their encodings are prefixes.
	const IMAGE_SIGNATURES = [
		["image/png", /^iVBORw0KGg/],
		["image/jpeg", /^[/]9j[/](?!9)/],
		["image/gif", /^R0lGOD[dl]h/],
		["image/webp", /^UklG.{8}RUJQ/],
	];

	function image(value) {
		const url = imageUrl(value);
		if (url === "") throw new TypeErrorCtor(${JSON.stringify(IMAGE_HELPER_EXPECTS)});
		const colon = url.indexOf(":");
		const scheme = colon === -1 ? "" : url.slice(0, colon).toLowerCase();
		if (scheme === "http" || scheme === "https") {
			throw new TypeErrorCtor("remote image URLs are not supported in tool outputs. Pass a base64 data URI instead");
		}
		const comma = url.indexOf(",");
		const header = comma === -1 ? [] : url.slice(colon + 1, comma).split(";");
		if (scheme !== "data" || comma === -1 || header.slice(1).every((part) => part.toLowerCase() !== "base64")) {
			throw new TypeErrorCtor("invalid image output. Pass a base64 data URI instead");
		}
		// Providers reject the whole request on a bad image, and a persisted image block would be
		// resent on every later turn. Line breaks from wrapped base64 are dropped. The declared type
		// is ignored in favor of the detected one, as providers also reject mismatches.
		const data = url.slice(comma + 1).replace(/\\s+/g, "");
		if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
			throw new TypeErrorCtor("invalid image output. The image data is not valid base64 (truncated or corrupted?)");
		}
		const head = data.slice(0, 16);
		const signature = IMAGE_SIGNATURES.find(([, pattern]) => pattern.test(head));
		if (!signature) {
			throw new TypeErrorCtor("invalid image output. The image data is not a PNG, JPEG, GIF, or WebP image");
		}
		output("image", data, signature[0]);
	}

	function exit() {
		let writesJson;
		try {
			writesJson = serializeWrites();
		} catch (error) {
			done(false, describeError(error));
			throw EXIT;
		}
		done(true, undefined, writesJson);
		throw EXIT;
	}

	const console = {};
	for (const level of ["log", "info", "warn", "error", "debug"]) {
		console[level] = (...args) => {
			output("console", args.map(format).join(" "));
		};
	}
	Object.freeze(console);

	Object.defineProperty(globalThis, "tools", { value: toolsProxy, enumerable: true });
	Object.defineProperty(globalThis, "ALL_TOOLS", { value: allTools, enumerable: true });
	Object.defineProperty(globalThis, "console", { value: console, enumerable: true });
	Object.defineProperty(globalThis, "text", { value: text, enumerable: true });
	Object.defineProperty(globalThis, "image", { value: image, enumerable: true });
	Object.defineProperty(globalThis, "exit", { value: exit, enumerable: true });

	return {
		settle(id, ok, payload, propertiesJson) {
			const entry = pending.get(id);
			if (!entry) return;
			pending.delete(id);
			if (!ok) {
				const error = new ErrorCtor(payload);
				if (propertiesJson !== undefined) {
					const properties = parse(propertiesJson);
					for (const key of Object.keys(properties)) {
						if (key === "name" || key === "message" || key === "stack") continue;
						Object.defineProperty(error, key, { value: properties[key], writable: true, enumerable: true, configurable: true });
					}
				}
				entry.reject(error);
				return;
			}
			let value;
			try {
				value = payload === undefined ? undefined : parse(payload);
			} catch (error) {
				entry.reject(error);
				return;
			}
			entry.resolve(value);
		},
		run(fn) {
			let promise;
			try {
				promise = fn(toolsProxy, console);
			} catch (error) {
				done(false, describeError(error));
				return;
			}
			promiseThen.call(
				promise,
				(value) => {
					let json;
					try {
						json = serialize(value);
					} catch (error) {
						done(false, describeError(error));
						return;
					}
					done(true, json, serializeWrites());
				},
				(error) => {
					done(false, describeError(error));
				},
			);
		},
		stalled() {
			if (finished || pending.size > 0) return false;
			done(
				false,
				stringify({
					name: "Error",
					message:
						"The script is waiting on a promise that can never settle: no tool call is pending, and timers do not exist here.",
				}),
			);
			return true;
		},
	};
})`;

// node_modules/@earendil-works/pi-codemode/dist/runtime/vm.js
function fnv1a(text) {
  let hash = 2166136261;
  for (let index = 0;index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
var PRELUDE_HASH = fnv1a(PRELUDE_SOURCE);

// node_modules/@earendil-works/pi-codemode/dist/runtime/inline.js
var INLINE_MAX_STACK_SIZE = 256 * 1024;
// node_modules/@earendil-works/pi-codemode/dist/runtime/remote.js
var FLUSH_CHARS = 1 << 20;
// node_modules/@earendil-works/pi-codemode/dist/source.js
var CODEMODE_SOURCE_GRAMMAR = String.raw`
start: options_source | plain_source
options_source: OPTIONS_LINE NEWLINE SOURCE
plain_source: SOURCE

OPTIONS_LINE: /[ \t]*\/\/ @options:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
`;
// src/core.ts
function runtimeFiles() {
  const root = join(import.meta.dir, "..");
  return {
    wasmPath: join(root, "node_modules", "quickjs-wasi", "quickjs.wasm"),
    workerUrl: new URL("../dist/pi-worker.js", import.meta.url)
  };
}
function toCodemodeTool(t) {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema ?? true,
    ...t.spread === true ? { spread: true } : {},
    execute: (args, ctx) => t.execute(args, ctx)
  };
}
function formatResult(result) {
  const texts = [];
  const consoles = [];
  for (const item of result.output ?? []) {
    if (item.type === "text") {
      if (item.console)
        consoles.push(item.text);
      else
        texts.push(item.text);
    }
  }
  const parts = [];
  if (result.ok) {
    if (result.value !== undefined) {
      parts.push(typeof result.value === "string" ? result.value : JSON.stringify(result.value));
    }
  } else {
    const e = result.error;
    parts.push(`Error (${e.kind}): ${e.message}${e.stack ? `
${e.stack}` : ""}`);
  }
  texts.forEach((t, i) => {
    parts.push(texts.length > 1 ? `==> text ${i + 1}/${texts.length} <==
${t}` : t);
  });
  if (consoles.length > 0) {
    parts.push(`<console_output>
${consoles.join(`
`)}
</console_output>`);
  }
  const text = parts.filter((p) => p !== "").join(`
`);
  return text === "" ? result.ok ? "(no output)" : "Error: (no message)" : text;
}
async function runCodemode(code, tools, opts = {}) {
  const { wasmPath, workerUrl } = runtimeFiles();
  const sandbox = new CodemodeSandbox({
    tools: tools.map(toCodemodeTool),
    ...opts.globals ? { globals: opts.globals.map(toCodemodeTool) } : {},
    ...opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {},
    wasm: loadQuickJSWasm(wasmPath),
    workerUrl
  });
  try {
    const result = await sandbox.execute(code, {
      ...opts.signal ? { signal: opts.signal } : {},
      ...opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {},
      ...opts.store ? { store: opts.store } : {}
    });
    if (result.ok) {
      return {
        resultText: formatResult(result),
        ok: true,
        storeWrites: result.storeWrites,
        raw: result
      };
    }
    return { resultText: formatResult(result), ok: false, raw: result };
  } finally {
    await sandbox.close();
  }
}

// src/durable.ts
import { createHash } from "crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync
} from "fs";
import { homedir } from "os";
import { join as join2 } from "path";
var EXCLUDED_TOOLS = new Set([
  "codemode",
  "durable_run",
  "durable_resume",
  "durable_status"
]);
function resolveDurableDir(dir) {
  const base = dir ?? process.env["PI_V1_DURABLE_DIR"] ?? join2(homedir(), ".omp", "agent", "durable");
  mkdirSync(base, { recursive: true });
  return base;
}
function journalPath(dir, id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error(`Invalid durable id ${JSON.stringify(id)}`);
  }
  return join2(dir, `${id}.jsonl`);
}
function stableStringify(value) {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value))
    return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}
function argsHash(args) {
  return createHash("sha256").update(stableStringify(args)).digest("hex");
}
function appendLine(path, line) {
  const fd = openSync(path, "a");
  try {
    writeSync(fd, `${JSON.stringify(line)}
`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function readLines(path) {
  if (!existsSync(path))
    return [];
  return readFileSync(path, "utf-8").split(`
`).filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}
function headerCode(lines) {
  const h = lines[0];
  return h?.type === "header" && typeof h.code === "string" ? h.code : undefined;
}
function callEntries(lines) {
  return lines.filter((l) => typeof l === "object" && l !== null && l.type === "call");
}
function endEntry(lines) {
  const e = [...lines].reverse().find((l) => typeof l === "object" && l !== null && l.type === "end");
  return e;
}
function resultEntry(lines) {
  const e = [...lines].reverse().find((l) => typeof l === "object" && l !== null && l.type === "result");
  return e?.result;
}
function truncateAt(path, lines, fromSeq) {
  const kept = lines.filter((l) => {
    if (typeof l !== "object" || l === null)
      return true;
    const t = l.type;
    if (t === "call")
      return (l.seq ?? 0) < fromSeq;
    if (t === "end" || t === "result")
      return false;
    return true;
  });
  writeFileSync(path, kept.map((l) => `${JSON.stringify(l)}
`).join(""));
  const fd = openSync(path, "a");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return kept;
}
async function executeWithJournal(path, code, tools, timeoutMs, seed) {
  let lines = seed;
  const calls = callEntries(lines);
  const bySeq = new Map(calls.map((c) => [c.seq, c]));
  const counter = { n: 0 };
  const wrapped = tools.map((t) => ({
    name: t.name,
    description: t.description,
    ...t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {},
    execute: async (args, ctx) => {
      const seq = ++counter.n;
      const hash = argsHash(args);
      const hit = bySeq.get(seq);
      if (hit && hit.name === t.name && hit.argsHash === hash && !hit.live && "result" in hit) {
        return hit.result;
      }
      if (hit && (hit.name !== t.name || hit.argsHash !== hash)) {
        lines = truncateAt(path, lines, seq);
        bySeq.clear();
        for (const c of callEntries(lines))
          bySeq.set(c.seq, c);
      }
      if (hit && hit.live && hit.name === t.name && hit.argsHash === hash) {
        return t.execute(args, ctx);
      }
      const result = await t.execute(args, ctx);
      let entry;
      try {
        const roundTripped = JSON.parse(JSON.stringify(result));
        entry = { type: "call", seq, name: t.name, argsHash: hash, result: roundTripped };
      } catch {
        entry = { type: "call", seq, name: t.name, argsHash: hash, live: true };
      }
      appendLine(path, entry);
      bySeq.set(seq, entry);
      return result;
    }
  }));
  let outcome;
  try {
    const r = await runCodemode(code, wrapped, timeoutMs !== undefined ? { timeoutMs } : {});
    outcome = { ok: r.ok, resultText: r.resultText, storeWrites: r.storeWrites, raw: r.raw };
  } catch (err) {
    appendLine(path, { type: "end", ok: false, thrown: String(err) });
    throw err;
  }
  appendLine(path, { type: "end", ok: outcome.ok });
  appendLine(path, {
    type: "result",
    result: { ok: outcome.ok, resultText: outcome.resultText, storeWrites: outcome.storeWrites }
  });
  return outcome;
}
async function runDurable(args) {
  const dir = resolveDurableDir(args.dir);
  const path = journalPath(dir, args.id);
  if (existsSync(path)) {
    throw new Error(`Durable id ${JSON.stringify(args.id)} already exists; use durable_resume`);
  }
  appendLine(path, { type: "header", v: 1, code: args.code });
  return executeWithJournal(path, args.code, args.tools, args.timeoutMs, readLines(path));
}
async function resumeDurable(args) {
  const dir = resolveDurableDir(args.dir);
  const path = journalPath(dir, args.id);
  const lines = readLines(path);
  const storedCode = headerCode(lines);
  if (storedCode === undefined) {
    throw new Error(`No durable journal for id ${JSON.stringify(args.id)}`);
  }
  const stored = resultEntry(lines);
  if (stored && endEntry(lines)) {
    return stored;
  }
  return executeWithJournal(path, args.code ?? storedCode, args.tools, args.timeoutMs, lines);
}
function durableStatus(args) {
  const dir = resolveDurableDir(args.dir);
  let lines = [];
  try {
    lines = readLines(journalPath(dir, args.id));
  } catch {
    return { exists: false, finished: false, calls: 0, lastSeq: 0 };
  }
  if (lines.length === 0 || headerCode(lines) === undefined) {
    return { exists: false, finished: false, calls: 0, lastSeq: 0 };
  }
  const calls = callEntries(lines);
  const end = endEntry(lines);
  return {
    exists: true,
    finished: end !== undefined && resultEntry(lines) !== undefined,
    ...end ? { ok: end.ok } : {},
    calls: calls.length,
    lastSeq: calls.reduce((m, c) => Math.max(m, c.seq), 0)
  };
}
function bridgeFromCtx(ctx, makeTools) {
  const c = ctx;
  if (!c || !Array.isArray(c.tools) || typeof c.executeTool !== "function") {
    return makeTools();
  }
  const exec = c.executeTool.bind(c);
  return c.tools.filter((t) => !EXCLUDED_TOOLS.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
    execute: async (args, toolCtx) => {
      const outcome = await exec(t.name, args, { signal: toolCtx.signal });
      if (t.outputSchema && outcome.result.structuredContent !== undefined) {
        return outcome.result.structuredContent;
      }
      const text = (outcome.result.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(`
`);
      if (outcome.isError)
        throw new Error(text || `Tool "${t.name}" failed`);
      return text;
    }
  }));
}
function toolResult(resultText, ok) {
  return {
    content: [{ type: "text", text: resultText }],
    ...ok ? {} : { isError: true }
  };
}
function registerDurable(pi, makeTools) {
  pi.registerTool({
    name: "durable_run",
    label: "Durable run",
    description: "Run JavaScript durably: each tool call is journaled, so a resume replays instead of re-executing.",
    parameters: _Object_({
      id: String2({ description: "Durable execution id (fresh)." }),
      code: String2({ description: "Raw JavaScript source (async function body)." })
    }),
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      const { id, code } = params;
      const r = await runDurable({ id, code, tools: bridgeFromCtx(ctx, makeTools) });
      return toolResult(r.resultText, r.ok);
    }
  });
  pi.registerTool({
    name: "durable_resume",
    label: "Durable resume",
    description: "Resume a durable execution; replays journaled calls, runs the rest live.",
    parameters: _Object_({
      id: String2({ description: "Durable execution id." }),
      code: Optional(String2({ description: "Replacement code; omitted reuses the stored code." }))
    }),
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      const { id, code } = params;
      const r = await resumeDurable({
        id,
        tools: bridgeFromCtx(ctx, makeTools),
        ...code !== undefined ? { code } : {}
      });
      return toolResult(r.resultText, r.ok);
    }
  });
  pi.registerTool({
    name: "durable_status",
    label: "Durable status",
    description: "Show a durable execution's journal status without running anything.",
    parameters: _Object_({
      id: String2({ description: "Durable execution id." })
    }),
    execute: async (_toolCallId, params) => {
      const { id } = params;
      const s = durableStatus({ id });
      return toolResult(JSON.stringify(s), true);
    }
  });
}

// src/index.ts
var CODEMODE_TOOL_NAME = "codemode";
var EXCLUDED_TOOLS2 = new Set([
  "codemode",
  "durable_run",
  "durable_resume",
  "durable_status"
]);
function textOfResult(result) {
  return (result.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(`
`);
}
function toBridgeTools(ctx) {
  const callable = ctx.tools ?? [];
  return callable.filter((t) => !EXCLUDED_TOOLS2.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
    execute: async (args, ctx2) => {
      const outcome = await ctx.executeTool(t.name, args, {
        signal: ctx2.signal
      });
      if (t.outputSchema && outcome.result.structuredContent !== undefined) {
        return outcome.result.structuredContent;
      }
      const text = textOfResult(outcome.result);
      if (outcome.isError) {
        throw new Error(text || `Tool "${t.name}" failed`);
      }
      return text;
    }
  }));
}
function renderDeclaration(t) {
  const schema = t.parameters ? JSON.stringify(t.parameters) : "unknown";
  return `${t.name}(args: ${schema}): Promise<unknown>
// ${t.description}`;
}
function discoveryGlobals(ctx) {
  const callable = (ctx.tools ?? []).filter((t) => !EXCLUDED_TOOLS2.has(t.name));
  return [
    {
      name: "searchTools",
      description: "Search callable tools by substring over name and description.",
      spread: true,
      execute: async (args) => {
        const [query, searchOptions] = args;
        if (typeof query !== "string") {
          throw new Error("searchTools() expects a query string");
        }
        const limit = searchOptions?.limit ?? 8;
        const q = query.toLowerCase();
        const hits = callable.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)).slice(0, limit).map((t) => ({ name: t.name, description: t.description }));
        return JSON.stringify(hits);
      }
    },
    {
      name: "describeTool",
      description: "Show one tool's declaration (name, parameter schema, description).",
      spread: true,
      execute: async (args) => {
        const [name] = args;
        if (typeof name !== "string") {
          throw new Error("describeTool() expects a tool name");
        }
        const tool = callable.find((t) => t.name === name);
        return tool ? renderDeclaration(tool) : `unknown tool: ${name}`;
      }
    },
    {
      name: "describeNamespace",
      description: "List tools whose name starts with the given namespace prefix.",
      spread: true,
      execute: async (args) => {
        const [name] = args;
        if (typeof name !== "string") {
          throw new Error("describeNamespace() expects a namespace name");
        }
        const hits = callable.filter((t) => t.name === name || t.name.startsWith(`${name}__`) || t.name.startsWith(`${name}_`)).map((t) => t.name);
        return JSON.stringify(hits);
      }
    }
  ];
}
var CODEMODE_DESCRIPTION = `Run JavaScript that calls other tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level \`await\` and \`return\` work. No Node, file system, network, or timers.
- \`await tools.<name>({ ...args })\` resolves to a string, or an object if the tool's declaration says so, and rejects with an Error on failure. Calls still running when the script ends are cancelled.
Globals:
- \`text(value)\`, \`console.log(...)\`, and top-level \`return\` add output; \`exit()\` ends the script. \`image()\` also saves the image to a temp file and the result names its path.
- \`store(key, value)\` and \`load(key)\` keep JSON values across codemode calls.
- \`ALL_TOOLS\`, \`await searchTools(query, { limit?, namespace? })\`, \`await describeTool(name)\`, \`await describeNamespace(name)\`: find unlisted tools, such as MCP tools.`;
function piV1BridgeExtension(pi) {
  pi.registerTool({
    name: CODEMODE_TOOL_NAME,
    label: "Codemode",
    description: CODEMODE_DESCRIPTION,
    parameters: _Object_({
      code: String2({ description: "Raw JavaScript source." })
    }),
    reachesTools: () => "all",
    execute: async (toolCallId, params, signal, _onUpdate, ctx) => {
      const tools = toBridgeTools(ctx);
      const globals = discoveryGlobals(ctx);
      const { resultText, ok, raw } = await runCodemode(params.code, tools, {
        globals,
        ...signal ? { signal } : {}
      });
      const calls = raw.calls;
      return {
        content: [{ type: "text", text: resultText }],
        details: { calls },
        ...ok ? {} : { isError: true }
      };
    }
  });
  if (process.env.PI_V1_DURABLE === "1") {
    registerDurable(pi, () => []);
  }
  pi.registerCommand("pi-v1-status", {
    description: "Show pi-v1 bridge status (codemode + durable).",
    handler: async (_args, _ctx) => {
      const durableState = process.env.PI_V1_DURABLE === "1" ? "durable enabled (PI_V1_DURABLE=1)" : "durable off by default (set PI_V1_DURABLE=1 to enable)";
      return `pi-v1 bridge: codemode registered; ${durableState}.`;
    }
  });
}
export {
  CODEMODE_TOOL_NAME,
  piV1BridgeExtension as default
};
