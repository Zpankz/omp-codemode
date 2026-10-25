// @bun
// node_modules/@earendil-works/pi-codemode/dist/runtime/worker.js
import { parentPort, workerData } from "worker_threads";

// node_modules/@earendil-works/pi-codemode/dist/runtime/protocol.js
function isHostToWorkerMessage(value) {
  return typeof value === "object" && value !== null && value.type === "result";
}

// node_modules/quickjs-wasi/dist/wasi-shim.js
function createWasiShim(memoryAccessor) {
  const ERRNO_SUCCESS = 0;
  const ERRNO_BADF = 8;
  const ERRNO_NOSYS = 52;
  const CLOCK_REALTIME = 0;
  const CLOCK_MONOTONIC = 1;
  return {
    clock_time_get(clockId, _precision, resultPtr) {
      const mem = memoryAccessor();
      const view = new DataView(mem.buffer);
      if (clockId === CLOCK_REALTIME || clockId === CLOCK_MONOTONIC) {
        const timeNs = BigInt(Date.now()) * 1000000n;
        view.setBigUint64(resultPtr, timeNs, true);
        return ERRNO_SUCCESS;
      }
      return ERRNO_NOSYS;
    },
    fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
      const mem = memoryAccessor();
      const view = new DataView(mem.buffer);
      const bytes = new Uint8Array(mem.buffer);
      let totalWritten = 0;
      if (fd !== 1 && fd !== 2) {
        return ERRNO_BADF;
      }
      for (let i = 0;i < iovsLen; i++) {
        const bufPtr = view.getUint32(iovsPtr + i * 8, true);
        const bufLen = view.getUint32(iovsPtr + i * 8 + 4, true);
        const chunk = bytes.slice(bufPtr, bufPtr + bufLen);
        const text = new TextDecoder().decode(chunk);
        if (fd === 1) {
          if (typeof process !== "undefined" && process.stdout) {
            process.stdout.write(text);
          } else {
            console.log(text);
          }
        } else {
          if (typeof process !== "undefined" && process.stderr) {
            process.stderr.write(text);
          } else {
            console.error(text);
          }
        }
        totalWritten += bufLen;
      }
      view.setUint32(nwrittenPtr, totalWritten, true);
      return ERRNO_SUCCESS;
    },
    fd_close(_fd) {
      return ERRNO_NOSYS;
    },
    fd_fdstat_get(fd, statPtr) {
      const mem = memoryAccessor();
      const view = new DataView(mem.buffer);
      if (fd === 1 || fd === 2) {
        view.setUint8(statPtr, 2);
        view.setUint16(statPtr + 2, 0, true);
        view.setBigUint64(statPtr + 8, 0n, true);
        view.setBigUint64(statPtr + 16, 0n, true);
        return ERRNO_SUCCESS;
      }
      return ERRNO_BADF;
    },
    fd_seek(_fd, _offset, _whence, _resultPtr) {
      return ERRNO_NOSYS;
    },
    random_get(bufPtr, bufLen) {
      const mem = memoryAccessor();
      const bytes = new Uint8Array(mem.buffer, bufPtr, bufLen);
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
      } else {
        for (let i = 0;i < bufLen; i++) {
          bytes[i] = Math.floor(Math.random() * 256);
        }
      }
      return ERRNO_SUCCESS;
    }
  };
}

// node_modules/quickjs-wasi/dist/extensions.js
var decoder = new TextDecoder;
function parseVersionString(memory, ptr) {
  const mem = new Uint8Array(memory.buffer);
  let end = ptr;
  while (mem[end] !== 0)
    end++;
  if (end === ptr)
    return {};
  const str = decoder.decode(mem.slice(ptr, end));
  const result = {};
  for (const line of str.split(`
`)) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      result[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return result;
}
function extractExtensionVersions(ext, memory) {
  const versionsFnName = `qjs_ext_${ext.name.replace(/-/g, "_")}_versions`;
  const versionsFn = ext.instance.exports[versionsFnName];
  if (typeof versionsFn !== "function")
    return;
  const ptr = versionsFn();
  if (ptr === 0)
    return;
  return parseVersionString(memory, ptr);
}
function readULEB128(bytes, offset) {
  let result = 0;
  let shift = 0;
  while (offset.value < bytes.length) {
    const byte = bytes[offset.value++];
    result |= (byte & 127) << shift;
    if ((byte & 128) === 0)
      break;
    shift += 7;
  }
  return result;
}
function parseDylink(module) {
  const sections = WebAssembly.Module.customSections(module, "dylink.0");
  if (sections.length === 0)
    return null;
  const bytes = new Uint8Array(sections[0]);
  const offset = { value: 0 };
  const info = {
    memorySize: 0,
    memoryAlignment: 0,
    tableSize: 0,
    tableAlignment: 0,
    needed: []
  };
  while (offset.value < bytes.length) {
    const subsectionType = readULEB128(bytes, offset);
    const subsectionSize = readULEB128(bytes, offset);
    const subsectionEnd = offset.value + subsectionSize;
    if (subsectionType === 1) {
      info.memorySize = readULEB128(bytes, offset);
      info.memoryAlignment = readULEB128(bytes, offset);
      info.tableSize = readULEB128(bytes, offset);
      info.tableAlignment = readULEB128(bytes, offset);
    } else if (subsectionType === 2) {
      const count = readULEB128(bytes, offset);
      for (let i = 0;i < count; i++) {
        const len = readULEB128(bytes, offset);
        const name = new TextDecoder().decode(bytes.slice(offset.value, offset.value + len));
        offset.value += len;
        info.needed.push(name);
      }
    }
    offset.value = subsectionEnd;
  }
  return info;
}
async function loadExtension(descriptor, mainExports, wasiBuiltins, wasiUserOverrides, memoryProxy, allocBase) {
  let module;
  if (descriptor.wasm instanceof WebAssembly.Module) {
    module = descriptor.wasm;
  } else {
    module = await WebAssembly.compile(descriptor.wasm);
  }
  const dylink = parseDylink(module);
  if (!dylink) {
    throw new Error(`Extension "${descriptor.name}" is not a WASM shared library (missing dylink.0 section)`);
  }
  const memory = mainExports.memory;
  const table = mainExports.__indirect_function_table;
  const stackPointer = mainExports.__stack_pointer;
  const mallocFn = mainExports.malloc;
  if (!memory)
    throw new Error("Main module does not export memory");
  if (!table)
    throw new Error("Main module does not export __indirect_function_table");
  if (!mallocFn)
    throw new Error("Main module does not export malloc");
  let memoryBase;
  let tableBase;
  if (allocBase) {
    memoryBase = allocBase.memoryBase;
    tableBase = allocBase.tableBase;
  } else {
    if (dylink.memorySize > 0) {
      memoryBase = mallocFn(dylink.memorySize);
      if (memoryBase === 0) {
        throw new Error(`Failed to allocate ${dylink.memorySize} bytes for extension "${descriptor.name}"`);
      }
      new Uint8Array(memory.buffer, memoryBase, dylink.memorySize).fill(0);
    } else {
      memoryBase = 0;
    }
  }
  if (allocBase) {
    tableBase = allocBase.tableBase;
    if (tableBase + dylink.tableSize > table.length) {
      table.grow(tableBase + dylink.tableSize - table.length);
    }
  } else {
    tableBase = table.length;
    if (dylink.tableSize > 0) {
      table.grow(dylink.tableSize);
    }
  }
  const extImports = WebAssembly.Module.imports(module);
  const importObj = {
    env: {},
    "GOT.mem": {},
    "GOT.func": {}
  };
  const needsWasi = extImports.some((imp) => imp.module === "wasi_snapshot_preview1");
  if (needsWasi) {
    const extWasi = descriptor.wasi && memoryProxy ? descriptor.wasi(memoryProxy) : undefined;
    importObj["wasi_snapshot_preview1"] = {
      ...wasiBuiltins,
      ...extWasi,
      ...wasiUserOverrides
    };
  }
  const extExportNames = new Set(WebAssembly.Module.exports(module).filter((e) => e.kind === "function").map((e) => e.name));
  const unresolvedFuncs = new Set;
  for (const imp of extImports) {
    if (imp.module === "env") {
      if (imp.name === "memory" && imp.kind === "memory") {
        importObj.env.memory = memory;
      } else if (imp.name === "__indirect_function_table" && imp.kind === "table") {
        importObj.env.__indirect_function_table = table;
      } else if (imp.name === "__memory_base" && imp.kind === "global") {
        importObj.env.__memory_base = new WebAssembly.Global({ value: "i32", mutable: false }, memoryBase);
      } else if (imp.name === "__table_base" && imp.kind === "global") {
        importObj.env.__table_base = new WebAssembly.Global({ value: "i32", mutable: false }, tableBase);
      } else if (imp.name === "__stack_pointer" && imp.kind === "global") {
        importObj.env.__stack_pointer = stackPointer;
      } else if (imp.kind === "function") {
        const resolved = mainExports[imp.name];
        if (resolved && typeof resolved === "function") {
          importObj.env[imp.name] = resolved;
        } else {
          unresolvedFuncs.add(imp.name);
          importObj.env[imp.name] = () => {
            throw new Error(`Extension "${descriptor.name}" called unresolved symbol: env.${imp.name}`);
          };
        }
      } else if (imp.kind === "global") {
        const resolved = mainExports[imp.name];
        if (resolved instanceof WebAssembly.Global) {
          importObj.env[imp.name] = resolved;
        } else {
          importObj.env[imp.name] = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
        }
      }
    } else if (imp.module === "GOT.mem" && imp.kind === "global") {
      importObj["GOT.mem"][imp.name] = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
    } else if (imp.module === "GOT.func" && imp.kind === "global") {
      const resolved = mainExports[imp.name];
      if (resolved && typeof resolved === "function") {
        const idx = table.length;
        table.grow(1);
        table.set(idx, resolved);
        importObj["GOT.func"][imp.name] = new WebAssembly.Global({ value: "i32", mutable: true }, idx);
      } else {
        importObj["GOT.func"][imp.name] = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
      }
    }
  }
  const selfResolvable = [...unresolvedFuncs].filter((name) => extExportNames.has(name));
  const wrappers = {};
  for (const name of selfResolvable) {
    const wrapper = { target: null };
    wrappers[name] = wrapper;
    importObj.env[name] = (...args) => {
      if (!wrapper.target) {
        throw new Error(`Extension "${descriptor.name}" called unresolved symbol during init: env.${name}`);
      }
      return wrapper.target(...args);
    };
  }
  const instance = await WebAssembly.instantiate(module, importObj);
  const extExports = instance.exports;
  for (const name of selfResolvable) {
    const selfExport = extExports[name];
    if (typeof selfExport === "function") {
      wrappers[name].target = selfExport;
    }
  }
  if (typeof extExports.__wasm_apply_data_relocs === "function") {
    extExports.__wasm_apply_data_relocs();
  }
  if (typeof extExports.__wasm_call_ctors === "function") {
    extExports.__wasm_call_ctors();
  }
  const initFn = descriptor.initFn ?? `qjs_ext_${descriptor.name.replace(/-/g, "_")}_init`;
  const ext = {
    name: descriptor.name,
    module,
    instance,
    dylink,
    memoryBase,
    tableBase,
    initFn
  };
  ext.versions = extractExtensionVersions(ext, memory);
  return ext;
}
function initExtension(ext, mainExports) {
  const initFunc = ext.instance.exports[ext.initFn];
  if (typeof initFunc !== "function") {
    throw new Error(`Extension "${ext.name}" does not export init function "${ext.initFn}"`);
  }
  const ctxPtr = mainExports.qjs_get_context_ptr();
  const rtPtr = mainExports.qjs_get_runtime_ptr();
  const result = initFunc(ctxPtr, rtPtr);
  if (result !== 0) {
    throw new Error(`Extension "${ext.name}" init function returned error code ${result}`);
  }
}
async function restoreExtensions(descriptors, extensionMeta, mainExports, wasiBuiltins, wasiUserOverrides, memoryProxy) {
  const loaded = [];
  for (const meta of extensionMeta) {
    const descriptor = descriptors.find((d) => d.name === meta.name);
    if (!descriptor) {
      throw new Error(`Extension "${meta.name}" required by snapshot but not provided`);
    }
    const ext = await loadExtension(descriptor, mainExports, wasiBuiltins, wasiUserOverrides, memoryProxy, {
      memoryBase: meta.memoryBase,
      tableBase: meta.tableBase
    });
    ext.initFn = meta.initFn;
    loaded.push(ext);
  }
  return loaded;
}

// node_modules/quickjs-wasi/dist/version.js
var VERSION = "3.6.2";

// node_modules/quickjs-wasi/dist/index.js
var __addDisposableResource = function(env, value, async) {
  if (value !== null && value !== undefined) {
    if (typeof value !== "object" && typeof value !== "function")
      throw new TypeError("Object expected.");
    var dispose, inner;
    if (async) {
      if (!Symbol.asyncDispose)
        throw new TypeError("Symbol.asyncDispose is not defined.");
      dispose = value[Symbol.asyncDispose];
    }
    if (dispose === undefined) {
      if (!Symbol.dispose)
        throw new TypeError("Symbol.dispose is not defined.");
      dispose = value[Symbol.dispose];
      if (async)
        inner = dispose;
    }
    if (typeof dispose !== "function")
      throw new TypeError("Object not disposable.");
    if (inner)
      dispose = function() {
        try {
          inner.call(this);
        } catch (e) {
          return Promise.reject(e);
        }
      };
    env.stack.push({ value, dispose, async });
  } else if (async) {
    env.stack.push({ async: true });
  }
  return value;
};
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
var SNAPSHOT_MAGIC = 1363825491;
var SNAPSHOT_VERSION = 2;
var SNAPSHOT_HEADER_SIZE = 24;

class QuickJS {
  exports;
  module;
  instance;
  encoder = new TextEncoder;
  decoder = new TextDecoder;
  disposed = false;
  hostCallbacks = new Map;
  nextInternalId = 1;
  interruptHandler = null;
  unhandledRejectionHandler = null;
  moduleNormalizeHandler = null;
  moduleLoadHandler = null;
  timezoneOffsetHandler = null;
  _global = null;
  _versions = null;
  _undefined = null;
  _null = null;
  _true = null;
  _false = null;
  _ownedHandles = new Set;
  _activeScope = null;
  loadedExtensions = [];
  constructor(module) {
    this.module = module;
    this.instance = null;
    this.exports = null;
  }
  setInstance(instance) {
    this.instance = instance;
    this.exports = instance.exports;
  }
  get versions() {
    this.assertNotDisposed();
    if (!this._versions) {
      const result = {
        "quickjs-wasi": VERSION,
        quickjs: this.readCString(this.exports.qjs_get_quickjs_version())
      };
      for (const ext of this.loadedExtensions) {
        if (ext.versions) {
          Object.assign(result, ext.versions);
        }
      }
      this._versions = result;
    }
    return this._versions;
  }
  get global() {
    if (!this._global) {
      this._global = new JSValueHandle(this, this.exports.qjs_get_global(), true);
    }
    return this._global;
  }
  get undefined() {
    if (!this._undefined) {
      this._undefined = new JSValueHandle(this, this.exports.qjs_get_undefined(), true);
    }
    return this._undefined;
  }
  get null() {
    if (!this._null) {
      this._null = new JSValueHandle(this, this.exports.qjs_get_null(), true);
    }
    return this._null;
  }
  get true() {
    if (!this._true) {
      this._true = new JSValueHandle(this, this.exports.qjs_get_true(), true);
    }
    return this._true;
  }
  get false() {
    if (!this._false) {
      this._false = new JSValueHandle(this, this.exports.qjs_get_false(), true);
    }
    return this._false;
  }
  static async create(options) {
    const opts = QuickJS.normalizeOptions(options);
    const module = await QuickJS.resolveModule(opts.wasm);
    const vm = new QuickJS(module);
    const { instance, wasiBuiltins, wasiUserOverrides, memoryProxy } = await QuickJS.instantiate(module, vm, opts.wasi);
    vm.setInstance(instance);
    vm.exports._initialize();
    const result = opts.intrinsics !== undefined ? vm.exports.qjs_init2(opts.intrinsics) : vm.exports.qjs_init();
    if (result !== 0) {
      throw new Error("Failed to initialize QuickJS runtime");
    }
    if (opts.extensions) {
      const mainExports = instance.exports;
      for (const desc of opts.extensions) {
        const ext = await loadExtension(desc, mainExports, wasiBuiltins, wasiUserOverrides, memoryProxy);
        vm.loadedExtensions.push(ext);
        initExtension(ext, mainExports);
      }
    }
    QuickJS.applyLimits(vm, opts);
    return vm;
  }
  static async restore(snapshot, options) {
    const opts = QuickJS.normalizeOptions(options);
    const module = await QuickJS.resolveModule(opts.wasm);
    const vm = new QuickJS(module);
    const { instance, wasiBuiltins, wasiUserOverrides, memoryProxy } = await QuickJS.instantiate(module, vm, opts.wasi);
    vm.setInstance(instance);
    const mainExports = instance.exports;
    const exportedMemory = vm.exports.memory;
    const currentPages = exportedMemory.buffer.byteLength / 65536;
    const neededPages = Math.ceil(snapshot.memory.byteLength / 65536);
    if (neededPages > currentPages) {
      exportedMemory.grow(neededPages - currentPages);
    }
    if (snapshot.extensions.length > 0) {
      const descriptors = opts.extensions ?? [];
      vm.loadedExtensions = await restoreExtensions(descriptors, snapshot.extensions, mainExports, wasiBuiltins, wasiUserOverrides, memoryProxy);
    }
    const dst = new Uint8Array(exportedMemory.buffer);
    dst.set(snapshot.memory);
    vm.exports.qjs_set_runtime_and_context(snapshot.runtimePtr, snapshot.contextPtr);
    vm.exports.__stack_pointer.value = snapshot.stackPointer;
    QuickJS.applyLimits(vm, opts);
    return vm;
  }
  static serializeSnapshot(snapshot) {
    const textEncoder = new TextEncoder;
    let extMetaSize = 4;
    const extEncodedNames = [];
    const extEncodedInitFns = [];
    for (const ext of snapshot.extensions) {
      const nameBytes = textEncoder.encode(ext.name);
      const initFnBytes = textEncoder.encode(ext.initFn);
      extEncodedNames.push(nameBytes);
      extEncodedInitFns.push(initFnBytes);
      extMetaSize += 4 + nameBytes.length + 4 + 4 + 4 + initFnBytes.length;
    }
    const totalSize = SNAPSHOT_HEADER_SIZE + extMetaSize + snapshot.memory.byteLength;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    view.setUint32(0, SNAPSHOT_MAGIC, false);
    view.setUint8(4, SNAPSHOT_VERSION);
    view.setUint32(8, snapshot.memory.byteLength, true);
    view.setUint32(12, snapshot.stackPointer, true);
    view.setUint32(16, snapshot.runtimePtr, true);
    view.setUint32(20, snapshot.contextPtr, true);
    let offset = SNAPSHOT_HEADER_SIZE;
    view.setUint32(offset, snapshot.extensions.length, true);
    offset += 4;
    for (let i = 0;i < snapshot.extensions.length; i++) {
      const ext = snapshot.extensions[i];
      const nameBytes = extEncodedNames[i];
      const initFnBytes = extEncodedInitFns[i];
      view.setUint32(offset, nameBytes.length, true);
      offset += 4;
      bytes.set(nameBytes, offset);
      offset += nameBytes.length;
      view.setUint32(offset, ext.memoryBase, true);
      offset += 4;
      view.setUint32(offset, ext.tableBase, true);
      offset += 4;
      view.setUint32(offset, initFnBytes.length, true);
      offset += 4;
      bytes.set(initFnBytes, offset);
      offset += initFnBytes.length;
    }
    bytes.set(snapshot.memory, offset);
    return bytes;
  }
  static deserializeSnapshot(data) {
    if (data.length < SNAPSHOT_HEADER_SIZE) {
      throw new Error("Invalid snapshot: too small");
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const magic = view.getUint32(0, false);
    if (magic !== SNAPSHOT_MAGIC) {
      throw new Error(`Invalid snapshot: bad magic (expected 0x${SNAPSHOT_MAGIC.toString(16)}, got 0x${magic.toString(16)})`);
    }
    const version = view.getUint8(4);
    if (version !== SNAPSHOT_VERSION && version !== 1) {
      throw new Error(`Unsupported snapshot version: ${version} (expected ${SNAPSHOT_VERSION})`);
    }
    const memorySize = view.getUint32(8, true);
    const stackPointer = view.getUint32(12, true);
    const runtimePtr = view.getUint32(16, true);
    const contextPtr = view.getUint32(20, true);
    let extensions = [];
    let memoryOffset = SNAPSHOT_HEADER_SIZE;
    if (version >= 2) {
      const extCount = view.getUint32(24, true);
      let offset = 28;
      const textDecoder = new TextDecoder;
      for (let i = 0;i < extCount; i++) {
        const nameLen = view.getUint32(offset, true);
        offset += 4;
        const name = textDecoder.decode(data.slice(offset, offset + nameLen));
        offset += nameLen;
        const memBase = view.getUint32(offset, true);
        offset += 4;
        const tblBase = view.getUint32(offset, true);
        offset += 4;
        const initFnLen = view.getUint32(offset, true);
        offset += 4;
        const initFn = textDecoder.decode(data.slice(offset, offset + initFnLen));
        offset += initFnLen;
        extensions.push({ name, memoryBase: memBase, tableBase: tblBase, initFn });
      }
      memoryOffset = offset;
    }
    const expectedSize = memoryOffset + memorySize;
    if (data.length < expectedSize) {
      throw new Error(`Invalid snapshot: expected ${expectedSize} bytes, got ${data.length}`);
    }
    const memory = data.slice(memoryOffset, memoryOffset + memorySize);
    return { memory, stackPointer, runtimePtr, contextPtr, extensions };
  }
  static normalizeOptions(options) {
    if (!options) {
      return { wasm: undefined };
    }
    if (options instanceof WebAssembly.Module)
      return { wasm: options };
    if (typeof options === "object" && (("wasm" in options) || ("wasi" in options) || ("memoryLimit" in options) || ("maxStackSize" in options) || ("interruptHandler" in options) || ("onUnhandledRejection" in options) || ("moduleLoader" in options) || ("intrinsics" in options) || ("extensions" in options) || ("timezoneOffset" in options))) {
      const opts = options;
      if (opts.maxStackSize !== undefined && (!Number.isInteger(opts.maxStackSize) || opts.maxStackSize < 0 || opts.maxStackSize > MAX_STACK_SIZE)) {
        throw new RangeError(`maxStackSize must be an integer between 0 and ${MAX_STACK_SIZE}`);
      }
      return opts;
    }
    return { wasm: options };
  }
  static applyLimits(vm, opts) {
    if (opts.memoryLimit !== undefined) {
      vm.exports.qjs_set_memory_limit(opts.memoryLimit);
    }
    if (opts.maxStackSize !== undefined) {
      vm.exports.qjs_set_max_stack_size(opts.maxStackSize);
    }
    if (opts.interruptHandler) {
      vm.interruptHandler = opts.interruptHandler;
      vm.exports.qjs_set_interrupt_handler(1);
    }
    if (opts.onUnhandledRejection) {
      vm.unhandledRejectionHandler = opts.onUnhandledRejection;
      vm.exports.qjs_set_promise_rejection_handler(1);
    }
    if (opts.moduleLoader) {
      vm.moduleLoadHandler = opts.moduleLoader.load;
      vm.moduleNormalizeHandler = opts.moduleLoader.normalize ?? null;
      vm.exports.qjs_set_module_loader(1);
    }
    const tz = opts.timezoneOffset;
    if (typeof tz === "function") {
      vm.timezoneOffsetHandler = (timeSecs) => -tz(timeSecs) * 60;
    } else if (typeof tz === "number") {
      const offsetSecs = -tz * 60;
      vm.timezoneOffsetHandler = () => offsetSecs;
    } else {
      vm.timezoneOffsetHandler = (timeSecs) => {
        return -new Date(timeSecs * 1000).getTimezoneOffset() * 60;
      };
    }
  }
  static async resolveModule(wasmInput) {
    if (wasmInput instanceof WebAssembly.Module) {
      return wasmInput;
    }
    if (wasmInput) {
      return WebAssembly.compile(wasmInput);
    }
    throw new TypeError("QuickJS: `wasm` option is required. Provide WASM bytes or a compiled " + "`WebAssembly.Module`. The binary is shipped at `quickjs-wasi/quickjs.wasm` " + "and can be loaded via your environment's preferred mechanism (e.g. " + "`fetch()`, `node:fs/promises`, or a bundler import like Vite's `?url`).");
  }
  static async instantiate(module, vm, wasiOptions) {
    let memory = null;
    const memoryProxy = new Proxy({}, {
      get(_target, prop) {
        return memory[prop];
      }
    });
    const wasiBuiltins = createWasiShim(() => memory);
    const wasiUserOverrides = wasiOptions ? wasiOptions(memoryProxy) : undefined;
    const wasiShim = { ...wasiBuiltins, ...wasiUserOverrides };
    const hostCall = (namePtr, nameLen, thisPtr, argc, argvPtr) => {
      return vm.handleHostCall(namePtr, nameLen, thisPtr, argc, argvPtr);
    };
    const hostInterrupt = () => {
      return vm.interruptHandler ? vm.interruptHandler() ? 1 : 0 : 0;
    };
    const hostPromiseRejection = (promisePtr, reasonPtr, isHandled) => {
      if (!vm.unhandledRejectionHandler) {
        vm.exports.qjs_free_value(promisePtr);
        vm.exports.qjs_free_value(reasonPtr);
        return;
      }
      const promise = new JSValueHandle(vm, promisePtr);
      const reason = new JSValueHandle(vm, reasonPtr);
      try {
        vm.unhandledRejectionHandler(promise, reason, isHandled !== 0);
      } finally {
        promise.dispose();
        reason.dispose();
      }
    };
    const throwIntoContext = (err) => {
      const errHandle = vm.newError(err instanceof Error ? err : String(err));
      vm.exports.qjs_throw(errHandle.ptr);
      errHandle.dispose();
    };
    const assertSyncString = (value, callbackName) => {
      if (typeof value === "string")
        return value;
      const got = value !== null && typeof value === "object" && typeof value.then === "function" ? "a Promise" : `type ${typeof value}`;
      throw new TypeError(`moduleLoader.${callbackName} must synchronously return a string (got ${got}). ` + `Async module loading is not supported. Pre-fetch module sources instead ` + `(see the "ES Modules" section of the quickjs-wasi README).`);
    };
    const hostModuleNormalize = (baseNamePtr, namePtr) => {
      if (!vm.moduleNormalizeHandler) {
        const name = vm.readCString(namePtr);
        return vm.writeString(name).ptr;
      }
      const baseName = vm.readCString(baseNamePtr);
      const specifier = vm.readCString(namePtr);
      try {
        const normalized = assertSyncString(vm.moduleNormalizeHandler(baseName, specifier), "normalize");
        return vm.writeString(normalized).ptr;
      } catch (err) {
        throwIntoContext(err);
        return 0;
      }
    };
    const hostModuleLoad = (namePtr, outLenPtr) => {
      if (!vm.moduleLoadHandler)
        return 0;
      const name = vm.readCString(namePtr);
      try {
        const source = assertSyncString(vm.moduleLoadHandler(name), "load");
        const { ptr, len } = vm.writeString(source);
        new Uint32Array(vm.exports.memory.buffer, outLenPtr, 1)[0] = len;
        return ptr;
      } catch (err) {
        throwIntoContext(err);
        return 0;
      }
    };
    const hostGetTimezoneOffset = (hi, lo) => {
      const timeSecs = Number(BigInt(hi) << 32n | BigInt(lo >>> 0));
      return vm.timezoneOffsetHandler ? vm.timezoneOffsetHandler(timeSecs) : 0;
    };
    const instance = await WebAssembly.instantiate(module, {
      env: {
        host_call: hostCall,
        host_interrupt: hostInterrupt,
        host_promise_rejection: hostPromiseRejection,
        host_module_normalize: hostModuleNormalize,
        host_module_load: hostModuleLoad,
        host_get_timezone_offset: hostGetTimezoneOffset
      },
      wasi_snapshot_preview1: wasiShim
    });
    memory = instance.exports.memory;
    return { instance, wasiBuiltins, wasiUserOverrides, memoryProxy };
  }
  handleHostCall(namePtr, nameLen, thisPtr, argc, argvPtr) {
    const name = this.decoder.decode(new Uint8Array(this.exports.memory.buffer, namePtr, nameLen));
    const callback = this.hostCallbacks.get(name);
    if (!callback) {
      const errHandle = this.newError(`Host callback "${name}" is not registered: it was unregistered, ` + "its ephemeral function handle was disposed, or it was never " + "re-registered after a snapshot restore.");
      this.exports.qjs_throw(errHandle.ptr);
      errHandle.dispose();
      return 0;
    }
    const thisHandle = new JSValueHandle(this, thisPtr, false, true);
    const args = [];
    if (argc > 0 && argvPtr !== 0) {
      const view = new DataView(this.exports.memory.buffer);
      for (let i = 0;i < argc; i++) {
        const argPtr = view.getUint32(argvPtr + i * 4, true);
        args.push(new JSValueHandle(this, argPtr, false, true));
      }
    }
    try {
      const result = callback.call(thisHandle, ...args);
      return this.exports.qjs_dup_value(result.ptr);
    } catch (err) {
      const errHandle = this.newError(err instanceof Error ? err : String(err));
      this.exports.qjs_throw(errHandle.ptr);
      errHandle.dispose();
      return 0;
    }
  }
  writeString(str) {
    const encoded = encodeWtf8(str);
    const ptr = this.exports.wasm_malloc(encoded.length + 1);
    if (ptr === 0)
      throw new Error("wasm_malloc failed");
    const mem = new Uint8Array(this.exports.memory.buffer);
    mem.set(encoded, ptr);
    mem[ptr + encoded.length] = 0;
    return { ptr, len: encoded.length };
  }
  readCString(ptr) {
    const mem = new Uint8Array(this.exports.memory.buffer);
    let end = ptr;
    while (mem[end] !== 0)
      end++;
    return this.decoder.decode(mem.slice(ptr, end));
  }
  throwIfException(result) {
    if (this.exports.qjs_is_exception(result.ptr) !== 0) {
      const exc = this.getException();
      result.dispose();
      this._ownedHandles.add(exc);
      throw new JSException(exc);
    }
    return result;
  }
  evalCode(code, filename = "<eval>", flags = 0) {
    this.assertNotDisposed();
    const codeStr = this.writeString(code);
    const fnStr = this.writeString(filename);
    const resultPtr = this.exports.qjs_eval(codeStr.ptr, codeStr.len, fnStr.ptr, flags);
    this.exports.wasm_free(codeStr.ptr);
    this.exports.wasm_free(fnStr.ptr);
    return this.throwIfException(new JSValueHandle(this, resultPtr));
  }
  compile(code, filename = "<compile>", evalFlags = 0, compileFlags = 0) {
    this.assertNotDisposed();
    const codeStr = this.writeString(code);
    const fnStr = this.writeString(filename);
    const outLenPtr = this.exports.wasm_malloc(4);
    const bufPtr = this.exports.qjs_compile(codeStr.ptr, codeStr.len, fnStr.ptr, evalFlags, compileFlags, outLenPtr);
    this.exports.wasm_free(codeStr.ptr);
    this.exports.wasm_free(fnStr.ptr);
    if (bufPtr === 0) {
      this.exports.wasm_free(outLenPtr);
      const exc = this.getException();
      throw new Error(`Compilation error: ${exc.toString()}`);
    }
    const outLen = new Uint32Array(this.exports.memory.buffer, outLenPtr, 1)[0];
    this.exports.wasm_free(outLenPtr);
    const bytecode = new Uint8Array(this.exports.memory.buffer, bufPtr, outLen).slice();
    this.exports.wasm_free(bufPtr);
    return bytecode;
  }
  evalBytecode(bytecode) {
    this.assertNotDisposed();
    const bufPtr = this.exports.wasm_malloc(bytecode.byteLength);
    new Uint8Array(this.exports.memory.buffer, bufPtr, bytecode.byteLength).set(bytecode);
    const resultPtr = this.exports.qjs_eval_bytecode(bufPtr, bytecode.byteLength);
    this.exports.wasm_free(bufPtr);
    return this.throwIfException(new JSValueHandle(this, resultPtr));
  }
  executePendingJobs() {
    this.assertNotDisposed();
    let count = 0;
    while (this.exports.qjs_is_job_pending()) {
      const result = this.exports.qjs_execute_pending_job();
      if (result < 0) {
        const exc = this.getException();
        throw new Error(`Job execution error: ${exc.toString()}`);
      }
      count++;
    }
    return count;
  }
  runGC() {
    this.assertNotDisposed();
    this.exports.qjs_run_gc();
  }
  get gcThreshold() {
    this.assertNotDisposed();
    return this.exports.qjs_get_gc_threshold();
  }
  set gcThreshold(threshold) {
    this.assertNotDisposed();
    this.exports.qjs_set_gc_threshold(threshold);
  }
  getMemoryUsage() {
    this.assertNotDisposed();
    const bufPtr = this.exports.wasm_malloc(26 * 8);
    this.exports.qjs_compute_memory_usage(bufPtr);
    const view = new BigInt64Array(this.exports.memory.buffer, bufPtr, 26);
    const result = {
      mallocSize: Number(view[0]),
      mallocLimit: Number(view[1]),
      memoryUsedSize: Number(view[2]),
      mallocCount: Number(view[3]),
      memoryUsedCount: Number(view[4]),
      atomCount: Number(view[5]),
      atomSize: Number(view[6]),
      strCount: Number(view[7]),
      strSize: Number(view[8]),
      objCount: Number(view[9]),
      objSize: Number(view[10]),
      propCount: Number(view[11]),
      propSize: Number(view[12]),
      shapeCount: Number(view[13]),
      shapeSize: Number(view[14]),
      jsFuncCount: Number(view[15]),
      jsFuncSize: Number(view[16]),
      jsFuncCodeSize: Number(view[17]),
      jsFuncPc2lineCount: Number(view[18]),
      jsFuncPc2lineSize: Number(view[19]),
      cFuncCount: Number(view[20]),
      arrayCount: Number(view[21]),
      fastArrayCount: Number(view[22]),
      fastArrayElements: Number(view[23]),
      binaryObjectCount: Number(view[24]),
      binaryObjectSize: Number(view[25])
    };
    this.exports.wasm_free(bufPtr);
    return result;
  }
  getGlobal() {
    this.assertNotDisposed();
    return new JSValueHandle(this, this.exports.qjs_get_global());
  }
  newString(str) {
    this.assertNotDisposed();
    const { ptr, len } = this.writeString(str);
    const resultPtr = this.exports.qjs_new_string(ptr, len);
    this.exports.wasm_free(ptr);
    return new JSValueHandle(this, resultPtr);
  }
  newNumber(num) {
    this.assertNotDisposed();
    return new JSValueHandle(this, this.exports.qjs_new_number(num));
  }
  newBigInt(val) {
    this.assertNotDisposed();
    const lo = Number(val & 0xffffffffn);
    const hi = Number(val >> 32n & 0xffffffffn);
    return new JSValueHandle(this, this.exports.qjs_new_big_int64(lo, hi));
  }
  newObject() {
    this.assertNotDisposed();
    return new JSValueHandle(this, this.exports.qjs_new_object());
  }
  newArray() {
    this.assertNotDisposed();
    return new JSValueHandle(this, this.exports.qjs_new_array());
  }
  newSymbolFor(description) {
    this.assertNotDisposed();
    const { ptr, len } = this.writeString(description);
    const result = new JSValueHandle(this, this.exports.qjs_new_symbol(ptr, len, 1));
    this.exports.wasm_free(ptr);
    return result;
  }
  newArrayBuffer(data) {
    this.assertNotDisposed();
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const ptr = this.exports.wasm_malloc(bytes.length);
    if (ptr === 0)
      throw new Error("wasm_malloc failed");
    new Uint8Array(this.exports.memory.buffer).set(bytes, ptr);
    const result = new JSValueHandle(this, this.exports.qjs_new_array_buffer(ptr, bytes.length));
    this.exports.wasm_free(ptr);
    return result;
  }
  newUint8Array(data) {
    this.assertNotDisposed();
    const ptr = this.exports.wasm_malloc(data.length);
    if (ptr === 0)
      throw new Error("wasm_malloc failed");
    new Uint8Array(this.exports.memory.buffer).set(data, ptr);
    const result = new JSValueHandle(this, this.exports.qjs_new_uint8_array(ptr, data.length));
    this.exports.wasm_free(ptr);
    return result;
  }
  getUndefined() {
    this.assertNotDisposed();
    return new JSValueHandle(this, this.exports.qjs_get_undefined());
  }
  getNull() {
    this.assertNotDisposed();
    return new JSValueHandle(this, this.exports.qjs_get_null());
  }
  getTrue() {
    this.assertNotDisposed();
    return new JSValueHandle(this, this.exports.qjs_get_true());
  }
  getFalse() {
    this.assertNotDisposed();
    return new JSValueHandle(this, this.exports.qjs_get_false());
  }
  newFunction(name, fn) {
    this.assertNotDisposed();
    if (this.hostCallbacks.has(name)) {
      throw new Error(`Host callback with name "${name}" is already registered`);
    }
    this.hostCallbacks.set(name, fn);
    const { ptr: namePtr, len: nameLen } = this.writeString(name);
    const resultPtr = this.exports.qjs_new_host_function(namePtr, nameLen, 0);
    this.exports.wasm_free(namePtr);
    return new JSValueHandle(this, resultPtr);
  }
  withScope(fn) {
    this.assertNotDisposed();
    const enclosing = this._activeScope;
    const tracked = new Set;
    this._activeScope = tracked;
    const scope = {
      escape: (handle) => {
        tracked.delete(handle);
        enclosing?.add(handle);
        return handle;
      }
    };
    try {
      return fn(scope);
    } finally {
      this._activeScope = enclosing;
      for (const handle of tracked)
        handle.dispose();
    }
  }
  exportHandle(handle) {
    this.assertNotDisposed();
    if (handle.vm !== this) {
      throw new Error("exportHandle: handle belongs to a different VM");
    }
    if (handle.disposed) {
      throw new Error("exportHandle: handle is disposed");
    }
    if (handle._isBorrowed) {
      throw new Error("exportHandle: cannot export a borrowed handle (host-callback " + "this/argument); its box is freed when the callback returns. " + "dup() it and export the duplicate.");
    }
    return handle.ptr;
  }
  importHandle(token) {
    this.assertNotDisposed();
    if (!Number.isInteger(token) || token <= 0 || token >= this.exports.memory.buffer.byteLength) {
      throw new Error(`importHandle: invalid token ${token}`);
    }
    return new JSValueHandle(this, this.exports.qjs_dup_value(token));
  }
  newEphemeralFunction(fn) {
    this.assertNotDisposed();
    const name = `__ephemeral:${this.nextInternalId++}`;
    this.hostCallbacks.set(name, fn);
    const { ptr: namePtr, len: nameLen } = this.writeString(name);
    const resultPtr = this.exports.qjs_new_host_function(namePtr, nameLen, 0);
    this.exports.wasm_free(namePtr);
    const handle = new JSValueHandle(this, resultPtr);
    handle._onDispose = () => {
      this.hostCallbacks.delete(name);
    };
    return handle;
  }
  unregisterHostCallback(name) {
    return this.hostCallbacks.delete(name);
  }
  newInternalFunction(name, fn) {
    this.hostCallbacks.set(name, fn);
    const { ptr: namePtr, len: nameLen } = this.writeString(name);
    const resultPtr = this.exports.qjs_new_host_function(namePtr, nameLen, 0);
    this.exports.wasm_free(namePtr);
    return new JSValueHandle(this, resultPtr);
  }
  newPromise() {
    this.assertNotDisposed();
    const resolveOutPtr = this.exports.wasm_malloc(4);
    const rejectOutPtr = this.exports.wasm_malloc(4);
    const promisePtr = this.exports.qjs_new_promise(resolveOutPtr, rejectOutPtr);
    const view = new DataView(this.exports.memory.buffer);
    const resolvePtr = view.getUint32(resolveOutPtr, true);
    const rejectPtr = view.getUint32(rejectOutPtr, true);
    this.exports.wasm_free(resolveOutPtr);
    this.exports.wasm_free(rejectOutPtr);
    const promiseHandle = new JSValueHandle(this, promisePtr);
    const resolveHandle = new JSValueHandle(this, resolvePtr);
    const rejectHandle = new JSValueHandle(this, rejectPtr);
    const vm = this;
    vm._ownedHandles.add(resolveHandle);
    vm._ownedHandles.add(rejectHandle);
    let _settled = null;
    return {
      handle: promiseHandle,
      get settled() {
        if (!_settled) {
          let settledResolve;
          _settled = new Promise((res) => {
            settledResolve = res;
          });
          const settleName = `__settle:${vm.nextInternalId++}`;
          const onSettleFn = vm.newInternalFunction(settleName, () => {
            settledResolve();
            vm.hostCallbacks.delete(settleName);
            return vm.undefined;
          });
          vm.promiseThenRaw(promiseHandle, onSettleFn, onSettleFn).dispose();
          onSettleFn.dispose();
        }
        return _settled;
      },
      resolve(value) {
        vm.callFunctionRaw(resolveHandle, vm.undefined, value).dispose();
        vm._ownedHandles.delete(resolveHandle);
        resolveHandle.dispose();
      },
      reject(value) {
        vm.callFunctionRaw(rejectHandle, vm.undefined, value).dispose();
        vm._ownedHandles.delete(rejectHandle);
        rejectHandle.dispose();
      }
    };
  }
  resolvePromise(promiseHandle) {
    this.assertNotDisposed();
    if (!this.exports.qjs_is_promise(promiseHandle.ptr)) {
      return Promise.resolve({ value: promiseHandle.dup() });
    }
    const state = this.exports.qjs_promise_state(promiseHandle.ptr);
    if (state === 1) {
      return Promise.resolve({ value: new JSValueHandle(this, this.exports.qjs_promise_result(promiseHandle.ptr)) });
    } else if (state === 2) {
      return Promise.resolve({ error: new JSValueHandle(this, this.exports.qjs_promise_result(promiseHandle.ptr)) });
    }
    return new Promise((hostResolve) => {
      const id = this.nextInternalId++;
      const fulfilledName = `__onFulfilled:${id}`;
      const rejectedName = `__onRejected:${id}`;
      const onFulfilled = this.newInternalFunction(fulfilledName, (...args) => {
        const val = args[0]?.dup() ?? this.undefined;
        this.hostCallbacks.delete(fulfilledName);
        this.hostCallbacks.delete(rejectedName);
        hostResolve({ value: val });
        return this.undefined;
      });
      const onRejected = this.newInternalFunction(rejectedName, (...args) => {
        const val = args[0]?.dup() ?? this.undefined;
        this.hostCallbacks.delete(fulfilledName);
        this.hostCallbacks.delete(rejectedName);
        hostResolve({ error: val });
        return this.undefined;
      });
      this.promiseThenRaw(promiseHandle, onFulfilled, onRejected).dispose();
      onFulfilled.dispose();
      onRejected.dispose();
    });
  }
  promiseThenRaw(promise, onFulfilled, onRejected) {
    return new JSValueHandle(this, this.exports.qjs_promise_then(promise.ptr, onFulfilled.ptr, onRejected.ptr));
  }
  markPromiseHandled(promise) {
    this.assertNotDisposed();
    this.exports.qjs_promise_mark_as_handled(promise.ptr);
  }
  callFunction(func, thisVal, ...args) {
    return this.throwIfException(this.callFunctionRaw(func, thisVal, ...args));
  }
  construct(ctor, ...args) {
    this.assertNotDisposed();
    const argc = args.length;
    let argvPtr = 0;
    if (argc > 0) {
      argvPtr = this.exports.wasm_malloc(argc * 4);
      const view = new DataView(this.exports.memory.buffer);
      for (let i = 0;i < argc; i++) {
        view.setUint32(argvPtr + i * 4, args[i].ptr, true);
      }
    }
    const resultPtr = this.exports.qjs_call_constructor(ctor.ptr, argc, argvPtr);
    if (argvPtr)
      this.exports.wasm_free(argvPtr);
    return this.throwIfException(new JSValueHandle(this, resultPtr));
  }
  callFunctionRaw(func, thisVal, ...args) {
    this.assertNotDisposed();
    const argc = args.length;
    let argvPtr = 0;
    if (argc > 0) {
      argvPtr = this.exports.wasm_malloc(argc * 4);
      const view = new DataView(this.exports.memory.buffer);
      for (let i = 0;i < argc; i++) {
        view.setUint32(argvPtr + i * 4, args[i].ptr, true);
      }
    }
    const resultPtr = this.exports.qjs_call(func.ptr, thisVal.ptr, argc, argvPtr);
    if (argvPtr)
      this.exports.wasm_free(argvPtr);
    return new JSValueHandle(this, resultPtr);
  }
  setProp(obj, key, value) {
    this.assertNotDisposed();
    if (typeof key === "string") {
      const { ptr: namePtr } = this.writeString(key);
      this.exports.qjs_set_prop_string(obj.ptr, namePtr, value.ptr);
      this.exports.wasm_free(namePtr);
    } else {
      this.exports.qjs_set_prop_value(obj.ptr, key.ptr, value.ptr);
    }
  }
  defineProp(obj, key, value, descriptor) {
    this.assertNotDisposed();
    let flags = 0;
    if (descriptor?.configurable)
      flags |= 1;
    if (descriptor?.writable)
      flags |= 2;
    if (descriptor?.enumerable)
      flags |= 4;
    if (typeof key === "string") {
      const { ptr: namePtr } = this.writeString(key);
      this.exports.qjs_define_prop_string(obj.ptr, namePtr, value.ptr, flags);
      this.exports.wasm_free(namePtr);
    } else {
      this.exports.qjs_define_prop_value(obj.ptr, key.ptr, value.ptr, flags);
    }
  }
  getProp(obj, key) {
    this.assertNotDisposed();
    return new JSValueHandle(this, this.exports.qjs_get_prop_value(obj.ptr, key.ptr));
  }
  getException() {
    this.assertNotDisposed();
    return new JSValueHandle(this, this.exports.qjs_get_exception());
  }
  newError(messageOrError) {
    this.assertNotDisposed();
    const errPtr = this.exports.qjs_new_error();
    const errHandle = new JSValueHandle(this, errPtr);
    if (typeof messageOrError === "string") {
      const msgHandle = this.newString(messageOrError);
      errHandle.setProp("message", msgHandle);
      msgHandle.dispose();
    } else {
      const msgHandle = this.newString(messageOrError.message);
      errHandle.setProp("message", msgHandle);
      msgHandle.dispose();
      if (messageOrError.name) {
        const nameHandle = this.newString(messageOrError.name);
        errHandle.setProp("name", nameHandle);
        nameHandle.dispose();
      }
      if (messageOrError.stack) {
        const stackHandle = this.newString(messageOrError.stack);
        errHandle.setProp("stack", stackHandle);
        stackHandle.dispose();
      }
    }
    return errHandle;
  }
  typeof(handle) {
    this.assertNotDisposed();
    const e = this.exports;
    if (e.qjs_is_undefined(handle.ptr))
      return "undefined";
    if (e.qjs_is_null(handle.ptr))
      return "object";
    if (e.qjs_is_bool(handle.ptr))
      return "boolean";
    if (e.qjs_is_number(handle.ptr))
      return "number";
    if (e.qjs_is_big_int(handle.ptr))
      return "bigint";
    if (e.qjs_is_string(handle.ptr))
      return "string";
    if (e.qjs_is_symbol(handle.ptr))
      return "symbol";
    if (e.qjs_is_function(handle.ptr))
      return "function";
    if (e.qjs_is_object(handle.ptr))
      return "object";
    return "unknown";
  }
  dump(handle) {
    this.assertNotDisposed();
    return this._dump(handle, new Map);
  }
  _dump(handle, visited) {
    const e = this.exports;
    if (e.qjs_is_undefined(handle.ptr))
      return;
    if (e.qjs_is_null(handle.ptr))
      return null;
    if (e.qjs_is_bool(handle.ptr))
      return e.qjs_get_bool(handle.ptr) !== 0;
    if (e.qjs_is_number(handle.ptr))
      return e.qjs_get_float64(handle.ptr);
    if (e.qjs_is_string(handle.ptr))
      return handle.toString();
    if (e.qjs_is_big_int(handle.ptr))
      return handle.toBigInt();
    if (e.qjs_is_symbol(handle.ptr)) {
      const descOutPtr = e.wasm_malloc(4);
      const kind = e.qjs_get_symbol_description(handle.ptr, descOutPtr);
      const view = new DataView(e.memory.buffer);
      const descPtr = view.getUint32(descOutPtr, true);
      e.wasm_free(descOutPtr);
      if (kind === 1) {
        const descHandle = new JSValueHandle(this, descPtr);
        const description = descHandle.toString();
        descHandle.dispose();
        return Symbol.for(description);
      } else if (kind === 2) {
        const descHandle = new JSValueHandle(this, descPtr);
        descHandle.dispose();
        return;
      }
      return;
    }
    if (e.qjs_is_array_buffer(handle.ptr))
      return handle.toArrayBuffer();
    if (e.qjs_is_exception(handle.ptr)) {
      const exc = this.getException();
      const msg = exc.toString();
      exc.dispose();
      return new Error(msg);
    }
    if (e.qjs_is_function(handle.ptr))
      return;
    if (e.qjs_is_object(handle.ptr)) {
      const objPtr = e.qjs_get_value_ptr(handle.ptr);
      if (objPtr) {
        const existing = visited.get(objPtr);
        if (existing !== undefined)
          return existing;
      }
    }
    if (e.qjs_is_object(handle.ptr)) {
      const byteOffsetPtr = e.wasm_malloc(4);
      const byteLengthPtr = e.wasm_malloc(4);
      const bytesPerElemPtr = e.wasm_malloc(4);
      const abPtr = e.qjs_get_typed_array_buffer(handle.ptr, byteOffsetPtr, byteLengthPtr, bytesPerElemPtr);
      const abHandle = new JSValueHandle(this, abPtr);
      if (e.qjs_is_exception(abHandle.ptr) === 0) {
        const view = new DataView(e.memory.buffer);
        const byteOffset = view.getUint32(byteOffsetPtr, true);
        const byteLength = view.getUint32(byteLengthPtr, true);
        const bytesPerElement = view.getUint32(bytesPerElemPtr, true);
        e.wasm_free(byteOffsetPtr);
        e.wasm_free(byteLengthPtr);
        e.wasm_free(bytesPerElemPtr);
        const abLenPtr = e.wasm_malloc(4);
        const abDataPtr = e.qjs_get_array_buffer(abHandle.ptr, abLenPtr);
        e.wasm_free(abLenPtr);
        abHandle.dispose();
        if (abDataPtr !== 0) {
          const rawBytes = new Uint8Array(e.memory.buffer, abDataPtr + byteOffset, byteLength).slice();
          switch (bytesPerElement) {
            case 1:
              return rawBytes;
            case 2:
              return new Uint16Array(rawBytes.buffer);
            case 4:
              return new Uint32Array(rawBytes.buffer);
            case 8:
              return new Float64Array(rawBytes.buffer);
            default:
              return rawBytes;
          }
        }
      } else {
        abHandle.dispose();
        e.wasm_free(byteOffsetPtr);
        e.wasm_free(byteLengthPtr);
        e.wasm_free(bytesPerElemPtr);
      }
    }
    if (e.qjs_is_array(handle.ptr)) {
      const lenHandle = handle.getProp("length");
      const len = e.qjs_get_float64(lenHandle.ptr);
      lenHandle.dispose();
      const arr = [];
      const objPtr = e.qjs_get_value_ptr(handle.ptr);
      if (objPtr)
        visited.set(objPtr, arr);
      for (let i = 0;i < len; i++) {
        const elemPtr = e.qjs_get_prop_uint32(handle.ptr, i);
        const elemHandle = new JSValueHandle(this, elemPtr);
        arr.push(this._dump(elemHandle, visited));
        elemHandle.dispose();
      }
      return arr;
    }
    if (e.qjs_is_error(handle.ptr)) {
      const nameHandle = handle.getProp("name");
      const msgHandle = handle.getProp("message");
      const stackHandle = handle.getProp("stack");
      const name = nameHandle.isUndefined ? "Error" : nameHandle.toString();
      const message = msgHandle.isUndefined ? "" : msgHandle.toString();
      const stack = stackHandle.isUndefined ? undefined : stackHandle.toString();
      nameHandle.dispose();
      msgHandle.dispose();
      stackHandle.dispose();
      const err = new Error(message);
      err.name = name;
      if (stack !== undefined) {
        err.stack = stack;
      }
      return err;
    }
    if (e.qjs_is_object(handle.ptr)) {
      const keysPtr = e.qjs_get_own_property_names(handle.ptr);
      const keysHandle = new JSValueHandle(this, keysPtr);
      if (e.qjs_is_exception(keysHandle.ptr) !== 0) {
        keysHandle.dispose();
        return {};
      }
      const lenHandle = keysHandle.getProp("length");
      const len = e.qjs_get_float64(lenHandle.ptr);
      lenHandle.dispose();
      const obj = {};
      const objPtr = e.qjs_get_value_ptr(handle.ptr);
      if (objPtr)
        visited.set(objPtr, obj);
      for (let i = 0;i < len; i++) {
        const keyPtr = e.qjs_get_prop_uint32(keysHandle.ptr, i);
        const keyHandle = new JSValueHandle(this, keyPtr);
        const key = keyHandle.toString();
        keyHandle.dispose();
        const valHandle = handle.getProp(key);
        obj[key] = this._dump(valHandle, visited);
        valHandle.dispose();
      }
      keysHandle.dispose();
      return obj;
    }
    return;
  }
  hostToHandle(value) {
    this.assertNotDisposed();
    if (value === undefined)
      return this.undefined;
    if (value === null)
      return this.null;
    if (value === true)
      return this.true;
    if (value === false)
      return this.false;
    if (typeof value === "number")
      return this.newNumber(value);
    if (typeof value === "string")
      return this.newString(value);
    if (typeof value === "bigint")
      return this.newBigInt(value);
    if (typeof value === "symbol") {
      const key = Symbol.keyFor(value);
      if (key !== undefined) {
        return this.newSymbolFor(key);
      }
      throw new Error(`Cannot convert local symbol to QuickJS handle. Use Symbol.for() for cross-boundary symbols.`);
    }
    if (value instanceof Promise) {
      const deferred = this.newPromise();
      value.then((r) => {
        deferred.resolve(this.hostToHandle(r));
        this.executePendingJobs();
      }, (err) => {
        deferred.reject(this.hostToHandle(err));
        this.executePendingJobs();
      });
      return deferred.handle;
    }
    if (value instanceof Error) {
      return this.newError(value);
    }
    if (value instanceof ArrayBuffer) {
      return this.newArrayBuffer(value);
    }
    if (value instanceof Uint8Array) {
      return this.newUint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
      return this.newArrayBuffer(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    if (Array.isArray(value)) {
      const arr = this.newArray();
      for (let i = 0;i < value.length; i++) {
        const elemHandle = this.hostToHandle(value[i]);
        this.exports.qjs_set_prop_uint32(arr.ptr, i, elemHandle.ptr);
        elemHandle.dispose();
      }
      return arr;
    }
    if (typeof value === "object" && value !== null) {
      const obj = this.newObject();
      for (const [key, val] of Object.entries(value)) {
        const valHandle = this.hostToHandle(val);
        obj.setProp(key, valHandle);
        valHandle.dispose();
      }
      return obj;
    }
    return this.undefined;
  }
  snapshot() {
    this.assertNotDisposed();
    return {
      memory: new Uint8Array(this.exports.memory.buffer).slice(),
      stackPointer: this.exports.__stack_pointer.value,
      runtimePtr: this.exports.qjs_get_runtime_ptr(),
      contextPtr: this.exports.qjs_get_context_ptr(),
      extensions: this.loadedExtensions.map((ext) => ({
        name: ext.name,
        memoryBase: ext.memoryBase,
        tableBase: ext.tableBase,
        initFn: ext.initFn
      }))
    };
  }
  registerHostCallback(name, fn) {
    this.hostCallbacks.set(name, fn);
  }
  dispose() {
    if (!this.disposed) {
      this.disposed = true;
      this._global = null;
      this._undefined = null;
      this._null = null;
      this._true = null;
      this._false = null;
      this._ownedHandles.clear();
      this.hostCallbacks.clear();
      this._activeScope = null;
      this.exports = null;
      this.instance = null;
      this.module = null;
    }
  }
  [Symbol.dispose]() {
    this.dispose();
  }
  assertNotDisposed() {
    if (this.disposed) {
      throw new Error("QuickJS instance has been disposed");
    }
  }
  _getExports() {
    return this.exports;
  }
  _getMemory() {
    return this.exports.memory;
  }
  _writeString(str) {
    return this.writeString(str);
  }
  _readCString(ptr) {
    return this.readCString(ptr);
  }
}
function stringKeyNeedsValuePath(key) {
  return key.includes("\x00") || LONE_SURROGATE_RE.test(key);
}
var wtf8Decoder = new TextDecoder;
var wtf8Encoder = new TextEncoder;
var LONE_SURROGATE_RE = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/;
function encodeWtf8(str) {
  if (!LONE_SURROGATE_RE.test(str))
    return wtf8Encoder.encode(str);
  const bytes = [];
  for (let i = 0;i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 128) {
      bytes.push(code);
    } else if (code < 2048) {
      bytes.push(192 | code >> 6, 128 | code & 63);
    } else if (code >= 55296 && code <= 56319 && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 56320 && next <= 57343) {
        const cp = 65536 + (code - 55296 << 10) + (next - 56320);
        bytes.push(240 | cp >> 18, 128 | cp >> 12 & 63, 128 | cp >> 6 & 63, 128 | cp & 63);
        i++;
        continue;
      }
      bytes.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
    } else {
      bytes.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
    }
  }
  return new Uint8Array(bytes);
}
function decodeWtf8(bytes) {
  let hasSurrogateSequence = false;
  for (let i = 0;i < bytes.length - 1; i++) {
    if (bytes[i] === 237 && bytes[i + 1] >= 160 && bytes[i + 1] <= 191) {
      hasSurrogateSequence = true;
      break;
    }
  }
  if (!hasSurrogateSequence)
    return wtf8Decoder.decode(bytes);
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 128) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if (b0 < 224) {
      out += String.fromCharCode((b0 & 31) << 6 | bytes[i + 1] & 63);
      i += 2;
    } else if (b0 < 240) {
      out += String.fromCharCode((b0 & 15) << 12 | (bytes[i + 1] & 63) << 6 | bytes[i + 2] & 63);
      i += 3;
    } else {
      const cp = (b0 & 7) << 18 | (bytes[i + 1] & 63) << 12 | (bytes[i + 2] & 63) << 6 | bytes[i + 3] & 63;
      out += String.fromCodePoint(cp);
      i += 4;
    }
  }
  return out;
}

class JSException extends Error {
  handle;
  #name;
  #message;
  #stack;
  constructor(handle) {
    const env_1 = { stack: [], error: undefined, hasError: false };
    try {
      super();
      this.handle = handle;
      delete this.stack;
      const msgHandle = __addDisposableResource(env_1, handle.getProp("message"), false);
      this.#name = handle.getProp("name").consume((h) => h.isUndefined ? "Error" : h.toString());
      this.#message = msgHandle.isUndefined ? handle.toString() : msgHandle.toString();
      this.#stack = handle.getProp("stack").consume((h) => h.isUndefined ? undefined : h.toString());
    } catch (e_1) {
      env_1.error = e_1;
      env_1.hasError = true;
    } finally {
      __disposeResources(env_1);
    }
  }
  get name() {
    return this.#name;
  }
  set name(v) {
    this.#name = v;
  }
  get message() {
    return this.#message;
  }
  set message(v) {
    this.#message = v;
  }
  get stack() {
    return this.#stack;
  }
  set stack(v) {
    this.#stack = v;
  }
  dispose() {
    this.handle.dispose();
  }
  [Symbol.dispose]() {
    this.handle.dispose();
  }
}

class JSValueHandle {
  vm;
  ptr;
  disposed_ = false;
  singleton;
  borrowed;
  _onDispose;
  constructor(vm, ptr, singleton = false, borrowed = false) {
    this.vm = vm;
    this.ptr = ptr;
    this.singleton = singleton;
    this.borrowed = borrowed;
    if (!singleton && !borrowed)
      vm._activeScope?.add(this);
  }
  get _isBorrowed() {
    return this.borrowed;
  }
  get disposed() {
    return this.disposed_;
  }
  get isUndefined() {
    return this.vm._getExports().qjs_is_undefined(this.ptr) !== 0;
  }
  get isNull() {
    return this.vm._getExports().qjs_is_null(this.ptr) !== 0;
  }
  get isBool() {
    return this.vm._getExports().qjs_is_bool(this.ptr) !== 0;
  }
  get isNumber() {
    return this.vm._getExports().qjs_is_number(this.ptr) !== 0;
  }
  get isString() {
    return this.vm._getExports().qjs_is_string(this.ptr) !== 0;
  }
  get isSymbol() {
    return this.vm._getExports().qjs_is_symbol(this.ptr) !== 0;
  }
  get isBigInt() {
    return this.vm._getExports().qjs_is_big_int(this.ptr) !== 0;
  }
  get isObject() {
    return this.vm._getExports().qjs_is_object(this.ptr) !== 0;
  }
  get isArray() {
    return this.vm._getExports().qjs_is_array(this.ptr) !== 0;
  }
  get isFunction() {
    return this.vm._getExports().qjs_is_function(this.ptr) !== 0;
  }
  get isError() {
    return this.vm._getExports().qjs_is_error(this.ptr) !== 0;
  }
  get isPromise() {
    return this.vm._getExports().qjs_is_promise(this.ptr) !== 0;
  }
  get isArrayBuffer() {
    return this.vm._getExports().qjs_is_array_buffer(this.ptr) !== 0;
  }
  get isProxy() {
    return this.vm._getExports().qjs_is_proxy(this.ptr) !== 0;
  }
  get isMap() {
    return this.vm._getExports().qjs_is_map(this.ptr) !== 0;
  }
  get isSet() {
    return this.vm._getExports().qjs_is_set(this.ptr) !== 0;
  }
  get isDate() {
    return this.vm._getExports().qjs_is_date(this.ptr) !== 0;
  }
  get isRegExp() {
    return this.vm._getExports().qjs_is_regexp(this.ptr) !== 0;
  }
  get isWeakRef() {
    return this.vm._getExports().qjs_is_weak_ref(this.ptr) !== 0;
  }
  get isWeakMap() {
    return this.vm._getExports().qjs_is_weak_map(this.ptr) !== 0;
  }
  get isWeakSet() {
    return this.vm._getExports().qjs_is_weak_set(this.ptr) !== 0;
  }
  get isDataView() {
    return this.vm._getExports().qjs_is_data_view(this.ptr) !== 0;
  }
  get identity() {
    return this.vm._getExports().qjs_get_value_ptr(this.ptr);
  }
  toBoolean() {
    return this.vm._getExports().qjs_get_bool(this.ptr) !== 0;
  }
  get classId() {
    return this.vm._getExports().qjs_get_class_id(this.ptr);
  }
  get className() {
    const h = new JSValueHandle(this.vm, this.vm._getExports().qjs_get_class_name(this.ptr));
    if (this.vm._getExports().qjs_is_exception(h.ptr) !== 0) {
      h.dispose();
      throw new JSException(this.vm.getException());
    }
    try {
      return h.isUndefined ? undefined : h.toString();
    } finally {
      h.dispose();
    }
  }
  get promiseState() {
    return this.vm._getExports().qjs_promise_state(this.ptr);
  }
  get typeof() {
    return this.vm.typeof(this);
  }
  get length() {
    const h = this.getProp("length");
    const n = h.toNumber();
    h.dispose();
    return n;
  }
  get constructorName() {
    const ctor = this.getProp("constructor");
    if (ctor.isUndefined || ctor.isNull) {
      ctor.dispose();
      return;
    }
    const name = ctor.getProp("name");
    ctor.dispose();
    if (name.isUndefined || name.isNull) {
      name.dispose();
      return;
    }
    const result = name.toString();
    name.dispose();
    return result;
  }
  keys() {
    const e = this.vm._getExports();
    const keysPtr = e.qjs_get_own_property_names(this.ptr);
    const keysHandle = new JSValueHandle(this.vm, keysPtr);
    if (e.qjs_is_exception(keysHandle.ptr) !== 0) {
      keysHandle.dispose();
      return [];
    }
    const lenHandle = keysHandle.getProp("length");
    const len = e.qjs_get_float64(lenHandle.ptr);
    lenHandle.dispose();
    const result = [];
    for (let i = 0;i < len; i++) {
      const keyPtr = e.qjs_get_prop_uint32(keysHandle.ptr, i);
      const keyHandle = new JSValueHandle(this.vm, keyPtr);
      result.push(keyHandle.toString());
      keyHandle.dispose();
    }
    keysHandle.dispose();
    return result;
  }
  getOwnPropertyNames() {
    const e = this.vm._getExports();
    const keysPtr = e.qjs_get_own_property_names_all(this.ptr);
    const keysHandle = new JSValueHandle(this.vm, keysPtr);
    if (e.qjs_is_exception(keysHandle.ptr) !== 0) {
      keysHandle.dispose();
      return [];
    }
    const lenHandle = keysHandle.getProp("length");
    const len = e.qjs_get_float64(lenHandle.ptr);
    lenHandle.dispose();
    const result = [];
    for (let i = 0;i < len; i++) {
      const keyPtr = e.qjs_get_prop_uint32(keysHandle.ptr, i);
      const keyHandle = new JSValueHandle(this.vm, keyPtr);
      result.push(keyHandle.toString());
      keyHandle.dispose();
    }
    keysHandle.dispose();
    return result;
  }
  getOwnPropertyKeys() {
    const e = this.vm._getExports();
    const keysPtr = e.qjs_get_own_property_keys(this.ptr);
    const keysHandle = new JSValueHandle(this.vm, keysPtr);
    if (e.qjs_is_exception(keysHandle.ptr) !== 0) {
      keysHandle.dispose();
      return [];
    }
    const lenHandle = keysHandle.getProp("length");
    const len = e.qjs_get_float64(lenHandle.ptr);
    lenHandle.dispose();
    const result = [];
    for (let i = 0;i < len; i++) {
      const keyPtr = e.qjs_get_prop_uint32(keysHandle.ptr, i);
      const keyHandle = new JSValueHandle(this.vm, keyPtr);
      if (keyHandle.isSymbol) {
        result.push(keyHandle);
      } else {
        result.push(keyHandle.toString());
        keyHandle.dispose();
      }
    }
    keysHandle.dispose();
    return result;
  }
  getOwnPropertyDescriptor(key) {
    const env_2 = { stack: [], error: undefined, hasError: false };
    try {
      const e = this.vm._getExports();
      let keyHandle;
      let keyPtr;
      if (typeof key === "string") {
        keyHandle = this.vm.newString(key);
        keyPtr = keyHandle.ptr;
      } else {
        keyPtr = key.ptr;
      }
      const descPtr = e.qjs_get_own_property_descriptor(this.ptr, keyPtr);
      keyHandle?.dispose();
      if (descPtr === 0)
        return;
      const descHandle = __addDisposableResource(env_2, new JSValueHandle(this.vm, descPtr), false);
      if (e.qjs_is_exception(descHandle.ptr) !== 0) {
        throw new JSException(this.vm.getException());
      }
      const enumerable = descHandle.getProp("enumerable").consume((h) => e.qjs_get_bool(h.ptr) !== 0);
      const configurable = descHandle.getProp("configurable").consume((h) => e.qjs_get_bool(h.ptr) !== 0);
      if (descHandle.hasOwnProperty("value")) {
        return {
          value: descHandle.getProp("value"),
          writable: descHandle.getProp("writable").consume((h) => e.qjs_get_bool(h.ptr) !== 0),
          enumerable,
          configurable
        };
      }
      return {
        get: descHandle.getProp("get"),
        set: descHandle.getProp("set"),
        enumerable,
        configurable
      };
    } catch (e_2) {
      env_2.error = e_2;
      env_2.hasError = true;
    } finally {
      __disposeResources(env_2);
    }
  }
  hasOwnProperty(name) {
    if (stringKeyNeedsValuePath(name)) {
      const env_3 = { stack: [], error: undefined, hasError: false };
      try {
        const keyHandle = __addDisposableResource(env_3, this.vm.newString(name), false);
        return this.vm._getExports().qjs_has_own_property_value(this.ptr, keyHandle.ptr) === 1;
      } catch (e_3) {
        env_3.error = e_3;
        env_3.hasError = true;
      } finally {
        __disposeResources(env_3);
      }
    }
    const { ptr: namePtr } = this.vm._writeString(name);
    const result = this.vm._getExports().qjs_has_own_property(this.ptr, namePtr);
    this.vm._getExports().wasm_free(namePtr);
    return result === 1;
  }
  propertyIsEnumerable(name) {
    if (stringKeyNeedsValuePath(name)) {
      const env_4 = { stack: [], error: undefined, hasError: false };
      try {
        const keyHandle = __addDisposableResource(env_4, this.vm.newString(name), false);
        return this.vm._getExports().qjs_property_is_enumerable_value(this.ptr, keyHandle.ptr) === 1;
      } catch (e_4) {
        env_4.error = e_4;
        env_4.hasError = true;
      } finally {
        __disposeResources(env_4);
      }
    }
    const { ptr: namePtr } = this.vm._writeString(name);
    const result = this.vm._getExports().qjs_property_is_enumerable(this.ptr, namePtr);
    this.vm._getExports().wasm_free(namePtr);
    return result === 1;
  }
  getPrototypeOf() {
    const protoPtr = this.vm._getExports().qjs_get_prototype_of(this.ptr);
    return new JSValueHandle(this.vm, protoPtr);
  }
  getProxyTarget() {
    const ptr = this.vm._getExports().qjs_get_proxy_target(this.ptr);
    const handle = new JSValueHandle(this.vm, ptr);
    if (this.vm._getExports().qjs_is_exception(handle.ptr) !== 0) {
      handle.dispose();
      throw new JSException(this.vm.getException());
    }
    return handle;
  }
  getProxyHandler() {
    const ptr = this.vm._getExports().qjs_get_proxy_handler(this.ptr);
    const handle = new JSValueHandle(this.vm, ptr);
    if (this.vm._getExports().qjs_is_exception(handle.ptr) !== 0) {
      handle.dispose();
      throw new JSException(this.vm.getException());
    }
    return handle;
  }
  getProp(name) {
    if (stringKeyNeedsValuePath(name)) {
      const env_5 = { stack: [], error: undefined, hasError: false };
      try {
        const keyHandle = __addDisposableResource(env_5, this.vm.newString(name), false);
        return this.vm.getProp(this, keyHandle);
      } catch (e_5) {
        env_5.error = e_5;
        env_5.hasError = true;
      } finally {
        __disposeResources(env_5);
      }
    }
    const { ptr: namePtr } = this.vm._writeString(name);
    const resultPtr = this.vm._getExports().qjs_get_prop_string(this.ptr, namePtr);
    this.vm._getExports().wasm_free(namePtr);
    return new JSValueHandle(this.vm, resultPtr);
  }
  setProp(name, value) {
    if (stringKeyNeedsValuePath(name)) {
      const env_6 = { stack: [], error: undefined, hasError: false };
      try {
        const keyHandle = __addDisposableResource(env_6, this.vm.newString(name), false);
        this.vm.setProp(this, keyHandle, value);
        return;
      } catch (e_6) {
        env_6.error = e_6;
        env_6.hasError = true;
      } finally {
        __disposeResources(env_6);
      }
    }
    const { ptr: namePtr } = this.vm._writeString(name);
    this.vm._getExports().qjs_set_prop_string(this.ptr, namePtr, value.ptr);
    this.vm._getExports().wasm_free(namePtr);
  }
  defineProp(key, value, descriptor) {
    let flags = 0;
    if (descriptor?.configurable)
      flags |= 1;
    if (descriptor?.writable)
      flags |= 2;
    if (descriptor?.enumerable)
      flags |= 4;
    if (typeof key === "string") {
      if (stringKeyNeedsValuePath(key)) {
        const env_7 = { stack: [], error: undefined, hasError: false };
        try {
          const keyHandle = __addDisposableResource(env_7, this.vm.newString(key), false);
          this.vm._getExports().qjs_define_prop_value(this.ptr, keyHandle.ptr, value.ptr, flags);
          return;
        } catch (e_7) {
          env_7.error = e_7;
          env_7.hasError = true;
        } finally {
          __disposeResources(env_7);
        }
      }
      const { ptr: namePtr } = this.vm._writeString(key);
      this.vm._getExports().qjs_define_prop_string(this.ptr, namePtr, value.ptr, flags);
      this.vm._getExports().wasm_free(namePtr);
    } else {
      this.vm._getExports().qjs_define_prop_value(this.ptr, key.ptr, value.ptr, flags);
    }
  }
  toNumber() {
    return this.vm._getExports().qjs_get_float64(this.ptr);
  }
  toBigInt() {
    const e = this.vm._getExports();
    const loPtr = e.wasm_malloc(4);
    const hiPtr = e.wasm_malloc(4);
    const ret = e.qjs_get_big_int64(this.ptr, loPtr, hiPtr);
    if (ret !== 0) {
      e.wasm_free(loPtr);
      e.wasm_free(hiPtr);
      throw new Error("Failed to convert value to BigInt");
    }
    const view = new DataView(e.memory.buffer);
    const lo = view.getUint32(loPtr, true);
    const hi = view.getInt32(hiPtr, true);
    e.wasm_free(loPtr);
    e.wasm_free(hiPtr);
    return BigInt(hi) << 32n | BigInt(lo);
  }
  toArrayBuffer() {
    const e = this.vm._getExports();
    const lenOutPtr = e.wasm_malloc(4);
    if (e.qjs_is_array_buffer(this.ptr)) {
      const dataPtr = e.qjs_get_array_buffer(this.ptr, lenOutPtr);
      if (dataPtr === 0) {
        e.wasm_free(lenOutPtr);
        throw new Error("Failed to get ArrayBuffer data");
      }
      const view = new DataView(e.memory.buffer);
      const len = view.getUint32(lenOutPtr, true);
      e.wasm_free(lenOutPtr);
      return new Uint8Array(e.memory.buffer, dataPtr, len).slice().buffer;
    }
    e.wasm_free(lenOutPtr);
    const byteOffsetPtr = e.wasm_malloc(4);
    const byteLengthPtr = e.wasm_malloc(4);
    const bytesPerElemPtr = e.wasm_malloc(4);
    const abPtr = e.qjs_get_typed_array_buffer(this.ptr, byteOffsetPtr, byteLengthPtr, bytesPerElemPtr);
    const abHandle = new JSValueHandle(this.vm, abPtr);
    if (this.vm._getExports().qjs_is_exception(abHandle.ptr) !== 0) {
      abHandle.dispose();
      e.wasm_free(byteOffsetPtr);
      e.wasm_free(byteLengthPtr);
      e.wasm_free(bytesPerElemPtr);
      throw new Error("Value is not an ArrayBuffer or typed array");
    }
    const view = new DataView(e.memory.buffer);
    const byteOffset = view.getUint32(byteOffsetPtr, true);
    const byteLength = view.getUint32(byteLengthPtr, true);
    e.wasm_free(byteOffsetPtr);
    e.wasm_free(byteLengthPtr);
    e.wasm_free(bytesPerElemPtr);
    const abLenPtr = e.wasm_malloc(4);
    const abDataPtr = e.qjs_get_array_buffer(abHandle.ptr, abLenPtr);
    e.wasm_free(abLenPtr);
    abHandle.dispose();
    if (abDataPtr === 0) {
      throw new Error("Failed to get ArrayBuffer data from typed array");
    }
    return new Uint8Array(e.memory.buffer, abDataPtr + byteOffset, byteLength).slice().buffer;
  }
  toUint8Array() {
    return new Uint8Array(this.toArrayBuffer());
  }
  toString() {
    const e = this.vm._getExports();
    const lenPtr = e.wasm_malloc(4);
    if (lenPtr === 0)
      throw new Error("wasm_malloc failed");
    try {
      const cstrPtr = e.qjs_get_string_len(this.ptr, lenPtr);
      if (cstrPtr === 0)
        return "<null>";
      const len = new DataView(e.memory.buffer).getUint32(lenPtr, true);
      const bytes = new Uint8Array(e.memory.buffer, cstrPtr, len);
      const str = decodeWtf8(bytes);
      e.qjs_free_cstring(cstrPtr);
      return str;
    } finally {
      e.wasm_free(lenPtr);
    }
  }
  consume(fn) {
    try {
      return fn(this);
    } finally {
      this.dispose();
    }
  }
  dup() {
    return new JSValueHandle(this.vm, this.vm._getExports().qjs_dup_value(this.ptr));
  }
  dispose() {
    if (this.singleton || this.borrowed)
      return;
    if (!this.disposed_) {
      this.disposed_ = true;
      this._onDispose?.();
      this._onDispose = undefined;
      const exports = this.vm._getExports();
      if (exports) {
        exports.qjs_free_value(this.ptr);
      }
    }
  }
  [Symbol.dispose]() {
    this.dispose();
  }
}

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
var DETERMINISTIC_VERSION = 1;
function fnv1a(text) {
  let hash = 2166136261;
  for (let index = 0;index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
var PRELUDE_HASH = fnv1a(PRELUDE_SOURCE);
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return (value ^ value >>> 14) >>> 0;
  };
}
function deterministicWasi(clock) {
  const random = prng(clock.seed ^ 2654435769);
  return (memory) => ({
    ...discardOutput(memory),
    clock_time_get(clockId, _precision, resultPtr) {
      let nanoseconds;
      if (clock.creating)
        nanoseconds = clockId === 0 ? BigInt(clock.seed + 1) * 1000n : 0n;
      else if (clockId === 0)
        nanoseconds = BigInt(Math.round(clock.now)) * 1000000n;
      else
        nanoseconds = BigInt(Math.round(clock.now - clock.startedAt)) * 1000000n;
      new DataView(memory.buffer).setBigUint64(resultPtr, nanoseconds, true);
      return 0;
    },
    random_get(bufPtr, bufLen) {
      const bytes = new Uint8Array(memory.buffer, bufPtr, bufLen);
      for (let index = 0;index < bufLen; index += 4) {
        const value = random();
        for (let byte = 0;byte < 4 && index + byte < bufLen; byte++)
          bytes[index + byte] = value >>> byte * 8;
      }
      return 0;
    }
  });
}
function discardOutput(memory) {
  return {
    fd_write(_fd, iovsPtr, iovsLen, nwrittenPtr) {
      const view = new DataView(memory.buffer);
      let written = 0;
      for (let i = 0;i < iovsLen; i++) {
        written += view.getUint32(iovsPtr + i * 8 + 4, true);
      }
      view.setUint32(nwrittenPtr, written, true);
      return 0;
    }
  };
}
function describeException(error) {
  const head = error.message ? `${error.name}: ${error.message}` : error.name;
  const stack = error.stack?.trimEnd();
  return JSON.stringify({ name: error.name, message: error.message, stack: stack ? `${head}
${stack}` : head });
}
var JOBS_PER_POLL = 50;
function crashMessage(error) {
  return { type: "crash", message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
}
async function startVm(options) {
  const { data, post } = options;
  const maxStackSize = options.maxStackSize ?? MAX_STACK_SIZE;
  const deterministic = data.deterministic;
  const clock = deterministic && {
    creating: true,
    startedAt: deterministic.startedAt,
    now: deterministic.startedAt,
    seed: deterministic.seed >>> 0
  };
  const vm = await QuickJS.create({
    wasm: options.wasm,
    memoryLimit: data.memoryLimitBytes,
    maxStackSize,
    interruptHandler: options.shouldInterrupt,
    wasi: clock ? deterministicWasi(clock) : discardOutput,
    ...clock ? { timezoneOffset: 0, intrinsics: Intrinsics.ALL & ~Intrinsics.WEAK_REF } : {}
  });
  if (clock)
    clock.creating = false;
  let disposed = false;
  let issued = 0;
  let nextSeq = 1;
  let current = 0;
  const early = new Map;
  const apply = (message) => {
    vm.withScope(() => {
      vm.callFunction(settle, api, vm.newNumber(message.id), message.ok ? vm.true : vm.false, message.payload === undefined ? vm.undefined : vm.newString(message.payload), message.properties === undefined ? vm.undefined : vm.newString(message.properties));
    });
    drain();
  };
  const session = {
    deliver(message) {
      if (disposed)
        return;
      try {
        if (!clock) {
          apply(message);
          return;
        }
        const { seq } = message;
        if (seq === undefined || !Number.isInteger(seq) || seq < nextSeq || early.has(seq)) {
          throw new Error(`Result ${message.id} has sequence number ${seq}, expected ${nextSeq} or later, once`);
        }
        early.set(seq, message);
        for (let next = early.get(nextSeq);next !== undefined; next = early.get(nextSeq)) {
          early.delete(nextSeq);
          if (next.now !== undefined && Number.isFinite(next.now))
            clock.now = Math.max(clock.now, next.now);
          current = nextSeq;
          apply(next);
          post({ type: "idle", seq: nextSeq, issued });
          nextSeq++;
        }
      } catch (error) {
        post(crashMessage(error));
      }
    },
    dispose() {
      if (disposed)
        return;
      disposed = true;
      vm.dispose();
    }
  };
  let api;
  let settle;
  let stalled;
  const exports = vm._getExports();
  const drain = () => {
    let jobs = 0;
    while (exports.qjs_is_job_pending()) {
      if (exports.qjs_execute_pending_job() < 0)
        throw new Error("Promise job failed");
      if (++jobs % JOBS_PER_POLL === 0 && options.shouldInterrupt())
        throw new Error("Execution interrupted");
    }
    vm.callFunction(stalled, api).dispose();
  };
  try {
    const bridge = vm.newFunction("bridge", (kind, a, b, c) => {
      switch (kind.toString()) {
        case "call":
        case "global":
          issued++;
          post({
            type: "call",
            id: a.toNumber(),
            target: kind.toString() === "call" ? "tool" : "global",
            name: b.toString(),
            args: c === undefined || c.isUndefined ? undefined : c.toString()
          });
          break;
        case "output":
          post({
            type: "output",
            item: a.toString() === "image" ? { type: "image", data: b.toString(), mimeType: c.toString() } : a.toString() === "console" ? { type: "text", text: b.toString(), console: true } : { type: "text", text: b.toString() }
          });
          break;
        case "done": {
          const during = clock ? { during: { seq: current, issued } } : {};
          if (a.toBoolean()) {
            post({
              type: "done",
              ok: true,
              value: b === undefined || b.isUndefined ? undefined : b.toString(),
              writes: c.toString(),
              ...during
            });
          } else {
            post({ type: "done", ok: false, error: b.toString(), ...during });
          }
          break;
        }
      }
      return vm.undefined;
    });
    api = vm.withScope((scope) => scope.escape(vm.callFunction(vm.evalCode(PRELUDE_SOURCE, "codemode-prelude.js"), vm.undefined, bridge, vm.newString(JSON.stringify(data.tools)), vm.newString(JSON.stringify(data.globals)), vm.newString(JSON.stringify(data.store)))));
    settle = api.getProp("settle");
    const run = api.getProp("run");
    stalled = api.getProp("stalled");
    if (clock) {
      const versions = vm.versions;
      const budget = options.interruptBudget ?? "none";
      post({
        type: "started",
        fingerprint: `quickjs-wasi ${versions["quickjs-wasi"]}, quickjs ${versions.quickjs}, prelude ${PRELUDE_HASH}, deterministic ${DETERMINISTIC_VERSION}, stack ${maxStackSize}, heap ${data.memoryLimitBytes ?? "none"}, budget ${budget}`
      });
    }
    let fn;
    try {
      fn = vm.evalCode(`(async (tools, console) => {${data.code}
})`, "codemode.js");
    } catch (error) {
      if (!(error instanceof JSException))
        throw error;
      post({ type: "done", ok: false, error: describeException(error) });
      return session;
    }
    vm.callFunction(run, api, fn).dispose();
    fn.dispose();
    drain();
    if (clock)
      post({ type: "idle", seq: 0, issued });
  } catch (error) {
    post(crashMessage(error));
  }
  return session;
}

// node_modules/@earendil-works/pi-codemode/dist/runtime/worker.js
function post(message) {
  parentPort?.postMessage(message);
}
async function main(data) {
  const interrupt = new Int32Array(data.interrupt);
  const session = await startVm({
    data,
    wasm: data.wasm,
    post,
    shouldInterrupt: () => Atomics.load(interrupt, 0) !== 0
  });
  parentPort?.on("message", (message) => {
    if (isHostToWorkerMessage(message))
      session.deliver(message);
  });
}
if (parentPort) {
  main(workerData).catch((error) => {
    post({ type: "crash", message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  });
}
