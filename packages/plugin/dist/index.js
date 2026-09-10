var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array3, separator = " | ") {
    return array3.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status2, results) {
    const arrayValue = [];
    for (const s2 of results) {
      if (s2.status === "aborted")
        return INVALID;
      if (s2.status === "dirty")
        status2.dirty();
      arrayValue.push(s2.value);
    }
    return { status: status2.value, value: arrayValue };
  }
  static async mergeObjectAsync(status2, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status2, syncPairs);
  }
  static mergeObjectSync(status2, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status2.dirty();
      if (value.status === "dirty")
        status2.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status2.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input2) {
    return getParsedType(input2.data);
  }
  _getOrReturnCtx(input2, ctx) {
    return ctx || {
      common: input2.parent.common,
      data: input2.data,
      parsedType: getParsedType(input2.data),
      schemaErrorMap: this._def.errorMap,
      path: input2.path,
      parent: input2.parent
    };
  }
  _processInputParams(input2) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input2.parent.common,
        data: input2.data,
        parsedType: getParsedType(input2.data),
        schemaErrorMap: this._def.errorMap,
        path: input2.path,
        parent: input2.parent
      }
    };
  }
  _parseSync(input2) {
    const result = this._parse(input2);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input2) {
    const result = this._parse(input2);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input2) {
    if (this._def.coerce) {
      input2.data = String(input2.data);
    }
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input2);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status2 = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input2.data.length < check.value) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "max") {
        if (input2.data.length > check.value) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input2.data.length > check.value;
        const tooSmall = input2.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input2, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status2.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input2.data);
        } catch {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input2.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "trim") {
        input2.data = input2.data.trim();
      } else if (check.kind === "includes") {
        if (!input2.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input2.data = input2.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input2.data = input2.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input2.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input2.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input2.data, check.version)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input2.data, check.alg)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input2.data, check.version)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status2.value, value: input2.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input2) {
    if (this._def.coerce) {
      input2.data = Number(input2.data);
    }
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input2);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status2 = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input2.data < check.value : input2.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input2.data > check.value : input2.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input2.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status2.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status2.value, value: input2.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input2) {
    if (this._def.coerce) {
      try {
        input2.data = BigInt(input2.data);
      } catch {
        return this._getInvalidInput(input2);
      }
    }
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input2);
    }
    let ctx = void 0;
    const status2 = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input2.data < check.value : input2.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input2.data > check.value : input2.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input2.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status2.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status2.value, value: input2.data };
  }
  _getInvalidInput(input2) {
    const ctx = this._getOrReturnCtx(input2);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input2) {
    if (this._def.coerce) {
      input2.data = Boolean(input2.data);
    }
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input2.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input2) {
    if (this._def.coerce) {
      input2.data = new Date(input2.data);
    }
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input2);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input2.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input2);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status2 = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input2.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status2.dirty();
        }
      } else if (check.kind === "max") {
        if (input2.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status2.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status2.value,
      value: new Date(input2.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input2.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input2.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input2.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input2) {
    return OK(input2.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input2) {
    return OK(input2.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input2) {
    const ctx = this._getOrReturnCtx(input2);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input2.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input2) {
    const { ctx, status: status2 } = this._processInputParams(input2);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status2.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status2.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status2.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status2, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status2, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input2);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status: status2, ctx } = this._processInputParams(input2);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status2.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status2, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status2, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input2) {
    const { status: status2, ctx } = this._processInputParams(input2);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status2.dirty();
      }
      return { status: status2.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input2) {
    const { status: status2, ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status2.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status2, results);
      });
    } else {
      return ParseStatus.mergeArray(status2, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas2, params) => {
  if (!Array.isArray(schemas2)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas2,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input2) {
    const { status: status2, ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status2, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status2, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input2) {
    const { status: status2, ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status2.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status2.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status2.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status2.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input2) {
    const { status: status2, ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status2.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status2.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status2.dirty();
        parsedSet.add(element.value);
      }
      return { status: status2.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input2) {
    if (input2.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input2.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input2) {
    if (typeof input2.data !== "string") {
      const ctx = this._getOrReturnCtx(input2);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input2.data)) {
      const ctx = this._getOrReturnCtx(input2);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input2.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input2) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input2);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input2.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input2.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input2) {
    const { status: status2, ctx } = this._processInputParams(input2);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status2.abort();
        } else {
          status2.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status2.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status2.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status2.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status2.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status2.dirty();
        executeRefinement(inner.value);
        return { status: status2.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status2.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status2.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status2.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status2.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input2);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input2);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input2.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input2) {
    const { status: status2, ctx } = this._processInputParams(input2);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status2.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status2.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input2) {
    const result = this._def.innerType._parse(input2);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// ../protocol/dist/index.js
var PROTOCOL_VERSION = 1;
var MAX_CONTROL_FRAME_BYTES = 64 * 1024;
var MAX_RELAY_FRAME_BYTES = 1024 * 1024;
var SECURE_FRAGMENT_CHUNK_BYTES = 48 * 1024;
var MAX_SECURE_MESSAGE_BYTES = 4 * 1024 * 1024;
var HARNESS_API_TRANSFER_CHUNK_BYTES = 512 * 1024;
var CODEX_APP_TRANSFER_CHUNK_BYTES = 512 * 1024;
var MAX_HARNESS_API_TRANSFER_BYTES = 288 * 1024 * 1024;
var MAX_CODEX_APP_TRANSFER_BYTES = 288 * 1024 * 1024;
var MAX_DEVICE_NAME_LENGTH = 128;
var MAX_DEVICE_PLATFORM_LENGTH = 64;
var MAX_DEVICE_VERSION_LENGTH = 64;
var MAX_AUTH_TOKEN_LENGTH = 8 * 1024;
var HOST_REGISTRATION_CODE_TTL_MS = 10 * 6e4;
var MAX_ACTIVE_TRANSFERS_PER_DIRECTION = 2;
var TRANSFER_IDLE_MS = 2 * 6e4;
var MAX_RPC_TEXT_INPUT_BYTES = 64 * 1024;
var MAX_FILEVIEWER_RANGE_BYTES = 512 * 1024;
var MIN_REPLAY_WINDOW_MS = 15 * 6e4;
var MAX_ALPHA_STREAMS_PER_CONNECTION = 16;
var SECURE_FRAGMENT_MAGIC = new Uint8Array([68, 83, 72, 70]);
var SECURE_FRAGMENT_VERSION = 1;
var SECURE_FRAGMENT_HEADER_BYTES = 17;
var MAX_IN_FLIGHT_SECURE_MESSAGES = 8;
var messageTypes = [
  "rpc.request",
  "rpc.response",
  "rpc.error",
  "event"
];
var controlFrameTypes = [
  "hello",
  "hello.ack",
  "connect.request",
  "connect.incoming",
  "connect.accepted",
  "connect.rejected",
  "secure.handshake",
  "relay",
  "signal.offer",
  "signal.answer",
  "signal.ice",
  "transport.selected",
  "ping",
  "pong",
  "error"
];
var rpcMethods = [
  "harness.transport.describe",
  "harness.api.call",
  "harness.api.transfer.open",
  "harness.api.transfer.chunk",
  "harness.api.transfer.commit",
  "harness.api.transfer.read",
  "harness.api.transfer.close",
  "harness.api.respond",
  "harness.api.stream.open",
  "harness.api.stream.close",
  "harness.remote.call",
  "harness.remote.transfer.open",
  "harness.remote.transfer.chunk",
  "harness.remote.transfer.commit",
  "harness.remote.transfer.read",
  "harness.remote.transfer.close",
  "harness.remote.stream.open",
  "harness.remote.stream.close",
  "fileviewer.call",
  "codex.app.call",
  "codex.app.respond",
  "codex.app.stream.open",
  "codex.app.stream.close",
  "codex.app.transfer.open",
  "codex.app.transfer.chunk",
  "codex.app.transfer.commit",
  "codex.app.transfer.read",
  "codex.app.transfer.close"
];
var errorCodes = [
  // Protocol / Version
  "INVALID_MESSAGE",
  "UNSUPPORTED_VERSION",
  "CAPABILITY_NOT_SUPPORTED",
  "METHOD_NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "REQUEST_CONFLICT",
  "FRAME_TOO_LARGE",
  "RATE_LIMITED",
  // Auth / Device
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "ACCOUNT_AUTH_REQUIRED",
  "TOKEN_EXPIRED",
  "DEVICE_NOT_FOUND",
  "DEVICE_REVOKED",
  "DEVICE_OWNERSHIP_REQUIRED",
  "MEMBERSHIP_REQUIRED",
  "PEER_IDENTITY_MISMATCH",
  "HOST_REGISTRATION_CODE_NOT_FOUND",
  "HOST_REGISTRATION_CODE_EXPIRED",
  "HOST_REGISTRATION_CODE_CONSUMED",
  // Connection / Transport
  "HOST_OFFLINE",
  "CONNECTION_NOT_FOUND",
  "CONNECTION_FAILED",
  "CONNECTION_REPLACED",
  "P2P_FAILED",
  "TURN_UNAVAILABLE",
  "RELAY_UNAVAILABLE",
  "SLOW_CONSUMER",
  "SECURE_CHANNEL_FAILED",
  // Harness
  "HARNESS_UNAVAILABLE",
  "HARNESS_VERSION_INCOMPATIBLE",
  "RESPONSE_TOO_LARGE",
  "SESSION_NOT_FOUND",
  "SESSION_NOT_READY",
  "AGENT_BUSY",
  "PERMISSION_DENIED",
  "PERMISSION_NOT_PENDING",
  "RPC_TIMEOUT",
  "FULL_RESYNC_REQUIRED",
  "INTERNAL_ERROR"
];
var selectedTransports = ["lan", "p2p", "turn", "relay"];
function normalizeSdpMLineIndex(value) {
  if (value === void 0)
    return void 0;
  if (value === null)
    return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    return null;
  return value;
}
function selectCapabilities(offered, supported) {
  const offeredCapabilities = new Set(offered);
  return [...new Set(supported)].filter((capability) => offeredCapabilities.has(capability));
}
function acceptNegotiatedCapabilities(offered, negotiated) {
  const accepted = negotiated ?? ["transport.relay"];
  if (selectCapabilities(accepted, offered).length !== accepted.length) {
    throw new Error("Server selected a capability that the peer did not offer.");
  }
  return [...accepted];
}
var rpcMethodSchema = external_exports.enum(rpcMethods);
var messageTypeSchema = external_exports.enum(messageTypes);
var controlFrameTypeSchema = external_exports.enum(controlFrameTypes);
var errorCodeSchema = external_exports.enum(errorCodes);
var uniqueStrings = (values) => new Set(values).size === values.length;
var uniqueNumbers = (values) => new Set(values).size === values.length;
var utf8Length = (value) => new TextEncoder().encode(value).byteLength;
var boundedUtf8Schema = (minimum, maximum) => external_exports.string().refine((value) => utf8Length(value) >= minimum && utf8Length(value) <= maximum);
var deviceIdSchema = external_exports.string().refine((value) => /^[0-9A-HJKMNP-TV-Z]{26}$/iu.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value), "Device ID must be a ULID or UUID.");
var deviceNameSchema = boundedUtf8Schema(1, MAX_DEVICE_NAME_LENGTH).refine((value) => value.trim().length > 0, "Device name must contain visible text.");
var devicePlatformSchema = external_exports.string().min(1).max(MAX_DEVICE_PLATFORM_LENGTH).regex(/^[a-z0-9][a-z0-9._-]*$/u);
var identityKeySchema = external_exports.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
var deviceVersionSchema = boundedUtf8Schema(1, MAX_DEVICE_VERSION_LENGTH);
var authTokenSchema = boundedUtf8Schema(16, MAX_AUTH_TOKEN_LENGTH);
var expiresAtSchema = external_exports.number().int().positive().safe();
var hostDeviceDescriptorSchema = external_exports.object({
  deviceId: deviceIdSchema,
  name: deviceNameSchema,
  role: external_exports.literal("host"),
  platform: devicePlatformSchema,
  identityKey: identityKeySchema,
  clientVersion: deviceVersionSchema,
  harnessVersion: deviceVersionSchema.optional()
}).strict();
var clientDeviceDescriptorSchema = external_exports.object({
  deviceId: deviceIdSchema,
  name: deviceNameSchema,
  role: external_exports.literal("client"),
  platform: devicePlatformSchema,
  identityKey: identityKeySchema,
  clientVersion: deviceVersionSchema
}).strict();
var accountDeviceDescriptorSchema = external_exports.union([
  hostDeviceDescriptorSchema,
  clientDeviceDescriptorSchema
]);
var deviceRegistrationRequestSchema = external_exports.object({
  v: external_exports.literal(PROTOCOL_VERSION),
  device: accountDeviceDescriptorSchema
}).strict();
var hostRegistrationCodeRequestSchema = external_exports.object({
  v: external_exports.literal(PROTOCOL_VERSION),
  code: external_exports.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/u),
  device: hostDeviceDescriptorSchema
}).strict();
var registerOwnedRoleRequestSchema = external_exports.object({
  v: external_exports.literal(PROTOCOL_VERSION),
  device: accountDeviceDescriptorSchema
}).strict();
var deviceRefreshRequestSchema = external_exports.object({
  deviceId: deviceIdSchema,
  refreshToken: authTokenSchema
}).strict();
var deviceTokenPairSchema = external_exports.object({
  accessToken: authTokenSchema,
  accessTokenExpiresAt: expiresAtSchema,
  refreshToken: authTokenSchema,
  refreshTokenExpiresAt: expiresAtSchema
}).strict();
var browserAuthorizationExchangeRequestSchema = external_exports.object({
  v: external_exports.literal(PROTOCOL_VERSION),
  device: external_exports.object({
    deviceId: deviceIdSchema,
    name: deviceNameSchema,
    role: external_exports.literal("client"),
    platform: external_exports.literal("browser"),
    identityKey: identityKeySchema,
    clientVersion: deviceVersionSchema
  }).strict()
}).strict();
var browserAuthorizationExchangeResponseSchema = external_exports.object({
  accessToken: authTokenSchema,
  accessTokenExpiresAt: expiresAtSchema,
  refreshToken: authTokenSchema,
  refreshTokenExpiresAt: expiresAtSchema,
  account: boundedUtf8Schema(1, 254).refine((value) => value.trim().length > 0)
}).strict();
var remoteMessageSchema = external_exports.object({
  v: external_exports.literal(PROTOCOL_VERSION),
  id: external_exports.string().min(1),
  type: messageTypeSchema,
  timestamp: external_exports.number().int().positive(),
  payload: external_exports.unknown()
});
var controlFrameSchema = external_exports.object({
  v: external_exports.literal(PROTOCOL_VERSION),
  id: external_exports.string().min(1),
  type: controlFrameTypeSchema,
  timestamp: external_exports.number().int().positive(),
  payload: external_exports.unknown()
}).strict();
var transportEnum = external_exports.enum(["lan", "p2p", "turn", "relay"]);
var selectedTransportEnum = external_exports.enum(selectedTransports);
var helloPayloadSchema = external_exports.object({
  role: external_exports.enum(["host", "client"]),
  deviceId: external_exports.string().min(1),
  accessToken: external_exports.string().min(1),
  protocols: external_exports.array(external_exports.number().int().nonnegative().safe()).min(1).refine(uniqueNumbers),
  capabilities: external_exports.array(external_exports.string().min(1)).refine(uniqueStrings),
  clientVersion: external_exports.string().optional(),
  harnessVersion: external_exports.string().optional()
});
var helloAckPayloadSchema = external_exports.object({
  protocol: external_exports.literal(PROTOCOL_VERSION),
  serverVersion: external_exports.string().min(1),
  connectionSessionId: external_exports.string().min(1),
  heartbeatIntervalMs: external_exports.number().int().positive(),
  maxControlFrameBytes: external_exports.number().int().positive().max(MAX_CONTROL_FRAME_BYTES),
  maxRelayFrameBytes: external_exports.number().int().positive().max(MAX_RELAY_FRAME_BYTES),
  capabilities: external_exports.array(external_exports.string().min(1)).refine(uniqueStrings).optional(),
  webrtcEnabled: external_exports.boolean().optional(),
  webrtcFallbackTimeoutMs: external_exports.number().int().positive().optional()
});
var connectRequestPayloadSchema = external_exports.object({
  hostDeviceId: external_exports.string().min(1),
  preferredTransports: external_exports.array(transportEnum).min(1)
});
var connectIncomingPayloadSchema = external_exports.object({
  connectionId: external_exports.string().min(1),
  clientDeviceId: external_exports.string().min(1),
  clientIdentityKey: external_exports.string().min(1),
  authorization: external_exports.literal("account"),
  preferredTransports: external_exports.array(transportEnum).min(1)
});
var connectAcceptedPayloadSchema = external_exports.object({
  connectionId: external_exports.string().min(1)
});
var connectRejectedPayloadSchema = external_exports.object({
  connectionId: external_exports.string().min(1),
  code: external_exports.string().optional(),
  message: external_exports.string().optional()
});
var secureHandshakePayloadSchema = external_exports.object({
  connectionId: external_exports.string().min(1),
  targetDeviceId: external_exports.string().min(1),
  step: external_exports.number().int().positive(),
  data: external_exports.string().min(1)
});
var relayPayloadSchema = external_exports.object({
  connectionId: external_exports.string().min(1),
  targetDeviceId: external_exports.string().min(1),
  counter: external_exports.number().int().nonnegative().safe(),
  ciphertext: external_exports.string().min(1)
});
var signalPayloadSchema = external_exports.object({
  connectionId: external_exports.string().min(1),
  targetDeviceId: external_exports.string().min(1),
  sdp: external_exports.string().min(1)
});
var signalIcePayloadSchema = external_exports.object({
  connectionId: external_exports.string().min(1),
  targetDeviceId: external_exports.string().min(1),
  candidate: external_exports.object({
    candidate: external_exports.string().optional(),
    sdpMid: external_exports.string().nullable().optional(),
    sdpMLineIndex: external_exports.preprocess(normalizeSdpMLineIndex, external_exports.number().int().nonnegative().nullable().optional()),
    usernameFragment: external_exports.string().nullable().optional()
  })
});
var transportSelectedPayloadSchema = external_exports.object({
  connectionId: external_exports.string().min(1),
  targetDeviceId: external_exports.string().min(1),
  transport: selectedTransportEnum
});
var pingPongPayloadSchema = external_exports.object({
  nonce: external_exports.string().min(1)
});
var controlErrorPayloadSchema = external_exports.object({
  code: external_exports.string().min(1),
  message: external_exports.string().min(1),
  retryable: external_exports.boolean().optional(),
  connectionId: external_exports.string().min(1).optional()
});
var controlFramePayloadSchemas = {
  "hello": helloPayloadSchema,
  "hello.ack": helloAckPayloadSchema,
  "connect.request": connectRequestPayloadSchema,
  "connect.incoming": connectIncomingPayloadSchema,
  "connect.accepted": connectAcceptedPayloadSchema,
  "connect.rejected": connectRejectedPayloadSchema,
  "secure.handshake": secureHandshakePayloadSchema,
  "relay": relayPayloadSchema,
  "signal.offer": signalPayloadSchema,
  "signal.answer": signalPayloadSchema,
  "signal.ice": signalIcePayloadSchema,
  "transport.selected": transportSelectedPayloadSchema,
  "ping": pingPongPayloadSchema,
  "pong": pingPongPayloadSchema,
  "error": controlErrorPayloadSchema
};
var rpcRequestPayloadSchema = external_exports.object({
  method: rpcMethodSchema,
  params: external_exports.unknown()
});
var rpcResponsePayloadSchema = external_exports.object({
  requestId: external_exports.string().min(1),
  result: external_exports.unknown()
});
var rpcErrorPayloadSchema = external_exports.object({
  requestId: external_exports.string().min(1),
  code: external_exports.string().min(1),
  message: external_exports.string().min(1),
  retryable: external_exports.boolean().optional(),
  details: external_exports.unknown().optional()
});
function createMessage(type, payload, id2 = cryptoRandomId()) {
  return {
    v: PROTOCOL_VERSION,
    id: id2,
    type,
    timestamp: Date.now(),
    payload
  };
}
function createControlFrame(type, payload, id2 = cryptoRandomId()) {
  return {
    v: PROTOCOL_VERSION,
    id: id2,
    type,
    timestamp: Date.now(),
    payload
  };
}
function createRpcRequest(method, params, id2) {
  return createMessage("rpc.request", { method, params }, id2);
}
function createRpcResponse(requestId, result) {
  return createMessage("rpc.response", { requestId, result });
}
function createRpcError(requestId, code, message, details, retryable) {
  return createMessage("rpc.error", { requestId, code, message, details, retryable });
}
function createEvent(event, data, options = {}) {
  return createMessage("event", { event, data, ...options });
}
function parseRemoteMessage(input2) {
  return remoteMessageSchema.parse(input2);
}
function parseControlFrame(input2) {
  const frame = controlFrameSchema.parse(input2);
  const payloadSchema = controlFramePayloadSchemas[frame.type];
  if (payloadSchema) {
    return { ...frame, payload: payloadSchema.parse(frame.payload) };
  }
  return frame;
}
function encodeControlFrame(frame, limits = {}) {
  const parsed = parseControlFrame(frame);
  const encoded = JSON.stringify(parsed);
  assertControlFrameSize(new TextEncoder().encode(encoded).byteLength, parsed.type, limits);
  return encoded;
}
function decodeControlFrame(data, limits = {}) {
  const encoded = typeof data === "string" ? new TextEncoder().encode(data) : data;
  if (encoded.byteLength > MAX_RELAY_FRAME_BYTES)
    throw new Error("Control frame exceeds the Relay frame limit.");
  const text = typeof data === "string" ? data : new TextDecoder("utf-8", { fatal: true }).decode(data);
  const frame = parseControlFrame(JSON.parse(text));
  assertControlFrameSize(encoded.byteLength, frame.type, limits);
  return frame;
}
function encodeMessage(message) {
  return new TextEncoder().encode(JSON.stringify(message));
}
function decodeMessage(data) {
  const text = typeof data === "string" ? data : new TextDecoder().decode(data);
  return parseRemoteMessage(JSON.parse(text));
}
var SecureMessageCodec = class {
  nextMessageId = 1;
  assemblies = /* @__PURE__ */ new Map();
  encode(message) {
    if (message.byteLength > MAX_SECURE_MESSAGE_BYTES) {
      throw new Error("Secure message exceeds the reassembly limit.");
    }
    if (message.byteLength <= SECURE_FRAGMENT_CHUNK_BYTES)
      return [message];
    const messageId = this.nextMessageId;
    this.nextMessageId = messageId === 4294967295 ? 1 : messageId + 1;
    const total = Math.ceil(message.byteLength / SECURE_FRAGMENT_CHUNK_BYTES);
    const frames = [];
    for (let index = 0; index < total; index += 1) {
      const start = index * SECURE_FRAGMENT_CHUNK_BYTES;
      const chunk = message.subarray(start, Math.min(message.byteLength, start + SECURE_FRAGMENT_CHUNK_BYTES));
      const frame = new Uint8Array(SECURE_FRAGMENT_HEADER_BYTES + chunk.byteLength);
      frame.set(SECURE_FRAGMENT_MAGIC);
      frame[4] = SECURE_FRAGMENT_VERSION;
      const view = new DataView(frame.buffer);
      view.setUint32(5, messageId);
      view.setUint16(9, index);
      view.setUint16(11, total);
      view.setUint32(13, message.byteLength);
      frame.set(chunk, SECURE_FRAGMENT_HEADER_BYTES);
      frames.push(frame);
    }
    return frames;
  }
  decode(frame) {
    if (!isSecureFragment(frame))
      return frame;
    if (frame.byteLength < SECURE_FRAGMENT_HEADER_BYTES || frame[4] !== SECURE_FRAGMENT_VERSION) {
      throw new Error("Secure fragment header is invalid.");
    }
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const messageId = view.getUint32(5);
    const index = view.getUint16(9);
    const total = view.getUint16(11);
    const totalBytes = view.getUint32(13);
    if (messageId === 0 || total < 2 || index >= total || totalBytes <= SECURE_FRAGMENT_CHUNK_BYTES || totalBytes > MAX_SECURE_MESSAGE_BYTES || total !== Math.ceil(totalBytes / SECURE_FRAGMENT_CHUNK_BYTES)) {
      throw new Error("Secure fragment metadata is invalid.");
    }
    const expectedChunkBytes = Math.min(SECURE_FRAGMENT_CHUNK_BYTES, totalBytes - index * SECURE_FRAGMENT_CHUNK_BYTES);
    const chunk = frame.subarray(SECURE_FRAGMENT_HEADER_BYTES);
    if (chunk.byteLength !== expectedChunkBytes)
      throw new Error("Secure fragment length is invalid.");
    let assembly = this.assemblies.get(messageId);
    if (assembly === void 0) {
      if (index !== 0 || this.assemblies.size >= MAX_IN_FLIGHT_SECURE_MESSAGES) {
        throw new Error("Secure fragment sequence is invalid.");
      }
      assembly = { total, totalBytes, receivedBytes: 0, chunks: [] };
      this.assemblies.set(messageId, assembly);
    }
    if (assembly.total !== total || assembly.totalBytes !== totalBytes || index !== assembly.chunks.length) {
      this.assemblies.delete(messageId);
      throw new Error("Secure fragment sequence is invalid.");
    }
    assembly.chunks.push(Uint8Array.from(chunk));
    assembly.receivedBytes += chunk.byteLength;
    if (assembly.chunks.length < total)
      return void 0;
    this.assemblies.delete(messageId);
    if (assembly.receivedBytes !== totalBytes)
      throw new Error("Secure message length is invalid.");
    const message = new Uint8Array(totalBytes);
    let offset = 0;
    for (const part of assembly.chunks) {
      message.set(part, offset);
      offset += part.byteLength;
    }
    return message;
  }
  reset() {
    this.nextMessageId = 1;
    this.assemblies.clear();
  }
};
function isSecureFragment(frame) {
  if (frame.byteLength < SECURE_FRAGMENT_MAGIC.byteLength)
    return false;
  for (let index = 0; index < SECURE_FRAGMENT_MAGIC.byteLength; index += 1) {
    if (frame[index] !== SECURE_FRAGMENT_MAGIC[index])
      return false;
  }
  return true;
}
function assertControlFrameSize(bytes, type, limits) {
  const configured = type === "relay" ? limits.maxRelayFrameBytes : limits.maxControlFrameBytes;
  const protocolMaximum = type === "relay" ? MAX_RELAY_FRAME_BYTES : MAX_CONTROL_FRAME_BYTES;
  const maximum = configured === void 0 ? protocolMaximum : Math.min(protocolMaximum, configured);
  if (!Number.isSafeInteger(maximum) || maximum <= 0)
    throw new Error("Control frame limit is invalid.");
  if (bytes > maximum)
    throw new Error(`${type === "relay" ? "Relay" : "Control"} frame exceeds its limit.`);
}
function cryptoRandomId() {
  const g = globalThis.crypto;
  if (g?.randomUUID)
    return g.randomUUID();
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

// ../client-core/dist/remote-gateway.js
var DIRECT_REMOTE_CALL_BYTES = 2 * 1024 * 1024;
var RemoteGatewayError = class extends Error {
  code;
  details;
  constructor(code, message, details = {}, options) {
    super(message, options);
    this.code = code;
    this.details = details;
    this.name = "RemoteGatewayError";
  }
};
function createRemoteId() {
  const crypto3 = globalThis.crypto;
  if (crypto3?.randomUUID !== void 0)
    return crypto3.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ../client-core/dist/codex-client.js
var MAX_DISPLAY_ITEM_TEXT = 256 * 1024;
var CODEX_IMAGE_MEDIA_TYPES = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
var DATA_IMAGE_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/u;
var CodexRemoteClient = class {
  core;
  constructor(core) {
    this.core = core;
  }
  /** Low-level allowlisted request used by the Desktop Web loopback facade. */
  request(method, params, signal) {
    const largeHistory = method === "dsh/sessionHistory" || method === "thread/read" && isRecord(params) && params.includeTurns === true;
    return this.call(method, params, largeHistory || hasImageInput(params), signal);
  }
  async account(signal) {
    return this.call("account/read", { refreshToken: false }, false, signal);
  }
  async models(signal) {
    return this.call("model/list", {}, false, signal);
  }
  async threads(params = {}, signal) {
    const result = await this.call("thread/list", params, false, signal);
    if (!isRecord(result) || !Array.isArray(result.data))
      throw invalidResponse("thread list");
    return {
      sessions: result.data.map(projectCodexThread).filter((value) => value !== void 0),
      ...typeof result.nextCursor === "string" ? { nextCursor: result.nextCursor } : {}
    };
  }
  async history(threadId, signal) {
    const result = await this.call("thread/read", { threadId, includeTurns: true }, true, signal);
    if (!isRecord(result) || !isRecord(result.thread))
      throw invalidResponse("thread history");
    const session = projectCodexThread(result.thread);
    if (session === void 0)
      throw invalidResponse("thread history");
    return { session, items: projectCodexHistory(result.thread) };
  }
  async start(cwd, model, signal) {
    const result = await this.call("thread/start", { cwd, ...model === void 0 ? {} : { model } }, false, signal);
    return requireProjectedThread(result);
  }
  async resume(threadId, signal) {
    return requireProjectedThread(await this.call("thread/resume", { threadId }, false, signal));
  }
  async fork(threadId, lastTurnId, signal) {
    return requireProjectedThread(await this.call("thread/fork", {
      threadId,
      ...lastTurnId === void 0 ? {} : { lastTurnId }
    }, false, signal));
  }
  async rename(threadId, name2, signal) {
    await this.call("thread/name/set", { threadId, name: name2 }, false, signal);
  }
  async prompt(threadId, text, signal) {
    return this.call("turn/start", { threadId, input: [{ type: "text", text }] }, false, signal);
  }
  async steer(threadId, expectedTurnId, text, signal) {
    return this.call("turn/steer", {
      threadId,
      expectedTurnId,
      input: [{ type: "text", text }]
    }, false, signal);
  }
  async interrupt(threadId, turnId, signal) {
    await this.call("turn/interrupt", { threadId, turnId }, false, signal);
  }
  async respond(requestHandle, decision, signal) {
    await this.core.rpc("codex.app.respond", { requestHandle, decision }, signal);
  }
  async subscribe(threadId, onFrame, signal, onClose) {
    const streamId = createRemoteId();
    let closed = false;
    let unsubscribe = () => void 0;
    const markClosed = () => {
      if (closed)
        return false;
      closed = true;
      unsubscribe();
      return true;
    };
    unsubscribe = this.core.onEvent((event) => {
      if (!isRecord(event.data) || event.data.streamId !== streamId)
        return;
      if (event.event === "codex.app.stream.closed") {
        if (!markClosed())
          return;
        onClose?.(codexStreamCloseReason(event.data.reason));
        return;
      }
      if (event.event !== "codex.app.frame" || !isRecord(event.data.frame) || typeof event.data.frame.method !== "string")
        return;
      onFrame(event.data.frame);
    });
    try {
      await this.core.rpc("codex.app.stream.open", { streamId, threadId }, signal);
    } catch (error) {
      unsubscribe();
      throw error;
    }
    return {
      streamId,
      close: async () => {
        if (!markClosed())
          return;
        await this.core.rpc("codex.app.stream.close", { streamId }).catch(() => void 0);
      }
    };
  }
  async call(method, params, transfer, signal) {
    const envelope = { method, params };
    if (!transfer)
      return this.core.rpc("codex.app.call", envelope, signal);
    return this.callTransferred(new TextEncoder().encode(JSON.stringify(envelope)), signal);
  }
  async callTransferred(encoded, signal) {
    if (encoded.byteLength === 0 || encoded.byteLength > MAX_CODEX_APP_TRANSFER_BYTES) {
      throw new RemoteGatewayError("INVALID_MESSAGE", "The Codex request exceeds the transfer limit.");
    }
    const transferId = createCodexTransferId();
    const totalChunks = Math.ceil(encoded.byteLength / CODEX_APP_TRANSFER_CHUNK_BYTES);
    let opened = false;
    try {
      await this.core.rpc("codex.app.transfer.open", { transferId, totalBytes: encoded.byteLength, totalChunks }, signal);
      opened = true;
      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * CODEX_APP_TRANSFER_CHUNK_BYTES;
        const chunk = encoded.subarray(start, Math.min(start + CODEX_APP_TRANSFER_CHUNK_BYTES, encoded.byteLength));
        await this.core.rpc("codex.app.transfer.chunk", { transferId, index, data: bytesToBase64(chunk) }, signal);
      }
      const committed = await this.core.rpc("codex.app.transfer.commit", { transferId }, signal);
      if (committed.kind === "inline")
        return committed.response;
      if (committed.transferId !== transferId || committed.totalBytes <= 0 || committed.totalBytes > MAX_CODEX_APP_TRANSFER_BYTES || committed.totalChunks !== Math.ceil(committed.totalBytes / CODEX_APP_TRANSFER_CHUNK_BYTES)) {
        throw invalidResponse("transfer descriptor");
      }
      const response = new Uint8Array(committed.totalBytes);
      let offset = 0;
      for (let index = 0; index < committed.totalChunks; index += 1) {
        const result = await this.core.rpc("codex.app.transfer.read", { transferId, index }, signal);
        if (result.transferId !== transferId || result.index !== index)
          throw invalidResponse("transfer ordering");
        const chunk = base64ToBytes(result.data);
        const expected = Math.min(CODEX_APP_TRANSFER_CHUNK_BYTES, committed.totalBytes - offset);
        if (chunk.byteLength !== expected)
          throw invalidResponse("transfer chunk");
        response.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response));
    } finally {
      if (opened)
        await this.core.rpc("codex.app.transfer.close", { transferId }).catch(() => void 0);
    }
  }
};
function hasImageInput(params) {
  return isRecord(params) && Array.isArray(params.input) && params.input.some((value) => isRecord(value) && value.type === "image");
}
function projectCodexThread(value) {
  if (!isRecord(value) || typeof value.id !== "string")
    return void 0;
  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt) || createdAt;
  return {
    id: `codex:${value.id}`,
    backend: "codex",
    nativeId: value.id,
    ...typeof value.sessionId === "string" ? { sessionTreeId: value.sessionId } : {},
    ...typeof value.name === "string" && value.name.length > 0 ? { title: value.name } : {},
    ...typeof value.preview === "string" && value.preview.length > 0 ? { preview: value.preview } : {},
    ...typeof value.cwd === "string" ? { cwd: value.cwd } : {},
    createdAt,
    updatedAt,
    status: projectThreadStatus(value.status),
    ...typeof value.archived === "boolean" ? { archived: value.archived } : {},
    ...typeof value.isPinned === "boolean" ? { pinned: value.isPinned } : {}
  };
}
function deriveCodexCwdWorkspaces(values) {
  const byPath = /* @__PURE__ */ new Map();
  const usedIds = /* @__PURE__ */ new Set();
  for (const value of values) {
    const session = projectCodexThread(value);
    if (session === void 0 || session.cwd === void 0 || session.cwd.length === 0)
      continue;
    const path = session.cwd;
    if (!isAbsoluteWorkspacePath(path))
      continue;
    const key = normalizeWorkspacePath(path);
    const existing = byPath.get(key);
    if (existing !== void 0) {
      existing.createdAt = earliestTimestamp(existing.createdAt, session.createdAt);
      existing.updatedAt = Math.max(existing.updatedAt, session.updatedAt);
      continue;
    }
    const baseId = `cwd-${hashWorkspacePath(key)}`;
    let id2 = baseId;
    for (let suffix = 2; usedIds.has(id2); suffix += 1)
      id2 = `${baseId}-${suffix}`;
    usedIds.add(id2);
    byPath.set(key, {
      id: id2,
      name: workspaceBasename(path),
      path,
      position: byPath.size,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    });
  }
  return [...byPath.values()];
}
function projectCodexHistory(thread) {
  if (!isRecord(thread) || typeof thread.id !== "string" || !Array.isArray(thread.turns))
    return [];
  const sessionId = `codex:${thread.id}`;
  const output = [];
  for (const turn of thread.turns) {
    if (!isRecord(turn) || typeof turn.id !== "string" || !Array.isArray(turn.items))
      continue;
    for (let index = 0; index < turn.items.length; index += 1) {
      const item = turn.items[index];
      output.push(projectCodexItem(item, thread.id, turn.id, sessionId, index));
    }
  }
  return output;
}
function projectCodexItem(value, threadId, turnId, sessionId, index) {
  const item = isRecord(value) ? value : {};
  const itemId = typeof item.id === "string" ? item.id : `${turnId}:${index}`;
  const type = typeof item.type === "string" ? item.type : "unknown";
  const base = {
    id: `codex:${threadId}:${turnId}:${itemId}`,
    sessionId,
    backend: "codex",
    nativeRef: { threadId, turnId, ...typeof item.id === "string" ? { itemId: item.id } : {} },
    ...normalizeTimestamp(item.createdAt) > 0 ? { createdAt: normalizeTimestamp(item.createdAt) } : {}
  };
  if (type === "userMessage") {
    const images = itemImages(item);
    return {
      ...base,
      kind: "message",
      role: "user",
      text: itemText(item),
      ...images.length === 0 ? {} : { images }
    };
  }
  if (type === "agentMessage") {
    const images = itemImages(item);
    return {
      ...base,
      kind: "message",
      role: "assistant",
      text: itemText(item),
      ...images.length === 0 ? {} : { images },
      status: projectItemStatus(item.status)
    };
  }
  if (type === "commandExecution") {
    return { ...base, kind: "tool", text: commandExecutionText(item), status: projectItemStatus(item.status), details: { type } };
  }
  if (isToolItemType(type)) {
    const images = toolItemImages(item);
    return {
      ...base,
      kind: "tool",
      text: toolCallText(item),
      ...images.length === 0 ? {} : { images },
      status: projectItemStatus(item.status),
      details: { type }
    };
  }
  if (type === "fileChange") {
    return { ...base, kind: "file-change", text: fileChangeText(item.changes), status: projectItemStatus(item.status), details: { type } };
  }
  if (type === "plan" || type === "reasoning") {
    return { ...base, kind: "status", text: itemText(item) ?? textArray(item.summary) ?? type, details: { type } };
  }
  if (type === "error")
    return { ...base, kind: "error", text: itemText(item), status: "failed", details: { type } };
  return { ...base, kind: "unknown", text: `Unsupported Codex item: ${type}`, details: { type } };
}
function requireProjectedThread(result) {
  if (!isRecord(result))
    throw invalidResponse("thread");
  const session = projectCodexThread(result.thread);
  if (session === void 0)
    throw invalidResponse("thread");
  return session;
}
function projectThreadStatus(value) {
  if (!isRecord(value) || typeof value.type !== "string")
    return "idle";
  if (value.type === "systemError")
    return "failed";
  if (value.type !== "active")
    return "idle";
  return Array.isArray(value.activeFlags) && value.activeFlags.includes("waitingOnApproval") ? "waiting" : "running";
}
function projectItemStatus(value) {
  if (value === "inProgress")
    return "running";
  if (value === "failed")
    return "failed";
  if (value === "declined")
    return "declined";
  return "completed";
}
function itemText(item) {
  if (typeof item.text === "string")
    return boundedText(item.text);
  if (typeof item.content === "string")
    return boundedText(item.content);
  const content = Array.isArray(item.content) ? item.content : Array.isArray(item.input) ? item.input : void 0;
  if (content === void 0)
    return void 0;
  const parts = content.flatMap((value) => {
    if (typeof value === "string")
      return [value];
    if (!isRecord(value))
      return [];
    if (typeof value.text === "string")
      return [value.text];
    return typeof value.content === "string" ? [value.content] : [];
  });
  return parts.length > 0 ? boundedText(parts.join("\n")) : void 0;
}
function itemImages(item) {
  const content = Array.isArray(item.content) ? item.content : Array.isArray(item.input) ? item.input : [];
  return content.flatMap((value) => {
    if (!isRecord(value) || !isImageContent(value))
      return [];
    const uri = imageDataUri(value);
    if (uri === void 0)
      return [];
    return [{
      uri,
      ...typeof value.name === "string" && value.name.length > 0 ? { name: value.name } : {}
    }];
  });
}
function toolItemImages(item) {
  const candidates = [
    isRecord(item.result) ? item.result : void 0,
    isRecord(item.output) ? item.output : void 0,
    Array.isArray(item.contentItems) ? { content: item.contentItems } : void 0,
    Array.isArray(item.output) ? { content: item.output } : void 0
  ];
  for (const candidate of candidates) {
    if (candidate === void 0 || !Array.isArray(candidate.content))
      continue;
    const images = itemImages(candidate);
    if (images.length > 0)
      return images;
  }
  return [];
}
function isImageContent(value) {
  return value.type === "image" || value.type === "input_image";
}
function imageDataUri(value) {
  const url = typeof value.url === "string" ? value.url : typeof value.image_url === "string" ? value.image_url : isRecord(value.image_url) && typeof value.image_url.url === "string" ? value.image_url.url : void 0;
  const parsed = url === void 0 ? void 0 : parseDataImageUrl(url);
  if (parsed !== void 0)
    return parsed.url;
  if (typeof value.data !== "string" || !isCanonicalBase64(value.data))
    return void 0;
  const mediaType = typeof value.mediaType === "string" ? value.mediaType : typeof value.mimeType === "string" ? value.mimeType : sniffImageMediaType(value.data);
  return mediaType !== void 0 && CODEX_IMAGE_MEDIA_TYPES.has(mediaType) ? `data:${mediaType};base64,${value.data}` : void 0;
}
function parseDataImageUrl(value) {
  const match = DATA_IMAGE_URL.exec(value);
  if (match === null)
    return void 0;
  const mediaType = match[1];
  const data = match[2];
  if (!CODEX_IMAGE_MEDIA_TYPES.has(mediaType) || !isCanonicalBase64(data))
    return void 0;
  return { url: `data:${mediaType};base64,${data}`, mediaType, data };
}
function isCanonicalBase64(value) {
  return value.length >= 4 && value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
}
function sniffImageMediaType(data) {
  const bytes = base64PrefixBytes(data, 32);
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10)
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56 && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97)
    return "image/gif";
  if (bytes.length >= 12 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80)
    return "image/webp";
  return void 0;
}
function base64PrefixBytes(value, maxBytes) {
  const chars = value.slice(0, Math.ceil(maxBytes / 3) * 4);
  let binary;
  try {
    binary = atob(chars);
  } catch {
    return new Uint8Array();
  }
  const bytes = new Uint8Array(Math.min(binary.length, maxBytes));
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function isToolItemType(type) {
  return type === "mcpToolCall" || type === "dynamicToolCall" || type === "functionCallOutput" || type === "hookPrompt" || type === "collabAgentToolCall" || type === "subAgentActivity" || type === "webSearch" || type === "imageView" || type === "imageGeneration" || type === "sleep" || type === "enteredReviewMode" || type === "exitedReviewMode" || type === "contextCompaction";
}
function toolLabel(item) {
  if (typeof item.tool === "string")
    return item.tool;
  if (typeof item.server === "string" && typeof item.name === "string")
    return `${item.server}: ${item.name}`;
  if (typeof item.command === "string")
    return item.command;
  if (Array.isArray(item.command) && item.command.every((value) => typeof value === "string"))
    return item.command.join(" ");
  return typeof item.type === "string" ? item.type : void 0;
}
function commandExecutionText(item) {
  const command = toolLabel(item);
  const output = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : void 0;
  if (command === void 0)
    return output === void 0 ? void 0 : boundedText(output);
  return boundedText(output === void 0 || output === "" ? command : `${command}

${output}`);
}
function toolCallText(item) {
  const type = typeof item.type === "string" ? item.type : void 0;
  if (type === "webSearch") {
    const count = Array.isArray(item.results) ? item.results.length : 0;
    return count === 0 ? "Web search completed." : `Web search returned ${count} result${count === 1 ? "" : "s"}.`;
  }
  if (type === "imageView")
    return `Viewed image: ${typeof item.path === "string" ? item.path : "image"}`;
  if (type === "imageGeneration") {
    return typeof item.savedPath === "string" ? `Generated image: ${item.savedPath}` : `Image generation ${typeof item.status === "string" ? item.status : "completed"}.`;
  }
  if (type === "contextCompaction")
    return "CodeX compacted the conversation context.";
  if (type === "enteredReviewMode" || type === "exitedReviewMode") {
    const action = type === "enteredReviewMode" ? "Entered" : "Exited";
    return `${action} review mode${typeof item.review === "string" ? `: ${item.review}` : "."}`;
  }
  if (type === "sleep")
    return `Waited ${typeof item.durationMs === "number" && Number.isFinite(item.durationMs) ? item.durationMs : 0} ms.`;
  if (type === "subAgentActivity") {
    const kind = isRecord(item.kind) && typeof item.kind.type === "string" ? item.kind.type : typeof item.kind === "string" ? item.kind : "Subagent activity";
    return [kind, typeof item.agentPath === "string" ? item.agentPath : void 0].filter((value) => value !== void 0).join(": ");
  }
  const label = toolLabel(item);
  const error = compactUnknown(item.error);
  const rawResult = item.result ?? item.contentItems;
  const result = itemText(isRecord(rawResult) ? rawResult : {}) ?? (toolItemImages(item).length > 0 ? void 0 : compactUnknown(rawResult));
  return boundedText([label, error, result].filter((value) => value !== void 0 && value !== "").join("\n\n")) || void 0;
}
function fileChangeText(value) {
  if (!Array.isArray(value))
    return "File changes";
  const changes = value.flatMap((change) => {
    if (!isRecord(change) || typeof change.path !== "string")
      return [];
    const kind = typeof change.kind === "string" ? change.kind : "update";
    return [`[${kind}] ${change.path}`];
  });
  return boundedText(changes.length === 0 ? "File changes" : changes.join("\n"));
}
function textArray(value) {
  return Array.isArray(value) && value.every((part) => typeof part === "string") ? boundedText(value.join("\n")) : void 0;
}
function compactUnknown(value) {
  if (value === void 0 || value === null)
    return void 0;
  if (typeof value === "string")
    return boundedText(value);
  try {
    return boundedText(JSON.stringify(value, void 0, 2));
  } catch {
    return void 0;
  }
}
function boundedText(value) {
  return value.length <= MAX_DISPLAY_ITEM_TEXT ? value : `${value.slice(0, MAX_DISPLAY_ITEM_TEXT)}
\u2026`;
}
function normalizeWorkspacePath(value) {
  return value.replace(/[\\/]+$/u, "") || value;
}
function isAbsoluteWorkspacePath(value) {
  return value.startsWith("/") || /^\\\\[^\\]+\\[^\\]+/u.test(value) || /^[A-Za-z]:[\\/]/u.test(value);
}
function workspaceBasename(value) {
  const normalized = normalizeWorkspacePath(value);
  return normalized.split(/[\\/]/u).at(-1) || value;
}
function earliestTimestamp(left, right) {
  if (left <= 0)
    return right;
  if (right <= 0)
    return left;
  return Math.min(left, right);
}
function hashWorkspacePath(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function normalizeTimestamp(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return 0;
  return value < 1e10 ? value * 1e3 : value;
}
function bytesToBase64(value) {
  let binary = "";
  for (let index = 0; index < value.length; index += 1)
    binary += String.fromCharCode(value[index]);
  return btoa(binary);
}
function base64ToBytes(value) {
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw invalidResponse("transfer data");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  if (bytesToBase64(bytes) !== value)
    throw invalidResponse("transfer data");
  return bytes;
}
function invalidResponse(part) {
  return new RemoteGatewayError("INVALID_MESSAGE", `The Host returned an invalid Codex ${part}.`);
}
function codexStreamCloseReason(value) {
  return value === "cancelled" || value === "completed" || value === "failed" || value === "peer-disconnected" ? value : "failed";
}
function createCodexTransferId() {
  if (globalThis.crypto?.randomUUID !== void 0)
    return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues !== void 0) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ../client-core/dist/index.js
var RemoteClientError = class extends Error {
  code;
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
    this.name = "RemoteClientError";
  }
};
var RemoteClientCore = class {
  transport;
  timeoutMs;
  pending = /* @__PURE__ */ new Map();
  eventHandlers = /* @__PURE__ */ new Set();
  unsubscribeTransport;
  unsubscribeClose;
  closeHandlers = /* @__PURE__ */ new Set();
  closeNotified = false;
  constructor(transport, timeoutMs = 3e4) {
    this.transport = transport;
    this.timeoutMs = timeoutMs;
  }
  async connect() {
    if (this.unsubscribeTransport !== void 0)
      return;
    this.closeNotified = false;
    this.unsubscribeTransport = this.transport.onMessage((data) => this.handleMessage(data));
    this.unsubscribeClose = this.transport.onClose?.(() => this.handleTransportClose());
    try {
      await this.transport.connect();
    } catch (error) {
      this.unsubscribeTransport();
      this.unsubscribeTransport = void 0;
      this.unsubscribeClose?.();
      this.unsubscribeClose = void 0;
      throw error;
    }
  }
  async rpc(method, params, signal) {
    if (signal?.aborted)
      throw rpcAbortedError(method, signal.reason);
    const request = createRpcRequest(method, params);
    const result = new Promise((resolve3, reject) => {
      const timer = setTimeout(() => {
        this.rejectPending(request.id, new RemoteClientError("RPC_TIMEOUT", `RPC ${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      const pending = {
        method,
        resolve: resolve3,
        reject,
        timer
      };
      if (signal !== void 0) {
        const onAbort = () => {
          if (this.pending.get(request.id) !== pending)
            return;
          this.rejectPending(request.id, rpcAbortedError(method, signal.reason));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        pending.removeAbort = () => signal.removeEventListener("abort", onAbort);
      }
      this.pending.set(request.id, pending);
    });
    try {
      const send = this.transport.send(encodeMessage(request));
      void send.catch((error) => {
        this.rejectPending(request.id, transportSendError(error));
      });
    } catch (error) {
      this.rejectPending(request.id, transportSendError(error));
    }
    return result;
  }
  onEvent(handler) {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }
  onClose(handler) {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
  getStats() {
    return this.transport.getStats();
  }
  async close() {
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = void 0;
    this.unsubscribeClose?.();
    this.unsubscribeClose = void 0;
    this.rejectAllPending((pending) => new RemoteClientError("CLIENT_CLOSED", `RPC ${pending.method} terminated because the remote client closed`));
    this.notifyClose();
    await this.transport.close();
  }
  handleTransportClose() {
    this.rejectAllPending((pending) => new RemoteClientError("TRANSPORT_CLOSED", `RPC ${pending.method} terminated because the remote transport closed`));
    this.notifyClose();
  }
  handleMessage(data) {
    const message = decodeMessage(data);
    if (message.type === "rpc.response")
      this.handleResponse(message);
    if (message.type === "rpc.error")
      this.handleError(message);
    if (message.type === "event") {
      const event = message.payload;
      for (const handler of this.eventHandlers)
        handler(event);
    }
  }
  handleResponse(message) {
    const pending = this.takePending(message.payload.requestId);
    if (pending === void 0)
      return;
    pending.resolve(message.payload.result);
  }
  handleError(message) {
    const pending = this.takePending(message.payload.requestId);
    if (pending === void 0)
      return;
    pending.reject(Object.assign(new Error(message.payload.message), { code: message.payload.code }));
  }
  takePending(requestId) {
    const pending = this.pending.get(requestId);
    if (pending === void 0)
      return void 0;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.removeAbort?.();
    return pending;
  }
  rejectPending(requestId, error) {
    const pending = this.takePending(requestId);
    if (pending === void 0)
      return false;
    pending.reject(error);
    return true;
  }
  rejectAllPending(createError) {
    for (const requestId of [...this.pending.keys()]) {
      const pending = this.takePending(requestId);
      if (pending !== void 0)
        pending.reject(createError(pending));
    }
  }
  notifyClose() {
    if (this.closeNotified)
      return;
    this.closeNotified = true;
    for (const handler of this.closeHandlers)
      handler();
  }
};
function rpcAbortedError(method, reason) {
  return new RemoteClientError("RPC_ABORTED", `RPC ${method} was aborted`, reason === void 0 ? void 0 : { cause: reason });
}
function transportSendError(error) {
  return error instanceof Error ? error : new Error("remote transport send failed", { cause: error });
}

// ../webrtc/dist/transport.js
var BaseTransport = class {
  handlers = /* @__PURE__ */ new Set();
  closeHandlers = /* @__PURE__ */ new Set();
  onMessage(cb) {
    this.handlers.add(cb);
    return () => this.handlers.delete(cb);
  }
  onClose(cb) {
    this.closeHandlers.add(cb);
    return () => this.closeHandlers.delete(cb);
  }
  emit(data) {
    for (const handler of this.handlers)
      handler(data);
  }
  emitClose() {
    for (const handler of this.closeHandlers)
      handler();
  }
};

// ../webrtc/dist/util.js
function toBase64Url(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function fromBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (typeof atob === "function")
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return new Uint8Array(Buffer.from(padded, "base64"));
}

// ../webrtc/dist/rtc-adapter.js
var RTC_DATA_CHANNEL_LABEL = "dsh";
var RTC_DATA_CHANNEL_OPTIONS = { ordered: true };
function browserRtcFactory() {
  return {
    create(configuration) {
      const raw = new RTCPeerConnection({ iceServers: configuration.iceServers });
      return {
        get connectionState() {
          return raw.connectionState;
        },
        get iceConnectionState() {
          return raw.iceConnectionState;
        },
        get iceGatheringState() {
          return raw.iceGatheringState;
        },
        get signalingState() {
          return raw.signalingState;
        },
        set onconnectionstatechange(value) {
          raw.onconnectionstatechange = value;
        },
        get onconnectionstatechange() {
          return raw.onconnectionstatechange;
        },
        set oniceconnectionstatechange(value) {
          raw.oniceconnectionstatechange = value;
        },
        get oniceconnectionstatechange() {
          return raw.oniceconnectionstatechange;
        },
        set onicegatheringstatechange(value) {
          raw.onicegatheringstatechange = value;
        },
        get onicegatheringstatechange() {
          return raw.onicegatheringstatechange;
        },
        set onicecandidate(value) {
          raw.onicecandidate = value;
        },
        get onicecandidate() {
          return raw.onicecandidate;
        },
        set ondatachannel(value) {
          raw.ondatachannel = value;
        },
        get ondatachannel() {
          return raw.ondatachannel;
        },
        createDataChannel(label, options) {
          return adaptDataChannel(raw.createDataChannel(label, options));
        },
        createOffer() {
          return raw.createOffer();
        },
        createAnswer() {
          return raw.createAnswer();
        },
        setLocalDescription(description) {
          return raw.setLocalDescription(description);
        },
        setRemoteDescription(description) {
          return raw.setRemoteDescription(description);
        },
        addIceCandidate(candidate) {
          return raw.addIceCandidate(candidate);
        },
        async getStats() {
          return await raw.getStats();
        },
        close() {
          raw.close();
        }
      };
    }
  };
}
function summarizeIceCandidate(candidate) {
  const value = candidate?.candidate?.trim();
  if (value === void 0 || value.length === 0)
    return emptyCandidateSummary();
  const parts = value.replace(/^candidate:/, "").split(/\s+/);
  const typeIndex = parts.indexOf("typ");
  const relatedAddressIndex = parts.indexOf("raddr");
  return {
    candidateType: parseCandidateType(parts[typeIndex + 1]),
    protocol: normalizeProtocol(parts[2]),
    ...summarizeAddress(parts[4]),
    ...relatedAddressIndex < 0 ? {} : relatedAddressSummary(parts[relatedAddressIndex + 1])
  };
}
function summarizeAddress(address) {
  if (address === void 0 || address.length === 0)
    return { addressFamily: "unknown", addressScope: "unknown" };
  if (address.includes(":"))
    return { addressFamily: "ipv6", addressScope: summarizeIpv6Scope(address) };
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return { addressFamily: "unknown", addressScope: "unknown" };
  }
  return { addressFamily: "ipv4", addressScope: summarizeIpv4Scope(parts) };
}
function stunOnlyIceServers(iceServers) {
  const direct = [];
  for (const server of iceServers) {
    const sourceUrls = Array.isArray(server.urls) ? server.urls : [server.urls];
    const urls = sourceUrls.filter(isStunUrl);
    if (urls.length === 0)
      continue;
    direct.push({ urls: Array.isArray(server.urls) ? urls : urls[0] });
  }
  return direct;
}
function isStunUrl(url) {
  const value = url.trim().toLowerCase();
  return value.startsWith("stun:") || value.startsWith("stuns:");
}
function emptyCandidateSummary() {
  return { candidateType: "unknown", addressFamily: "unknown", addressScope: "unknown" };
}
function parseCandidateType(value) {
  if (value === "host" || value === "srflx" || value === "prflx" || value === "relay")
    return value;
  return "unknown";
}
function normalizeProtocol(value) {
  if (value === void 0 || value.length === 0)
    return void 0;
  return value.toLowerCase();
}
function relatedAddressSummary(address) {
  const summary = summarizeAddress(address);
  return {
    relatedAddressFamily: summary.addressFamily,
    relatedAddressScope: summary.addressScope
  };
}
function summarizeIpv4Scope(parts) {
  if (parts[0] === 0 || parts[0] >= 240)
    return "reserved";
  if (parts[0] === 127)
    return "loopback";
  if (parts[0] === 169 && parts[1] === 254)
    return "link-local";
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    return "cgnat";
  if (parts[0] >= 224)
    return "reserved";
  if (parts[0] === 10)
    return "private";
  if (parts[0] === 192 && parts[1] === 168)
    return "private";
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    return "private";
  return "public";
}
function summarizeIpv6Scope(address) {
  const value = address.toLowerCase();
  if (value === "::1")
    return "loopback";
  if (value.startsWith("fe80:"))
    return "link-local";
  if (value.startsWith("fd7a:115c:a1e0:"))
    return "cgnat";
  if (value.startsWith("fc") || value.startsWith("fd"))
    return "private";
  if (value.startsWith("ff"))
    return "reserved";
  return "public";
}
function adaptDataChannel(raw) {
  return {
    get label() {
      return raw.label;
    },
    get ordered() {
      return raw.ordered;
    },
    get readyState() {
      return raw.readyState;
    },
    get bufferedAmount() {
      return raw.bufferedAmount;
    },
    get binaryType() {
      return raw.binaryType;
    },
    set binaryType(value) {
      raw.binaryType = value;
    },
    set onopen(value) {
      raw.onopen = value;
    },
    get onopen() {
      return raw.onopen;
    },
    set onmessage(value) {
      raw.onmessage = value;
    },
    get onmessage() {
      return raw.onmessage;
    },
    set onclose(value) {
      raw.onclose = value;
    },
    get onclose() {
      return raw.onclose;
    },
    set onerror(value) {
      raw.onerror = value;
    },
    get onerror() {
      return raw.onerror;
    },
    set onbufferedamountlow(value) {
      raw.onbufferedamountlow = value;
    },
    get onbufferedamountlow() {
      return raw.onbufferedamountlow;
    },
    send(data) {
      raw.send(data);
    },
    close() {
      raw.close();
    }
  };
}

// ../webrtc/dist/rtc-chunking.js
var RTC_CHUNK_MAGIC = new Uint8Array([82, 84, 67, 72]);
var RTC_CHUNK_HEADER_BYTES = 12;
var RTC_CHUNK_PAYLOAD_BYTES = 8 * 1024;
var RTC_CHUNK_MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
var RTC_CHUNK_MAX_TOTAL = Math.ceil(RTC_CHUNK_MAX_MESSAGE_BYTES / RTC_CHUNK_PAYLOAD_BYTES);
var MAX_IN_FLIGHT_MESSAGES = 8;
var MAX_ASSEMBLY_AGE_MS = 3e4;
var RtcChunkCodec = class {
  nextMessageId = 1;
  assemblies = /* @__PURE__ */ new Map();
  encode(data) {
    if (data.byteLength <= RTC_CHUNK_PAYLOAD_BYTES)
      return [data];
    if (data.byteLength > RTC_CHUNK_MAX_MESSAGE_BYTES) {
      throw new Error("WebRTC transport message exceeds the reassembly limit.");
    }
    const messageId = this.nextMessageId;
    this.nextMessageId = messageId === 4294967295 ? 1 : messageId + 1;
    const total = Math.ceil(data.byteLength / RTC_CHUNK_PAYLOAD_BYTES);
    const frames = [];
    for (let index = 0; index < total; index += 1) {
      const start = index * RTC_CHUNK_PAYLOAD_BYTES;
      const chunk = data.subarray(start, Math.min(data.byteLength, start + RTC_CHUNK_PAYLOAD_BYTES));
      const frame = new Uint8Array(RTC_CHUNK_HEADER_BYTES + chunk.byteLength);
      frame.set(RTC_CHUNK_MAGIC);
      const view = new DataView(frame.buffer);
      view.setUint32(4, messageId);
      view.setUint16(8, index);
      view.setUint16(10, total);
      frame.set(chunk, RTC_CHUNK_HEADER_BYTES);
      frames.push(frame);
    }
    return frames;
  }
  decode(frame) {
    if (!isChunk(frame)) {
      if (frame.byteLength > RTC_CHUNK_MAX_MESSAGE_BYTES) {
        throw new Error("WebRTC transport message exceeds the reassembly limit.");
      }
      return frame;
    }
    if (frame.byteLength < RTC_CHUNK_HEADER_BYTES)
      throw new Error("WebRTC transport chunk header is invalid.");
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const messageId = view.getUint32(4);
    const index = view.getUint16(8);
    const total = view.getUint16(10);
    if (messageId === 0 || total < 2 || total > RTC_CHUNK_MAX_TOTAL || index >= total) {
      throw new Error("WebRTC transport chunk metadata is invalid.");
    }
    const chunk = frame.subarray(RTC_CHUNK_HEADER_BYTES);
    if (chunk.byteLength > RTC_CHUNK_PAYLOAD_BYTES || index < total - 1 && chunk.byteLength !== RTC_CHUNK_PAYLOAD_BYTES || index === total - 1 && chunk.byteLength === 0) {
      throw new Error("WebRTC transport chunk length is invalid.");
    }
    this.pruneStale();
    let assembly = this.assemblies.get(messageId);
    if (assembly === void 0) {
      if (index !== 0 || this.assemblies.size >= MAX_IN_FLIGHT_MESSAGES) {
        throw new Error("WebRTC transport chunk sequence is invalid.");
      }
      assembly = { messageId, total, receivedBytes: 0, chunks: [], updatedAt: Date.now() };
      this.assemblies.set(messageId, assembly);
    }
    if (assembly.total !== total || index !== assembly.chunks.length) {
      this.assemblies.delete(messageId);
      throw new Error("WebRTC transport chunk sequence is invalid.");
    }
    const receivedBytes = assembly.receivedBytes + chunk.byteLength;
    if (receivedBytes > RTC_CHUNK_MAX_MESSAGE_BYTES) {
      this.assemblies.delete(messageId);
      throw new Error("WebRTC transport message exceeds the reassembly limit.");
    }
    assembly.chunks.push(Uint8Array.from(chunk));
    assembly.receivedBytes = receivedBytes;
    assembly.updatedAt = Date.now();
    if (assembly.chunks.length < total)
      return void 0;
    this.assemblies.delete(messageId);
    const message = new Uint8Array(assembly.receivedBytes);
    let offset = 0;
    for (const part of assembly.chunks) {
      message.set(part, offset);
      offset += part.byteLength;
    }
    return message;
  }
  reset() {
    this.nextMessageId = 1;
    this.assemblies.clear();
  }
  pruneStale() {
    const now = Date.now();
    for (const [messageId, assembly] of this.assemblies) {
      if (now - assembly.updatedAt > MAX_ASSEMBLY_AGE_MS)
        this.assemblies.delete(messageId);
    }
  }
};
function isChunk(frame) {
  if (frame.byteLength < RTC_CHUNK_MAGIC.byteLength)
    return false;
  for (let index = 0; index < RTC_CHUNK_MAGIC.byteLength; index += 1) {
    if (frame[index] !== RTC_CHUNK_MAGIC[index])
      return false;
  }
  return true;
}

// ../webrtc/dist/rtc-data-channel.js
var DEFAULT_NEGOTIATE_TIMEOUT_MS = 8e3;
var SELECTED_PATH_RETRY_COUNT = 5;
var SELECTED_PATH_RETRY_DELAY_MS = 50;
var RtcDataChannelTransport = class {
  pc;
  role;
  onSignal;
  negotiateTimeoutMs;
  channelLabel;
  sendTimeoutMs;
  label;
  onDiagnostic;
  channel;
  remoteCandidates = [];
  remoteDescriptionSet = false;
  opened = false;
  closed = false;
  messageHandlers = /* @__PURE__ */ new Set();
  closeHandlers = /* @__PURE__ */ new Set();
  errorHandlers = /* @__PURE__ */ new Set();
  connectPromise;
  openResolve;
  openReject;
  negotiateTimer;
  removeAbort;
  watchdogTimer;
  outgoing = new RtcChunkCodec();
  incoming = new RtcChunkCodec();
  bytesSent = 0;
  bytesReceived = 0;
  selected;
  selectedMode;
  selectedPathTelemetry;
  localCandidateTelemetry = emptyCandidateTelemetry();
  remoteCandidateTelemetry = emptyCandidateTelemetry();
  candidatePairTelemetry = emptyCandidatePairTelemetry();
  filteredLocalCandidateTelemetry = emptyCandidateTelemetry();
  filteredCandidatePairTelemetry = emptyCandidateTelemetry();
  lastBufferedAmount = 0;
  constructor(options) {
    this.role = options.role;
    this.onSignal = options.onSignal;
    this.negotiateTimeoutMs = options.negotiateTimeoutMs ?? DEFAULT_NEGOTIATE_TIMEOUT_MS;
    this.channelLabel = options.channelLabel ?? RTC_DATA_CHANNEL_LABEL;
    this.sendTimeoutMs = options.sendTimeoutMs;
    this.label = options.label;
    this.onDiagnostic = options.onDiagnostic;
    this.pc = options.factory.create({
      iceServers: options.iceServers,
      onDiagnostic: (event) => this.handlePeerDiagnostic(event)
    });
    this.pc.ondatachannel = (event) => this.adoptChannel(event.channel);
    this.pc.onicecandidate = (event) => {
      if (event.candidate !== null && !this.closed) {
        const candidate = summarizeIceCandidate(event.candidate);
        recordCandidate(this.localCandidateTelemetry, candidate);
        this.emitDiagnostic({ type: "local-candidate", candidate, diagnostics: this.diagnostics() });
        this.onSignal({ type: "ice", candidate: event.candidate });
      }
    };
    this.pc.onconnectionstatechange = () => {
      this.emitStateChange();
      this.checkConnectionState();
    };
    this.pc.oniceconnectionstatechange = () => {
      this.emitStateChange();
      this.checkConnectionState();
    };
    this.pc.onicegatheringstatechange = () => this.emitStateChange();
  }
  /** Begin negotiation; resolves when the DataChannel is open. */
  connect(signal) {
    if (this.opened)
      return Promise.resolve();
    if (this.connectPromise !== void 0)
      return this.connectPromise;
    this.armAbort(signal);
    this.connectPromise = new Promise((resolve3, reject) => {
      this.openResolve = resolve3;
      this.openReject = reject;
      this.negotiateTimer = setTimeout(() => {
        void this.failOpenAfterStats(new RtcConnectError("RTC_CONNECT_TIMEOUT", `WebRTC negotiation timed out after ${this.negotiateTimeoutMs}ms.`));
      }, this.negotiateTimeoutMs);
      if (this.role === "initiator") {
        void this.startInitiator().catch((error) => this.failOpen(asError(error)));
      }
    });
    return this.connectPromise;
  }
  handleSignal(signal) {
    if (this.closed)
      return;
    if (signal.type === "offer")
      void this.handleOffer(signal.sdp);
    else if (signal.type === "answer")
      void this.handleAnswer(signal.sdp);
    else
      void this.handleIce(signal.candidate);
  }
  async send(data) {
    const channel = this.requireOpenChannel();
    if (channel.readyState !== "open")
      throw new Error("WebRTC data channel is not open.");
    for (const frame of this.outgoing.encode(data)) {
      try {
        channel.send(toArrayBuffer(frame));
      } catch (error) {
        console.error("[rtc-send-error] bytes=" + frame.byteLength, error instanceof Error ? error.message : error);
        throw error;
      }
    }
    this.bytesSent += data.byteLength;
    this.armWatchdog(channel);
  }
  onMessage(handler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }
  onClose(handler) {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }
  onError(handler) {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }
  selectedTransport() {
    return this.selected;
  }
  selectedPathMode() {
    return this.selectedMode;
  }
  diagnostics() {
    return {
      role: this.role,
      ...this.label === void 0 ? {} : { label: this.label },
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
      iceGatheringState: this.pc.iceGatheringState,
      localCandidates: cloneCandidateTelemetry(this.localCandidateTelemetry),
      remoteCandidates: cloneCandidateTelemetry(this.remoteCandidateTelemetry),
      candidatePairs: cloneCandidatePairTelemetry(this.candidatePairTelemetry),
      filteredLocalCandidates: cloneCandidateTelemetry(this.filteredLocalCandidateTelemetry),
      filteredCandidatePairs: cloneCandidateTelemetry(this.filteredCandidatePairTelemetry),
      ...this.selectedPathTelemetry === void 0 ? {} : { selectedPath: { ...this.selectedPathTelemetry } }
    };
  }
  async connectionDetails() {
    let statsDetails = {};
    try {
      statsDetails = await this.refreshStatsDiagnostics();
    } catch {
    }
    return {
      ...statsDetails,
      mode: statsDetails.mode ?? this.selectedMode,
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
      dataChannelState: this.channel?.readyState,
      diagnostics: this.diagnostics()
    };
  }
  getStats() {
    const connected = this.channel?.readyState === "open";
    return {
      mode: !connected ? "Disconnected" : this.selectedMode ?? (this.selected === "turn" ? "TURN" : this.selected === "lan" ? "LAN" : "P2P"),
      connected,
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived
    };
  }
  /** Idempotent close: releases PeerConnection, DataChannel, timers and listeners. */
  async close() {
    if (this.closed)
      return;
    this.closed = true;
    this.clearNegotiation();
    this.clearWatchdog();
    const channel = this.channel;
    this.channel = void 0;
    if (channel !== void 0) {
      channel.onopen = null;
      channel.onmessage = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.onbufferedamountlow = null;
      try {
        channel.close();
      } catch {
      }
    }
    this.pc.onicecandidate = null;
    this.pc.ondatachannel = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    try {
      this.pc.close();
    } catch {
    }
    if (this.opened) {
      this.opened = false;
      for (const handler of this.closeHandlers)
        handler();
    }
  }
  armAbort(signal) {
    this.removeAbort?.();
    this.removeAbort = void 0;
    if (signal === void 0)
      return;
    const onAbort = () => {
      this.failOpen(new RtcConnectError("RTC_ABORTED", "WebRTC negotiation was aborted."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    this.removeAbort = () => signal.removeEventListener("abort", onAbort);
    if (signal.aborted)
      onAbort();
  }
  async startInitiator() {
    const channel = this.pc.createDataChannel(this.channelLabel, RTC_DATA_CHANNEL_OPTIONS);
    this.adoptChannel(channel);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.onSignal({ type: "offer", sdp: requireSdp(offer) });
  }
  async handleOffer(sdp) {
    if (this.role !== "responder" || this.remoteDescriptionSet) {
      this.failOpen(new RtcConnectError("RTC_INVALID_STATE", "Received an unexpected WebRTC offer."));
      return;
    }
    try {
      await this.pc.setRemoteDescription({ type: "offer", sdp });
      this.remoteDescriptionSet = true;
      await this.flushRemoteCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.onSignal({ type: "answer", sdp: requireSdp(answer) });
    } catch (error) {
      this.failOpen(asError(error));
    }
  }
  async handleAnswer(sdp) {
    if (this.role !== "initiator" || this.remoteDescriptionSet) {
      this.failOpen(new RtcConnectError("RTC_INVALID_STATE", "Received an unexpected WebRTC answer."));
      return;
    }
    try {
      await this.pc.setRemoteDescription({ type: "answer", sdp });
      this.remoteDescriptionSet = true;
      await this.flushRemoteCandidates();
    } catch (error) {
      this.failOpen(asError(error));
    }
  }
  async handleIce(candidate) {
    const summary = summarizeIceCandidate(candidate);
    if (!this.remoteDescriptionSet) {
      recordCandidate(this.remoteCandidateTelemetry, summary);
      this.emitDiagnostic({ type: "remote-candidate", candidate: summary, action: "buffered", diagnostics: this.diagnostics() });
      this.remoteCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
      recordCandidate(this.remoteCandidateTelemetry, summary);
      this.emitDiagnostic({ type: "remote-candidate", candidate: summary, action: "added", diagnostics: this.diagnostics() });
    } catch {
      this.emitDiagnostic({ type: "remote-candidate", candidate: summary, action: "ignored", diagnostics: this.diagnostics() });
    }
  }
  async flushRemoteCandidates() {
    const buffered = this.remoteCandidates.splice(0, this.remoteCandidates.length);
    for (const candidate of buffered) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
      }
    }
  }
  adoptChannel(channel) {
    if (this.channel !== void 0 && this.channel !== channel) {
      try {
        channel.close();
      } catch {
      }
      return;
    }
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      if (this.closed || this.opened)
        return;
      this.opened = true;
      const resolve3 = this.openResolve;
      this.clearNegotiation();
      void this.resolveSelectedTransport().then(() => resolve3?.());
    };
    channel.onmessage = (event) => {
      if (this.closed || !this.opened)
        return;
      const data = event.data;
      const frame = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
      this.bytesReceived += frame.byteLength;
      try {
        const message = this.incoming.decode(frame);
        if (message === void 0)
          return;
        for (const handler of this.messageHandlers)
          handler(message);
      } catch {
        void this.close();
      }
    };
    channel.onclose = () => {
      if (this.closed)
        return;
      this.failOpen(new RtcConnectError("RTC_CLOSED", "WebRTC data channel closed."));
      if (this.opened) {
        this.opened = false;
        for (const handler of this.closeHandlers)
          handler();
      }
    };
    channel.onerror = () => {
      const error = new RtcConnectError("RTC_FAILED", "WebRTC data channel reported an error.");
      this.failOpen(error);
      for (const handler of this.errorHandlers)
        handler(error);
    };
  }
  async resolveSelectedTransport() {
    try {
      let selected = await this.refreshStatsDiagnostics();
      for (let attempt = 0; attempt < SELECTED_PATH_RETRY_COUNT && !this.closed && (selected.transport === void 0 || selected.mode === void 0 || selected.mode === "P2P"); attempt += 1) {
        await sleep(SELECTED_PATH_RETRY_DELAY_MS);
        selected = await this.refreshStatsDiagnostics();
      }
      this.selected = selected?.transport;
      this.selectedMode = selected?.mode;
      this.selectedPathTelemetry = selectedPathTelemetry(selected);
      this.emitDiagnostic({
        type: "selected-path",
        selectedPath: this.selectedPathTelemetry,
        diagnostics: this.diagnostics()
      });
    } catch {
      this.selected = void 0;
      this.selectedMode = void 0;
    }
  }
  checkConnectionState() {
    if (this.closed || this.opened)
      return;
    if (this.pc.connectionState === "failed" || this.pc.iceConnectionState === "failed" || this.pc.connectionState === "closed" || this.pc.iceConnectionState === "closed") {
      void this.failOpenAfterStats(new RtcConnectError("RTC_FAILED", "WebRTC peer connection failed before the data channel opened."));
    }
  }
  async failOpenAfterStats(error) {
    await Promise.race([
      this.refreshStatsDiagnostics().catch(() => void 0),
      sleep(250)
    ]);
    this.failOpen(error);
  }
  failOpen(error) {
    if (this.closed || this.opened || this.openReject === void 0)
      return;
    const reject = this.openReject;
    this.clearNegotiation();
    this.openResolve = void 0;
    this.openReject = void 0;
    reject(error);
    void this.close();
  }
  clearNegotiation() {
    if (this.negotiateTimer !== void 0)
      clearTimeout(this.negotiateTimer);
    this.negotiateTimer = void 0;
    this.removeAbort?.();
    this.removeAbort = void 0;
    this.openResolve = void 0;
    this.openReject = void 0;
  }
  requireOpenChannel() {
    const channel = this.channel;
    if (channel === void 0 || channel.readyState !== "open" || this.closed || !this.opened) {
      throw new Error("WebRTC data channel is not open.");
    }
    return channel;
  }
  armWatchdog(channel) {
    if (this.closed || this.sendTimeoutMs === void 0 || this.sendTimeoutMs <= 0)
      return;
    if (this.watchdogTimer !== void 0)
      clearTimeout(this.watchdogTimer);
    this.watchdogTimer = void 0;
    const baseline = channel.bufferedAmount;
    if (baseline <= 0) {
      this.lastBufferedAmount = 0;
      return;
    }
    this.lastBufferedAmount = baseline;
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = void 0;
      if (this.closed || this.channel !== channel || channel.readyState !== "open")
        return;
      const current = channel.bufferedAmount;
      if (current > 0 && current >= this.lastBufferedAmount) {
        const error = new RtcConnectError("RTC_SEND_TIMEOUT", "DataChannel send stalled.");
        for (const handler of this.errorHandlers)
          handler(error);
        void this.close();
        return;
      }
      this.lastBufferedAmount = current;
      if (current > 0)
        this.armWatchdog(channel);
    }, this.sendTimeoutMs);
  }
  clearWatchdog() {
    if (this.watchdogTimer !== void 0)
      clearTimeout(this.watchdogTimer);
    this.watchdogTimer = void 0;
    this.lastBufferedAmount = 0;
  }
  async refreshStatsDiagnostics() {
    const stats = [...await this.pc.getStats()];
    this.candidatePairTelemetry = inspectCandidatePairs(stats);
    return inspectSelectedPath(stats);
  }
  handlePeerDiagnostic(event) {
    if (event.type === "local-candidate-filtered") {
      recordCandidate(this.filteredLocalCandidateTelemetry, event.candidate);
      this.emitDiagnostic({
        type: event.type,
        candidate: event.candidate,
        reason: event.reason,
        diagnostics: this.diagnostics()
      });
      return;
    }
    if (event.localCandidate !== void 0)
      recordCandidate(this.filteredCandidatePairTelemetry, event.localCandidate);
    this.emitDiagnostic({
      type: event.type,
      localCandidate: event.localCandidate,
      reason: event.reason,
      diagnostics: this.diagnostics()
    });
  }
  emitStateChange() {
    this.emitDiagnostic({
      type: "state-change",
      connectionState: this.pc.connectionState,
      iceConnectionState: this.pc.iceConnectionState,
      iceGatheringState: this.pc.iceGatheringState,
      diagnostics: this.diagnostics()
    });
  }
  emitDiagnostic(event) {
    try {
      this.onDiagnostic?.(event);
    } catch {
    }
  }
};
var RtcConnectError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function inspectSelectedPath(stats) {
  const candidates = /* @__PURE__ */ new Map();
  const candidatePairs = /* @__PURE__ */ new Map();
  const selectedPairs = [];
  const selectedPairIds = /* @__PURE__ */ new Set();
  for (const [reportId, entry] of stats) {
    if (entry.type === "local-candidate" || entry.type === "remote-candidate") {
      if (typeof entry.candidateType === "string" && entry.id !== void 0) {
        candidates.set(String(entry.id), entry);
      }
    } else if (entry.type === "candidate-pair") {
      candidatePairs.set(String(entry.id ?? reportId), entry);
      if (entry.selected === true || entry.nominated === true)
        selectedPairs.push(entry);
    } else if (entry.type === "transport" && typeof entry.selectedCandidatePairId === "string") {
      selectedPairIds.add(entry.selectedCandidatePairId);
    }
  }
  const pairs = [
    ...[...selectedPairIds].map((id2) => candidatePairs.get(id2)).filter((pair) => pair !== void 0),
    ...selectedPairs
  ];
  for (const pair of pairs) {
    const local = candidates.get(String(pair.localCandidateId));
    const remote = candidates.get(String(pair.remoteCandidateId));
    const localType = local?.candidateType;
    const remoteType = remote?.candidateType;
    const localAddressScope = summarizeAddress(candidateAddressValue(local)).addressScope;
    const remoteAddressScope = summarizeAddress(candidateAddressValue(remote)).addressScope;
    let selected;
    if (localType === "relay" || remoteType === "relay")
      selected = { transport: "turn", mode: "TURN" };
    if (local === void 0 && remote === void 0)
      continue;
    const lan = isLanCandidatePair(localType, remoteType, localAddressScope, remoteAddressScope);
    selected ??= { transport: lan ? "lan" : "p2p", mode: lan ? "LAN" : "P2P" };
    const currentRoundTripTime = numberStat(pair, "currentRoundTripTime");
    return {
      ...selected,
      localCandidateType: stringStat(local, "candidateType"),
      remoteCandidateType: stringStat(remote, "candidateType"),
      localAddressScope,
      remoteAddressScope,
      localAddress: candidateAddress(local),
      remoteAddress: candidateAddress(remote),
      protocol: stringStat(local, "protocol") ?? stringStat(remote, "protocol"),
      relayProtocol: stringStat(local, "relayProtocol") ?? stringStat(remote, "relayProtocol"),
      currentRoundTripTimeMs: currentRoundTripTime === void 0 ? void 0 : Math.round(currentRoundTripTime * 1e3),
      availableOutgoingBitrate: numberStat(pair, "availableOutgoingBitrate"),
      bytesSent: numberStat(pair, "bytesSent"),
      bytesReceived: numberStat(pair, "bytesReceived")
    };
  }
  return {};
}
function inspectCandidatePairs(stats) {
  const candidates = /* @__PURE__ */ new Map();
  const telemetry = emptyCandidatePairTelemetry();
  const pairs = [];
  for (const [reportId, entry] of stats) {
    if (entry.type === "local-candidate" || entry.type === "remote-candidate") {
      if (typeof entry.candidateType === "string" && entry.id !== void 0) {
        candidates.set(String(entry.id), entry);
      }
    } else if (entry.type === "candidate-pair") {
      pairs.push({ ...entry, id: entry.id ?? reportId });
    }
  }
  for (const pair of pairs) {
    telemetry.total += 1;
    if (pair.nominated === true)
      telemetry.nominated += 1;
    if (pair.selected === true)
      telemetry.selected += 1;
    increment(telemetry.byState, stringStat(pair, "state") ?? (pair.selected === true ? "selected" : "unknown"));
    const local = candidates.get(String(pair.localCandidateId));
    const remote = candidates.get(String(pair.remoteCandidateId));
    recordCandidateStats(telemetry.byLocalType, telemetry.byLocalFamily, telemetry.byLocalScope, local);
    recordCandidateStats(telemetry.byRemoteType, telemetry.byRemoteFamily, telemetry.byRemoteScope, remote);
  }
  return telemetry;
}
function candidateAddress(candidate) {
  const address = stringStat(candidate, "address") ?? stringStat(candidate, "ip");
  if (address === void 0)
    return void 0;
  const port = numberStat(candidate, "port");
  return port === void 0 ? address : `${address}:${port}`;
}
function stringStat(entry, key) {
  const value = entry?.[key];
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function numberStat(entry, key) {
  const value = entry?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function emptyCandidateTelemetry() {
  return {
    total: 0,
    byType: {},
    byFamily: {},
    byScope: {},
    byProtocol: {}
  };
}
function cloneCandidateTelemetry(value) {
  return {
    total: value.total,
    byType: { ...value.byType },
    byFamily: { ...value.byFamily },
    byScope: { ...value.byScope },
    byProtocol: { ...value.byProtocol }
  };
}
function emptyCandidatePairTelemetry() {
  return {
    total: 0,
    nominated: 0,
    selected: 0,
    byState: {},
    byLocalType: {},
    byRemoteType: {},
    byLocalFamily: {},
    byRemoteFamily: {},
    byLocalScope: {},
    byRemoteScope: {}
  };
}
function cloneCandidatePairTelemetry(value) {
  return {
    total: value.total,
    nominated: value.nominated,
    selected: value.selected,
    byState: { ...value.byState },
    byLocalType: { ...value.byLocalType },
    byRemoteType: { ...value.byRemoteType },
    byLocalFamily: { ...value.byLocalFamily },
    byRemoteFamily: { ...value.byRemoteFamily },
    byLocalScope: { ...value.byLocalScope },
    byRemoteScope: { ...value.byRemoteScope }
  };
}
function recordCandidate(telemetry, candidate) {
  telemetry.total += 1;
  increment(telemetry.byType, candidate.candidateType);
  increment(telemetry.byFamily, candidate.addressFamily);
  increment(telemetry.byScope, candidate.addressScope);
  if (candidate.protocol !== void 0)
    increment(telemetry.byProtocol, candidate.protocol);
}
function recordCandidateStats(byType, byFamily, byScope, candidate) {
  const candidateType = candidateTypeStat(candidate);
  const address = summarizeAddress(candidateAddressValue(candidate));
  increment(byType, candidateType);
  increment(byFamily, address.addressFamily);
  increment(byScope, address.addressScope);
}
function candidateTypeStat(candidate) {
  const value = stringStat(candidate, "candidateType");
  if (value === "host" || value === "srflx" || value === "prflx" || value === "relay")
    return value;
  return "unknown";
}
function candidateAddressValue(candidate) {
  return stringStat(candidate, "address") ?? stringStat(candidate, "ip");
}
function isLanCandidatePair(localType, remoteType, localScope, remoteScope) {
  if (localType === "host" && remoteType === "host") {
    return !isExplicitlyNonLanScope(localScope) && !isExplicitlyNonLanScope(remoteScope);
  }
  const directTypes = /* @__PURE__ */ new Set(["host", "prflx"]);
  if (!directTypes.has(String(localType)) || !directTypes.has(String(remoteType)))
    return false;
  if (isLocalNetworkScope(localScope) && isLocalNetworkScope(remoteScope))
    return true;
  return localType === "host" && isLocalNetworkScope(localScope) && remoteType === "prflx" && remoteScope === "unknown" || remoteType === "host" && isLocalNetworkScope(remoteScope) && localType === "prflx" && localScope === "unknown";
}
function isLocalNetworkScope(scope) {
  return scope === "private" || scope === "link-local" || scope === "loopback";
}
function isExplicitlyNonLanScope(scope) {
  return scope === "public" || scope === "cgnat" || scope === "reserved";
}
function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}
function selectedPathTelemetry(details) {
  return {
    ...details.transport === void 0 ? {} : { transport: details.transport },
    ...details.mode === void 0 ? {} : { mode: details.mode },
    ...details.localCandidateType === void 0 ? {} : { localCandidateType: details.localCandidateType },
    ...details.remoteCandidateType === void 0 ? {} : { remoteCandidateType: details.remoteCandidateType },
    ...details.localAddressScope === void 0 ? {} : { localAddressScope: details.localAddressScope },
    ...details.remoteAddressScope === void 0 ? {} : { remoteAddressScope: details.remoteAddressScope },
    ...details.protocol === void 0 ? {} : { protocol: details.protocol },
    ...details.relayProtocol === void 0 ? {} : { relayProtocol: details.relayProtocol },
    ...details.currentRoundTripTimeMs === void 0 ? {} : { currentRoundTripTimeMs: details.currentRoundTripTimeMs },
    ...details.availableOutgoingBitrate === void 0 ? {} : { availableOutgoingBitrate: details.availableOutgoingBitrate }
  };
}
function requireSdp(description) {
  if (typeof description.sdp !== "string" || description.sdp.length === 0) {
    throw new RtcConnectError("RTC_FAILED", "The RTC backend produced an empty session description.");
  }
  return description.sdp;
}
function toArrayBuffer(data) {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength)
    return data.buffer;
  return data.slice().buffer;
}
function asError(error) {
  return error instanceof Error ? error : new RtcConnectError("RTC_FAILED", "WebRTC negotiation failed.");
}
function sleep(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}

// ../webrtc/dist/adaptive-transport.js
var DEFAULT_CAPABILITIES = ["transport.lan", "transport.p2p", "transport.turn", "transport.relay", "harness.api.v1"];
var DEFAULT_PREFERRED_TRANSPORTS = ["lan", "p2p", "turn", "relay"];
var AdaptiveTransport = class extends BaseTransport {
  url;
  options;
  handshakeHandlers = /* @__PURE__ */ new Set();
  socket;
  connectionId;
  relayCounter = 0;
  bytesSent = 0;
  bytesReceived = 0;
  dataMode = "relay";
  selected;
  rtc;
  readyResolve;
  readyReject;
  handshakeTimer;
  webrtcEnabled = true;
  serverNegotiateTimeoutMs;
  negotiatedCapabilities = ["transport.relay"];
  controlFrameLimits = {};
  connectedAt;
  lastRtcDiagnostics;
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
  }
  async connect() {
    if (this.socket !== void 0)
      return;
    this.socket = new WebSocket(this.url);
    this.controlFrameLimits = {};
    this.socket.binaryType = "arraybuffer";
    await new Promise((resolve3, reject) => {
      this.readyResolve = resolve3;
      this.readyReject = reject;
      this.handshakeTimer = setTimeout(() => this.failConnection(new Error("Adaptive control handshake timed out")), this.options.handshakeTimeoutMs ?? 15e3);
      const socket = this.socket;
      socket.onmessage = (event) => {
        void this.handleSocketMessage(event.data);
      };
      socket.onopen = () => {
        this.sendControl("hello", {
          role: this.options.role,
          deviceId: this.options.deviceId,
          accessToken: this.options.accessToken,
          protocols: [PROTOCOL_VERSION],
          capabilities: this.options.capabilities ?? DEFAULT_CAPABILITIES
        });
      };
      socket.onerror = () => this.failConnection(new Error(`AdaptiveTransport failed to connect to ${this.url}`));
      socket.onclose = (event) => {
        const pending = this.readyReject !== void 0;
        if (pending)
          this.failConnection(adaptiveControlCloseError(event));
        this.socket = void 0;
        this.connectionId = void 0;
        this.emitClose();
      };
    });
  }
  async send(data) {
    if (this.connectionId === void 0)
      throw new Error("adaptive transport has not been authorized");
    if (this.dataMode === "webrtc") {
      const rtc = this.rtc;
      if (rtc === void 0)
        throw new Error("webrtc data channel is not available");
      this.bytesSent += data.byteLength;
      await rtc.send(data);
      return;
    }
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw new Error("adaptive transport is not connected");
    this.sendControl("relay", {
      connectionId: this.connectionId,
      targetDeviceId: this.options.targetDeviceId,
      counter: this.relayCounter,
      ciphertext: toBase64Url(data)
    });
    this.bytesSent += data.byteLength;
    this.relayCounter += 1;
  }
  connectionInfo() {
    if (this.connectionId === void 0)
      throw new Error("adaptive transport has not been authorized");
    return {
      connectionId: this.connectionId,
      localDeviceId: this.options.deviceId,
      remoteDeviceId: this.options.targetDeviceId
    };
  }
  async connectionDetails() {
    return {
      ...this.connectionId === void 0 ? {} : { connectionId: this.connectionId },
      ...this.connectedAt === void 0 ? {} : { connectedAt: this.connectedAt },
      controlChannelUrl: this.url,
      controlChannelState: socketState(this.socket?.readyState),
      preferredTransports: this.options.forceRelay === true ? ["relay"] : [...this.options.preferredTransports ?? DEFAULT_PREFERRED_TRANSPORTS],
      negotiatedCapabilities: [...this.negotiatedCapabilities],
      webRtcEnabled: this.webrtcEnabled,
      ...this.rtc === void 0 ? {} : { webRtc: await this.rtc.connectionDetails() }
    };
  }
  async sendHandshake(step, data) {
    if (this.socket?.readyState !== WebSocket.OPEN || this.connectionId === void 0) {
      throw new Error("adaptive transport has not been authorized");
    }
    this.sendControl("secure.handshake", {
      connectionId: this.connectionId,
      targetDeviceId: this.options.targetDeviceId,
      step,
      data: toBase64Url(data)
    });
  }
  onHandshake(cb) {
    this.handshakeHandlers.add(cb);
    return () => this.handshakeHandlers.delete(cb);
  }
  async close() {
    this.clearHandshake();
    await this.rtc?.close();
    this.rtc = void 0;
    this.socket?.close();
    this.socket = void 0;
    this.connectionId = void 0;
  }
  getStats() {
    const webrtcConnected = this.dataMode === "webrtc" && this.rtc?.getStats().connected === true;
    const relayConnected = this.dataMode === "relay" && this.socket?.readyState === WebSocket.OPEN && this.connectionId !== void 0;
    const connected = webrtcConnected || relayConnected;
    let mode = "Disconnected";
    if (this.selected === "relay")
      mode = relayConnected ? "Relay" : "Disconnected";
    else if (this.selected === "lan" || this.selected === "turn" || this.selected === "p2p") {
      mode = webrtcConnected ? this.rtc.getStats().mode : "Disconnected";
    }
    return { mode, connected, bytesSent: this.bytesSent, bytesReceived: this.bytesReceived };
  }
  async handleSocketMessage(raw) {
    try {
      if (typeof raw !== "string")
        throw new Error("Adaptive control frames must be text JSON");
      const frame = decodeControlFrame(raw, this.controlFrameLimits);
      if (frame.type === "hello.ack") {
        const payload = frame.payload;
        if (payload.protocol !== PROTOCOL_VERSION)
          throw new Error("Server selected an unsupported protocol version");
        const offered = this.options.capabilities ?? DEFAULT_CAPABILITIES;
        this.negotiatedCapabilities = acceptNegotiatedCapabilities(offered, payload.capabilities);
        this.controlFrameLimits = {
          maxControlFrameBytes: payload.maxControlFrameBytes,
          maxRelayFrameBytes: payload.maxRelayFrameBytes
        };
        const preferredTransports = this.negotiatedTransports();
        if (preferredTransports.length === 0) {
          throw new Error("Server did not negotiate a supported transport capability");
        }
        if (payload.webrtcEnabled === false)
          this.webrtcEnabled = false;
        if (typeof payload.webrtcFallbackTimeoutMs === "number" && Number.isSafeInteger(payload.webrtcFallbackTimeoutMs) && payload.webrtcFallbackTimeoutMs > 0) {
          this.serverNegotiateTimeoutMs = payload.webrtcFallbackTimeoutMs;
        }
        this.sendControl("connect.request", {
          hostDeviceId: this.options.targetDeviceId,
          preferredTransports
        });
        return;
      }
      if (frame.type === "connect.accepted") {
        const payload = frame.payload;
        if (typeof payload.connectionId !== "string" || payload.connectionId.length === 0) {
          throw new Error("connect.accepted did not include a connectionId");
        }
        this.connectionId = payload.connectionId;
        void this.negotiate().catch((error) => {
          this.failConnection(error instanceof Error ? error : new Error("Adaptive transport negotiation failed"));
        });
        return;
      }
      if (frame.type === "connect.rejected" || frame.type === "error") {
        const payload = frame.payload;
        const message = typeof payload.message === "string" ? payload.message : "Server rejected the connection";
        throw Object.assign(new Error(message), { code: payload.code });
      }
      if (frame.type === "relay") {
        if (this.dataMode !== "relay")
          return;
        this.handleRelay(frame.payload);
        return;
      }
      if (frame.type === "secure.handshake") {
        const payload = frame.payload;
        if (payload.connectionId !== this.connectionId || payload.targetDeviceId !== this.options.deviceId || !Number.isSafeInteger(payload.step) || typeof payload.data !== "string") {
          throw new Error("Received a secure handshake frame for an unknown connection");
        }
        const data = fromBase64Url(payload.data);
        for (const handler of this.handshakeHandlers)
          handler(payload.step, data);
        return;
      }
      if (frame.type === "signal.answer") {
        const payload = frame.payload;
        if (payload.connectionId === this.connectionId && typeof payload.sdp === "string") {
          this.rtc?.handleSignal({ type: "answer", sdp: payload.sdp });
        }
        return;
      }
      if (frame.type === "signal.ice") {
        const payload = frame.payload;
        if (payload.connectionId === this.connectionId && isObject(payload.candidate)) {
          this.rtc?.handleSignal({ type: "ice", candidate: payload.candidate });
        }
        return;
      }
      if (frame.type === "signal.offer" || frame.type === "transport.selected")
        return;
      if (frame.type === "ping")
        this.sendControl("pong", frame.payload);
    } catch (error) {
      this.failConnection(error instanceof Error ? error : new Error("Invalid adaptive control frame"));
    }
  }
  handleRelay(payload) {
    if (payload.connectionId !== this.connectionId || payload.targetDeviceId !== this.options.deviceId || !Number.isSafeInteger(payload.counter) || typeof payload.ciphertext !== "string") {
      throw new Error("Received a relay frame for an unknown connection");
    }
    const data = fromBase64Url(payload.ciphertext);
    this.bytesReceived += data.byteLength;
    this.emit(data);
  }
  async negotiate() {
    if (this.connectionId === void 0)
      return;
    const preferred = this.negotiatedTransports();
    const wantWebRtc = !this.options.forceRelay && this.webrtcEnabled && (preferred.includes("lan") || preferred.includes("p2p") || preferred.includes("turn"));
    let selected = "relay";
    this.lastRtcDiagnostics = void 0;
    if (wantWebRtc) {
      try {
        const rtcSelected = await this.tryWebRtc();
        const wireSelected = rtcSelected === "lan" && !preferred.includes("lan") && preferred.includes("p2p") ? "p2p" : rtcSelected;
        if (!preferred.includes(wireSelected)) {
          await this.rtc?.close();
          this.rtc = void 0;
          if (!preferred.includes("relay")) {
            throw new Error(`WebRTC selected unnegotiated transport: ${rtcSelected}`);
          }
          this.dataMode = "relay";
          selected = "relay";
        } else {
          this.dataMode = "webrtc";
          selected = wireSelected;
        }
      } catch (error) {
        const reason = error instanceof Error ? error : new Error("WebRTC negotiation failed.");
        try {
          this.options.onWebRtcFallback?.(reason, this.lastRtcDiagnostics);
        } catch {
        }
        await this.rtc?.close();
        this.rtc = void 0;
        if (!preferred.includes("relay"))
          throw reason;
        this.dataMode = "relay";
        selected = "relay";
      }
    } else {
      if (!preferred.includes("relay"))
        throw new Error("No negotiated transport is available");
      this.dataMode = "relay";
      selected = "relay";
    }
    this.selected = selected;
    this.sendControl("transport.selected", {
      connectionId: this.connectionId,
      targetDeviceId: this.options.targetDeviceId,
      transport: selected
    });
    this.finishConnection();
  }
  negotiatedTransports() {
    const preferred = this.options.forceRelay === true ? ["relay"] : this.options.preferredTransports ?? DEFAULT_PREFERRED_TRANSPORTS;
    return preferred.filter((transport) => {
      if (transport === "lan")
        return this.negotiatedCapabilities.includes("transport.lan");
      if (transport === "p2p")
        return this.negotiatedCapabilities.includes("transport.p2p");
      return this.negotiatedCapabilities.includes(`transport.${transport}`);
    });
  }
  async tryWebRtc() {
    const connectionId = this.connectionId;
    if (connectionId === void 0)
      throw new RtcConnectError("RTC_UNAVAILABLE", "No connection id for WebRTC negotiation.");
    const factory = this.options.rtcFactory ?? (typeof RTCPeerConnection === "undefined" ? void 0 : browserRtcFactory());
    if (factory === void 0) {
      throw new RtcConnectError("RTC_UNAVAILABLE", "No RTC backend is available in this environment.");
    }
    let iceServers = [];
    try {
      iceServers = await (this.options.fetchIceServers?.(connectionId) ?? []);
    } catch {
      iceServers = [];
    }
    const rtc = new RtcDataChannelTransport({
      role: "initiator",
      factory,
      iceServers,
      onSignal: (signal) => this.sendRtcSignal(signal),
      negotiateTimeoutMs: negotiateTimeout(this.serverNegotiateTimeoutMs, this.options.negotiateTimeoutMs),
      label: `client->${this.options.targetDeviceId}`,
      onDiagnostic: (event) => {
        this.lastRtcDiagnostics = event.diagnostics;
        try {
          this.options.onWebRtcDiagnostic?.(event);
        } catch {
        }
      }
    });
    this.rtc = rtc;
    rtc.onMessage((data) => {
      this.bytesReceived += data.byteLength;
      this.emit(data);
    });
    rtc.onClose(() => {
      if (this.rtc === rtc && this.dataMode === "webrtc")
        this.emitClose();
    });
    try {
      await rtc.connect();
    } catch (error) {
      this.lastRtcDiagnostics = rtc.diagnostics();
      await rtc.close();
      this.rtc = void 0;
      throw error;
    }
    this.lastRtcDiagnostics = rtc.diagnostics();
    return rtc.selectedTransport() ?? "p2p";
  }
  sendRtcSignal(signal) {
    if (this.connectionId === void 0)
      return;
    if (signal.type === "offer") {
      this.sendControl("signal.offer", {
        connectionId: this.connectionId,
        targetDeviceId: this.options.targetDeviceId,
        sdp: signal.sdp
      });
    } else if (signal.type === "answer") {
      this.sendControl("signal.answer", {
        connectionId: this.connectionId,
        targetDeviceId: this.options.targetDeviceId,
        sdp: signal.sdp
      });
    } else {
      this.sendControl("signal.ice", {
        connectionId: this.connectionId,
        targetDeviceId: this.options.targetDeviceId,
        candidate: signal.candidate
      });
    }
  }
  sendControl(type, payload) {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw new Error("adaptive control socket is not open");
    this.socket.send(encodeControlFrame(createControlFrame(type, payload), this.controlFrameLimits));
  }
  finishConnection() {
    this.clearHandshake();
    this.connectedAt ??= Date.now();
    this.readyResolve?.();
    this.readyResolve = void 0;
    this.readyReject = void 0;
  }
  failConnection(error) {
    this.clearHandshake();
    const reject = this.readyReject;
    this.readyResolve = void 0;
    this.readyReject = void 0;
    reject?.(error);
    void this.rtc?.close();
    this.rtc = void 0;
    this.socket?.close();
    this.socket = void 0;
    this.connectionId = void 0;
  }
  clearHandshake() {
    if (this.handshakeTimer !== void 0)
      clearTimeout(this.handshakeTimer);
    this.handshakeTimer = void 0;
  }
};
function adaptiveControlCloseError(event) {
  const reason = event.reason.trim().slice(0, 300);
  const detail = reason.length > 0 ? `${reason} (WebSocket ${event.code})` : `WebSocket closed with code ${event.code}`;
  return new Error(`Adaptive control channel closed before it was ready: ${detail}`);
}
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function socketState(readyState) {
  if (readyState === 0)
    return "connecting";
  if (readyState === 1)
    return "open";
  if (readyState === 2)
    return "closing";
  return "closed";
}
function negotiateTimeout(serverMs, localMs) {
  if (serverMs === void 0)
    return localMs;
  if (localMs === void 0)
    return serverMs;
  return Math.max(serverMs, localMs);
}

// src/api-proxy-switch.ts
var SWITCHED_DOMAINS = [
  "sessions",
  "subagents",
  "host",
  "workspace",
  "skills",
  "agentPresets",
  "events",
  "goals",
  "llm",
  "settings",
  "credentials"
];
var ApiProxySwitch = class {
  remote;
  target;
  mode = "local";
  installed = false;
  local;
  originals;
  localRespond;
  constructor(local) {
    this.local = local;
    this.originals = new Map(SWITCHED_DOMAINS.map((domain) => [domain, local[domain]]));
    this.localRespond = local.respond.bind(local);
  }
  install() {
    if (this.installed) return;
    for (const domain of SWITCHED_DOMAINS) {
      const localDomain = this.local[domain];
      const forwarder = new Proxy({}, {
        get: (_target, key) => {
          const selected = this.selected(domain);
          const value = selected[key];
          return typeof value === "function" ? value.bind(selected) : value;
        }
      });
      Object.defineProperty(this.local, domain, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: forwarder
      });
    }
    Object.defineProperty(this.local, "respond", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: (...args) => this.mode === "remote" ? this.requireRemote().respond(...args) : this.localRespond(...args)
    });
    this.installed = true;
  }
  selectRemote(api, target) {
    if (!this.installed) throw new Error("The Harness API switch is not installed.");
    this.remote = api;
    this.target = { ...target };
    this.mode = "remote";
  }
  selectLocal() {
    this.mode = "local";
    this.remote = void 0;
    this.target = void 0;
  }
  status() {
    return { mode: this.mode, ...this.target === void 0 ? {} : { target: { ...this.target } } };
  }
  restore() {
    if (!this.installed) return;
    this.selectLocal();
    for (const [domain, value] of this.originals) Object.defineProperty(this.local, domain, {
      configurable: true,
      enumerable: true,
      writable: true,
      value
    });
    Object.defineProperty(this.local, "respond", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: this.localRespond
    });
    this.installed = false;
  }
  selected(domain) {
    if (this.mode === "local") return this.originalDomain(domain);
    return this.requireRemote()[domain];
  }
  originalDomain(domain) {
    return this.originals.get(domain);
  }
  requireRemote() {
    if (this.remote === void 0) throw new Error("No remote Harness target is selected.");
    return this.remote;
  }
};

// ../../node_modules/.pnpm/@noble+ciphers@1.3.0/node_modules/@noble/ciphers/esm/cryptoNode.js
import * as nc from "node:crypto";
var crypto = nc && typeof nc === "object" && "webcrypto" in nc ? nc.webcrypto : nc && typeof nc === "object" && "randomBytes" in nc ? nc : void 0;

// ../../node_modules/.pnpm/@noble+ciphers@1.3.0/node_modules/@noble/ciphers/esm/webcrypto.js
function randomBytes(bytesLength = 32) {
  if (crypto && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto && typeof crypto.randomBytes === "function") {
    return Uint8Array.from(crypto.randomBytes(bytesLength));
  }
  throw new Error("crypto.getRandomValues must be defined");
}

// ../../node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/cryptoNode.js
import * as nc2 from "node:crypto";
var crypto2 = nc2 && typeof nc2 === "object" && "webcrypto" in nc2 ? nc2.webcrypto : nc2 && typeof nc2 === "object" && "randomBytes" in nc2 ? nc2 : void 0;

// ../../node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function abytes(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  if (hasHexBuiltin)
    return Uint8Array.fromHex(hex);
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new Error("hex string expected, got unpadded hex of length " + hl);
  const array3 = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array3[ai] = n1 * 16 + n2;
  }
  return array3;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
var Hash = class {
};
function createHasher(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function randomBytes2(bytesLength = 32) {
  if (crypto2 && typeof crypto2.getRandomValues === "function") {
    return crypto2.getRandomValues(new Uint8Array(bytesLength));
  }
  if (crypto2 && typeof crypto2.randomBytes === "function") {
    return Uint8Array.from(crypto2.randomBytes(bytesLength));
  }
  throw new Error("crypto.getRandomValues must be defined");
}

// ../../node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/_md.js
function setBigUint64(view, byteOffset, value, isLE3) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE3);
  const _32n3 = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n3 & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE3 ? 4 : 0;
  const l = isLE3 ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE3);
  view.setUint32(byteOffset + l, wl, isLE3);
}
var HashMD = class extends Hash {
  constructor(blockLen, outputLen, padOffset, isLE3) {
    super();
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE3;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE3 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE3);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE3);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

// ../../node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var shrSH = (h, _l, s2) => h >>> s2;
var shrSL = (h, l, s2) => h << 32 - s2 | l >>> s2;
var rotrSH = (h, l, s2) => h >>> s2 | l << 32 - s2;
var rotrSL = (h, l, s2) => h << 32 - s2 | l >>> s2;
var rotrBH = (h, l, s2) => h << 64 - s2 | l >>> s2 - 32;
var rotrBL = (h, l, s2) => h >>> s2 - 32 | l << 64 - s2;
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// ../../node_modules/.pnpm/@noble+hashes@1.8.0/node_modules/@noble/hashes/esm/sha2.js
var K512 = /* @__PURE__ */ (() => split([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))))();
var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
var SHA512 = class extends HashMD {
  constructor(outputLen = 64) {
    super(128, outputLen, 16, false);
    this.Ah = SHA512_IV[0] | 0;
    this.Al = SHA512_IV[1] | 0;
    this.Bh = SHA512_IV[2] | 0;
    this.Bl = SHA512_IV[3] | 0;
    this.Ch = SHA512_IV[4] | 0;
    this.Cl = SHA512_IV[5] | 0;
    this.Dh = SHA512_IV[6] | 0;
    this.Dl = SHA512_IV[7] | 0;
    this.Eh = SHA512_IV[8] | 0;
    this.El = SHA512_IV[9] | 0;
    this.Fh = SHA512_IV[10] | 0;
    this.Fl = SHA512_IV[11] | 0;
    this.Gh = SHA512_IV[12] | 0;
    this.Gl = SHA512_IV[13] | 0;
    this.Hh = SHA512_IV[14] | 0;
    this.Hl = SHA512_IV[15] | 0;
  }
  // prettier-ignore
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  // prettier-ignore
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4) {
      SHA512_W_H[i] = view.getUint32(offset);
      SHA512_W_L[i] = view.getUint32(offset += 4);
    }
    for (let i = 16; i < 80; i++) {
      const W15h = SHA512_W_H[i - 15] | 0;
      const W15l = SHA512_W_L[i - 15] | 0;
      const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
      const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
      const W2h = SHA512_W_H[i - 2] | 0;
      const W2l = SHA512_W_L[i - 2] | 0;
      const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
      const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
      const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
      const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
      SHA512_W_H[i] = SUMh | 0;
      SHA512_W_L[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0; i < 80; i++) {
      const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
      const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
      const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
      const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L(T1l, sigma0l, MAJl);
      Ah = add3H(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean(SHA512_W_H, SHA512_W_L);
  }
  destroy() {
    clean(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var sha512 = /* @__PURE__ */ createHasher(() => new SHA512());

// ../../node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm/utils.js
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
function _abool2(value, title = "") {
  if (typeof value !== "boolean") {
    const prefix = title && `"${title}"`;
    throw new Error(prefix + "expected boolean, got type=" + typeof value);
  }
  return value;
}
function _abytes2(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  abytes(bytes);
  return hexToNumber(bytesToHex(Uint8Array.from(bytes).reverse()));
}
function numberToBytesBE(n, len) {
  return hexToBytes(n.toString(16).padStart(len * 2, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function ensureBytes(title, hex, expectedLength) {
  let res;
  if (typeof hex === "string") {
    try {
      res = hexToBytes(hex);
    } catch (e) {
      throw new Error(title + " must be hex string or Uint8Array, cause: " + e);
    }
  } else if (isBytes(hex)) {
    res = Uint8Array.from(hex);
  } else {
    throw new Error(title + " must be hex string or Uint8Array");
  }
  const len = res.length;
  if (typeof expectedLength === "number" && len !== expectedLength)
    throw new Error(title + " of length " + expectedLength + " expected, got " + len);
  return res;
}
function equalBytes(a, b) {
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function copyBytes(bytes) {
  return Uint8Array.from(bytes);
}
var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  let len;
  for (len = 0; n > _0n; n >>= _1n, len += 1)
    ;
  return len;
}
var bitMask = (n) => (_1n << BigInt(n)) - _1n;
function _validateObject(object, fields, optFields = {}) {
  if (!object || typeof object !== "object")
    throw new Error("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    const val = object[fieldName];
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  Object.entries(fields).forEach(([k, v]) => checkField(k, v, false));
  Object.entries(optFields).forEach(([k, v]) => checkField(k, v, true));
}
var notImplemented = () => {
  throw new Error("not implemented");
};
function memoized(fn) {
  const map = /* @__PURE__ */ new WeakMap();
  return (arg, ...args) => {
    const val = map.get(arg);
    if (val !== void 0)
      return val;
    const computed = fn(arg, ...args);
    map.set(arg, computed);
    return computed;
  };
}

// ../../node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm/abstract/modular.js
var _0n2 = BigInt(0);
var _1n2 = BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _16n = /* @__PURE__ */ BigInt(16);
function mod(a, b) {
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow2(x, power, modulo) {
  let res = x;
  while (power-- > _0n2) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n2)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, y = _1n2, u = _1n2, v = _0n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b % a;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function assertIsSquare(Fp2, root, n) {
  if (!Fp2.eql(Fp2.sqr(root), n))
    throw new Error("Cannot find square root");
}
function sqrt3mod4(Fp2, n) {
  const p1div4 = (Fp2.ORDER + _1n2) / _4n;
  const root = Fp2.pow(n, p1div4);
  assertIsSquare(Fp2, root, n);
  return root;
}
function sqrt5mod8(Fp2, n) {
  const p5div8 = (Fp2.ORDER - _5n) / _8n;
  const n2 = Fp2.mul(n, _2n);
  const v = Fp2.pow(n2, p5div8);
  const nv = Fp2.mul(n, v);
  const i = Fp2.mul(Fp2.mul(nv, _2n), v);
  const root = Fp2.mul(nv, Fp2.sub(i, Fp2.ONE));
  assertIsSquare(Fp2, root, n);
  return root;
}
function sqrt9mod16(P) {
  const Fp_ = Field(P);
  const tn = tonelliShanks(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n) / _16n;
  return (Fp2, n) => {
    let tv1 = Fp2.pow(n, c4);
    let tv2 = Fp2.mul(tv1, c1);
    const tv3 = Fp2.mul(tv1, c2);
    const tv4 = Fp2.mul(tv1, c3);
    const e1 = Fp2.eql(Fp2.sqr(tv2), n);
    const e2 = Fp2.eql(Fp2.sqr(tv3), n);
    tv1 = Fp2.cmov(tv1, tv2, e1);
    tv2 = Fp2.cmov(tv4, tv3, e2);
    const e3 = Fp2.eql(Fp2.sqr(tv2), n);
    const root = Fp2.cmov(tv1, tv2, e3);
    assertIsSquare(Fp2, root, n);
    return root;
  };
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  let Q = P - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp2, n) {
    if (Fp2.is0(n))
      return n;
    if (FpLegendre(Fp2, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = Fp2.mul(Fp2.ONE, cc);
    let t = Fp2.pow(n, Q);
    let R = Fp2.pow(n, Q1div2);
    while (!Fp2.eql(t, Fp2.ONE)) {
      if (Fp2.is0(t))
        return Fp2.ZERO;
      let i = 1;
      let t_tmp = Fp2.sqr(t);
      while (!Fp2.eql(t_tmp, Fp2.ONE)) {
        i++;
        t_tmp = Fp2.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = Fp2.pow(c, exponent);
      M = i;
      c = Fp2.sqr(b);
      t = Fp2.mul(t, c);
      R = Fp2.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
var isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n2) === _1n2;
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  const initial = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "number",
    BITS: "number"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  _validateObject(field, opts);
  return field;
}
function FpPow(Fp2, num, power) {
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return Fp2.ONE;
  if (power === _1n2)
    return num;
  let p = Fp2.ONE;
  let d = num;
  while (power > _0n2) {
    if (power & _1n2)
      p = Fp2.mul(p, d);
    d = Fp2.sqr(d);
    power >>= _1n2;
  }
  return p;
}
function FpInvertBatch(Fp2, nums, passZero = false) {
  const inverted = new Array(nums.length).fill(passZero ? Fp2.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (Fp2.is0(num))
      return acc;
    inverted[i] = acc;
    return Fp2.mul(acc, num);
  }, Fp2.ONE);
  const invertedAcc = Fp2.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (Fp2.is0(num))
      return acc;
    inverted[i] = Fp2.mul(acc, inverted[i]);
    return Fp2.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp2, n) {
  const p1mod2 = (Fp2.ORDER - _1n2) / _2n;
  const powered = Fp2.pow(n, p1mod2);
  const yes = Fp2.eql(powered, Fp2.ONE);
  const zero = Fp2.eql(powered, Fp2.ZERO);
  const no = Fp2.eql(powered, Fp2.neg(Fp2.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber(nBitLength);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : n.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
function Field(ORDER, bitLenOrOpts, isLE3 = false, opts = {}) {
  if (ORDER <= _0n2)
    throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
  let _nbitLength = void 0;
  let _sqrt = void 0;
  let modFromBytes = false;
  let allowedLengths = void 0;
  if (typeof bitLenOrOpts === "object" && bitLenOrOpts != null) {
    if (opts.sqrt || isLE3)
      throw new Error("cannot specify opts in two arguments");
    const _opts = bitLenOrOpts;
    if (_opts.BITS)
      _nbitLength = _opts.BITS;
    if (_opts.sqrt)
      _sqrt = _opts.sqrt;
    if (typeof _opts.isLE === "boolean")
      isLE3 = _opts.isLE;
    if (typeof _opts.modFromBytes === "boolean")
      modFromBytes = _opts.modFromBytes;
    allowedLengths = _opts.allowedLengths;
  } else {
    if (typeof bitLenOrOpts === "number")
      _nbitLength = bitLenOrOpts;
    if (opts.sqrt)
      _sqrt = opts.sqrt;
  }
  const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, _nbitLength);
  if (BYTES > 2048)
    throw new Error("invalid field: expected ORDER of <= 2048 bytes");
  let sqrtP;
  const f = Object.freeze({
    ORDER,
    isLE: isLE3,
    BITS,
    BYTES,
    MASK: bitMask(BITS),
    ZERO: _0n2,
    ONE: _1n2,
    allowedLengths,
    create: (num) => mod(num, ORDER),
    isValid: (num) => {
      if (typeof num !== "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof num);
      return _0n2 <= num && num < ORDER;
    },
    is0: (num) => num === _0n2,
    // is valid and invertible
    isValidNot0: (num) => !f.is0(num) && f.isValid(num),
    isOdd: (num) => (num & _1n2) === _1n2,
    neg: (num) => mod(-num, ORDER),
    eql: (lhs, rhs) => lhs === rhs,
    sqr: (num) => mod(num * num, ORDER),
    add: (lhs, rhs) => mod(lhs + rhs, ORDER),
    sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
    mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
    pow: (num, power) => FpPow(f, num, power),
    div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
    // Same as above, but doesn't normalize
    sqrN: (num) => num * num,
    addN: (lhs, rhs) => lhs + rhs,
    subN: (lhs, rhs) => lhs - rhs,
    mulN: (lhs, rhs) => lhs * rhs,
    inv: (num) => invert(num, ORDER),
    sqrt: _sqrt || ((n) => {
      if (!sqrtP)
        sqrtP = FpSqrt(ORDER);
      return sqrtP(f, n);
    }),
    toBytes: (num) => isLE3 ? numberToBytesLE(num, BYTES) : numberToBytesBE(num, BYTES),
    fromBytes: (bytes, skipValidation = true) => {
      if (allowedLengths) {
        if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
          throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
        }
        const padded = new Uint8Array(BYTES);
        padded.set(bytes, isLE3 ? 0 : padded.length - bytes.length);
        bytes = padded;
      }
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      let scalar = isLE3 ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
      if (modFromBytes)
        scalar = mod(scalar, ORDER);
      if (!skipValidation) {
        if (!f.isValid(scalar))
          throw new Error("invalid field element: outside of range 0..ORDER");
      }
      return scalar;
    },
    // TODO: we don't need it here, move out to separate fn
    invertBatch: (lst) => FpInvertBatch(f, lst),
    // We can't move this out because Fp6, Fp12 implement it
    // and it's unclear what to return in there.
    cmov: (a, b, c) => c ? b : a
  });
  return Object.freeze(f);
}

// ../../node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm/abstract/curve.js
var _0n3 = BigInt(0);
var _1n3 = BigInt(1);
function negateCt(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function normalizeZ(c, points) {
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
  validateW(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
function validateMSMPoints(points, c) {
  if (!Array.isArray(points))
    throw new Error("array expected");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s2, i) => {
    if (!field.isValid(s2))
      throw new Error("invalid scalar at index " + i);
  });
}
var pointPrecomputes = /* @__PURE__ */ new WeakMap();
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getW(P) {
  return pointWindowSizes.get(P) || 1;
}
function assert0(n) {
  if (n !== _0n3)
    throw new Error("invalid wNAF");
}
var wNAF = class {
  // Parametrized with a given Point class (not individual point)
  constructor(Point, bits) {
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.Fn = Point.Fn;
    this.bits = bits;
  }
  // non-const time multiplication ladder
  _unsafeLadder(elm, n, p = this.ZERO) {
    let d = elm;
    while (n > _0n3) {
      if (n & _1n3)
        p = p.add(d);
      d = d.double();
      n >>= _1n3;
    }
    return p;
  }
  /**
   * Creates a wNAF precomputation window. Used for caching.
   * Default window size is set by `utils.precompute()` and is equal to 8.
   * Number of precomputed points depends on the curve size:
   * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
   * - 𝑊 is the window size
   * - 𝑛 is the bitlength of the curve order.
   * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
   * @param point Point instance
   * @param W window size
   * @returns precomputed point tables flattened to a single array
   */
  precomputeWindow(point, W) {
    const { windows, windowSize } = calcWOpts(W, this.bits);
    const points = [];
    let p = point;
    let base = p;
    for (let window = 0; window < windows; window++) {
      base = p;
      points.push(base);
      for (let i = 1; i < windowSize; i++) {
        base = base.add(p);
        points.push(base);
      }
      p = base.double();
    }
    return points;
  }
  /**
   * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
   * More compact implementation:
   * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
   * @returns real and fake (for const-time) points
   */
  wNAF(W, precomputes, n) {
    if (!this.Fn.isValid(n))
      throw new Error("invalid scalar");
    let p = this.ZERO;
    let f = this.BASE;
    const wo = calcWOpts(W, this.bits);
    for (let window = 0; window < wo.windows; window++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
      n = nextN;
      if (isZero) {
        f = f.add(negateCt(isNegF, precomputes[offsetF]));
      } else {
        p = p.add(negateCt(isNeg, precomputes[offset]));
      }
    }
    assert0(n);
    return { p, f };
  }
  /**
   * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
   * @param acc accumulator point to add result of multiplication
   * @returns point
   */
  wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
    const wo = calcWOpts(W, this.bits);
    for (let window = 0; window < wo.windows; window++) {
      if (n === _0n3)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
      n = nextN;
      if (isZero) {
        continue;
      } else {
        const item = precomputes[offset];
        acc = acc.add(isNeg ? item.negate() : item);
      }
    }
    assert0(n);
    return acc;
  }
  getPrecomputes(W, point, transform) {
    let comp = pointPrecomputes.get(point);
    if (!comp) {
      comp = this.precomputeWindow(point, W);
      if (W !== 1) {
        if (typeof transform === "function")
          comp = transform(comp);
        pointPrecomputes.set(point, comp);
      }
    }
    return comp;
  }
  cached(point, scalar, transform) {
    const W = getW(point);
    return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
  }
  unsafe(point, scalar, transform, prev) {
    const W = getW(point);
    if (W === 1)
      return this._unsafeLadder(point, scalar, prev);
    return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
  }
  // We calculate precomputes for elliptic curve point multiplication
  // using windowed method. This specifies window size and
  // stores precomputed values. Usually only base point would be precomputed.
  createCache(P, W) {
    validateW(W, this.bits);
    pointWindowSizes.set(P, W);
    pointPrecomputes.delete(P);
  }
  hasCache(elm) {
    return getW(elm) !== 1;
  }
};
function pippenger(c, fieldN, points, scalars) {
  validateMSMPoints(points, c);
  validateMSMScalars(scalars, fieldN);
  const plength = points.length;
  const slength = scalars.length;
  if (plength !== slength)
    throw new Error("arrays of points and scalars must have equal length");
  const zero = c.ZERO;
  const wbits = bitLen(BigInt(plength));
  let windowSize = 1;
  if (wbits > 12)
    windowSize = wbits - 3;
  else if (wbits > 4)
    windowSize = wbits - 2;
  else if (wbits > 0)
    windowSize = 2;
  const MASK = bitMask(windowSize);
  const buckets = new Array(Number(MASK) + 1).fill(zero);
  const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
  let sum = zero;
  for (let i = lastBits; i >= 0; i -= windowSize) {
    buckets.fill(zero);
    for (let j = 0; j < slength; j++) {
      const scalar = scalars[j];
      const wbits2 = Number(scalar >> BigInt(i) & MASK);
      buckets[wbits2] = buckets[wbits2].add(points[j]);
    }
    let resI = zero;
    for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
      sumI = sumI.add(buckets[j]);
      resI = resI.add(sumI);
    }
    sum = sum.add(resI);
    if (i !== 0)
      for (let j = 0; j < windowSize; j++)
        sum = sum.double();
  }
  return sum;
}
function createField(order, field, isLE3) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE: isLE3 });
  }
}
function _createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(typeof val === "bigint" && val > _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp2 = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn2 = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp2.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp: Fp2, Fn: Fn2 };
}

// ../../node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm/abstract/edwards.js
var _0n4 = BigInt(0);
var _1n4 = BigInt(1);
var _2n2 = BigInt(2);
var _8n2 = BigInt(8);
function isEdValidXY(Fp2, CURVE, x, y) {
  const x2 = Fp2.sqr(x);
  const y2 = Fp2.sqr(y);
  const left = Fp2.add(Fp2.mul(CURVE.a, x2), y2);
  const right = Fp2.add(Fp2.ONE, Fp2.mul(CURVE.d, Fp2.mul(x2, y2)));
  return Fp2.eql(left, right);
}
function edwards(params, extraOpts = {}) {
  const validated = _createCurveFields("edwards", params, extraOpts, extraOpts.FpFnLE);
  const { Fp: Fp2, Fn: Fn2 } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  _validateObject(extraOpts, {}, { uvRatio: "function" });
  const MASK = _2n2 << BigInt(Fn2.BYTES * 8) - _1n4;
  const modP = (n) => Fp2.create(n);
  const uvRatio3 = extraOpts.uvRatio || ((u, v) => {
    try {
      return { isValid: true, value: Fp2.sqrt(Fp2.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n4 };
    }
  });
  if (!isEdValidXY(Fp2, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n4 : _0n4;
    aInRange("coordinate " + title, n, min, MASK);
    return n;
  }
  function aextpoint(other) {
    if (!(other instanceof Point))
      throw new Error("ExtendedPoint expected");
  }
  const toAffineMemo = memoized((p, iz) => {
    const { X, Y, Z } = p;
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? _8n2 : Fp2.inv(Z);
    const x = modP(X * iz);
    const y = modP(Y * iz);
    const zz = Fp2.mul(Z, iz);
    if (is0)
      return { x: _0n4, y: _1n4 };
    if (zz !== _1n4)
      throw new Error("invZ was invalid");
    return { x, y };
  });
  const assertValidMemo = memoized((p) => {
    const { a, d } = CURVE;
    if (p.is0())
      throw new Error("bad point: ZERO");
    const { X, Y, Z, T } = p;
    const X2 = modP(X * X);
    const Y2 = modP(Y * Y);
    const Z2 = modP(Z * Z);
    const Z4 = modP(Z2 * Z2);
    const aX2 = modP(X2 * a);
    const left = modP(Z2 * modP(aX2 + Y2));
    const right = modP(Z4 + modP(d * modP(X2 * Y2)));
    if (left !== right)
      throw new Error("bad point: equation left != right (1)");
    const XY = modP(X * Y);
    const ZT = modP(Z * T);
    if (XY !== ZT)
      throw new Error("bad point: equation left != right (2)");
    return true;
  });
  class Point {
    constructor(X, Y, Z, T) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    static fromAffine(p) {
      if (p instanceof Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new Point(x, y, _1n4, modP(x * y));
    }
    // Uses algo from RFC8032 5.1.3.
    static fromBytes(bytes, zip215 = false) {
      const len = Fp2.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes(_abytes2(bytes, len, "point"));
      _abool2(zip215, "zip215");
      const normed = copyBytes(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE(normed);
      const max = zip215 ? MASK : Fp2.ORDER;
      aInRange("point.y", y, _0n4, max);
      const y2 = modP(y * y);
      const u = modP(y2 - _1n4);
      const v = modP(d * y2 - a);
      let { isValid: isValid2, value: x } = uvRatio3(u, v);
      if (!isValid2)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = (x & _1n4) === _1n4;
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && x === _0n4 && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = modP(-x);
      return Point.fromAffine({ x, y });
    }
    static fromHex(bytes, zip215 = false) {
      return Point.fromBytes(ensureBytes("point", bytes), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 8, isLazy = true) {
      wnaf.createCache(this, windowSize);
      if (!isLazy)
        this.multiply(_2n2);
      return this;
    }
    // Useful in fromAffine() - not for fromBytes(), which always created valid points.
    assertValidity() {
      assertValidMemo(this);
    }
    // Compare one point to another.
    equals(other) {
      aextpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const X1Z2 = modP(X1 * Z2);
      const X2Z1 = modP(X2 * Z1);
      const Y1Z2 = modP(Y1 * Z2);
      const Y2Z1 = modP(Y2 * Z1);
      return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    negate() {
      return new Point(modP(-this.X), this.Y, this.Z, modP(-this.T));
    }
    // Fast algo for doubling Extended Point.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
    // Cost: 4M + 4S + 1*a + 6add + 1*2.
    double() {
      const { a } = CURVE;
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const A = modP(X1 * X1);
      const B = modP(Y1 * Y1);
      const C = modP(_2n2 * modP(Z1 * Z1));
      const D = modP(a * A);
      const x1y1 = X1 + Y1;
      const E = modP(modP(x1y1 * x1y1) - A - B);
      const G = D + B;
      const F = G - C;
      const H = D - B;
      const X3 = modP(E * F);
      const Y3 = modP(G * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G);
      return new Point(X3, Y3, Z3, T3);
    }
    // Fast algo for adding 2 Extended Points.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
    // Cost: 9M + 1*a + 1*d + 7add.
    add(other) {
      aextpoint(other);
      const { a, d } = CURVE;
      const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
      const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
      const A = modP(X1 * X2);
      const B = modP(Y1 * Y2);
      const C = modP(T1 * d * T2);
      const D = modP(Z1 * Z2);
      const E = modP((X1 + Y1) * (X2 + Y2) - A - B);
      const F = D - C;
      const G = D + C;
      const H = modP(B - a * A);
      const X3 = modP(E * F);
      const Y3 = modP(G * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G);
      return new Point(X3, Y3, Z3, T3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    // Constant-time multiplication.
    multiply(scalar) {
      if (!Fn2.isValidNot0(scalar))
        throw new Error("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.cached(this, scalar, (p2) => normalizeZ(Point, p2));
      return normalizeZ(Point, [p, f])[0];
    }
    // Non-constant-time multiplication. Uses double-and-add algorithm.
    // It's faster, but should only be used when you don't care about
    // an exposed private key e.g. sig verification.
    // Does NOT allow scalars higher than CURVE.n.
    // Accepts optional accumulator to merge with multiply (important for sparse scalars)
    multiplyUnsafe(scalar, acc = Point.ZERO) {
      if (!Fn2.isValid(scalar))
        throw new Error("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n4)
        return Point.ZERO;
      if (this.is0() || scalar === _1n4)
        return this;
      return wnaf.unsafe(this, scalar, (p) => normalizeZ(Point, p), acc);
    }
    // Checks if point is of small order.
    // If you add something to small order point, you will have "dirty"
    // point with torsion component.
    // Multiplies point by cofactor and checks if the result is 0.
    isSmallOrder() {
      return this.multiplyUnsafe(cofactor).is0();
    }
    // Multiplies point by curve order and checks if the result is 0.
    // Returns `false` is the point is dirty.
    isTorsionFree() {
      return wnaf.unsafe(this, CURVE.n).is0();
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    toAffine(invertedZ) {
      return toAffineMemo(this, invertedZ);
    }
    clearCofactor() {
      if (cofactor === _1n4)
        return this;
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp2.toBytes(y);
      bytes[bytes.length - 1] |= x & _1n4 ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
    // TODO: remove
    get ex() {
      return this.X;
    }
    get ey() {
      return this.Y;
    }
    get ez() {
      return this.Z;
    }
    get et() {
      return this.T;
    }
    static normalizeZ(points) {
      return normalizeZ(Point, points);
    }
    static msm(points, scalars) {
      return pippenger(Point, Fn2, points, scalars);
    }
    _setWindowSize(windowSize) {
      this.precompute(windowSize);
    }
    toRawBytes() {
      return this.toBytes();
    }
  }
  Point.BASE = new Point(CURVE.Gx, CURVE.Gy, _1n4, modP(CURVE.Gx * CURVE.Gy));
  Point.ZERO = new Point(_0n4, _1n4, _1n4, _0n4);
  Point.Fp = Fp2;
  Point.Fn = Fn2;
  const wnaf = new wNAF(Point, Fn2.BITS);
  Point.BASE.precompute(8);
  return Point;
}
var PrimeEdwardsPoint = class {
  constructor(ep) {
    this.ep = ep;
  }
  // Static methods that must be implemented by subclasses
  static fromBytes(_bytes) {
    notImplemented();
  }
  static fromHex(_hex) {
    notImplemented();
  }
  get x() {
    return this.toAffine().x;
  }
  get y() {
    return this.toAffine().y;
  }
  // Common implementations
  clearCofactor() {
    return this;
  }
  assertValidity() {
    this.ep.assertValidity();
  }
  toAffine(invertedZ) {
    return this.ep.toAffine(invertedZ);
  }
  toHex() {
    return bytesToHex(this.toBytes());
  }
  toString() {
    return this.toHex();
  }
  isTorsionFree() {
    return true;
  }
  isSmallOrder() {
    return false;
  }
  add(other) {
    this.assertSame(other);
    return this.init(this.ep.add(other.ep));
  }
  subtract(other) {
    this.assertSame(other);
    return this.init(this.ep.subtract(other.ep));
  }
  multiply(scalar) {
    return this.init(this.ep.multiply(scalar));
  }
  multiplyUnsafe(scalar) {
    return this.init(this.ep.multiplyUnsafe(scalar));
  }
  double() {
    return this.init(this.ep.double());
  }
  negate() {
    return this.init(this.ep.negate());
  }
  precompute(windowSize, isLazy) {
    return this.init(this.ep.precompute(windowSize, isLazy));
  }
  /** @deprecated use `toBytes` */
  toRawBytes() {
    return this.toBytes();
  }
};
function eddsa(Point, cHash, eddsaOpts = {}) {
  if (typeof cHash !== "function")
    throw new Error('"hash" function param is required');
  _validateObject(eddsaOpts, {}, {
    adjustScalarBytes: "function",
    randomBytes: "function",
    domain: "function",
    prehash: "function",
    mapToCurve: "function"
  });
  const { prehash } = eddsaOpts;
  const { BASE, Fp: Fp2, Fn: Fn2 } = Point;
  const randomBytes7 = eddsaOpts.randomBytes || randomBytes2;
  const adjustScalarBytes3 = eddsaOpts.adjustScalarBytes || ((bytes) => bytes);
  const domain = eddsaOpts.domain || ((data, ctx, phflag) => {
    _abool2(phflag, "phflag");
    if (ctx.length || phflag)
      throw new Error("Contexts/pre-hash are not supported");
    return data;
  });
  function modN_LE(hash) {
    return Fn2.create(bytesToNumberLE(hash));
  }
  function getPrivateScalar(key) {
    const len = lengths.secretKey;
    key = ensureBytes("private key", key, len);
    const hashed = ensureBytes("hashed private key", cHash(key), 2 * len);
    const head = adjustScalarBytes3(hashed.slice(0, len));
    const prefix = hashed.slice(len, 2 * len);
    const scalar = modN_LE(head);
    return { head, prefix, scalar };
  }
  function getExtendedPublicKey(secretKey2) {
    const { head, prefix, scalar } = getPrivateScalar(secretKey2);
    const point = BASE.multiply(scalar);
    const pointBytes = point.toBytes();
    return { head, prefix, scalar, point, pointBytes };
  }
  function getPublicKey(secretKey2) {
    return getExtendedPublicKey(secretKey2).pointBytes;
  }
  function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
    const msg = concatBytes(...msgs);
    return modN_LE(cHash(domain(msg, ensureBytes("context", context), !!prehash)));
  }
  function sign(msg, secretKey2, options = {}) {
    msg = ensureBytes("message", msg);
    if (prehash)
      msg = prehash(msg);
    const { prefix, scalar, pointBytes } = getExtendedPublicKey(secretKey2);
    const r = hashDomainToScalar(options.context, prefix, msg);
    const R = BASE.multiply(r).toBytes();
    const k = hashDomainToScalar(options.context, R, pointBytes, msg);
    const s2 = Fn2.create(r + k * scalar);
    if (!Fn2.isValid(s2))
      throw new Error("sign failed: invalid s");
    const rs = concatBytes(R, Fn2.toBytes(s2));
    return _abytes2(rs, lengths.signature, "result");
  }
  const verifyOpts = { zip215: true };
  function verify(sig, msg, publicKey, options = verifyOpts) {
    const { context, zip215 } = options;
    const len = lengths.signature;
    sig = ensureBytes("signature", sig, len);
    msg = ensureBytes("message", msg);
    publicKey = ensureBytes("publicKey", publicKey, lengths.publicKey);
    if (zip215 !== void 0)
      _abool2(zip215, "zip215");
    if (prehash)
      msg = prehash(msg);
    const mid = len / 2;
    const r = sig.subarray(0, mid);
    const s2 = bytesToNumberLE(sig.subarray(mid, len));
    let A, R, SB;
    try {
      A = Point.fromBytes(publicKey, zip215);
      R = Point.fromBytes(r, zip215);
      SB = BASE.multiplyUnsafe(s2);
    } catch (error) {
      return false;
    }
    if (!zip215 && A.isSmallOrder())
      return false;
    const k = hashDomainToScalar(context, R.toBytes(), A.toBytes(), msg);
    const RkA = R.add(A.multiplyUnsafe(k));
    return RkA.subtract(SB).clearCofactor().is0();
  }
  const _size = Fp2.BYTES;
  const lengths = {
    secretKey: _size,
    publicKey: _size,
    signature: 2 * _size,
    seed: _size
  };
  function randomSecretKey(seed = randomBytes7(lengths.seed)) {
    return _abytes2(seed, lengths.seed, "seed");
  }
  function keygen(seed) {
    const secretKey2 = utils.randomSecretKey(seed);
    return { secretKey: secretKey2, publicKey: getPublicKey(secretKey2) };
  }
  function isValidSecretKey(key) {
    return isBytes(key) && key.length === Fn2.BYTES;
  }
  function isValidPublicKey(key, zip215) {
    try {
      return !!Point.fromBytes(key, zip215);
    } catch (error) {
      return false;
    }
  }
  const utils = {
    getExtendedPublicKey,
    randomSecretKey,
    isValidSecretKey,
    isValidPublicKey,
    /**
     * Converts ed public key to x public key. Uses formula:
     * - ed25519:
     *   - `(u, v) = ((1+y)/(1-y), sqrt(-486664)*u/x)`
     *   - `(x, y) = (sqrt(-486664)*u/v, (u-1)/(u+1))`
     * - ed448:
     *   - `(u, v) = ((y-1)/(y+1), sqrt(156324)*u/x)`
     *   - `(x, y) = (sqrt(156324)*u/v, (1+u)/(1-u))`
     */
    toMontgomery(publicKey) {
      const { y } = Point.fromBytes(publicKey);
      const size = lengths.publicKey;
      const is25519 = size === 32;
      if (!is25519 && size !== 57)
        throw new Error("only defined for 25519 and 448");
      const u = is25519 ? Fp2.div(_1n4 + y, _1n4 - y) : Fp2.div(y - _1n4, y + _1n4);
      return Fp2.toBytes(u);
    },
    toMontgomerySecret(secretKey2) {
      const size = lengths.secretKey;
      _abytes2(secretKey2, size);
      const hashed = cHash(secretKey2.subarray(0, size));
      return adjustScalarBytes3(hashed).subarray(0, size);
    },
    /** @deprecated */
    randomPrivateKey: randomSecretKey,
    /** @deprecated */
    precompute(windowSize = 8, point = Point.BASE) {
      return point.precompute(windowSize, false);
    }
  };
  return Object.freeze({
    keygen,
    getPublicKey,
    sign,
    verify,
    utils,
    Point,
    lengths
  });
}
function _eddsa_legacy_opts_to_new(c) {
  const CURVE = {
    a: c.a,
    d: c.d,
    p: c.Fp.ORDER,
    n: c.n,
    h: c.h,
    Gx: c.Gx,
    Gy: c.Gy
  };
  const Fp2 = c.Fp;
  const Fn2 = Field(CURVE.n, c.nBitLength, true);
  const curveOpts = { Fp: Fp2, Fn: Fn2, uvRatio: c.uvRatio };
  const eddsaOpts = {
    randomBytes: c.randomBytes,
    adjustScalarBytes: c.adjustScalarBytes,
    domain: c.domain,
    prehash: c.prehash,
    mapToCurve: c.mapToCurve
  };
  return { CURVE, curveOpts, hash: c.hash, eddsaOpts };
}
function _eddsa_new_output_to_legacy(c, eddsa3) {
  const Point = eddsa3.Point;
  const legacy = Object.assign({}, eddsa3, {
    ExtendedPoint: Point,
    CURVE: c,
    nBitLength: Point.Fn.BITS,
    nByteLength: Point.Fn.BYTES
  });
  return legacy;
}
function twistedEdwards(c) {
  const { CURVE, curveOpts, hash, eddsaOpts } = _eddsa_legacy_opts_to_new(c);
  const Point = edwards(CURVE, curveOpts);
  const EDDSA = eddsa(Point, hash, eddsaOpts);
  return _eddsa_new_output_to_legacy(c, EDDSA);
}

// ../../node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm/abstract/montgomery.js
var _0n5 = BigInt(0);
var _1n5 = BigInt(1);
var _2n3 = BigInt(2);
function validateOpts(curve) {
  _validateObject(curve, {
    adjustScalarBytes: "function",
    powPminus2: "function"
  });
  return Object.freeze({ ...curve });
}
function montgomery(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { P, type, adjustScalarBytes: adjustScalarBytes3, powPminus2, randomBytes: rand } = CURVE;
  const is25519 = type === "x25519";
  if (!is25519 && type !== "x448")
    throw new Error("invalid type");
  const randomBytes_ = rand || randomBytes2;
  const montgomeryBits = is25519 ? 255 : 448;
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? BigInt(9) : BigInt(5);
  const a24 = is25519 ? BigInt(121665) : BigInt(39081);
  const minScalar = is25519 ? _2n3 ** BigInt(254) : _2n3 ** BigInt(447);
  const maxAdded = is25519 ? BigInt(8) * _2n3 ** BigInt(251) - _1n5 : BigInt(4) * _2n3 ** BigInt(445) - _1n5;
  const maxScalar = minScalar + maxAdded + _1n5;
  const modP = (n) => mod(n, P);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE(modP(u), fieldLen);
  }
  function decodeU(u) {
    const _u = ensureBytes("u coordinate", u, fieldLen);
    if (is25519)
      _u[31] &= 127;
    return modP(bytesToNumberLE(_u));
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE(adjustScalarBytes3(ensureBytes("scalar", scalar, fieldLen)));
  }
  function scalarMult(scalar, u) {
    const pu = montgomeryLadder(decodeU(u), decodeScalar(scalar));
    if (pu === _0n5)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  function scalarMultBase(scalar) {
    return scalarMult(scalar, GuBytes);
  }
  function cswap2(swap, x_2, x_3) {
    const dummy = modP(swap * (x_2 - x_3));
    x_2 = modP(x_2 - dummy);
    x_3 = modP(x_3 + dummy);
    return { x_2, x_3 };
  }
  function montgomeryLadder(u, scalar) {
    aInRange("u", u, _0n5, P);
    aInRange("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = _1n5;
    let z_2 = _0n5;
    let x_3 = u;
    let z_3 = _1n5;
    let swap = _0n5;
    for (let t = BigInt(montgomeryBits - 1); t >= _0n5; t--) {
      const k_t = k >> t & _1n5;
      swap ^= k_t;
      ({ x_2, x_3 } = cswap2(swap, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = cswap2(swap, z_2, z_3));
      swap = k_t;
      const A = x_2 + z_2;
      const AA = modP(A * A);
      const B = x_2 - z_2;
      const BB = modP(B * B);
      const E = AA - BB;
      const C = x_3 + z_3;
      const D = x_3 - z_3;
      const DA = modP(D * A);
      const CB = modP(C * B);
      const dacb = DA + CB;
      const da_cb = DA - CB;
      x_3 = modP(dacb * dacb);
      z_3 = modP(x_1 * modP(da_cb * da_cb));
      x_2 = modP(AA * BB);
      z_2 = modP(E * (AA + modP(a24 * E)));
    }
    ({ x_2, x_3 } = cswap2(swap, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = cswap2(swap, z_2, z_3));
    const z2 = powPminus2(z_2);
    return modP(x_2 * z2);
  }
  const lengths = {
    secretKey: fieldLen,
    publicKey: fieldLen,
    seed: fieldLen
  };
  const randomSecretKey = (seed = randomBytes_(fieldLen)) => {
    abytes(seed, lengths.seed);
    return seed;
  };
  function keygen(seed) {
    const secretKey2 = randomSecretKey(seed);
    return { secretKey: secretKey2, publicKey: scalarMultBase(secretKey2) };
  }
  const utils = {
    randomSecretKey,
    randomPrivateKey: randomSecretKey
  };
  return {
    keygen,
    getSharedSecret: (secretKey2, publicKey) => scalarMult(secretKey2, publicKey),
    getPublicKey: (secretKey2) => scalarMultBase(secretKey2),
    scalarMult,
    scalarMultBase,
    utils,
    GuBytes: GuBytes.slice(),
    lengths
  };
}

// ../../node_modules/.pnpm/@noble+curves@1.9.7/node_modules/@noble/curves/esm/ed25519.js
var _0n6 = /* @__PURE__ */ BigInt(0);
var _1n6 = BigInt(1);
var _2n4 = BigInt(2);
var _3n2 = BigInt(3);
var _5n2 = BigInt(5);
var _8n3 = BigInt(8);
var ed25519_CURVE_p = BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
var ed25519_CURVE = /* @__PURE__ */ (() => ({
  p: ed25519_CURVE_p,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n3,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
}))();
function ed25519_pow_2_252_3(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P = ed25519_CURVE_p;
  const x2 = x * x % P;
  const b2 = x2 * x % P;
  const b4 = pow2(b2, _2n4, P) * b2 % P;
  const b5 = pow2(b4, _1n6, P) * x % P;
  const b10 = pow2(b5, _5n2, P) * b5 % P;
  const b20 = pow2(b10, _10n, P) * b10 % P;
  const b40 = pow2(b20, _20n, P) * b20 % P;
  const b80 = pow2(b40, _40n, P) * b40 % P;
  const b160 = pow2(b80, _80n, P) * b80 % P;
  const b240 = pow2(b160, _80n, P) * b80 % P;
  const b250 = pow2(b240, _10n, P) * b10 % P;
  const pow_p_5_8 = pow2(b250, _2n4, P) * x % P;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
var ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio(u, v) {
  const P = ed25519_CURVE_p;
  const v3 = mod(v * v * v, P);
  const v7 = mod(v3 * v3 * v, P);
  const pow3 = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
  let x = mod(u * v3 * pow3, P);
  const vx2 = mod(v * x * x, P);
  const root1 = x;
  const root2 = mod(x * ED25519_SQRT_M1, P);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod(-u, P);
  const noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE(x, P))
    x = mod(-x, P);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var Fp = /* @__PURE__ */ (() => Field(ed25519_CURVE.p, { isLE: true }))();
var Fn = /* @__PURE__ */ (() => Field(ed25519_CURVE.n, { isLE: true }))();
var ed25519Defaults = /* @__PURE__ */ (() => ({
  ...ed25519_CURVE,
  Fp,
  hash: sha512,
  adjustScalarBytes,
  // dom2
  // Ratio of u to v. Allows us to combine inversion and square root. Uses algo from RFC8032 5.1.3.
  // Constant-time, u/√v
  uvRatio
}))();
var ed25519 = /* @__PURE__ */ (() => twistedEdwards(ed25519Defaults))();
var x25519 = /* @__PURE__ */ (() => {
  const P = Fp.ORDER;
  return montgomery({
    P,
    type: "x25519",
    powPminus2: (x) => {
      const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
      return mod(pow2(pow_p_5_8, _3n2, P) * b2, P);
    },
    adjustScalarBytes
  });
})();
var SQRT_M1 = ED25519_SQRT_M1;
var SQRT_AD_MINUS_ONE = /* @__PURE__ */ BigInt("25063068953384623474111414158702152701244531502492656460079210482610430750235");
var INVSQRT_A_MINUS_D = /* @__PURE__ */ BigInt("54469307008909316920995813868745141605393597292927456921205312896311721017578");
var ONE_MINUS_D_SQ = /* @__PURE__ */ BigInt("1159843021668779879193775521855586647937357759715417654439879720876111806838");
var D_MINUS_ONE_SQ = /* @__PURE__ */ BigInt("40440834346308536858101042469323190826248399146238708352240133220865137265952");
var invertSqrt = (number) => uvRatio(_1n6, number);
var MAX_255B = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
var bytes255ToNumberLE = (bytes) => ed25519.Point.Fp.create(bytesToNumberLE(bytes) & MAX_255B);
function calcElligatorRistrettoMap(r0) {
  const { d } = ed25519_CURVE;
  const P = ed25519_CURVE_p;
  const mod3 = (n) => Fp.create(n);
  const r = mod3(SQRT_M1 * r0 * r0);
  const Ns = mod3((r + _1n6) * ONE_MINUS_D_SQ);
  let c = BigInt(-1);
  const D = mod3((c - d * r) * mod3(r + d));
  let { isValid: Ns_D_is_sq, value: s2 } = uvRatio(Ns, D);
  let s_ = mod3(s2 * r0);
  if (!isNegativeLE(s_, P))
    s_ = mod3(-s_);
  if (!Ns_D_is_sq)
    s2 = s_;
  if (!Ns_D_is_sq)
    c = r;
  const Nt = mod3(c * (r - _1n6) * D_MINUS_ONE_SQ - D);
  const s22 = s2 * s2;
  const W0 = mod3((s2 + s2) * D);
  const W1 = mod3(Nt * SQRT_AD_MINUS_ONE);
  const W2 = mod3(_1n6 - s22);
  const W3 = mod3(_1n6 + s22);
  return new ed25519.Point(mod3(W0 * W3), mod3(W2 * W1), mod3(W1 * W3), mod3(W0 * W2));
}
function ristretto255_map(bytes) {
  abytes(bytes, 64);
  const r1 = bytes255ToNumberLE(bytes.subarray(0, 32));
  const R1 = calcElligatorRistrettoMap(r1);
  const r2 = bytes255ToNumberLE(bytes.subarray(32, 64));
  const R2 = calcElligatorRistrettoMap(r2);
  return new _RistrettoPoint(R1.add(R2));
}
var _RistrettoPoint = class __RistrettoPoint extends PrimeEdwardsPoint {
  constructor(ep) {
    super(ep);
  }
  static fromAffine(ap) {
    return new __RistrettoPoint(ed25519.Point.fromAffine(ap));
  }
  assertSame(other) {
    if (!(other instanceof __RistrettoPoint))
      throw new Error("RistrettoPoint expected");
  }
  init(ep) {
    return new __RistrettoPoint(ep);
  }
  /** @deprecated use `import { ristretto255_hasher } from '@noble/curves/ed25519.js';` */
  static hashToCurve(hex) {
    return ristretto255_map(ensureBytes("ristrettoHash", hex, 64));
  }
  static fromBytes(bytes) {
    abytes(bytes, 32);
    const { a, d } = ed25519_CURVE;
    const P = ed25519_CURVE_p;
    const mod3 = (n) => Fp.create(n);
    const s2 = bytes255ToNumberLE(bytes);
    if (!equalBytes(Fp.toBytes(s2), bytes) || isNegativeLE(s2, P))
      throw new Error("invalid ristretto255 encoding 1");
    const s22 = mod3(s2 * s2);
    const u1 = mod3(_1n6 + a * s22);
    const u2 = mod3(_1n6 - a * s22);
    const u1_2 = mod3(u1 * u1);
    const u2_2 = mod3(u2 * u2);
    const v = mod3(a * d * u1_2 - u2_2);
    const { isValid: isValid2, value: I } = invertSqrt(mod3(v * u2_2));
    const Dx = mod3(I * u2);
    const Dy = mod3(I * Dx * v);
    let x = mod3((s2 + s2) * Dx);
    if (isNegativeLE(x, P))
      x = mod3(-x);
    const y = mod3(u1 * Dy);
    const t = mod3(x * y);
    if (!isValid2 || isNegativeLE(t, P) || y === _0n6)
      throw new Error("invalid ristretto255 encoding 2");
    return new __RistrettoPoint(new ed25519.Point(x, y, _1n6, t));
  }
  /**
   * Converts ristretto-encoded string to ristretto point.
   * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-decode).
   * @param hex Ristretto-encoded 32 bytes. Not every 32-byte string is valid ristretto encoding
   */
  static fromHex(hex) {
    return __RistrettoPoint.fromBytes(ensureBytes("ristrettoHex", hex, 32));
  }
  static msm(points, scalars) {
    return pippenger(__RistrettoPoint, ed25519.Point.Fn, points, scalars);
  }
  /**
   * Encodes ristretto point to Uint8Array.
   * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-encode).
   */
  toBytes() {
    let { X, Y, Z, T } = this.ep;
    const P = ed25519_CURVE_p;
    const mod3 = (n) => Fp.create(n);
    const u1 = mod3(mod3(Z + Y) * mod3(Z - Y));
    const u2 = mod3(X * Y);
    const u2sq = mod3(u2 * u2);
    const { value: invsqrt } = invertSqrt(mod3(u1 * u2sq));
    const D1 = mod3(invsqrt * u1);
    const D2 = mod3(invsqrt * u2);
    const zInv = mod3(D1 * D2 * T);
    let D;
    if (isNegativeLE(T * zInv, P)) {
      let _x = mod3(Y * SQRT_M1);
      let _y = mod3(X * SQRT_M1);
      X = _x;
      Y = _y;
      D = mod3(D1 * INVSQRT_A_MINUS_D);
    } else {
      D = D2;
    }
    if (isNegativeLE(X * zInv, P))
      Y = mod3(-Y);
    let s2 = mod3((Z - Y) * D);
    if (isNegativeLE(s2, P))
      s2 = mod3(-s2);
    return Fp.toBytes(s2);
  }
  /**
   * Compares two Ristretto points.
   * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-equals).
   */
  equals(other) {
    this.assertSame(other);
    const { X: X1, Y: Y1 } = this.ep;
    const { X: X2, Y: Y2 } = other.ep;
    const mod3 = (n) => Fp.create(n);
    const one = mod3(X1 * Y2) === mod3(Y1 * X2);
    const two = mod3(Y1 * Y2) === mod3(X1 * X2);
    return one || two;
  }
  is0() {
    return this.equals(__RistrettoPoint.ZERO);
  }
};
_RistrettoPoint.BASE = /* @__PURE__ */ (() => new _RistrettoPoint(ed25519.Point.BASE))();
_RistrettoPoint.ZERO = /* @__PURE__ */ (() => new _RistrettoPoint(ed25519.Point.ZERO))();
_RistrettoPoint.Fp = /* @__PURE__ */ (() => Fp)();
_RistrettoPoint.Fn = /* @__PURE__ */ (() => Fn)();

// ../../node_modules/.pnpm/@lukeburns+clatterjs@1.0.0/node_modules/@lukeburns/clatterjs/dist/constants.js
var MAX_KEY_LEN = 32;
var MAX_TAG_LEN = 16;
var MAX_MESSAGE_LEN = 65535;
var PSK_LEN = 32;
var MAX_PSKS = 4;
var MAX_TOKENS_PER_HS_MESSAGE = 8;
var MAX_HS_MESSAGES_PER_ROLE = 8;
var HYBRID_DUAL_LAYER = new TextEncoder().encode("clatter.hybrid_dual_layer.outer");

// ../../node_modules/.pnpm/@lukeburns+clatterjs@1.0.0/node_modules/@lukeburns/clatterjs/dist/errors.js
var CipherError = class extends Error {
  code;
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
    this.name = "CipherError";
  }
};
var HandshakeError = class extends Error {
  code;
  causeErr;
  constructor(code, message, causeErr) {
    super(message ?? code);
    this.code = code;
    this.causeErr = causeErr;
    this.name = "HandshakeError";
  }
};
var PatternError = class extends Error {
  kind;
  constructor(kind, message) {
    super(message ?? kind);
    this.kind = kind;
    this.name = "PatternError";
  }
};
var TransportError = class extends Error {
  code;
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
    this.name = "TransportError";
  }
};

// ../../node_modules/.pnpm/@lukeburns+clatterjs@1.0.0/node_modules/@lukeburns/clatterjs/dist/handshakePattern.js
function checkMsgLens(initiator, responder) {
  for (const g of initiator) {
    if (g.length > MAX_TOKENS_PER_HS_MESSAGE) {
      throw new Error("Too many tokens in one handshake message");
    }
  }
  for (const g of responder) {
    if (g.length > MAX_TOKENS_PER_HS_MESSAGE) {
      throw new Error("Too many tokens in one handshake message");
    }
  }
  if (initiator.length > MAX_HS_MESSAGES_PER_ROLE || responder.length > MAX_HS_MESSAGES_PER_ROLE) {
    throw new Error("Too many handshake messages per role");
  }
}
function hasKemTokens(m) {
  const k = (tok) => tok === 6 || tok === 7;
  return m.initiator.some((g) => g.some(k)) || m.responder.some((g) => g.some(k));
}
function hasDhTokens(m) {
  const k = (tok) => tok === 2 || tok === 3 || tok === 4 || tok === 5;
  return m.initiator.some((g) => g.some(k)) || m.responder.some((g) => g.some(k));
}
function messagePatternHasPsk(m) {
  return m.initiator.some((g) => g.includes(
    8
    /* Token.Psk */
  )) || m.responder.some((g) => g.includes(
    8
    /* Token.Psk */
  ));
}
function validatePqTokenOrderRule(messages) {
  for (const message of messages) {
    let skemSeen = false;
    let publicKeySeen = false;
    for (const token of message) {
      if (token === 6) {
        if (publicKeySeen)
          throw new PatternError("PqTokenOrderViolation");
        if (skemSeen)
          throw new PatternError("PqTokenOrderViolation");
      } else if (token === 7) {
        skemSeen = true;
        if (publicKeySeen)
          throw new PatternError("PqTokenOrderViolation");
      } else if (token === 0 || token === 1) {
        publicKeySeen = true;
      }
    }
  }
}
function validatePskRule(messages) {
  let pskSent = false;
  for (const message of messages) {
    for (const token of message) {
      if (token === 8) {
        pskSent = true;
      } else if (token === 0 || token === 6) {
        return;
      } else if (token === 7) {
        if (pskSent)
          throw new PatternError("PskValidityViolation");
        return;
      } else if (token === 1) {
        if (pskSent)
          throw new PatternError("PskValidityViolation");
      }
    }
  }
}
var HandshakePattern = class _HandshakePattern {
  name;
  hasPskFlag;
  hsType;
  preInitiator;
  preResponder;
  messagePattern;
  constructor(name2, preInitiator, preResponder, initiator, responder) {
    this.name = name2;
    checkMsgLens(initiator, responder);
    this.preInitiator = [...preInitiator];
    this.preResponder = [...preResponder];
    this.messagePattern = {
      initiator: initiator.map((a) => [...a]),
      responder: responder.map((a) => [...a])
    };
    const hasKem = hasKemTokens(this.messagePattern);
    const hasDh = hasDhTokens(this.messagePattern);
    if (hasKem && hasDh) {
      this.hsType = 2;
    } else if (hasKem) {
      this.hsType = 1;
    } else if (hasDh) {
      this.hsType = 0;
    } else {
      throw new Error("Invalid handshake pattern");
    }
    this.hasPskFlag = messagePatternHasPsk(this.messagePattern);
    if (this.hasPskFlag) {
      validatePskRule(this.messagePattern.initiator);
      validatePskRule(this.messagePattern.responder);
    }
    if (hasKem) {
      validatePqTokenOrderRule(this.messagePattern.initiator);
      validatePqTokenOrderRule(this.messagePattern.responder);
    }
  }
  getMessagePattern() {
    return this.messagePattern;
  }
  getInitiatorPatternLen() {
    return this.messagePattern.initiator.length;
  }
  getResponderPatternLen() {
    return this.messagePattern.responder.length;
  }
  getInitiatorPreShared() {
    return this.preInitiator;
  }
  getResponderPreShared() {
    return this.preResponder;
  }
  getInitiatorPattern(i) {
    return this.messagePattern.initiator[i] ?? [];
  }
  getResponderPattern(i) {
    return this.messagePattern.responder[i] ?? [];
  }
  hasPsk() {
    return this.hasPskFlag;
  }
  getName() {
    return this.name;
  }
  isOneWay() {
    return this.messagePattern.responder.length === 0;
  }
  getType() {
    return this.hsType;
  }
  addPsks(positions, newName) {
    const initiator = this.messagePattern.initiator.map((a) => [...a]);
    const responder = this.messagePattern.responder.map((a) => [...a]);
    for (const pos of positions) {
      if (pos === 0) {
        (initiator[0] ??= []).unshift(
          8
          /* Token.Psk */
        );
      } else if (pos % 2 === 0) {
        const r = pos / 2 - 1;
        (responder[r] ??= []).push(
          8
          /* Token.Psk */
        );
      } else {
        const ii = (pos - 1) / 2;
        (initiator[ii] ??= []).push(
          8
          /* Token.Psk */
        );
      }
    }
    return new _HandshakePattern(newName, this.preInitiator, this.preResponder, initiator, responder);
  }
};

// ../../node_modules/.pnpm/@lukeburns+clatterjs@1.0.0/node_modules/@lukeburns/clatterjs/dist/cipherState.js
var U64_MAX = 0xfffffffffffffffn;
var CipherState = class {
  C;
  key;
  n = 0n;
  overflowed = false;
  constructor(C, k, startNonce) {
    this.C = C;
    this.key = Uint8Array.from(k);
    this.n = startNonce;
  }
  getNonce() {
    return this.n;
  }
  setNonce(n) {
    this.n = n;
  }
  /**
   * Return a copy of the underlying AEAD key. Intended for adapters that need to
   * hand the raw key material to a separate cipher implementation (e.g. the
   * classical noise-handshake `Cipher` class). Handle with care.
   */
  getKey() {
    return Uint8Array.from(this.key);
  }
  encryptWithAd(ad, plaintext, out) {
    if (this.overflowed)
      throw new CipherError("NonceOverflow");
    this.C.encrypt(this.key, this.n, ad, plaintext, out);
    this.bumpNonce();
  }
  encryptWithAdInPlace(ad, inOut, plaintextLen) {
    if (this.overflowed)
      throw new CipherError("NonceOverflow");
    const len = this.C.encryptInPlace(this.key, this.n, ad, inOut, plaintextLen);
    this.bumpNonce();
    return len;
  }
  decryptWithAd(ad, ciphertext, out) {
    if (this.overflowed)
      throw new CipherError("NonceOverflow");
    this.C.decrypt(this.key, this.n, ad, ciphertext, out);
    this.bumpNonce();
  }
  decryptWithAdInPlace(ad, inOut, ciphertextLen) {
    if (this.overflowed)
      throw new CipherError("NonceOverflow");
    const len = this.C.decryptInPlace(this.key, this.n, ad, inOut, ciphertextLen);
    this.bumpNonce();
    return len;
  }
  rekey() {
    this.key.set(this.C.rekey(this.key));
  }
  bumpNonce() {
    if (this.n === U64_MAX) {
      this.overflowed = true;
      return;
    }
    this.n += 1n;
  }
};
var CipherStates = class {
  initiatorToResponder;
  responderToInitiator;
  constructor(initiatorToResponder, responderToInitiator) {
    this.initiatorToResponder = initiatorToResponder;
    this.responderToInitiator = responderToInitiator;
  }
};

// ../../node_modules/.pnpm/@lukeburns+clatterjs@1.0.0/node_modules/@lukeburns/clatterjs/dist/symmetricState.js
function deriveCipherKey(temp, C) {
  return temp.slice(0, C.keyLen);
}
var SymmetricState = class {
  C;
  H;
  cipherstate;
  h;
  ck;
  constructor(C, H, noisePatternName) {
    this.C = C;
    this.H = H;
    const nb = new TextEncoder().encode(noisePatternName);
    this.h = H.newOutput();
    this.ck = H.newOutput();
    this.h.fill(0);
    if (nb.length <= H.hashLen) {
      this.h.set(nb, 0);
    } else {
      this.h.set(H.hash(nb).subarray(0, H.hashLen));
    }
    this.ck.set(this.h);
  }
  mixHash(data) {
    this.h.set(this.H.hash(concat(this.h, data)).subarray(0, this.H.hashLen));
  }
  mixKey(inputKeyMaterial) {
    const [ck, temp] = this.H.hkdf(this.ck, inputKeyMaterial);
    this.ck.set(ck.subarray(0, this.H.hashLen));
    const k = deriveCipherKey(temp, this.C);
    this.cipherstate = new CipherState(this.C, k, 0n);
  }
  mixKeyAndHash(inputKeyMaterial) {
    const [ck, tempH, tempK] = this.H.hkdf3(this.ck, inputKeyMaterial);
    this.ck.set(ck.subarray(0, this.H.hashLen));
    this.mixHash(tempH);
    const k = deriveCipherKey(tempK, this.C);
    this.cipherstate = new CipherState(this.C, k, 0n);
  }
  encryptAndHash(plaintext, out) {
    if (this.cipherstate) {
      this.cipherstate.encryptWithAd(this.h, plaintext, out);
    } else {
      out.set(plaintext);
    }
    this.mixHash(out);
  }
  decryptAndHash(data, out) {
    if (this.cipherstate) {
      this.cipherstate.decryptWithAd(this.h, data, out);
    } else {
      out.set(data);
    }
    this.mixHash(data);
  }
  split() {
    if (!this.hasKey()) {
      throw new CipherError("MissingKeyMaterial");
    }
    const [t1, t2] = this.H.hkdf(this.ck, new Uint8Array(0));
    const k1 = deriveCipherKey(t1, this.C);
    const k2 = deriveCipherKey(t2, this.C);
    return new CipherStates(new CipherState(this.C, k1, 0n), new CipherState(this.C, k2, 0n));
  }
  getHash() {
    return Uint8Array.from(this.h);
  }
  getChainingKey() {
    return Uint8Array.from(this.ck);
  }
  hasKey() {
    return this.cipherstate !== void 0;
  }
  zeroize() {
    this.h.fill(0);
    this.ck.fill(0);
    this.cipherstate = void 0;
  }
};
function concat(a, b) {
  const o = new Uint8Array(a.length + b.length);
  o.set(a, 0);
  o.set(b, a.length);
  return o;
}

// ../../node_modules/.pnpm/@lukeburns+clatterjs@1.0.0/node_modules/@lukeburns/clatterjs/dist/transportState.js
function mapCipher(e) {
  if (e instanceof TransportError)
    return e;
  if (e instanceof CipherError) {
    return new TransportError("Cipher", e.message);
  }
  throw e;
}
var TransportState = class {
  pattern;
  cipherStates;
  h;
  initiator;
  tagLen;
  constructor(p) {
    this.pattern = p.pattern;
    this.cipherStates = p.cipherStates;
    this.h = p.handshakeHash;
    this.initiator = p.initiator;
    this.tagLen = p.tagLen;
  }
  getHandshakeHash() {
    return this.h;
  }
  /** clatter: `get_handshake_hash` */
  getHandshakeHashValue() {
    return this.h;
  }
  send(msg, buf) {
    const t = this.tagLen;
    const n = msg.length + t;
    if (n > MAX_MESSAGE_LEN) {
      throw new Error("Maximum Noise message length exceeded");
    }
    if (buf.length < n) {
      throw new TransportError("BufferTooSmall");
    }
    if (this.pattern.isOneWay() && !this.initiator) {
      throw new TransportError("OneWayViolation");
    }
    const c = this.outCipher();
    try {
      c.encryptWithAd(new Uint8Array(0), msg, buf.subarray(0, n));
    } catch (e) {
      throw mapCipher(e);
    }
    return n;
  }
  sendInPlace(msg, msgLen) {
    const t = this.tagLen;
    const n = msgLen + t;
    if (n > MAX_MESSAGE_LEN) {
      throw new Error("Maximum Noise message length exceeded");
    }
    if (msg.length < n) {
      throw new TransportError("BufferTooSmall");
    }
    if (this.pattern.isOneWay() && !this.initiator) {
      throw new TransportError("OneWayViolation");
    }
    const c = this.outCipher();
    try {
      return c.encryptWithAdInPlace(new Uint8Array(0), msg, msgLen);
    } catch (e) {
      throw mapCipher(e);
    }
  }
  sendVec(msg) {
    const t = this.tagLen;
    const out = new Uint8Array(msg.length + t);
    this.send(msg, out);
    return out;
  }
  receive(msg, out) {
    const t = this.tagLen;
    if (msg.length < t) {
      throw new TransportError("TooShort");
    }
    if (msg.length > MAX_MESSAGE_LEN) {
      throw new Error("Maximum Noise message length exceeded");
    }
    if (this.pattern.isOneWay() && this.initiator) {
      throw new TransportError("OneWayViolation");
    }
    const c = this.inCipher();
    const pLen = msg.length - t;
    if (out.length < pLen) {
      throw new TransportError("BufferTooSmall");
    }
    try {
      c.decryptWithAd(new Uint8Array(0), msg, out.subarray(0, pLen));
    } catch (e) {
      throw mapCipher(e);
    }
    return pLen;
  }
  receiveInPlace(msg, msgLen) {
    const t = this.tagLen;
    if (msgLen < t) {
      throw new TransportError("TooShort");
    }
    if (msgLen > MAX_MESSAGE_LEN) {
      throw new Error("Maximum Noise message length exceeded");
    }
    if (msgLen > msg.length) {
      throw new TransportError("BufferTooSmall");
    }
    if (this.pattern.isOneWay() && this.initiator) {
      throw new TransportError("OneWayViolation");
    }
    const c = this.inCipher();
    try {
      return c.decryptWithAdInPlace(new Uint8Array(0), msg, msgLen);
    } catch (e) {
      throw mapCipher(e);
    }
  }
  receiveVec(msg) {
    const t = this.tagLen;
    const out = new Uint8Array(msg.length - t);
    this.receive(msg, out);
    return out;
  }
  sendingNonce() {
    return this.outCipher().getNonce();
  }
  receivingNonce() {
    return this.inCipher().getNonce();
  }
  setReceivingNonce(n) {
    this.inCipher().setNonce(n);
  }
  rekeySender() {
    try {
      this.outCipher().rekey();
    } catch (e) {
      throw mapCipher(e);
    }
  }
  rekeyReceiver() {
    try {
      this.inCipher().rekey();
    } catch (e) {
      throw mapCipher(e);
    }
  }
  /**
   * clatter: `TransportState::take` — returns the cipher states (same session keys; transport
   * methods remain usable, matching Rust move semantics in spirit).
   */
  takeCiphers() {
    return this.cipherStates;
  }
  outCipher() {
    return this.initiator ? this.cipherStates.initiatorToResponder : this.cipherStates.responderToInitiator;
  }
  inCipher() {
    return this.initiator ? this.cipherStates.responderToInitiator : this.cipherStates.initiatorToResponder;
  }
};

// ../../node_modules/.pnpm/@noble+hashes@2.3.0/node_modules/@noble/hashes/_u64.js
var U32_MASK642 = /* @__PURE__ */ (() => BigInt(2 ** 32 - 1))();
var _32n2 = /* @__PURE__ */ BigInt(32);
function fromBig2(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK642), l: Number(n >> _32n2 & U32_MASK642) };
  return { h: Number(n >> _32n2 & U32_MASK642) | 0, l: Number(n & U32_MASK642) | 0 };
}
function split2(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig2(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var fromNumH = (n) => n / 2 ** 32 | 0;
var fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE3) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view.setUint32(byteOffset, isLE3 ? l : h, isLE3);
  view.setUint32(byteOffset + 4, isLE3 ? h : l, isLE3);
}
var shrSH2 = (h, _l, s2) => h >>> s2;
var shrSL2 = (h, l, s2) => h << 32 - s2 | l >>> s2;
var rotrSH2 = (h, l, s2) => h >>> s2 | l << 32 - s2;
var rotrSL2 = (h, l, s2) => h << 32 - s2 | l >>> s2;
var rotrBH2 = (h, l, s2) => h << 64 - s2 | l >>> s2 - 32;
var rotrBL2 = (h, l, s2) => h >>> s2 - 32 | l << 64 - s2;
var rotr32H = (_h, l) => l;
var rotr32L = (h, _l) => h;
function add2(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L2 = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H2 = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
var add4L2 = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
var add4H2 = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
var add5L2 = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
var add5H2 = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

// ../../node_modules/.pnpm/@noble+hashes@2.3.0/node_modules/@noble/hashes/utils.js
function isBytes2(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function anumber2(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes2(value, length, title = "") {
  if (isBytes2(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber2(length, "length");
  const bytes = isBytes2(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function copyBytes2(bytes) {
  return Uint8Array.from(abytes2(bytes));
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("expected hash wrapped by utils.createHasher");
  anumber2(h.outputLen);
  anumber2(h.blockLen);
  if (h.outputLen < 1 || h.blockLen < 1)
    throw new Error("hash blockLen / outputLen must be >= 1");
}
var aobject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
function aexists2(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput2(out, instance) {
  abytes2(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean2(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView2(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr2(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
var swap8IfBE = isLE ? (n) => n : (n) => byteSwap(n) >>> 0;
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
var hasHexBuiltin2 = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes2 = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex2(bytes) {
  abytes2(bytes);
  if (hasHexBuiltin2)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes2[bytes[i]];
  }
  return hex;
}
function asciiToBase162(ch) {
  return ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - (65 - 10) : ch >= 97 && ch <= 102 ? ch - (97 - 10) : void 0;
}
function hexToBytes2(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  if (hasHexBuiltin2) {
    try {
      return Uint8Array.fromHex(hex);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RangeError(error.message);
      throw error;
    }
  }
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  const array3 = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase162(hex.charCodeAt(hi));
    const n2 = asciiToBase162(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array3[ai] = n1 * 16 + n2;
  }
  return array3;
}
function concatBytes2(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes2(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function checkOpts(defaults, opts, title = "opts") {
  aobject(defaults, "defaults");
  if (opts !== void 0)
    aobject(opts, title);
  const merged = Object.assign(defaults, opts);
  return merged;
}
function createHasher2(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes3(bytesLength = 32) {
  anumber2(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// ../../node_modules/.pnpm/@noble+hashes@2.3.0/node_modules/@noble/hashes/_md.js
function Chi2(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj2(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD2 = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE3) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE3;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView2(this.buffer);
  }
  update(data) {
    aexists2(this);
    abytes2(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView2(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE3 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum(view, blockLen - 8, this.length * 8, isLE3);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView2(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE3);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV2 = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA512_IV2 = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  4089235720,
  3144134277,
  2227873595,
  1013904242,
  4271175723,
  2773480762,
  1595750129,
  1359893119,
  2917565137,
  2600822924,
  725511199,
  528734635,
  4215389547,
  1541459225,
  327033209
]);

// ../../node_modules/.pnpm/@noble+hashes@2.3.0/node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD2 {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and makes sha256 3x slower (measured).
  A = 0;
  B = 0;
  C = 0;
  D = 0;
  E = 0;
  F = 0;
  G = 0;
  H = 0;
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr2(W15, 7) ^ rotr2(W15, 18) ^ W15 >>> 3;
      const s1 = rotr2(W2, 17) ^ rotr2(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr2(E, 6) ^ rotr2(E, 11) ^ rotr2(E, 25);
      const T1 = H + sigma1 + Chi2(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr2(A, 2) ^ rotr2(A, 13) ^ rotr2(A, 22);
      const T2 = sigma0 + Maj2(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean2(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean2(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  constructor() {
    super(32, SHA256_IV2);
  }
};
var K5122 = /* @__PURE__ */ (() => split2([
  "0x428a2f98d728ae22",
  "0x7137449123ef65cd",
  "0xb5c0fbcfec4d3b2f",
  "0xe9b5dba58189dbbc",
  "0x3956c25bf348b538",
  "0x59f111f1b605d019",
  "0x923f82a4af194f9b",
  "0xab1c5ed5da6d8118",
  "0xd807aa98a3030242",
  "0x12835b0145706fbe",
  "0x243185be4ee4b28c",
  "0x550c7dc3d5ffb4e2",
  "0x72be5d74f27b896f",
  "0x80deb1fe3b1696b1",
  "0x9bdc06a725c71235",
  "0xc19bf174cf692694",
  "0xe49b69c19ef14ad2",
  "0xefbe4786384f25e3",
  "0x0fc19dc68b8cd5b5",
  "0x240ca1cc77ac9c65",
  "0x2de92c6f592b0275",
  "0x4a7484aa6ea6e483",
  "0x5cb0a9dcbd41fbd4",
  "0x76f988da831153b5",
  "0x983e5152ee66dfab",
  "0xa831c66d2db43210",
  "0xb00327c898fb213f",
  "0xbf597fc7beef0ee4",
  "0xc6e00bf33da88fc2",
  "0xd5a79147930aa725",
  "0x06ca6351e003826f",
  "0x142929670a0e6e70",
  "0x27b70a8546d22ffc",
  "0x2e1b21385c26c926",
  "0x4d2c6dfc5ac42aed",
  "0x53380d139d95b3df",
  "0x650a73548baf63de",
  "0x766a0abb3c77b2a8",
  "0x81c2c92e47edaee6",
  "0x92722c851482353b",
  "0xa2bfe8a14cf10364",
  "0xa81a664bbc423001",
  "0xc24b8b70d0f89791",
  "0xc76c51a30654be30",
  "0xd192e819d6ef5218",
  "0xd69906245565a910",
  "0xf40e35855771202a",
  "0x106aa07032bbd1b8",
  "0x19a4c116b8d2d0c8",
  "0x1e376c085141ab53",
  "0x2748774cdf8eeb99",
  "0x34b0bcb5e19b48a8",
  "0x391c0cb3c5c95a63",
  "0x4ed8aa4ae3418acb",
  "0x5b9cca4f7763e373",
  "0x682e6ff3d6b2b8a3",
  "0x748f82ee5defb2fc",
  "0x78a5636f43172f60",
  "0x84c87814a1f0ab72",
  "0x8cc702081a6439ec",
  "0x90befffa23631e28",
  "0xa4506cebde82bde9",
  "0xbef9a3f7b2c67915",
  "0xc67178f2e372532b",
  "0xca273eceea26619c",
  "0xd186b8c721c0c207",
  "0xeada7dd6cde0eb1e",
  "0xf57d4f7fee6ed178",
  "0x06f067aa72176fba",
  "0x0a637dc5a2c898a6",
  "0x113f9804bef90dae",
  "0x1b710b35131c471b",
  "0x28db77f523047d84",
  "0x32caab7b40c72493",
  "0x3c9ebe0a15c9bebc",
  "0x431d67c49c100d4c",
  "0x4cc5d4becb3e42b6",
  "0x597f299cfc657e2a",
  "0x5fcb6fab3ad6faec",
  "0x6c44198c4a475817"
].map((n) => BigInt(n))))();
var SHA512_Kh2 = /* @__PURE__ */ (() => K5122[0])();
var SHA512_Kl2 = /* @__PURE__ */ (() => K5122[1])();
var SHA512_W_H2 = /* @__PURE__ */ new Uint32Array(80);
var SHA512_W_L2 = /* @__PURE__ */ new Uint32Array(80);
var SHA2_64B = class extends HashMD2 {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // h -- high 32 bits, l -- low 32 bits
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and slows hashing down (measured on sha256).
  Ah = 0;
  Al = 0;
  Bh = 0;
  Bl = 0;
  Ch = 0;
  Cl = 0;
  Dh = 0;
  Dl = 0;
  Eh = 0;
  El = 0;
  Fh = 0;
  Fl = 0;
  Gh = 0;
  Gl = 0;
  Hh = 0;
  Hl = 0;
  constructor(outputLen, IV) {
    super(128, outputLen, 16, false);
    this.Ah = IV[0] | 0;
    this.Al = IV[1] | 0;
    this.Bh = IV[2] | 0;
    this.Bl = IV[3] | 0;
    this.Ch = IV[4] | 0;
    this.Cl = IV[5] | 0;
    this.Dh = IV[6] | 0;
    this.Dl = IV[7] | 0;
    this.Eh = IV[8] | 0;
    this.El = IV[9] | 0;
    this.Fh = IV[10] | 0;
    this.Fl = IV[11] | 0;
    this.Gh = IV[12] | 0;
    this.Gl = IV[13] | 0;
    this.Hh = IV[14] | 0;
    this.Hl = IV[15] | 0;
  }
  // prettier-ignore
  get() {
    const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
  }
  // prettier-ignore
  set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
    this.Ah = Ah | 0;
    this.Al = Al | 0;
    this.Bh = Bh | 0;
    this.Bl = Bl | 0;
    this.Ch = Ch | 0;
    this.Cl = Cl | 0;
    this.Dh = Dh | 0;
    this.Dl = Dl | 0;
    this.Eh = Eh | 0;
    this.El = El | 0;
    this.Fh = Fh | 0;
    this.Fl = Fl | 0;
    this.Gh = Gh | 0;
    this.Gl = Gl | 0;
    this.Hh = Hh | 0;
    this.Hl = Hl | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4) {
      SHA512_W_H2[i] = view.getUint32(offset);
      SHA512_W_L2[i] = view.getUint32(offset += 4);
    }
    for (let i = 16; i < 80; i++) {
      const W15h = SHA512_W_H2[i - 15] | 0;
      const W15l = SHA512_W_L2[i - 15] | 0;
      const s0h = rotrSH2(W15h, W15l, 1) ^ rotrSH2(W15h, W15l, 8) ^ shrSH2(W15h, W15l, 7);
      const s0l = rotrSL2(W15h, W15l, 1) ^ rotrSL2(W15h, W15l, 8) ^ shrSL2(W15h, W15l, 7);
      const W2h = SHA512_W_H2[i - 2] | 0;
      const W2l = SHA512_W_L2[i - 2] | 0;
      const s1h = rotrSH2(W2h, W2l, 19) ^ rotrBH2(W2h, W2l, 61) ^ shrSH2(W2h, W2l, 6);
      const s1l = rotrSL2(W2h, W2l, 19) ^ rotrBL2(W2h, W2l, 61) ^ shrSL2(W2h, W2l, 6);
      const SUMl = add4L2(s0l, s1l, SHA512_W_L2[i - 7], SHA512_W_L2[i - 16]);
      const SUMh = add4H2(SUMl, s0h, s1h, SHA512_W_H2[i - 7], SHA512_W_H2[i - 16]);
      SHA512_W_H2[i] = SUMh | 0;
      SHA512_W_L2[i] = SUMl | 0;
    }
    let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
    for (let i = 0; i < 80; i++) {
      const sigma1h = rotrSH2(Eh, El, 14) ^ rotrSH2(Eh, El, 18) ^ rotrBH2(Eh, El, 41);
      const sigma1l = rotrSL2(Eh, El, 14) ^ rotrSL2(Eh, El, 18) ^ rotrBL2(Eh, El, 41);
      const CHIh = Eh & Fh ^ ~Eh & Gh;
      const CHIl = El & Fl ^ ~El & Gl;
      const T1ll = add5L2(Hl, sigma1l, CHIl, SHA512_Kl2[i], SHA512_W_L2[i]);
      const T1h = add5H2(T1ll, Hh, sigma1h, CHIh, SHA512_Kh2[i], SHA512_W_H2[i]);
      const T1l = T1ll | 0;
      const sigma0h = rotrSH2(Ah, Al, 28) ^ rotrBH2(Ah, Al, 34) ^ rotrBH2(Ah, Al, 39);
      const sigma0l = rotrSL2(Ah, Al, 28) ^ rotrBL2(Ah, Al, 34) ^ rotrBL2(Ah, Al, 39);
      const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
      const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
      Hh = Gh | 0;
      Hl = Gl | 0;
      Gh = Fh | 0;
      Gl = Fl | 0;
      Fh = Eh | 0;
      Fl = El | 0;
      ({ h: Eh, l: El } = add2(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
      Dh = Ch | 0;
      Dl = Cl | 0;
      Ch = Bh | 0;
      Cl = Bl | 0;
      Bh = Ah | 0;
      Bl = Al | 0;
      const All = add3L2(T1l, sigma0l, MAJl);
      Ah = add3H2(All, T1h, sigma0h, MAJh);
      Al = All | 0;
    }
    ({ h: Ah, l: Al } = add2(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
    ({ h: Bh, l: Bl } = add2(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
    ({ h: Ch, l: Cl } = add2(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
    ({ h: Dh, l: Dl } = add2(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
    ({ h: Eh, l: El } = add2(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
    ({ h: Fh, l: Fl } = add2(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
    ({ h: Gh, l: Gl } = add2(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
    ({ h: Hh, l: Hl } = add2(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
    this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
  }
  roundClean() {
    clean2(SHA512_W_H2, SHA512_W_L2);
  }
  destroy() {
    this.destroyed = true;
    clean2(this.buffer);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var _SHA512 = class extends SHA2_64B {
  constructor() {
    super(64, SHA512_IV2);
  }
};
var sha256 = /* @__PURE__ */ createHasher2(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);
var sha5122 = /* @__PURE__ */ createHasher2(
  () => new _SHA512(),
  /* @__PURE__ */ oidNist(3)
);

// ../../node_modules/.pnpm/@noble+curves@2.3.0/node_modules/@noble/curves/utils.js
function aarray(item, title, inner = () => {
}) {
  if (!Array.isArray(item))
    throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
  for (let i = 0; i < item.length; i++)
    inner(item[i], `${title}[${i}]`);
  return item;
}
var abytes3 = (value, length, title) => abytes2(value, length, title);
var anumber3 = anumber2;
function aobject2(value, title = "object") {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
  return value;
}
function afunction(value, title) {
  if (typeof value !== "function")
    throw new TypeError(`"${title}" is invalid: expected function, got ${typeof value}`);
  return value;
}
var bytesToHex3 = bytesToHex2;
var hexToBytes3 = (hex) => hexToBytes2(hex);
var isBytes3 = isBytes2;
var randomBytes4 = (bytesLength) => randomBytes3(bytesLength);
var _0n7 = /* @__PURE__ */ BigInt(0);
var _1n7 = /* @__PURE__ */ BigInt(1);
var atitle2 = (title) => title ? `"${title}" ` : "";
function abool(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle2(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abignumber(n) {
  if (typeof n === "bigint") {
    if (!isPosBig2(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber3(n);
  return n;
}
function asafenumber(value, title = "") {
  if (typeof value !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    const prefix = title && `"${title}" `;
    throw new RangeError(prefix + "expected safe integer, got " + value);
  }
}
function hexToNumber2(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  return hex === "" ? _0n7 : BigInt("0x" + hex);
}
function bytesToNumberBE2(bytes) {
  return hexToNumber2(bytesToHex2(bytes));
}
function bytesToNumberLE2(bytes) {
  return hexToNumber2(bytesToHex2(copyBytes3(abytes2(bytes)).reverse()));
}
function numberToBytesBE2(n, len) {
  anumber2(len);
  if (len === 0)
    throw new Error("zero output length is invalid");
  n = abignumber(n);
  const expectedLen = len * 2;
  const hex = n.toString(16);
  if (hex.length > expectedLen)
    throw new RangeError("number is too large");
  return hexToBytes2(hex.padStart(expectedLen, "0"));
}
function numberToBytesLE2(n, len) {
  return numberToBytesBE2(n, len).reverse();
}
function copyBytes3(bytes) {
  return Uint8Array.from(abytes3(bytes));
}
function isPosBig2(n) {
  return typeof n === "bigint" && _0n7 <= n;
}
function inRange2(n, min, max) {
  return isPosBig2(n) && isPosBig2(min) && isPosBig2(max) && min <= n && n < max;
}
function aInRange2(title, n, min, max) {
  if (!inRange2(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen2(n) {
  if (n < _0n7)
    throw new Error("expected non-negative bigint, got " + n);
  return n === _0n7 ? 0 : n.toString(2).length;
}
var bitMask2 = (n) => {
  asafenumber(n, "n");
  return (_1n7 << BigInt(n)) - _1n7;
};
function validateObject2(object, fields = {}, optFields = {}, title = "object") {
  aobject2(object, title);
  aobject2(fields, "fields");
  aobject2(optFields, "optFields");
  function checkField(fieldName, expectedType, isOpt) {
    const label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`;
    const val = object[fieldName];
    if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== void 0 : expectedType !== "function")) {
      throw new TypeError(`${label} is invalid: expected own property`);
    }
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}

// ../../node_modules/.pnpm/@noble+curves@2.3.0/node_modules/@noble/curves/abstract/modular.js
var _0n8 = /* @__PURE__ */ BigInt(0);
var _1n8 = /* @__PURE__ */ BigInt(1);
var _2n5 = /* @__PURE__ */ BigInt(2);
var _3n3 = /* @__PURE__ */ BigInt(3);
var _4n2 = /* @__PURE__ */ BigInt(4);
var _5n3 = /* @__PURE__ */ BigInt(5);
var _7n2 = /* @__PURE__ */ BigInt(7);
var _8n4 = /* @__PURE__ */ BigInt(8);
var _9n2 = /* @__PURE__ */ BigInt(9);
var _15n = /* @__PURE__ */ BigInt(15);
var _16n2 = /* @__PURE__ */ BigInt(16);
var POW_WINDOWED_MIN = /* @__PURE__ */ BigInt("0x10000000000000000");
function mod2(a, b) {
  if (b <= _0n8)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n8 ? result : b + result;
}
function pow(num, power, modulo) {
  if (modulo <= _1n8)
    throw new Error("pow: expected modulus > 1, got " + modulo);
  if (typeof power !== "bigint")
    throw new TypeError("invalid exponent: expected bigint, got " + typeof power);
  if (power < _0n8)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n8)
    return _1n8;
  if (power === _1n8)
    return num;
  let d = num % modulo;
  if (d < _0n8)
    d += modulo;
  if (power < POW_WINDOWED_MIN) {
    let p2 = _1n8;
    while (power > _0n8) {
      if (power & _1n8)
        p2 = p2 * d % modulo;
      d = d * d % modulo;
      power >>= _1n8;
    }
    return p2;
  }
  const digits = [];
  while (power > _0n8) {
    digits.push(Number(power & _15n));
    power >>= _4n2;
  }
  const table = new Array(16);
  table[0] = _1n8;
  table[1] = d;
  for (let i = 2; i < 16; i++)
    table[i] = table[i - 1] * d % modulo;
  let p = table[digits[digits.length - 1]];
  for (let w = digits.length - 2; w >= 0; w--) {
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    const digit = digits[w];
    if (digit !== 0)
      p = p * table[digit] % modulo;
  }
  return p;
}
function pow22(x, power, modulo) {
  if (modulo <= _1n8)
    throw new Error("pow2: expected modulus > 1, got " + modulo);
  if (power < _0n8)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  while (power-- > _0n8) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert2(number, modulo) {
  if (number === _0n8)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _1n8)
    throw new Error("invert: expected modulus > 1, got " + modulo);
  let a = mod2(number, modulo);
  let b = modulo;
  let x = _0n8, u = _1n8;
  while (a !== _0n8) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    b = a, a = r, x = u, u = m;
  }
  const gcd = b;
  if (gcd !== _1n8)
    throw new Error("invert: does not exist");
  return mod2(x, modulo);
}
function assertIsSquare2(Fp2, root, n) {
  const F = Fp2;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function aoddModulus(order, fnName) {
  if ((order & _1n8) === _0n8)
    throw new Error(fnName + ": expected odd modulus, got " + order);
}
function sqrt3mod42(Fp2, n) {
  const F = Fp2;
  const p1div4 = (F.ORDER + _1n8) / _4n2;
  const root = F.pow(n, p1div4);
  assertIsSquare2(F, root, n);
  return root;
}
function sqrt5mod82(Fp2, n) {
  const F = Fp2;
  const p5div8 = (F.ORDER - _5n3) / _8n4;
  const n2 = F.mul(n, _2n5);
  const v = F.pow(n2, p5div8);
  const nv = F.mul(n, v);
  const i = F.mul(F.mul(nv, _2n5), v);
  const root = F.mul(nv, F.sub(i, F.ONE));
  assertIsSquare2(F, root, n);
  return root;
}
function sqrt9mod162(P) {
  const Fp_ = Field2(P);
  const tn = tonelliShanks2(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n2) / _16n2;
  return ((Fp2, n) => {
    const F = Fp2;
    let tv1 = F.pow(n, c4);
    let tv2 = F.mul(tv1, c1);
    const tv3 = F.mul(tv1, c2);
    const tv4 = F.mul(tv1, c3);
    const e1 = F.eql(F.sqr(tv2), n);
    const e2 = F.eql(F.sqr(tv3), n);
    tv1 = F.cmov(tv1, tv2, e1);
    tv2 = F.cmov(tv4, tv3, e2);
    const e3 = F.eql(F.sqr(tv2), n);
    const root = F.cmov(tv1, tv2, e3);
    assertIsSquare2(F, root, n);
    return root;
  });
}
function tonelliShanks2(P) {
  if (P < _3n3)
    throw new Error("sqrt is not defined for small field");
  aoddModulus(P, "tonelliShanks");
  let Q = P - _1n8;
  let S = 0;
  while (Q % _2n5 === _0n8) {
    Q /= _2n5;
    S++;
  }
  let Z = _2n5;
  const _Fp = Field2(P);
  while (FpLegendre2(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod42;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n8) / _2n5;
  return function tonelliSlow(Fp2, n) {
    const F = Fp2;
    if (F.is0(n))
      return n;
    if (FpLegendre2(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = F.mul(F.ONE, cc);
    let t = F.pow(n, Q);
    let R = F.pow(n, Q1div2);
    while (!F.eql(t, F.ONE)) {
      if (F.is0(t))
        throw new Error("Cannot find square root: probably non-prime P");
      let i = 1;
      let t_tmp = F.sqr(t);
      while (!F.eql(t_tmp, F.ONE)) {
        i++;
        t_tmp = F.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n8 << BigInt(M - i - 1);
      const b = F.pow(c, exponent);
      M = i;
      c = F.sqr(b);
      t = F.mul(t, c);
      R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt2(P) {
  aoddModulus(P, "Fp.sqrt");
  if (P % _4n2 === _3n3)
    return sqrt3mod42;
  if (P % _8n4 === _5n3)
    return sqrt5mod82;
  if (P % _16n2 === _9n2)
    return sqrt9mod162(P);
  return tonelliShanks2(P);
}
var isNegativeLE2 = (num, modulo) => (mod2(num, modulo) & _1n8) === _1n8;
var FIELD_FIELDS2 = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField2(field) {
  aobject2(field, "field");
  if (typeof field.ORDER !== "bigint")
    throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof field.ORDER);
  asafenumber(field.BYTES, "BYTES");
  asafenumber(field.BITS, "BITS");
  for (const name2 of FIELD_FIELDS2)
    afunction(field[name2], "field." + name2);
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n8)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpInvertBatch2(Fp2, nums, passZero = false) {
  validateField2(Fp2);
  aarray(nums, "nums");
  abool(passZero, "passZero");
  const F = Fp2;
  const inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = acc;
    return F.mul(acc, num);
  }, F.ONE);
  const invertedAcc = F.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = F.mul(acc, inverted[i]);
    return F.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre2(Fp2, n) {
  validateField2(Fp2);
  const F = Fp2;
  aoddModulus(F.ORDER, "FpLegendre");
  const p1mod2 = (F.ORDER - _1n8) / _2n5;
  const powered = F.pow(n, p1mod2);
  const yes = F.eql(powered, F.ONE);
  const zero = F.eql(powered, F.ZERO);
  const no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength2(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber3(nBitLength);
  if (n <= _0n8)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen2(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT = /* @__PURE__ */ new WeakMap();
var _Field = class {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n8;
  ONE = _1n8;
  _lengths;
  _mod;
  constructor(ORDER, opts = {}) {
    if (ORDER <= _1n8)
      throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
    let _nbitLength = void 0;
    this.isLE = false;
    if (opts != null && typeof opts === "object") {
      if (typeof opts.BITS === "number")
        _nbitLength = opts.BITS;
      if (typeof opts.sqrt === "function")
        Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
      if (typeof opts.isLE === "boolean")
        this.isLE = opts.isLE;
      if (opts.allowedLengths)
        this._lengths = Object.freeze(opts.allowedLengths.slice());
      if (typeof opts.modFromBytes === "boolean")
        this._mod = opts.modFromBytes;
    }
    const { nBitLength, nByteLength } = nLength2(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    Object.freeze(this);
  }
  create(num) {
    return mod2(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num !== "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num);
    return _0n8 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n8;
  }
  // is valid and invertible
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n8) === _1n8;
  }
  neg(num) {
    return mod2(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod2(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod2(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod2(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod2(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return pow(num, power, this.ORDER);
  }
  div(lhs, rhs) {
    return mod2(lhs * invert2(rhs, this.ORDER), this.ORDER);
  }
  // Same as above, but doesn't normalize
  sqrN(num) {
    return num * num;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num) {
    return invert2(num, this.ORDER);
  }
  sqrt(num) {
    let sqrt = FIELD_SQRT.get(this);
    if (!sqrt)
      FIELD_SQRT.set(this, sqrt = FpSqrt2(this.ORDER));
    return sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE2(num, this.BYTES) : numberToBytesBE2(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes3(bytes);
    const { _lengths: allowedLengths, BYTES, isLE: isLE3, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE3 ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE3 ? bytesToNumberLE2(bytes) : bytesToNumberBE2(bytes);
    if (modFromBytes)
      scalar = mod2(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(lst) {
    return FpInvertBatch2(this, lst, true);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    abool(condition, "condition");
    return condition ? b : a;
  }
};
function Field2(ORDER, opts = {}) {
  Object.freeze(_Field.prototype);
  return new _Field(ORDER, opts);
}

// ../../node_modules/.pnpm/@noble+curves@2.3.0/node_modules/@noble/curves/abstract/curve.js
var _0n9 = /* @__PURE__ */ BigInt(0);
var _1n9 = /* @__PURE__ */ BigInt(1);
var _4n3 = /* @__PURE__ */ BigInt(4);
var BLIND_BYTES = 16;
var BLIND_BITS = 128;
var FW_WINDOW = 5;
var TABLE_BYTES_MAX = /* @__PURE__ */ (() => 2 ** 31)();
function validatePointCons(Point) {
  const pc = Point;
  if (typeof pc !== "function")
    throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
  afunction(pc.fromAffine, "Point.fromAffine");
  afunction(pc.fromBytes, "Point.fromBytes");
  afunction(pc.fromHex, "Point.fromHex");
  aobject2(pc.BASE, "Point.BASE");
  aobject2(pc.ZERO, "Point.ZERO");
  validateField2(pc.Fp);
  validateField2(pc.Fn);
}
function normalizeZ2(c, points) {
  validatePointCons(c);
  validateMSMPoints2(points, c);
  const invertedZs = FpInvertBatch2(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW2(W, bits, min = 1) {
  if (!Number.isSafeInteger(W) || W < min || W > bits)
    throw new Error("invalid window size, expected [" + min + ".." + bits + "], got W=" + W);
}
function validateTableBytes(numPoints, fpBytes) {
  const bytes = numPoints * (4 * fpBytes + 128);
  if (bytes > TABLE_BYTES_MAX)
    throw new Error("invalid window size: table would need ~" + Math.ceil(bytes / 2 ** 20) + " MiB, max " + TABLE_BYTES_MAX / 2 ** 20 + " MiB");
}
function probeRandomBytes(randomBytes7, length) {
  if (randomBytes7 === void 0)
    return void 0;
  afunction(randomBytes7, "randomBytes");
  try {
    const probe = randomBytes7(length);
    if (!isBytes3(probe) || probe.length !== length)
      return void 0;
  } catch {
    return void 0;
  }
  return randomBytes7;
}
function validateMSMPoints2(points, c) {
  aarray(points, "points");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars2(scalars, field, maxScalar) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s2, i) => {
    const ok4 = maxScalar === void 0 ? field.isValid(s2) : isPosBig2(s2) && s2 < maxScalar;
    if (!ok4)
      throw new Error("invalid scalar at index " + i);
  });
}
var pointWindowSizes2 = /* @__PURE__ */ new WeakMap();
function getWindowSize(P) {
  return pointWindowSizes2.get(P) || 1;
}
function oddMultiples(p, size) {
  const dbl = p.double();
  const t = [p];
  for (let j = 1; j < size; j++)
    t.push(t[j - 1].add(dbl));
  return t;
}
function wnafDigits(n, W) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const d = [];
  while (n > _0n9) {
    let w = 0;
    if (n & _1n9) {
      w = Number(n & mask);
      if (w >= half)
        w -= size;
      n -= BigInt(w);
    }
    d.push(w);
    n >>= _1n9;
  }
  return d;
}
function signedWindowDigits(n, W, windows) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const shiftBy = BigInt(W);
  const d = [];
  for (let w = 0; w < windows; w++) {
    let v = Number(n & mask);
    n >>= shiftBy;
    if (v > half) {
      v -= size;
      n += _1n9;
    }
    d.push(v);
  }
  if (n !== _0n9)
    throw new Error("invalid wnaf");
  return d;
}
function wnafWalk(zero, tables, digits) {
  let max = 0;
  for (const d of digits)
    max = Math.max(max, d.length);
  let acc = zero;
  for (let bit = max - 1; bit >= 0; bit--) {
    if (bit !== max - 1)
      acc = acc.double();
    for (let i = 0; i < digits.length; i++) {
      const w = digits[i][bit];
      if (w) {
        const item = tables[i][Math.abs(w) - 1 >> 1];
        acc = acc.add(w < 0 ? item.negate() : item);
      }
    }
  }
  return acc;
}
var ScalarMultiplier = class {
  Point;
  BASE;
  ZERO;
  randomBytes;
  wnafPrecomputes = /* @__PURE__ */ new WeakMap();
  baseCanBeBlinded;
  bits;
  // Parametrized with a given Point class (not individual point)
  constructor(Point, randomBytes7) {
    validatePointCons(Point);
    this.randomBytes = probeRandomBytes(randomBytes7, BLIND_BYTES);
    this.Point = Point;
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.bits = Point.Fn.BITS;
  }
  /**
   * Creates a signed fixed-window wNAF precomputation table: for every window w, the
   * multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P`, flattened. All doublings are baked into the table,
   * so cached multiplication is additions-only. `windows = ceil(bits/W) + 1`: the extra
   * window absorbs the final carry of signed-digit recoding.
   * For a 256-bit curve and W=6, the table is 44⋅32 = 1408 points.
   * @param point - Point instance
   * @param W - window size
   * @param bits - scalar bitlength the table must cover
   */
  buildWnafTable(point, W, bits) {
    const windows = Math.ceil(bits / W) + 1;
    const half = 2 ** (W - 1);
    const comp = [];
    let base = point;
    for (let w = 0; w < windows; w++) {
      let acc = base;
      for (let i = 0; i < half; i++) {
        comp.push(acc);
        acc = acc.add(base);
      }
      base = comp[comp.length - 1].double();
    }
    return { W, bits, windows, comp };
  }
  /**
   * Implements ec multiplication using precomputed signed fixed-window wNAF tables.
   * Constant-time: fixed window count with one table addition per window — zero digits feed
   * the fake accumulator — and no doublings; the lookup scans the whole window slice.
   * Scalar bounds are validated by the public entry points ({@link ScalarMultiplier.mulCT},
   * {@link ScalarMultiplier.mulCTBlinded}, {@link ScalarMultiplier.mulUnsafe});
   * signedWindowDigits throws if `n` exceeds the table.
   * @returns real and fake (for const-time) points
   */
  wnafCachedCT(precomputes, n) {
    const { W, windows, comp } = precomputes;
    const half = 2 ** (W - 1);
    const digits = signedWindowDigits(n, W, windows);
    let p = this.ZERO;
    let f = this.BASE;
    for (let w = 0; w < windows; w++) {
      const digit = digits[w];
      const start = w * half;
      const idx = Math.abs(digit) - 1;
      let sel = comp[start];
      for (let i = 1; i < half; i++)
        sel = i === idx ? comp[start + i] : sel;
      const neg = sel.negate();
      if (digit === 0)
        f = f.add(comp[start]);
      else
        p = p.add(digit < 0 ? neg : sel);
    }
    return { p, f };
  }
  // Cache key is point identity plus (W, bits); at most two entries exist per point (public-width
  // `Fn.BITS` and blinded `Fn.BITS + BLIND_BITS`). Callers must not reuse the same point with
  // incompatible `transform(...)` layouts and expect a separate cache entry.
  getWnafPrecomputes(W, point, bits, transform) {
    let entries = this.wnafPrecomputes.get(point);
    let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
    if (!comp) {
      comp = this.buildWnafTable(point, W, bits);
      if (typeof transform === "function")
        comp = { ...comp, comp: transform(comp.comp) };
      if (!entries) {
        entries = [];
        this.wnafPrecomputes.set(point, entries);
      }
      entries.push(comp);
    }
    return comp;
  }
  assertPoint(point) {
    if (!(point instanceof this.Point))
      throw new TypeError('"point" expected Point instance, got type=' + typeof point);
  }
  // Shared prologue of the constant-time entry points. Rejects scalar 0: in key/signature-style
  // callers a zero scalar means broken upstream plumbing, and concrete Points already reject it.
  // Uses inRange instead of Fn.isValidNot0: validateField() only certifies the arithmetic subset.
  validateMulInput(point, scalar) {
    this.assertPoint(point);
    if (!inRange2(scalar, _1n9, this.Point.Fn.ORDER))
      throw new Error("invalid scalar");
  }
  // Constant-time dispatch shared by mulCT / mulCTBlinded. Un-precomputed points (W===1, e.g.
  // ECDH peer keys) skip building a throwaway cached table in favor of a small fixed-window
  // multiply. `n` must be < 2^bits.
  runCT(point, n, bits, transform) {
    const W = getWindowSize(point);
    if (W === 1)
      return this.fixedWindowCT(point, n, bits);
    return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
  }
  mulCT(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    return this.runCT(point, scalar, this.bits, transform);
  }
  mulCTBlinded(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    if (this.randomBytes === void 0)
      throw new Error("randomBytes is required for scalar blinding");
    const bits = this.Point.Fn.BITS + BLIND_BITS;
    const blind = this.randomBytes(BLIND_BYTES);
    if (!isBytes3(blind) || blind.length !== BLIND_BYTES)
      throw new Error("randomBytes returned invalid byte array");
    blind[0] = blind[0] & 63 | 128;
    const n = scalar + bytesToNumberBE2(blind) * this.Point.Fn.ORDER;
    return this.runCT(point, n, bits, transform);
  }
  /**
   * Constant-time multiplication `n*point` for an un-precomputed point, via a small fixed window.
   * A cached wNAF table only pays off when reused; a flat 2^FW_WINDOW table (`size-1` adds) is
   * far cheaper to build for a single use. The point-operation sequence is independent of `n`:
   * build the table, then per window exactly FW_WINDOW doublings, a data-oblivious scan over
   * every table entry, and one addition (adds the identity when the window digit is 0 — never
   * skipped).
   *
   * `n` must be `< 2^bits`. Assumes complete addition (adding the identity costs the same as any
   * add), which holds for the Weierstrass/Edwards point types used here. The table is left in
   * projective form (no normalizeZ): normalizing this small a table costs more than the
   * mixed-add savings it would buy for a single multiply.
   * @returns real point `p`; `f` duplicates it only to match {@link wnafCachedCT}'s return shape
   * (this path needs no fake accumulator — its op-count is already scalar-independent).
   */
  fixedWindowCT(point, n, bits) {
    const W = FW_WINDOW;
    const size = 1 << W;
    const mask = bitMask2(W);
    const table = new Array(size);
    table[0] = this.ZERO;
    for (let i = 1; i < size; i++)
      table[i] = table[i - 1].add(point);
    const windows = Math.ceil(bits / W);
    let acc = this.ZERO;
    for (let window = windows - 1; window >= 0; window--) {
      if (window !== windows - 1)
        for (let d = 0; d < W; d++)
          acc = acc.double();
      const digit = Number(n >> BigInt(window * W) & mask);
      let sel = table[0];
      for (let i = 1; i < size; i++)
        sel = i === digit ? table[i] : sel;
      acc = acc.add(sel);
    }
    return { p: acc, f: acc };
  }
  shouldBlind(point, cofactor) {
    if (this.randomBytes === void 0)
      return false;
    if (cofactor === _1n9)
      return true;
    if (point !== this.BASE)
      return false;
    if (this.baseCanBeBlinded === void 0)
      this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
    return this.baseCanBeBlinded;
  }
  mulSecret(point, scalar, cofactor, transform) {
    return this.shouldBlind(point, cofactor) ? this.mulCTBlinded(point, scalar, transform) : this.mulCT(point, scalar, transform);
  }
  mulUnsafe(point, scalar, transform) {
    this.assertPoint(point);
    if (!isPosBig2(scalar))
      throw new Error("invalid scalar");
    const W = getWindowSize(point);
    if (W === 1 || scalar >= this.Point.Fn.ORDER)
      return mulAddUnsafe(this.Point, [point], [scalar], true);
    const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
    return this.wnafCachedCT(precomputes, scalar).p;
  }
  // Remembers the window size used for precomputed wNAF multiplication of the given point
  // and drops any previously built tables. Usually only the base point is precomputed.
  // W=1 resets the point to the un-precomputed (table-less) paths.
  // W is additionally capped so tables stay under ~2 GiB ({@link TABLE_BYTES_MAX}).
  setWindowSize(point, W) {
    this.assertPoint(point);
    validateW2(W, this.bits);
    const windows = Math.ceil((this.bits + BLIND_BITS) / W) + 1;
    validateTableBytes(windows * 2 ** (W - 1), this.Point.Fp.BYTES);
    pointWindowSizes2.set(point, W);
    this.wnafPrecomputes.delete(point);
  }
  // True when a window size is set: tables themselves are built lazily on first multiply.
  hasWindowSize(point) {
    return getWindowSize(point) !== 1;
  }
};
function mulAddUnsafe(c, points, scalars, allowOversized = false) {
  validatePointCons(c);
  validateMSMPoints2(points, c);
  abool(allowOversized, "allowOversized");
  validateMSMScalars2(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n3 : void 0);
  if (points.length !== scalars.length)
    throw new Error("arrays of points and scalars must have equal length");
  const tables = points.map((p) => oddMultiples(p, 4));
  const digits = scalars.map((n) => wnafDigits(n, 4));
  return wnafWalk(c.ZERO, tables, digits);
}
function createField2(order, field, isLE3) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField2(field);
    return field;
  } else {
    return Field2(order, { isLE: isLE3 });
  }
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (type !== "weierstrass" && type !== "edwards")
    throw new Error('expected curve type "weierstrass" or "edwards"');
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  validateObject2(curveOpts);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(isPosBig2(val) && val !== _0n9))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp2 = createField2(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn2 = createField2(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp2.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp: Fp2, Fn: Fn2 };
}
function createKeygen(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey2 = randomSecretKey(seed);
    return { secretKey: secretKey2, publicKey: getPublicKey(secretKey2) };
  };
}

// ../../node_modules/.pnpm/@noble+curves@2.3.0/node_modules/@noble/curves/abstract/edwards.js
var _0n10 = /* @__PURE__ */ BigInt(0);
var _1n10 = /* @__PURE__ */ BigInt(1);
var _2n6 = /* @__PURE__ */ BigInt(2);
var _4n4 = /* @__PURE__ */ BigInt(4);
var _8n5 = /* @__PURE__ */ BigInt(8);
function isEdValidXY2(Fp2, CURVE, x, y) {
  const x2 = Fp2.sqr(x);
  const y2 = Fp2.sqr(y);
  const left = Fp2.add(Fp2.mul(CURVE.a, x2), y2);
  const right = Fp2.add(Fp2.ONE, Fp2.mul(CURVE.d, Fp2.mul(x2, y2)));
  return Fp2.eql(left, right);
}
function edwards2(params, extraOpts = {}) {
  validateObject2(extraOpts, {}, {}, "extraOpts");
  const opts = extraOpts;
  const validated = createCurveFields("edwards", params, opts, opts.FpFnLE);
  const { Fp: Fp2, Fn: Fn2 } = validated;
  let CURVE = validated.CURVE;
  const { h: cofactor } = CURVE;
  if (FpLegendre2(Fp2, CURVE.a) !== 1)
    throw new Error("edwards: CURVE.a must be a square in Fp for complete addition formulas");
  if (FpLegendre2(Fp2, CURVE.d) !== -1)
    throw new Error("edwards: CURVE.d must be a non-square in Fp for complete addition formulas");
  validateObject2(opts, {}, { uvRatio: "function", randomBytes: "function" });
  const randomBytes7 = opts.randomBytes === void 0 ? randomBytes4 : opts.randomBytes;
  const MASK = _2n6 << BigInt(Fp2.BYTES * 8) - _1n10;
  function isOdd(n) {
    if (!Fp2.isOdd)
      throw new Error("Field does not have .isOdd()");
    return Fp2.isOdd(n);
  }
  const uvRatio3 = opts.uvRatio === void 0 ? (u, v) => {
    try {
      return { isValid: true, value: Fp2.sqrt(Fp2.div(u, v)) };
    } catch (e) {
      return { isValid: false, value: _0n10 };
    }
  } : opts.uvRatio;
  if (!isEdValidXY2(Fp2, CURVE, CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const mulA = Fp2.eql(CURVE.a, Fp2.neg(Fp2.ONE)) ? (x) => Fp2.neg(x) : Fp2.eql(CURVE.a, Fp2.ONE) ? (x) => x : (x) => Fp2.mul(CURVE.a, x);
  function acoord(title, n, banZero = false) {
    const min = banZero ? _1n10 : _0n10;
    aInRange2("coordinate " + title, n, min, MASK);
    return n;
  }
  function aedpoint(other) {
    if (!(other instanceof Point))
      throw new Error("EdwardsPoint expected");
  }
  class Point {
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp2.ONE, Fp2.mul(CURVE.Gx, CURVE.Gy));
    static ZERO = new Point(Fp2.ZERO, Fp2.ONE, Fp2.ONE, Fp2.ZERO);
    static Fp = Fp2;
    static Fn = Fn2;
    X;
    Y;
    Z;
    T;
    constructor(X, Y, Z, T) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y);
      this.Z = acoord("z", Z, true);
      this.T = acoord("t", T);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /**
     * Create one extended Edwards point from affine coordinates.
     * Does NOT validate that the point is on-curve or torsion-free.
     * Use `.assertValidity()` on adversarial inputs.
     */
    static fromAffine(p) {
      if (p instanceof Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      acoord("x", x);
      acoord("y", y);
      return new Point(x, y, Fp2.ONE, Fp2.mul(x, y));
    }
    // Uses algo from RFC8032 5.1.3.
    static fromBytes(bytes, zip215 = false) {
      const len = Fp2.BYTES;
      const { a, d } = CURVE;
      bytes = copyBytes3(abytes3(bytes, len, "point"));
      abool(zip215, "zip215");
      const normed = copyBytes3(bytes);
      const lastByte = bytes[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE2(normed);
      const max = zip215 ? MASK : Fp2.ORDER;
      aInRange2("point.y", y, _0n10, max);
      const y2 = Fp2.sqr(y);
      const u = Fp2.sub(y2, Fp2.ONE);
      const v = Fp2.sub(Fp2.mulN(d, y2), a);
      let { isValid: isValid2, value: x } = uvRatio3(u, v);
      if (!isValid2)
        throw new Error("bad point: invalid y coordinate");
      const isXOdd = isOdd(x);
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && Fp2.is0(x) && isLastByteOdd)
        throw new Error("bad point: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = Fp2.neg(x);
      return Point.fromAffine({ x, y });
    }
    static fromHex(hex, zip215 = false) {
      return Point.fromBytes(hexToBytes3(hex), zip215);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    precompute(windowSize = 6, isLazy = true) {
      wnaf.setWindowSize(this, windowSize);
      if (!isLazy)
        this.multiply(_2n6);
      return this;
    }
    // Useful in fromAffine() - not for fromBytes(), which always created valid points.
    assertValidity() {
      const p = this;
      const { a, d } = CURVE;
      if (p.is0())
        throw new Error("bad point: ZERO");
      const { X, Y, Z, T } = p;
      const X2 = Fp2.sqr(X);
      const Y2 = Fp2.sqr(Y);
      const Z2 = Fp2.sqr(Z);
      const Z4 = Fp2.sqr(Z2);
      const aX2 = Fp2.mul(X2, a);
      const left = Fp2.mul(Fp2.add(aX2, Y2), Z2);
      const right = Fp2.add(Z4, Fp2.mul(d, Fp2.mul(X2, Y2)));
      if (!Fp2.eql(left, right))
        throw new Error("bad point: equation left != right (1)");
      const XY = Fp2.mul(X, Y);
      const ZT = Fp2.mul(Z, T);
      if (!Fp2.eql(XY, ZT))
        throw new Error("bad point: equation left != right (2)");
    }
    // Compare one point to another.
    equals(other) {
      aedpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const X1Z2 = Fp2.mul(X1, Z2);
      const X2Z1 = Fp2.mul(X2, Z1);
      const Y1Z2 = Fp2.mul(Y1, Z2);
      const Y2Z1 = Fp2.mul(Y2, Z1);
      return Fp2.eql(X1Z2, X2Z1) && Fp2.eql(Y1Z2, Y2Z1);
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    negate() {
      return new Point(Fp2.neg(this.X), this.Y, this.Z, Fp2.neg(this.T));
    }
    // Fast algo for doubling Extended Point.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
    // Cost: 4M + 4S + 1*a + 6add + 1*2.
    double() {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const A = Fp2.sqr(X1);
      const B = Fp2.sqr(Y1);
      const C = Fp2.mul(Fp2.sqr(Z1), _2n6);
      const D = mulA(A);
      const x1y1 = Fp2.addN(X1, Y1);
      const E = Fp2.sub(Fp2.subN(Fp2.sqr(x1y1), A), B);
      const G = Fp2.addN(D, B);
      const F = Fp2.subN(G, C);
      const H = Fp2.subN(D, B);
      const X3 = Fp2.mul(E, F);
      const Y3 = Fp2.mul(G, H);
      const T3 = Fp2.mul(E, H);
      const Z3 = Fp2.mul(F, G);
      return new Point(X3, Y3, Z3, T3);
    }
    // Fast algo for adding 2 Extended Points.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
    // Cost: 9M + 1*a + 1*d + 7add.
    add(other) {
      aedpoint(other);
      const { d } = CURVE;
      const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
      const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
      const A = Fp2.mul(X1, X2);
      const B = Fp2.mul(Y1, Y2);
      const C = Fp2.mul(Fp2.mulN(T1, d), T2);
      const D = Fp2.mul(Z1, Z2);
      const E = Fp2.sub(Fp2.subN(Fp2.mulN(Fp2.addN(X1, Y1), Fp2.addN(X2, Y2)), A), B);
      const F = Fp2.subN(D, C);
      const G = Fp2.addN(D, C);
      const H = Fp2.sub(B, mulA(A));
      const X3 = Fp2.mul(E, F);
      const Y3 = Fp2.mul(G, H);
      const T3 = Fp2.mul(E, H);
      const Z3 = Fp2.mul(F, G);
      return new Point(X3, Y3, Z3, T3);
    }
    subtract(other) {
      aedpoint(other);
      return this.add(other.negate());
    }
    // Constant-time multiplication.
    multiply(scalar) {
      if (!Fn2.isValidNot0(scalar))
        throw new RangeError("invalid scalar: expected 1 <= sc < curve.n");
      const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
      return normalize([p, f])[0];
    }
    // Non-constant-time multiplication. Uses double-and-add algorithm.
    // It's faster, but should only be used when you don't care about
    // an exposed private key e.g. sig verification.
    // Keeps the same subgroup-scalar contract: 0 is allowed for public-scalar callers, but
    // n and larger values are rejected instead of being reduced mod n to the identity point.
    multiplyUnsafe(scalar) {
      if (!Fn2.isValid(scalar))
        throw new RangeError("invalid scalar: expected 0 <= sc < curve.n");
      if (scalar === _0n10)
        return Point.ZERO;
      if (this.is0() || scalar === _1n10)
        return this;
      return wnaf.mulUnsafe(this, scalar, normalize);
    }
    // Checks if point is of small order.
    // If you add something to small order point, you will have "dirty"
    // point with torsion component.
    // Clears cofactor and checks if the result is 0.
    isSmallOrder() {
      return this.clearCofactor().is0();
    }
    // Multiplies point by curve order and checks if the result is 0.
    // Returns `false` is the point is dirty.
    isTorsionFree() {
      return wnaf.mulUnsafe(this, CURVE.n).is0();
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      if (iz != null && typeof iz !== "bigint")
        throw new TypeError('"invertedZ" expected bigint, got type=' + typeof iz);
      const { X, Y, Z } = p;
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp2.create(_8n5) : Fp2.inv(Z);
      const x = Fp2.mul(X, iz);
      const y = Fp2.mul(Y, iz);
      const zz = Fp2.mul(Z, iz);
      if (is0)
        return { x: Fp2.ZERO, y: Fp2.ONE };
      if (!Fp2.eql(zz, Fp2.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    clearCofactor() {
      if (cofactor === _1n10)
        return this;
      if (cofactor === _2n6)
        return this.double();
      if (cofactor === _4n4)
        return this.double().double();
      if (cofactor === _8n5)
        return this.double().double().double();
      return this.multiplyUnsafe(cofactor);
    }
    toBytes() {
      const { x, y } = this.toAffine();
      const bytes = Fp2.toBytes(y);
      bytes[bytes.length - 1] |= isOdd(x) ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex3(this.toBytes());
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const normalize = (points) => normalizeZ2(Point, points);
  const wnaf = new ScalarMultiplier(Point, randomBytes7);
  if (wnaf.bits >= 6)
    Point.BASE.precompute(6);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}

// ../../node_modules/.pnpm/@noble+curves@2.3.0/node_modules/@noble/curves/abstract/montgomery.js
var _0n11 = /* @__PURE__ */ BigInt(0);
var _1n11 = /* @__PURE__ */ BigInt(1);
var _2n7 = /* @__PURE__ */ BigInt(2);
function cmask(P, swap) {
  return P + swap - (swap >> _1n11 << _1n11);
}
function cswap(P) {
  const offset = BigInt(6) * P;
  return (mask, x_2, x_3) => {
    const sum = x_2 + x_3;
    const d = offset + x_3 - x_2;
    const a = (d * mask + x_2) % P;
    return { x_2: a, x_3: sum - a };
  };
}
function validateOpts2(curve) {
  validateObject2(curve, {
    P: "bigint",
    type: "string",
    adjustScalarBytes: "function",
    powPminus2: "function"
  }, {
    randomBytes: "function",
    scalarMultBase: "function"
  });
  return Object.freeze({ ...curve });
}
function montgomery2(curveDef) {
  const CURVE = validateOpts2(curveDef);
  const { P, type, adjustScalarBytes: adjustScalarBytes3, powPminus2, randomBytes: rand } = CURVE;
  const mulBaseHook = CURVE.scalarMultBase;
  const is25519 = type === "x25519";
  if (!is25519 && type !== "x448")
    throw new Error("invalid type");
  const randomBytes_ = rand === void 0 ? randomBytes4 : rand;
  const montgomeryBits = is25519 ? 255 : 448;
  const swap = cswap(P);
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? BigInt(9) : BigInt(5);
  const a24 = is25519 ? BigInt(121665) : BigInt(39081);
  const minScalar = is25519 ? _2n7 ** BigInt(254) : _2n7 ** BigInt(447);
  const maxAdded = is25519 ? BigInt(8) * (_2n7 ** BigInt(251) - _1n11) : BigInt(4) * (_2n7 ** BigInt(445) - _1n11);
  const maxScalar = minScalar + maxAdded + _1n11;
  const modP = (n) => mod2(n, P);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE2(modP(u), fieldLen);
  }
  function decodeU(u) {
    const _u = copyBytes3(abytes3(u, fieldLen, "uCoordinate"));
    if (is25519)
      _u[31] &= 127;
    return modP(bytesToNumberLE2(_u));
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE2(adjustScalarBytes3(copyBytes3(abytes3(scalar, fieldLen, "scalar"))));
  }
  const lowOrderU = new Set(is25519 ? [
    _0n11,
    _1n11,
    P - _1n11,
    BigInt("325606250916557431795983626356110631294008115727848805560023387167927233504"),
    BigInt("39382357235489614581723060781553021112529911719440698176882885853963445705823")
  ] : [_0n11, _1n11, P - _1n11]);
  function scalarMult(scalar, u) {
    const pointU = decodeU(u);
    if (lowOrderU.has(pointU))
      throw new Error("invalid private or public key received");
    const pu = montgomeryLadder(pointU, decodeScalar(scalar));
    if (pu === _0n11)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  function scalarMultBase(scalar) {
    if (mulBaseHook === void 0)
      return scalarMult(scalar, GuBytes);
    const k = decodeScalar(scalar);
    aInRange2("scalar", k, minScalar, maxScalar);
    const pu = modP(mulBaseHook(k));
    if (pu === _0n11)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  const getPublicKey = scalarMultBase;
  const getSharedSecret = scalarMult;
  function montgomeryLadder(u, scalar) {
    aInRange2("u", u, _0n11, P);
    aInRange2("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = _1n11;
    let z_2 = _0n11;
    let x_3 = u;
    let z_3 = _1n11;
    const kx = k ^ k >> _1n11;
    for (let t = BigInt(montgomeryBits - 1); t >= _0n11; t--) {
      const mask2 = cmask(P, kx >> t);
      ({ x_2, x_3 } = swap(mask2, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = swap(mask2, z_2, z_3));
      const A = x_2 + z_2;
      const AA = modP(A * A);
      const B = x_2 - z_2;
      const BB = modP(B * B);
      const E = AA - BB;
      const C = x_3 + z_3;
      const D = x_3 - z_3;
      const DA = modP(D * A);
      const CB = modP(C * B);
      const dacb = DA + CB;
      const da_cb = DA - CB;
      x_3 = modP(dacb * dacb);
      z_3 = modP(x_1 * modP(da_cb * da_cb));
      x_2 = modP(AA * BB);
      z_2 = modP(E * (AA + modP(a24 * E)));
    }
    const mask = cmask(P, k);
    ({ x_2, x_3 } = swap(mask, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = swap(mask, z_2, z_3));
    const z2 = powPminus2(z_2);
    return modP(x_2 * z2);
  }
  const lengths = {
    secretKey: fieldLen,
    publicKey: fieldLen,
    seed: fieldLen
  };
  const randomSecretKey = (seed) => {
    seed = seed === void 0 ? randomBytes_(fieldLen) : seed;
    abytes3(seed, lengths.seed, "seed");
    return seed;
  };
  const utils = { randomSecretKey };
  Object.freeze(lengths);
  Object.freeze(utils);
  return Object.freeze({
    keygen: createKeygen(randomSecretKey, getPublicKey),
    getSharedSecret,
    getPublicKey,
    scalarMult,
    scalarMultBase,
    utils,
    GuBytes: GuBytes.slice(),
    lengths
  });
}

// ../../node_modules/.pnpm/@noble+curves@2.3.0/node_modules/@noble/curves/ed25519.js
var _0n12 = /* @__PURE__ */ BigInt(0);
var _1n12 = /* @__PURE__ */ BigInt(1);
var _2n8 = /* @__PURE__ */ BigInt(2);
var _3n4 = /* @__PURE__ */ BigInt(3);
var _5n4 = /* @__PURE__ */ BigInt(5);
var _8n6 = /* @__PURE__ */ BigInt(8);
var ed25519_CURVE_p2 = /* @__PURE__ */ BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
var ed25519_CURVE2 = /* @__PURE__ */ (() => ({
  p: ed25519_CURVE_p2,
  n: BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed"),
  h: _8n6,
  a: BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec"),
  d: BigInt("0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3"),
  Gx: BigInt("0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a"),
  Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
}))();
function ed25519_pow_2_252_32(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P = ed25519_CURVE_p2;
  const x2 = x * x % P;
  const b2 = x2 * x % P;
  const b4 = pow22(b2, _2n8, P) * b2 % P;
  const b5 = pow22(b4, _1n12, P) * x % P;
  const b10 = pow22(b5, _5n4, P) * b5 % P;
  const b20 = pow22(b10, _10n, P) * b10 % P;
  const b40 = pow22(b20, _20n, P) * b20 % P;
  const b80 = pow22(b40, _40n, P) * b40 % P;
  const b160 = pow22(b80, _80n, P) * b80 % P;
  const b240 = pow22(b160, _80n, P) * b80 % P;
  const b250 = pow22(b240, _10n, P) * b10 % P;
  const pow_p_5_8 = pow22(b250, _2n8, P) * x % P;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes2(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
var ED25519_SQRT_M12 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
function uvRatio2(u, v) {
  const P = ed25519_CURVE_p2;
  const v3 = mod2(v * v * v, P);
  const v7 = mod2(v3 * v3 * v, P);
  const pow3 = ed25519_pow_2_252_32(u * v7).pow_p_5_8;
  let x = mod2(u * v3 * pow3, P);
  const vx2 = mod2(v * x * x, P);
  const root1 = x;
  const root2 = mod2(x * ED25519_SQRT_M12, P);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod2(-u, P);
  const noRoot = vx2 === mod2(-u * ED25519_SQRT_M12, P);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE2(x, P))
    x = mod2(-x, P);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var ed25519_Point = /* @__PURE__ */ edwards2(ed25519_CURVE2, { uvRatio: uvRatio2 });
var x255192 = /* @__PURE__ */ (() => {
  const P = ed25519_CURVE_p2;
  const powPminus2 = (x) => {
    const { pow_p_5_8, b2 } = ed25519_pow_2_252_32(x);
    return mod2(pow22(pow_p_5_8, _3n4, P) * b2, P);
  };
  return montgomery2({
    P,
    type: "x25519",
    powPminus2,
    adjustScalarBytes: adjustScalarBytes2,
    // ~3x faster fixed-base: [k]B on the birationally-equivalent Edwards curve using cached
    // base tables, mapped back via u = (1+y)/(1-y) = (Z+Y)/(Z-Y) with one Fermat inversion.
    // Same construction as libsodium's crypto_scalarmult_curve25519_base.
    scalarMultBase: (k) => {
      const kn = mod2(k, ed25519_Point.Fn.ORDER);
      if (kn === _0n12)
        return _0n12;
      const p = ed25519_Point.BASE.multiply(kn);
      return mod2((p.Z + p.Y) * powPminus2(mod2(p.Z - p.Y, P)), P);
    }
  });
})();

// ../../node_modules/.pnpm/@lukeburns+clatterjs@1.0.0/node_modules/@lukeburns/clatterjs/dist/dhX25519.js
var PK = 32;
var X25519_NAME = "25519";
function x25519Keygen(rng) {
  const sk = rng(32);
  return { secretKey: sk, publicKey: x255192.getPublicKey(sk) };
}
function x25519Dh(ourSec, theirPub) {
  return x255192.getSharedSecret(ourSec, theirPub);
}
function dhPubKeyLen() {
  return PK;
}

// ../../node_modules/.pnpm/@lukeburns+clatterjs@1.0.0/node_modules/@lukeburns/clatterjs/dist/protocolNames.js
function nqProtocolName(patternName, cipher, hash) {
  return `Noise_${patternName}_${X25519_NAME}_${cipher.name}_${hash.name}`;
}

// ../../node_modules/.pnpm/@lukeburns+clatterjs@1.0.0/node_modules/@lukeburns/clatterjs/dist/nqHandshake.js
var PK2 = () => dhPubKeyLen();
var NqHandshake = class {
  pattern;
  config;
  symmetric;
  s;
  e;
  rs;
  re;
  status;
  initiatorPatternIndex = 0;
  responderPatternIndex = 0;
  psks = [];
  pskApplied = false;
  ownRandomnessApplied = false;
  constructor(pattern, config) {
    this.pattern = pattern;
    this.config = config;
    if (pattern.getType() !== 0) {
      throw new HandshakeError("InvalidPattern");
    }
    const name2 = nqProtocolName(pattern.getName(), config.cipher, config.hash);
    this.symmetric = new SymmetricState(config.cipher, config.hash, name2);
    this.symmetric.mixHash(config.prologue);
    const I = config.initiator;
    for (const t of pattern.getInitiatorPreShared()) {
      if (t === 1) {
        this.symmetric.mixHash((I ? config.s?.publicKey : config.rs) ?? raiseMissing());
      } else {
        throw new Error("Invalid pre-shared token in pattern");
      }
    }
    for (const t of pattern.getResponderPreShared()) {
      if (t === 1) {
        this.symmetric.mixHash((I ? config.rs : config.s?.publicKey) ?? raiseMissing());
      } else if (t === 0) {
        if (I) {
          const reB = config.re ?? raiseMissing();
          this.symmetric.mixHash(reB);
          if (pattern.hasPsk()) {
            this.symmetric.mixKey(reB);
          }
        } else {
          const eB = config.e?.publicKey ?? raiseMissing();
          this.symmetric.mixHash(eB);
          if (pattern.hasPsk()) {
            this.symmetric.mixKey(eB);
          }
        }
      } else {
        throw new Error("Invalid pre-shared token in pattern");
      }
    }
    this.s = config.s;
    this.e = config.e;
    this.rs = config.rs;
    this.re = config.re;
    this.status = config.initiator ? 0 : 1;
  }
  getPattern() {
    return this.pattern;
  }
  isInitiator() {
    return this.config.initiator;
  }
  isWriteTurn() {
    return this.status === 0;
  }
  isFinished() {
    return this.status === 2;
  }
  mixHash(data) {
    this.symmetric.mixHash(data);
  }
  mixKeyAndHash(data) {
    this.symmetric.mixKeyAndHash(data);
  }
  pushPsk(psk) {
    if (psk.length !== PSK_LEN) {
      throw new Error(`PSK must be ${PSK_LEN} bytes`);
    }
    if (this.psks.length >= MAX_PSKS) {
      throw new Error("PSK queue full");
    }
    this.psks.push(Uint8Array.from(psk));
  }
  getName() {
    return nqProtocolName(this.pattern.getName(), this.config.cipher, this.config.hash);
  }
  getHash() {
    return this.symmetric.getHash();
  }
  getRemoteStatic() {
    return this.rs ? Uint8Array.from(this.rs) : void 0;
  }
  getRemoteEphemeral() {
    return this.re ? Uint8Array.from(this.re) : void 0;
  }
  getCiphers() {
    try {
      return this.symmetric.split();
    } catch (e) {
      if (e instanceof CipherError) {
        throw new HandshakeError("Cipher", void 0, e);
      }
      throw e;
    }
  }
  finalize() {
    if (!this.isFinished()) {
      throw new HandshakeError("InvalidState");
    }
    return new TransportState({
      pattern: this.pattern,
      cipherStates: this.getCiphers(),
      handshakeHash: this.getHash(),
      initiator: this.isInitiator(),
      tagLen: this.config.cipher.tagLen
    });
  }
  nextTokensForCurrentTurn() {
    const a = this.config.initiator;
    const st = this.status;
    if (st === 3 || st === 2) {
      throw new HandshakeError("InvalidState");
    }
    if (a && st === 0 || !a && st === 1) {
      return this.pattern.getInitiatorPattern(this.initiatorPatternIndex) ?? raiseInv();
    }
    return this.pattern.getResponderPattern(this.responderPatternIndex) ?? raiseInv();
  }
  getNextMessageOverhead() {
    const message = this.nextTokensForCurrentTurn();
    let overhead = 0;
    let hasKey = this.symmetric.hasKey();
    const hasPsk = this.pattern.hasPsk();
    const { cipher: C } = this.config;
    const pkl = PK2();
    for (const token of message) {
      if (token === 0) {
        overhead += pkl;
        if (hasPsk) {
          hasKey = true;
        }
      } else if (token === 1) {
        overhead += pkl;
        if (hasKey) {
          overhead += C.tagLen;
        }
      } else if (token === 2 || token === 3 || token === 4 || token === 5) {
        hasKey = true;
      } else if (token === 8) {
      } else {
        throw new Error("Incompatible pattern");
      }
    }
    if (hasKey) {
      overhead += C.tagLen;
    }
    return overhead;
  }
  writeMessage(payload, out) {
    if (this.status === 3) {
      throw new HandshakeError("ErrorState");
    }
    if (!this.isWriteTurn()) {
      throw new HandshakeError("InvalidState");
    }
    const oh = this.getNextMessageOverhead();
    const outLen = payload.length + oh;
    if (outLen > MAX_MESSAGE_LEN) {
      throw new Error("Maximum Noise message length exceeded");
    }
    if (out.length < outLen) {
      throw new HandshakeError("BufferTooSmall");
    }
    try {
      return this.writeMessageImpl(payload, out, outLen);
    } catch (e) {
      this.setError();
      throw e;
    }
  }
  readMessage(message, out) {
    if (message.length > MAX_MESSAGE_LEN) {
      throw new Error("Maximum Noise message length exceeded");
    }
    if (this.status === 3) {
      throw new HandshakeError("ErrorState");
    }
    if (this.isWriteTurn()) {
      throw new HandshakeError("InvalidState");
    }
    const oh = this.getNextMessageOverhead();
    if (message.length < oh) {
      throw new HandshakeError("InvalidMessage");
    }
    const outLen = message.length - oh;
    if (out.length < outLen) {
      throw new HandshakeError("BufferTooSmall");
    }
    try {
      return this.readMessageImpl(message, out, outLen);
    } catch (e) {
      this.setError();
      throw e;
    }
  }
  setError() {
    this.status = 3;
    this.symmetric.zeroize();
  }
  pskValidityCheck() {
    if (this.pskApplied && !this.ownRandomnessApplied) {
      throw new HandshakeError("Pattern", "PskValidityViolation", new PatternError("PskValidityViolation"));
    }
  }
  takePsk() {
    const p = this.psks.shift();
    if (!p) {
      throw new HandshakeError("PskMissing");
    }
    this.pskApplied = true;
    return p;
  }
  mapDh(t) {
    const needS = (kp) => {
      if (!kp) {
        throw new HandshakeError("MissingMaterial");
      }
      return kp;
    };
    const needB = (b) => {
      if (!b) {
        throw new HandshakeError("MissingMaterial");
      }
      return b;
    };
    let ss;
    try {
      if (t === 2) {
        ss = x25519Dh(needS(this.e).secretKey, needB(this.re));
      } else if (t === 3) {
        if (this.isInitiator()) {
          ss = x25519Dh(needS(this.e).secretKey, needB(this.rs));
        } else {
          ss = x25519Dh(needS(this.s).secretKey, needB(this.re));
        }
      } else if (t === 4) {
        if (this.isInitiator()) {
          ss = x25519Dh(needS(this.s).secretKey, needB(this.re));
        } else {
          ss = x25519Dh(needS(this.e).secretKey, needB(this.rs));
        }
      } else if (t === 5) {
        ss = x25519Dh(needS(this.s).secretKey, needB(this.rs));
      } else {
        throw new Error("mapDh");
      }
    } catch (e) {
      if (e instanceof HandshakeError) {
        throw e;
      }
      throw new HandshakeError("Dh", e instanceof Error ? e.message : String(e));
    }
    if (ss.length !== 32) {
      throw new HandshakeError("Dh", "Invalid shared secret length");
    }
    return ss;
  }
  updateHsStatus() {
    if (this.initiatorPatternIndex === this.pattern.getInitiatorPatternLen() && this.responderPatternIndex === this.pattern.getResponderPatternLen()) {
      this.status = 2;
    } else if (this.status === 1) {
      this.status = 0;
    } else {
      this.status = 1;
    }
  }
  writeMessageImpl(payload, out, outLen) {
    const message = this.isInitiator() ? this.pattern.getInitiatorPattern(this.initiatorPatternIndex++) : this.pattern.getResponderPattern(this.responderPatternIndex++);
    if (!message) {
      throw new HandshakeError("InvalidState");
    }
    const { cipher: C, rng } = this.config;
    const pkl = PK2();
    let cur = 0;
    for (const token of message) {
      if (token === 0) {
        if (!this.e) {
          this.e = x25519Keygen(rng);
        }
        const ePub = this.e.publicKey;
        this.symmetric.mixHash(ePub);
        if (this.pattern.hasPsk()) {
          this.symmetric.mixKey(ePub);
        }
        out.set(ePub, cur);
        cur += pkl;
        this.ownRandomnessApplied = true;
      } else if (token === 1) {
        if (!this.s) {
          throw new HandshakeError("MissingMaterial");
        }
        this.pskValidityCheck();
        const len = this.symmetric.hasKey() ? pkl + C.tagLen : pkl;
        this.symmetric.encryptAndHash(this.s.publicKey, out.subarray(cur, cur + len));
        cur += len;
      } else if (token === 8) {
        this.symmetric.mixKeyAndHash(this.takePsk());
      } else if (token === 2 || token === 3 || token === 4 || token === 5) {
        this.symmetric.mixKey(this.mapDh(token));
      } else {
        throw new Error("Incompatible pattern");
      }
    }
    if (payload.length > 0 && this.pskApplied && !this.ownRandomnessApplied) {
      throw new HandshakeError("Pattern", "PskValidityViolation", new PatternError("PskValidityViolation"));
    }
    this.symmetric.encryptAndHash(payload, out.subarray(cur, outLen));
    this.updateHsStatus();
    return outLen;
  }
  readMessageImpl(message, out, outLen) {
    let rest = message;
    const take = (n) => {
      if (rest.length < n) {
        throw new HandshakeError("InvalidMessage");
      }
      const s2 = rest.subarray(0, n);
      rest = rest.subarray(n);
      return s2;
    };
    const pat = this.isInitiator() ? this.pattern.getResponderPattern(this.responderPatternIndex++) : this.pattern.getInitiatorPattern(this.initiatorPatternIndex++);
    if (!pat) {
      throw new HandshakeError("InvalidState");
    }
    const { cipher: C } = this.config;
    const pkl = PK2();
    for (const token of pat) {
      if (token === 0) {
        const re = Uint8Array.from(take(pkl));
        this.symmetric.mixHash(re);
        if (this.pattern.hasPsk()) {
          this.symmetric.mixKey(re);
        }
        this.re = re;
      } else if (token === 1) {
        const len = this.symmetric.hasKey() ? pkl + C.tagLen : pkl;
        const bu = new Uint8Array(pkl);
        this.symmetric.decryptAndHash(take(len), bu);
        this.rs = bu;
      } else if (token === 8) {
        this.symmetric.mixKeyAndHash(this.takePsk());
      } else if (token === 2 || token === 3 || token === 4 || token === 5) {
        this.symmetric.mixKey(this.mapDh(token));
      } else {
        throw new Error("Incompatible pattern");
      }
    }
    this.symmetric.decryptAndHash(rest, out.subarray(0, outLen));
    this.updateHsStatus();
    return outLen;
  }
};
function raiseMissing() {
  throw new HandshakeError("MissingMaterial");
}
function raiseInv() {
  throw new HandshakeError("InvalidState");
}

// ../../node_modules/.pnpm/@noble+hashes@2.3.0/node_modules/@noble/hashes/_blake.js
var BSIGMA = /* @__PURE__ */ Uint8Array.from([
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9,
  12,
  5,
  1,
  15,
  14,
  13,
  4,
  10,
  0,
  7,
  6,
  3,
  9,
  2,
  8,
  11,
  13,
  11,
  7,
  14,
  12,
  1,
  3,
  9,
  5,
  0,
  15,
  4,
  8,
  6,
  2,
  10,
  6,
  15,
  14,
  9,
  11,
  3,
  0,
  8,
  12,
  2,
  13,
  7,
  1,
  4,
  10,
  5,
  10,
  2,
  8,
  4,
  7,
  6,
  1,
  5,
  15,
  11,
  9,
  14,
  3,
  12,
  13,
  0,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  // Blake1, unused in others
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9
]);
function G1s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr2(d ^ a, 16);
  c = c + d | 0;
  b = rotr2(b ^ c, 12);
  return { a, b, c, d };
}
function G2s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr2(d ^ a, 8);
  c = c + d | 0;
  b = rotr2(b ^ c, 7);
  return { a, b, c, d };
}

// ../../node_modules/.pnpm/@noble+hashes@2.3.0/node_modules/@noble/hashes/blake2.js
var B2B_IV = /* @__PURE__ */ Uint32Array.from([
  4089235720,
  1779033703,
  2227873595,
  3144134277,
  4271175723,
  1013904242,
  1595750129,
  2773480762,
  2917565137,
  1359893119,
  725511199,
  2600822924,
  4215389547,
  528734635,
  327033209,
  1541459225
]);
var BBUF = /* @__PURE__ */ new Uint32Array(32);
function G1b(a, b, c, d, msg, x) {
  const Xl = msg[x], Xh = msg[x + 1];
  let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1];
  let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1];
  let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1];
  let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1];
  const ll = add3L2(Al, Bl, Xl);
  Ah = add3H2(ll, Ah, Bh, Xh);
  Al = ll | 0;
  let xh = Dh ^ Ah, xl = Dl ^ Al;
  Dh = rotr32H(xh, xl);
  Dl = rotr32L(xh, xl);
  ({ h: Ch, l: Cl } = add2(Ch, Cl, Dh, Dl));
  xh = Bh ^ Ch;
  xl = Bl ^ Cl;
  Bh = rotrSH2(xh, xl, 24);
  Bl = rotrSL2(xh, xl, 24);
  BBUF[2 * a] = Al;
  BBUF[2 * a + 1] = Ah;
  BBUF[2 * b] = Bl;
  BBUF[2 * b + 1] = Bh;
  BBUF[2 * c] = Cl;
  BBUF[2 * c + 1] = Ch;
  BBUF[2 * d] = Dl;
  BBUF[2 * d + 1] = Dh;
}
function G2b(a, b, c, d, msg, x) {
  const Xl = msg[x], Xh = msg[x + 1];
  let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1];
  let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1];
  let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1];
  let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1];
  const ll = add3L2(Al, Bl, Xl);
  Ah = add3H2(ll, Ah, Bh, Xh);
  Al = ll | 0;
  let xh = Dh ^ Ah, xl = Dl ^ Al;
  Dh = rotrSH2(xh, xl, 16);
  Dl = rotrSL2(xh, xl, 16);
  ({ h: Ch, l: Cl } = add2(Ch, Cl, Dh, Dl));
  xh = Bh ^ Ch;
  xl = Bl ^ Cl;
  Bh = rotrBH2(xh, xl, 63);
  Bl = rotrBL2(xh, xl, 63);
  BBUF[2 * a] = Al;
  BBUF[2 * a + 1] = Ah;
  BBUF[2 * b] = Bl;
  BBUF[2 * b + 1] = Bh;
  BBUF[2 * c] = Cl;
  BBUF[2 * c + 1] = Ch;
  BBUF[2 * d] = Dl;
  BBUF[2 * d + 1] = Dh;
}
function checkBlake2Opts(outputLen, opts = {}, keyLen, saltLen, persLen) {
  anumber2(keyLen);
  if (outputLen <= 0 || outputLen > keyLen)
    throw new Error('"dkLen" must be 1..' + keyLen + ", got " + outputLen);
  const { key, salt, personalization } = opts;
  if (key !== void 0 && (key.length < 1 || key.length > keyLen))
    throw new Error('"key" expected to be undefined or of length=1..' + keyLen);
  if (salt !== void 0)
    abytes2(salt, saltLen, "salt");
  if (personalization !== void 0)
    abytes2(personalization, persLen, "personalization");
}
var _BLAKE2 = class {
  buffer;
  buffer32;
  finished = false;
  destroyed = false;
  length = 0;
  pos = 0;
  blockLen;
  outputLen;
  canXOF = false;
  constructor(blockLen, outputLen) {
    anumber2(blockLen);
    anumber2(outputLen);
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.buffer = new Uint8Array(blockLen);
    this.buffer32 = u32(this.buffer);
  }
  update(data) {
    aexists2(this);
    abytes2(data);
    const { blockLen, buffer, buffer32 } = this;
    const len = data.length;
    const offset = data.byteOffset;
    const buf = data.buffer;
    for (let pos = 0; pos < len; ) {
      if (this.pos === blockLen) {
        swap32IfBE(buffer32);
        this.compress(buffer32, 0, false);
        swap32IfBE(buffer32);
        this.pos = 0;
      }
      const take = Math.min(blockLen - this.pos, len - pos);
      const dataOffset = offset + pos;
      if (take === blockLen && !(dataOffset % 4) && pos + take < len) {
        const data32 = new Uint32Array(buf, dataOffset, Math.floor((len - pos) / 4));
        swap32IfBE(data32);
        for (let pos32 = 0; pos + blockLen < len; pos32 += buffer32.length, pos += blockLen) {
          this.length += blockLen;
          this.compress(data32, pos32, false);
        }
        swap32IfBE(data32);
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      this.length += take;
      pos += take;
    }
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    if (out.byteOffset & 3)
      throw new RangeError('"output" expected 4-byte aligned byteOffset, got ' + out.byteOffset);
    const { pos, buffer32 } = this;
    this.finished = true;
    this.buffer.fill(0, pos);
    swap32IfBE(buffer32);
    this.compress(buffer32, 0, true);
    swap32IfBE(buffer32);
    const state = this.get();
    const out32 = out === this.buffer ? buffer32 : u32(out);
    const full = Math.floor(this.outputLen / 4);
    for (let i = 0; i < full; i++)
      out32[i] = swap8IfBE(state[i]);
    const tail = this.outputLen % 4;
    if (!tail)
      return;
    const off = full * 4;
    const word = state[full];
    for (let i = 0; i < tail; i++)
      out[off + i] = word >>> 8 * i;
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    const { buffer, length, finished, destroyed, outputLen, pos } = this;
    to ||= new this.constructor({ dkLen: outputLen });
    to.set(...this.get());
    to.buffer.set(buffer);
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    to.outputLen = outputLen;
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var _BLAKE2b = class extends _BLAKE2 {
  // Same IV words as SHA-512 / BLAKE2b, encoded as LE u32 low/high halves.
  v0l = B2B_IV[0] | 0;
  v0h = B2B_IV[1] | 0;
  v1l = B2B_IV[2] | 0;
  v1h = B2B_IV[3] | 0;
  v2l = B2B_IV[4] | 0;
  v2h = B2B_IV[5] | 0;
  v3l = B2B_IV[6] | 0;
  v3h = B2B_IV[7] | 0;
  v4l = B2B_IV[8] | 0;
  v4h = B2B_IV[9] | 0;
  v5l = B2B_IV[10] | 0;
  v5h = B2B_IV[11] | 0;
  v6l = B2B_IV[12] | 0;
  v6h = B2B_IV[13] | 0;
  v7l = B2B_IV[14] | 0;
  v7h = B2B_IV[15] | 0;
  constructor(opts = {}) {
    opts = checkOpts({}, opts);
    const olen = opts.dkLen === void 0 ? 64 : opts.dkLen;
    super(128, olen);
    checkBlake2Opts(olen, opts, 64, 16, 16);
    let { key, personalization, salt } = opts;
    let keyLength = 0;
    if (key !== void 0) {
      abytes2(key, void 0, "key");
      keyLength = key.length;
    }
    this.v0l ^= this.outputLen | keyLength << 8 | 1 << 16 | 1 << 24;
    if (salt !== void 0) {
      abytes2(salt, void 0, "salt");
      const slt = u32(copyBytes2(salt));
      this.v4l ^= swap8IfBE(slt[0]);
      this.v4h ^= swap8IfBE(slt[1]);
      this.v5l ^= swap8IfBE(slt[2]);
      this.v5h ^= swap8IfBE(slt[3]);
    }
    if (personalization !== void 0) {
      abytes2(personalization, void 0, "personalization");
      const pers = u32(copyBytes2(personalization));
      this.v6l ^= swap8IfBE(pers[0]);
      this.v6h ^= swap8IfBE(pers[1]);
      this.v7l ^= swap8IfBE(pers[2]);
      this.v7h ^= swap8IfBE(pers[3]);
    }
    if (key !== void 0) {
      const tmp = new Uint8Array(this.blockLen);
      tmp.set(key);
      this.update(tmp);
      clean2(tmp);
    }
  }
  // prettier-ignore
  get() {
    let { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
    return [v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h];
  }
  // prettier-ignore
  set(v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h) {
    this.v0l = v0l | 0;
    this.v0h = v0h | 0;
    this.v1l = v1l | 0;
    this.v1h = v1h | 0;
    this.v2l = v2l | 0;
    this.v2h = v2h | 0;
    this.v3l = v3l | 0;
    this.v3h = v3h | 0;
    this.v4l = v4l | 0;
    this.v4h = v4h | 0;
    this.v5l = v5l | 0;
    this.v5h = v5h | 0;
    this.v6l = v6l | 0;
    this.v6h = v6h | 0;
    this.v7l = v7l | 0;
    this.v7h = v7h | 0;
  }
  compress(msg, offset, isLast) {
    const { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
    {
      BBUF[0] = v0l;
      BBUF[1] = v0h;
      BBUF[2] = v1l;
      BBUF[3] = v1h;
      BBUF[4] = v2l;
      BBUF[5] = v2h;
      BBUF[6] = v3l;
      BBUF[7] = v3h;
      BBUF[8] = v4l;
      BBUF[9] = v4h;
      BBUF[10] = v5l;
      BBUF[11] = v5h;
      BBUF[12] = v6l;
      BBUF[13] = v6h;
      BBUF[14] = v7l;
      BBUF[15] = v7h;
    }
    BBUF.set(B2B_IV, 16);
    const l = fromNumL(this.length);
    const h = fromNumH(this.length);
    BBUF[24] = B2B_IV[8] ^ l;
    BBUF[25] = B2B_IV[9] ^ h;
    if (isLast) {
      BBUF[28] = ~BBUF[28];
      BBUF[29] = ~BBUF[29];
    }
    let j = 0;
    const s2 = BSIGMA;
    for (let i = 0; i < 12; i++) {
      G1b(0, 4, 8, 12, msg, offset + 2 * s2[j++]);
      G2b(0, 4, 8, 12, msg, offset + 2 * s2[j++]);
      G1b(1, 5, 9, 13, msg, offset + 2 * s2[j++]);
      G2b(1, 5, 9, 13, msg, offset + 2 * s2[j++]);
      G1b(2, 6, 10, 14, msg, offset + 2 * s2[j++]);
      G2b(2, 6, 10, 14, msg, offset + 2 * s2[j++]);
      G1b(3, 7, 11, 15, msg, offset + 2 * s2[j++]);
      G2b(3, 7, 11, 15, msg, offset + 2 * s2[j++]);
      G1b(0, 5, 10, 15, msg, offset + 2 * s2[j++]);
      G2b(0, 5, 10, 15, msg, offset + 2 * s2[j++]);
      G1b(1, 6, 11, 12, msg, offset + 2 * s2[j++]);
      G2b(1, 6, 11, 12, msg, offset + 2 * s2[j++]);
      G1b(2, 7, 8, 13, msg, offset + 2 * s2[j++]);
      G2b(2, 7, 8, 13, msg, offset + 2 * s2[j++]);
      G1b(3, 4, 9, 14, msg, offset + 2 * s2[j++]);
      G2b(3, 4, 9, 14, msg, offset + 2 * s2[j++]);
    }
    this.v0l ^= BBUF[0] ^ BBUF[16];
    this.v0h ^= BBUF[1] ^ BBUF[17];
    this.v1l ^= BBUF[2] ^ BBUF[18];
    this.v1h ^= BBUF[3] ^ BBUF[19];
    this.v2l ^= BBUF[4] ^ BBUF[20];
    this.v2h ^= BBUF[5] ^ BBUF[21];
    this.v3l ^= BBUF[6] ^ BBUF[22];
    this.v3h ^= BBUF[7] ^ BBUF[23];
    this.v4l ^= BBUF[8] ^ BBUF[24];
    this.v4h ^= BBUF[9] ^ BBUF[25];
    this.v5l ^= BBUF[10] ^ BBUF[26];
    this.v5h ^= BBUF[11] ^ BBUF[27];
    this.v6l ^= BBUF[12] ^ BBUF[28];
    this.v6h ^= BBUF[13] ^ BBUF[29];
    this.v7l ^= BBUF[14] ^ BBUF[30];
    this.v7h ^= BBUF[15] ^ BBUF[31];
    clean2(BBUF);
  }
  destroy() {
    this.destroyed = true;
    clean2(this.buffer32);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var blake2b = /* @__PURE__ */ createHasher2((opts) => new _BLAKE2b(opts));
function _compress(s2, offset, msg, rounds, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15) {
  let j = 0;
  for (let i = 0; i < rounds; i++) {
    ({ a: v0, b: v4, c: v8, d: v12 } = G1s(v0, v4, v8, v12, msg[offset + s2[j++]]));
    ({ a: v0, b: v4, c: v8, d: v12 } = G2s(v0, v4, v8, v12, msg[offset + s2[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G1s(v1, v5, v9, v13, msg[offset + s2[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G2s(v1, v5, v9, v13, msg[offset + s2[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G1s(v2, v6, v10, v14, msg[offset + s2[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G2s(v2, v6, v10, v14, msg[offset + s2[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G1s(v3, v7, v11, v15, msg[offset + s2[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G2s(v3, v7, v11, v15, msg[offset + s2[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G1s(v0, v5, v10, v15, msg[offset + s2[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G2s(v0, v5, v10, v15, msg[offset + s2[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G1s(v1, v6, v11, v12, msg[offset + s2[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G2s(v1, v6, v11, v12, msg[offset + s2[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G1s(v2, v7, v8, v13, msg[offset + s2[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G2s(v2, v7, v8, v13, msg[offset + s2[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G1s(v3, v4, v9, v14, msg[offset + s2[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G2s(v3, v4, v9, v14, msg[offset + s2[j++]]));
  }
  return { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 };
}
var B2S_IV = /* @__PURE__ */ SHA256_IV2.slice();
var _BLAKE2s = class extends _BLAKE2 {
  // Internal state, same as SHA-256
  v0 = B2S_IV[0] | 0;
  v1 = B2S_IV[1] | 0;
  v2 = B2S_IV[2] | 0;
  v3 = B2S_IV[3] | 0;
  v4 = B2S_IV[4] | 0;
  v5 = B2S_IV[5] | 0;
  v6 = B2S_IV[6] | 0;
  v7 = B2S_IV[7] | 0;
  constructor(opts = {}) {
    opts = checkOpts({}, opts);
    const olen = opts.dkLen === void 0 ? 32 : opts.dkLen;
    super(64, olen);
    checkBlake2Opts(olen, opts, 32, 8, 8);
    let { key, personalization, salt } = opts;
    let keyLength = 0;
    if (key !== void 0) {
      abytes2(key, void 0, "key");
      keyLength = key.length;
    }
    this.v0 ^= this.outputLen | keyLength << 8 | 1 << 16 | 1 << 24;
    if (salt !== void 0) {
      abytes2(salt, void 0, "salt");
      const slt = u32(copyBytes2(salt));
      this.v4 ^= swap8IfBE(slt[0]);
      this.v5 ^= swap8IfBE(slt[1]);
    }
    if (personalization !== void 0) {
      abytes2(personalization, void 0, "personalization");
      const pers = u32(copyBytes2(personalization));
      this.v6 ^= swap8IfBE(pers[0]);
      this.v7 ^= swap8IfBE(pers[1]);
    }
    if (key !== void 0) {
      const tmp = new Uint8Array(this.blockLen);
      tmp.set(key);
      this.update(tmp);
      clean2(tmp);
    }
  }
  get() {
    const { v0, v1, v2, v3, v4, v5, v6, v7 } = this;
    return [v0, v1, v2, v3, v4, v5, v6, v7];
  }
  // prettier-ignore
  set(v0, v1, v2, v3, v4, v5, v6, v7) {
    this.v0 = v0 | 0;
    this.v1 = v1 | 0;
    this.v2 = v2 | 0;
    this.v3 = v3 | 0;
    this.v4 = v4 | 0;
    this.v5 = v5 | 0;
    this.v6 = v6 | 0;
    this.v7 = v7 | 0;
  }
  compress(msg, offset, isLast) {
    const l = fromNumL(this.length);
    const h = fromNumH(this.length);
    const { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 } = _compress(BSIGMA, offset, msg, 10, this.v0, this.v1, this.v2, this.v3, this.v4, this.v5, this.v6, this.v7, B2S_IV[0], B2S_IV[1], B2S_IV[2], B2S_IV[3], l ^ B2S_IV[4], h ^ B2S_IV[5], isLast ? ~B2S_IV[6] : B2S_IV[6], B2S_IV[7]);
    this.v0 ^= v0 ^ v8;
    this.v1 ^= v1 ^ v9;
    this.v2 ^= v2 ^ v10;
    this.v3 ^= v3 ^ v11;
    this.v4 ^= v4 ^ v12;
    this.v5 ^= v5 ^ v13;
    this.v6 ^= v6 ^ v14;
    this.v7 ^= v7 ^ v15;
  }
  destroy() {
    this.destroyed = true;
    clean2(this.buffer32);
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var blake2s = /* @__PURE__ */ createHasher2((opts) => new _BLAKE2s(opts));

// ../../node_modules/.pnpm/@noble+hashes@2.3.0/node_modules/@noble/hashes/hmac.js
var _HMAC = class {
  oHash;
  iHash;
  blockLen;
  outputLen;
  canXOF = false;
  finished = false;
  destroyed = false;
  constructor(hash, key) {
    ahash(hash);
    abytes2(key, void 0, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("expected Hash instance");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean2(pad);
  }
  update(buf) {
    aexists2(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const buf = out.subarray(0, this.outputLen);
    this.iHash.digestInto(buf);
    this.oHash.update(buf);
    this.oHash.digestInto(buf);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to ||= Object.create(Object.getPrototypeOf(this), {});
    const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.canXOF = canXOF;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = /* @__PURE__ */ (() => {
  const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
  hmac_.create = (hash, key) => new _HMAC(hash, key);
  return hmac_;
})();

// ../../node_modules/.pnpm/@lukeburns+clatterjs@1.0.0/node_modules/@lukeburns/clatterjs/dist/crypto/hash.js
function makeHash(name2, hash, hashLen, blockLen) {
  const doHash = (data) => hash.create().update(data).digest();
  const hmac1 = (key, data) => hmac(hash, key, data);
  const hmacMany = (key, parts) => hmac1(key, parts.length === 1 ? parts[0] : concatBytes2(...parts));
  return {
    name: name2,
    hashLen,
    blockLen,
    hash: doHash,
    hmac: hmac1,
    hmacMany,
    hkdf(ck, ikm) {
      const temp = hmac1(ck, ikm);
      const o1 = hmac1(temp, new Uint8Array([1]));
      const o2 = hmacMany(temp, [o1, new Uint8Array([2])]);
      return [o1, o2];
    },
    hkdf3(ck, ikm) {
      const temp = hmac1(ck, ikm);
      const o1 = hmac1(temp, new Uint8Array([1]));
      const o2 = hmacMany(temp, [o1, new Uint8Array([2])]);
      const o3 = hmacMany(temp, [o2, new Uint8Array([3])]);
      return [o1, o2, o3];
    },
    newOutput() {
      return new Uint8Array(hashLen);
    }
  };
}
var sha256H = makeHash("SHA256", sha256, 32, 64);
var sha512H = makeHash("SHA512", sha5122, 64, 128);
var blake2bH = makeHash("BLAKE2b", blake2b, 64, 128);
var blake2sH = makeHash("BLAKE2s", blake2s, 32, 64);

// ../../node_modules/.pnpm/@noble+ciphers@2.3.0/node_modules/@noble/ciphers/utils.js
function isBytes4(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle3 = (title) => title ? `"${title}" ` : "";
function abool2(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle3(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function anumber4(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle3(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle3(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes4(value, length, title = "") {
  if (isBytes4(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber4(length, "length");
  const bytes = isBytes4(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle3(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
var aobject3 = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(label === "object" ? "expected valid options object" : `"${label}" expected object, got type=${typeof value}`);
};
function aexists3(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput3(out, instance) {
  abytes4(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function u322(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean3(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView3(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
var isLE2 = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap2(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
function byteSwap322(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap2(arr[i]);
  }
  return arr;
}
var swap32IfBE2 = isLE2 ? (u) => u : byteSwap322;
function checkOpts2(defaults, opts) {
  aobject3(defaults, "defaults");
  aobject3(opts, "opts");
  const merged = Object.assign(defaults, opts);
  return merged;
}
function equalBytes2(a, b) {
  a = abytes4(a);
  b = abytes4(b);
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function wrapMacConstructor(keyLen, macCons, fromMsg) {
  const mac = macCons;
  const getArgs = fromMsg || (() => []);
  const macC = (msg, key) => mac(key, ...getArgs(msg)).update(msg).digest();
  const tmp = mac(new Uint8Array(keyLen), ...getArgs(new Uint8Array(0)));
  macC.outputLen = tmp.outputLen;
  macC.blockLen = tmp.blockLen;
  macC.create = (key, ...args) => mac(key, ...args);
  return macC;
}
var wrapCipher = /* @__NO_SIDE_EFFECTS__ */ (params, constructor) => {
  function wrappedCipher(key, ...args) {
    abytes4(key, void 0, "key");
    if (params.nonceLength !== void 0) {
      const nonce = args[0];
      abytes4(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
    }
    const tagl = params.tagLength;
    const aadStart = params.nonceLength !== void 0 ? 1 : 0;
    if (!params.withAAD) {
      for (let i = aadStart; i < args.length; i++)
        if (isBytes4(args[i]))
          throw new Error("AAD not supported");
    }
    if (params.withAAD && args[aadStart] !== void 0)
      abytes4(args[aadStart], void 0, "AAD");
    const cipher = constructor(key, ...args);
    const checkOutput = (fnLength, output) => {
      if (output !== void 0) {
        if (fnLength !== 2)
          throw new Error("cipher output not supported");
        abytes4(output, void 0, "output");
      }
    };
    let called = false;
    const wrCipher = {
      encrypt(data, output) {
        if (called)
          throw new Error("cannot encrypt() twice with same key + nonce");
        called = true;
        abytes4(data, void 0, "data");
        checkOutput(cipher.encrypt.length, output);
        return cipher.encrypt(data, output);
      },
      decrypt(data, output) {
        abytes4(data, void 0, "data");
        if (tagl && data.length < tagl)
          throw new Error('"ciphertext" expected length >= tagLength=' + tagl);
        checkOutput(cipher.decrypt.length, output);
        return cipher.decrypt(data, output);
      }
    };
    return wrCipher;
  }
  Object.assign(wrappedCipher, params);
  return wrappedCipher;
};
function getOutput(expectedLength, out, onlyAligned = true) {
  if (out === void 0)
    return new Uint8Array(expectedLength);
  abytes4(out, expectedLength, "output");
  if (onlyAligned && !isAligned32(out))
    throw new Error("invalid output, must be aligned");
  return out;
}
function u64Lengths(dataLength, aadLength, isLE3) {
  anumber4(dataLength);
  anumber4(aadLength);
  abool2(isLE3);
  const num = new Uint8Array(16);
  const view = createView3(num);
  view.setBigUint64(0, BigInt(aadLength), isLE3);
  view.setBigUint64(8, BigInt(dataLength), isLE3);
  return num;
}
function isAligned32(bytes) {
  return bytes.byteOffset % 4 === 0;
}
function copyBytes4(bytes) {
  return Uint8Array.from(abytes4(bytes));
}

// ../../node_modules/.pnpm/@noble+ciphers@2.3.0/node_modules/@noble/ciphers/_arx.js
var encodeStr = (str) => Uint8Array.from(str.split(""), (c) => c.charCodeAt(0));
var sigma16_32 = /* @__PURE__ */ (() => swap32IfBE2(u322(encodeStr("expand 16-byte k"))))();
var sigma32_32 = /* @__PURE__ */ (() => swap32IfBE2(u322(encodeStr("expand 32-byte k"))))();
function rotl(a, b) {
  return a << b | a >>> 32 - b;
}
var BLOCK_LEN = 64;
var BLOCK_LEN32 = 16;
var MAX_COUNTER = /* @__PURE__ */ (() => 2 ** 32 - 1)();
var U32_EMPTY = /* @__PURE__ */ Uint32Array.of();
function runCipher(core, sigma, key, nonce, data, output, counter, rounds) {
  const len = data.length;
  const block = new Uint8Array(BLOCK_LEN);
  const b32 = u322(block);
  const isAligned = isLE2 && isAligned32(data) && isAligned32(output);
  const d32 = isAligned ? u322(data) : U32_EMPTY;
  const o32 = isAligned ? u322(output) : U32_EMPTY;
  if (!isLE2) {
    for (let pos = 0; pos < len; counter++) {
      core(sigma, key, nonce, b32, counter, rounds);
      swap32IfBE2(b32);
      if (counter >= MAX_COUNTER)
        throw new Error("arx: counter overflow");
      const take = Math.min(BLOCK_LEN, len - pos);
      for (let j = 0, posj; j < take; j++) {
        posj = pos + j;
        output[posj] = data[posj] ^ block[j];
      }
      pos += take;
    }
    return;
  }
  for (let pos = 0; pos < len; counter++) {
    core(sigma, key, nonce, b32, counter, rounds);
    if (counter >= MAX_COUNTER)
      throw new Error("arx: counter overflow");
    const take = Math.min(BLOCK_LEN, len - pos);
    if (isAligned && take === BLOCK_LEN) {
      const pos32 = pos / 4;
      if (pos % 4 !== 0)
        throw new Error("arx: invalid block position");
      for (let j = 0, posj; j < BLOCK_LEN32; j++) {
        posj = pos32 + j;
        o32[posj] = d32[posj] ^ b32[j];
      }
      pos += BLOCK_LEN;
      continue;
    }
    for (let j = 0, posj; j < take; j++) {
      posj = pos + j;
      output[posj] = data[posj] ^ block[j];
    }
    pos += take;
  }
}
function createCipher(core, opts) {
  const { allowShortKeys, extendNonceFn, counterLength, counterRight, rounds } = checkOpts2({ allowShortKeys: false, counterLength: 8, counterRight: false, rounds: 20 }, opts);
  if (typeof core !== "function")
    throw new Error("core must be a function");
  anumber4(counterLength);
  anumber4(rounds);
  abool2(counterRight);
  abool2(allowShortKeys);
  return (key, nonce, data, output, counter = 0) => {
    abytes4(key, void 0, "key");
    abytes4(nonce, void 0, "nonce");
    abytes4(data, void 0, "data");
    const len = data.length;
    output = getOutput(len, output, false);
    anumber4(counter);
    if (counter < 0 || counter >= MAX_COUNTER)
      throw new Error("arx: counter overflow");
    const toClean = [];
    let l = key.length;
    let k;
    let sigma;
    if (l === 32) {
      toClean.push(k = copyBytes4(key));
      sigma = sigma32_32;
    } else if (l === 16 && allowShortKeys) {
      k = new Uint8Array(32);
      k.set(key);
      k.set(key, 16);
      sigma = sigma16_32;
      toClean.push(k);
    } else {
      abytes4(key, 32, "arx key");
      throw new Error("invalid key size");
    }
    if (!isLE2 || !isAligned32(nonce))
      toClean.push(nonce = copyBytes4(nonce));
    let k32 = u322(k);
    if (extendNonceFn) {
      if (nonce.length !== 24)
        throw new Error("arx: extended nonce must be 24 bytes");
      const n16 = nonce.subarray(0, 16);
      if (isLE2)
        extendNonceFn(sigma, k32, u322(n16), k32);
      else {
        const sigmaRaw = swap32IfBE2(Uint32Array.from(sigma));
        extendNonceFn(sigmaRaw, k32, u322(n16), k32);
        clean3(sigmaRaw);
        swap32IfBE2(k32);
      }
      nonce = nonce.subarray(16);
    } else if (!isLE2)
      swap32IfBE2(k32);
    const nonceNcLen = 16 - counterLength;
    if (nonceNcLen !== nonce.length)
      throw new Error(`arx: nonce must be ${nonceNcLen} or 16 bytes`);
    if (nonceNcLen !== 12) {
      const nc3 = new Uint8Array(12);
      nc3.set(nonce, counterRight ? 0 : 12 - nonce.length);
      nonce = nc3;
      toClean.push(nonce);
    }
    const n32 = swap32IfBE2(u322(nonce));
    try {
      runCipher(core, sigma, k32, n32, data, output, counter, rounds);
      return output;
    } finally {
      clean3(...toClean);
    }
  };
}

// ../../node_modules/.pnpm/@noble+ciphers@2.3.0/node_modules/@noble/ciphers/_poly1305.js
function u8to16(a, i) {
  return a[i++] & 255 | (a[i++] & 255) << 8;
}
var Poly1305 = class {
  blockLen = 16;
  outputLen = 16;
  buffer = new Uint8Array(16);
  r = new Uint16Array(10);
  // Allocating 1 array with .subarray() here is slower than 3
  h = new Uint16Array(10);
  pad = new Uint16Array(8);
  pos = 0;
  finished = false;
  destroyed = false;
  // Can be speed-up using BigUint64Array, at the cost of complexity
  constructor(key) {
    key = copyBytes4(abytes4(key, 32, "key"));
    const t0 = u8to16(key, 0);
    const t1 = u8to16(key, 2);
    const t2 = u8to16(key, 4);
    const t3 = u8to16(key, 6);
    const t4 = u8to16(key, 8);
    const t5 = u8to16(key, 10);
    const t6 = u8to16(key, 12);
    const t7 = u8to16(key, 14);
    this.r[0] = t0 & 8191;
    this.r[1] = (t0 >>> 13 | t1 << 3) & 8191;
    this.r[2] = (t1 >>> 10 | t2 << 6) & 7939;
    this.r[3] = (t2 >>> 7 | t3 << 9) & 8191;
    this.r[4] = (t3 >>> 4 | t4 << 12) & 255;
    this.r[5] = t4 >>> 1 & 8190;
    this.r[6] = (t4 >>> 14 | t5 << 2) & 8191;
    this.r[7] = (t5 >>> 11 | t6 << 5) & 8065;
    this.r[8] = (t6 >>> 8 | t7 << 8) & 8191;
    this.r[9] = t7 >>> 5 & 127;
    for (let i = 0; i < 8; i++)
      this.pad[i] = u8to16(key, 16 + 2 * i);
  }
  process(data, offset, isLast = false) {
    const hibit = isLast ? 0 : 1 << 11;
    const { h, r } = this;
    const r0 = r[0];
    const r1 = r[1];
    const r2 = r[2];
    const r3 = r[3];
    const r4 = r[4];
    const r5 = r[5];
    const r6 = r[6];
    const r7 = r[7];
    const r8 = r[8];
    const r9 = r[9];
    const t0 = u8to16(data, offset + 0);
    const t1 = u8to16(data, offset + 2);
    const t2 = u8to16(data, offset + 4);
    const t3 = u8to16(data, offset + 6);
    const t4 = u8to16(data, offset + 8);
    const t5 = u8to16(data, offset + 10);
    const t6 = u8to16(data, offset + 12);
    const t7 = u8to16(data, offset + 14);
    let h0 = h[0] + (t0 & 8191);
    let h1 = h[1] + ((t0 >>> 13 | t1 << 3) & 8191);
    let h2 = h[2] + ((t1 >>> 10 | t2 << 6) & 8191);
    let h3 = h[3] + ((t2 >>> 7 | t3 << 9) & 8191);
    let h4 = h[4] + ((t3 >>> 4 | t4 << 12) & 8191);
    let h5 = h[5] + (t4 >>> 1 & 8191);
    let h6 = h[6] + ((t4 >>> 14 | t5 << 2) & 8191);
    let h7 = h[7] + ((t5 >>> 11 | t6 << 5) & 8191);
    let h8 = h[8] + ((t6 >>> 8 | t7 << 8) & 8191);
    let h9 = h[9] + (t7 >>> 5 | hibit);
    let c = 0;
    let d0 = c + h0 * r0 + h1 * (5 * r9) + h2 * (5 * r8) + h3 * (5 * r7) + h4 * (5 * r6);
    c = d0 >>> 13;
    d0 &= 8191;
    d0 += h5 * (5 * r5) + h6 * (5 * r4) + h7 * (5 * r3) + h8 * (5 * r2) + h9 * (5 * r1);
    c += d0 >>> 13;
    d0 &= 8191;
    let d1 = c + h0 * r1 + h1 * r0 + h2 * (5 * r9) + h3 * (5 * r8) + h4 * (5 * r7);
    c = d1 >>> 13;
    d1 &= 8191;
    d1 += h5 * (5 * r6) + h6 * (5 * r5) + h7 * (5 * r4) + h8 * (5 * r3) + h9 * (5 * r2);
    c += d1 >>> 13;
    d1 &= 8191;
    let d2 = c + h0 * r2 + h1 * r1 + h2 * r0 + h3 * (5 * r9) + h4 * (5 * r8);
    c = d2 >>> 13;
    d2 &= 8191;
    d2 += h5 * (5 * r7) + h6 * (5 * r6) + h7 * (5 * r5) + h8 * (5 * r4) + h9 * (5 * r3);
    c += d2 >>> 13;
    d2 &= 8191;
    let d3 = c + h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * (5 * r9);
    c = d3 >>> 13;
    d3 &= 8191;
    d3 += h5 * (5 * r8) + h6 * (5 * r7) + h7 * (5 * r6) + h8 * (5 * r5) + h9 * (5 * r4);
    c += d3 >>> 13;
    d3 &= 8191;
    let d4 = c + h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;
    c = d4 >>> 13;
    d4 &= 8191;
    d4 += h5 * (5 * r9) + h6 * (5 * r8) + h7 * (5 * r7) + h8 * (5 * r6) + h9 * (5 * r5);
    c += d4 >>> 13;
    d4 &= 8191;
    let d5 = c + h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1;
    c = d5 >>> 13;
    d5 &= 8191;
    d5 += h5 * r0 + h6 * (5 * r9) + h7 * (5 * r8) + h8 * (5 * r7) + h9 * (5 * r6);
    c += d5 >>> 13;
    d5 &= 8191;
    let d6 = c + h0 * r6 + h1 * r5 + h2 * r4 + h3 * r3 + h4 * r2;
    c = d6 >>> 13;
    d6 &= 8191;
    d6 += h5 * r1 + h6 * r0 + h7 * (5 * r9) + h8 * (5 * r8) + h9 * (5 * r7);
    c += d6 >>> 13;
    d6 &= 8191;
    let d7 = c + h0 * r7 + h1 * r6 + h2 * r5 + h3 * r4 + h4 * r3;
    c = d7 >>> 13;
    d7 &= 8191;
    d7 += h5 * r2 + h6 * r1 + h7 * r0 + h8 * (5 * r9) + h9 * (5 * r8);
    c += d7 >>> 13;
    d7 &= 8191;
    let d8 = c + h0 * r8 + h1 * r7 + h2 * r6 + h3 * r5 + h4 * r4;
    c = d8 >>> 13;
    d8 &= 8191;
    d8 += h5 * r3 + h6 * r2 + h7 * r1 + h8 * r0 + h9 * (5 * r9);
    c += d8 >>> 13;
    d8 &= 8191;
    let d9 = c + h0 * r9 + h1 * r8 + h2 * r7 + h3 * r6 + h4 * r5;
    c = d9 >>> 13;
    d9 &= 8191;
    d9 += h5 * r4 + h6 * r3 + h7 * r2 + h8 * r1 + h9 * r0;
    c += d9 >>> 13;
    d9 &= 8191;
    c = (c << 2) + c | 0;
    c = c + d0 | 0;
    d0 = c & 8191;
    c = c >>> 13;
    d1 += c;
    h[0] = d0;
    h[1] = d1;
    h[2] = d2;
    h[3] = d3;
    h[4] = d4;
    h[5] = d5;
    h[6] = d6;
    h[7] = d7;
    h[8] = d8;
    h[9] = d9;
  }
  finalize() {
    const { h, pad } = this;
    const g = new Uint16Array(10);
    let c = h[1] >>> 13;
    h[1] &= 8191;
    for (let i = 2; i < 10; i++) {
      h[i] += c;
      c = h[i] >>> 13;
      h[i] &= 8191;
    }
    h[0] += c * 5;
    c = h[0] >>> 13;
    h[0] &= 8191;
    h[1] += c;
    c = h[1] >>> 13;
    h[1] &= 8191;
    h[2] += c;
    g[0] = h[0] + 5;
    c = g[0] >>> 13;
    g[0] &= 8191;
    for (let i = 1; i < 10; i++) {
      g[i] = h[i] + c;
      c = g[i] >>> 13;
      g[i] &= 8191;
    }
    g[9] -= 1 << 13;
    let mask = (c ^ 1) - 1;
    for (let i = 0; i < 10; i++)
      g[i] &= mask;
    mask = ~mask;
    for (let i = 0; i < 10; i++)
      h[i] = h[i] & mask | g[i];
    h[0] = (h[0] | h[1] << 13) & 65535;
    h[1] = (h[1] >>> 3 | h[2] << 10) & 65535;
    h[2] = (h[2] >>> 6 | h[3] << 7) & 65535;
    h[3] = (h[3] >>> 9 | h[4] << 4) & 65535;
    h[4] = (h[4] >>> 12 | h[5] << 1 | h[6] << 14) & 65535;
    h[5] = (h[6] >>> 2 | h[7] << 11) & 65535;
    h[6] = (h[7] >>> 5 | h[8] << 8) & 65535;
    h[7] = (h[8] >>> 8 | h[9] << 5) & 65535;
    let f = h[0] + pad[0];
    h[0] = f & 65535;
    for (let i = 1; i < 8; i++) {
      f = (h[i] + pad[i] | 0) + (f >>> 16) | 0;
      h[i] = f & 65535;
    }
    clean3(g);
  }
  update(data) {
    aexists3(this);
    abytes4(data);
    data = copyBytes4(data);
    const { buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(data, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(buffer, 0, false);
        this.pos = 0;
      }
    }
    return this;
  }
  destroy() {
    this.destroyed = true;
    clean3(this.h, this.r, this.buffer, this.pad);
  }
  digestInto(out) {
    aexists3(this);
    aoutput3(out, this);
    this.finished = true;
    const { buffer, h } = this;
    let { pos } = this;
    if (pos) {
      buffer[pos++] = 1;
      for (; pos < 16; pos++)
        buffer[pos] = 0;
      this.process(buffer, 0, true);
    }
    this.finalize();
    let opos = 0;
    for (let i = 0; i < 8; i++) {
      out[opos++] = h[i] >>> 0;
      out[opos++] = h[i] >>> 8;
    }
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
};
var poly1305 = /* @__PURE__ */ wrapMacConstructor(32, (key) => new Poly1305(key));

// ../../node_modules/.pnpm/@noble+ciphers@2.3.0/node_modules/@noble/ciphers/chacha.js
function chachaCore(s2, k, n, out, cnt, rounds = 20) {
  let y00 = s2[0], y01 = s2[1], y02 = s2[2], y03 = s2[3], y04 = k[0], y05 = k[1], y06 = k[2], y07 = k[3], y08 = k[4], y09 = k[5], y10 = k[6], y11 = k[7], y12 = cnt, y13 = n[0], y14 = n[1], y15 = n[2];
  let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
  for (let r = 0; r < rounds; r += 2) {
    x00 = x00 + x04 | 0;
    x12 = rotl(x12 ^ x00, 16);
    x08 = x08 + x12 | 0;
    x04 = rotl(x04 ^ x08, 12);
    x00 = x00 + x04 | 0;
    x12 = rotl(x12 ^ x00, 8);
    x08 = x08 + x12 | 0;
    x04 = rotl(x04 ^ x08, 7);
    x01 = x01 + x05 | 0;
    x13 = rotl(x13 ^ x01, 16);
    x09 = x09 + x13 | 0;
    x05 = rotl(x05 ^ x09, 12);
    x01 = x01 + x05 | 0;
    x13 = rotl(x13 ^ x01, 8);
    x09 = x09 + x13 | 0;
    x05 = rotl(x05 ^ x09, 7);
    x02 = x02 + x06 | 0;
    x14 = rotl(x14 ^ x02, 16);
    x10 = x10 + x14 | 0;
    x06 = rotl(x06 ^ x10, 12);
    x02 = x02 + x06 | 0;
    x14 = rotl(x14 ^ x02, 8);
    x10 = x10 + x14 | 0;
    x06 = rotl(x06 ^ x10, 7);
    x03 = x03 + x07 | 0;
    x15 = rotl(x15 ^ x03, 16);
    x11 = x11 + x15 | 0;
    x07 = rotl(x07 ^ x11, 12);
    x03 = x03 + x07 | 0;
    x15 = rotl(x15 ^ x03, 8);
    x11 = x11 + x15 | 0;
    x07 = rotl(x07 ^ x11, 7);
    x00 = x00 + x05 | 0;
    x15 = rotl(x15 ^ x00, 16);
    x10 = x10 + x15 | 0;
    x05 = rotl(x05 ^ x10, 12);
    x00 = x00 + x05 | 0;
    x15 = rotl(x15 ^ x00, 8);
    x10 = x10 + x15 | 0;
    x05 = rotl(x05 ^ x10, 7);
    x01 = x01 + x06 | 0;
    x12 = rotl(x12 ^ x01, 16);
    x11 = x11 + x12 | 0;
    x06 = rotl(x06 ^ x11, 12);
    x01 = x01 + x06 | 0;
    x12 = rotl(x12 ^ x01, 8);
    x11 = x11 + x12 | 0;
    x06 = rotl(x06 ^ x11, 7);
    x02 = x02 + x07 | 0;
    x13 = rotl(x13 ^ x02, 16);
    x08 = x08 + x13 | 0;
    x07 = rotl(x07 ^ x08, 12);
    x02 = x02 + x07 | 0;
    x13 = rotl(x13 ^ x02, 8);
    x08 = x08 + x13 | 0;
    x07 = rotl(x07 ^ x08, 7);
    x03 = x03 + x04 | 0;
    x14 = rotl(x14 ^ x03, 16);
    x09 = x09 + x14 | 0;
    x04 = rotl(x04 ^ x09, 12);
    x03 = x03 + x04 | 0;
    x14 = rotl(x14 ^ x03, 8);
    x09 = x09 + x14 | 0;
    x04 = rotl(x04 ^ x09, 7);
  }
  let oi = 0;
  out[oi++] = y00 + x00 | 0;
  out[oi++] = y01 + x01 | 0;
  out[oi++] = y02 + x02 | 0;
  out[oi++] = y03 + x03 | 0;
  out[oi++] = y04 + x04 | 0;
  out[oi++] = y05 + x05 | 0;
  out[oi++] = y06 + x06 | 0;
  out[oi++] = y07 + x07 | 0;
  out[oi++] = y08 + x08 | 0;
  out[oi++] = y09 + x09 | 0;
  out[oi++] = y10 + x10 | 0;
  out[oi++] = y11 + x11 | 0;
  out[oi++] = y12 + x12 | 0;
  out[oi++] = y13 + x13 | 0;
  out[oi++] = y14 + x14 | 0;
  out[oi++] = y15 + x15 | 0;
}
var chacha20 = /* @__PURE__ */ createCipher(chachaCore, {
  counterRight: false,
  counterLength: 4,
  allowShortKeys: false
});
var ZEROS16 = /* @__PURE__ */ new Uint8Array(16);
var updatePadded = (h, msg) => {
  h.update(msg);
  const leftover = msg.length % 16;
  if (leftover)
    h.update(ZEROS16.subarray(leftover));
};
var ZEROS32 = /* @__PURE__ */ new Uint8Array(32);
function computeTag(fn, key, nonce, ciphertext, AAD) {
  if (AAD !== void 0)
    abytes4(AAD, void 0, "AAD");
  const authKey = fn(key, nonce, ZEROS32);
  const lengths = u64Lengths(ciphertext.length, AAD ? AAD.length : 0, true);
  const h = poly1305.create(authKey);
  if (AAD)
    updatePadded(h, AAD);
  updatePadded(h, ciphertext);
  h.update(lengths);
  const res = h.digest();
  clean3(authKey, lengths);
  return res;
}
var _poly1305_aead = (xorStream) => (key, nonce, AAD) => {
  const tagLength = 16;
  return {
    encrypt(plaintext, output) {
      const plength = plaintext.length;
      output = getOutput(plength + tagLength, output, false);
      output.set(plaintext);
      const oPlain = output.subarray(0, -tagLength);
      xorStream(key, nonce, oPlain, oPlain, 1);
      const tag = computeTag(xorStream, key, nonce, oPlain, AAD);
      output.set(tag, plength);
      clean3(tag);
      return output;
    },
    decrypt(ciphertext, output) {
      output = getOutput(ciphertext.length - tagLength, output, false);
      const data = ciphertext.subarray(0, -tagLength);
      const passedTag = ciphertext.subarray(-tagLength);
      const tag = computeTag(xorStream, key, nonce, data, AAD);
      if (!equalBytes2(passedTag, tag)) {
        clean3(tag);
        throw new Error("invalid tag");
      }
      output.set(ciphertext.subarray(0, -tagLength));
      xorStream(key, nonce, output, output, 1);
      clean3(tag);
      return output;
    }
  };
};
var chacha20poly1305 = /* @__PURE__ */ wrapCipher(
  { blockSize: 64, nonceLength: 12, tagLength: 16, withAAD: true },
  /* @__PURE__ */ _poly1305_aead(chacha20)
);

// ../../node_modules/.pnpm/@lukeburns+clatterjs@1.0.0/node_modules/@lukeburns/clatterjs/dist/crypto/cipher.js
var U64_MAX2 = 0xfffffffffffffffn;
function chachaNonce(n) {
  const b = new Uint8Array(12);
  new DataView(b.buffer).setBigUint64(4, n, true);
  return b;
}
function asErr(e, op) {
  if (e instanceof CipherError)
    return e;
  return new CipherError(op, e instanceof Error ? e.message : String(e));
}
var chachaPoly = /* @__PURE__ */ (() => {
  const keyLen = 32;
  const tagLen = 16;
  return {
    name: "ChaChaPoly",
    keyLen,
    tagLen,
    encrypt(key, nonce, ad, plaintext, out) {
      const ct = chacha20poly1305(key, chachaNonce(nonce), ad).encrypt(plaintext);
      out.set(ct);
    },
    encryptInPlace(key, nonce, ad, inOut, plaintextLen) {
      const sub = inOut.subarray(0, plaintextLen + tagLen);
      const pt = inOut.subarray(0, plaintextLen);
      try {
        const ct = chacha20poly1305(key, chachaNonce(nonce), ad).encrypt(pt);
        sub.set(ct);
        return ct.length;
      } catch (e) {
        throw asErr(e, "Encrypt");
      }
    },
    decrypt(key, nonce, ad, ciphertext, out) {
      try {
        const pt = chacha20poly1305(key, chachaNonce(nonce), ad).decrypt(ciphertext);
        out.set(pt);
      } catch (e) {
        throw asErr(e, "Decrypt");
      }
    },
    decryptInPlace(key, nonce, ad, inOut, ciphertextLen) {
      const sub = inOut.subarray(0, ciphertextLen);
      try {
        const pt = chacha20poly1305(key, chachaNonce(nonce), ad).decrypt(sub);
        inOut.set(pt);
        return pt.length;
      } catch (e) {
        throw asErr(e, "Decrypt");
      }
    },
    rekey(key) {
      const kNew = new Uint8Array(MAX_KEY_LEN + MAX_TAG_LEN);
      const z = new Uint8Array(keyLen);
      const ct = chacha20poly1305(key, chachaNonce(U64_MAX2), new Uint8Array(0)).encrypt(z);
      kNew.set(ct);
      return kNew.subarray(0, keyLen);
    }
  };
})();

// ../../node_modules/.pnpm/@lukeburns+clatterjs@1.0.0/node_modules/@lukeburns/clatterjs/dist/noiseNq.js
function noiseIk() {
  return new HandshakePattern("IK", [], [
    1
    /* Token.S */
  ], [
    [
      0,
      3,
      1,
      5
      /* Token.SS */
    ]
  ], [[
    0,
    2,
    4
    /* Token.SE */
  ]]);
}

// ../crypto/dist/noise.js
var NOISE_IK_PROTOCOL = "Noise_IK_25519_ChaChaPoly_SHA256";
var NoiseIkSession = class {
  handshake;
  expectedRemoteStatic;
  transport;
  destroyed = false;
  constructor(options) {
    const localPrivate = requireKey(options.localPrivateKey, "local private key");
    const localPublic = requireKey(options.localPublicKey, "local public key");
    this.expectedRemoteStatic = requireKey(options.remotePublicKey, "remote public key");
    const initiator = options.role === "initiator";
    this.handshake = new NqHandshake(noiseIk(), {
      prologue: Uint8Array.from(options.prologue),
      initiator,
      s: { secretKey: localPrivate, publicKey: localPublic },
      ...initiator ? { rs: Uint8Array.from(this.expectedRemoteStatic) } : {},
      cipher: chachaPoly,
      hash: sha256H,
      rng: options.random ?? randomBytes
    });
    if (this.handshake.getName() !== NOISE_IK_PROTOCOL) {
      throw new NoiseSessionError("NOISE_SUITE_MISMATCH", "The Noise provider selected an unexpected cipher suite.");
    }
  }
  get protocol() {
    return NOISE_IK_PROTOCOL;
  }
  get complete() {
    return this.transport !== void 0;
  }
  get canWriteHandshake() {
    this.assertLive();
    return !this.complete && this.handshake.isWriteTurn();
  }
  writeHandshake(payload = new Uint8Array()) {
    this.assertHandshake(false);
    const output = new Uint8Array(payload.byteLength + this.handshake.getNextMessageOverhead());
    const length = this.handshake.writeMessage(payload, output);
    this.finishIfReady();
    return output.slice(0, length);
  }
  readHandshake(message) {
    this.assertHandshake(true);
    const output = new Uint8Array(message.byteLength);
    const length = this.handshake.readMessage(message, output);
    this.verifyRemoteStatic();
    this.finishIfReady();
    return output.slice(0, length);
  }
  encrypt(plaintext) {
    this.assertLive();
    if (this.transport === void 0)
      throw new NoiseSessionError("NOISE_NOT_READY", "The Noise handshake is not complete.");
    return this.transport.sendVec(plaintext);
  }
  decrypt(ciphertext) {
    this.assertLive();
    if (this.transport === void 0)
      throw new NoiseSessionError("NOISE_NOT_READY", "The Noise handshake is not complete.");
    return this.transport.receiveVec(ciphertext);
  }
  sendingCounter() {
    if (this.transport === void 0)
      return 0n;
    return this.transport.sendingNonce();
  }
  receivingCounter() {
    if (this.transport === void 0)
      return 0n;
    return this.transport.receivingNonce();
  }
  destroy() {
    this.destroyed = true;
    this.expectedRemoteStatic.fill(0);
    this.transport = void 0;
  }
  finishIfReady() {
    if (!this.handshake.isFinished())
      return;
    this.verifyRemoteStatic();
    this.transport = this.handshake.finalize();
  }
  verifyRemoteStatic() {
    const actual = this.handshake.getRemoteStatic();
    if (actual === void 0 || !constantTimeEqual(actual, this.expectedRemoteStatic)) {
      this.destroy();
      throw new NoiseSessionError("PEER_IDENTITY_MISMATCH", "The Noise peer static key does not match local trust.");
    }
  }
  assertHandshake(reading) {
    this.assertLive();
    if (this.complete)
      throw new NoiseSessionError("NOISE_ALREADY_READY", "The Noise handshake is already complete.");
    if (this.handshake.isWriteTurn() === reading) {
      throw new NoiseSessionError("NOISE_HANDSHAKE_ORDER", "The Noise handshake message arrived out of order.");
    }
  }
  assertLive() {
    if (this.destroyed)
      throw new NoiseSessionError("NOISE_DESTROYED", "The Noise session is closed.");
  }
};
var NoiseSessionError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function createNoisePrologue(connectionId, hostDeviceId, clientDeviceId) {
  for (const [name2, value] of Object.entries({ connectionId, hostDeviceId, clientDeviceId })) {
    if (value.length === 0 || value.includes("\0"))
      throw new TypeError(`${name2} is not safe for a Noise prologue`);
  }
  return new TextEncoder().encode(`DSH-REMOTE\0v=1\0connection=${connectionId}\0host=${hostDeviceId}\0client=${clientDeviceId}`);
}
function requireKey(value, label) {
  const key = fromBase64Url2(value);
  if (key.byteLength !== 32)
    throw new NoiseSessionError("INVALID_KEY", `${label} must be a 32-byte X25519 key.`);
  return Uint8Array.from(key);
}
function constantTimeEqual(left, right) {
  if (left.byteLength !== right.byteLength)
    return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1)
    different |= left[index] ^ right[index];
  return different === 0;
}

// ../crypto/dist/index.js
function generateKeyPair(privateKeyBytes) {
  const privateKey = privateKeyBytes ?? x25519.utils.randomPrivateKey();
  if (privateKey.byteLength !== 32)
    throw new Error("X25519 private keys must be 32 bytes");
  const publicKey = x25519.getPublicKey(privateKey);
  return {
    privateKey: toBase64Url2(privateKey),
    publicKey: toBase64Url2(publicKey)
  };
}
function toBase64Url2(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  const base64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function fromBase64Url2(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (typeof atob === "function") {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

// src/client-secure-transport.ts
var ClientSecureTransport = class {
  constructor(inner, identity, host) {
    this.inner = inner;
    this.identity = identity;
    this.host = host;
  }
  noise;
  unsubscribeInner;
  incoming = new SecureMessageCodec();
  outgoing = new SecureMessageCodec();
  closed = false;
  async connect() {
    this.closed = false;
    this.incoming.reset();
    this.outgoing.reset();
    await this.inner.connect();
    const info = this.inner.connectionInfo();
    if (info.localDeviceId !== this.identity.deviceId || info.remoteDeviceId !== this.host.deviceId) {
      await this.inner.close();
      throw new Error("The relay connection is bound to an unexpected device.");
    }
    const noise = new NoiseIkSession({
      role: "initiator",
      localPrivateKey: this.identity.privateKey,
      localPublicKey: this.identity.publicKey,
      remotePublicKey: this.host.publicKey,
      prologue: createNoisePrologue(info.connectionId, this.host.deviceId, this.identity.deviceId)
    });
    this.noise = noise;
    try {
      await waitForResponder(this.inner, noise);
    } catch (error) {
      noise.destroy();
      this.noise = void 0;
      await this.inner.close();
      throw error;
    }
  }
  async send(data) {
    const plaintextFrames = this.outgoing.encode(data);
    try {
      for (const plaintext of plaintextFrames) {
        await this.inner.send(this.requireNoise().encrypt(plaintext));
      }
    } catch (error) {
      await this.close().catch(() => void 0);
      throw error;
    }
  }
  onMessage(handler) {
    this.unsubscribeInner?.();
    this.unsubscribeInner = this.inner.onMessage((data) => {
      const noise = this.noise;
      if (noise === void 0 || !noise.complete || this.closed) return;
      try {
        const message = this.incoming.decode(noise.decrypt(data));
        if (message !== void 0) handler(message);
      } catch {
        void this.close();
      }
    });
    return () => {
      this.unsubscribeInner?.();
      this.unsubscribeInner = void 0;
    };
  }
  onClose(handler) {
    return this.inner.onClose?.(handler) ?? (() => void 0);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeInner?.();
    this.unsubscribeInner = void 0;
    this.incoming.reset();
    this.outgoing.reset();
    this.noise?.destroy();
    this.noise = void 0;
    await this.inner.close();
  }
  getStats() {
    return this.inner.getStats();
  }
  requireNoise() {
    if (this.noise === void 0 || !this.noise.complete || this.closed) {
      throw new Error("The authenticated Noise channel is not connected.");
    }
    return this.noise;
  }
};
async function waitForResponder(inner, noise) {
  await new Promise((resolve3, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Noise IK handshake timed out.")), 1e4);
    const unsubscribe = inner.onHandshake((step, data) => {
      if (settled) return;
      try {
        if (step !== 2) throw new Error("Noise IK responder sent an out-of-order handshake message.");
        noise.readHandshake(data);
        if (!noise.complete) throw new Error("Noise IK handshake did not complete.");
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Noise IK handshake failed."));
      }
    });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (error === void 0) resolve3();
      else reject(error);
    };
    void inner.sendHandshake(1, noise.writeHandshake()).catch((error) => {
      finish(error instanceof Error ? error : new Error("Noise IK handshake failed."));
    });
  });
}

// src/control-route.ts
var CONTROL_RPC_PREFIX = "/ds-harness-remote";

// src/ids.ts
import { randomBytes as randomBytes6 } from "node:crypto";
function uuidV7(now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 281474976710655) {
    throw new RangeError("UUIDv7 timestamp must be a non-negative 48-bit integer");
  }
  const bytes = randomBytes6(16);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 112 | bytes[6] & 15;
  bytes[8] = 128 | bytes[8] & 63;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// src/harness-version.ts
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
var LEGACY_PLACEHOLDER_VERSION = "0.0.1";
function normalizeHarnessVersion(value) {
  if (typeof value !== "string") return void 0;
  const version = value.trim();
  if (version.length === 0 || version.length > 64 || /[\u0000-\u001f]/u.test(version)) return void 0;
  return version;
}
function selectHarnessVersion(reportedVersion, distributionVersion) {
  if (reportedVersion !== void 0 && reportedVersion !== LEGACY_PLACEHOLDER_VERSION) return reportedVersion;
  return distributionVersion;
}
function harnessSessionGeneration(version) {
  if (version === void 0) return "legacy";
  const match = /^(?:dsh-)?v?(\d+)\.(\d+)\.(\d+)(?:-|$)/u.exec(version.trim());
  if (match === null) return "legacy";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return major === 0 && minor === 1 && patch >= 5 ? "v3" : "legacy";
}
async function readHarnessDistributionVersion(entrypoint = process.argv[1]) {
  if (entrypoint === void 0 || !isAbsolute(entrypoint)) return void 0;
  let directory = dirname(entrypoint);
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (manifest.name === "@deepseek-ai/dsh") return normalizeHarnessVersion(manifest.version);
    } catch {
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return void 0;
}

// src/remote-api-proxy.ts
var DIRECT_API_CALL_BYTES = 2 * 1024 * 1024;
var AGENT_PRESET_SETTINGS_NS = "agent-presets";
var LEGACY_AGENT_PRESET_ALIASES = {
  code: "ptc"
};
var RemoteHarnessApiProxy = class {
  constructor(client) {
    this.client = client;
    const call = (method) => (request, signal) => this.call(method, request, signal);
    this.api = {
      sessions: {
        list: call("session.list"),
        search: call("session.search"),
        create: call("session.create"),
        history: call("session.history"),
        models: call("session.models"),
        selectModel: call("session.selectModel"),
        rename: call("session.rename"),
        fork: call("session.fork"),
        prompt: call("session.prompt"),
        attachment: call("session.attachment"),
        updateQueue: call("session.updateQueue"),
        cancel: call("session.cancel")
      },
      subagents: {
        list: call("subagent.list"),
        history: call("subagent.history"),
        prompt: call("subagent.prompt"),
        interrupt: call("subagent.interrupt")
      },
      host: {
        describe: call("host.describe"),
        pickDirectory: call("host.pickDirectory"),
        listDirectory: call("host.listDirectory"),
        createDirectory: call("host.createDirectory"),
        openPath: call("host.openPath")
      },
      workspace: {
        list: call("workspace.list"),
        create: call("workspace.create"),
        rename: call("workspace.rename"),
        delete: call("workspace.delete"),
        insertBefore: call("workspace.insertBefore"),
        insertSessionBefore: call("workspace.insertSessionBefore"),
        archiveSession: call("workspace.archiveSession")
      },
      skills: { list: call("skill.list") },
      agentPresets: {
        list: call("agentPreset.list"),
        select: call("agentPreset.select"),
        read: call("agentPreset.read"),
        copy: call("agentPreset.copy"),
        openDocument: call("agentPreset.openDocument"),
        remove: call("agentPreset.remove")
      },
      goals: {
        create: call("goal.create"),
        edit: call("goal.edit"),
        pause: call("goal.pause"),
        resume: call("goal.resume"),
        complete: call("goal.complete"),
        clear: call("goal.clear")
      },
      settings: {
        describe: call("settings.describe"),
        openDocument: call("settings.openDocument"),
        update: call("settings.update"),
        replace: call("settings.replace"),
        mutate: call("settings.mutate")
      },
      credentials: {
        describe: call("credentials.describe"),
        set: call("credentials.set"),
        unset: call("credentials.unset")
      },
      llm: {
        providers: call("llm.providers"),
        models: call("llm.models"),
        discoverModels: call("llm.discoverModels")
      },
      events: {
        mux: (request, signal) => this.stream("mux", request, signal),
        host: (request, signal) => this.stream("host", request, signal)
      },
      downloads: {},
      respond: (message) => this.respond(message)
    };
  }
  api;
  async call(method, request, signal) {
    const params = {
      method,
      rpcId: String(request.rpcId),
      payload: normalizeLegacyRequest(method, request.payload)
    };
    const encoded = new TextEncoder().encode(JSON.stringify(params));
    const response = method === "session.attachment" || encoded.byteLength > DIRECT_API_CALL_BYTES ? await this.callTransferred(encoded, signal) : await this.client.rpc("harness.api.call", params, signal);
    if (String(response.rpcId) !== String(request.rpcId) || typeof response.result !== "object" || response.result === null) {
      throw new Error("The remote Host returned an invalid Harness API response.");
    }
    return normalizeLegacyResponse(method, response);
  }
  async callTransferred(encoded, signal) {
    if (encoded.byteLength > MAX_HARNESS_API_TRANSFER_BYTES) {
      throw new Error("The Harness API request exceeds the remote image transfer limit.");
    }
    const transferId = uuidV7();
    const totalChunks = Math.ceil(encoded.byteLength / HARNESS_API_TRANSFER_CHUNK_BYTES);
    let opened = false;
    try {
      await this.client.rpc("harness.api.transfer.open", {
        transferId,
        totalBytes: encoded.byteLength,
        totalChunks
      }, signal);
      opened = true;
      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * HARNESS_API_TRANSFER_CHUNK_BYTES;
        const chunk = encoded.subarray(start, Math.min(start + HARNESS_API_TRANSFER_CHUNK_BYTES, encoded.byteLength));
        await this.client.rpc("harness.api.transfer.chunk", {
          transferId,
          index,
          data: bytesToBase642(chunk)
        }, signal);
      }
      const committed = await this.client.rpc(
        "harness.api.transfer.commit",
        { transferId },
        signal
      );
      if (committed.kind === "inline") return committed.response;
      if (committed.transferId !== transferId || committed.totalBytes <= 0 || committed.totalBytes > MAX_HARNESS_API_TRANSFER_BYTES || committed.totalChunks !== Math.ceil(committed.totalBytes / HARNESS_API_TRANSFER_CHUNK_BYTES)) {
        throw new Error("The remote Host returned an invalid Harness API transfer descriptor.");
      }
      const responseBytes = new Uint8Array(committed.totalBytes);
      let offset = 0;
      for (let index = 0; index < committed.totalChunks; index += 1) {
        const result = await this.client.rpc(
          "harness.api.transfer.read",
          { transferId, index },
          signal
        );
        if (result.transferId !== transferId || result.index !== index) {
          throw new Error("The remote Host returned an out-of-order Harness API transfer chunk.");
        }
        const chunk = base64ToBytes2(result.data);
        const expectedBytes = Math.min(HARNESS_API_TRANSFER_CHUNK_BYTES, committed.totalBytes - offset);
        if (chunk.byteLength !== expectedBytes) {
          throw new Error("The remote Host returned an invalid Harness API transfer chunk.");
        }
        responseBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(responseBytes));
    } finally {
      if (opened) {
        await this.client.rpc("harness.api.transfer.close", { transferId }).catch(() => void 0);
      }
    }
  }
  async respond(message) {
    return this.client.rpc("harness.api.respond", { message });
  }
  async *stream(stream, request, signal) {
    const streamId = uuidV7();
    const queue = new AsyncFrameQueue();
    const unsubscribe = this.client.onEvent((event) => routeStreamEvent(event, streamId, queue));
    const unsubscribeClose = this.client.onClose(() => queue.close());
    const onAbort = () => queue.close();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      try {
        await this.client.rpc("harness.api.stream.open", {
          streamId,
          stream,
          rpcId: String(request.rpcId),
          payload: request.payload
        }, signal);
        for await (const frame of queue) yield frame;
      } catch (error) {
        if (!isRemoteDisconnect(error)) throw error;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      unsubscribe();
      unsubscribeClose();
      queue.close();
      await this.client.rpc("harness.api.stream.close", { streamId }).catch(() => void 0);
    }
  }
};
function normalizeLegacyResponse(method, response) {
  if (method !== "host.describe" || !response.result.ok) return response;
  const value = response.result.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return response;
  const description = value;
  if (typeof description.home === "string" || typeof description.cwd !== "string") return response;
  return {
    ...response,
    result: {
      ...response.result,
      value: { ...description, home: description.cwd }
    }
  };
}
function normalizeLegacyRequest(method, payload) {
  if (!isRecord2(payload)) return payload;
  if (method === "agentPreset.read") return replaceAgentPreset(payload, "agentPreset");
  if (method === "agentPreset.select") return replaceAgentPreset(payload, "agentPreset");
  if (method === "agentPreset.copy") return replaceAgentPreset(payload, "from");
  if (method === "settings.update" || method === "settings.replace" || method === "settings.mutate") {
    return replaceAgentPresetSettings(payload);
  }
  return payload;
}
function replaceAgentPreset(payload, key) {
  const value = payload[key];
  const replacement = typeof value === "string" ? LEGACY_AGENT_PRESET_ALIASES[value] : void 0;
  return replacement === void 0 ? payload : { ...payload, [key]: replacement };
}
function replaceAgentPresetSettings(payload) {
  if (payload.ns !== AGENT_PRESET_SETTINGS_NS || !isRecord2(payload.patch)) return payload;
  const patch = replaceAgentPreset(payload.patch, "default");
  return patch === payload.patch ? payload : { ...payload, patch };
}
function isRemoteDisconnect(error) {
  return error instanceof RemoteClientError && (error.code === "TRANSPORT_CLOSED" || error.code === "CLIENT_CLOSED");
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var AsyncFrameQueue = class {
  values = [];
  waiters = [];
  closed = false;
  push(value) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter === void 0) this.values.push(value);
    else waiter({ done: false, value });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: void 0 });
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      const value = this.values.shift();
      if (value !== void 0) {
        yield value;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise((resolve3) => this.waiters.push(resolve3));
      if (next.done) return;
      yield next.value;
    }
  }
};
function routeStreamEvent(event, streamId, queue) {
  if (event.event === "harness.api.frame") {
    const data = event.data;
    if (data.streamId !== streamId || typeof data.frame !== "object" || data.frame === null || typeof data.frame.rpcId !== "string" || !("payload" in data.frame)) return;
    queue.push(data.frame);
  }
  if (event.event === "harness.api.stream.closed") {
    const data = event.data;
    if (data.streamId === streamId) queue.close();
  }
}
function bytesToBase642(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 32768, bytes.byteLength)));
  }
  return btoa(binary);
}
function base64ToBytes2(value) {
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error("The remote Host returned a malformed Harness API transfer chunk.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytesToBase642(bytes) !== value) {
    throw new Error("The remote Host returned a non-canonical Harness API transfer chunk.");
  }
  return bytes;
}

// src/remote-typert-gateway.ts
var DIRECT_REMOTE_CALL_BYTES2 = 2 * 1024 * 1024;
var RemoteTypertGateway2 = class {
  constructor(client) {
    this.client = client;
  }
  async invoke(request) {
    const result = await this.dispatch(
      `${request.namespace}/${request.method}`,
      { args: request.args },
      request.signal ?? new AbortController().signal
    );
    if (result.ok) return result.value;
    throw remoteFailure(result.error);
  }
  async dispatch(endpoint, payload, signal) {
    const request = { endpoint, payload };
    const encoded = new TextEncoder().encode(JSON.stringify(request));
    let response;
    if (encoded.byteLength > DIRECT_REMOTE_CALL_BYTES2) {
      response = await this.callTransferred(encoded, signal);
    } else {
      try {
        response = await this.client.rpc("harness.remote.call", request, signal);
      } catch (error) {
        if (!hasErrorCode(error, "RESPONSE_TOO_LARGE")) throw error;
        response = await this.callTransferred(encoded, signal);
      }
    }
    return parseRpcResult(response);
  }
  async open(endpoint, payload, signal) {
    const streamId = uuidV7();
    const queue = new AsyncValueQueue();
    const unsubscribe = this.client.onEvent((event) => routeStreamEvent2(event, streamId, queue));
    const unsubscribeClose = this.client.onClose(() => {
      queue.fail(new RemoteClientError("TRANSPORT_CLOSED", "The remote Harness stream transport closed."));
    });
    const onAbort = () => queue.close();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await this.client.rpc("harness.remote.stream.open", { streamId, endpoint, payload }, signal);
    } catch (error) {
      signal.removeEventListener("abort", onAbort);
      unsubscribe();
      unsubscribeClose();
      throw error;
    }
    return this.iterate(streamId, queue, unsubscribe, unsubscribeClose, signal, onAbort);
  }
  async *iterate(streamId, queue, unsubscribe, unsubscribeClose, signal, onAbort) {
    try {
      yield* queue;
    } finally {
      signal.removeEventListener("abort", onAbort);
      unsubscribe();
      unsubscribeClose();
      queue.close();
      await this.client.rpc("harness.remote.stream.close", { streamId }).catch(() => void 0);
    }
  }
  async callTransferred(encoded, signal) {
    if (encoded.byteLength > MAX_HARNESS_API_TRANSFER_BYTES) {
      throw new Error("The Harness Remote request exceeds the transfer limit.");
    }
    const transferId = uuidV7();
    const totalChunks = Math.ceil(encoded.byteLength / HARNESS_API_TRANSFER_CHUNK_BYTES);
    let opened = false;
    try {
      await this.client.rpc("harness.remote.transfer.open", {
        transferId,
        totalBytes: encoded.byteLength,
        totalChunks
      }, signal);
      opened = true;
      for (let index = 0; index < totalChunks; index += 1) {
        const start = index * HARNESS_API_TRANSFER_CHUNK_BYTES;
        const chunk = encoded.subarray(start, Math.min(start + HARNESS_API_TRANSFER_CHUNK_BYTES, encoded.byteLength));
        await this.client.rpc("harness.remote.transfer.chunk", {
          transferId,
          index,
          data: bytesToBase643(chunk)
        }, signal);
      }
      const committed = await this.client.rpc(
        "harness.remote.transfer.commit",
        { transferId },
        signal
      );
      if (committed.kind === "inline") return committed.response;
      if (committed.transferId !== transferId || committed.totalBytes <= 0 || committed.totalBytes > MAX_HARNESS_API_TRANSFER_BYTES || committed.totalChunks !== Math.ceil(committed.totalBytes / HARNESS_API_TRANSFER_CHUNK_BYTES)) {
        throw new Error("The remote Host returned an invalid Harness Remote transfer descriptor.");
      }
      const responseBytes = new Uint8Array(committed.totalBytes);
      let offset = 0;
      for (let index = 0; index < committed.totalChunks; index += 1) {
        const result = await this.client.rpc(
          "harness.remote.transfer.read",
          { transferId, index },
          signal
        );
        if (result.transferId !== transferId || result.index !== index) {
          throw new Error("The remote Host returned an out-of-order Harness Remote transfer chunk.");
        }
        const chunk = base64ToBytes3(result.data);
        const expectedBytes = Math.min(HARNESS_API_TRANSFER_CHUNK_BYTES, committed.totalBytes - offset);
        if (chunk.byteLength !== expectedBytes) {
          throw new Error("The remote Host returned an invalid Harness Remote transfer chunk.");
        }
        responseBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(responseBytes));
    } finally {
      if (opened) await this.client.rpc("harness.remote.transfer.close", { transferId }).catch(() => void 0);
    }
  }
};
var AsyncValueQueue = class {
  values = [];
  waiters = [];
  closed = false;
  error;
  push(value) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter === void 0) this.values.push(value);
    else waiter({ done: false, value });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: void 0 });
  }
  fail(error) {
    if (this.closed) return;
    this.error = error;
    this.close();
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.values.length > 0) {
        yield this.values.shift();
        continue;
      }
      if (this.closed) {
        if (this.error !== void 0) throw this.error;
        return;
      }
      const next = await new Promise((resolve3) => this.waiters.push(resolve3));
      if (next.done) {
        if (this.error !== void 0) throw this.error;
        return;
      }
      yield next.value;
    }
  }
};
function routeStreamEvent2(event, streamId, queue) {
  if (event.event === "harness.remote.frame") {
    const data2 = event.data;
    if (data2.streamId === streamId && data2.hasValue === true) queue.push(data2.value);
    return;
  }
  if (event.event !== "harness.remote.stream.closed") return;
  const data = event.data;
  if (data.streamId !== streamId) return;
  if (data.reason === "failed") {
    const failure2 = data.failure;
    queue.fail(remoteFailure({
      code: typeof failure2?.code === "string" ? failure2.code : "internal",
      message: typeof failure2?.message === "string" ? failure2.message : "The remote Harness stream failed.",
      details: isRecord3(failure2?.details) ? failure2.details : {}
    }));
  } else {
    queue.close();
  }
}
function parseRpcResult(value) {
  if (!isRecord3(value)) throw new Error("The remote Host returned an invalid Gateway result.");
  if (value.ok === true) return Object.hasOwn(value, "value") ? { ok: true, value: value.value } : { ok: true };
  if (value.ok !== false || !isRecord3(value.error) || typeof value.error.code !== "string" || typeof value.error.message !== "string" || !isRecord3(value.error.details)) {
    throw new Error("The remote Host returned an invalid Gateway failure.");
  }
  return {
    ok: false,
    error: { code: value.error.code, message: value.error.message, details: value.error.details }
  };
}
function remoteFailure(failure2) {
  return Object.assign(new Error(failure2.message), {
    isDSHRemoteError: true,
    code: failure2.code,
    details: failure2.details
  });
}
function bytesToBase643(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 32768, bytes.byteLength)));
  }
  return btoa(binary);
}
function base64ToBytes3(value) {
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error("The remote Host returned malformed Harness Remote transfer data.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytesToBase643(bytes) !== value) throw new Error("The remote Host returned non-canonical Harness Remote transfer data.");
  return bytes;
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasErrorCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

// src/codex/permissions.ts
function codexPermissionPresetFromResponse(value) {
  const root = record(value);
  for (const settings of [root, record(root.threadSettings)]) {
    const sandbox = settings.sandbox ?? settings.sandboxPolicy;
    const type = record(sandbox).type;
    if (settings.approvalPolicy === "never" && (sandbox === "danger-full-access" || type === "dangerFullAccess")) {
      return "danger-full-access";
    }
    if (settings.approvalPolicy === "on-request" && (sandbox === "workspace-write" || type === "workspaceWrite")) {
      return "workspace-write";
    }
  }
  return void 0;
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// src/codex/virtual-harness.ts
var CODEX_SESSION_PREFIX = "codex:";
var CODEX_WORKSPACE_PREFIX = "codex-workspace:";
var CODEX_PROVIDER = "codex";
var CODEX_MODEL = "codex";
var CODEX_PAGE_LIMIT = 100;
var MAX_CODEX_PAGES = 32;
var MAX_LIVE_TOOL_OUTPUT = 128 * 1024;
var DEFAULT_HISTORY_MESSAGES = 50;
var SESSION_SEARCH_RESULT_LIMIT = 20;
var SESSION_SEARCH_SNIPPET_CODE_POINTS = 240;
var CODEX_DEFAULT_PERMISSION = "workspace-write";
var MAX_CODEX_PROMPT_PARTS = 16;
var MAX_CODEX_PROMPT_TEXT = 256 * 1024;
var MAX_CODEX_IMAGE_BASE64 = 288 * 1024 * 1024;
var CODEX_IMAGE_MEDIA_TYPES2 = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
var CODEX_IMAGE_ATTACHMENT_PREFIX = "codex-image:";
var DATA_IMAGE_URL2 = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/u;
function codexProjectWorkspaceId(projectId) {
  return `${CODEX_WORKSPACE_PREFIX}project:${projectId}`;
}
async function discoverCodexVirtualWorkspaces(client, signal) {
  return (await loadCatalog(client, signal)).workspaces;
}
var CodexVirtualHarness = class _CodexVirtualHarness {
  constructor(client, host, sessionGeneration = "legacy") {
    this.client = client;
    this.host = host;
    this.sessionGeneration = sessionGeneration;
    this.api = this.createApiProxy();
  }
  api;
  catalog;
  workspaceStreams = /* @__PURE__ */ new Set();
  controlStreams = /* @__PURE__ */ new Set();
  eventStreams = /* @__PURE__ */ new Map();
  rcMuxStreams = /* @__PURE__ */ new Set();
  rcHostStreams = /* @__PURE__ */ new Set();
  follows = /* @__PURE__ */ new Set();
  pendingRequestIds = /* @__PURE__ */ new Map();
  pendingApprovals = /* @__PURE__ */ new Map();
  pendingThreads = /* @__PURE__ */ new Map();
  blankThreads = /* @__PURE__ */ new Set();
  selectedModels = /* @__PURE__ */ new Map();
  selectedPermissions = /* @__PURE__ */ new Map();
  imageAttachments = /* @__PURE__ */ new Map();
  modelDirectory;
  modelDirectoryPromise;
  lastProjectionSeq = 0;
  commandSeq = 0;
  selectedWorkspaceId;
  closed = false;
  static remote(core, host, sessionGeneration = "legacy") {
    return new _CodexVirtualHarness(new CodexRemoteClient(core), host, sessionGeneration);
  }
  async workspaces(signal) {
    return (await this.refreshCatalog(signal)).workspaces;
  }
  async selectWorkspace(workspaceId, signal) {
    const catalog = await loadCatalog(this.client, signal);
    const workspace = catalog.workspaces.find((item) => item.workspaceId === workspaceId);
    if (workspace === void 0) throw new Error("The selected CodeX workspace is no longer available.");
    this.selectedWorkspaceId = workspace.workspaceId;
    this.catalog = catalog;
    return workspace;
  }
  async preferredSessionId(signal) {
    const catalog = this.catalog;
    const selected = catalog?.workspaces.find((workspace) => workspace.workspaceId === this.selectedWorkspaceId);
    const selectedSessionIds = new Set(selected?.sessionIds ?? []);
    const sessions = (catalog?.sessions ?? []).filter((session) => selectedSessionIds.has(session.id));
    const idleNamed = sessions.filter((session) => session.status !== "running" && session.status !== "waiting" && displayTitle(session) !== null);
    const idle = sessions.filter((session) => session.status !== "running" && session.status !== "waiting");
    const preferredNamed = idleNamed.length > 1 ? [...idleNamed.slice(1), idleNamed[0]] : idleNamed;
    const candidates = [...new Set([...preferredNamed, ...idle, ...sessions].map((session) => session.id))];
    for (const sessionId of candidates) {
      const threadId = nativeThreadId(sessionId);
      try {
        const thread = await this.fetchThread(threadId, signal);
        return sessionId;
      } catch {
      }
    }
    return void 0;
  }
  async invoke(request) {
    const result = await this.dispatch(
      `${request.namespace}/${request.method}`,
      { args: request.args },
      request.signal ?? new AbortController().signal
    );
    if (result.ok) return result.value;
    throw Object.assign(new Error(result.error.message), {
      isDSHRemoteError: true,
      code: result.error.code,
      details: result.error.details
    });
  }
  async dispatch(endpoint, payload, signal) {
    try {
      const args = carrierArgs(payload);
      switch (endpoint) {
        case "$events/result":
          return business(await this.answerRemoteEvent(args, signal));
        case "workspace/list": {
          const catalog = await this.refreshCatalog(signal);
          return business(success({
            items: nativeVisibleWorkspaces(catalog, this.selectedWorkspaceId).map(nativeWorkspace),
            archivedSessionIds: catalog.sessions.filter((item) => item.archived).map((item) => item.id)
          }));
        }
        case "workspace/create":
          return business(await this.createWorkspace(requestArg(args), signal));
        case "workspace/rename":
          return business(await this.renameWorkspace(requestArg(args)));
        case "workspace/delete":
          return business(failure("workspace-read-only", "CodeX virtual Workspaces cannot be deleted."));
        case "workspace/insertBefore":
          return business({
            workspaceIds: nativeVisibleWorkspaces(await this.currentCatalog(signal), this.selectedWorkspaceId).map((item) => item.workspaceId)
          });
        case "workspace/insertSessionBefore":
          return business(await this.workspaceForSession(requestArg(args), signal));
        case "workspace/archiveSession":
          return business(await this.archiveSession(requestArg(args), signal));
        case "session/list":
          return business(success({ items: await this.sessionSummaries(signal) }));
        case "session/search":
          return business(await this.searchSessions(requestArg(args), signal));
        case "session/create":
          return business(await this.createSession(requestArg(args), signal));
        case "session/fork":
          return business(await this.forkSession(requestArg(args), signal));
        case "session/history":
          return business(await this.sessionHistory(requestArg(args), signal));
        case "session/page":
          return business(await this.sessionPage(requestArg(args), signal));
        case "session/prompt":
          return business(await this.prompt(requestArg(args), signal));
        case "session/cancel":
          return business(await this.cancel(requestArg(args), signal));
        case "session/rename":
          return business(await this.renameSession(requestArg(args), signal));
        case "session/updateQueue":
          return business(failure("queue-item-not-found", "CodeX does not expose a DSH inbox queue."));
        case "session/attachment":
          return business(await this.attachment(requestArg(args), signal));
        case "session/modelCatalog":
          return business(success(modelCatalog(await this.models(signal))));
        case "session/models": {
          const sessionId = requiredString(requestArg(args).sessionId, "sessionId");
          nativeThreadId(sessionId);
          const directory = await this.models(signal);
          return business(success({
            current: this.modelSelection(sessionId, directory),
            routable: true,
            groups: directory.groups,
            failures: []
          }));
        }
        case "session/selectModel":
          return business(await this.selectModel(requestArg(args), signal));
        case "session/canOpenWorkspacePath":
          return business(this.selectedWorkspaceId !== void 0);
        case "session/openWorkspacePath":
          return business(failure("bad-request", "Opening Host paths is unavailable in CodeX mode."));
        case "host/describe":
          return business(success(await this.describeHost(signal)));
        case "host/listDirectory":
          return business(await this.listDirectory(requestArg(args), signal));
        case "directoryPicker/list":
          return business(await this.listDirectory(requestArg(args), signal));
        case "skills/list":
          return business(success({ items: [] }));
        case "commands/list":
          return ok(this.commandList(args));
        case "commands/execute":
          return ok(await this.executeCommand(args, signal));
        default:
          return fail("method-not-found", `CodeX virtual Harness does not implement ${endpoint}.`);
      }
    } catch (error) {
      return failFrom(error);
    }
  }
  async open(endpoint, payload, signal) {
    const args = carrierArgs(payload);
    if (endpoint === "workspace/follow") return this.workspaceFollow(signal);
    if (endpoint === "session/control") return this.sessionControl(signal);
    if (endpoint === "session/follow") return this.sessionFollow(requestArg(args), signal);
    if (endpoint === "$events") return this.remoteEvents(signal);
    throw Object.assign(new Error(`CodeX virtual Harness does not implement stream ${endpoint}.`), {
      isDSHRemoteError: true,
      code: "method-not-found",
      details: {}
    });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const stream of this.workspaceStreams) stream.close();
    for (const stream of this.controlStreams) stream.close();
    for (const stream of this.eventStreams.values()) stream.close();
    for (const stream of this.rcMuxStreams) stream.close();
    for (const stream of this.rcHostStreams) stream.close();
    this.workspaceStreams.clear();
    this.controlStreams.clear();
    this.eventStreams.clear();
    this.rcMuxStreams.clear();
    this.rcHostStreams.clear();
    const follows = [...this.follows];
    this.follows.clear();
    for (const follow of follows) {
      follow.queue.close();
      await follow.close?.().catch(() => void 0);
    }
    this.pendingApprovals.clear();
    this.pendingRequestIds.clear();
    this.pendingThreads.clear();
    this.blankThreads.clear();
    this.selectedModels.clear();
    this.selectedPermissions.clear();
    this.imageAttachments.clear();
  }
  async refreshCatalog(signal) {
    const catalog = await loadCatalog(this.client, signal, this.pendingThreads);
    if (this.selectedWorkspaceId !== void 0 && !catalog.workspaces.some((workspace) => workspace.workspaceId === this.selectedWorkspaceId)) {
      this.selectedWorkspaceId = void 0;
    }
    this.catalog = catalog;
    return catalog;
  }
  async currentCatalog(signal) {
    return this.catalog ?? this.refreshCatalog(signal);
  }
  models(signal) {
    if (this.modelDirectory !== void 0) return Promise.resolve(this.modelDirectory);
    this.modelDirectoryPromise ??= loadModelDirectory(this.client, signal).then((directory) => {
      this.modelDirectory = directory;
      return directory;
    }).finally(() => {
      this.modelDirectoryPromise = void 0;
    });
    return this.modelDirectoryPromise;
  }
  modelSelection(sessionId, directory) {
    return this.selectedModels.get(sessionId) ?? directory?.default ?? modelSelection();
  }
  permissionSelection(sessionId) {
    return this.selectedPermissions.get(sessionId);
  }
  setPermissionSelection(sessionId, preset) {
    if (preset === void 0) this.selectedPermissions.delete(sessionId);
    else this.selectedPermissions.set(sessionId, preset);
    this.publishProjection(sessionId, "permissions", codexPermissionsProjection(preset), this.nextProjectionSeq());
  }
  commandList(args) {
    nativeThreadId(requiredString(args.agentId, "agentId"));
    return [{
      name: "permission",
      description: "Switch the CodeX Remote sandbox mode and approval policy",
      input: { hint: "<preset>" }
    }];
  }
  async executeCommand(args, signal) {
    const sessionId = requiredString(args.agentId, "agentId");
    const threadId = nativeThreadId(sessionId);
    const line = requiredString(args.line, "command line").trim();
    if (!Array.isArray(args.images)) throw new Error("The CodeX command image list is required.");
    const match = /^\/permission(?:\s+([\s\S]*))?$/u.exec(line);
    if (match === null) return void 0;
    const commandId = `codex-permission:${++this.commandSeq}`;
    if (args.images.length > 0) return {
      commandId,
      result: { kind: "error", text: "CodeX Remote permission commands do not accept attachments." }
    };
    const requested = (match[1] ?? "").trim();
    if (requested === "") {
      await this.readHistoryPage(threadId, { maxMessages: 1 }, signal);
      return {
        commandId,
        result: { kind: "success", text: `current preset ${this.permissionSelection(sessionId) ?? "Host settings (not reported)"}` }
      };
    }
    if (!isCodexPermissionPreset(requested)) return {
      commandId,
      result: { kind: "error", text: `unknown preset "${requested}" (available: workspace-write, danger-full-access)` }
    };
    const result = await this.client.request("thread/resume", { threadId, permissionPreset: requested }, signal);
    const effective = codexPermissionPresetFromResponse(result);
    if (effective === void 0) throw new Error("The Host did not confirm the CodeX permission preset.");
    this.setPermissionSelection(sessionId, effective);
    if (effective !== requested) throw new Error("The Host did not apply the requested CodeX permission preset.");
    return { commandId, result: { kind: "success", text: `preset ${effective}` } };
  }
  sessionTitle(sessionId) {
    const session = this.catalog?.sessions.find((item) => item.id === sessionId);
    return session === void 0 ? null : displayTitle(session);
  }
  async selectModel(request, signal) {
    const sessionId = requiredString(request.sessionId, "sessionId");
    nativeThreadId(sessionId);
    const provider = requiredString(request.provider, "provider");
    const model = requiredString(request.model, "model");
    const reasoningEffort = string(request.reasoningEffort);
    const directory = await this.models(signal);
    const available = directory.models.get(model);
    if (provider !== CODEX_PROVIDER || available === void 0) {
      return failure("model-unavailable", "The selected CodeX model is unavailable on this Host.");
    }
    const supportedEfforts = available.reasoning?.efforts.map((effort) => effort.id) ?? [];
    if (reasoningEffort !== void 0 && !supportedEfforts.includes(reasoningEffort)) {
      return failure("model-unavailable", "The selected reasoning effort is unavailable for this CodeX model.");
    }
    const selected = {
      provider,
      model,
      ...reasoningEffort === void 0 ? {} : { reasoningEffort }
    };
    this.selectedModels.set(sessionId, selected);
    const seq = Date.now();
    this.publishProjection(sessionId, "modelSelection", modelSelectionProjection(selected), seq);
    return success({ selected });
  }
  publishProjection(sessionId, key, value, seq) {
    for (const queue of this.controlStreams) queue.push({ type: "projection", sessionId, key, value, seq });
    this.broadcastRcMux({ type: "session/projection", sessionId, key, value, seq });
  }
  nextProjectionSeq() {
    const seq = Math.max(Date.now(), this.lastProjectionSeq + 1);
    this.lastProjectionSeq = seq;
    return seq;
  }
  updateThreadName(threadId, name2) {
    const pending = this.pendingThreads.get(threadId);
    if (pending !== void 0) this.pendingThreads.set(threadId, { ...pending, name: name2 });
    if (this.catalog === void 0) return;
    const threads = this.catalog.threads.map((thread) => string(thread.id) === threadId ? { ...thread, name: name2 } : thread);
    const sessions = this.catalog.sessions.map((session) => {
      if (session.nativeId !== threadId) return session;
      const { title: _title, ...rest } = session;
      return name2.trim() === "" ? rest : { ...rest, title: name2 };
    });
    this.catalog = { ...this.catalog, threads, sessions };
  }
  async sessionSummaries(signal) {
    const catalog = await this.refreshCatalog(signal);
    const directory = await this.models(signal).catch(() => void 0);
    return catalog.sessions.map((session) => {
      const blank = this.blankThreads.has(session.nativeId) || this.pendingThreads.has(session.nativeId);
      return this.sessionSummary(session, {
        blank,
        modelSelection: this.modelSelection(session.id, directory),
        lastPromptAt: session.updatedAt || null
      });
    });
  }
  sessionSummary(session, options) {
    return {
      sessionId: session.id,
      updatedAt: session.updatedAt,
      running: session.status === "running" || session.status === "waiting",
      blank: options.blank,
      ...session.cwd === void 0 ? {} : { cwd: session.cwd },
      projections: {
        asOfSeq: options.asOfSeq ?? 0,
        values: {
          title: displayTitle(session),
          sessionListMetadata: { blank: options.blank, lastPromptAt: options.lastPromptAt },
          modelSelection: modelSelectionProjection(options.modelSelection),
          permissions: codexPermissionsProjection(this.permissionSelection(session.id)),
          imageLimits: codexImageLimitsProjection()
        }
      }
    };
  }
  async searchSessions(request, signal) {
    const query = requiredString(request.query, "query").trim();
    if (query.length === 0 || query.length > 500 || query.includes("\0")) {
      return failure("bad-request", "The CodeX Session search query is invalid.");
    }
    const catalog = await this.currentCatalog(signal);
    const needle = query.toLocaleLowerCase();
    const matches = catalog.threads.flatMap((thread) => {
      const session = projectCodexThread(thread);
      if (session === void 0) return [];
      const candidates = [session.title, session.preview, session.cwd, session.nativeId].filter((value) => value !== void 0 && value.length > 0);
      const snippet = candidates.find((value) => value.toLocaleLowerCase().includes(needle));
      if (snippet === void 0) return [];
      return [{ sessionId: session.id, snippet: truncateCodePoints(snippet, SESSION_SEARCH_SNIPPET_CODE_POINTS) }];
    });
    return success({
      items: matches.slice(0, SESSION_SEARCH_RESULT_LIMIT),
      hasMore: matches.length > SESSION_SEARCH_RESULT_LIMIT
    });
  }
  async workspaceFollow(signal) {
    const queue = new AsyncValueQueue2(signal);
    this.workspaceStreams.add(queue);
    const catalog = await this.refreshCatalog(signal);
    queue.push({
      type: "baseline",
      value: {
        items: nativeVisibleWorkspaces(catalog, this.selectedWorkspaceId).map(nativeWorkspace),
        archivedSessionIds: catalog.sessions.filter((item) => item.archived).map((item) => item.id)
      }
    });
    return queue.iterate(() => this.workspaceStreams.delete(queue));
  }
  async sessionControl(signal) {
    const queue = new AsyncValueQueue2(signal);
    this.controlStreams.add(queue);
    queue.push({ type: "baseline", value: { queues: {}, jobs: {}, projections: {} } });
    return queue.iterate(() => this.controlStreams.delete(queue));
  }
  async remoteEvents(signal) {
    const queue = new AsyncValueQueue2(signal);
    const clientId = `codex-events:${this.host.deviceId}:${Date.now().toString(36)}`;
    this.eventStreams.set(clientId, queue);
    const home = (await this.currentCatalog(signal)).workspaces[0]?.path ?? "/";
    queue.push({ type: "ready", clientId, host: { home } });
    return queue.iterate(() => this.eventStreams.delete(clientId));
  }
  async sessionFollow(request, signal) {
    const sessionId = sessionIdFromAddress(record2(request.address));
    const threadId = nativeThreadId(sessionId);
    const history = await this.readHistoryPage(threadId, {
      maxMessages: optionalPositiveInteger(request.maxMessages)
    }, signal);
    const directory = await this.models(signal).catch(() => void 0);
    const queue = new AsyncValueQueue2(signal);
    const follow = {
      sessionId,
      threadId,
      queue,
      nextSeq: history.cursor + 1,
      turn: history.nextTurn,
      stepOpen: history.activeTurnId !== void 0,
      startedItems: /* @__PURE__ */ new Set(),
      completedItems: /* @__PURE__ */ new Set(),
      streamedBlocks: /* @__PURE__ */ new Map(),
      nextBlockIndex: 0,
      streamActive: false,
      assistantStreamRevision: 0,
      liveItems: /* @__PURE__ */ new Map(),
      liveToolOutput: /* @__PURE__ */ new Map(),
      liveToolResultSeq: /* @__PURE__ */ new Map(),
      pendingToolImages: [],
      requestId: this.pendingRequestIds.get(sessionId),
      ...history.activeTurnId === void 0 ? {} : { activeTurnId: history.activeTurnId }
    };
    this.follows.add(follow);
    queue.push({
      type: "snapshot",
      header: history.header,
      cursor: history.cursor,
      records: history.records,
      hasMore: history.hasMore,
      projections: {
        asOfSeq: history.cursor,
        values: {
          title: this.sessionTitle(sessionId),
          sessionListMetadata: { blank: history.cursor < 0, lastPromptAt: null },
          modelSelection: modelSelectionProjection(this.modelSelection(sessionId, directory)),
          permissions: codexPermissionsProjection(this.permissionSelection(sessionId)),
          imageLimits: codexImageLimitsProjection()
        }
      },
      ...this.sessionGeneration === "v3" ? { assistantStream: { revision: 0 } } : {}
    });
    try {
      const stream = await this.client.subscribe(
        threadId,
        (frame) => this.acceptCodexFrame(follow, frame),
        signal,
        () => this.closeFollowAfterRemoteStreamClosed(follow)
      );
      follow.close = () => stream.close();
    } catch (error) {
      this.follows.delete(follow);
      queue.close();
      throw error;
    }
    return queue.iterate(() => {
      this.follows.delete(follow);
      void follow.close?.().catch(() => void 0);
    });
  }
  acceptCodexFrame(follow, frame) {
    const params = record2(frame.params);
    if (frame.method === "thread/name/updated") {
      const name2 = string(params.threadName);
      if (name2 === void 0) return;
      const seq = this.nextProjectionSeq();
      this.updateThreadName(follow.threadId, name2);
      const title = name2.trim() === "" ? null : name2.slice(0, 256);
      this.publishProjection(follow.sessionId, "title", title, seq);
      return;
    }
    if (frame.method === "thread/settings/updated") {
      const preset = codexPermissionPresetFromResponse(params);
      this.setPermissionSelection(follow.sessionId, preset);
      return;
    }
    if (frame.method === "turn/started") {
      const turn = record2(params.turn);
      this.endAssistantAttempt(follow, { kind: "abandoned" });
      this.resetLiveTurn(follow);
      follow.turn += 1;
      follow.activeTurnId = string(turn.id);
      follow.requestId = this.pendingRequestIds.get(follow.sessionId);
      follow.stepOpen = true;
      this.pushEvent(follow, "turn/start", { turn: follow.turn });
      this.pushEvent(follow, "step/start", { turn: follow.turn, step: 1 });
      this.emitRemoteEvent("api-session/status", [follow.sessionId, true]);
      for (const item of array(turn.items)) this.acceptCompletedItem(follow, record2(item), false);
      return;
    }
    if (frame.method === "item/started" || frame.method === "item/completed") {
      const item = record2(params.item);
      const itemId = string(item.id);
      if (frame.method === "item/started" && itemId !== void 0) {
        follow.startedItems.add(itemId);
        follow.liveItems.set(itemId, item);
        if (isToolItemType2(string(item.type))) this.ensureToolStarted(follow, item);
      }
      if (frame.method === "item/completed") this.acceptCompletedItem(follow, item, true);
      return;
    }
    if (frame.method === "item/agentMessage/delta") {
      const itemId = string(params.itemId) ?? `assistant:${follow.turn}`;
      const delta = string(params.delta);
      if (delta === void 0) return;
      this.appendStreamDelta(follow, `agent:${itemId}`, itemId, "text", delta);
      return;
    }
    if (frame.method === "item/reasoning/summaryPartAdded") {
      const itemId = string(params.itemId);
      if (itemId !== void 0) this.ensureStreamBlock(
        follow,
        `reasoning-summary:${itemId}:${integer(params.summaryIndex) ?? 0}`,
        itemId,
        "reasoning"
      );
      return;
    }
    if (frame.method === "item/reasoning/summaryTextDelta" || frame.method === "item/reasoning/textDelta" || frame.method === "item/plan/delta") {
      const itemId = string(params.itemId);
      const delta = string(params.delta);
      if (itemId === void 0 || delta === void 0) return;
      const key = frame.method === "item/plan/delta" ? `plan:${itemId}` : frame.method === "item/reasoning/summaryTextDelta" ? `reasoning-summary:${itemId}:${integer(params.summaryIndex) ?? 0}` : `reasoning-content:${itemId}:${integer(params.contentIndex) ?? 0}`;
      this.appendStreamDelta(follow, key, itemId, "reasoning", delta);
      return;
    }
    if (frame.method === "turn/plan/updated") {
      const todos = array(params.plan).flatMap((value) => {
        const item = record2(value);
        const content = string(item.step);
        if (content === void 0) return [];
        const status2 = item.status === "inProgress" ? "in_progress" : item.status === "completed" ? "completed" : "pending";
        return [{ content, status: status2 }];
      });
      this.pushEvent(follow, "todo/write", { todos });
      return;
    }
    if (frame.method === "item/commandExecution/outputDelta" || frame.method === "item/fileChange/outputDelta" || frame.method === "item/mcpToolCall/progress") {
      const itemId = string(params.itemId);
      const delta = frame.method === "item/mcpToolCall/progress" ? string(params.message) : string(params.delta);
      if (itemId === void 0 || delta === void 0) return;
      const type = frame.method === "item/commandExecution/outputDelta" ? "commandExecution" : frame.method === "item/fileChange/outputDelta" ? "fileChange" : "mcpToolCall";
      const item = follow.liveItems.get(itemId) ?? { id: itemId, type, status: "inProgress" };
      follow.liveItems.set(itemId, item);
      this.ensureToolStarted(follow, item);
      const separator = frame.method === "item/mcpToolCall/progress" && follow.liveToolOutput.has(itemId) ? "\n" : "";
      const output = appendBoundedText(follow.liveToolOutput.get(itemId) ?? "", `${separator}${delta}`);
      follow.liveToolOutput.set(itemId, output);
      this.emitToolResult(follow, item, output);
      return;
    }
    if (frame.method === "item/fileChange/patchUpdated") {
      const itemId = string(params.itemId);
      if (itemId === void 0) return;
      const previous = follow.liveItems.get(itemId) ?? { id: itemId, type: "fileChange", status: "inProgress" };
      const item = { ...previous, changes: sanitizedFileChanges(params.changes) };
      follow.liveItems.set(itemId, item);
      this.ensureToolStarted(follow, item);
      this.emitToolResult(follow, item, fileChangeSummary(item));
      return;
    }
    if (frame.method === "thread/status/changed") {
      const status2 = record2(params.status);
      const running = status2.type === "active";
      this.emitRemoteEvent("api-session/status", [follow.sessionId, running]);
      if (status2.type === "systemError") {
        this.broadcastRcHost({
          type: "host/agent-error",
          sessionId: follow.sessionId,
          message: "CodeX reported a thread system error."
        });
      }
      return;
    }
    if (frame.method === "model/rerouted") {
      const model = string(params.toModel);
      if (model === void 0) return;
      const previous = this.selectedModels.get(follow.sessionId);
      const selected = {
        provider: CODEX_PROVIDER,
        model,
        ...previous?.reasoningEffort === void 0 ? {} : { reasoningEffort: previous.reasoningEffort }
      };
      this.selectedModels.set(follow.sessionId, selected);
      const seq = this.pushEvent(follow, "request/context", { provider: CODEX_PROVIDER, model });
      this.publishProjection(follow.sessionId, "modelSelection", modelSelectionProjection(selected), seq);
      return;
    }
    if (frame.method === "turn/completed") {
      const turn = record2(params.turn);
      for (const item of array(turn.items)) this.acceptCompletedItem(follow, record2(item), true);
      if (follow.stepOpen) {
        this.closeAllStreamBlocks(follow);
        if (follow.streamActive) this.finishStream(follow);
        this.endAssistantAttempt(follow, { kind: "abandoned" });
        this.pushEvent(follow, "step/end", { turn: follow.turn, step: 1 });
        follow.stepOpen = false;
      }
      this.pushEvent(follow, "turn/end", {
        turn: follow.turn,
        reason: turn.status === "failed" || turn.error !== void 0 && turn.error !== null ? { kind: "error", error: { message: "CodeX turn failed.", code: "codex-turn-failed" } } : { kind: "completed" }
      });
      this.emitRemoteEvent("api-session/status", [follow.sessionId, false]);
      this.emitRemoteEvent("api-session/activity", [follow.sessionId, Date.now()]);
      follow.activeTurnId = void 0;
      this.pendingRequestIds.delete(follow.sessionId);
      void this.refreshAndPublishWorkspaces();
      return;
    }
    if (frame.method === "item/commandExecution/requestApproval" || frame.method === "item/fileChange/requestApproval") {
      const requestHandle = string(params.requestHandle);
      if (requestHandle === void 0) return;
      const command = commandText(params.command);
      this.pendingApprovals.set(requestHandle, { requestHandle, sessionId: follow.sessionId });
      this.emitApproval({
        eventId: requestHandle,
        agentId: follow.sessionId,
        request: {
          toolName: frame.method.includes("fileChange") ? "CodeX file change" : "CodeX command",
          ...command === void 0 ? {} : { reason: command }
        }
      });
    }
  }
  acceptCompletedItem(follow, item, settleAssistant) {
    const itemId = string(item.id) ?? `item:${follow.nextSeq}`;
    if (follow.completedItems.has(itemId)) return;
    const type = string(item.type);
    if (type === "agentMessage" && !settleAssistant) return;
    follow.completedItems.add(itemId);
    this.closeItemStreamBlocks(follow, itemId, itemText2(item));
    if (type === "agentMessage" && follow.streamActive && follow.streamedBlocks.size === 0) this.finishStream(follow);
    const supplementalImages = type === "agentMessage" ? follow.pendingToolImages : [];
    let assistantMessageSeq;
    for (const event of itemEvents(
      item,
      follow.turn,
      1,
      follow.requestId,
      this.modelSelection(follow.sessionId),
      follow.sessionId,
      supplementalImages
    )) {
      if (event.type === "tool/call" && follow.startedItems.has(itemId)) continue;
      if (event.type === "tool/result") this.pushToolResult(follow, itemId, event);
      else {
        const seq = this.pushEvent(follow, event.type, event.data, event.view);
        if (event.type === "assistant/message") assistantMessageSeq = seq;
      }
    }
    if (type === "agentMessage" && assistantMessageSeq !== void 0) {
      this.endAssistantAttempt(follow, {
        kind: "committed",
        eventType: "assistant/message",
        seq: assistantMessageSeq
      });
    }
    if (type === "agentMessage" && supplementalImages.length > 0) follow.pendingToolImages = [];
    else if (type !== void 0 && isToolItemType2(type)) {
      follow.pendingToolImages.push(...toolOutputImageBlocks(item));
    }
    follow.liveItems.delete(itemId);
    follow.liveToolOutput.delete(itemId);
    follow.liveToolResultSeq.delete(itemId);
    follow.liveToolResultSeq.delete(`${itemId}:call`);
  }
  pushEvent(follow, type, data, view, placement) {
    const seq = follow.nextSeq++;
    const event = {
      type,
      seq,
      time: Date.now(),
      data: adaptEventData(
        type,
        type === "assistant/message" && this.sessionGeneration === "v3" && follow.assistantAttempt !== void 0 ? { ...record2(data), stream: follow.assistantAttempt.stream } : data,
        this.sessionGeneration
      ),
      ...isSurfaceEvent(type) ? placement === void 0 ? { surfaceOp: "append" } : {
        surfaceOp: this.sessionGeneration === "v3" ? { op: "replace", startSeq: placement.replaceSeq, endSeq: placement.replaceSeq } : { op: "replace", start: placement.replaceSeq, end: placement.replaceSeq },
        sourceEventSeqs: [placement.replaceSeq]
      } : {}
    };
    this.cacheImageBlocks(follow.sessionId, event.data);
    if (!follow.rcOnly) {
      follow.queue.push({
        type: "event",
        event,
        ...view === void 0 ? {} : { view }
      });
    }
    this.broadcastRcMux({
      type: "session/event",
      sessionId: follow.sessionId,
      event,
      ...view === void 0 ? {} : { view }
    });
    return seq;
  }
  cacheImageBlocks(sessionId, value) {
    for (const block of collectImageBlocks(value)) {
      const attachment = record2(block.attachment);
      const attachmentId = string(attachment.attachmentId);
      const data = string(block.data);
      if (attachmentId === void 0 || data === void 0 || !attachmentId.startsWith(CODEX_IMAGE_ATTACHMENT_PREFIX)) continue;
      this.imageAttachments.set(attachmentId, { sessionId, attachment, data });
    }
  }
  ensureStreamBlock(follow, key, itemId, kind) {
    const current = follow.streamedBlocks.get(key);
    if (current !== void 0) return current;
    const block = { itemId, index: follow.nextBlockIndex++, kind, text: "" };
    follow.streamedBlocks.set(key, block);
    follow.streamActive = true;
    this.pushAssistantChunk(follow, { type: "block-start", index: block.index, blockType: kind });
    return block;
  }
  appendStreamDelta(follow, key, itemId, kind, delta) {
    const block = this.ensureStreamBlock(follow, key, itemId, kind);
    block.text = appendBoundedText(block.text, delta);
    this.pushAssistantChunk(follow, {
      type: kind === "reasoning" ? "reasoning-delta" : "text-delta",
      index: block.index,
      text: delta
    });
  }
  closeItemStreamBlocks(follow, itemId, fallback) {
    const matches = [...follow.streamedBlocks].filter(([, block]) => block.itemId === itemId);
    for (const [key, block] of matches) {
      const text = block.text || fallback || "";
      this.pushAssistantChunk(follow, {
        type: "block-end",
        index: block.index,
        block: { type: block.kind, text }
      });
      follow.streamedBlocks.delete(key);
    }
  }
  closeAllStreamBlocks(follow) {
    for (const block of follow.streamedBlocks.values()) {
      this.pushAssistantChunk(follow, {
        type: "block-end",
        index: block.index,
        block: { type: block.kind, text: block.text }
      });
    }
    follow.streamedBlocks.clear();
  }
  finishStream(follow) {
    this.pushAssistantChunk(follow, { type: "finish", reason: { kind: "stop" } });
    follow.streamActive = false;
  }
  pushAssistantChunk(follow, chunk) {
    if (this.sessionGeneration !== "v3" || follow.rcOnly === true) {
      this.pushEvent(follow, "assistant/chunk", { turn: follow.turn, step: 1, chunk });
      return;
    }
    let attempt = follow.assistantAttempt;
    if (attempt === void 0) {
      attempt = {
        attemptId: `codex-attempt:${follow.activeTurnId ?? follow.turn}:${follow.nextSeq}`,
        startedAfterSeq: follow.nextSeq - 1,
        nextIndex: 0,
        stream: []
      };
      follow.assistantAttempt = attempt;
      follow.assistantStreamRevision += 1;
      follow.queue.push({
        type: "assistant-stream",
        frame: {
          type: "start",
          attemptId: attempt.attemptId,
          revision: follow.assistantStreamRevision,
          startedAfterSeq: attempt.startedAfterSeq,
          turn: follow.turn,
          step: 1
        }
      });
    }
    const time = Date.now();
    const index = attempt.nextIndex++;
    attempt.stream.push({ time, chunk });
    follow.assistantStreamRevision += 1;
    follow.queue.push({
      type: "assistant-stream",
      frame: {
        type: "chunk",
        attemptId: attempt.attemptId,
        revision: follow.assistantStreamRevision,
        index,
        time,
        chunk
      }
    });
  }
  endAssistantAttempt(follow, outcome) {
    const attempt = follow.assistantAttempt;
    if (attempt === void 0) return;
    follow.assistantAttempt = void 0;
    follow.assistantStreamRevision += 1;
    if (this.sessionGeneration === "v3" && follow.rcOnly !== true) {
      follow.queue.push({
        type: "assistant-stream",
        frame: {
          type: "end",
          attemptId: attempt.attemptId,
          revision: follow.assistantStreamRevision,
          index: attempt.nextIndex,
          outcome
        }
      });
    }
  }
  ensureToolStarted(follow, item) {
    const itemId = string(item.id);
    if (itemId === void 0) return;
    if (!follow.startedItems.has(itemId)) follow.startedItems.add(itemId);
    if (follow.liveItems.get(itemId) !== item) follow.liveItems.set(itemId, item);
    const call = itemEvents(
      item,
      follow.turn,
      1,
      follow.requestId,
      this.modelSelection(follow.sessionId),
      follow.sessionId
    ).find((event) => event.type === "tool/call");
    if (call !== void 0 && !follow.liveToolResultSeq.has(`${itemId}:call`)) {
      this.pushEvent(follow, call.type, call.data, call.view);
      follow.liveToolResultSeq.set(`${itemId}:call`, -1);
    }
  }
  emitToolResult(follow, item, resultText) {
    const itemId = string(item.id);
    if (itemId === void 0) return;
    const result = toolResultEvent(item, follow.turn, 1, itemId, resultText);
    this.pushToolResult(follow, itemId, result);
  }
  pushToolResult(follow, itemId, event) {
    const previous = follow.liveToolResultSeq.get(itemId);
    const projected = previous === void 0 ? event : toolResultContentReplacement(event);
    const seq = this.pushEvent(
      follow,
      projected.type,
      projected.data,
      projected.view,
      previous === void 0 ? void 0 : { replaceSeq: previous }
    );
    follow.liveToolResultSeq.set(itemId, seq);
  }
  resetLiveTurn(follow) {
    follow.startedItems.clear();
    follow.completedItems.clear();
    follow.streamedBlocks.clear();
    follow.nextBlockIndex = 0;
    follow.streamActive = false;
    follow.assistantAttempt = void 0;
    follow.liveItems.clear();
    follow.liveToolOutput.clear();
    follow.liveToolResultSeq.clear();
    follow.pendingToolImages = [];
  }
  emitRemoteEvent(event, args) {
    for (const queue of this.eventStreams.values()) queue.push({ type: "emit", event, args });
    const sessionId = typeof args[0] === "string" ? args[0] : void 0;
    if (event === "api-session/status" && sessionId !== void 0 && typeof args[1] === "boolean") {
      this.broadcastRcHost({ type: "host/session-status", sessionId, running: args[1] });
    } else if (event === "api-session/removed" && sessionId !== void 0) {
      this.broadcastRcHost({ type: "host/session-removed", sessionId });
    } else if (event === "api-session/added" && isRecord4(args[0])) {
      const summary = args[0];
      this.broadcastRcHost({
        type: "host/session-added",
        sessionId: summary.sessionId,
        blank: summary.blank === true,
        ...typeof summary.cwd === "string" ? { cwd: summary.cwd } : {}
      });
    }
  }
  emitApproval(input2) {
    for (const queue of this.eventStreams.values()) queue.push({
      type: "waterfall",
      event: "approval/request",
      eventId: input2.eventId,
      agentId: input2.agentId,
      request: input2.request
    });
    this.broadcastRcMux({
      type: "approval/requested",
      sessionId: input2.agentId,
      approvalId: input2.eventId,
      toolName: string(input2.request.toolName) ?? "CodeX",
      ...typeof input2.request.reason === "string" ? { reason: input2.request.reason } : {}
    }, input2.eventId);
  }
  async answerRemoteEvent(args, signal) {
    const eventId = string(args.eventId);
    const outcome = record2(args.outcome);
    if (eventId === void 0) throw new Error("The CodeX approval result is missing its event id.");
    const pending = this.pendingApprovals.get(eventId);
    if (pending === void 0) return void 0;
    this.pendingApprovals.delete(eventId);
    const decision = outcome.kind === "result" && outcome.value === "allowed-once" ? "accept" : outcome.kind === "result" && outcome.value === "cancelled" ? "cancel" : "decline";
    await this.client.respond(pending.requestHandle, decision, signal);
    return void 0;
  }
  async createWorkspace(request, signal) {
    const path = string(request.path);
    if (path === void 0 || path.trim() === "") return failure("bad-request", "A CodeX working directory is required.");
    const catalog = await this.currentCatalog(signal);
    const existing = catalog.workspaces.find((item) => item.path === path);
    if (existing !== void 0) return success({ workspace: nativeWorkspace(existing), created: false });
    return failure("workspace-not-found", "The selected directory is not visible to CodeX Remote.");
  }
  async renameWorkspace(request) {
    return failure("workspace-read-only", `CodeX virtual Workspace ${string(request.workspaceId) ?? ""} cannot be renamed.`);
  }
  async workspaceForSession(request, signal) {
    const sessionId = string(request.sessionId);
    const catalog = await this.currentCatalog(signal);
    const workspace = catalog.workspaces.find((item) => sessionId !== void 0 && item.sessionIds.includes(sessionId));
    return workspace === void 0 ? failure("workspace-not-found", "The CodeX virtual Workspace was not found.") : success({ workspace: nativeWorkspace(workspace) });
  }
  selectedWorkspace(catalog) {
    return this.selectedWorkspaceId === void 0 ? void 0 : catalog.workspaces.find((item) => item.workspaceId === this.selectedWorkspaceId);
  }
  async describeHost(signal) {
    const catalog = await this.currentCatalog(signal);
    const workspace = this.selectedWorkspace(catalog);
    const models = await this.models(signal).catch(() => void 0);
    return {
      version: "CodeX Remote",
      cwd: workspace?.path ?? "",
      home: workspace?.path ?? "",
      provider: "CodeX",
      ...models === void 0 ? {} : { model: models.default.model },
      attachedSessions: catalog.sessions.length,
      canOpenPath: workspace !== void 0
    };
  }
  async listDirectory(request, signal) {
    const catalog = await this.currentCatalog(signal);
    const workspace = this.selectedWorkspace(catalog);
    if (workspace === void 0) return failure("workspace-not-found", "The CodeX virtual Workspace was not found.");
    const path = string(request.path) ?? workspace.path;
    if (!containsPath(workspace.path, path)) {
      return failure("workspace-not-found", "The selected directory is outside the current CodeX virtual Workspace.");
    }
    const listing = record2(await this.client.request("dsh/directoryList", { path }, signal));
    if (!isCodexDirectoryListing(listing)) {
      return failure("internal", "CodeX Remote returned an invalid directory listing.");
    }
    const listedPaths = [
      listing.path,
      listing.home,
      ...listing.crumbs.map((item) => item.path),
      ...listing.entries.map((item) => item.path)
    ];
    if (listedPaths.some((path2) => !containsPath(workspace.path, path2))) {
      return failure("internal", "CodeX Remote returned a directory outside the current Workspace.");
    }
    return success(listing);
  }
  async archiveSession(request, signal) {
    const sessionId = requiredString(request.sessionId, "sessionId");
    await this.client.request("thread/archive", { threadId: nativeThreadId(sessionId) }, signal);
    const catalog = await this.refreshCatalog(signal);
    this.publishWorkspaceBaseline(catalog);
    return success({ archivedSessionIds: [sessionId] });
  }
  async createSession(request, signal) {
    const catalog = await this.currentCatalog(signal);
    const workspaceId = string(request.workspaceId) ?? this.selectedWorkspaceId;
    const workspace = workspaceId === void 0 ? void 0 : catalog.workspaces.find((item) => item.workspaceId === workspaceId);
    const cwd = string(request.cwd) ?? workspace?.path;
    if (cwd === void 0) return failure("workspace-not-found", "The CodeX virtual Workspace was not found.");
    if (workspace !== void 0 && !containsPath(workspace.path, cwd)) {
      return failure("workspace-not-found", "The selected directory is outside the current CodeX virtual Workspace.");
    }
    const directory = await this.models(signal);
    const selection = directory.default;
    const requestedPreset = CODEX_DEFAULT_PERMISSION;
    const result = record2(await this.client.request("thread/start", {
      cwd,
      model: selection.model,
      permissionPreset: requestedPreset
    }, signal));
    const permissionPreset2 = codexPermissionPresetFromResponse(result) ?? requestedPreset;
    const thread = { ...record2(result.thread), cwd, turns: array(record2(result.thread).turns) };
    const projected = projectCodexThread(thread);
    if (projected === void 0) return failure("internal", "CodeX returned an invalid Thread.");
    this.pendingThreads.set(projected.nativeId, thread);
    this.blankThreads.add(projected.nativeId);
    this.selectedModels.set(projected.id, selection);
    this.selectedPermissions.set(projected.id, permissionPreset2);
    await this.refreshAndPublishWorkspaces();
    const seq = this.nextProjectionSeq();
    this.emitRemoteEvent("api-session/added", [this.sessionSummary(projected, {
      blank: true,
      modelSelection: selection,
      lastPromptAt: null,
      asOfSeq: seq
    })]);
    this.publishProjection(projected.id, "title", displayTitle(projected), seq);
    return success({ sessionId: projected.id });
  }
  async forkSession(request, signal) {
    const sessionId = requiredString(request.sessionId, "sessionId");
    const result = record2(await this.client.request("thread/fork", {
      threadId: nativeThreadId(sessionId)
    }, signal));
    const permissionPreset2 = codexPermissionPresetFromResponse(result);
    const projected = projectCodexThread(record2(result.thread));
    if (projected === void 0) return failure("internal", "CodeX returned an invalid forked Thread.");
    this.selectedModels.set(projected.id, this.modelSelection(sessionId, await this.models(signal)));
    this.setPermissionSelection(projected.id, permissionPreset2);
    await this.refreshAndPublishWorkspaces();
    const seq = this.nextProjectionSeq();
    this.publishProjection(projected.id, "title", displayTitle(projected), seq);
    return success({ sessionId: projected.id });
  }
  async prompt(request, signal) {
    const sessionId = requiredString(request.sessionId, "sessionId");
    const content = array(request.content);
    const input2 = codexPromptInput(content);
    if (input2 === void 0) return failure("attachment-error", "CodeX virtual Sessions accept text and pasted PNG, JPEG, WebP, or GIF images only.");
    const threadId = nativeThreadId(sessionId);
    const selection = this.modelSelection(sessionId, await this.models(signal));
    const isFreshBlankThread = this.blankThreads.has(threadId) || this.pendingThreads.has(threadId);
    await this.ensureRcFollow(sessionId);
    if (!isFreshBlankThread) {
      const resumeResult = await this.client.request("thread/resume", {
        threadId,
        model: selection.model
      }, signal);
      const serverPreset = codexPermissionPresetFromResponse(resumeResult);
      if (serverPreset !== void 0) {
        this.setPermissionSelection(sessionId, serverPreset);
      }
    }
    this.pendingRequestIds.set(sessionId, string(request.requestId) ?? "");
    const mode = request.mode === "steer" ? "turn/steer" : "turn/start";
    if (mode === "turn/steer") {
      const active = this.activeTurnId(threadId);
      if (active === void 0) return failure("steer-unavailable", "The CodeX Thread has no active turn to steer.");
      await this.client.request(mode, { threadId, expectedTurnId: active, input: input2 }, signal);
    } else {
      await this.client.request(mode, {
        threadId,
        input: input2,
        ...codexModelParams(selection)
      }, signal);
    }
    this.blankThreads.delete(threadId);
    return success({ accepted: true });
  }
  async attachment(request, signal) {
    const sessionId = requiredString(request.sessionId, "sessionId");
    const attachmentId = requiredString(request.attachmentId, "attachmentId");
    if (!attachmentId.startsWith(CODEX_IMAGE_ATTACHMENT_PREFIX)) {
      return failure("attachment-error", "The CodeX image is not available in this virtual Session.", { reason: "not-referenced" });
    }
    nativeThreadId(sessionId);
    const cached = this.imageAttachments.get(attachmentId);
    if (cached?.sessionId === sessionId) return success({ attachment: cached.attachment, data: cached.data });
    await this.hydrateImageAttachments(sessionId, signal);
    const hydrated = this.imageAttachments.get(attachmentId);
    return hydrated?.sessionId === sessionId ? success({ attachment: hydrated.attachment, data: hydrated.data }) : failure("attachment-error", "The CodeX image is not available in this virtual Session.", { reason: "not-referenced" });
  }
  async hydrateImageAttachments(sessionId, signal) {
    const threadId = nativeThreadId(sessionId);
    const result = record2(await this.client.request("thread/read", { threadId, includeTurns: true }, signal));
    const thread = record2(result.thread);
    if (string(thread.id) !== threadId) throw new Error("CodeX returned an invalid Thread history.");
    this.cacheHistoryImages(projectCodexNativeHistory(thread, sessionId));
  }
  async cancel(request, signal) {
    const sessionId = requiredString(request.sessionId, "sessionId");
    const threadId = nativeThreadId(sessionId);
    const turnId = this.activeTurnId(threadId);
    if (turnId !== void 0) await this.client.request("turn/interrupt", { threadId, turnId }, signal);
    return success({ accepted: true });
  }
  async renameSession(request, signal) {
    const sessionId = requiredString(request.sessionId, "sessionId");
    const title = requiredString(request.title, "title");
    await this.client.request("thread/name/set", { threadId: nativeThreadId(sessionId), name: title }, signal);
    const seq = this.nextProjectionSeq();
    this.updateThreadName(nativeThreadId(sessionId), title);
    this.publishProjection(sessionId, "title", title, seq);
    await this.refreshAndPublishWorkspaces();
    return success({ title, seq });
  }
  async sessionPage(request, signal) {
    const sessionId = sessionIdFromAddress(record2(request.address));
    const page = await this.readHistoryPage(nativeThreadId(sessionId), {
      beforeSeq: optionalNonNegativeInteger(request.beforeSeq),
      throughSeq: optionalInteger(request.throughSeq),
      maxMessages: optionalPositiveInteger(request.maxMessages)
    }, signal);
    return success({ records: page.records, hasMore: page.hasMore });
  }
  activeTurnId(threadId) {
    for (const follow of this.follows) if (follow.threadId === threadId && follow.stepOpen) return follow.activeTurnId;
    return void 0;
  }
  async fetchThread(threadId, signal) {
    const result = record2(await this.client.request("thread/read", { threadId, includeTurns: false }, signal));
    const thread = record2(result.thread);
    if (string(thread.id) !== threadId) throw new Error("CodeX returned an invalid Thread history.");
    return thread;
  }
  async readHistoryPage(threadId, page, signal) {
    let value;
    try {
      value = record2(await this.client.request("dsh/sessionHistory", {
        threadId,
        ...page.beforeSeq === void 0 ? {} : { beforeSeq: page.beforeSeq },
        ...page.throughSeq === void 0 ? {} : { throughSeq: page.throughSeq },
        ...page.maxMessages === void 0 ? {} : { maxMessages: page.maxMessages }
      }, signal));
    } catch (error) {
      if (!isLegacySessionHistoryUnsupported(error)) throw error;
      const result = record2(await this.client.request("thread/read", { threadId, includeTurns: true }, signal));
      const thread = record2(result.thread);
      if (string(thread.id) !== threadId) throw new Error("CodeX returned an invalid Thread history.");
      value = paginateCodexNativeHistory(
        projectCodexNativeHistory(thread, `codex:${threadId}`, this.sessionGeneration),
        {
          beforeSeq: page.beforeSeq,
          throughSeq: page.throughSeq,
          maxMessages: page.maxMessages
        }
      );
    }
    value = adaptCodexHistoryPage(value, this.sessionGeneration);
    if (!isCodexNativeHistoryPage(value, `codex:${threadId}`)) {
      throw new Error("CodeX Remote returned an invalid paginated History.");
    }
    if (Object.hasOwn(value, "permissionPreset")) {
      const preset = value.permissionPreset;
      this.setPermissionSelection(`codex:${threadId}`, preset === "workspace-write" || preset === "danger-full-access" ? preset : void 0);
    }
    this.cacheHistoryImages(value);
    return value;
  }
  cacheHistoryImages(history) {
    const sessionId = history.header.id;
    const entries = "entries" in history ? history.entries : history.records;
    for (const entry of entries) this.cacheImageBlocks(sessionId, entry.event.data);
  }
  async sessionHistory(request, signal) {
    const sessionId = requiredString(request.sessionId, "sessionId");
    const beforeSeq = optionalNonNegativeInteger(request.beforeSeq);
    const history = await this.readHistoryPage(nativeThreadId(sessionId), {
      beforeSeq,
      maxMessages: optionalPositiveInteger(request.maxMessages)
    }, signal);
    const directory = await this.models(signal).catch(() => void 0);
    if (beforeSeq === void 0) await this.ensureRcFollow(sessionId, history);
    return success({
      events: history.records.map((entry) => ({
        event: entry.event,
        ...entry.view === void 0 ? {} : { view: entry.view }
      })),
      hasMore: history.hasMore,
      ...beforeSeq !== void 0 ? {} : {
        projections: {
          asOfSeq: history.cursor,
          values: {
            title: this.sessionTitle(sessionId),
            sessionListMetadata: { blank: history.cursor < 0, lastPromptAt: null },
            modelSelection: modelSelectionProjection(this.modelSelection(sessionId, directory)),
            permissions: codexPermissionsProjection(this.permissionSelection(sessionId)),
            imageLimits: codexImageLimitsProjection()
          }
        }
      }
    });
  }
  async ensureRcFollow(sessionId, seedHistory) {
    if (this.followsHas(sessionId)) return;
    const threadId = nativeThreadId(sessionId);
    const stale = [...this.follows].filter((follow2) => follow2.rcOnly && follow2.sessionId !== sessionId);
    for (const follow2 of stale) {
      this.follows.delete(follow2);
      follow2.queue.close();
      await follow2.close?.().catch(() => void 0);
    }
    const history = seedHistory ?? await this.readHistoryPage(threadId, {}, void 0);
    const controller = new AbortController();
    const follow = {
      sessionId,
      threadId,
      queue: new AsyncValueQueue2(controller.signal),
      nextSeq: history.cursor + 1,
      turn: history.nextTurn,
      stepOpen: history.activeTurnId !== void 0,
      startedItems: /* @__PURE__ */ new Set(),
      completedItems: /* @__PURE__ */ new Set(),
      streamedBlocks: /* @__PURE__ */ new Map(),
      nextBlockIndex: 0,
      streamActive: false,
      assistantStreamRevision: 0,
      liveItems: /* @__PURE__ */ new Map(),
      liveToolOutput: /* @__PURE__ */ new Map(),
      liveToolResultSeq: /* @__PURE__ */ new Map(),
      pendingToolImages: [],
      requestId: this.pendingRequestIds.get(sessionId),
      rcOnly: true,
      ...history.activeTurnId === void 0 ? {} : { activeTurnId: history.activeTurnId }
    };
    this.follows.add(follow);
    try {
      const stream = await this.client.subscribe(
        threadId,
        (frame) => this.acceptCodexFrame(follow, frame),
        controller.signal,
        () => this.closeFollowAfterRemoteStreamClosed(follow)
      );
      follow.close = async () => {
        controller.abort();
        await stream.close();
      };
    } catch (error) {
      this.follows.delete(follow);
      controller.abort();
      follow.queue.close();
      throw error;
    }
  }
  followsHas(sessionId) {
    for (const follow of this.follows) if (follow.sessionId === sessionId) return true;
    return false;
  }
  closeFollowAfterRemoteStreamClosed(follow) {
    this.follows.delete(follow);
    follow.queue.close();
    this.emitRemoteEvent("api-session/status", [follow.sessionId, false]);
  }
  async refreshAndPublishWorkspaces() {
    const catalog = await this.refreshCatalog().catch(() => void 0);
    if (catalog !== void 0) this.publishWorkspaceBaseline(catalog);
  }
  publishWorkspaceBaseline(catalog) {
    for (const queue of this.workspaceStreams) {
      for (const workspace of nativeVisibleWorkspaces(catalog, this.selectedWorkspaceId)) {
        queue.push({ type: "upsert", workspace: nativeWorkspace(workspace) });
      }
      queue.push({ type: "archived", archivedSessionIds: catalog.sessions.filter((item) => item.archived).map((item) => item.id) });
    }
  }
  createApiProxy() {
    const call = (endpoint) => async (request, signal) => {
      const payload = endpoint === "session.prompt" && isRecord4(request.payload) ? { ...request.payload, requestId: String(request.rpcId) } : request.payload;
      const result = await this.dispatch(rcEndpoint(endpoint), { args: { request: payload } }, signal ?? new AbortController().signal);
      return {
        rpcId: request.rpcId,
        result: result.ok ? success(result.value) : failure(result.error.code, result.error.message, result.error.details)
      };
    };
    return {
      sessions: {
        list: call("session.list"),
        search: call("session.search"),
        create: call("session.create"),
        history: call("session.history"),
        models: call("session.models"),
        selectModel: call("session.selectModel"),
        rename: call("session.rename"),
        fork: call("session.fork"),
        prompt: call("session.prompt"),
        attachment: call("session.attachment"),
        updateQueue: call("session.updateQueue"),
        cancel: call("session.cancel")
      },
      workspace: {
        list: call("workspace.list"),
        create: call("workspace.create"),
        rename: call("workspace.rename"),
        delete: call("workspace.delete"),
        insertBefore: call("workspace.insertBefore"),
        insertSessionBefore: call("workspace.insertSessionBefore"),
        archiveSession: call("workspace.archiveSession")
      },
      subagents: {},
      host: {
        describe: call("host.describe"),
        listDirectory: call("host.listDirectory")
      },
      skills: { list: call("skills.list") },
      agentPresets: {},
      goals: {},
      settings: {},
      credentials: {},
      llm: {},
      events: {
        mux: ((request, signal) => this.rcMux(request, signal)),
        host: ((request, signal) => this.rcHost(request, signal))
      },
      downloads: {},
      respond: async (message) => {
        const pending = this.pendingApprovals.get(String(message.rpcId));
        if (pending === void 0) return { accepted: false, reason: "not-pending" };
        const result = message.result;
        const outcome = result.ok ? result.value : void 0;
        const decision = outcome === "allowed-once" ? "accept" : outcome === "cancelled" ? "cancel" : "decline";
        await this.client.respond(pending.requestHandle, decision);
        this.pendingApprovals.delete(pending.requestHandle);
        return { accepted: true };
      }
    };
  }
  async *rcMux(request, signal) {
    const queue = new AsyncValueQueue2(signal);
    this.rcMuxStreams.add(queue);
    const catalog = await this.currentCatalog(signal);
    for (const session of catalog.sessions) queue.push({
      rpcId: `${String(request.rpcId)}:${session.id}:subscribed`,
      payload: { type: "session/subscribed", sessionId: session.id, lastSeq: -1 }
    });
    try {
      yield* queue;
    } finally {
      this.rcMuxStreams.delete(queue);
      queue.close();
    }
  }
  async *rcHost(_request, signal) {
    const queue = new AsyncValueQueue2(signal);
    this.rcHostStreams.add(queue);
    try {
      yield* queue;
    } finally {
      this.rcHostStreams.delete(queue);
      queue.close();
    }
  }
  broadcastRcMux(payload, rpcId = `codex-mux:${Date.now()}:${Math.random()}`) {
    for (const queue of this.rcMuxStreams) queue.push({ rpcId, payload });
  }
  broadcastRcHost(payload) {
    const frame = { rpcId: `codex-host:${Date.now()}:${Math.random()}`, payload };
    for (const queue of this.rcHostStreams) queue.push(frame);
  }
};
async function loadCatalog(client, signal, pendingThreads) {
  let projects = await loadCodexProjects(client, signal);
  const threads = [];
  let cursor2;
  for (let page = 0; page < MAX_CODEX_PAGES; page += 1) {
    const result = record2(await client.request("thread/list", {
      limit: CODEX_PAGE_LIMIT,
      sortKey: "updated_at",
      sortDirection: "desc",
      archived: false,
      ...cursor2 === void 0 ? {} : { cursor: cursor2 }
    }, signal));
    for (const value of array(result.data)) {
      const thread = record2(value);
      if (string(thread.id) !== void 0) threads.push(thread);
    }
    cursor2 = typeof result.nextCursor === "string" && result.nextCursor.length > 0 ? result.nextCursor : void 0;
    if (cursor2 === void 0) break;
  }
  if (pendingThreads !== void 0) {
    const listedIds = new Set(threads.map((thread) => string(thread.id)).filter((id2) => id2 !== void 0));
    for (const [threadId, thread] of pendingThreads) {
      if (listedIds.has(threadId)) pendingThreads.delete(threadId);
      else threads.unshift(thread);
    }
  }
  if (projects.length === 0) {
    projects = deriveCodexCwdWorkspaces(threads).map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      roots: [{ path: workspace.path }],
      position: workspace.position,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt
    }));
  }
  const projected = threads.map((thread) => {
    const session = projectCodexThread(thread);
    return session === void 0 ? void 0 : { thread, session };
  }).filter((value) => value !== void 0);
  const projectWorkspaces = projects.map(projectWorkspace);
  const workspaceByProjectId = new Map(projects.map((project, index) => [project.id, projectWorkspaces[index]]));
  const visibleSessionIds = /* @__PURE__ */ new Set();
  const visibleThreads = [];
  for (const { thread, session } of projected) {
    const projectWorkspaceForSession = findProjectWorkspace(thread, session, projects, workspaceByProjectId);
    if (projectWorkspaceForSession !== void 0) {
      addSessionToWorkspace(projectWorkspaceForSession, session);
      visibleSessionIds.add(session.id);
      visibleThreads.push(thread);
    }
  }
  const sessions = projected.map((value) => value.session).filter((session) => visibleSessionIds.has(session.id));
  return {
    threads: visibleThreads,
    sessions,
    projects,
    workspaces: projectWorkspaces
  };
}
async function loadCodexProjects(client, signal) {
  const projects = [];
  let cursor2;
  try {
    for (let page = 0; page < MAX_CODEX_PAGES; page += 1) {
      const result = record2(await client.request("project/list", {
        limit: CODEX_PAGE_LIMIT,
        ...cursor2 === void 0 ? {} : { cursor: cursor2 }
      }, signal));
      for (const value of array(result.data)) {
        const project = projectCodexProject(value, projects.length);
        if (project !== void 0 && !projects.some((item) => item.id === project.id)) projects.push(project);
      }
      cursor2 = typeof result.nextCursor === "string" && result.nextCursor.length > 0 ? result.nextCursor : void 0;
      if (cursor2 === void 0) break;
    }
  } catch (error) {
    if (isProjectListUnsupported(error)) return [];
    throw error;
  }
  return projects.sort((left, right) => left.position - right.position || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}
async function loadModelDirectory(client, signal) {
  const models = /* @__PURE__ */ new Map();
  let defaultModelId;
  let cursor2;
  for (let page = 0; page < MAX_CODEX_PAGES; page += 1) {
    const result = record2(await client.request("model/list", {
      limit: CODEX_PAGE_LIMIT,
      includeHidden: false,
      ...cursor2 === void 0 ? {} : { cursor: cursor2 }
    }, signal));
    for (const value of array(result.data)) {
      const source = record2(value);
      if (source.hidden === true) continue;
      const id2 = string(source.model) ?? string(source.id);
      if (id2 === void 0 || models.has(id2)) continue;
      const efforts = array(source.supportedReasoningEfforts).map((value2) => {
        const effort = record2(value2);
        const effortId = string(effort.reasoningEffort);
        if (effortId === void 0) return void 0;
        const description2 = string(effort.description);
        return {
          id: effortId,
          name: reasoningEffortName(effortId),
          ...description2 === void 0 ? {} : { description: description2 }
        };
      }).filter((value2) => value2 !== void 0);
      const defaultEffort2 = string(source.defaultReasoningEffort);
      const description = string(source.description);
      const model = {
        id: id2,
        name: string(source.displayName) ?? id2,
        ...description === void 0 ? {} : { description },
        ...efforts.length === 0 ? {} : {
          reasoning: {
            efforts,
            ...defaultEffort2 === void 0 || !efforts.some((effort) => effort.id === defaultEffort2) ? {} : { defaultEffort: defaultEffort2 }
          }
        }
      };
      models.set(id2, model);
      if (source.isDefault === true) defaultModelId = id2;
    }
    cursor2 = typeof result.nextCursor === "string" && result.nextCursor.length > 0 ? result.nextCursor : void 0;
    if (cursor2 === void 0) break;
  }
  const defaultModel = models.get(defaultModelId ?? "") ?? models.values().next().value;
  if (defaultModel === void 0) throw new Error("CodeX did not advertise any available models.");
  const defaultEffort = defaultModel.reasoning?.defaultEffort;
  return {
    default: {
      provider: CODEX_PROVIDER,
      model: defaultModel.id,
      ...defaultEffort === void 0 ? {} : { reasoningEffort: defaultEffort }
    },
    groups: [{ id: CODEX_PROVIDER, name: "CodeX", models: [...models.values()] }],
    models
  };
}
function projectCodexNativeHistory(thread, sessionId, sessionGeneration = "legacy") {
  const entries = [];
  let seq = 0;
  let turnNumber = 0;
  const active = activeTurnId(thread.turns);
  const append = (type, data, time = Date.now(), view, sourceEventSeqs) => {
    const eventSeq = seq++;
    entries.push({
      type: "event",
      event: {
        type,
        seq: eventSeq,
        time,
        data: adaptEventData(type, data, sessionGeneration),
        ...sourceEventSeqs === void 0 ? {} : { sourceEventSeqs },
        ...isSurfaceEvent(type) ? { surfaceOp: "append" } : {}
      },
      ...view === void 0 ? {} : { view }
    });
    return eventSeq;
  };
  for (const rawTurn of array(thread.turns)) {
    const turn = record2(rawTurn);
    const turnItems = array(turn.items).map(record2);
    const toolImages = turnItems.flatMap(toolOutputImageBlocks);
    let imageOwner = -1;
    for (let index = 0; index < turnItems.length; index += 1) {
      if (turnItems[index].type === "agentMessage") imageOwner = index;
    }
    turnNumber += 1;
    const turnActive = isActiveCodexTurn(turn);
    const time = normalizeTime(turn.createdAt) || normalizeTime(turn.startedAt) || normalizeTime(thread.createdAt) || Date.now();
    append("turn/start", { turn: turnNumber }, time);
    append("step/start", { turn: turnNumber, step: 1 }, time);
    for (let itemIndex = 0; itemIndex < turnItems.length; itemIndex += 1) {
      const item = turnItems[itemIndex];
      let toolCallSeq;
      for (const event of itemEvents(
        item,
        turnNumber,
        1,
        void 0,
        modelSelection(),
        sessionId,
        itemIndex === imageOwner ? toolImages : []
      )) {
        const eventSeq = append(
          event.type,
          event.data,
          normalizeTime(item.createdAt) || time,
          event.view,
          event.type === "tool/result" && toolCallSeq !== void 0 ? [toolCallSeq] : void 0
        );
        if (event.type === "tool/call") toolCallSeq = eventSeq;
      }
    }
    if (turnActive) continue;
    append("step/end", { turn: turnNumber, step: 1 }, normalizeTime(turn.updatedAt) || normalizeTime(turn.completedAt) || time);
    append("turn/end", {
      turn: turnNumber,
      reason: turn.status === "failed" || turn.error !== void 0 && turn.error !== null ? { kind: "error", error: { message: "CodeX turn failed.", code: "codex-turn-failed" } } : { kind: "completed" }
    }, normalizeTime(turn.updatedAt) || normalizeTime(turn.completedAt) || time);
  }
  const projected = projectCodexThread(thread);
  return {
    header: {
      version: sessionGeneration === "v3" ? 3 : 1,
      id: sessionId,
      createdAt: projected?.createdAt ?? Date.now(),
      ...projected?.cwd === void 0 ? {} : { cwd: projected.cwd },
      ...sessionGeneration === "v3" ? { isSeeded: false } : {}
    },
    entries,
    lastSeq: seq - 1,
    nextTurn: turnNumber,
    ...active === void 0 ? {} : { activeTurnId: active }
  };
}
function paginateCodexNativeHistory(history, request) {
  const throughSeq = Math.min(request.throughSeq ?? history.lastSeq, history.lastSeq);
  const endSeq = Math.min(throughSeq, request.beforeSeq === void 0 ? throughSeq : request.beforeSeq - 1);
  const window = endSeq < 0 ? [] : history.entries.filter((entry) => entry.event.seq <= endSeq);
  const maxMessages = request.maxMessages ?? DEFAULT_HISTORY_MESSAGES;
  let messages = 0;
  let cut = 0;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const event = window[index].event;
    if (!isSurfaceEvent(event.type) || event.surfaceOp !== "append") continue;
    messages += 1;
    if (messages >= maxMessages) {
      cut = Math.min(event.seq, ...event.sourceEventSeqs ?? []);
      break;
    }
  }
  return {
    header: history.header,
    cursor: history.lastSeq,
    nextTurn: history.nextTurn,
    records: window.filter((entry) => entry.event.seq >= cut),
    hasMore: window.some((entry) => entry.event.seq < cut),
    ...history.activeTurnId === void 0 ? {} : { activeTurnId: history.activeTurnId }
  };
}
function adaptEventData(type, data, sessionGeneration) {
  if (sessionGeneration !== "v3" || type !== "assistant/message") return data;
  const value = record2(data);
  return Array.isArray(value.stream) ? value : { ...value, stream: [] };
}
function adaptCodexHistoryPage(value, sessionGeneration) {
  if (sessionGeneration !== "v3") return value;
  const page = record2(value);
  const sourceHeader = record2(page.header);
  const { seedLength: _seedLength, ...header } = sourceHeader;
  const records = Array.isArray(page.records) ? page.records.map((raw) => {
    const entry = record2(raw);
    const sourceEvent = record2(entry.event);
    const sourceSurfaceOp = record2(sourceEvent.surfaceOp);
    const surfaceOp = sourceEvent.surfaceOp === "append" ? "append" : sourceSurfaceOp.op === "replace" && integer(sourceSurfaceOp.startSeq) !== void 0 && integer(sourceSurfaceOp.endSeq) !== void 0 ? sourceSurfaceOp : sourceSurfaceOp.op === "replace" && integer(sourceSurfaceOp.start) !== void 0 && integer(sourceSurfaceOp.end) !== void 0 ? {
      op: "replace",
      startSeq: sourceSurfaceOp.start,
      endSeq: sourceSurfaceOp.end
    } : sourceEvent.surfaceOp;
    return {
      ...entry,
      event: {
        ...sourceEvent,
        data: adaptEventData(string(sourceEvent.type) ?? "", sourceEvent.data, sessionGeneration),
        ...surfaceOp === void 0 ? {} : { surfaceOp }
      }
    };
  }) : page.records;
  return {
    ...page,
    header: { ...header, version: 3, isSeeded: sourceHeader.isSeeded === true },
    records
  };
}
function itemEvents(item, turn, step, requestId, selection = modelSelection(), sessionId = CODEX_SESSION_PREFIX, supplementalImages = []) {
  const type = string(item.type);
  const id2 = string(item.id) ?? `${turn}:${step}:${hashString(JSON.stringify(item))}`;
  const text = itemText2(item);
  if (type === "userMessage") return [{
    type: "user/message",
    data: {
      id: id2,
      role: "user",
      content: messageContent(item, `${sessionId}:${id2}`, "text", text),
      source: requestId === void 0 || requestId === "" ? { kind: "user" } : { kind: "user", rpcId: requestId }
    }
  }];
  if (type === "agentMessage" || type === "reasoning" || type === "plan") return [{
    type: "assistant/message",
    data: {
      turn,
      step,
      message: {
        id: id2,
        role: "assistant",
        content: messageContent(
          item,
          `${sessionId}:${id2}`,
          type === "reasoning" ? "reasoning" : "text",
          text,
          type === "agentMessage" ? supplementalImages : []
        ),
        source: { kind: "model", provider: selection.provider, model: selection.model }
      }
    }
  }];
  if (type !== void 0 && isToolItemType2(type)) {
    const name2 = toolEventName(type);
    const args = toolArguments(item);
    return [
      {
        type: "tool/call",
        data: { turn, step, callId: id2, name: name2, arguments: JSON.stringify(args) },
        view: { for: "call", view: toolCallView(item, type, args) }
      },
      toolResultEvent(item, turn, step, id2, toolResultText(item, type, text))
    ];
  }
  if (type === "error") return [{
    type: "assistant/message",
    data: {
      turn,
      step,
      message: {
        id: id2,
        role: "assistant",
        content: [{ type: "text", text: text ?? "CodeX reported an error." }],
        source: { kind: "model", provider: selection.provider, model: selection.model }
      }
    }
  }];
  return [];
}
function messageContent(item, attachmentSeed, fallbackType, fallbackText, supplementalImages = []) {
  const source = item.content ?? item.input;
  const blocks = contentBlocks(source, attachmentSeed);
  const images = contentBlocks(supplementalImages, `${attachmentSeed}:tool-output`);
  if (blocks.length > 0 || images.length > 0) {
    return [...blocks.length > 0 ? blocks : [{ type: fallbackType, text: fallbackText ?? "" }], ...images];
  }
  return [{ type: fallbackType, text: fallbackText ?? "" }];
}
function toolOutputImageBlocks(item) {
  const candidates = [
    record2(item.result).content,
    record2(item.output).content,
    item.contentItems,
    Array.isArray(item.output) ? item.output : void 0
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const images = candidate.flatMap((value) => {
      const block = record2(value);
      return isImageContent2(block) && parseImageBlock(block) !== void 0 ? [block] : [];
    });
    if (images.length > 0) return images;
  }
  return [];
}
function contentBlocks(value, attachmentSeed) {
  if (typeof value === "string") return [{ type: "text", text: value }];
  if (!Array.isArray(value)) return [];
  const blocks = [];
  let imageIndex = 0;
  for (const raw of value) {
    if (typeof raw === "string") {
      blocks.push({ type: "text", text: raw });
      continue;
    }
    const block = record2(raw);
    const image = imageContentBlock(block, attachmentSeed, imageIndex);
    if (image !== void 0) {
      imageIndex += 1;
      blocks.push(image);
      continue;
    }
    const text = string(block.text) ?? string(block.content);
    if (text !== void 0) blocks.push({ type: block.type === "reasoning" ? "reasoning" : "text", text });
  }
  return blocks;
}
function imageContentBlock(block, attachmentSeed, index) {
  if (!isImageContent2(block)) return void 0;
  const image = parseImageBlock(block);
  if (image === void 0) return void 0;
  const dimensions = imageDimensions(image.mediaType, image.data);
  const name2 = string(block.name);
  const attachment = {
    attachmentId: `${CODEX_IMAGE_ATTACHMENT_PREFIX}${hashString(`${attachmentSeed}:${index}`)}:${index}`,
    mediaType: image.mediaType,
    bytes: base64ByteLength(image.data),
    width: dimensions.width,
    height: dimensions.height,
    ...name2 === void 0 ? {} : { name: name2 }
  };
  return {
    type: "image",
    attachment,
    mediaType: image.mediaType,
    data: image.data,
    url: image.url,
    ...name2 === void 0 ? {} : { name: name2 }
  };
}
function isImageContent2(block) {
  return block.type === "image" || block.type === "input_image";
}
function parseImageBlock(block) {
  const url = string(block.url) ?? string(block.image_url) ?? string(record2(block.image_url).url);
  const parsed = url === void 0 ? void 0 : parseDataImageUrl2(url);
  if (parsed !== void 0) return parsed;
  const data = string(block.data);
  if (data === void 0 || !isCanonicalBase642(data)) return void 0;
  if (data.length > MAX_CODEX_IMAGE_BASE64) return void 0;
  const mediaType = string(block.mediaType) ?? string(block.mimeType) ?? sniffImageMediaType2(data);
  return mediaType !== void 0 && CODEX_IMAGE_MEDIA_TYPES2.has(mediaType) ? { mediaType, data, url: `data:${mediaType};base64,${data}` } : void 0;
}
function parseDataImageUrl2(value) {
  const match = DATA_IMAGE_URL2.exec(value);
  if (match === null) return void 0;
  const mediaType = match[1];
  const data = match[2];
  if (!CODEX_IMAGE_MEDIA_TYPES2.has(mediaType) || !isCanonicalBase642(data)) return void 0;
  return { mediaType, data, url: `data:${mediaType};base64,${data}` };
}
function collectImageBlocks(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectImageBlocks(item, output);
    return output;
  }
  if (!isRecord4(value)) return output;
  if (value.type === "image") output.push(value);
  for (const [key, child] of Object.entries(value)) {
    if (key === "attachment") continue;
    if (key === "content" || key === "message" || key === "inserted" || key === "chunk" || key === "block") {
      collectImageBlocks(child, output);
    }
  }
  return output;
}
function base64ByteLength(value) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(1, Math.floor(value.length * 3 / 4) - padding);
}
function imageDimensions(mediaType, data) {
  const bytes = base64PrefixBytes2(data, 256 * 1024);
  const parsed = mediaType === "image/png" ? pngDimensions(bytes) : mediaType === "image/jpeg" ? jpegDimensions(bytes) : mediaType === "image/gif" ? gifDimensions(bytes) : mediaType === "image/webp" ? webpDimensions(bytes) : void 0;
  return parsed ?? { width: 1, height: 1 };
}
function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71 || bytes[4] !== 13 || bytes[5] !== 10 || bytes[6] !== 26 || bytes[7] !== 10) return void 0;
  return positiveDimensions(readUint32BE(bytes, 16), readUint32BE(bytes, 20));
}
function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return void 0;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 255) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 216 || marker === 217) continue;
    if (offset + 2 > bytes.length) return void 0;
    const length = readUint16BE(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return void 0;
    if (isJpegSof(marker) && length >= 7) {
      return positiveDimensions(readUint16BE(bytes, offset + 5), readUint16BE(bytes, offset + 3));
    }
    offset += length;
  }
  return void 0;
}
function gifDimensions(bytes) {
  if (bytes.length < 10 || bytes[0] !== 71 || bytes[1] !== 73 || bytes[2] !== 70 || bytes[3] !== 56 || bytes[4] !== 55 && bytes[4] !== 57 || bytes[5] !== 97) return void 0;
  return positiveDimensions(readUint16LE(bytes, 6), readUint16LE(bytes, 8));
}
function webpDimensions(bytes) {
  if (bytes.length < 30 || stringFromBytes(bytes, 0, 4) !== "RIFF" || stringFromBytes(bytes, 8, 12) !== "WEBP") return void 0;
  const chunk = stringFromBytes(bytes, 12, 16);
  if (chunk === "VP8X") {
    return positiveDimensions(1 + readUint24LE(bytes, 24), 1 + readUint24LE(bytes, 27));
  }
  if (chunk === "VP8L" && bytes[20] === 47) {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    const width = 1 + b0 + ((b1 & 63) << 8);
    const height = 1 + ((b1 & 192) >> 6) + (b2 << 2) + ((b3 & 15) << 10);
    return positiveDimensions(width, height);
  }
  if (chunk === "VP8 " && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
    return positiveDimensions(readUint16LE(bytes, 26) & 16383, readUint16LE(bytes, 28) & 16383);
  }
  return void 0;
}
function sniffImageMediaType2(data) {
  const bytes = base64PrefixBytes2(data, 32);
  if (pngDimensions(bytes) !== void 0) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (gifDimensions(bytes) !== void 0) return "image/gif";
  if (bytes.length >= 12 && stringFromBytes(bytes, 0, 4) === "RIFF" && stringFromBytes(bytes, 8, 12) === "WEBP") return "image/webp";
  return void 0;
}
function base64PrefixBytes2(value, maxBytes) {
  const chars = value.slice(0, Math.ceil(maxBytes / 3) * 4);
  let binary;
  try {
    binary = atob(chars);
  } catch {
    return new Uint8Array();
  }
  const bytes = new Uint8Array(Math.min(binary.length, maxBytes));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function readUint16BE(bytes, offset) {
  return (bytes[offset] << 8) + bytes[offset + 1];
}
function readUint16LE(bytes, offset) {
  return bytes[offset] + (bytes[offset + 1] << 8);
}
function readUint24LE(bytes, offset) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}
function readUint32BE(bytes, offset) {
  return bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}
function positiveDimensions(width, height) {
  return width > 0 && height > 0 ? { width, height } : void 0;
}
function isJpegSof(marker) {
  return marker >= 192 && marker <= 195 || marker >= 197 && marker <= 199 || marker >= 201 && marker <= 203 || marker >= 205 && marker <= 207;
}
function stringFromBytes(bytes, start, end) {
  if (bytes.length < end) return "";
  let output = "";
  for (let index = start; index < end; index += 1) output += String.fromCharCode(bytes[index]);
  return output;
}
function toolResultEvent(item, turn, step, id2, resultText) {
  const type = string(item.type) ?? "unknown";
  return {
    type: "tool/result",
    data: {
      turn,
      step,
      message: {
        id: `${id2}:result`,
        role: "user",
        content: [{
          type: "tool-result",
          toolCallId: id2,
          content: [{ type: "text", text: resultText }],
          ...item.status === "failed" || item.success === false ? { isError: true } : {}
        }],
        source: { kind: "tool", callId: id2 }
      }
    },
    view: { for: "result", view: toolResultView(item, type, resultText) }
  };
}
function toolResultContentReplacement(event) {
  const data = record2(event.data);
  const message = record2(data.message);
  const content = array(message.content);
  const result = record2(content[0]);
  if (result.isError === void 0) return event;
  const { isError: _isError, ...stableResult } = result;
  return {
    ...event,
    data: {
      ...data,
      message: { ...message, content: [stableResult] }
    }
  };
}
function isToolItemType2(type) {
  return type === "commandExecution" || type === "mcpToolCall" || type === "dynamicToolCall" || type === "fileChange" || type === "functionCallOutput" || type === "hookPrompt" || type === "collabAgentToolCall" || type === "subAgentActivity" || type === "webSearch" || type === "imageView" || type === "imageGeneration" || type === "sleep" || type === "enteredReviewMode" || type === "exitedReviewMode" || type === "contextCompaction";
}
function toolEventName(type) {
  if (type === "fileChange") return "codex.fileChange";
  if (type === "commandExecution") return "codex.command";
  if (type === "webSearch") return "codex.webSearch";
  if (type === "collabAgentToolCall" || type === "subAgentActivity") return "codex.subagent";
  if (type === "imageView" || type === "imageGeneration") return "codex.image";
  if (type === "enteredReviewMode" || type === "exitedReviewMode") return "codex.reviewMode";
  if (type === "contextCompaction") return "codex.compaction";
  return `codex.${type}`;
}
function toolResultText(item, type, text) {
  if (type === "fileChange") return fileChangeSummary(item);
  if (type === "webSearch") {
    const count = array(item.results).length;
    return count === 0 ? "Web search completed." : `Web search returned ${count} result${count === 1 ? "" : "s"}.`;
  }
  if (type === "imageView") return `Viewed image: ${string(item.path) ?? "image"}`;
  if (type === "imageGeneration") {
    const savedPath = string(item.savedPath);
    return savedPath === void 0 ? `Image generation ${string(item.status) ?? "completed"}.` : `Generated image: ${savedPath}`;
  }
  if (type === "contextCompaction") return "CodeX compacted the conversation context.";
  if (type === "enteredReviewMode") return `Entered review mode${string(item.review) ? `: ${string(item.review)}` : "."}`;
  if (type === "exitedReviewMode") return `Exited review mode${string(item.review) ? `: ${string(item.review)}` : "."}`;
  if (type === "sleep") return `Waited ${integer(item.durationMs) ?? 0} ms.`;
  if (type === "subAgentActivity") {
    return [string(record2(item.kind).type) ?? string(item.kind) ?? "Subagent activity", string(item.agentPath)].filter((value) => value !== void 0).join(": ");
  }
  return text ?? itemText2(record2(item.result)) ?? itemText2(record2(item.output)) ?? string(item.status) ?? type;
}
function isSurfaceEvent(type) {
  return type === "user/message" || type === "assistant/message" || type === "tool/result";
}
function toolCallView(item, type, args) {
  if (type === "commandExecution") {
    return {
      card: "terminal",
      title: commandText(item.command) ?? "CodeX command",
      ...typeof item.cwd === "string" ? { cwd: item.cwd } : {}
    };
  }
  const locations = fileLocations(item);
  if (type === "fileChange") {
    return {
      card: "generic",
      title: locations.length === 0 ? "CodeX file changes" : `Modify ${locations.length} file${locations.length === 1 ? "" : "s"}`,
      kind: "edit",
      rawInput: args,
      ...locations.length === 0 ? {} : { locations }
    };
  }
  if (type === "webSearch") {
    return {
      card: "generic",
      title: string(item.query) ?? "CodeX web search",
      kind: "search",
      rawInput: args
    };
  }
  if (type === "imageView" || type === "imageGeneration") {
    const path = string(item.path) ?? string(item.savedPath);
    return {
      card: "generic",
      title: type === "imageView" ? "View image" : "Generate image",
      kind: type === "imageView" ? "read" : "other",
      ...path === void 0 ? {} : { locations: [{ path }] }
    };
  }
  if (type === "collabAgentToolCall" || type === "subAgentActivity") {
    return {
      card: "generic",
      title: type === "collabAgentToolCall" ? `Subagent: ${string(item.tool) ?? "collaboration"}` : `Subagent activity: ${string(item.agentPath) ?? string(item.agentThreadId) ?? "agent"}`,
      kind: "other",
      rawInput: args
    };
  }
  if (type === "contextCompaction") return { card: "generic", title: "Compact conversation context", kind: "other" };
  if (type === "enteredReviewMode") return { card: "generic", title: "Enter review mode", kind: "other" };
  if (type === "exitedReviewMode") return { card: "generic", title: "Exit review mode", kind: "other" };
  return {
    card: "generic",
    title: toolDisplayName(item, type),
    kind: "other"
  };
}
function toolResultView(item, type, resultText) {
  if (type === "commandExecution") {
    return {
      card: "terminal",
      output: resultText,
      ...typeof item.exitCode === "number" && Number.isSafeInteger(item.exitCode) ? { exitCode: item.exitCode } : {}
    };
  }
  return {
    card: "generic",
    ...type === "fileChange" ? { title: item.status === "inProgress" ? "CodeX file changes" : "CodeX file changes completed" } : {},
    ...type === "mcpToolCall" && item.status === "inProgress" ? { title: "CodeX MCP tool in progress", content: [{ type: "text", text: resultText }] } : {}
  };
}
function toolDisplayName(item, type) {
  return string(item.name) ?? string(item.tool) ?? string(record2(item.tool).name) ?? (type === "mcpToolCall" ? "CodeX MCP tool" : humanizeItemType(type));
}
function fileLocations(item) {
  return array(item.changes).map((value) => string(record2(value).path)).filter((path) => path !== void 0 && path.length > 0).map((path) => ({ path }));
}
function nativeWorkspace(view) {
  const { sessionCount: _sessionCount, ...workspace } = view;
  return workspace;
}
function nativeVisibleWorkspaces(catalog, selectedWorkspaceId) {
  return catalog.workspaces.filter((workspace) => workspace.sessionIds.length > 0 || workspace.workspaceId === selectedWorkspaceId);
}
function projectWorkspace(project) {
  const root = project.roots[0];
  return {
    workspaceId: codexProjectWorkspaceId(project.id),
    path: root.path,
    title: project.name.trim() || basename(root.path),
    sessionIds: [],
    sessionCount: 0,
    createdAt: isoTime(project.createdAt),
    updatedAt: isoTime(project.updatedAt || project.createdAt)
  };
}
function projectCodexProject(value, fallbackPosition) {
  const source = record2(value);
  const id2 = string(source.id);
  if (id2 === void 0) return void 0;
  const roots = array(source.roots).map((root) => string(record2(root).path)).filter((path) => path !== void 0 && path.length > 0).map((path) => ({ path }));
  if (roots.length === 0) return void 0;
  return {
    id: id2,
    name: string(source.name) ?? basename(roots[0].path),
    roots,
    position: finiteNumber(source.position) ?? fallbackPosition,
    createdAt: normalizeTime(source.createdAt),
    updatedAt: normalizeTime(source.updatedAt)
  };
}
function findProjectWorkspace(thread, session, projects, workspaceByProjectId) {
  const explicitProjectId = string(thread.projectId);
  const explicitWorkspace = explicitProjectId === void 0 ? void 0 : workspaceByProjectId.get(explicitProjectId);
  if (explicitWorkspace !== void 0) return explicitWorkspace;
  if (session.cwd === void 0) return void 0;
  const match = projects.flatMap((project) => project.roots.map((root) => ({ project, root }))).filter((value) => containsPath(value.root.path, session.cwd)).sort((left, right) => {
    const length = right.root.path.length - left.root.path.length;
    if (length !== 0) return length;
    const position = left.project.position - right.project.position;
    if (position !== 0) return position;
    return left.project.id.localeCompare(right.project.id);
  })[0];
  return match === void 0 ? void 0 : workspaceByProjectId.get(match.project.id);
}
function addSessionToWorkspace(workspace, session) {
  if (!workspace.sessionIds.includes(session.id)) {
    workspace.sessionIds.push(session.id);
    workspace.sessionCount = workspace.sessionIds.length;
  }
  const createdAt = isoTime(session.createdAt);
  const updatedAt = isoTime(session.updatedAt || session.createdAt);
  if (createdAt < workspace.createdAt) workspace.createdAt = createdAt;
  if (updatedAt > workspace.updatedAt) workspace.updatedAt = updatedAt;
}
function containsPath(root, candidate) {
  const normalizedRoot = normalizePathForCompare(root);
  const normalizedCandidate = normalizePathForCompare(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`) || normalizedCandidate.startsWith(`${normalizedRoot}\\`);
}
function normalizePathForCompare(path) {
  return path.replace(/[\\/]+$/u, "") || path;
}
function modelSelection() {
  return { provider: CODEX_PROVIDER, model: CODEX_MODEL };
}
function codexPromptInput(content) {
  if (content.length === 0 || content.length > MAX_CODEX_PROMPT_PARTS) return void 0;
  const input2 = [];
  for (const value of content) {
    if (!isRecord4(value)) return void 0;
    if (value.type === "text") {
      if (typeof value.text !== "string" || value.text.length === 0 || value.text.length > MAX_CODEX_PROMPT_TEXT) return void 0;
      input2.push({ type: "text", text: value.text });
      continue;
    }
    if (value.type === "image") {
      if (typeof value.mediaType !== "string" || !CODEX_IMAGE_MEDIA_TYPES2.has(value.mediaType) || typeof value.data !== "string" || value.data.length > MAX_CODEX_IMAGE_BASE64 || !isCanonicalBase642(value.data)) return void 0;
      input2.push({ type: "image", mediaType: value.mediaType, data: value.data });
      continue;
    }
    return void 0;
  }
  return input2;
}
function isCanonicalBase642(value) {
  return value.length >= 4 && value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
}
function modelSelectionProjection(selection) {
  return { lastUsed: selection, next: selection };
}
function codexPermissionsProjection(preset) {
  return {
    options: [
      {
        value: "workspace-write",
        name: "workspace-write",
        description: "Write inside the workspace; wider command and file access requires one-time approval."
      },
      {
        value: "danger-full-access",
        name: "danger-full-access",
        description: "Full Host file access without approval prompts for subsequent turns in this virtual Session."
      }
    ],
    currentValue: preset ?? "Host settings (not reported)"
  };
}
function codexImageLimitsProjection() {
  return {
    maxImageBytes: 20 * 1024 * 1024,
    maxImagesPerMessage: MAX_CODEX_PROMPT_PARTS,
    maxMessageImageBytes: 100 * 1024 * 1024,
    maxImagePixels: 4e7,
    maxImageDimension: 8192,
    mediaTypes: [...CODEX_IMAGE_MEDIA_TYPES2]
  };
}
function isCodexPermissionPreset(value) {
  return value === "workspace-write" || value === "danger-full-access";
}
function modelCatalog(directory) {
  return {
    default: directory.default,
    routableProviders: [CODEX_PROVIDER],
    groups: directory.groups,
    failures: []
  };
}
function codexModelParams(selection) {
  return {
    model: selection.model,
    ...selection.reasoningEffort === void 0 ? {} : { effort: selection.reasoningEffort }
  };
}
function reasoningEffortName(effort) {
  const names = {
    none: "None",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra High",
    max: "Max",
    ultra: "Ultra"
  };
  return names[effort] ?? effort;
}
function displayTitle(session) {
  const value = session.title ?? session.preview;
  return value === void 0 || value.trim() === "" ? null : value.slice(0, 256);
}
function itemText2(value) {
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  const content = Array.isArray(value.content) ? value.content : Array.isArray(value.input) ? value.input : void 0;
  if (content !== void 0) {
    const text = content.map((part) => {
      if (typeof part === "string") return part;
      const block = record2(part);
      return string(block.text) ?? string(block.content) ?? "";
    }).filter(Boolean).join("\n");
    if (text !== "") return text;
  }
  if (Array.isArray(value.summary)) return value.summary.filter((item) => typeof item === "string").join("\n");
  if (typeof value.output === "string") return value.output;
  if (typeof value.aggregatedOutput === "string") return value.aggregatedOutput;
  return void 0;
}
function toolArguments(item) {
  if (item.type === "commandExecution") return { command: commandText(item.command) ?? item.command ?? "" };
  if (item.type === "fileChange") return {
    changes: array(item.changes).map((value) => {
      const change = record2(value);
      const kind = typeof change.kind === "string" ? change.kind : string(record2(change.kind).type);
      return {
        ...typeof change.path === "string" ? { path: change.path } : {},
        ...kind === void 0 ? {} : { kind }
      };
    })
  };
  if (item.type === "webSearch") return { query: string(item.query) ?? "" };
  if (item.type === "imageView") return { path: string(item.path) ?? "" };
  if (item.type === "imageGeneration") return {
    ...string(item.revisedPrompt) === void 0 ? {} : { prompt: string(item.revisedPrompt) },
    transparentBackground: item.transparentBackground === true
  };
  if (item.type === "collabAgentToolCall") return {
    tool: string(item.tool) ?? "collaboration",
    receiverThreadIds: array(item.receiverThreadIds).filter((value) => typeof value === "string"),
    ...string(item.model) === void 0 ? {} : { model: string(item.model) }
  };
  if (item.type === "subAgentActivity") return {
    agentThreadId: string(item.agentThreadId) ?? "",
    agentPath: string(item.agentPath) ?? "",
    kind: string(record2(item.kind).type) ?? string(item.kind) ?? "activity"
  };
  if (item.type === "sleep") return { durationMs: integer(item.durationMs) ?? 0 };
  if (item.type === "enteredReviewMode" || item.type === "exitedReviewMode") return {
    review: string(item.review) ?? ""
  };
  if (item.type === "contextCompaction") return {};
  return { name: item.name ?? item.tool ?? item.type ?? "tool", arguments: item.arguments ?? item.input ?? {} };
}
function fileChangeSummary(item) {
  const changes = array(item.changes).map((value) => {
    const change = record2(value);
    const path = string(change.path);
    const kind = typeof change.kind === "string" ? change.kind : string(record2(change.kind).type);
    return [kind, path].filter((part) => part !== void 0 && part.length > 0).join(" ");
  }).filter(Boolean);
  return changes.length === 0 ? "File changes completed." : changes.join("\n");
}
function sanitizedFileChanges(value) {
  return array(value).flatMap((raw) => {
    const change = record2(raw);
    const path = string(change.path);
    if (path === void 0) return [];
    const kind = typeof change.kind === "string" ? change.kind : string(record2(change.kind).type);
    return [{ path, ...kind === void 0 ? {} : { kind } }];
  });
}
function appendBoundedText(current, delta) {
  const value = `${current}${delta}`;
  if (value.length <= MAX_LIVE_TOOL_OUTPUT) return value;
  return `\u2026 earlier output omitted \u2026
${value.slice(value.length - MAX_LIVE_TOOL_OUTPUT)}`;
}
function humanizeItemType(type) {
  const names = {
    functionCallOutput: "CodeX function output",
    hookPrompt: "CodeX hook prompt",
    dynamicToolCall: "CodeX tool",
    collabAgentToolCall: "CodeX subagent",
    subAgentActivity: "CodeX subagent activity",
    webSearch: "CodeX web search",
    imageView: "CodeX image view",
    imageGeneration: "CodeX image generation",
    sleep: "CodeX wait",
    enteredReviewMode: "CodeX review mode",
    exitedReviewMode: "CodeX review mode",
    contextCompaction: "CodeX context compaction"
  };
  return names[type] ?? "CodeX tool";
}
function commandText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(" ");
  const source = record2(value);
  return string(source.command) ?? string(source.text);
}
function sessionIdFromAddress(address) {
  if (address.kind === "session") return requiredString(address.sessionId, "sessionId");
  return requiredString(address.childSessionId, "childSessionId");
}
function nativeThreadId(sessionId) {
  if (!sessionId.startsWith(CODEX_SESSION_PREFIX) || sessionId.length === CODEX_SESSION_PREFIX.length) {
    throw new Error("The selected Session does not belong to CodeX.");
  }
  return sessionId.slice(CODEX_SESSION_PREFIX.length);
}
function activeTurnId(value) {
  if (!Array.isArray(value)) return void 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const turn = record2(value[index]);
    if (isActiveCodexTurn(turn) && typeof turn.id === "string" && turn.id.length > 0) return turn.id;
  }
  return void 0;
}
function isActiveCodexTurn(turn) {
  return turn.status === "inProgress" || turn.status === "running";
}
function carrierArgs(payload) {
  return record2(record2(payload).args);
}
function requestArg(args) {
  return record2(args.request ?? args._request ?? args);
}
function rcEndpoint(endpoint) {
  if (endpoint === "workspace.list") return "workspace/list";
  return endpoint.replace(".", "/");
}
function success(value) {
  return { ok: true, value };
}
function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}
function ok(value) {
  return value === void 0 ? { ok: true } : { ok: true, value };
}
function business(value) {
  const result = record2(value);
  if (result.ok === true) return ok(result.value);
  if (result.ok === false) {
    const error = record2(result.error);
    return fail(string(error.code) ?? "internal", string(error.message) ?? "CodeX virtual Harness rejected the request.", record2(error.details));
  }
  return ok(value);
}
function isCodexDirectoryListing(value) {
  const listing = record2(value);
  return typeof listing.path === "string" && typeof listing.home === "string" && Array.isArray(listing.crumbs) && listing.crumbs.every(isCodexDirectoryEntry) && Array.isArray(listing.entries) && listing.entries.every(isCodexDirectoryEntry) && typeof listing.truncated === "boolean";
}
function isCodexDirectoryEntry(value) {
  const entry = record2(value);
  return typeof entry.name === "string" && typeof entry.path === "string" && typeof entry.hidden === "boolean";
}
function fail(code, message, details = {}) {
  return { ok: false, error: { code, message, details } };
}
function failFrom(error) {
  const source = error instanceof Error ? error : new Error(String(error));
  return fail(errorCode(source) ?? "internal", source.message, errorDetails(source));
}
function isLegacySessionHistoryUnsupported(error) {
  if (!(error instanceof Error)) return false;
  return errorCode(error) === "METHOD_NOT_ALLOWED" || errorCode(error) === "METHOD_NOT_FOUND" || error.message.includes("The requested Codex method is not available over Remote.");
}
function errorCode(error) {
  return "code" in error && typeof error.code === "string" ? error.code : void 0;
}
function errorDetails(error) {
  return "details" in error && isRecord4(error.details) ? error.details : {};
}
function record2(value) {
  return isRecord4(value) ? value : {};
}
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function array(value) {
  return Array.isArray(value) ? value : [];
}
function string(value) {
  return typeof value === "string" ? value : void 0;
}
function integer(value) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : void 0;
}
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function optionalInteger(value) {
  if (value === void 0) return void 0;
  const parsed = integer(value);
  if (parsed === void 0) throw new Error("The CodeX History cursor is invalid.");
  return parsed;
}
function optionalNonNegativeInteger(value) {
  const parsed = optionalInteger(value);
  if (parsed !== void 0 && parsed < 0) throw new Error("The CodeX History cursor is invalid.");
  return parsed;
}
function optionalPositiveInteger(value) {
  const parsed = optionalInteger(value);
  if (parsed !== void 0 && parsed <= 0) throw new Error("The CodeX History page size is invalid.");
  return parsed;
}
function isCodexNativeHistoryPage(value, sessionId) {
  const page = record2(value);
  const header = record2(page.header);
  return header.id === sessionId && integer(page.cursor) !== void 0 && integer(page.nextTurn) !== void 0 && Array.isArray(page.records) && typeof page.hasMore === "boolean" && (page.activeTurnId === void 0 || typeof page.activeTurnId === "string");
}
function truncateCodePoints(value, maximum) {
  return [...value].slice(0, maximum).join("");
}
function requiredString(value, field) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`The CodeX ${field} is required.`);
  return value;
}
function normalizeTime(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return value < 1e10 ? Math.floor(value * 1e3) : Math.floor(value);
}
function isoTime(value) {
  return new Date(normalizeTime(value) || Date.now()).toISOString();
}
function isProjectListUnsupported(error) {
  if (!(error instanceof Error)) return false;
  const code = errorCode(error);
  return code === "METHOD_NOT_ALLOWED" || code === "METHOD_NOT_FOUND" || code === "CODEX_UPSTREAM_ERROR" || error.message.includes("The requested Codex method is not available over Remote.");
}
function basename(path) {
  const normalized = path.replace(/[\\/]+$/u, "");
  const parts = normalized.split(/[\\/]/u);
  return parts.at(-1) || path;
}
function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
var AsyncValueQueue2 = class {
  constructor(signal) {
    this.signal = signal;
    this.onAbort = () => this.close();
    signal.addEventListener("abort", this.onAbort, { once: true });
    if (signal.aborted) this.close();
  }
  values = [];
  waiters = [];
  closed = false;
  onAbort;
  push(value) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter === void 0) this.values.push(value);
    else waiter({ done: false, value });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.signal.removeEventListener("abort", this.onAbort);
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: void 0 });
  }
  iterate(dispose) {
    const queue = this;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          yield* queue;
        } finally {
          dispose();
          queue.close();
        }
      }
    };
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.values.length > 0) {
        yield this.values.shift();
        continue;
      }
      if (this.closed) return;
      const next = await new Promise((resolve3) => this.waiters.push(resolve3));
      if (next.done) return;
      yield next.value;
    }
  }
};

// src/server-api.ts
import { platform } from "node:os";

// src/config.ts
import { hostname } from "node:os";
import s from "@deepseek-ai/schemastery";
var DEFAULT_REMOTE_SERVER_URL = "https://dsh.r2049.cn";
var Config = s.object({
  enabled: s.boolean(),
  role: s.union(["host", "client", "both"]),
  serverUrl: s.string(),
  deviceName: s.string(),
  forceRelay: s.boolean(),
  logLevel: s.union(["debug", "info", "warn", "error"]),
  reconnect: s.union([
    s.boolean(),
    s.object({
      initialDelayMs: s.number(),
      maxDelayMs: s.number(),
      jitter: s.number()
    })
  ]),
  codex: s.object({
    enabled: s.boolean(),
    binary: s.string()
  })
});
var reconnectSchema = external_exports.union([
  external_exports.boolean(),
  external_exports.object({
    initialDelayMs: external_exports.number().int().min(100).max(6e4).optional(),
    maxDelayMs: external_exports.number().int().min(1e3).max(3e5).optional(),
    jitter: external_exports.number().min(0).max(1).optional()
  }).strict()
]);
var configSchema = external_exports.object({
  enabled: external_exports.boolean().optional(),
  role: external_exports.enum(["host", "client", "both"]).optional(),
  serverUrl: external_exports.string().url().optional(),
  deviceName: external_exports.string().trim().min(1).max(80).optional(),
  forceRelay: external_exports.boolean().optional(),
  logLevel: external_exports.enum(["debug", "info", "warn", "error"]).optional(),
  reconnect: reconnectSchema.optional(),
  codex: external_exports.object({
    enabled: external_exports.boolean().optional(),
    binary: external_exports.string().trim().min(1).max(4096).optional()
  }).strict().optional()
}).strict();
function resolveConfig(input2 = {}, env = process.env) {
  const parsed = configSchema.parse(input2);
  const reconnect = typeof parsed.reconnect === "object" ? parsed.reconnect : {};
  const configuredServerUrl = parsed.serverUrl ?? env.DSH_REMOTE_SERVER;
  const serverUrl = configuredServerUrl === void 0 ? void 0 : normalizeServerUrl(configuredServerUrl);
  const initialDelayMs = reconnect.initialDelayMs ?? 1e3;
  const maxDelayMs = reconnect.maxDelayMs ?? 3e4;
  if (maxDelayMs < initialDelayMs) {
    throw new TypeError("reconnect.maxDelayMs must be greater than or equal to reconnect.initialDelayMs");
  }
  return {
    enabled: parsed.enabled ?? true,
    role: parsed.role ?? "host",
    ...serverUrl === void 0 ? {} : { serverUrl },
    deviceName: parsed.deviceName ?? hostname(),
    forceRelay: parsed.forceRelay ?? false,
    logLevel: parsed.logLevel ?? "info",
    reconnect: {
      enabled: parsed.reconnect !== false,
      initialDelayMs,
      maxDelayMs,
      jitter: reconnect.jitter ?? 0.2
    },
    codex: {
      enabled: parsed.codex?.enabled ?? true,
      binary: parsed.codex?.binary ?? "codex"
    }
  };
}
function normalizeServerUrl(value) {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new TypeError("serverUrl must use HTTPS (HTTP is allowed only for localhost)");
  }
  if (url.username !== "" || url.password !== "") {
    throw new TypeError("serverUrl must not contain credentials");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new TypeError("serverUrl must not contain query parameters or fragments");
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new TypeError("serverUrl must be an origin without a path");
  }
  return url.origin;
}

// src/version.ts
var PLUGIN_VERSION = "0.4.12";

// src/server-api.ts
var TERMINAL_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
var HostServerApi = class {
  constructor(serverUrl, store, fetchImplementation = fetch, role = "host") {
    this.store = store;
    this.fetchImplementation = fetchImplementation;
    this.role = role;
    this.baseUrl = normalizeServerUrl(serverUrl);
  }
  baseUrl;
  identity;
  credentials;
  credentialsPromise;
  harnessVersion;
  bindIdentity(identity) {
    this.identity = identity;
  }
  setHarnessVersion(version) {
    this.harnessVersion = version;
  }
  currentAuthorization() {
    if (this.credentials === void 0) return void 0;
    return {
      method: this.credentials.authorizationMethod,
      ...this.credentials.account === void 0 ? {} : { account: this.credentials.account }
    };
  }
  async clearAuthorization() {
    this.credentials = void 0;
    this.credentialsPromise = void 0;
    await this.store.clear();
  }
  async revokeCurrentDevice() {
    const identity = this.requireIdentity();
    if (await this.store.load(this.baseUrl, identity.deviceId) === void 0) {
      await this.clearAuthorization();
      return;
    }
    try {
      await this.request("/api/v1/devices/self", { method: "DELETE" });
    } finally {
      await this.clearAuthorization();
    }
  }
  async authorizeWithAccount(identity, email, password) {
    this.bindIdentity(identity);
    const account = email.trim();
    if (account.length === 0 || password.length === 0) {
      throw new ServerApiError("INVALID_MESSAGE", "Email and password are required.", false);
    }
    const login2 = validateWebLogin(await this.publicRequest("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: account, password })
    }));
    await this.register(identity, {
      accountToken: login2.token,
      account: login2.account,
      authorizationMethod: "account"
    });
    return {
      method: "account",
      account: login2.account,
      expiresAt: login2.expiresAt,
      isAdmin: login2.isAdmin
    };
  }
  async startOAuthQrLogin(provider = "zhihu") {
    const value = requireRecord(await this.publicRequest(`/api/v1/auth/oauth/qr/start?provider=${provider}`, {
      method: "POST",
      body: "{}"
    }), "QR login");
    const scanUrl = normalizeOAuthScanUrl(value.scanUrl, this.baseUrl);
    if (typeof value.qrId !== "string" || value.qrId.length < 20 || scanUrl === void 0 || !Number.isSafeInteger(value.expiresIn) || provider === "github" && value.provider !== "github" || value.provider !== void 0 && value.provider !== provider) {
      throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid QR login session.", false);
    }
    return { qrId: value.qrId, scanUrl, expiresIn: value.expiresIn };
  }
  async pollOAuthQrLogin(identity, qrId, recoverIdentity) {
    this.bindIdentity(identity);
    const value = requireRecord(await this.publicRequest(
      `/api/v1/auth/oauth/qr/${encodeURIComponent(qrId)}`,
      { method: "GET" }
    ), "QR login status");
    if (value.status === "pending" || value.status === "expired") return { status: value.status };
    if (value.status !== "complete" || typeof value.token !== "string" || value.token.length < 16) {
      throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid QR login status.", false);
    }
    const account = requireRecord(await this.publicRequest(
      "/api/v1/auth/me",
      { method: "GET" },
      value.token
    ), "account profile");
    if (typeof account.account !== "string" || account.account.length === 0 || typeof account.isAdmin !== "boolean") {
      throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid account profile.", false);
    }
    const authorization = {
      accountToken: value.token,
      account: account.account,
      authorizationMethod: "account"
    };
    try {
      await this.register(identity, authorization);
    } catch (error) {
      if (!(error instanceof ServerApiError) || error.code !== "DEVICE_REVOKED" || recoverIdentity === void 0) throw error;
      const nextIdentity = await recoverIdentity();
      this.bindIdentity(nextIdentity);
      await this.register(nextIdentity, authorization);
    }
    return {
      status: "complete",
      authorization: { method: "account", account: account.account, isAdmin: account.isAdmin }
    };
  }
  async authorizeHostWithCode(identity, code) {
    if (this.role !== "host") {
      throw new ServerApiError("METHOD_NOT_ALLOWED", "Host registration codes can only authorize a Host device.", false);
    }
    const registrationCode = code.trim().toUpperCase();
    if (registrationCode.length === 0) {
      throw new ServerApiError("INVALID_MESSAGE", "A Host registration code is required.", false);
    }
    this.bindIdentity(identity);
    const tokens = await this.publicRequest("/api/v1/devices/register-with-code", {
      method: "POST",
      body: JSON.stringify({ v: 1, code: registrationCode, device: this.deviceDescriptor(identity) })
    });
    this.credentials = await this.saveTokens(identity, validateTokens(tokens), {
      authorizationMethod: "host_registration_code"
    });
    return { method: "host_registration_code" };
  }
  async authorizeOwnedRole(identity, authorizingAccessToken, account) {
    this.bindIdentity(identity);
    const tokens = await this.publicRequest("/api/v1/devices/register-owned-role", {
      method: "POST",
      body: JSON.stringify({ v: 1, device: this.deviceDescriptor(identity) })
    }, authorizingAccessToken);
    this.credentials = await this.saveTokens(identity, validateTokens(tokens), {
      authorizationMethod: "owned_device",
      ...account === void 0 ? {} : { account }
    });
    return {
      method: "owned_device",
      ...account === void 0 ? {} : { account }
    };
  }
  async authenticate(identity = this.requireIdentity()) {
    this.bindIdentity(identity);
    if (this.credentials !== void 0 && this.credentials.accessTokenExpiresAt > Date.now() + 3e4) {
      return this.credentials;
    }
    this.credentialsPromise ??= this.loadOrIssue(identity).finally(() => {
      this.credentialsPromise = void 0;
    });
    this.credentials = await this.credentialsPromise;
    return this.credentials;
  }
  async refreshCredentials() {
    const identity = this.requireIdentity();
    const stored = await this.store.load(this.baseUrl, identity.deviceId);
    if (stored === void 0 || stored.refreshTokenExpiresAt <= Date.now()) return this.register(identity);
    const tokens = await this.publicRequest("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ deviceId: identity.deviceId, refreshToken: stored.refreshToken })
    });
    this.credentials = await this.store.save({
      serverUrl: this.baseUrl,
      deviceId: identity.deviceId,
      authorizationMethod: stored.authorizationMethod,
      ...stored.account === void 0 ? {} : { account: stored.account },
      ...validateTokens(tokens)
    });
    return this.credentials;
  }
  async listDevices() {
    const result = await this.request("/api/v1/devices");
    if (!Array.isArray(result.items)) throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid device list.", false);
    return result.items.map(parseHostDevice);
  }
  async deviceFor(peerDeviceId) {
    const result = await this.request(`/api/v1/devices/${encodeURIComponent(peerDeviceId)}`);
    return parseAuthorizedPeer(result);
  }
  async turnCredentials(connectionId) {
    const result = await this.request(
      `/api/v1/turn/credentials?connection_id=${encodeURIComponent(connectionId)}`
    );
    if (!Array.isArray(result.iceServers)) return [];
    return result.iceServers.map(parseIceServer);
  }
  async presenceFor(deviceId) {
    const result = await this.request(`/api/v1/devices/${encodeURIComponent(deviceId)}/presence`);
    if (typeof result.online !== "boolean" || result.lastSeenAt !== null && result.lastSeenAt !== void 0 && !Number.isSafeInteger(result.lastSeenAt)) {
      throw new ServerApiError("INVALID_MESSAGE", "The Server returned invalid device presence.", false);
    }
    return { online: result.online, ...typeof result.lastSeenAt === "number" ? { lastSeenAt: result.lastSeenAt } : {} };
  }
  async loadOrIssue(identity) {
    const stored = await this.store.load(this.baseUrl, identity.deviceId);
    if (stored === void 0 || stored.refreshTokenExpiresAt <= Date.now() + 3e4) {
      return this.register(identity);
    }
    if (stored.accessTokenExpiresAt > Date.now() + 3e4) return stored;
    const tokens = await this.publicRequest("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ deviceId: identity.deviceId, refreshToken: stored.refreshToken })
    });
    return this.store.save({
      serverUrl: this.baseUrl,
      deviceId: identity.deviceId,
      authorizationMethod: stored.authorizationMethod,
      ...stored.account === void 0 ? {} : { account: stored.account },
      ...validateTokens(tokens)
    });
  }
  async register(identity, authorization) {
    const tokens = await this.publicRequest("/api/v1/devices/register", {
      method: "POST",
      body: JSON.stringify({
        v: 1,
        device: this.deviceDescriptor(identity)
      })
    }, authorization?.accountToken);
    this.credentials = await this.saveTokens(identity, validateTokens(tokens), {
      authorizationMethod: authorization?.authorizationMethod ?? "account",
      ...authorization?.account === void 0 ? {} : { account: authorization.account }
    });
    return this.credentials;
  }
  deviceDescriptor(identity) {
    return {
      deviceId: identity.deviceId,
      name: identity.name,
      role: this.role,
      platform: platform(),
      identityKey: identity.publicKey,
      clientVersion: PLUGIN_VERSION,
      ...this.role === "host" && this.harnessVersion !== void 0 ? { harnessVersion: this.harnessVersion } : {}
    };
  }
  saveTokens(identity, tokens, authorization) {
    return this.store.save({
      serverUrl: this.baseUrl,
      deviceId: identity.deviceId,
      authorizationMethod: authorization.authorizationMethod,
      ...authorization.account === void 0 ? {} : { account: authorization.account },
      ...tokens
    });
  }
  async request(path, init = {}) {
    const credentials = await this.authenticate();
    return this.publicRequest(path, init, credentials.accessToken);
  }
  async publicRequest(path, init, accessToken) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1e4);
    let response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...accessToken === void 0 ? {} : { Authorization: `Bearer ${accessToken}` },
          ...init.headers
        }
      });
    } catch (error) {
      throw new ServerApiError("CONNECTION_FAILED", error instanceof Error ? error.message : "Server request failed.", true);
    } finally {
      clearTimeout(timer);
    }
    const body = await parseBody(response);
    if (!response.ok) {
      const envelope = body ?? {};
      throw new ServerApiError(
        typeof envelope.error?.code === "string" ? envelope.error.code : mapStatus(response.status),
        typeof envelope.error?.message === "string" ? envelope.error.message : "The Server rejected the request.",
        envelope.error?.retryable === true || response.status >= 500,
        response.status
      );
    }
    return body;
  }
  requireIdentity() {
    if (this.identity === void 0) throw new ServerApiError("IDENTITY_INVALID", "The device identity is not loaded.", false);
    return this.identity;
  }
};
function normalizeOAuthScanUrl(value, baseUrl) {
  if (typeof value !== "string" || TERMINAL_CONTROL_CHARACTERS.test(value)) return void 0;
  try {
    const normalized = new URL(value).href;
    return normalized.startsWith(`${baseUrl}/`) ? normalized : void 0;
  } catch {
    return void 0;
  }
}
var ClientServerApi = class extends HostServerApi {
  constructor(serverUrl, store, fetchImplementation = fetch) {
    super(serverUrl, store, fetchImplementation, "client");
  }
};
var ServerApiError = class extends Error {
  constructor(code, message, retryable, status2) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.status = status2;
  }
};
function validateTokens(value) {
  const parsed = deviceTokenPairSchema.safeParse(value);
  if (!parsed.success) {
    throw new ServerApiError("INVALID_MESSAGE", "The Server returned invalid device credentials.", false);
  }
  return parsed.data;
}
function validateWebLogin(value) {
  const item = requireRecord(value, "account login");
  if (typeof item.token !== "string" || item.token.length < 16 || !Number.isSafeInteger(item.expiresAt) || typeof item.account !== "string" || item.account.length === 0 || item.account.length > 254 || typeof item.isAdmin !== "boolean") {
    throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid account session.", false);
  }
  return {
    token: item.token,
    expiresAt: item.expiresAt,
    account: item.account,
    profile: item.profile,
    isAdmin: item.isAdmin
  };
}
async function parseBody(response) {
  const text = await response.text();
  if (text.length === 0) return void 0;
  try {
    return JSON.parse(text);
  } catch {
    throw new ServerApiError("INVALID_MESSAGE", "The Server returned invalid JSON.", false, response.status);
  }
}
function mapStatus(status2) {
  if (status2 === 401) return "AUTH_INVALID";
  if (status2 === 403) return "AUTH_REQUIRED";
  if (status2 === 404) return "DEVICE_NOT_FOUND";
  if (status2 === 429) return "RATE_LIMITED";
  return status2 >= 500 ? "CONNECTION_FAILED" : "INVALID_MESSAGE";
}
function parseHostDevice(value) {
  const item = requireRecord(value, "host device");
  if (item.role !== "host" || typeof item.deviceId !== "string" || typeof item.name !== "string" || typeof item.platform !== "string" || typeof item.membershipId !== "string" || item.membershipId.length === 0) {
    throw new ServerApiError("INVALID_MESSAGE", "The Server returned invalid host device data.", false);
  }
  return {
    deviceId: item.deviceId,
    name: item.name,
    platform: item.platform,
    membershipId: item.membershipId,
    ...typeof item.online === "boolean" ? { online: item.online } : {},
    ...typeof item.lastSeenAt === "number" && Number.isSafeInteger(item.lastSeenAt) ? { lastSeenAt: item.lastSeenAt } : {},
    ...typeof item.clientVersion === "string" ? { clientVersion: item.clientVersion } : {},
    ...typeof item.harnessVersion === "string" ? { harnessVersion: item.harnessVersion } : {}
  };
}
function parseAuthorizedPeer(value) {
  const item = requireRecord(value, "authorized peer");
  if (item.role !== "host" && item.role !== "client" || typeof item.deviceId !== "string" || item.deviceId.length === 0 || typeof item.name !== "string" || item.name.length === 0 || typeof item.platform !== "string" || item.platform.length === 0 || typeof item.identityKey !== "string" || !isIdentityKey(item.identityKey) || typeof item.membershipId !== "string" || item.membershipId.length === 0) {
    throw new ServerApiError("INVALID_MESSAGE", "The Server returned invalid authorized peer data.", false);
  }
  return {
    deviceId: item.deviceId,
    name: item.name,
    role: item.role,
    platform: item.platform,
    identityKey: item.identityKey,
    membershipId: item.membershipId,
    ...typeof item.online === "boolean" ? { online: item.online } : {},
    ...typeof item.lastSeenAt === "number" && Number.isSafeInteger(item.lastSeenAt) ? { lastSeenAt: item.lastSeenAt } : {}
  };
}
function parseIceServer(value) {
  const item = requireRecord(value, "ICE server");
  const urls = item.urls;
  if (typeof urls !== "string" && !(Array.isArray(urls) && urls.every((url) => typeof url === "string"))) {
    throw new ServerApiError("INVALID_MESSAGE", "The Server returned an invalid ICE server.", false);
  }
  return {
    urls,
    ...typeof item.username === "string" ? { username: item.username } : {},
    ...typeof item.credential === "string" ? { credential: item.credential } : {}
  };
}
function isIdentityKey(value) {
  try {
    const decoded = fromBase64Url2(value);
    return decoded.length === 32 && toBase64Url2(decoded) === value;
  } catch {
    return false;
  }
}
function requireRecord(value, name2) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ServerApiError("INVALID_MESSAGE", `The Server returned invalid ${name2} data.`, false);
  }
  return value;
}

// src/typert-gateway-switch.ts
var REMOTE_COMMAND_METHODS = ["execute", "list"];
var LOCAL_ONLY_NAMESPACES = /* @__PURE__ */ new Set(["dynamicCordisRunner"]);
var ALL_REMOTE_COMMANDS = { execute: true, list: true };
var TypertGatewaySwitch = class {
  runtime;
  originalInvoke;
  localInvoke;
  originalStream;
  localStream;
  originalDispatch;
  localDispatch;
  originalOpen;
  localOpen;
  remoteInvoke;
  remoteTarget;
  remoteSupport = { execute: false, list: false };
  target;
  installed = false;
  constructor(gateway) {
    this.runtime = gateway;
    this.originalInvoke = gateway.invoke;
    this.localInvoke = this.originalInvoke.bind(gateway);
    this.originalStream = gateway.stream;
    this.localStream = gateway.stream?.bind(gateway);
    this.originalDispatch = this.runtime.dispatchRpc;
    this.localDispatch = this.runtime.dispatchRpc?.bind(gateway);
    this.originalOpen = this.runtime.openWireStream;
    this.localOpen = this.runtime.openWireStream?.bind(gateway) ?? gateway.wireStream?.open.bind(gateway.wireStream);
  }
  /** Original local dispatcher, used by the Host bridge without switch recursion. */
  local() {
    const dispatch = this.localDispatch ?? (async (endpoint, payload, signal) => {
      try {
        const request = requestFromCarrier(endpoint, payload, signal);
        return { ok: true, value: await this.localInvoke(request) };
      } catch (error) {
        return { ok: false, error: this.failure(error) };
      }
    });
    const open = this.localOpen ?? (async (endpoint, payload, signal) => {
      if (this.localStream === void 0) throw new Error("The local Harness Gateway does not support Remote streams.");
      return this.localStream(requestFromCarrier(endpoint, payload, signal));
    });
    return {
      invoke: this.localInvoke,
      ...this.localStream === void 0 ? {} : { stream: this.localStream },
      dispatch,
      open,
      failure: (error) => this.failure(error),
      supportsCarrier: this.localDispatch !== void 0 && this.localOpen !== void 0
    };
  }
  supportsCarrier() {
    return this.localDispatch !== void 0 && this.localOpen !== void 0;
  }
  status() {
    return this.remoteInvoke === void 0 ? { mode: "local" } : { mode: "remote", ...this.target === void 0 ? {} : { target: { ...this.target } } };
  }
  install() {
    if (this.installed) return;
    this.runtime.invoke = (request) => this.selectInvoke(request);
    if (this.originalStream !== void 0) {
      this.runtime.stream = (request) => this.remoteTarget === void 0 || isLocalOnlyEndpoint(endpointOf(request)) ? this.localStream(request) : this.remoteTarget.open(endpointOf(request), { args: request.args }, request.signal ?? new AbortController().signal);
    }
    if (this.originalDispatch !== void 0) {
      this.runtime.dispatchRpc = (endpoint, payload, signal) => this.remoteTarget === void 0 || isLocalOnlyEndpoint(endpoint) ? this.localDispatch(endpoint, payload, signal) : this.remoteTarget.dispatch(endpoint, payload, signal);
    }
    if (this.originalOpen !== void 0) {
      this.runtime.openWireStream = (endpoint, payload, signal) => this.remoteTarget === void 0 || isLocalOnlyEndpoint(endpoint) ? this.localOpen(endpoint, payload, signal) : this.remoteTarget.open(endpoint, payload, signal);
    }
    this.installed = true;
  }
  selectRemote(remote, support = ALL_REMOTE_COMMANDS, target) {
    if (!this.installed) throw new Error("The Typert gateway switch is not installed.");
    this.remoteInvoke = typeof remote === "function" ? remote : (request) => remote.invoke(request);
    this.remoteTarget = typeof remote === "function" ? void 0 : remote;
    this.remoteSupport = { ...support };
    this.target = target === void 0 ? void 0 : { ...target };
  }
  selectLocal() {
    this.remoteInvoke = void 0;
    this.remoteTarget = void 0;
    this.remoteSupport = { execute: false, list: false };
    this.target = void 0;
  }
  restore() {
    if (!this.installed) return;
    this.selectLocal();
    this.runtime.invoke = this.originalInvoke;
    if (this.originalStream !== void 0) this.runtime.stream = this.originalStream;
    if (this.originalDispatch !== void 0) this.runtime.dispatchRpc = this.originalDispatch;
    if (this.originalOpen !== void 0) this.runtime.openWireStream = this.originalOpen;
    this.installed = false;
  }
  selectInvoke(request) {
    if (isLocalOnlyEndpoint(endpointOf(request))) return this.localInvoke(request);
    if (this.remoteTarget !== void 0) return this.remoteTarget.invoke(request);
    if (request.namespace !== "commands" || !isRemoteCommandMethod(request.method) || this.remoteInvoke === void 0) {
      return this.localInvoke(request);
    }
    if (this.remoteSupport[request.method]) return this.remoteInvoke(request);
    if (request.method === "list") return Promise.resolve([]);
    return this.localInvoke(request);
  }
  failure(error) {
    const normalized = this.runtime.wireStream?.failure(error);
    if (normalized !== void 0) return normalized;
    const source = error instanceof Error ? error : new Error("The Harness Gateway rejected the request.");
    const code = "code" in source && typeof source.code === "string" ? source.code : "internal";
    const details = "details" in source && isRecord5(source.details) ? source.details : {};
    return { code, message: source.message, details };
  }
};
function requestFromCarrier(endpoint, payload, signal) {
  const segments = endpoint.split("/");
  if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) {
    throw new Error("The Harness Gateway endpoint is invalid.");
  }
  if (!isRecord5(payload) || !isRecord5(payload.args)) {
    throw new Error("The Harness Gateway payload is invalid.");
  }
  return { namespace: segments[0], method: segments[1], args: payload.args, signal };
}
function endpointOf(request) {
  return `${request.namespace}/${request.method}`;
}
function isLocalOnlyEndpoint(endpoint) {
  const separator = endpoint.indexOf("/");
  return separator > 0 && LOCAL_ONLY_NAMESPACES.has(endpoint.slice(0, separator));
}
function isRemoteCommandMethod(method) {
  return REMOTE_COMMAND_METHODS.includes(method);
}
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/werift-rtc.ts
import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";

// src/native-rtc-helper.ts
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname as dirname2, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
var cachedExternalFactory;
var cachedExternalFactoryResolved = false;
var cachedNodeBinary;
var cachedNodeBinaryResolved = false;
async function loadExternalNativeRtcFactory() {
  if (cachedExternalFactory !== void 0) return cachedExternalFactory;
  if (cachedExternalFactoryResolved) return void 0;
  cachedExternalFactoryResolved = true;
  const nodeBinary = resolveExternalNodeBinaryForRtc();
  if (nodeBinary === void 0) return void 0;
  cachedExternalFactory = buildExternalNativeRtcFactory(nodeBinary);
  return cachedExternalFactory;
}
function buildExternalNativeRtcFactory(nodeBinary, requireFrom = resolveNativeRtcRequireFrom()) {
  return {
    create(configuration) {
      return new ExternalNativePeerConnection(nodeBinary, requireFrom, configuration);
    }
  };
}
function resolveNativeRtcRequireFrom(moduleUrl = import.meta.url) {
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync(modulePath);
  } catch {
    return modulePath;
  }
}
function resolveExternalNodeBinaryForRtc() {
  if (cachedNodeBinaryResolved) return cachedNodeBinary;
  cachedNodeBinaryResolved = true;
  const requireFrom = resolveNativeRtcRequireFrom();
  for (const candidate of nodeBinaryCandidates()) {
    if (isUsableExternalNode(candidate, requireFrom)) {
      cachedNodeBinary = candidate;
      return candidate;
    }
  }
  return void 0;
}
function nodeBinaryCandidates() {
  const candidates = [];
  const add3 = (value) => {
    if (value === void 0 || value.trim() === "") return;
    if (!candidates.includes(value)) candidates.push(value);
  };
  add3(process.env.DSH_REMOTE_NODE);
  add3(process.env.NODE);
  add3(process.execPath);
  for (const part of (process.env.PATH ?? "").split(delimiter)) add3(join2(part, process.platform === "win32" ? "node.exe" : "node"));
  add3("/opt/homebrew/bin/node");
  add3("/usr/local/bin/node");
  add3("/usr/bin/node");
  add3(join2(process.env.HOME ?? "", ".volta", "bin", process.platform === "win32" ? "node.exe" : "node"));
  add3(join2(process.env.HOME ?? "", ".asdf", "shims", process.platform === "win32" ? "node.exe" : "node"));
  add3(join2(process.env.HOME ?? "", ".local", "bin", process.platform === "win32" ? "node.exe" : "node"));
  for (const nvmNode of nvmNodeCandidates()) add3(nvmNode);
  return candidates;
}
function nvmNodeCandidates() {
  const root = join2(process.env.HOME ?? "", ".nvm", "versions", "node");
  if (root === "" || !existsSync(root)) return [];
  try {
    return readdirSync(root).map((version) => join2(root, version, "bin", process.platform === "win32" ? "node.exe" : "node")).sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
  } catch {
    return [];
  }
}
function isUsableExternalNode(candidate, requireFrom) {
  if (!isExecutableFile(candidate)) return false;
  const env = { ...process.env, DSH_REMOTE_RTC_HELPER_REQUIRE_FROM: requireFrom };
  delete env.ELECTRON_RUN_AS_NODE;
  const probe = spawnSync(candidate, [
    "--input-type=module",
    "--eval",
    [
      "import { createRequire } from 'node:module';",
      "const require = createRequire(process.env.DSH_REMOTE_RTC_HELPER_REQUIRE_FROM);",
      "if (process.versions.electron) throw new Error('electron-node');",
      "const wrtc = require('@roamhq/wrtc');",
      "const RTCPeerConnection = wrtc.RTCPeerConnection ?? wrtc.default?.RTCPeerConnection;",
      "if (typeof RTCPeerConnection !== 'function') throw new Error('missing-rtc');",
      "console.log(`node:${process.versions.node}`);"
    ].join("")
  ], {
    cwd: dirname2(requireFrom),
    env,
    encoding: "utf8",
    timeout: 3e3
  });
  return probe.status === 0 && probe.stdout.startsWith("node:");
}
function isExecutableFile(candidate) {
  try {
    const stat6 = statSync(candidate);
    if (!stat6.isFile()) return false;
    if (process.platform === "win32") return true;
    return (stat6.mode & 73) !== 0;
  } catch {
    return false;
  }
}
var ExternalNativePeerConnection = class {
  constructor(nodeBinary, requireFrom, configuration) {
    this.nodeBinary = nodeBinary;
    this.requireFrom = requireFrom;
    this.child = spawn(this.nodeBinary, ["--input-type=module", "--eval", HELPER_SOURCE], {
      cwd: dirname2(this.requireFrom),
      env: { ...process.env, DSH_REMOTE_RTC_HELPER_REQUIRE_FROM: this.requireFrom },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.handleStdout(String(chunk)));
    this.child.stderr.on("data", () => void 0);
    this.child.on("exit", () => this.handleExit());
    this.child.on("error", (error) => this.handleExit(error));
    this.child.stdin.on("error", (error) => this.handleExit(error));
    this.ready = this.request("init", { iceServers: configuration.iceServers ?? [] }).then(() => void 0);
  }
  connectionState = "new";
  iceConnectionState = "new";
  iceGatheringState = "new";
  signalingState = "stable";
  onconnectionstatechange = null;
  oniceconnectionstatechange = null;
  onicegatheringstatechange = null;
  onicecandidate = null;
  ondatachannel = null;
  child;
  pending = /* @__PURE__ */ new Map();
  channels = /* @__PURE__ */ new Map();
  nextRequestId = 1;
  nextChannelId = 1;
  stdout = "";
  closed = false;
  ready;
  createDataChannel(label, options) {
    const channelId = this.nextChannelId++;
    const channel = new ExternalNativeDataChannel(this, channelId, label, options?.ordered ?? true);
    this.channels.set(channelId, channel);
    this.notify("createDataChannel", { channelId, label, options: { ordered: options?.ordered ?? true } });
    return channel;
  }
  async createOffer() {
    await this.ready;
    return this.request("createOffer", {});
  }
  async createAnswer() {
    await this.ready;
    return this.request("createAnswer", {});
  }
  async setLocalDescription(description) {
    await this.ready;
    await this.request("setLocalDescription", { description });
  }
  async setRemoteDescription(description) {
    await this.ready;
    await this.request("setRemoteDescription", { description });
  }
  async addIceCandidate(candidate) {
    await this.ready;
    await this.request("addIceCandidate", { candidate: candidate ?? null });
  }
  async getStats() {
    await this.ready;
    return this.request("getStats", {});
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.notify("close", {});
    const timer = setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
    }, 1e3);
    timer.unref?.();
  }
  sendChannelData(channelId, data) {
    const payload = typeof data === "string" ? { channelId, text: data } : { channelId, base64: Buffer.from(data).toString("base64") };
    this.notify("channelSend", payload);
  }
  closeChannel(channelId) {
    this.notify("channelClose", { channelId });
  }
  request(method, payload) {
    if (this.closed) return Promise.reject(new Error("native rtc helper is closed"));
    const id2 = this.nextRequestId++;
    const promise = new Promise((resolve3, reject) => {
      this.pending.set(id2, { resolve: resolve3, reject });
    });
    this.write({ id: id2, method, payload });
    return promise;
  }
  notify(method, payload) {
    if (this.closed && method !== "close") return;
    this.write({ method, payload });
  }
  write(message) {
    try {
      this.child.stdin.write(`${JSON.stringify(message)}
`);
    } catch {
      this.handleExit(new Error("native rtc helper stdin is closed"));
    }
  }
  handleStdout(chunk) {
    this.stdout += chunk;
    for (; ; ) {
      const newline = this.stdout.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdout.slice(0, newline);
      this.stdout = this.stdout.slice(newline + 1);
      if (line.trim() === "") continue;
      try {
        this.handleMessage(JSON.parse(line));
      } catch {
        this.handleExit(new Error("native rtc helper sent invalid JSON"));
      }
    }
  }
  handleMessage(message) {
    if ("id" in message) {
      const pending = this.pending.get(message.id);
      if (pending === void 0) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(new Error(message.error ?? "native rtc helper command failed"));
      return;
    }
    if (message.event === "state") {
      this.connectionState = message.connectionState;
      this.iceConnectionState = message.iceConnectionState;
      this.iceGatheringState = message.iceGatheringState;
      this.signalingState = message.signalingState;
      this.onconnectionstatechange?.();
      this.oniceconnectionstatechange?.();
      this.onicegatheringstatechange?.();
      return;
    }
    if (message.event === "icecandidate") {
      this.onicecandidate?.({ candidate: message.candidate });
      return;
    }
    if (message.event === "datachannel") {
      const channel = this.channelFor(message.channelId, message.label, message.ordered);
      this.ondatachannel?.({ channel });
      channel.updateState(message.readyState, message.bufferedAmount);
      return;
    }
    if (message.event === "channel-state") {
      this.channels.get(message.channelId)?.updateState(message.readyState, message.bufferedAmount);
      return;
    }
    if (message.event === "channel-message") {
      const channel = this.channels.get(message.channelId);
      if (channel === void 0) return;
      if (message.text !== void 0) channel.emitMessage(message.text);
      else if (message.base64 !== void 0) channel.emitMessage(bufferToArrayBuffer(Buffer.from(message.base64, "base64")));
      return;
    }
    if (message.event === "channel-error") {
      this.channels.get(message.channelId)?.emitError();
    }
  }
  channelFor(channelId, label, ordered) {
    const existing = this.channels.get(channelId);
    if (existing !== void 0) return existing;
    const channel = new ExternalNativeDataChannel(this, channelId, label, ordered);
    this.channels.set(channelId, channel);
    return channel;
  }
  handleExit(error) {
    if (!this.closed) this.closed = true;
    const reason = error ?? new Error("native rtc helper exited");
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
    for (const channel of this.channels.values()) channel.updateState("closed", 0);
  }
};
var ExternalNativeDataChannel = class {
  constructor(owner, channelId, label, ordered) {
    this.owner = owner;
    this.channelId = channelId;
    this.label = label;
    this.ordered = ordered;
  }
  readyState = "connecting";
  bufferedAmount = 0;
  binaryType = "arraybuffer";
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  onbufferedamountlow = null;
  send(data) {
    this.owner.sendChannelData(this.channelId, data);
  }
  close() {
    this.owner.closeChannel(this.channelId);
  }
  updateState(readyState, bufferedAmount) {
    const previous = this.readyState;
    this.readyState = readyState;
    this.bufferedAmount = bufferedAmount;
    if (previous !== "open" && readyState === "open") this.onopen?.();
    if (previous !== "closed" && readyState === "closed") this.onclose?.();
    if (bufferedAmount === 0) this.onbufferedamountlow?.();
  }
  emitMessage(data) {
    this.onmessage?.({ data });
  }
  emitError() {
    this.onerror?.();
  }
};
function bufferToArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
var HELPER_SOURCE = String.raw`
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'

const require = createRequire(process.env.DSH_REMOTE_RTC_HELPER_REQUIRE_FROM || (process.cwd() + '/package.json'))
const wrtc = require('@roamhq/wrtc')
const RTCPeerConnection = wrtc.RTCPeerConnection ?? wrtc.default?.RTCPeerConnection
if (typeof RTCPeerConnection !== 'function') throw new Error('missing RTCPeerConnection')

let pc
let nextRemoteChannelId = 100000
const channels = new Map()
let chain = Promise.resolve()

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function respond(id, ok, value, error) {
  if (id === undefined) return
  send(ok ? { id, ok: true, value } : { id, ok: false, error: String(error?.message ?? error ?? 'command failed') })
}

function state() {
  return {
    event: 'state',
    connectionState: pc?.connectionState ?? 'closed',
    iceConnectionState: pc?.iceConnectionState ?? 'closed',
    iceGatheringState: pc?.iceGatheringState ?? 'complete',
    signalingState: pc?.signalingState ?? 'closed',
  }
}

function emitState() {
  send(state())
}

function normalizeHelperSdpMLineIndex(value) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
  return value
}

function normalizeCandidate(candidate) {
  if (candidate === null || candidate === undefined) return null
  const json = typeof candidate.toJSON === 'function'
    ? candidate.toJSON()
    : {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment,
      }
  return {
    ...json,
    sdpMLineIndex: normalizeHelperSdpMLineIndex(json.sdpMLineIndex),
  }
}

function attachChannel(channelId, channel) {
  channels.set(channelId, channel)
  try { channel.binaryType = 'arraybuffer' } catch {}
  const emitChannel = () => send({
    event: 'channel-state',
    channelId,
    readyState: channel.readyState,
    bufferedAmount: channel.bufferedAmount ?? 0,
  })
  channel.onopen = emitChannel
  channel.onclose = emitChannel
  channel.onerror = () => send({ event: 'channel-error', channelId })
  channel.onmessage = event => {
    const data = event.data
    if (typeof data === 'string') {
      send({ event: 'channel-message', channelId, text: data })
      return
    }
    send({ event: 'channel-message', channelId, base64: Buffer.from(data).toString('base64') })
  }
  send({
    event: 'datachannel',
    channelId,
    label: channel.label,
    ordered: channel.ordered,
    readyState: channel.readyState,
    bufferedAmount: channel.bufferedAmount ?? 0,
  })
}

function serializeStats(stats) {
  const entries = []
  const push = (key, value) => {
    const copy = {}
    for (const [entryKey, entryValue] of Object.entries(value ?? {})) {
      if (typeof entryValue !== 'function') copy[entryKey] = entryValue
    }
    entries.push([String(key), copy])
  }
  if (typeof stats?.forEach === 'function') stats.forEach((value, key) => push(key, value))
  else for (const [key, value] of stats ?? []) push(key, value)
  return entries
}

async function handle(command) {
  const { id, method, payload = {} } = command
  try {
    if (method === 'init') {
      pc = new RTCPeerConnection({ iceServers: payload.iceServers ?? [] })
      pc.onconnectionstatechange = emitState
      pc.oniceconnectionstatechange = emitState
      pc.onicegatheringstatechange = emitState
      pc.onsignalingstatechange = emitState
      pc.onicecandidate = event => send({ event: 'icecandidate', candidate: normalizeCandidate(event.candidate) })
      pc.ondatachannel = event => attachChannel(nextRemoteChannelId++, event.channel)
      emitState()
      respond(id, true, {})
      return
    }
    if (method === 'createDataChannel') {
      const channel = pc.createDataChannel(payload.label, payload.options)
      attachChannel(payload.channelId, channel)
      respond(id, true, {})
      return
    }
    if (method === 'createOffer') {
      respond(id, true, await pc.createOffer())
      return
    }
    if (method === 'createAnswer') {
      respond(id, true, await pc.createAnswer())
      return
    }
    if (method === 'setLocalDescription') {
      await pc.setLocalDescription(payload.description)
      emitState()
      respond(id, true, {})
      return
    }
    if (method === 'setRemoteDescription') {
      await pc.setRemoteDescription(payload.description)
      emitState()
      respond(id, true, {})
      return
    }
    if (method === 'addIceCandidate') {
      await pc.addIceCandidate(payload.candidate)
      respond(id, true, {})
      return
    }
    if (method === 'getStats') {
      respond(id, true, serializeStats(await pc.getStats()))
      return
    }
    if (method === 'channelSend') {
      const channel = channels.get(payload.channelId)
      if (channel === undefined) throw new Error('unknown data channel')
      channel.send(payload.text ?? Buffer.from(payload.base64, 'base64'))
      respond(id, true, {})
      return
    }
    if (method === 'channelClose') {
      channels.get(payload.channelId)?.close()
      respond(id, true, {})
      return
    }
    if (method === 'close') {
      for (const channel of channels.values()) {
        try { channel.close() } catch {}
      }
      channels.clear()
      try { pc?.close() } catch {}
      respond(id, true, {})
      setTimeout(() => process.exit(0), 0)
      return
    }
    throw new Error('unknown method ' + method)
  } catch (error) {
    respond(id, false, undefined, error)
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', line => {
  chain = chain.then(() => handle(JSON.parse(line))).catch(error => {
    send({ id: -1, ok: false, error: String(error?.message ?? error) })
  })
})
process.stdin.on('end', () => {
  try { pc?.close() } catch {}
  process.exit(0)
})
`;

// src/werift-rtc.ts
var cachedFactory;
var cachedWerift;
var cachedNativeFactory;
async function loadNodeRtcFactory(options = {}) {
  const nativeFactory = isElectronRuntime() ? await loadExternalNativeRtcFactory().catch(() => void 0) : await loadNativeRtcFactory().catch(() => void 0);
  return nativeFactory ?? await loadWeriftFactory(options);
}
async function loadWeriftFactory(options = {}) {
  const cacheable = isCacheableFactoryOptions(options);
  if (cacheable && cachedFactory !== void 0) return cachedFactory;
  try {
    const werift = cachedWerift ?? await import("werift");
    cachedWerift = werift;
    const routeCandidates = options.preferredHostIpv4Candidates ?? await detectRouteHostIpv4Candidates(options.routeTargets ?? [], options.routeProbeTimeoutMs);
    const factory = buildWeriftFactory(werift, { ...options, preferredHostIpv4Candidates: routeCandidates });
    if (cacheable) cachedFactory = factory;
    return factory;
  } catch {
    return void 0;
  }
}
async function loadNativeRtcFactory() {
  if (cachedNativeFactory !== void 0) return cachedNativeFactory;
  try {
    const wrtc = await import("@roamhq/wrtc");
    const RTCPeerConnection2 = wrtc.RTCPeerConnection ?? wrtc.default?.RTCPeerConnection;
    if (RTCPeerConnection2 === void 0) return void 0;
    cachedNativeFactory = buildNativeRtcFactory(RTCPeerConnection2);
    return cachedNativeFactory;
  } catch {
    return void 0;
  }
}
function isElectronRuntime() {
  const versions = process.versions;
  return typeof versions.electron === "string" || process.env.ELECTRON_RUN_AS_NODE === "1";
}
function buildNativeRtcFactory(RTCPeerConnection2) {
  return {
    create(configuration) {
      const raw = new RTCPeerConnection2({ iceServers: configuration.iceServers });
      return {
        get connectionState() {
          return raw.connectionState;
        },
        get iceConnectionState() {
          return raw.iceConnectionState;
        },
        get iceGatheringState() {
          return raw.iceGatheringState;
        },
        get signalingState() {
          return raw.signalingState;
        },
        set onconnectionstatechange(value) {
          raw.onconnectionstatechange = value;
        },
        get onconnectionstatechange() {
          return raw.onconnectionstatechange;
        },
        set oniceconnectionstatechange(value) {
          raw.oniceconnectionstatechange = value;
        },
        get oniceconnectionstatechange() {
          return raw.oniceconnectionstatechange;
        },
        set onicegatheringstatechange(value) {
          raw.onicegatheringstatechange = value;
        },
        get onicegatheringstatechange() {
          return raw.onicegatheringstatechange;
        },
        set onicecandidate(value) {
          raw.onicecandidate = value === null ? null : (event) => value({
            candidate: event.candidate === null ? null : normalizeNativeCandidate(event.candidate)
          });
        },
        get onicecandidate() {
          return raw.onicecandidate;
        },
        set ondatachannel(value) {
          raw.ondatachannel = value === null ? null : (event) => value({ channel: adaptNativeDataChannel(event.channel) });
        },
        get ondatachannel() {
          return raw.ondatachannel;
        },
        createDataChannel(label, options) {
          return adaptNativeDataChannel(raw.createDataChannel(label, options));
        },
        createOffer() {
          return raw.createOffer();
        },
        createAnswer() {
          return raw.createAnswer();
        },
        setLocalDescription(description) {
          return raw.setLocalDescription(description);
        },
        setRemoteDescription(description) {
          return raw.setRemoteDescription(description);
        },
        addIceCandidate(candidate) {
          return raw.addIceCandidate(candidate);
        },
        getStats() {
          return raw.getStats();
        },
        close() {
          raw.close();
        }
      };
    }
  };
}
function buildWeriftFactory(werift, options = {}) {
  return {
    create(configuration) {
      const hostIpv4Candidates = detectHostIpv4Candidates(
        options.interfaces ?? networkInterfaces(),
        options.preferredHostIpv4Candidates
      );
      const allowedHostIpv4 = new Set(hostIpv4Candidates);
      const raw = new werift.RTCPeerConnection({
        iceServers: orderIceServersForWerift(configuration.iceServers ?? []),
        iceUseIpv4: true,
        iceUseIpv6: false,
        iceUseLinkLocalAddress: false,
        ...hostIpv4Candidates.length === 0 ? {} : {
          iceAdditionalHostAddresses: hostIpv4Candidates,
          iceFilterCandidatePair: (pair) => {
            const allowed = shouldUseCandidatePair(pair, allowedHostIpv4);
            if (!allowed) {
              configuration.onDiagnostic?.({
                type: "candidate-pair-filtered",
                localCandidate: summarizeWeriftCandidate(localCandidate(pair)),
                reason: "local-host-not-allowed"
              });
            }
            return allowed;
          }
        }
      });
      let onIceCandidate = null;
      let onDataChannel = null;
      raw.onicecandidate = (event) => {
        if (onIceCandidate === null) return;
        const candidate = event.candidate === void 0 ? null : event.candidate.toJSON();
        if (candidate !== null && !shouldAdvertiseCandidate(candidate, allowedHostIpv4)) {
          configuration.onDiagnostic?.({
            type: "local-candidate-filtered",
            candidate: summarizeIceCandidate(candidate),
            reason: "local-host-not-allowed"
          });
          return;
        }
        onIceCandidate({ candidate });
      };
      raw.ondatachannel = (event) => {
        if (onDataChannel === null) return;
        onDataChannel({ channel: adaptDataChannel2(event.channel) });
      };
      const pc = {
        get connectionState() {
          return raw.connectionState;
        },
        get iceConnectionState() {
          return raw.iceConnectionState;
        },
        get iceGatheringState() {
          return raw.iceGatheringState;
        },
        get signalingState() {
          return raw.signalingState;
        },
        set onconnectionstatechange(value) {
          raw.onconnectionstatechange = value;
        },
        get onconnectionstatechange() {
          return raw.onconnectionstatechange;
        },
        set oniceconnectionstatechange(value) {
          raw.oniceconnectionstatechange = value;
        },
        get oniceconnectionstatechange() {
          return raw.oniceconnectionstatechange;
        },
        set onicegatheringstatechange(value) {
          raw.onicegatheringstatechange = value;
        },
        get onicegatheringstatechange() {
          return raw.onicegatheringstatechange;
        },
        set onicecandidate(value) {
          onIceCandidate = value;
        },
        get onicecandidate() {
          return onIceCandidate;
        },
        set ondatachannel(value) {
          onDataChannel = value;
        },
        get ondatachannel() {
          return onDataChannel;
        },
        createDataChannel(label, options2) {
          return adaptDataChannel2(raw.createDataChannel(label, { ordered: options2?.ordered ?? true }));
        },
        createOffer() {
          return raw.createOffer();
        },
        createAnswer() {
          return raw.createAnswer();
        },
        setLocalDescription(description) {
          return raw.setLocalDescription(description).then(() => void 0);
        },
        setRemoteDescription(description) {
          return raw.setRemoteDescription(description);
        },
        addIceCandidate(candidate) {
          return raw.addIceCandidate(candidate);
        },
        getStats() {
          return raw.getStats();
        },
        close() {
          void raw.close().catch(() => void 0);
        }
      };
      return pc;
    }
  };
}
function adaptDataChannel2(raw) {
  return {
    get label() {
      return raw.label;
    },
    get ordered() {
      return raw.ordered;
    },
    get readyState() {
      return raw.readyState;
    },
    get bufferedAmount() {
      return raw.bufferedAmount;
    },
    binaryType: "arraybuffer",
    set onopen(value) {
      raw.onopen = value;
    },
    get onopen() {
      return raw.onopen;
    },
    set onmessage(value) {
      raw.onmessage = value === null ? null : (event) => value({ data: toArrayBuffer2(event.data) });
    },
    get onmessage() {
      return null;
    },
    set onclose(value) {
      raw.onclose = value;
    },
    get onclose() {
      return raw.onclose;
    },
    set onerror(value) {
      raw.onerror = value;
    },
    get onerror() {
      return raw.onerror;
    },
    onbufferedamountlow: null,
    send(data) {
      const bytes = typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
      try {
        raw.send(typeof data === "string" ? data : Buffer.from(data));
      } catch (error) {
        console.error("[werift-send-error] bytes=" + bytes, error instanceof Error ? error.message : error);
        throw error;
      }
    },
    close() {
      raw.close();
    }
  };
}
function adaptNativeDataChannel(raw) {
  let onmessage = null;
  return {
    get label() {
      return raw.label;
    },
    get ordered() {
      return raw.ordered;
    },
    get readyState() {
      return raw.readyState;
    },
    get bufferedAmount() {
      return raw.bufferedAmount;
    },
    get binaryType() {
      return raw.binaryType;
    },
    set binaryType(value) {
      raw.binaryType = value;
    },
    set onopen(value) {
      raw.onopen = value;
    },
    get onopen() {
      return raw.onopen;
    },
    set onmessage(value) {
      onmessage = value;
      raw.onmessage = value === null ? null : (event) => value({ data: normalizeNativeMessageData(event.data) });
    },
    get onmessage() {
      return onmessage;
    },
    set onclose(value) {
      raw.onclose = value;
    },
    get onclose() {
      return raw.onclose;
    },
    set onerror(value) {
      raw.onerror = value;
    },
    get onerror() {
      return raw.onerror;
    },
    set onbufferedamountlow(value) {
      raw.onbufferedamountlow = value;
    },
    get onbufferedamountlow() {
      return raw.onbufferedamountlow;
    },
    send(data) {
      raw.send(typeof data === "string" ? data : Buffer.from(data));
    },
    close() {
      raw.close();
    }
  };
}
function toArrayBuffer2(data) {
  if (typeof data === "string") return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
function normalizeNativeCandidate(candidate) {
  const json = typeof candidate.toJSON === "function" ? candidate.toJSON() : {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment
  };
  return {
    ...json,
    sdpMLineIndex: normalizeSdpMLineIndex(json.sdpMLineIndex)
  };
}
function normalizeNativeMessageData(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return new Uint8Array().buffer;
}
function detectHostIpv4Candidates(interfaces, preferredHostIpv4Candidates = []) {
  const candidates = [];
  const routePreference = new Map(preferredHostIpv4Candidates.map((ip, index) => [ip, 1e4 - index]));
  for (const [name2, addresses] of Object.entries(interfaces)) {
    const interfaceScore = physicalInterfaceScore(name2);
    if (interfaceScore === void 0) continue;
    for (const address of addresses ?? []) {
      if (address.internal || !isIpv4Family(address.family)) continue;
      const ip = address.address;
      if (!isUsableIpv4(ip)) continue;
      candidates.push({
        name: name2,
        ip,
        score: interfaceScore + (isPrivate(ip) ? 1e3 : 0) + (routePreference.get(ip) ?? 0)
      });
    }
  }
  candidates.sort((left, right) => {
    const score = right.score - left.score;
    if (score !== 0) return score;
    const name2 = left.name.localeCompare(right.name, "en");
    return name2 === 0 ? left.ip.localeCompare(right.ip, "en", { numeric: true }) : name2;
  });
  return [...new Set(candidates.map((candidate) => candidate.ip))];
}
async function detectRouteHostIpv4Candidates(targets, timeoutMs = 500) {
  const detected = await Promise.all(targets.map(async (target) => {
    const routeTarget = parseRouteTarget(target);
    return routeTarget === void 0 ? void 0 : await detectRouteHostIpv4(routeTarget, timeoutMs).catch(() => void 0);
  }));
  return [...new Set(detected.filter((ip) => ip !== void 0 && isUsableIpv4(ip)))];
}
function shouldUseCandidatePair(pair, allowedHostIpv4) {
  if (allowedHostIpv4.size === 0) return true;
  const candidate = localCandidate(pair);
  if (candidate === void 0) return true;
  return shouldUseLocalCandidate(candidate, allowedHostIpv4);
}
function shouldAdvertiseCandidate(candidate, allowedHostIpv4) {
  if (allowedHostIpv4.size === 0) return true;
  const parsed = parseIceCandidate(candidate);
  if (parsed === void 0) return true;
  return shouldUseLocalCandidate(parsed, allowedHostIpv4);
}
function shouldUseLocalCandidate(candidate, allowedHostIpv4) {
  if (candidate.type === "host") return candidate.host !== void 0 && allowedHostIpv4.has(candidate.host);
  if (candidate.type === "srflx" && candidate.relatedAddress !== void 0) {
    return allowedHostIpv4.has(candidate.relatedAddress);
  }
  return true;
}
function localCandidate(pair) {
  try {
    return pair.localCandidate;
  } catch {
    return void 0;
  }
}
function summarizeWeriftCandidate(candidate) {
  if (candidate === void 0) return void 0;
  const address = summarizeAddress(candidate.host);
  const related = summarizeAddress(candidate.relatedAddress);
  return {
    candidateType: candidate.type === "host" || candidate.type === "srflx" || candidate.type === "prflx" || candidate.type === "relay" ? candidate.type : "unknown",
    ...address,
    ...candidate.relatedAddress === void 0 ? {} : { relatedAddressFamily: related.addressFamily, relatedAddressScope: related.addressScope }
  };
}
function orderIceServersForWerift(iceServers) {
  return iceServers.map((server) => {
    const urls = Array.isArray(server.urls) ? [...server.urls] : [server.urls];
    urls.sort((left, right) => iceUrlScore(left) - iceUrlScore(right));
    return { ...server, urls: Array.isArray(server.urls) ? urls : urls[0] ?? server.urls };
  });
}
function iceUrlScore(url) {
  const value = url.trim().toLowerCase();
  if (value.startsWith("stun:") || value.startsWith("stuns:")) return 0;
  if (value.startsWith("turn:") && value.includes("transport=tcp")) return 10;
  if (value.startsWith("turns:") && value.includes("transport=tcp")) return 20;
  if (value.startsWith("turn:") && value.includes("transport=udp")) return 30;
  if (value.startsWith("turns:")) return 40;
  if (value.startsWith("turn:")) return 50;
  return 100;
}
function parseRouteTarget(value) {
  try {
    const url = new URL(value);
    const port = Number(url.port || (url.protocol === "http:" ? "80" : "443"));
    if (!Number.isSafeInteger(port) || port <= 0 || port > 65535 || url.hostname.length === 0) return void 0;
    return { host: url.hostname, port };
  } catch {
    return void 0;
  }
}
async function detectRouteHostIpv4(target, timeoutMs) {
  const socket = createSocket("udp4");
  try {
    return await new Promise((resolve3, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve3(void 0);
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("error", onError);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      socket.once("error", onError);
      socket.connect(target.port, target.host, () => {
        cleanup();
        const address = socket.address();
        resolve3(typeof address === "string" ? void 0 : address.address);
      });
    });
  } finally {
    socket.close();
  }
}
function isCacheableFactoryOptions(options) {
  return options.interfaces === void 0 && options.preferredHostIpv4Candidates === void 0 && options.routeTargets === void 0;
}
function parseIceCandidate(candidate) {
  const value = candidate.candidate?.trim();
  if (value === void 0 || value.length === 0) return void 0;
  const parts = value.replace(/^candidate:/, "").split(/\s+/);
  const typeIndex = parts.indexOf("typ");
  if (typeIndex < 0) return void 0;
  const host = parts[4];
  const type = parts[typeIndex + 1];
  const relatedAddressIndex = parts.indexOf("raddr");
  return {
    ...host === void 0 ? {} : { host },
    ...type === void 0 ? {} : { type },
    ...relatedAddressIndex < 0 || parts[relatedAddressIndex + 1] === void 0 ? {} : { relatedAddress: parts[relatedAddressIndex + 1] }
  };
}
function physicalInterfaceScore(name2) {
  const value = name2.toLowerCase();
  if (/^(utun|tun|tap|ppp|bridge|awdl|llw|gif|stf|anpi|ap\d|vmnet|veth|docker|br-|vboxnet|lo)/.test(value)) {
    return void 0;
  }
  if (/^(eth|eno|ens|enp)/.test(value)) return 500;
  if (/^(en|wlan|wl|wifi|wi-fi)/.test(value)) return 450;
  return 300;
}
function isIpv4Family(family) {
  return family === "IPv4" || family === 4;
}
function isUsableIpv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 0 || parts[0] === 127 || parts[0] >= 224) return false;
  if (parts[0] === 169 && parts[1] === 254) return false;
  return !isCgnat(ip);
}
function isCgnat(ip) {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}
function isPrivate(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

// src/client-runtime.ts
var REMOTE_COMMAND_LIST_MIN_VERSION = [0, 3, 16];
var REMOTE_FILE_VIEWER_MIN_VERSION = [0, 3, 17];
var DIRECT_WEBRTC_NEGOTIATE_TIMEOUT_MS = 12e3;
var DIRECT_LAN_PROGRESS_DISPLAY_MS = 1400;
var ClientModeRuntime = class {
  constructor(config, identities, server, apiProxy, typertGateway, logger, host, rtcFactoryProvider = loadNodeRtcFactory) {
    this.config = config;
    this.identities = identities;
    this.server = server;
    this.logger = logger;
    this.host = host;
    this.rtcFactoryProvider = rtcFactoryProvider;
    this.proxySwitch = apiProxy === void 0 ? void 0 : new ApiProxySwitch(apiProxy);
    this.gatewaySwitch = new TypertGatewaySwitch(typertGateway);
  }
  identity;
  connected;
  pendingWorkspaceSelection;
  codexVirtual;
  proxySwitch;
  gatewaySwitch;
  codexStreams = /* @__PURE__ */ new Map();
  connectionProgress;
  connectionProgressRun = 0;
  closed = false;
  async start() {
    if (this.closed) throw new Error("client remote-mode runtime is closed");
    this.identity = await this.identities.loadOrCreate(this.config.deviceName);
    this.server.bindIdentity(this.identity);
    this.proxySwitch?.install();
    this.gatewaySwitch.install();
    this.logger.info("client remote-mode identity ready", {
      deviceId: shortId(this.identity.deviceId),
      fingerprint: this.identity.fingerprint
    });
  }
  registerControl(connection) {
    return connection.rpc.handle(CONTROL_RPC_PREFIX, (endpoint, payload, signal) => this.handleControl(endpoint, payload, signal), {
      authority: "loopback"
    });
  }
  status() {
    const targetStatus = this.gatewaySwitch.supportsCarrier() ? this.gatewaySwitch.status() : this.proxySwitch?.status() ?? this.gatewaySwitch.status();
    return {
      available: this.config.serverUrl !== void 0,
      identityReady: this.identity !== void 0,
      deviceId: this.identity?.deviceId,
      deviceName: this.identity?.name,
      serverUrl: this.config.serverUrl,
      ...targetStatus,
      connected: this.connected !== void 0,
      transport: this.connected?.client.getStats().mode ?? "Disconnected",
      connectedTargetDeviceId: this.connected?.target.deviceId,
      preferredTransports: this.config.forceRelay ? ["relay"] : ["lan", "p2p", "turn", "relay"],
      ...this.connectionProgress === void 0 ? {} : {
        connectionProgress: {
          targetDeviceId: this.connectionProgress.targetDeviceId,
          phase: this.connectionProgress.phase,
          ...this.connectionProgress.activeTransports === void 0 ? {} : { activeTransports: [...this.connectionProgress.activeTransports] }
        }
      },
      remoteFeatures: this.connected?.features ?? remoteHostFeatures(),
      ...this.pendingWorkspaceSelection === void 0 ? {} : { workspaceSelection: { ...this.pendingWorkspaceSelection } },
      backend: this.codexVirtual === void 0 ? "harness" : "codex",
      hostAuthorizationAvailable: this.host !== void 0,
      ...this.host === void 0 ? {} : { host: this.host.hostStatus() }
    };
  }
  async detailedStatus() {
    const connected = this.connected;
    if (connected === void 0 || this.identity === void 0) return this.status();
    const details = await connected.transport.connectionDetails();
    if (this.connected !== connected) return this.status();
    return {
      ...this.status(),
      network: {
        ...details,
        local: {
          deviceId: this.identity.deviceId,
          name: this.identity.name,
          platform: process.platform
        },
        remote: {
          deviceId: connected.target.deviceId,
          name: connected.target.name,
          platform: connected.target.platform
        }
      }
    };
  }
  async devices() {
    this.requireIdentity();
    const serverDevices = await this.server.listDevices();
    const remoteDevices = serverDevices.filter((device) => device.deviceId !== this.host?.hostStatus().deviceId);
    return Promise.all(remoteDevices.map(async (device) => {
      await this.authorizeHostPeer(device);
      const presence = await this.server.presenceFor(device.deviceId).catch(() => ({ online: false }));
      return { ...device, ...presence };
    }));
  }
  async authorizeClientWithAccount(email, password) {
    let authorization;
    try {
      authorization = await this.server.authorizeWithAccount(this.requireIdentity(), email, password);
    } catch (error) {
      if (!(error instanceof ServerApiError) || error.code !== "DEVICE_REVOKED") throw error;
      this.identity = await this.identities.reset(this.config.deviceName);
      this.server.bindIdentity(this.identity);
      authorization = await this.server.authorizeWithAccount(this.identity, email, password);
    }
    this.logger.info("Client account authorized");
    return authorization;
  }
  async startClientOAuthQrLogin(provider) {
    return this.server.startOAuthQrLogin(provider);
  }
  async pollClientOAuthQrLogin(qrId) {
    const result = await this.server.pollOAuthQrLogin(this.requireIdentity(), qrId, async () => {
      this.identity = await this.identities.reset(this.config.deviceName);
      this.server.bindIdentity(this.identity);
      this.logger.info("Rotated revoked Client identity before QR authorization retry");
      return this.identity;
    });
    if (result.status === "complete") this.logger.info("Client account authorized with QR login");
    return result;
  }
  async clearClientAuthorization() {
    const previous = this.connected;
    this.connected = void 0;
    this.connectionProgress = void 0;
    this.pendingWorkspaceSelection = void 0;
    await this.closeCodexVirtual();
    this.proxySwitch?.selectLocal();
    this.gatewaySwitch.selectLocal();
    await this.closeCodexStreams(previous?.client);
    await previous?.client.close().catch(() => void 0);
    await this.server.revokeCurrentDevice();
    this.identity = await this.identities.reset(this.config.deviceName);
    this.server.bindIdentity(this.identity);
  }
  async setHostAuthorization(enabled) {
    if (this.host === void 0) throw new ClientModeError("METHOD_NOT_ALLOWED", "This plugin is not running as a Host.");
    if (!enabled) {
      await this.host.clearHostAuthorization();
      return this.status();
    }
    const credentials = await this.server.authenticate(this.requireIdentity());
    await this.host.authorizeHostAsOwned(credentials.accessToken, credentials.account);
    return this.status();
  }
  async setMode(mode, targetDeviceId, signal) {
    if (mode === "local") {
      await this.closeCodexVirtual();
      this.proxySwitch?.selectLocal();
      this.gatewaySwitch.selectLocal();
      const previous2 = this.connected;
      this.connected = void 0;
      this.connectionProgress = void 0;
      this.pendingWorkspaceSelection = void 0;
      await this.closeCodexStreams(previous2?.client);
      await previous2?.client.close().catch(() => void 0);
      this.logger.info("Harness target switched", { mode: "local" });
      return this.status();
    }
    if (targetDeviceId === void 0 || targetDeviceId.length === 0) {
      throw new ClientModeError("INVALID_MESSAGE", "A targetDeviceId is required for remote mode.");
    }
    const next = await this.connect(targetDeviceId, signal);
    try {
      this.assertRemoteCompatible(next);
    } catch (error) {
      this.clearConnectionProgress(next.progressRunId);
      await next.client.close().catch(() => void 0);
      throw error;
    }
    const previous = this.connected;
    this.connected = next;
    this.clearConnectionProgress(next.progressRunId);
    this.pendingWorkspaceSelection = void 0;
    await this.closeCodexVirtual();
    this.selectRemoteTarget(next);
    await this.closeCodexStreams(previous?.client);
    await previous?.client.close().catch(() => void 0);
    this.logger.info("Harness target switched", { mode: "remote", targetDeviceId: shortId(next.target.deviceId) });
    return this.status();
  }
  async listRemoteDirectory(targetDeviceId, path, signal) {
    const remote = await this.ensureConnected(targetDeviceId, signal);
    if (remote.features.remoteGateway) {
      const value = await new RemoteTypertGateway2(remote.client).invoke({
        namespace: "directoryPicker",
        method: "list",
        args: path === void 0 ? {} : { path },
        ...signal === void 0 ? {} : { signal }
      });
      return value;
    }
    const api = new RemoteHarnessApiProxy(remote.client).api;
    const response = await api.host.listDirectory({
      rpcId: `remote-directory-${Date.now()}`,
      payload: path === void 0 ? {} : { path }
    }, signal ?? new AbortController().signal);
    return unwrapNativeResult(response);
  }
  async listRemoteWorkspaces(targetDeviceId, signal) {
    const remote = await this.ensureConnected(targetDeviceId, signal);
    if (remote.features.remoteGateway) {
      return readRemoteWorkspaceBaseline(new RemoteTypertGateway2(remote.client), signal);
    }
    const api = new RemoteHarnessApiProxy(remote.client).api;
    const response = await api.workspace.list({
      rpcId: `remote-workspaces-${Date.now()}`,
      payload: {}
    });
    const value = unwrapNativeResult(response);
    return value.items;
  }
  async openRemoteWorkspace(targetDeviceId, path, signal) {
    if (path.trim() === "") throw new ClientModeError("INVALID_MESSAGE", "A remote working directory is required.");
    const remote = await this.ensureConnected(targetDeviceId, signal);
    this.assertRemoteCompatible(remote);
    let workspace;
    if (remote.features.remoteGateway) {
      workspace = await new RemoteTypertGateway2(remote.client).invoke({
        namespace: "workspace",
        method: "create",
        args: { request: { path } },
        ...signal === void 0 ? {} : { signal }
      });
    } else {
      const api = new RemoteHarnessApiProxy(remote.client).api;
      const response = await api.workspace.create({
        rpcId: `remote-workspace-${Date.now()}`,
        payload: { path }
      });
      workspace = unwrapNativeResult(response);
    }
    await this.closeCodexVirtual();
    this.selectRemoteTarget(remote);
    const workspaceId = workspaceRecordId(workspace.workspace);
    this.pendingWorkspaceSelection = { targetDeviceId: remote.target.deviceId, workspaceId };
    this.logger.info("Remote workspace opened", { targetDeviceId: shortId(remote.target.deviceId) });
    return { ...this.status(), workspace };
  }
  async listCodexWorkspaces(targetDeviceId, signal) {
    const remote = await this.ensureConnected(targetDeviceId, signal);
    remote.features = await probeRemoteHostFeatures(remote.client, remote.clientVersion);
    if (!remote.features.codex) {
      throw new ClientModeError("FEATURE_NOT_SUPPORTED", "The selected Host does not provide CodeX workspaces.");
    }
    return discoverCodexVirtualWorkspaces(new CodexRemoteClient(remote.client), signal);
  }
  async openCodexWorkspace(targetDeviceId, workspaceId, signal) {
    const remote = await this.ensureConnected(targetDeviceId, signal);
    remote.features = await probeRemoteHostFeatures(remote.client, remote.clientVersion);
    if (!remote.features.codex) {
      throw new ClientModeError("FEATURE_NOT_SUPPORTED", "The selected Host does not provide CodeX workspaces.");
    }
    this.assertRemoteCompatible(remote);
    const virtual = CodexVirtualHarness.remote(remote.client, {
      deviceId: remote.target.deviceId,
      name: remote.target.name
    }, harnessSessionGeneration(this.host?.localHarnessVersion?.()));
    let workspace;
    try {
      workspace = await virtual.selectWorkspace(workspaceId, signal);
    } catch {
      await virtual.close();
      throw new ClientModeError("WORKSPACE_NOT_FOUND", "The selected CodeX workspace is no longer available.");
    }
    await this.closeCodexVirtual();
    this.codexVirtual = virtual;
    this.selectCodexTarget(virtual, remote);
    const preferredSessionId = await virtual.preferredSessionId(signal);
    this.pendingWorkspaceSelection = {
      targetDeviceId: remote.target.deviceId,
      workspaceId,
      backend: "codex",
      ...preferredSessionId === void 0 ? {} : { sessionId: preferredSessionId }
    };
    this.logger.info("CodeX virtual workspace opened", { targetDeviceId: shortId(remote.target.deviceId) });
    return { ...this.status(), workspace };
  }
  async createCodexWorkspace(targetDeviceId, path, signal) {
    const trimmedPath = path.trim();
    if (trimmedPath === "") throw new ClientModeError("INVALID_MESSAGE", "A CodeX project directory is required.");
    const remote = await this.ensureConnected(targetDeviceId, signal);
    remote.features = await probeRemoteHostFeatures(remote.client, remote.clientVersion);
    if (!remote.features.codex) {
      throw new ClientModeError("FEATURE_NOT_SUPPORTED", "The selected Host does not provide CodeX workspaces.");
    }
    this.assertRemoteCompatible(remote);
    const result = record3(await new CodexRemoteClient(remote.client).request("project/create", {
      name: remoteWorkspaceTitle(trimmedPath),
      roots: [{ path: trimmedPath }],
      idempotencyKey: uuidV7()
    }, signal));
    const project = record3(result.project);
    if (typeof project.id !== "string" || project.id.length === 0) {
      throw new ClientModeError("INVALID_MESSAGE", "The Host returned an invalid CodeX project.");
    }
    return this.openCodexWorkspace(targetDeviceId, codexProjectWorkspaceId(project.id), signal);
  }
  consumeWorkspaceSelection(selection) {
    const pending = this.pendingWorkspaceSelection;
    if (pending?.targetDeviceId === selection.targetDeviceId && pending.workspaceId === selection.workspaceId && (pending.backend ?? "harness") === (selection.backend ?? "harness")) {
      this.pendingWorkspaceSelection = void 0;
    }
    return this.status();
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.proxySwitch?.selectLocal();
    this.gatewaySwitch.selectLocal();
    this.pendingWorkspaceSelection = void 0;
    await this.closeCodexVirtual();
    await this.closeCodexStreams(this.connected?.client);
    await this.connected?.client.close().catch(() => void 0);
    this.connected = void 0;
    this.connectionProgress = void 0;
    this.proxySwitch?.restore();
    this.gatewaySwitch.restore();
  }
  async callRemoteFileViewer(endpoint, payload, signal) {
    const remote = this.connected;
    if (remote === void 0 || this.status().mode !== "remote") {
      throw new ClientModeError("REMOTE_NOT_CONNECTED", "No Remote Host is selected.", true);
    }
    if (!remote.features.fileViewer) {
      throw new ClientModeError("FEATURE_NOT_SUPPORTED", "The selected Remote Host does not support remote file viewing.");
    }
    return remote.client.rpc("fileviewer.call", { endpoint, payload }, signal);
  }
  activeRemote() {
    return this.connected;
  }
  activeCodexRemote() {
    const remote = this.activeRemote();
    if (remote === void 0) return void 0;
    if (!remote.features.codex) {
      return void 0;
    }
    return remote;
  }
  async openCodexStream(payload, signal) {
    const remote = this.activeCodexRemote();
    const value = record3(payload);
    if (typeof value.streamId !== "string" || value.streamId.length === 0 || value.streamId.length > 128 || typeof value.threadId !== "string" || value.threadId.length === 0) {
      throw new ClientModeError("INVALID_MESSAGE", "A Codex stream and thread are required.");
    }
    if (this.codexStreams.has(value.streamId)) throw new ClientModeError("REQUEST_CONFLICT", "The Codex stream is already open.");
    let wake = () => void 0;
    const stream = {
      target: remote === void 0 ? { kind: "local" } : { kind: "remote", client: remote.client },
      frames: [],
      unsubscribe: () => void 0,
      close: async () => {
        if (remote === void 0) {
          await this.host?.codexCloseStream?.({ streamId: value.streamId }).catch(() => void 0);
          return;
        }
        await remote.client.rpc("codex.app.stream.close", { streamId: value.streamId }).catch(() => void 0);
      },
      wake: () => wake()
    };
    if (remote === void 0) {
      const host = this.requireLocalCodex();
      this.codexStreams.set(value.streamId, stream);
      try {
        const result = await host.codexOpenStream({ streamId: value.streamId, threadId: value.threadId }, this.publishLocalCodexFrame, signal);
        return result;
      } catch (error) {
        this.codexStreams.delete(value.streamId);
        stream.wake();
        throw error;
      }
    }
    stream.unsubscribe = remote.client.onEvent((event) => {
      if (event.event === "codex.app.frame" && isRecord6(event.data) && event.data.streamId === value.streamId) {
        this.appendCodexFrame(stream, event.data);
      }
      if (event.event === "codex.app.stream.closed" && isRecord6(event.data) && event.data.streamId === value.streamId) {
        stream.closed = typeof event.data.reason === "string" ? event.data.reason : "closed";
        stream.wake();
      }
    });
    try {
      await remote.client.rpc("codex.app.stream.open", { streamId: value.streamId, threadId: value.threadId }, signal);
    } catch (error) {
      stream.unsubscribe();
      throw error;
    }
    this.codexStreams.set(value.streamId, stream);
    return { opened: true, streamId: value.streamId, threadId: value.threadId };
  }
  publishLocalCodexFrame = async (event, data) => {
    const streamId = data.streamId;
    const stream = this.codexStreams.get(streamId);
    if (stream === void 0 || stream.target.kind !== "local") return;
    if (event === "codex.app.frame") {
      this.appendCodexFrame(stream, data);
      return;
    }
    const closed = data;
    stream.closed = typeof closed.reason === "string" ? closed.reason : "closed";
    stream.wake();
  };
  appendCodexFrame(stream, data) {
    if (!isRecord6(data) || !isRecord6(data.frame) || typeof data.frame.method !== "string") return;
    if (stream.frames.length >= 256) {
      stream.closed = "overflow";
    } else {
      stream.frames.push({ method: data.frame.method, params: data.frame.params });
    }
    stream.wake();
  }
  localCodexAvailable() {
    return this.host?.codexStatus?.().available === true;
  }
  requireLocalCodex() {
    if (!this.localCodexAvailable() || this.host?.codexCall === void 0 || this.host.codexRespond === void 0 || this.host.codexOpenStream === void 0 || this.host.codexCloseStream === void 0) {
      throw new ClientModeError("FEATURE_NOT_SUPPORTED", "Local CodeX is disabled or unavailable on this Host.");
    }
    return {
      codexCall: this.host.codexCall.bind(this.host),
      codexRespond: this.host.codexRespond.bind(this.host),
      codexOpenStream: this.host.codexOpenStream.bind(this.host),
      codexCloseStream: this.host.codexCloseStream.bind(this.host)
    };
  }
  async nextCodexFrames(payload, signal) {
    const value = record3(payload);
    if (typeof value.streamId !== "string") throw new ClientModeError("INVALID_MESSAGE", "A Codex stream is required.");
    const stream = this.codexStreams.get(value.streamId);
    if (stream === void 0) throw new ClientModeError("STREAM_NOT_FOUND", "The Codex stream is not open.");
    if (stream.frames.length === 0 && stream.closed === void 0) await waitForCodexFrames(stream, signal);
    const frames = stream.frames.splice(0, 100);
    return {
      streamId: value.streamId,
      frames,
      closed: stream.closed !== void 0,
      ...stream.closed === void 0 ? {} : { reason: stream.closed }
    };
  }
  async closeCodexStream(payload) {
    const value = record3(payload);
    if (typeof value.streamId !== "string") throw new ClientModeError("INVALID_MESSAGE", "A Codex stream is required.");
    const stream = this.codexStreams.get(value.streamId);
    if (stream === void 0) return { closed: false, streamId: value.streamId };
    this.codexStreams.delete(value.streamId);
    stream.unsubscribe();
    stream.wake();
    await stream.close();
    return { closed: true, streamId: value.streamId };
  }
  async closeCodexStreams(client) {
    const targets = [...this.codexStreams.entries()].filter(([, stream]) => client === void 0 || stream.target.kind === "remote" && stream.target.client === client);
    await Promise.all(targets.map(async ([streamId, stream]) => {
      this.codexStreams.delete(streamId);
      stream.unsubscribe();
      stream.closed = "peer-disconnected";
      stream.wake();
      await stream.close();
    }));
  }
  selectRemoteTarget(remote) {
    const target = { deviceId: remote.target.deviceId, name: remote.target.name };
    if (this.gatewaySwitch.supportsCarrier()) {
      this.gatewaySwitch.selectRemote(new RemoteTypertGateway2(remote.client), void 0, target);
      return;
    }
    this.proxySwitch.selectRemote(new RemoteHarnessApiProxy(remote.client).api, target);
    this.gatewaySwitch.selectRemote((request) => invokeRemoteCommand(remote.client, request), {
      execute: true,
      list: remote.features.commandList
    }, target);
  }
  selectCodexTarget(virtual, remote) {
    const target = { deviceId: remote.target.deviceId, name: remote.target.name };
    if (this.gatewaySwitch.supportsCarrier()) {
      this.gatewaySwitch.selectRemote(virtual, void 0, target);
      return;
    }
    this.proxySwitch.selectRemote(virtual.api, target);
    this.gatewaySwitch.selectRemote((request) => virtual.invoke(request), { execute: true, list: true }, target);
  }
  async closeCodexVirtual() {
    const virtual = this.codexVirtual;
    this.codexVirtual = void 0;
    await virtual?.close();
  }
  assertRemoteCompatible(remote) {
    const localRemoteGateway = this.gatewaySwitch.supportsCarrier();
    if (localRemoteGateway && remote.features.remoteGateway) {
      const localSessionGeneration = harnessSessionGeneration(this.host?.localHarnessVersion?.());
      const remoteSessionGeneration = remote.features.sessionFormat === 3 ? "v3" : "legacy";
      if (localSessionGeneration === remoteSessionGeneration) return;
      throw new ClientModeError(
        "HARNESS_VERSION_INCOMPATIBLE",
        `The local and remote Harness Session formats differ (${localSessionGeneration} vs ${remoteSessionGeneration}).`
      );
    }
    if (!localRemoteGateway && this.proxySwitch !== void 0 && remote.features.apiProxy) return;
    throw new ClientModeError(
      "HARNESS_VERSION_INCOMPATIBLE",
      localRemoteGateway ? "The selected Host does not provide the Harness v0.1.2 Typert Remote Gateway transport." : "The selected Host does not provide the legacy Harness ApiProxy transport."
    );
  }
  async connect(targetDeviceId, signal) {
    signal?.throwIfAborted();
    const progressRunId = this.connectionProgressRun + 1;
    this.connectionProgressRun = progressRunId;
    this.connectionProgress = { runId: progressRunId, targetDeviceId, phase: "checking-host" };
    const identity = this.requireIdentity();
    let client;
    try {
      const serverDevice = (await this.server.listDevices()).find((device) => device.deviceId === targetDeviceId);
      if (serverDevice === void 0) {
        throw new ClientModeError("MEMBERSHIP_REQUIRED", "The selected Host is not authorized for this account.");
      }
      this.updateConnectionProgress(progressRunId, "authorizing-peer");
      const target = await this.authorizeHostPeer(serverDevice);
      const presence = await this.server.presenceFor(targetDeviceId);
      if (!presence.online) throw new ClientModeError("HOST_OFFLINE", "The selected Host is offline.", true);
      const credentials = await this.server.authenticate(identity);
      const rtcFactory = this.config.forceRelay ? void 0 : await this.rtcFactoryProvider({ routeTargets: [this.server.baseUrl] }).catch(() => void 0);
      if (!this.config.forceRelay && rtcFactory === void 0) {
        this.logger.warn("remote Harness WebRTC backend unavailable; using relay", {
          targetDeviceId: shortId(target.deviceId)
        });
      }
      let webRtcFallback = false;
      const createTransport = (attempt) => new AdaptiveTransport(
        websocketUrl(this.server.baseUrl),
        {
          role: "client",
          deviceId: identity.deviceId,
          accessToken: credentials.accessToken,
          targetDeviceId,
          forceRelay: this.config.forceRelay || attempt === "relay",
          preferredTransports: preferredTransportsForAttempt(attempt),
          negotiateTimeoutMs: attempt === "direct" ? DIRECT_WEBRTC_NEGOTIATE_TIMEOUT_MS : void 0,
          ...rtcFactory === void 0 || attempt === "relay" ? {} : { rtcFactory },
          fetchIceServers: async (connectionId) => iceServersForAttempt(attempt, await this.server.turnCredentials(connectionId)),
          onWebRtcFallback: (error, diagnostics) => {
            webRtcFallback = true;
            this.logger.warn(attempt === "direct" ? "remote Harness direct WebRTC failed; trying TURN" : "remote Harness TURN WebRTC failed; using relay", {
              targetDeviceId: shortId(target.deviceId),
              attempt,
              reason: diagnosticReason(error)
            });
            if (diagnostics !== void 0) {
              this.logger.debug("remote Harness WebRTC fallback diagnostics", {
                targetDeviceId: shortId(target.deviceId),
                attempt,
                ...webrtcDiagnosticsLogFields(diagnostics)
              });
            }
          }
        }
      );
      const attempts = this.config.forceRelay || rtcFactory === void 0 ? ["relay"] : ["direct", "turn", "relay"];
      let transport;
      for (const attempt of attempts) {
        webRtcFallback = false;
        const stopProgressTimer = this.beginAttemptProgress(progressRunId, attempt);
        try {
          transport = createTransport(attempt);
          client = new RemoteClientCore(new ClientSecureTransport(transport, identity, target), 6e4);
          await client.connect();
          signal?.throwIfAborted();
        } finally {
          stopProgressTimer();
        }
        if (attempt === "relay" || !webRtcFallback) break;
        await client.close();
        client = void 0;
        transport = void 0;
        if (attempt === "turn") {
          this.logger.info("remote Harness relay fallback re-established", {
            targetDeviceId: shortId(target.deviceId)
          });
        }
      }
      if (client === void 0 || transport === void 0) {
        throw new ClientModeError("CONNECTION_FAILED", "Unable to establish a remote transport.", true);
      }
      const connectedClient = client;
      const connectedTransport = transport;
      const connectedPreference = transportPreferenceForMode(connectedClient.getStats().mode);
      this.updateConnectionProgress(
        progressRunId,
        "connected",
        connectedPreference === void 0 ? void 0 : [connectedPreference]
      );
      connectedClient.onClose(() => {
        if (this.connected?.client !== connectedClient) return;
        this.connected = void 0;
        this.connectionProgress = void 0;
        this.pendingWorkspaceSelection = void 0;
        void this.closeCodexVirtual();
        this.proxySwitch?.selectLocal();
        this.gatewaySwitch.selectLocal();
        void connectedClient.close().catch(() => void 0);
        this.logger.warn("remote Harness transport closed; falling back to local mode", {
          targetDeviceId: shortId(target.deviceId)
        });
      });
      const connectionDetails = await connectedTransport.connectionDetails().catch(() => void 0);
      this.logger.info("remote Harness transport ready", {
        targetDeviceId: shortId(target.deviceId),
        transport: connectedClient.getStats().mode,
        ...connectionDetails === void 0 ? {} : {
          preferredTransports: connectionDetails.preferredTransports,
          negotiatedCapabilities: connectionDetails.negotiatedCapabilities,
          webRtcEnabled: connectionDetails.webRtcEnabled
        }
      });
      if (connectionDetails?.webRtc?.diagnostics !== void 0) {
        this.logger.debug("remote Harness transport diagnostics", {
          targetDeviceId: shortId(target.deviceId),
          ...webrtcDiagnosticsLogFields(connectionDetails.webRtc.diagnostics)
        });
      }
      const features = await probeRemoteHostFeatures(connectedClient, serverDevice.clientVersion);
      return {
        client: connectedClient,
        target,
        transport: connectedTransport,
        features,
        progressRunId,
        ...serverDevice.clientVersion === void 0 ? {} : { clientVersion: serverDevice.clientVersion },
        ...serverDevice.harnessVersion === void 0 ? {} : { harnessVersion: serverDevice.harnessVersion }
      };
    } catch (error) {
      this.clearConnectionProgress(progressRunId);
      await client?.close().catch(() => void 0);
      throw error;
    }
  }
  async ensureConnected(targetDeviceId, signal) {
    if (this.connected?.target.deviceId === targetDeviceId) return this.connected;
    const next = await this.connect(targetDeviceId, signal);
    const previous = this.connected;
    this.connected = next;
    this.clearConnectionProgress(next.progressRunId);
    await previous?.client.close().catch(() => void 0);
    return next;
  }
  beginAttemptProgress(runId, attempt) {
    if (attempt !== "direct") {
      this.updateConnectionProgress(runId, "probing", [attempt]);
      return () => void 0;
    }
    this.updateConnectionProgress(runId, "probing", ["lan"]);
    const timer = setTimeout(() => {
      if (this.connectionProgress?.runId === runId && this.connectionProgress.phase === "probing") {
        this.updateConnectionProgress(runId, "probing", ["p2p"]);
      }
    }, DIRECT_LAN_PROGRESS_DISPLAY_MS);
    return () => clearTimeout(timer);
  }
  updateConnectionProgress(runId, phase, activeTransports) {
    if (this.connectionProgress?.runId !== runId) return;
    this.connectionProgress = {
      runId,
      targetDeviceId: this.connectionProgress.targetDeviceId,
      phase,
      ...activeTransports === void 0 ? {} : { activeTransports }
    };
  }
  clearConnectionProgress(runId) {
    if (this.connectionProgress?.runId === runId) this.connectionProgress = void 0;
  }
  async handleControl(endpoint, payload, signal) {
    try {
      if (endpoint === "status") return ok2(await this.detailedStatus());
      if (endpoint === "devices") return ok2(await this.devices());
      if (endpoint === "client.account.login") {
        const value = record3(payload);
        if (typeof value.email !== "string" || typeof value.password !== "string") {
          throw new ClientModeError("INVALID_MESSAGE", "Email and password are required.");
        }
        return ok2(await this.authorizeClientWithAccount(value.email, value.password));
      }
      if (endpoint === "client.account.qr.start") {
        const value = record3(payload);
        const provider = value.provider ?? "zhihu";
        if (provider !== "zhihu" && provider !== "github") {
          throw new ClientModeError("INVALID_MESSAGE", "A supported OAuth provider is required.");
        }
        return ok2(await this.startClientOAuthQrLogin(provider));
      }
      if (endpoint === "client.account.qr.poll") {
        const value = record3(payload);
        if (typeof value.qrId !== "string" || value.qrId.length < 20) {
          throw new ClientModeError("INVALID_MESSAGE", "A QR login session is required.");
        }
        return ok2(await this.pollClientOAuthQrLogin(value.qrId));
      }
      if (endpoint === "directory.list") {
        const value = record3(payload);
        if (typeof value.targetDeviceId !== "string") throw new ClientModeError("INVALID_MESSAGE", "A Host is required.");
        return ok2(await this.listRemoteDirectory(
          value.targetDeviceId,
          typeof value.path === "string" ? value.path : void 0,
          signal
        ));
      }
      if (endpoint === "workspaces.list") {
        const value = record3(payload);
        if (typeof value.targetDeviceId !== "string") throw new ClientModeError("INVALID_MESSAGE", "A Host is required.");
        return ok2(await this.listRemoteWorkspaces(value.targetDeviceId, signal));
      }
      if (endpoint === "codex.workspaces.list") {
        const value = record3(payload);
        if (typeof value.targetDeviceId !== "string") throw new ClientModeError("INVALID_MESSAGE", "A Host is required.");
        return ok2(await this.listCodexWorkspaces(value.targetDeviceId, signal));
      }
      if (endpoint === "workspace.open") {
        const value = record3(payload);
        if (typeof value.targetDeviceId !== "string" || typeof value.path !== "string") {
          throw new ClientModeError("INVALID_MESSAGE", "A Host and working directory are required.");
        }
        return ok2(await this.openRemoteWorkspace(value.targetDeviceId, value.path, signal));
      }
      if (endpoint === "codex.workspace.open") {
        const value = record3(payload);
        if (typeof value.targetDeviceId !== "string" || typeof value.workspaceId !== "string") {
          throw new ClientModeError("INVALID_MESSAGE", "A Host and CodeX Workspace are required.");
        }
        return ok2(await this.openCodexWorkspace(value.targetDeviceId, value.workspaceId, signal));
      }
      if (endpoint === "codex.workspace.create") {
        const value = record3(payload);
        if (typeof value.targetDeviceId !== "string" || typeof value.path !== "string") {
          throw new ClientModeError("INVALID_MESSAGE", "A Host and CodeX project directory are required.");
        }
        return ok2(await this.createCodexWorkspace(value.targetDeviceId, value.path, signal));
      }
      if (endpoint === "workspace.selection.consume") {
        const value = record3(payload);
        if (typeof value.targetDeviceId !== "string" || typeof value.workspaceId !== "string") {
          throw new ClientModeError("INVALID_MESSAGE", "A Host and Workspace are required.");
        }
        return ok2(this.consumeWorkspaceSelection({
          targetDeviceId: value.targetDeviceId,
          workspaceId: value.workspaceId,
          ...value.backend === "codex" ? { backend: "codex" } : {},
          ...typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}
        }));
      }
      if (endpoint === "fileviewer.stat" || endpoint === "fileviewer.readRange" || endpoint === "fileviewer.list") {
        const method = endpoint === "fileviewer.stat" ? "stat" : endpoint === "fileviewer.readRange" ? "readRange" : "list";
        return ok2(await this.callRemoteFileViewer(method, payload, signal));
      }
      if (endpoint === "codex.call") {
        const value = record3(payload);
        if (typeof value.method !== "string" || !("params" in value)) {
          throw new ClientModeError("INVALID_MESSAGE", "A Codex method and params are required.");
        }
        const remote = this.activeCodexRemote();
        if (remote !== void 0) return ok2(await new CodexRemoteClient(remote.client).request(value.method, value.params, signal));
        const host = this.requireLocalCodex();
        return ok2(await host.codexCall(value, signal));
      }
      if (endpoint === "codex.probe") {
        const local = this.localCodexAvailable();
        let remoteSupported = false;
        const remote = this.activeRemote();
        if (remote !== void 0) {
          try {
            remote.features = await probeRemoteHostFeatures(remote.client, remote.clientVersion);
            remoteSupported = remote.features.codex;
          } catch (error) {
            if (!local) throw error;
          }
        }
        return ok2({ supported: local || remoteSupported, local, remote: remoteSupported });
      }
      if (endpoint === "codex.respond") {
        const value = record3(payload);
        const remote = this.activeCodexRemote();
        if (remote !== void 0) return ok2(await remote.client.rpc("codex.app.respond", value, signal));
        const host = this.requireLocalCodex();
        return ok2(await host.codexRespond(value, signal));
      }
      if (endpoint === "codex.stream.open") return ok2(await this.openCodexStream(payload, signal));
      if (endpoint === "codex.stream.next") return ok2(await this.nextCodexFrames(payload, signal));
      if (endpoint === "codex.stream.close") return ok2(await this.closeCodexStream(payload));
      if (endpoint === "host.account.login") {
        if (this.host === void 0) throw new ClientModeError("METHOD_NOT_ALLOWED", "This plugin is not running as a Host.");
        const value = record3(payload);
        if (typeof value.email !== "string" || typeof value.password !== "string") {
          throw new ClientModeError("INVALID_MESSAGE", "Email and password are required.");
        }
        return ok2(await this.host.authorizeHostWithAccount(value.email, value.password));
      }
      if (endpoint === "host.authorization.set") {
        const value = record3(payload);
        if (typeof value.enabled !== "boolean") {
          throw new ClientModeError("INVALID_MESSAGE", "Host authorization state is required.");
        }
        return ok2(await this.setHostAuthorization(value.enabled));
      }
      if (endpoint === "host.registration-code.submit") {
        if (this.host === void 0) throw new ClientModeError("METHOD_NOT_ALLOWED", "This plugin is not running as a Host.");
        const value = record3(payload);
        if (typeof value.code !== "string" || value.code.trim() === "") {
          throw new ClientModeError("INVALID_MESSAGE", "A Host registration code is required.");
        }
        return ok2(await this.host.authorizeHostWithCode(value.code));
      }
      if (endpoint === "mode.set") {
        const value = record3(payload);
        if (value.mode !== "local" && value.mode !== "remote") throw new ClientModeError("INVALID_MESSAGE", "Mode must be local or remote.");
        return ok2(await this.setMode(value.mode, typeof value.targetDeviceId === "string" ? value.targetDeviceId : void 0, signal));
      }
      throw new ClientModeError("METHOD_NOT_FOUND", "The remote-mode control method does not exist.");
    } catch (error) {
      return fail2(error);
    }
  }
  requireIdentity() {
    if (this.identity === void 0) throw new ClientModeError("IDENTITY_INVALID", "The client identity is not ready.");
    return this.identity;
  }
  async authorizeHostPeer(serverDevice) {
    const descriptor = await this.server.deviceFor(serverDevice.deviceId);
    assertAuthorizedHost(serverDevice, descriptor);
    const existing = this.identities.trustedPeer(descriptor.deviceId);
    if (existing !== void 0 && existing.publicKey !== descriptor.identityKey) {
      throw new ClientModeError("PEER_IDENTITY_MISMATCH", "The authorized Host identity key changed unexpectedly.");
    }
    if (existing !== void 0 && existing.membershipId === descriptor.membershipId && existing.name === descriptor.name && existing.platform === descriptor.platform) {
      return existing;
    }
    return this.identities.trustPeer({
      deviceId: descriptor.deviceId,
      name: descriptor.name,
      platform: descriptor.platform,
      publicKey: descriptor.identityKey,
      membershipId: descriptor.membershipId
    });
  }
};
var ClientModeError = class extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
};
function assertAuthorizedHost(listed, descriptor) {
  if (descriptor.role !== "host" || descriptor.deviceId !== listed.deviceId || descriptor.membershipId !== listed.membershipId) {
    throw new ClientModeError("PEER_IDENTITY_MISMATCH", "Server Host details do not match the authorized device list.");
  }
}
function websocketUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/v1/connect`;
  return url.toString();
}
function webrtcDiagnosticsLogFields(diagnostics) {
  if (diagnostics === void 0) return {};
  return {
    rtcConnectionState: diagnostics.connectionState,
    rtcIceConnectionState: diagnostics.iceConnectionState,
    rtcIceGatheringState: diagnostics.iceGatheringState,
    rtcLocalCandidates: diagnostics.localCandidates,
    rtcRemoteCandidates: diagnostics.remoteCandidates,
    rtcCandidatePairs: diagnostics.candidatePairs,
    rtcFilteredLocalCandidates: diagnostics.filteredLocalCandidates,
    rtcFilteredCandidatePairs: diagnostics.filteredCandidatePairs,
    ...diagnostics.selectedPath === void 0 ? {} : { rtcSelectedPath: diagnostics.selectedPath }
  };
}
function record3(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ClientModeError("INVALID_MESSAGE", "The control request payload is invalid.");
  }
  return value;
}
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function ok2(value) {
  return { ok: true, value };
}
async function invokeRemoteCommand(client, request) {
  const rpcId = uuidV7();
  const response = await client.rpc("harness.api.call", {
    method: `${request.namespace}.${request.method}`,
    rpcId,
    payload: request.args
  }, request.signal);
  if (response.rpcId !== rpcId) {
    throw new ClientModeError("INVALID_MESSAGE", "The remote Host returned an invalid command response.");
  }
  return unwrapNativeResult(response);
}
async function readRemoteWorkspaceBaseline(gateway, signal) {
  const lifetime = new AbortController();
  const activeSignal = signal === void 0 ? lifetime.signal : AbortSignal.any([signal, lifetime.signal]);
  const source = await gateway.open("workspace/follow", { args: {} }, activeSignal);
  const iterator = source[Symbol.asyncIterator]();
  try {
    const first = await iterator.next();
    if (first.done || !isRecord6(first.value) || first.value.type !== "baseline" || !isRecord6(first.value.value) || !Array.isArray(first.value.value.items)) {
      throw new ClientModeError("INVALID_MESSAGE", "The remote Host returned an invalid Workspace baseline.");
    }
    return first.value.value.items.map((item) => {
      if (!isRecord6(item) || typeof item.workspaceId !== "string" || typeof item.path !== "string" || typeof item.title !== "string") {
        throw new ClientModeError("INVALID_MESSAGE", "The remote Host returned an invalid Workspace row.");
      }
      return { workspaceId: item.workspaceId, path: item.path, title: item.title };
    });
  } finally {
    lifetime.abort("workspace-baseline-read");
    await iterator.return?.();
  }
}
function unwrapNativeResult(response) {
  const result = response.result;
  if (typeof result !== "object" || result === null || !("ok" in result)) {
    throw new ClientModeError("INVALID_MESSAGE", "The remote Host returned an invalid response.");
  }
  if (result.ok !== true || !("value" in result)) {
    const message = "error" in result && typeof result.error === "object" && result.error !== null && "message" in result.error && typeof result.error.message === "string" ? result.error.message : "The remote Host rejected the request.";
    throw new ClientModeError("REMOTE_API_ERROR", message);
  }
  return result.value;
}
function workspaceRecordId(value) {
  if (typeof value !== "object" || value === null || !("workspaceId" in value) || typeof value.workspaceId !== "string" || value.workspaceId.length === 0) {
    throw new ClientModeError("INVALID_MESSAGE", "The remote Host returned an invalid Workspace.");
  }
  return value.workspaceId;
}
function remoteWorkspaceTitle(path) {
  const normalized = path.replace(/[\\/]+$/u, "");
  return normalized.split(/[\\/]+/u).filter(Boolean).at(-1) ?? path;
}
function fail2(error) {
  const source = error instanceof Error ? error : void 0;
  const remoteCode = source !== void 0 && "code" in source && typeof source.code === "string" ? source.code : source instanceof ClientModeError ? source.code : void 0;
  const retryable = source !== void 0 && "retryable" in source && typeof source.retryable === "boolean" ? source.retryable : source instanceof ClientModeError ? source.retryable : false;
  return {
    ok: false,
    error: {
      code: "internal",
      message: source?.message ?? "The remote-mode operation failed.",
      details: remoteCode === void 0 ? {} : { remoteCode, retryable }
    }
  };
}
function shortId(value) {
  return value.length <= 12 ? value : `${value.slice(0, 8)}\u2026${value.slice(-4)}`;
}
function remoteHostFeatures(clientVersion) {
  return {
    commandList: isVersionAtLeast(clientVersion, REMOTE_COMMAND_LIST_MIN_VERSION),
    fileViewer: isVersionAtLeast(clientVersion, REMOTE_FILE_VIEWER_MIN_VERSION),
    apiProxy: true,
    remoteGateway: false,
    codex: false
  };
}
async function probeRemoteHostFeatures(client, clientVersion) {
  const fallback = remoteHostFeatures(clientVersion);
  let value;
  try {
    value = await client.rpc("harness.transport.describe", {});
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "METHOD_NOT_FOUND") return fallback;
    throw error;
  }
  if (!isRecord6(value) || !Array.isArray(value.capabilities) || value.capabilities.some((capability) => typeof capability !== "string")) {
    throw new ClientModeError("INVALID_MESSAGE", "The remote Host returned invalid transport capabilities.");
  }
  const capabilities = new Set(value.capabilities);
  const apiProxy = capabilities.has("harness.api.v1");
  const remoteV1 = capabilities.has("harness.remote.v1");
  const remoteV3 = capabilities.has("harness.remote.v3");
  if (remoteV1 && remoteV3) {
    throw new ClientModeError("INVALID_MESSAGE", "The remote Host advertised conflicting Harness Session formats.");
  }
  const sessionFormat = remoteV3 ? 3 : void 0;
  const remoteGateway = remoteV3 || remoteV1;
  if (!apiProxy && !remoteGateway) {
    throw new ClientModeError("FEATURE_NOT_SUPPORTED", "The remote Host exposes no supported Harness transport.");
  }
  return {
    commandList: remoteGateway || apiProxy && fallback.commandList,
    fileViewer: capabilities.has("fileviewer.read.v1"),
    apiProxy,
    remoteGateway,
    ...sessionFormat === void 0 ? {} : { sessionFormat },
    codex: capabilities.has("codex.appserver.v1")
  };
}
async function waitForCodexFrames(stream, signal) {
  if (signal?.aborted) throw new ClientModeError("RPC_ABORTED", "The Codex event poll was cancelled.");
  await new Promise((resolve3, reject) => {
    const previousWake = stream.wake;
    const timer = setTimeout(done, 25e3);
    const onAbort = () => {
      cleanup();
      reject(new ClientModeError("RPC_ABORTED", "The Codex event poll was cancelled."));
    };
    function cleanup() {
      clearTimeout(timer);
      stream.wake = previousWake;
      signal?.removeEventListener("abort", onAbort);
    }
    function done() {
      cleanup();
      resolve3();
    }
    stream.wake = () => {
      previousWake();
      done();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function isVersionAtLeast(value, minimum) {
  const match = value?.match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (match === void 0 || match === null) return false;
  const version = match.slice(1, 4).map((part) => Number(part));
  for (let index = 0; index < minimum.length; index += 1) {
    const part = version[index] ?? 0;
    const expected = minimum[index] ?? 0;
    if (part > expected) return true;
    if (part < expected) return false;
  }
  return true;
}
function diagnosticReason(error) {
  const code = "code" in error && typeof error.code === "string" ? error.code : void 0;
  const message = error.message.replace(/[\r\n\t]+/g, " ").slice(0, 240);
  return code === void 0 ? message : `${code}: ${message}`;
}
function preferredTransportsForAttempt(attempt) {
  if (attempt === "direct") return ["lan", "p2p", "relay"];
  if (attempt === "turn") return ["turn", "relay"];
  return ["relay"];
}
function transportPreferenceForMode(mode) {
  if (mode === "LAN") return "lan";
  if (mode === "P2P") return "p2p";
  if (mode === "TURN") return "turn";
  if (mode === "Relay") return "relay";
  return void 0;
}
function iceServersForAttempt(attempt, iceServers) {
  return attempt === "direct" ? stunOnlyIceServers(iceServers) : iceServers;
}

// src/control-runtime.ts
import { hostname as hostname2 } from "node:os";

// src/identity-store.ts
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile as readFile2, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname as dirname3, join as join3 } from "node:path";
var identitySchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  deviceId: external_exports.string().uuid(),
  name: external_exports.string().min(1).max(80),
  publicKey: external_exports.string().min(1)
}).strict();
var trustedPeerSchema = external_exports.object({
  deviceId: external_exports.string().min(1),
  name: external_exports.string().min(1).max(80),
  platform: external_exports.string().min(1).max(40),
  publicKey: external_exports.string().min(1),
  fingerprint: external_exports.string().min(1),
  trustedAt: external_exports.number().int().nonnegative(),
  membershipId: external_exports.string().min(1).optional()
}).strict();
var trustedPeersSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  peers: external_exports.array(trustedPeerSchema)
}).strict();
var IdentityInvalidError = class extends Error {
  code = "IDENTITY_INVALID";
};
var IdentityStore = class {
  directory;
  identity;
  peers = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    const env = options.env ?? process.env;
    const dshHome = env.DSH_HOME || join3(options.homeDirectory ?? homedir(), ".dsh");
    this.directory = options.directory ?? join3(dshHome, "remote");
  }
  async loadOrCreate(deviceName) {
    await mkdir(this.directory, { recursive: true, mode: 448 });
    await chmod(this.directory, 448);
    const devicePath = join3(this.directory, "device.json");
    const keyPath = join3(this.directory, "device.key");
    const [hasDevice, hasKey] = await Promise.all([exists(devicePath), exists(keyPath)]);
    if (hasDevice !== hasKey) {
      throw new IdentityInvalidError("device identity is incomplete; repair it explicitly before reconnecting");
    }
    if (!hasDevice) {
      const keys = generateKeyPair();
      const record6 = { schemaVersion: 1, deviceId: uuidV7(), name: deviceName, publicKey: keys.publicKey };
      await atomicJsonWrite(devicePath, record6, 384);
      await atomicTextWrite(keyPath, `${keys.privateKey}
`, 384);
    }
    await assertPrivateMode(keyPath);
    try {
      let record6 = identitySchema.parse(JSON.parse(await readFile2(devicePath, "utf8")));
      const privateKey = (await readFile2(keyPath, "utf8")).trim();
      const regenerated = generateKeyPair(fromBase64Url2(privateKey));
      if (regenerated.publicKey !== record6.publicKey) {
        throw new IdentityInvalidError("device public and private keys do not match");
      }
      if (record6.name !== deviceName) {
        record6 = { ...record6, name: deviceName };
        await atomicJsonWrite(devicePath, record6, 384);
      }
      this.identity = { ...record6, privateKey, fingerprint: fingerprint(record6.publicKey) };
      await this.loadPeers();
      return this.identity;
    } catch (error) {
      if (error instanceof IdentityInvalidError) throw error;
      throw new IdentityInvalidError(`device identity is invalid: ${safeErrorMessage(error)}`);
    }
  }
  current() {
    if (this.identity === void 0) throw new Error("identity store has not been loaded");
    return this.identity;
  }
  async reset(deviceName) {
    await rm(this.directory, { recursive: true, force: true });
    this.identity = void 0;
    this.peers.clear();
    return this.loadOrCreate(deviceName);
  }
  listTrustedPeers() {
    return [...this.peers.values()].map((peer) => ({ ...peer }));
  }
  trustedPeer(deviceId) {
    const peer = this.peers.get(deviceId);
    return peer === void 0 ? void 0 : { ...peer };
  }
  isTrusted(deviceId, publicKey) {
    return this.peers.get(deviceId)?.publicKey === publicKey;
  }
  async trustPeer(input2) {
    this.current();
    const peer = {
      ...input2,
      fingerprint: fingerprint(input2.publicKey),
      trustedAt: Date.now()
    };
    this.peers.set(peer.deviceId, peer);
    await this.savePeers();
    return { ...peer };
  }
  async revokePeer(deviceId) {
    const removed = this.peers.delete(deviceId);
    if (removed) await this.savePeers();
    return removed;
  }
  async loadPeers() {
    const path = join3(this.directory, "trusted-peers.json");
    if (!await exists(path)) {
      await atomicJsonWrite(path, { schemaVersion: 1, peers: [] }, 384);
    }
    const parsed = trustedPeersSchema.parse(JSON.parse(await readFile2(path, "utf8")));
    const peers = /* @__PURE__ */ new Map();
    for (const peer of parsed.peers) {
      if (peer.fingerprint !== fingerprint(peer.publicKey)) {
        throw new IdentityInvalidError(`trusted peer ${peer.deviceId} has an invalid fingerprint`);
      }
      if (peers.has(peer.deviceId)) throw new IdentityInvalidError(`trusted peer ${peer.deviceId} is duplicated`);
      peers.set(peer.deviceId, peer);
    }
    this.peers = peers;
  }
  async savePeers() {
    await atomicJsonWrite(join3(this.directory, "trusted-peers.json"), {
      schemaVersion: 1,
      peers: [...this.peers.values()]
    }, 384);
  }
};
function serverStorageDirectory(root, serverUrl, role) {
  const origin = new URL(serverUrl).origin;
  const scope = createHash("sha256").update(origin).digest("hex").slice(0, 24);
  return join3(root, "servers", scope, role);
}
function fingerprint(publicKey) {
  const compact = createHash("sha256").update(fromBase64Url2(publicKey)).digest("hex").slice(0, 12).toUpperCase();
  return compact.match(/.{1,4}/g).join(" ");
}
async function assertPrivateMode(path) {
  if (process.platform === "win32") return;
  const mode = (await stat(path)).mode & 511;
  if ((mode & 63) !== 0) {
    throw new IdentityInvalidError(`private key permissions must be 0600, got ${mode.toString(8).padStart(3, "0")}`);
  }
}
async function atomicJsonWrite(path, value, mode) {
  await atomicTextWrite(path, `${JSON.stringify(value, null, 2)}
`, mode);
}
async function atomicTextWrite(path, value, mode) {
  await mkdir(dirname3(path), { recursive: true, mode: 448 });
  const temporary = `${path}.${process.pid}.${uuidV7()}.tmp`;
  await writeFile(temporary, value, { encoding: "utf8", mode, flag: "wx" });
  await chmod(temporary, mode);
  await rename(temporary, path);
  await chmod(path, mode);
}
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}
function isNodeError(error) {
  return error instanceof Error && "code" in error;
}
function safeErrorMessage(error) {
  return error instanceof Error ? error.message : "invalid identity data";
}

// src/server-credentials.ts
import { chmod as chmod2, mkdir as mkdir2, readFile as readFile3, rename as rename2, rm as rm2, stat as stat2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname4, join as join4 } from "node:path";
var credentialSchema = external_exports.object({
  schemaVersion: external_exports.literal(1),
  serverUrl: external_exports.string().url(),
  deviceId: external_exports.string().min(1),
  authorizationMethod: external_exports.enum(["account", "host_registration_code", "owned_device"]),
  account: external_exports.string().min(1).max(254).optional(),
  accessToken: external_exports.string().min(16),
  accessTokenExpiresAt: external_exports.number().int().positive(),
  refreshToken: external_exports.string().min(16),
  refreshTokenExpiresAt: external_exports.number().int().positive()
}).strict();
var ServerCredentialStore = class {
  path;
  constructor(directory) {
    this.path = join4(directory, "server-credentials.json");
  }
  async load(serverUrl, deviceId) {
    if (!await exists2(this.path)) return void 0;
    await assertPrivateMode2(this.path);
    let parsed;
    try {
      parsed = credentialSchema.parse(JSON.parse(await readFile3(this.path, "utf8")));
    } catch (error) {
      throw new ServerCredentialsInvalidError(`server credentials are invalid: ${safeMessage(error)}`);
    }
    return parsed.serverUrl === serverUrl && parsed.deviceId === deviceId ? parsed : void 0;
  }
  async save(credentials) {
    const record6 = credentialSchema.parse({ schemaVersion: 1, ...credentials });
    await atomicWrite(this.path, `${JSON.stringify(record6, null, 2)}
`);
    return record6;
  }
  async clear() {
    await rm2(this.path, { force: true });
  }
};
var ServerCredentialsInvalidError = class extends Error {
  code = "SERVER_CREDENTIALS_INVALID";
};
async function atomicWrite(path, contents) {
  await mkdir2(dirname4(path), { recursive: true, mode: 448 });
  const temporary = `${path}.${process.pid}.${uuidV7()}.tmp`;
  await writeFile2(temporary, contents, { encoding: "utf8", mode: 384, flag: "wx" });
  await chmod2(temporary, 384);
  await rename2(temporary, path);
  await chmod2(path, 384);
}
async function assertPrivateMode2(path) {
  if (process.platform === "win32") return;
  const mode = (await stat2(path)).mode & 511;
  if ((mode & 63) !== 0) throw new ServerCredentialsInvalidError("server credentials permissions must be 0600");
}
async function exists2(path) {
  try {
    await stat2(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
function safeMessage(error) {
  return error instanceof Error ? error.message : "invalid credential data";
}

// src/control-runtime.ts
var PluginControlRuntime = class {
  constructor(config, identityDirectory, settings, client, host) {
    this.config = config;
    this.identityDirectory = identityDirectory;
    this.settings = settings;
    this.client = client;
    this.host = host;
  }
  register(connection) {
    return connection.rpc.handle(CONTROL_RPC_PREFIX, (endpoint, payload, signal) => this.handle(endpoint, payload, signal), {
      authority: "loopback"
    });
  }
  async handle(endpoint, payload, signal) {
    try {
      if (endpoint === "settings.get") return ok3(await this.settingsView());
      if (endpoint === "settings.configure") return ok3(await this.configure(payload));
      if (endpoint === "settings.server.set") return ok3(await this.setServer(payload));
      if (endpoint === "settings.role.set") return ok3(await this.setRole(payload));
      if (endpoint === "settings.codex.set") return ok3(await this.setCodex(payload));
      if (endpoint === "settings.logout") return ok3(await this.logout());
      if (endpoint === "host.reconnect") {
        if (this.host === void 0) throw new ClientModeError("METHOD_NOT_ALLOWED", "This plugin is not running as a Host.");
        this.host.reconnectHost();
        return ok3(this.hostOnlyStatus());
      }
      if (this.client !== void 0) return this.client.handleControl(endpoint, payload, signal);
      if (endpoint === "status") return ok3(this.hostOnlyStatus());
      if (endpoint === "devices") return ok3([]);
      if (endpoint === "host.account.login") {
        if (this.host === void 0) throw new ClientModeError("METHOD_NOT_ALLOWED", "This plugin is not running as a Host.");
        const value = record4(payload);
        if (typeof value.email !== "string" || typeof value.password !== "string") {
          throw new ClientModeError("INVALID_MESSAGE", "Email and password are required.");
        }
        return ok3(await this.host.authorizeHostWithAccount(value.email, value.password));
      }
      if (endpoint === "host.registration-code.submit") {
        if (this.host === void 0) throw new ClientModeError("METHOD_NOT_ALLOWED", "This plugin is not running as a Host.");
        const value = record4(payload);
        if (typeof value.code !== "string" || value.code.trim() === "") {
          throw new ClientModeError("INVALID_MESSAGE", "A Host registration code is required.");
        }
        return ok3(await this.host.authorizeHostWithCode(value.code));
      }
      if (endpoint === "mode.set" && record4(payload).mode === "local") return ok3(this.hostOnlyStatus());
      throw new ClientModeError("METHOD_NOT_ALLOWED", "Remote Client mode is disabled by the plugin role.");
    } catch (error) {
      return fail3(error);
    }
  }
  async configure(payload) {
    if (this.settings === void 0) {
      throw new ClientModeError("SETTINGS_UNAVAILABLE", "DSH user settings are unavailable in this profile.");
    }
    const value = record4(payload);
    if (value.role !== "host" && value.role !== "client") {
      throw new ClientModeError("INVALID_MESSAGE", "Role must be Host or Client.");
    }
    if (typeof value.serverUrl !== "string") {
      throw new ClientModeError("INVALID_MESSAGE", "Server URL is required.");
    }
    const current = editableConfig(resolveConfig(this.settings.get()));
    const next = resolveConfig({ ...current, role: value.role, serverUrl: value.serverUrl });
    const identities = new IdentityStore({
      directory: serverStorageDirectory(this.identityDirectory, next.serverUrl, value.role)
    });
    const identity = await identities.loadOrCreate(hostname2());
    const api = value.role === "host" ? new HostServerApi(next.serverUrl, new ServerCredentialStore(identities.directory)) : new ClientServerApi(next.serverUrl, new ServerCredentialStore(identities.directory));
    let authorization;
    if (value.role === "host" && typeof value.registrationCode === "string" && value.registrationCode.trim() !== "") {
      authorization = await api.authorizeHostWithCode(identity, value.registrationCode);
    } else {
      if (typeof value.email !== "string" || typeof value.password !== "string") {
        throw new ClientModeError("INVALID_MESSAGE", "Email and password are required for account authorization.");
      }
      authorization = await api.authorizeWithAccount(identity, value.email, value.password);
    }
    await this.settings.replace(editableConfig(next));
    return {
      status: "authorized",
      role: value.role,
      ...authorization.account === void 0 ? {} : { account: authorization.account },
      settings: await this.settingsView()
    };
  }
  async setServer(payload) {
    if (this.settings === void 0) {
      throw new ClientModeError("SETTINGS_UNAVAILABLE", "DSH user settings are unavailable in this profile.");
    }
    const value = record4(payload);
    if (typeof value.serverUrl !== "string") {
      throw new ClientModeError("INVALID_MESSAGE", "Server URL is required.");
    }
    const current = editableConfig(resolveConfig(this.settings.get()));
    const next = resolveConfig({ ...current, serverUrl: value.serverUrl });
    await this.settings.replace(editableConfig(next));
    return this.settingsView();
  }
  async setRole(payload) {
    if (this.settings === void 0) {
      throw new ClientModeError("SETTINGS_UNAVAILABLE", "DSH user settings are unavailable in this profile.");
    }
    const role = record4(payload).role;
    if (role !== "host" && role !== "client") {
      throw new ClientModeError("INVALID_MESSAGE", "Role must be Host or Client.");
    }
    const current = editableConfig(resolveConfig(this.settings.get()));
    const currentRole = current.role === "client" ? "client" : "host";
    if (role !== currentRole && current.serverUrl !== void 0 && await this.association(current.serverUrl, role) === void 0) {
      await this.authorizeOwnedRole(current.serverUrl, currentRole, role);
    }
    await this.settings.replace({ ...current, role });
    return this.settingsView();
  }
  async setCodex(payload) {
    if (this.settings === void 0) {
      throw new ClientModeError("SETTINGS_UNAVAILABLE", "DSH user settings are unavailable in this profile.");
    }
    const enabled = record4(payload).enabled;
    if (typeof enabled !== "boolean") {
      throw new ClientModeError("INVALID_MESSAGE", "Codex Remote enabled must be a boolean.");
    }
    const current = editableConfig(resolveConfig(this.settings.get()));
    const next = resolveConfig({
      ...current,
      codex: { ...current.codex, enabled }
    });
    await this.settings.replace(editableConfig(next));
    return this.settingsView();
  }
  async authorizeOwnedRole(serverUrl, sourceRole, targetRole) {
    const sourceDirectory = serverStorageDirectory(this.identityDirectory, serverUrl, sourceRole);
    const sourceIdentity = await new IdentityStore({ directory: sourceDirectory }).loadOrCreate(hostname2());
    const sourceStore = new ServerCredentialStore(sourceDirectory);
    if (await sourceStore.load(serverUrl, sourceIdentity.deviceId) === void 0) return;
    const sourceApi = sourceRole === "host" ? new HostServerApi(serverUrl, sourceStore) : new ClientServerApi(serverUrl, sourceStore);
    const sourceCredentials = await sourceApi.authenticate(sourceIdentity);
    const targetDirectory = serverStorageDirectory(this.identityDirectory, serverUrl, targetRole);
    const targetIdentity = await new IdentityStore({ directory: targetDirectory }).loadOrCreate(hostname2());
    const targetApi = targetRole === "host" ? new HostServerApi(serverUrl, new ServerCredentialStore(targetDirectory)) : new ClientServerApi(serverUrl, new ServerCredentialStore(targetDirectory));
    await targetApi.authorizeOwnedRole(targetIdentity, sourceCredentials.accessToken, sourceCredentials.account);
  }
  async logout() {
    if (this.settings === void 0) {
      throw new ClientModeError("SETTINGS_UNAVAILABLE", "DSH user settings are unavailable in this profile.");
    }
    const config = resolveConfig(this.settings.get());
    if (config.serverUrl !== void 0) {
      await Promise.all([
        this.client?.clearClientAuthorization(),
        this.host?.clearHostAuthorization()
      ]);
      await Promise.all(["host", "client"].map(async (role) => {
        const directory = serverStorageDirectory(this.identityDirectory, config.serverUrl, role);
        await new ServerCredentialStore(directory).clear();
      }));
    }
    return this.settingsView();
  }
  async settingsView() {
    const config = this.settings === void 0 ? editableConfig(this.config) : editableConfig(resolveConfig(this.settings.get()));
    const associations = await this.associations(config);
    const role = config.role === "client" ? "client" : "host";
    const association = associations[role];
    return {
      config,
      deviceName: hostname2(),
      writable: this.settings !== void 0,
      applies: "restart",
      associations,
      ...association === void 0 ? {} : { association }
    };
  }
  async associations(config) {
    if (config.serverUrl === void 0) return {};
    const [host, client] = await Promise.all([
      this.association(config.serverUrl, "host"),
      this.association(config.serverUrl, "client")
    ]);
    return {
      ...host === void 0 ? {} : { host },
      ...client === void 0 ? {} : { client }
    };
  }
  async association(serverUrl, role) {
    const identities = new IdentityStore({
      directory: serverStorageDirectory(this.identityDirectory, serverUrl, role)
    });
    const identity = await identities.loadOrCreate(hostname2());
    const credentials = await new ServerCredentialStore(identities.directory).load(serverUrl, identity.deviceId);
    if (credentials === void 0) return void 0;
    return {
      method: credentials.authorizationMethod,
      ...credentials.account === void 0 ? {} : { account: credentials.account }
    };
  }
  hostOnlyStatus() {
    return {
      mode: "local",
      available: false,
      deviceName: hostname2(),
      hostAuthorizationAvailable: this.host !== void 0,
      ...this.host === void 0 ? {} : { host: this.host.hostStatus() }
    };
  }
};
function editableConfig(config) {
  return {
    enabled: config.enabled,
    role: config.role,
    ...config.serverUrl === void 0 ? {} : { serverUrl: config.serverUrl },
    forceRelay: config.forceRelay,
    logLevel: config.logLevel,
    reconnect: config.reconnect.enabled ? {
      initialDelayMs: config.reconnect.initialDelayMs,
      maxDelayMs: config.reconnect.maxDelayMs,
      jitter: config.reconnect.jitter
    } : false,
    codex: {
      enabled: config.codex.enabled,
      binary: config.codex.binary
    }
  };
}
function isRecord7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record4(value) {
  if (!isRecord7(value)) throw new ClientModeError("INVALID_MESSAGE", "The control request payload is invalid.");
  return value;
}
function ok3(value) {
  return { ok: true, value };
}
function fail3(error) {
  const source = error instanceof Error ? error : void 0;
  const remoteCode = source !== void 0 && "code" in source && typeof source.code === "string" ? source.code : source instanceof ClientModeError ? source.code : void 0;
  return {
    ok: false,
    error: {
      code: "internal",
      message: source?.message ?? "The plugin control operation failed.",
      details: remoteCode === void 0 ? {} : { remoteCode }
    }
  };
}

// src/logging.ts
var levels = ["debug", "info", "warn", "error"];
var secretKey = /authorization|cookie|token|secret|private|shared|ciphertext|payload|prompt|source|workspace|output|registrationCode|deviceCode/i;
var SafeLogger = class {
  constructor(sink, threshold = "info") {
    this.sink = sink;
    this.threshold = threshold;
  }
  debug(message, fields) {
    this.write("debug", message, fields);
  }
  info(message, fields) {
    this.write("info", message, fields);
  }
  warn(message, fields) {
    this.write("warn", message, fields);
  }
  error(message, fields) {
    this.write("error", message, fields);
  }
  write(level, message, fields) {
    if (levels.indexOf(level) < levels.indexOf(this.threshold)) return;
    const safeFields = fields === void 0 ? "" : ` ${JSON.stringify(redact(fields))}`;
    this.sink[level](`[dsh-remote] ${message}${safeFields}`);
  }
};
function redact(value, key = "") {
  if (secretKey.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
}

// src/service.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// src/connection-controller.ts
var ConnectionController = class {
  constructor(identities, createRouter, logger) {
    this.identities = identities;
    this.createRouter = createRouter;
    this.logger = logger;
  }
  active = /* @__PURE__ */ new Map();
  acceptQueue = Promise.resolve();
  accept(channel) {
    const operation = this.acceptQueue.then(() => this.acceptOne(channel));
    this.acceptQueue = operation.catch(() => void 0);
    return operation;
  }
  async acceptOne(channel) {
    if (channel.security?.protocol !== "Noise_IK_25519_ChaChaPoly_SHA256" || channel.security.connectionId === "" || channel.security.membershipId === "") {
      await channel.close("SECURE_CHANNEL_FAILED");
      throw new ConnectionRejectedError("SECURE_CHANNEL_FAILED", "The channel is missing its authenticated Noise or membership context.");
    }
    if (!this.identities.isTrusted(channel.peerDeviceId, channel.peerIdentityKey)) {
      await channel.close("PEER_IDENTITY_MISMATCH");
      throw new ConnectionRejectedError("PEER_IDENTITY_MISMATCH", "The peer identity does not match local trust.");
    }
    const connectionId = channel.security.connectionId;
    const connectionConflict = this.active.get(connectionId);
    if (connectionConflict !== void 0 && connectionConflict.channel.peerDeviceId !== channel.peerDeviceId) {
      await channel.close("SECURE_CHANNEL_FAILED");
      throw new ConnectionRejectedError("SECURE_CHANNEL_FAILED", "The connection id is already bound to another peer.");
    }
    const replaced = [...this.active.values()].filter((connection2) => connection2.channel.peerDeviceId === channel.peerDeviceId || connection2.channel.security.connectionId === connectionId);
    if (replaced.length > 0) {
      this.logger?.warn("replacing active peer connection", {
        peerDeviceId: shortId2(channel.peerDeviceId),
        replacedCount: replaced.length,
        replacedPeerDeviceIds: replaced.map((connection2) => shortId2(connection2.channel.peerDeviceId))
      });
    }
    await Promise.all(replaced.map((connection2) => this.disconnect(connection2, "CONNECTION_REPLACED")));
    const router = this.createRouter(
      { connectionId, peerDeviceId: channel.peerDeviceId },
      (message) => this.sendTo(connectionId, channel, message)
    );
    const connection = {
      channel,
      router,
      unsubscribe: () => void 0
    };
    this.active.set(connectionId, connection);
    try {
      connection.unsubscribe = channel.onMessage((message) => {
        void this.handle(connection, message);
      });
    } catch (error) {
      await this.disconnect(connection);
      throw error;
    }
    this.logger?.info("peer connection accepted", {
      peerDeviceId: shortId2(channel.peerDeviceId),
      connectionId: shortId2(connectionId),
      mode: channel.mode
    });
  }
  isOnline() {
    return this.active.size > 0;
  }
  connectionCount() {
    return this.active.size;
  }
  peerDeviceIds() {
    return [...new Set([...this.active.values()].map((connection) => connection.channel.peerDeviceId))];
  }
  peerDeviceId() {
    const peers = this.peerDeviceIds();
    return peers.length === 1 ? peers[0] : void 0;
  }
  connectionMode() {
    const connection = this.active.values().next().value;
    return connection?.channel.mode ?? (connection === void 0 ? "Disconnected" : "Relay");
  }
  async send(message) {
    await Promise.all([...this.active.values()].map((connection) => this.sendConnection(connection, message)));
  }
  async revoke(deviceId) {
    const revoked = [...this.active.values()].filter((connection) => connection.channel.peerDeviceId === deviceId);
    await Promise.all(revoked.map((connection) => this.disconnect(connection, "DEVICE_REVOKED")));
  }
  async closeConnection(connectionId, code) {
    const connection = this.active.get(connectionId);
    if (connection === void 0) return false;
    await this.disconnect(connection, code);
    return true;
  }
  async close() {
    await this.acceptQueue;
    await Promise.all([...this.active.values()].map((connection) => this.disconnect(connection)));
  }
  async handle(connection, message) {
    if (!this.isActive(connection)) return;
    try {
      const response = await connection.router.handle(message);
      if (!this.isActive(connection)) return;
      const outbound = encodeMessage(response).byteLength <= MAX_SECURE_MESSAGE_BYTES ? response : createRpcError(
        message.id,
        "RESPONSE_TOO_LARGE",
        "The Host response is too large for the secure Remote channel. Request a smaller page.",
        { maxBytes: MAX_SECURE_MESSAGE_BYTES },
        true
      );
      await connection.channel.send(outbound);
    } catch (error) {
      this.logger?.warn("peer message handling failed; disconnecting", {
        peerDeviceId: shortId2(connection.channel.peerDeviceId),
        reason: diagnosticReason2(error)
      });
      await this.disconnect(connection);
    }
  }
  async sendTo(connectionId, channel, message) {
    const connection = this.active.get(connectionId);
    if (connection === void 0 || connection.channel !== channel) return;
    await this.sendConnection(connection, message);
  }
  async sendConnection(connection, message) {
    if (!this.isActive(connection)) return;
    try {
      await connection.channel.send(message);
    } catch (error) {
      this.logger?.warn("peer send failed; disconnecting", {
        peerDeviceId: shortId2(connection.channel.peerDeviceId),
        messageType: message.type,
        reason: diagnosticReason2(error)
      });
      await this.disconnect(connection);
    }
  }
  async disconnect(connection, code) {
    if (!this.isActive(connection)) return;
    this.active.delete(connection.channel.security.connectionId);
    connection.unsubscribe();
    try {
      await connection.router.closePeerStreams();
    } finally {
      await connection.channel.close(code);
    }
    this.logger?.info("peer connection disconnected", {
      peerDeviceId: shortId2(connection.channel.peerDeviceId),
      connectionId: shortId2(connection.channel.security.connectionId),
      code: code ?? "closed"
    });
  }
  isActive(connection) {
    return this.active.get(connection.channel.security.connectionId) === connection;
  }
};
var ConnectionRejectedError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function diagnosticReason2(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 160) || "Unknown peer connection failure.";
}
function shortId2(value) {
  return value.length <= 12 ? value : `${value.slice(0, 8)}\u2026${value.slice(-4)}`;
}

// src/safe-error.ts
var RpcError = class extends Error {
  constructor(code, message, details, retryable = false) {
    super(message);
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
};
function safeErrorCode(error) {
  if (error instanceof RpcError) return error.code;
  if (error instanceof external_exports.ZodError) return "INVALID_MESSAGE";
  return "INTERNAL_ERROR";
}

// src/rpc-router.ts
var wireRequestSchema = external_exports.object({ method: external_exports.string().min(1), params: external_exports.unknown() }).strict();
var emptyParamsSchema = external_exports.object({}).strict();
var apiMethods = /* @__PURE__ */ new Set([
  "harness.transport.describe",
  "harness.api.call",
  "harness.api.transfer.open",
  "harness.api.transfer.chunk",
  "harness.api.transfer.commit",
  "harness.api.transfer.read",
  "harness.api.transfer.close",
  "harness.api.respond",
  "harness.api.stream.open",
  "harness.api.stream.close",
  "harness.remote.call",
  "harness.remote.transfer.open",
  "harness.remote.transfer.chunk",
  "harness.remote.transfer.commit",
  "harness.remote.transfer.read",
  "harness.remote.transfer.close",
  "harness.remote.stream.open",
  "harness.remote.stream.close",
  "fileviewer.call",
  "codex.app.call",
  "codex.app.respond",
  "codex.app.stream.open",
  "codex.app.stream.close",
  "codex.app.transfer.open",
  "codex.app.transfer.chunk",
  "codex.app.transfer.commit",
  "codex.app.transfer.read",
  "codex.app.transfer.close"
]);
var HOST_CAPABILITIES = [
  "harness.api.v1",
  "harness.api.transfer.v1",
  "harness.remote.v1",
  "harness.remote.transfer.v1",
  "fileviewer.read.v1",
  "codex.appserver.v1",
  "codex.appserver.transfer.v1"
];
var RpcRouter = class {
  constructor(harnessApi, maxPending = 128, logger, fileViewer, harnessRemote, capabilities = () => HOST_CAPABILITIES, codex) {
    this.harnessApi = harnessApi;
    this.maxPending = maxPending;
    this.logger = logger;
    this.fileViewer = fileViewer;
    this.harnessRemote = harnessRemote;
    this.capabilities = capabilities;
    this.codex = codex;
  }
  active = 0;
  async closePeerStreams() {
    await Promise.all([
      this.harnessApi?.closeAll(),
      this.harnessRemote?.closeAll(),
      this.codex?.closeAll()
    ]);
  }
  async handle(message) {
    if (message.type !== "rpc.request") {
      return createRpcError(message.id, "INVALID_MESSAGE", "Only RPC requests are accepted on the Host business channel.");
    }
    const parsedPayload = wireRequestSchema.safeParse(message.payload);
    if (!parsedPayload.success) return createRpcError(message.id, "INVALID_MESSAGE", "The RPC request payload is invalid.");
    if (!apiMethods.has(parsedPayload.data.method)) {
      return createRpcError(message.id, "METHOD_NOT_FOUND", "The requested method does not exist.");
    }
    const request = message;
    if (this.active >= this.maxPending) {
      return createRpcError(request.id, "RATE_LIMITED", "Too many Host requests are already pending.", void 0, true);
    }
    this.active += 1;
    const startedAt = performance.now();
    try {
      const result = await this.invoke(request.payload.method, request.payload.params);
      this.logger?.debug("host rpc ok", {
        method: request.payload.method,
        durationMs: Math.round(performance.now() - startedAt)
      });
      return createRpcResponse(request.id, result);
    } catch (error) {
      const response = errorResponse(request.id, error);
      this.logger?.warn("host rpc failed", {
        method: request.payload.method,
        durationMs: Math.round(performance.now() - startedAt),
        code: response.payload.code,
        retryable: response.payload.retryable
      });
      return response;
    } finally {
      this.active -= 1;
    }
  }
  invoke(method, params) {
    switch (method) {
      case "harness.transport.describe": {
        emptyParamsSchema.parse(params);
        return { capabilities: [...this.capabilities()] };
      }
      case "harness.api.call":
        return this.requireApiProxy().call(params);
      case "harness.api.transfer.open":
        return this.requireApiProxy().openTransfer(params);
      case "harness.api.transfer.chunk":
        return this.requireApiProxy().appendTransfer(params);
      case "harness.api.transfer.commit":
        return this.requireApiProxy().commitTransfer(params);
      case "harness.api.transfer.read":
        return this.requireApiProxy().readTransfer(params);
      case "harness.api.transfer.close":
        return this.requireApiProxy().closeTransfer(params);
      case "harness.api.respond":
        return this.requireApiProxy().respond(params);
      case "harness.api.stream.open":
        return this.requireApiProxy().openStream(params);
      case "harness.api.stream.close":
        return this.requireApiProxy().closeStream(params);
      case "harness.remote.call":
        return this.requireRemoteGateway().call(params);
      case "harness.remote.transfer.open":
        return this.requireRemoteGateway().openTransfer(params);
      case "harness.remote.transfer.chunk":
        return this.requireRemoteGateway().appendTransfer(params);
      case "harness.remote.transfer.commit":
        return this.requireRemoteGateway().commitTransfer(params);
      case "harness.remote.transfer.read":
        return this.requireRemoteGateway().readTransfer(params);
      case "harness.remote.transfer.close":
        return this.requireRemoteGateway().closeTransfer(params);
      case "harness.remote.stream.open":
        return this.requireRemoteGateway().openStream(params);
      case "harness.remote.stream.close":
        return this.requireRemoteGateway().closeStream(params);
      case "fileviewer.call": {
        if (this.fileViewer === void 0) {
          throw new RpcError("FILE_VIEWER_UNAVAILABLE", "The Remote Host does not have DSH File Viewer available.");
        }
        return this.fileViewer.call(params);
      }
      case "codex.app.call":
        return this.requireCodex().call(params);
      case "codex.app.respond":
        return this.requireCodex().respond(params);
      case "codex.app.stream.open":
        return this.requireCodex().openStream(params);
      case "codex.app.stream.close":
        return this.requireCodex().closeStream(params);
      case "codex.app.transfer.open":
        return this.requireCodex().openTransfer(params);
      case "codex.app.transfer.chunk":
        return this.requireCodex().appendTransfer(params);
      case "codex.app.transfer.commit":
        return this.requireCodex().commitTransfer(params);
      case "codex.app.transfer.read":
        return this.requireCodex().readTransfer(params);
      case "codex.app.transfer.close":
        return this.requireCodex().closeTransfer(params);
      default:
        throw new RpcError("METHOD_NOT_FOUND", "The requested method does not exist.");
    }
  }
  requireApiProxy() {
    if (this.harnessApi === void 0) {
      throw new RpcError("FEATURE_NOT_SUPPORTED", "This Harness version does not provide the legacy ApiProxy transport.");
    }
    return this.harnessApi;
  }
  requireRemoteGateway() {
    if (this.harnessRemote === void 0) {
      throw new RpcError("FEATURE_NOT_SUPPORTED", "This Harness version does not provide the Remote Gateway transport.");
    }
    return this.harnessRemote;
  }
  requireCodex() {
    if (this.codex === void 0) {
      throw new RpcError("FEATURE_NOT_SUPPORTED", "Codex Remote is disabled or unavailable on this Host.");
    }
    return this.codex;
  }
};
function errorResponse(requestId, error) {
  const code = safeErrorCode(error);
  if (error instanceof RpcError) return createRpcError(requestId, code, error.message, error.details, error.retryable);
  return createRpcError(
    requestId,
    code,
    code === "INVALID_MESSAGE" ? "The RPC parameters are invalid." : "The Host could not complete the request."
  );
}

// src/file-viewer-contract.ts
var REMOTE_FILE_CHUNK_BYTES = 512 * 1024;
var MAX_REMOTE_FILE_LOCATOR_CHARS = 4096;
var MAX_REMOTE_DIRECTORY_ENTRIES = 1e3;

// src/file-viewer-bridge.ts
var locatorSchema = external_exports.string().min(1).max(MAX_REMOTE_FILE_LOCATOR_CHARS);
var callSchema = external_exports.discriminatedUnion("endpoint", [
  external_exports.object({
    endpoint: external_exports.literal("stat"),
    payload: external_exports.object({ path: locatorSchema }).strict()
  }).strict(),
  external_exports.object({
    endpoint: external_exports.literal("readRange"),
    payload: external_exports.object({
      path: locatorSchema,
      offset: external_exports.number().int().nonnegative().safe(),
      length: external_exports.number().int().positive().max(REMOTE_FILE_CHUNK_BYTES)
    }).strict()
  }).strict(),
  external_exports.object({
    endpoint: external_exports.literal("list"),
    payload: external_exports.object({ path: locatorSchema }).strict()
  }).strict()
]);
var statResultSchema = external_exports.object({
  path: locatorSchema,
  name: external_exports.string().min(1).max(1024),
  ext: external_exports.string().max(128),
  mime: external_exports.string().min(1).max(256),
  size: external_exports.number().int().nonnegative().safe(),
  mtimeMs: external_exports.number().nonnegative().optional(),
  isDirectory: external_exports.boolean(),
  exists: external_exports.boolean()
}).strict();
var rangeResultSchema = external_exports.object({
  data: external_exports.string().max(Math.ceil(REMOTE_FILE_CHUNK_BYTES / 3) * 4 + 4),
  offset: external_exports.number().int().nonnegative().safe(),
  size: external_exports.number().int().nonnegative().safe(),
  eof: external_exports.boolean()
}).strict();
var directoryEntrySchema = external_exports.object({
  name: external_exports.string().min(1).max(1024),
  path: locatorSchema,
  isDirectory: external_exports.boolean(),
  size: external_exports.number().int().nonnegative().safe().optional(),
  mtimeMs: external_exports.number().nonnegative().optional()
}).strict();
var listResultSchema = external_exports.object({
  path: locatorSchema,
  entries: external_exports.array(directoryEntrySchema).max(MAX_REMOTE_DIRECTORY_ENTRIES)
}).strict();
var RemoteFileViewerBridge = class {
  constructor(service, logger) {
    this.service = service;
    this.logger = logger;
  }
  async call(input2) {
    const params = callSchema.parse(input2);
    const service = this.service();
    if (service === void 0) {
      throw new RpcError("FILE_VIEWER_UNAVAILABLE", "The Remote Host does not have DSH File Viewer available.");
    }
    const startedAt = performance.now();
    const signal = AbortSignal.timeout(3e4);
    let raw;
    try {
      raw = await service.handle(params.endpoint, params.payload, signal);
    } catch {
      this.logger?.warn("remote file viewer service failed", { endpoint: params.endpoint });
      throw new RpcError("FILE_VIEWER_ERROR", "The Remote File Viewer could not complete the request.");
    }
    const result = parseHostResult(raw);
    if (!result.ok) throw hostFailure(result);
    try {
      const value = params.endpoint === "stat" ? statResultSchema.parse(result.value) : params.endpoint === "readRange" ? rangeResultSchema.parse(result.value) : listResultSchema.parse(result.value);
      this.logger?.debug("remote file viewer call ok", {
        endpoint: params.endpoint,
        durationMs: Math.round(performance.now() - startedAt)
      });
      return value;
    } catch (error) {
      if (error instanceof external_exports.ZodError && params.endpoint === "list" && isOversizedListing(result.value)) {
        throw new RpcError(
          "RESPONSE_TOO_LARGE",
          `The remote directory contains more than ${MAX_REMOTE_DIRECTORY_ENTRIES} entries.`,
          { maxEntries: MAX_REMOTE_DIRECTORY_ENTRIES },
          true
        );
      }
      throw error;
    }
  }
};
function parseHostResult(input2) {
  if (typeof input2 !== "object" || input2 === null || !("ok" in input2) || typeof input2.ok !== "boolean") {
    throw new RpcError("FILE_VIEWER_INVALID_RESPONSE", "The Remote Host File Viewer returned an invalid response.");
  }
  return input2;
}
function hostFailure(result) {
  const message = result.error?.message ?? "";
  if (/access denied/i.test(message)) {
    return new RpcError("ACCESS_DENIED", "The Remote File Viewer denied access to this locator.");
  }
  if (/does not exist|not exist|not found/i.test(message)) {
    return new RpcError("NOT_FOUND", "The requested remote file does not exist.");
  }
  if (result.error?.code === "cancelled") {
    return new RpcError("CANCELLED", "The Remote File Viewer request was cancelled.", void 0, true);
  }
  if (result.error?.code === "bad-request") {
    return new RpcError("INVALID_MESSAGE", "The Remote File Viewer request is invalid.");
  }
  return new RpcError("FILE_VIEWER_ERROR", "The Remote File Viewer could not complete the request.");
}
function isOversizedListing(value) {
  return typeof value === "object" && value !== null && "entries" in value && Array.isArray(value.entries) && value.entries.length > MAX_REMOTE_DIRECTORY_ENTRIES;
}

// src/server-connection.ts
var DEFAULT_WEBRTC_NEGOTIATE_TIMEOUT_MS = 12e3;
var HostServerConnection = class {
  constructor(config, identity, identities, api, connections, logger, createWebSocket = (url) => new WebSocket(url), rtcFactoryProvider, hostCapabilities = () => ["harness.api.v1"], harnessVersion) {
    this.config = config;
    this.identity = identity;
    this.identities = identities;
    this.api = api;
    this.connections = connections;
    this.logger = logger;
    this.createWebSocket = createWebSocket;
    this.rtcFactoryProvider = rtcFactoryProvider;
    this.hostCapabilities = hostCapabilities;
    this.harnessVersion = harnessVersion;
  }
  socket;
  running;
  stopped = true;
  online = false;
  retryWake;
  tunnels = /* @__PURE__ */ new Map();
  terminalError;
  lastActiveAt;
  reconnectRequested = false;
  resumeQueued = false;
  rtcFactory;
  negotiatedCapabilities = ["transport.relay"];
  controlFrameLimits = {};
  start() {
    if (this.running !== void 0) return;
    this.stopped = false;
    this.running = this.run().finally(() => {
      this.running = void 0;
    });
  }
  resume() {
    this.terminalError = void 0;
    this.stopped = false;
    if (this.running === void 0) {
      this.start();
      return;
    }
    if (this.resumeQueued) return;
    this.resumeQueued = true;
    void this.running.finally(() => {
      this.resumeQueued = false;
      if (!this.stopped) this.start();
    });
  }
  async stop() {
    this.stopped = true;
    this.reconnectRequested = false;
    this.retryWake?.();
    this.retryWake = void 0;
    this.socket?.close(1e3, "plugin stopped");
    await this.running;
    await this.dropTunnels();
  }
  isOnline() {
    return this.online;
  }
  lastError() {
    return this.terminalError;
  }
  lastActivity() {
    return this.lastActiveAt;
  }
  isReconnecting() {
    return !this.online && !this.stopped && this.running !== void 0;
  }
  reconnect() {
    this.terminalError = void 0;
    this.stopped = false;
    if (this.running === void 0) {
      this.start();
      return;
    }
    this.reconnectRequested = true;
    this.retryWake?.();
    this.socket?.close(4e3, "manual reconnect");
    void this.running.finally(() => {
      if (!this.reconnectRequested || this.stopped) return;
      this.reconnectRequested = false;
      this.start();
    });
  }
  async run() {
    let delayMs = this.config.reconnect.initialDelayMs;
    while (!this.stopped) {
      try {
        await this.connectOnce();
        delayMs = this.config.reconnect.initialDelayMs;
      } catch (error) {
        const code = errorCode2(error);
        this.terminalError = code;
        this.logger.warn("server control connection failed", { code, retryable: isRetryable(error) });
        if (TERMINAL_AUTH_ERRORS.has(code) || !this.config.reconnect.enabled) return;
      }
      if (this.stopped) return;
      if (this.reconnectRequested) {
        this.reconnectRequested = false;
        delayMs = this.config.reconnect.initialDelayMs;
        continue;
      }
      if (!this.config.reconnect.enabled) return;
      await this.waitBeforeRetry(delayMs);
      if (this.reconnectRequested) {
        this.reconnectRequested = false;
        delayMs = this.config.reconnect.initialDelayMs;
        continue;
      }
      delayMs = Math.min(this.config.reconnect.maxDelayMs, delayMs * 2);
    }
  }
  async connectOnce() {
    const credentials = await this.api.authenticate(this.identity);
    if (this.stopped) return;
    const offeredCapabilities = this.rtcFactoryProvider === void 0 || this.config.forceRelay ? ["transport.relay", ...this.hostCapabilities()] : ["transport.lan", "transport.p2p", "transport.turn", "transport.relay", ...this.hostCapabilities()];
    const socket = this.createWebSocket(websocketUrl2(this.api.baseUrl));
    this.socket = socket;
    this.controlFrameLimits = {};
    let acknowledged = false;
    let messageQueue = Promise.resolve();
    await new Promise((resolve3, reject) => {
      let settled = false;
      const helloTimer = setTimeout(() => socket.close(4001, "hello timeout"), 1e4);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(helloTimer);
        this.online = false;
        if (this.socket === socket) this.socket = void 0;
        void this.dropTunnels().finally(() => error === void 0 ? resolve3() : reject(error));
      };
      socket.onopen = () => {
        this.sendControl("hello", {
          role: "host",
          deviceId: this.identity.deviceId,
          accessToken: credentials.accessToken,
          protocols: [PROTOCOL_VERSION],
          clientVersion: PLUGIN_VERSION,
          ...this.harnessVersion === void 0 ? {} : { harnessVersion: this.harnessVersion },
          capabilities: offeredCapabilities
        });
      };
      socket.onmessage = (event) => {
        messageQueue = messageQueue.then(async () => {
          const frame = decodeControl(event.data, this.controlFrameLimits);
          this.lastActiveAt = Date.now();
          if (frame.type === "hello.ack") {
            const payload = requireHelloAck(frame.payload);
            this.controlFrameLimits = {
              maxControlFrameBytes: payload.maxControlFrameBytes,
              maxRelayFrameBytes: payload.maxRelayFrameBytes
            };
            this.negotiatedCapabilities = acceptNegotiatedCapabilities(offeredCapabilities, payload.capabilities);
            if (!this.negotiatedCapabilities.some((capability) => capability === "transport.relay" || capability === "transport.lan" || capability === "transport.p2p" || capability === "transport.turn")) {
              throw new ControlConnectionError("INVALID_MESSAGE", "Server did not negotiate a transport capability.");
            }
            acknowledged = true;
            clearTimeout(helloTimer);
            this.online = true;
            this.terminalError = void 0;
            this.logger.info("server control connection online", {
              serverVersion: payload.serverVersion,
              connectionSessionId: shortId3(payload.connectionSessionId)
            });
            return;
          }
          if (!acknowledged) throw new ControlConnectionError("INVALID_MESSAGE", "Server sent a frame before hello.ack.");
          await this.handleFrame(frame);
        }).catch((error) => {
          const code = errorCode2(error);
          this.terminalError = code;
          this.logger.error("server control frame failed", {
            code,
            reason: diagnosticReason3(error)
          });
          socket.close(4008, "invalid control frame");
        });
      };
      socket.onerror = () => {
        if (!acknowledged) finish(new ControlConnectionError("CONNECTION_FAILED", "Unable to open the Server WebSocket."));
      };
      socket.onclose = (event) => {
        const close = async () => {
          await messageQueue.catch(() => void 0);
          if (event.code === 4002) {
            try {
              await this.api.refreshCredentials();
            } catch (error) {
              finish(asError2(error));
              return;
            }
          }
          if (event.code === 4004) {
            finish(new ControlConnectionError("DEVICE_REVOKED", "The Server revoked this Host device."));
            return;
          }
          if (acknowledged) this.terminalError = closeCode(event.code);
          finish(acknowledged ? void 0 : new ControlConnectionError(closeCode(event.code), event.reason || "Server control connection closed."));
        };
        void close();
      };
    });
  }
  async handleFrame(frame) {
    if (frame.type === "ping") {
      const nonce = objectValue(frame.payload, "nonce");
      if (typeof nonce !== "string") throw new ControlConnectionError("INVALID_MESSAGE", "Control ping has no nonce.");
      this.sendControl("pong", { nonce });
      return;
    }
    if (frame.type === "pong") return;
    if (frame.type === "connect.incoming") {
      await this.handleConnectIncoming(requireConnectIncoming(frame.payload));
      return;
    }
    if (frame.type === "secure.handshake") {
      await this.handleHandshake(requireHandshake(frame.payload));
      return;
    }
    if (frame.type === "relay") {
      await this.handleRelay(requireRelay(frame.payload));
      return;
    }
    if (frame.type === "signal.offer") {
      await this.handleSignalOffer(requireSignal(frame.payload));
      return;
    }
    if (frame.type === "signal.ice") {
      this.handleSignalIce(requireSignalIce(frame.payload));
      return;
    }
    if (frame.type === "transport.selected") {
      await this.handleTransportSelected(requireTransportSelected(frame.payload));
      return;
    }
    if (frame.type === "signal.answer") return;
    if (frame.type === "error") {
      const payload = requireControlError(frame.payload);
      if (payload.code === "DEVICE_REVOKED") {
        this.terminalError = payload.code;
        this.socket?.close(4004, "device revoked");
      } else if (payload.connectionId !== void 0) {
        await this.dropTunnel(payload.connectionId, payload.code);
        const fields = {
          code: payload.code,
          connectionId: shortId3(payload.connectionId),
          retryable: payload.retryable
        };
        if (payload.retryable) this.logger.debug("server closed a remote connection", fields);
        else this.logger.warn("server closed a remote connection", fields);
      } else {
        this.terminalError = payload.code;
        this.logger.warn("server returned a control error", { code: payload.code, retryable: payload.retryable });
      }
      return;
    }
    throw new ControlConnectionError("INVALID_MESSAGE", `Unexpected Server control frame: ${frame.type}`);
  }
  async handleConnectIncoming(payload) {
    let descriptor;
    try {
      descriptor = await this.api.deviceFor(payload.clientDeviceId);
    } catch (error) {
      this.sendControl("connect.rejected", { connectionId: payload.connectionId });
      this.logger.warn("connection rejected by account authorization", {
        clientDeviceId: shortId3(payload.clientDeviceId),
        code: errorCode2(error)
      });
      return;
    }
    if (descriptor.role !== "client" || descriptor.deviceId !== payload.clientDeviceId || descriptor.identityKey !== payload.clientIdentityKey) {
      this.sendControl("connect.rejected", { connectionId: payload.connectionId });
      this.logger.warn("connection rejected by peer identity validation", {
        clientDeviceId: shortId3(payload.clientDeviceId)
      });
      return;
    }
    const existing = this.identities.trustedPeer(descriptor.deviceId);
    if (existing !== void 0 && existing.publicKey !== descriptor.identityKey) {
      this.sendControl("connect.rejected", { connectionId: payload.connectionId });
      this.logger.warn("connection rejected by pinned peer identity", {
        clientDeviceId: shortId3(payload.clientDeviceId)
      });
      return;
    }
    const peer = existing !== void 0 && existing.membershipId === descriptor.membershipId && existing.name === descriptor.name && existing.platform === descriptor.platform ? existing : await this.identities.trustPeer({
      deviceId: descriptor.deviceId,
      name: descriptor.name,
      platform: descriptor.platform,
      publicKey: descriptor.identityKey,
      membershipId: descriptor.membershipId
    });
    const previous = this.tunnels.get(payload.connectionId);
    previous?.noise.destroy();
    const noise = new NoiseIkSession({
      role: "responder",
      localPrivateKey: this.identity.privateKey,
      localPublicKey: this.identity.publicKey,
      remotePublicKey: peer.publicKey,
      prologue: createNoisePrologue(payload.connectionId, this.identity.deviceId, peer.deviceId)
    });
    this.tunnels.set(payload.connectionId, {
      connectionId: payload.connectionId,
      membershipId: descriptor.membershipId,
      peer,
      preferredTransports: payload.preferredTransports,
      noise,
      transport: "negotiating"
    });
    this.sendControl("connect.accepted", { connectionId: payload.connectionId });
  }
  async handleHandshake(payload) {
    const tunnel = this.tunnels.get(payload.connectionId);
    if (tunnel !== void 0 && tunnel.channel !== void 0 && payload.targetDeviceId === this.identity.deviceId && payload.step === 1) {
      this.logger.warn("duplicate secure handshake ignored", {
        connectionId: shortId3(tunnel.connectionId),
        peerDeviceId: shortId3(tunnel.peer.deviceId)
      });
      return;
    }
    if (tunnel === void 0 || payload.targetDeviceId !== this.identity.deviceId || payload.step !== 1) {
      throw new ControlConnectionError("SECURE_CHANNEL_FAILED", "Noise IK handshake is not valid for this connection.");
    }
    if (tunnel.transport === "negotiating" && tunnel.rtc !== void 0) {
      if (tunnel.pendingHandshake === void 0) tunnel.pendingHandshake = payload;
      else this.logger.warn("duplicate pending secure handshake ignored", {
        connectionId: shortId3(tunnel.connectionId),
        peerDeviceId: shortId3(tunnel.peer.deviceId)
      });
      return;
    }
    await this.completeHandshake(tunnel, payload);
  }
  async completeHandshake(tunnel, payload) {
    tunnel.noise.readHandshake(fromBase64Url2(payload.data));
    const reply = tunnel.noise.writeHandshake();
    if (!tunnel.noise.complete) throw new ControlConnectionError("SECURE_CHANNEL_FAILED", "Noise IK handshake did not complete.");
    const viaWebRtc = tunnel.rtc !== void 0 && (tunnel.transport === "lan" || tunnel.transport === "p2p" || tunnel.transport === "turn");
    if (!viaWebRtc && tunnel.transport === "negotiating") tunnel.transport = "relay";
    const mode = viaWebRtc ? tunnel.transportMode ?? (tunnel.transport === "turn" ? "TURN" : tunnel.transport === "lan" ? "LAN" : "P2P") : "Relay";
    const transmit = viaWebRtc ? (ciphertext) => tunnel.rtc.send(ciphertext) : (ciphertext) => this.sendRelay(tunnel, ciphertext);
    const channel = new ServerNoiseChannel(tunnel, transmit, () => {
      if (this.tunnels.get(tunnel.connectionId) === tunnel) this.tunnels.delete(tunnel.connectionId);
    }, mode);
    tunnel.channel = channel;
    await this.connections.accept(channel);
    this.sendControl("secure.handshake", {
      connectionId: tunnel.connectionId,
      targetDeviceId: tunnel.peer.deviceId,
      step: 2,
      data: toBase64Url2(reply)
    });
    this.logger.info("authenticated peer channel ready", {
      connectionId: shortId3(tunnel.connectionId),
      peerDeviceId: shortId3(tunnel.peer.deviceId),
      transport: mode
    });
  }
  async resumePendingHandshake(tunnel) {
    const payload = tunnel.pendingHandshake;
    if (payload === void 0 || tunnel.channel !== void 0 || tunnel.transport === "negotiating") return;
    tunnel.pendingHandshake = void 0;
    await this.completeHandshake(tunnel, payload);
  }
  async handleRelay(payload) {
    if (!this.negotiatedCapabilities.includes("transport.relay")) {
      throw new ControlConnectionError("INVALID_MESSAGE", "Server forwarded Relay without negotiating it.");
    }
    if (payload.targetDeviceId !== this.identity.deviceId) {
      throw new ControlConnectionError("INVALID_MESSAGE", "Relay frame target does not match this Host.");
    }
    const tunnel = this.tunnels.get(payload.connectionId);
    if (tunnel?.channel === void 0) {
      this.logger.warn("stale relay frame ignored", {
        connectionId: shortId3(payload.connectionId)
      });
      return;
    }
    try {
      tunnel.channel.receive(payload.counter, fromBase64Url2(payload.ciphertext));
    } catch (error) {
      await tunnel.channel.close();
      throw new ControlConnectionError("SECURE_CHANNEL_FAILED", asError2(error).message);
    }
  }
  async handleSignalOffer(payload) {
    if (!this.canUseWebRtc()) {
      throw new ControlConnectionError("INVALID_MESSAGE", "Server forwarded WebRTC signaling without negotiating it.");
    }
    const tunnel = this.tunnels.get(payload.connectionId);
    if (tunnel === void 0 || payload.targetDeviceId !== this.identity.deviceId) {
      this.logger.warn("stale webrtc offer ignored", { connectionId: shortId3(payload.connectionId) });
      return;
    }
    if (tunnel.channel !== void 0 || tunnel.rtc !== void 0) {
      this.logger.warn("duplicate webrtc offer ignored", { connectionId: shortId3(tunnel.connectionId) });
      return;
    }
    if (this.config.forceRelay) {
      this.logger.warn("webrtc offer ignored: forceRelay is enabled", { connectionId: shortId3(tunnel.connectionId) });
      return;
    }
    if (this.rtcFactory === void 0 && this.rtcFactoryProvider !== void 0) {
      this.rtcFactory = await this.rtcFactoryProvider().catch(() => void 0);
    }
    if (this.rtcFactory === void 0) {
      this.logger.warn("webrtc offer ignored: no RTC backend available", { connectionId: shortId3(tunnel.connectionId) });
      return;
    }
    let iceServers = [];
    try {
      iceServers = await this.api.turnCredentials(tunnel.connectionId);
    } catch (error) {
      this.logger.warn("TURN credentials unavailable; trying direct candidates", {
        connectionId: shortId3(tunnel.connectionId),
        code: errorCode2(error)
      });
    }
    if (!tunnel.preferredTransports.includes("turn")) iceServers = stunOnlyIceServers(iceServers);
    const rtc = new RtcDataChannelTransport({
      role: "responder",
      factory: this.rtcFactory,
      iceServers,
      onSignal: (signal) => this.sendRtcSignal(tunnel, signal),
      negotiateTimeoutMs: DEFAULT_WEBRTC_NEGOTIATE_TIMEOUT_MS,
      label: `host<-${tunnel.peer.deviceId}`,
      onDiagnostic: (event) => {
        if (event.type !== "local-candidate-filtered" && event.type !== "candidate-pair-filtered") return;
        this.logger.debug("webrtc candidate filtered", {
          connectionId: shortId3(tunnel.connectionId),
          peerDeviceId: shortId3(tunnel.peer.deviceId),
          type: event.type,
          reason: event.reason,
          candidate: event.type === "local-candidate-filtered" ? event.candidate : event.localCandidate
        });
      }
    });
    tunnel.rtc = rtc;
    rtc.onMessage((data) => tunnel.channel?.receive(void 0, data));
    rtc.onClose(() => {
      void this.handleRtcFailed(tunnel, rtc, new Error("WebRTC data channel closed."));
    });
    void rtc.connect().then(() => {
      this.handleRtcOpened(tunnel, rtc.selectedTransport() ?? "p2p");
    }).catch((error) => {
      void this.handleRtcFailed(tunnel, rtc, asError2(error));
    });
    rtc.handleSignal({ type: "offer", sdp: payload.sdp });
  }
  handleSignalIce(payload) {
    if (!this.canUseWebRtc()) {
      throw new ControlConnectionError("INVALID_MESSAGE", "Server forwarded WebRTC signaling without negotiating it.");
    }
    const tunnel = this.tunnels.get(payload.connectionId);
    if (tunnel === void 0 || payload.targetDeviceId !== this.identity.deviceId) return;
    tunnel.rtc?.handleSignal({ type: "ice", candidate: payload.candidate });
  }
  async handleTransportSelected(payload) {
    const tunnel = this.tunnels.get(payload.connectionId);
    if (tunnel === void 0 || payload.targetDeviceId !== this.identity.deviceId) {
      this.logger.warn("stale transport selection ignored", { connectionId: shortId3(payload.connectionId) });
      return;
    }
    if (tunnel.channel !== void 0) {
      if (tunnel.transport !== payload.transport) {
        this.logger.warn("late transport selection ignored", {
          connectionId: shortId3(tunnel.connectionId),
          selected: payload.transport
        });
      }
      return;
    }
    const requiredCapability = `transport.${payload.transport}`;
    if (!this.negotiatedCapabilities.includes(requiredCapability)) {
      throw new ControlConnectionError(
        "INVALID_MESSAGE",
        `Client selected unnegotiated transport: ${payload.transport}`
      );
    }
    if (payload.transport === "relay") {
      const rtc = tunnel.rtc;
      tunnel.rtc = void 0;
      tunnel.transport = "relay";
      tunnel.transportMode = void 0;
      await rtc?.close();
      await this.resumePendingHandshake(tunnel);
      return;
    }
    if (tunnel.rtc === void 0) {
      throw new ControlConnectionError("INVALID_MESSAGE", "Client selected WebRTC before creating a data channel.");
    }
    tunnel.transport = payload.transport;
    tunnel.transportMode = tunnel.rtc.selectedPathMode();
    await this.resumePendingHandshake(tunnel);
  }
  canUseWebRtc() {
    return this.negotiatedCapabilities.includes("transport.lan") || this.negotiatedCapabilities.includes("transport.p2p") || this.negotiatedCapabilities.includes("transport.turn");
  }
  sendRtcSignal(tunnel, signal) {
    if (signal.type === "answer") {
      this.sendControl("signal.answer", {
        connectionId: tunnel.connectionId,
        targetDeviceId: tunnel.peer.deviceId,
        sdp: signal.sdp
      });
    } else if (signal.type === "ice") {
      this.sendControl("signal.ice", {
        connectionId: tunnel.connectionId,
        targetDeviceId: tunnel.peer.deviceId,
        candidate: signal.candidate
      });
    }
  }
  handleRtcOpened(tunnel, selected) {
    if (this.tunnels.get(tunnel.connectionId) !== tunnel || tunnel.rtc === void 0) return;
    const wireSelected = selected === "lan" && !this.negotiatedCapabilities.includes("transport.lan") && this.negotiatedCapabilities.includes("transport.p2p") ? "p2p" : selected;
    const requiredCapability = wireSelected === "lan" ? "transport.lan" : wireSelected === "turn" ? "transport.turn" : "transport.p2p";
    if (!this.negotiatedCapabilities.includes(requiredCapability)) {
      const error = new Error(`WebRTC selected unnegotiated transport: ${selected}`);
      if (!this.negotiatedCapabilities.includes("transport.relay")) {
        void this.dropTunnel(tunnel.connectionId, "CONNECTION_FAILED");
        return;
      }
      void this.handleRtcFailed(
        tunnel,
        tunnel.rtc,
        error
      );
      return;
    }
    tunnel.transport = wireSelected;
    tunnel.transportMode = tunnel.rtc.selectedPathMode();
    this.sendTransportSelected(tunnel, wireSelected);
    const diagnostics = rtcDiagnostics(tunnel.rtc);
    this.logger.info("webrtc data channel ready", {
      connectionId: shortId3(tunnel.connectionId),
      peerDeviceId: shortId3(tunnel.peer.deviceId),
      transport: tunnel.transportMode ?? wireSelected
    });
    if (diagnostics !== void 0) {
      this.logger.debug("webrtc data channel diagnostics", {
        connectionId: shortId3(tunnel.connectionId),
        ...webrtcDiagnosticsLogFields2(diagnostics)
      });
    }
    void this.resumePendingHandshake(tunnel).catch((error) => {
      this.logger.warn("pending secure handshake failed", {
        connectionId: shortId3(tunnel.connectionId),
        reason: diagnosticReason3(error)
      });
      void this.dropTunnel(tunnel.connectionId, "SECURE_CHANNEL_FAILED");
    });
  }
  async handleRtcFailed(tunnel, rtc, error) {
    if (this.tunnels.get(tunnel.connectionId) !== tunnel || tunnel.rtc !== rtc) return;
    const diagnostics = rtcDiagnostics(rtc);
    if (tunnel.transport === "lan" || tunnel.transport === "p2p" || tunnel.transport === "turn") {
      this.logger.warn("webrtc data channel failed; disconnecting peer", {
        connectionId: shortId3(tunnel.connectionId),
        reason: diagnosticReason3(error)
      });
      if (diagnostics !== void 0) {
        this.logger.debug("webrtc data channel failure diagnostics", {
          connectionId: shortId3(tunnel.connectionId),
          ...webrtcDiagnosticsLogFields2(diagnostics)
        });
      }
      await this.dropTunnel(tunnel.connectionId, "CONNECTION_FAILED");
      return;
    }
    tunnel.rtc = void 0;
    tunnel.transport = "relay";
    await rtc.close();
    this.logger.warn("webrtc negotiation failed; falling back to relay", {
      connectionId: shortId3(tunnel.connectionId),
      reason: diagnosticReason3(error)
    });
    if (diagnostics !== void 0) {
      this.logger.debug("webrtc negotiation failure diagnostics", {
        connectionId: shortId3(tunnel.connectionId),
        ...webrtcDiagnosticsLogFields2(diagnostics)
      });
    }
    await this.resumePendingHandshake(tunnel);
  }
  sendTransportSelected(tunnel, transport) {
    this.sendControl("transport.selected", {
      connectionId: tunnel.connectionId,
      targetDeviceId: tunnel.peer.deviceId,
      transport
    });
  }
  async sendRelay(tunnel, ciphertext) {
    const counter = Number(tunnel.noise.sendingCounter() - 1n);
    if (!Number.isSafeInteger(counter) || counter < 0) throw new ControlConnectionError("FRAME_TOO_LARGE", "Noise transport counter overflowed.");
    this.sendControl("relay", {
      connectionId: tunnel.connectionId,
      targetDeviceId: tunnel.peer.deviceId,
      counter,
      ciphertext: toBase64Url2(ciphertext)
    });
  }
  sendControl(type, payload) {
    const socket = this.socket;
    if (socket === void 0 || socket.readyState !== 1) throw new ControlConnectionError("CONNECTION_FAILED", "Server control socket is not open.");
    socket.send(encodeControlFrame(createControlFrame(type, payload), this.controlFrameLimits));
  }
  async dropTunnels() {
    const tunnels = [...this.tunnels.values()];
    this.tunnels.clear();
    await Promise.all(tunnels.map(async (tunnel) => {
      if (tunnel.rtc !== void 0) await tunnel.rtc.close();
      if (tunnel.channel !== void 0) await tunnel.channel.close();
      else tunnel.noise.destroy();
    }));
    await this.connections.close();
  }
  async dropTunnel(connectionId, code) {
    const tunnel = this.tunnels.get(connectionId);
    if (tunnel === void 0) return;
    this.tunnels.delete(connectionId);
    try {
      await tunnel.rtc?.close();
    } catch (error) {
      this.logger.warn("remote connection RTC cleanup failed", {
        connectionId: shortId3(connectionId),
        reason: diagnosticReason3(error)
      });
    }
    if (tunnel.channel !== void 0) {
      try {
        const closed = await this.connections.closeConnection(connectionId, code);
        if (!closed) await tunnel.channel.close(code);
      } catch (error) {
        await tunnel.channel.close(code).catch(() => void 0);
        this.logger.warn("remote connection channel cleanup failed", {
          connectionId: shortId3(connectionId),
          reason: diagnosticReason3(error)
        });
      }
    } else {
      tunnel.noise.destroy();
    }
  }
  waitBeforeRetry(baseDelay) {
    const spread = baseDelay * this.config.reconnect.jitter;
    const delay = Math.max(0, Math.round(baseDelay - spread + Math.random() * spread * 2));
    return new Promise((resolve3) => {
      const timer = setTimeout(() => {
        this.retryWake = void 0;
        resolve3();
      }, delay);
      this.retryWake = () => {
        clearTimeout(timer);
        resolve3();
      };
    });
  }
};
var TERMINAL_AUTH_ERRORS = /* @__PURE__ */ new Set([
  "ACCOUNT_AUTH_REQUIRED",
  "AUTH_INVALID",
  "DEVICE_OWNERSHIP_REQUIRED",
  "DEVICE_REVOKED",
  "TOKEN_EXPIRED"
]);
var ServerNoiseChannel = class {
  constructor(tunnel, transmit, onClose, mode) {
    this.tunnel = tunnel;
    this.transmit = transmit;
    this.onClose = onClose;
    this.mode = mode;
    this.security = {
      protocol: "Noise_IK_25519_ChaChaPoly_SHA256",
      connectionId: tunnel.connectionId,
      membershipId: tunnel.membershipId
    };
    this.peerDeviceId = tunnel.peer.deviceId;
    this.peerIdentityKey = tunnel.peer.publicKey;
  }
  security;
  peerDeviceId;
  peerIdentityKey;
  mode;
  handlers = /* @__PURE__ */ new Set();
  incoming = new SecureMessageCodec();
  outgoing = new SecureMessageCodec();
  closed = false;
  async send(message) {
    if (this.closed) throw new Error("secure channel is closed");
    const plaintextFrames = this.outgoing.encode(encodeMessage(message));
    try {
      for (const plaintext of plaintextFrames) {
        await this.transmit(this.tunnel.noise.encrypt(plaintext));
      }
    } catch (error) {
      await this.close().catch(() => void 0);
      throw error;
    }
  }
  onMessage(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  receive(counter, ciphertext) {
    if (this.closed) return;
    if (counter !== void 0) {
      const expected = Number(this.tunnel.noise.receivingCounter());
      if (!Number.isSafeInteger(counter) || counter !== expected) {
        throw new ControlConnectionError("INVALID_MESSAGE", "Relay counter is duplicated or out of order.");
      }
    }
    const plaintext = this.incoming.decode(this.tunnel.noise.decrypt(ciphertext));
    if (plaintext === void 0) return;
    const message = decodeMessage(plaintext);
    for (const handler of this.handlers) handler(message);
  }
  async close(_code) {
    if (this.closed) return;
    this.closed = true;
    this.handlers.clear();
    this.incoming.reset();
    this.outgoing.reset();
    this.tunnel.noise.destroy();
    this.onClose();
  }
};
var ControlConnectionError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function websocketUrl2(baseUrl) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/v1/connect`;
  return url.toString();
}
function decodeControl(data, limits) {
  if (typeof data !== "string") throw new ControlConnectionError("INVALID_MESSAGE", "Server control frames must be text JSON.");
  try {
    return decodeControlFrame(data, limits);
  } catch {
    throw new ControlConnectionError("INVALID_MESSAGE", "Server sent an invalid control frame.");
  }
}
function requireHelloAck(value) {
  const payload = requireObject(value);
  if (payload.protocol !== PROTOCOL_VERSION || typeof payload.serverVersion !== "string" || typeof payload.connectionSessionId !== "string" || !Number.isSafeInteger(payload.heartbeatIntervalMs) || !Number.isSafeInteger(payload.maxControlFrameBytes) || !Number.isSafeInteger(payload.maxRelayFrameBytes)) {
    throw new ControlConnectionError("INVALID_MESSAGE", "hello.ack payload is invalid.");
  }
  return payload;
}
function requireConnectIncoming(value) {
  const payload = requireObject(value);
  if (typeof payload.connectionId !== "string" || typeof payload.clientDeviceId !== "string" || typeof payload.clientIdentityKey !== "string" || payload.authorization !== "account" || !Array.isArray(payload.preferredTransports)) {
    throw new ControlConnectionError("INVALID_MESSAGE", "connect.incoming payload is invalid.");
  }
  return payload;
}
function requireHandshake(value) {
  const payload = requireObject(value);
  if (typeof payload.connectionId !== "string" || typeof payload.targetDeviceId !== "string" || !Number.isSafeInteger(payload.step) || typeof payload.data !== "string") {
    throw new ControlConnectionError("INVALID_MESSAGE", "secure.handshake payload is invalid.");
  }
  return payload;
}
function requireRelay(value) {
  const payload = requireObject(value);
  if (typeof payload.connectionId !== "string" || typeof payload.targetDeviceId !== "string" || !Number.isSafeInteger(payload.counter) || typeof payload.ciphertext !== "string") {
    throw new ControlConnectionError("INVALID_MESSAGE", "relay payload is invalid.");
  }
  return payload;
}
function requireSignal(value) {
  const payload = requireObject(value);
  if (typeof payload.connectionId !== "string" || typeof payload.targetDeviceId !== "string" || typeof payload.sdp !== "string" || payload.sdp.length === 0) {
    throw new ControlConnectionError("INVALID_MESSAGE", "signal offer/answer payload is invalid.");
  }
  return payload;
}
function requireSignalIce(value) {
  const payload = requireObject(value);
  if (typeof payload.connectionId !== "string" || typeof payload.targetDeviceId !== "string" || typeof payload.candidate !== "object" || payload.candidate === null || Array.isArray(payload.candidate)) {
    throw new ControlConnectionError("INVALID_MESSAGE", "signal.ice payload is invalid.");
  }
  return payload;
}
function requireTransportSelected(value) {
  const payload = requireObject(value);
  if (typeof payload.connectionId !== "string" || typeof payload.targetDeviceId !== "string" || payload.transport !== "lan" && payload.transport !== "p2p" && payload.transport !== "turn" && payload.transport !== "relay") {
    throw new ControlConnectionError("INVALID_MESSAGE", "transport.selected payload is invalid.");
  }
  return payload;
}
function requireControlError(value) {
  const payload = requireObject(value);
  if (typeof payload.code !== "string" || typeof payload.message !== "string" || payload.connectionId !== void 0 && (typeof payload.connectionId !== "string" || payload.connectionId === "")) {
    throw new ControlConnectionError("INVALID_MESSAGE", "error payload is invalid.");
  }
  return payload;
}
function requireObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ControlConnectionError("INVALID_MESSAGE", "Control payload must be an object.");
  }
  return value;
}
function objectValue(value, key) {
  return requireObject(value)[key];
}
function shortId3(value) {
  return value.length <= 12 ? value : `${value.slice(0, 8)}\u2026${value.slice(-4)}`;
}
function asError2(error) {
  return error instanceof Error ? error : new Error("Unknown Server connection error.");
}
function diagnosticReason3(error) {
  const message = asError2(error).message.replace(/[\r\n]+/g, " ").slice(0, 160);
  return message || "Unknown Server connection error.";
}
function webrtcDiagnosticsLogFields2(diagnostics) {
  if (diagnostics === void 0) return {};
  return {
    rtcConnectionState: diagnostics.connectionState,
    rtcIceConnectionState: diagnostics.iceConnectionState,
    rtcIceGatheringState: diagnostics.iceGatheringState,
    rtcLocalCandidates: diagnostics.localCandidates,
    rtcRemoteCandidates: diagnostics.remoteCandidates,
    rtcCandidatePairs: diagnostics.candidatePairs,
    rtcFilteredLocalCandidates: diagnostics.filteredLocalCandidates,
    rtcFilteredCandidatePairs: diagnostics.filteredCandidatePairs,
    ...diagnostics.selectedPath === void 0 ? {} : { rtcSelectedPath: diagnostics.selectedPath }
  };
}
function rtcDiagnostics(rtc) {
  try {
    const candidate = rtc;
    return typeof candidate.diagnostics === "function" ? candidate.diagnostics() : void 0;
  } catch {
    return void 0;
  }
}
function errorCode2(error) {
  return error instanceof ServerApiError || error instanceof ControlConnectionError ? error.code : "CONNECTION_FAILED";
}
function isRetryable(error) {
  return error instanceof ServerApiError ? error.retryable : errorCode2(error) !== "DEVICE_REVOKED";
}
function closeCode(code) {
  if (code === 4002) return "AUTH_INVALID";
  if (code === 4004) return "DEVICE_REVOKED";
  if (code === 4007) return "RATE_LIMITED";
  if (code === 4011) return "UNSUPPORTED_VERSION";
  return "CONNECTION_FAILED";
}

// src/remote-directory-browser.ts
import { readdir, stat as stat3 } from "node:fs/promises";
import { homedir as homedir2, platform as platform2 } from "node:os";
import { basename as basename2, dirname as dirname5, isAbsolute as isAbsolute2, parse, resolve } from "node:path";
var MAX_ENTRIES = 500;
async function listRemoteDirectory(path, signal) {
  signal?.throwIfAborted();
  const home = resolve(homedir2());
  const target = path === void 0 || path.trim() === "" ? home : resolve(path);
  if (!isAbsolute2(target)) throw new Error("The remote directory path must be absolute.");
  const rows = await readdir(target, { withFileTypes: true });
  const directories = [];
  for (const row of rows) {
    signal?.throwIfAborted();
    const child = resolve(target, row.name);
    let directory = row.isDirectory();
    if (!directory && row.isSymbolicLink()) directory = await stat3(child).then((value) => value.isDirectory()).catch(() => false);
    if (!directory) continue;
    directories.push({ name: row.name, path: child, hidden: platform2() !== "win32" && row.name.startsWith(".") });
  }
  directories.sort((left, right) => left.name.localeCompare(right.name, void 0, { sensitivity: "base" }));
  return {
    path: target,
    home,
    crumbs: crumbs(target),
    entries: directories.slice(0, MAX_ENTRIES),
    truncated: directories.length > MAX_ENTRIES
  };
}
function crumbs(path) {
  const root = parse(path).root;
  const result = [{ name: root, path: root, hidden: false }];
  const segments = [];
  let current = path;
  while (current !== root) {
    segments.unshift(basename2(current));
    current = dirname5(current);
  }
  for (const segment of segments) {
    current = resolve(current, segment);
    result.push({ name: segment, path: current, hidden: false });
  }
  return result;
}

// src/harness-api-bridge.ts
var callSchema2 = external_exports.object({
  method: external_exports.string().min(1).max(80),
  rpcId: external_exports.string().min(1).max(128),
  payload: external_exports.unknown()
}).strict();
var respondSchema = external_exports.object({
  message: external_exports.object({
    type: external_exports.literal("client-response"),
    rpcId: external_exports.string().min(1).max(128),
    result: external_exports.unknown()
  }).strict()
}).strict();
var streamOpenSchema = external_exports.object({
  streamId: external_exports.string().min(1).max(128),
  stream: external_exports.enum(["mux", "host"]),
  rpcId: external_exports.string().min(1).max(128),
  payload: external_exports.object({
    // Optional focus for a mux stream: only frames belonging to this session
    // are forwarded. The Remote Web selects one session at a time, so without
    // this every active session's events (potentially megabytes) would be
    // pushed over the tunnel and stall the WebRTC data channel.
    sessionId: external_exports.string().min(1).max(128).optional()
  }).strict()
}).strict();
var streamCloseSchema = external_exports.object({ streamId: external_exports.string().min(1).max(128) }).strict();
var transferIdSchema = external_exports.string().min(1).max(128);
var transferOpenSchema = external_exports.object({
  transferId: transferIdSchema,
  totalBytes: external_exports.number().int().positive().max(MAX_HARNESS_API_TRANSFER_BYTES),
  totalChunks: external_exports.number().int().positive().max(Math.ceil(MAX_HARNESS_API_TRANSFER_BYTES / HARNESS_API_TRANSFER_CHUNK_BYTES))
}).strict();
var transferChunkSchema = external_exports.object({
  transferId: transferIdSchema,
  index: external_exports.number().int().nonnegative(),
  data: external_exports.string().max(Math.ceil(HARNESS_API_TRANSFER_CHUNK_BYTES / 3) * 4)
}).strict();
var transferCommitSchema = external_exports.object({ transferId: transferIdSchema }).strict();
var transferReadSchema = external_exports.object({ transferId: transferIdSchema, index: external_exports.number().int().nonnegative() }).strict();
var transferCloseSchema = external_exports.object({ transferId: transferIdSchema }).strict();
var commandExecuteSchema = external_exports.object({
  agentId: external_exports.string().min(1).max(128),
  line: external_exports.string().min(1).max(2048),
  // The official Harness command endpoint requires the `images` wire field.
  // Remote command execution keeps attachments out of scope, so only an empty
  // list is accepted and legacy clients that omit it are normalized below.
  images: external_exports.array(external_exports.never()).length(0).optional()
}).strict();
var commandListSchema = external_exports.object({
  agentId: external_exports.string().min(1).max(128)
}).strict();
var directoryListSchema = external_exports.object({
  path: external_exports.string().min(1).max(4096).optional()
}).strict();
var credentialRefSchema = external_exports.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Invalid credential reference name").max(128);
var CONFIG_PLANE_SETTINGS_BYTES = 64 * 1024;
var CONFIG_PLANE_MAX_OPS = 64;
var CONFIG_PLANE_MAX_PATH_SEGMENTS = 8;
var CONFIG_PLANE_MAX_PATH_SEGMENT_BYTES = 64;
var CONFIG_PLANE_MAX_CREDENTIAL_VALUE_BYTES = 8 * 1024;
var CONFIG_PLANE_MAX_BASE_URL_BYTES = 2048;
var CONFIG_PLANE_MAX_NS_BYTES = 128;
var settingsDescribeSchema = external_exports.object({}).strict();
var settingsWriteBase = {
  ns: external_exports.string().min(1).max(CONFIG_PLANE_MAX_NS_BYTES),
  expectedRevision: external_exports.number().int().nonnegative().optional()
};
var settingsUpdateSchema = external_exports.object({
  ...settingsWriteBase,
  patch: external_exports.record(external_exports.string().min(1).max(CONFIG_PLANE_MAX_PATH_SEGMENT_BYTES), external_exports.unknown())
}).strict();
var settingsReplaceSchema = external_exports.object({
  ...settingsWriteBase,
  section: external_exports.record(external_exports.string().min(1).max(CONFIG_PLANE_MAX_PATH_SEGMENT_BYTES), external_exports.unknown())
}).strict();
var settingsOpSchema = external_exports.union([
  external_exports.object({
    op: external_exports.literal("set"),
    path: external_exports.array(external_exports.string().min(1).max(CONFIG_PLANE_MAX_PATH_SEGMENT_BYTES)).max(CONFIG_PLANE_MAX_PATH_SEGMENTS),
    value: external_exports.unknown()
  }).strict(),
  external_exports.object({
    op: external_exports.literal("unset"),
    path: external_exports.array(external_exports.string().min(1).max(CONFIG_PLANE_MAX_PATH_SEGMENT_BYTES)).max(CONFIG_PLANE_MAX_PATH_SEGMENTS)
  }).strict()
]);
var settingsMutateSchema = external_exports.object({
  ...settingsWriteBase,
  ops: external_exports.array(settingsOpSchema).min(1).max(CONFIG_PLANE_MAX_OPS)
}).strict();
var credentialsDescribeSchema = external_exports.object({
  refs: external_exports.array(credentialRefSchema).max(CONFIG_PLANE_MAX_OPS)
}).strict();
var credentialsSetSchema = external_exports.object({
  ref: credentialRefSchema,
  value: external_exports.string().min(1).max(CONFIG_PLANE_MAX_CREDENTIAL_VALUE_BYTES)
}).strict();
var credentialsUnsetSchema = external_exports.object({
  ref: credentialRefSchema
}).strict();
var discoverModelsSchema = external_exports.object({
  settingsNs: external_exports.string().min(1).max(CONFIG_PLANE_MAX_NS_BYTES),
  provider: external_exports.string().min(1).max(CONFIG_PLANE_MAX_NS_BYTES).optional(),
  baseURL: external_exports.string().max(CONFIG_PLANE_MAX_BASE_URL_BYTES).optional(),
  api: external_exports.string().min(1).max(CONFIG_PLANE_MAX_NS_BYTES).optional(),
  apiKey: external_exports.string().min(1).max(CONFIG_PLANE_MAX_CREDENTIAL_VALUE_BYTES).optional()
}).strict();
var HARNESS_API_ALLOWLIST = [
  "session.list",
  "session.search",
  "session.create",
  "session.history",
  "session.models",
  "session.selectModel",
  "session.rename",
  "session.fork",
  "session.prompt",
  "session.attachment",
  "session.updateQueue",
  "session.cancel",
  "subagent.list",
  "subagent.history",
  "subagent.prompt",
  "subagent.interrupt",
  "host.describe",
  "host.listDirectory",
  "workspace.list",
  "workspace.create",
  "workspace.rename",
  "workspace.delete",
  "workspace.insertBefore",
  "workspace.insertSessionBefore",
  "workspace.archiveSession",
  "skill.list",
  "agentPreset.list",
  "agentPreset.select",
  "agentPreset.read",
  "goal.create",
  "goal.edit",
  "goal.pause",
  "goal.resume",
  "goal.complete",
  "goal.clear",
  "commands.execute",
  "commands.list",
  "llm.providers",
  "llm.models",
  "llm.discoverModels",
  "settings.describe",
  "settings.update",
  "settings.replace",
  "settings.mutate",
  "credentials.describe",
  "credentials.set",
  "credentials.unset"
];
var NATIVE_CALL_TIMEOUT_MS = 3e4;
var MAX_ACTIVE_API_TRANSFERS = MAX_ACTIVE_TRANSFERS_PER_DIRECTION;
var API_TRANSFER_IDLE_MS = TRANSFER_IDLE_MS;
var INLINE_TRANSFER_RESPONSE_BYTES = 2 * 1024 * 1024;
var SESSION_HISTORY_PAGE_SIZES = [50, 30, 20, 12, 6, 3, 1];
var HarnessApiBridge = class {
  constructor(api, publish, maxStreams = 8, logger, typertGateway, harnessVersion) {
    this.api = api;
    this.publish = publish;
    this.maxStreams = maxStreams;
    this.logger = logger;
    this.harnessVersion = harnessVersion;
    this.methods = createMethodMap(api, typertGateway);
    this.mux = api.events.mux.bind(api.events);
    this.host = api.events.host.bind(api.events);
    this.answer = api.respond.bind(api);
  }
  methods;
  streams = /* @__PURE__ */ new Map();
  respondable = /* @__PURE__ */ new Map();
  incomingTransfers = /* @__PURE__ */ new Map();
  outgoingTransfers = /* @__PURE__ */ new Map();
  mux;
  host;
  answer;
  async call(input2) {
    const params = callSchema2.parse(input2);
    const signal = AbortSignal.timeout(NATIVE_CALL_TIMEOUT_MS);
    const method = this.methods.get(params.method);
    if (method === void 0) {
      if (params.method === "host.listDirectory") {
        return this.callDirectoryFallback(params, signal);
      }
      if (params.method === "host.describe") {
        return this.describeFallback(params.rpcId);
      }
      throw deniedMethod(params.method);
    }
    const startedAt = performance.now();
    const request = { rpcId: params.rpcId, payload: params.payload };
    try {
      const callWithTimeout = (overridePayload) => withTimeout(
        method({ rpcId: params.rpcId, payload: overridePayload }, signal),
        NATIVE_CALL_TIMEOUT_MS,
        `Harness API call ${params.method} timed out after ${NATIVE_CALL_TIMEOUT_MS}ms`
      );
      let response;
      if (params.method === "session.history") {
        response = await callSessionHistory(callWithTimeout, params.payload, params.rpcId);
      } else {
        response = await callWithTimeout(request.payload);
      }
      if (params.method === "host.listDirectory" && needsRemoteDirectoryFallback(response)) {
        response = await this.callDirectoryFallback(params, signal);
      }
      if (params.method === "host.describe") {
        response = normalizeHostDescribe(response, this.harnessVersion, true);
      }
      this.logger?.debug("harness api call ok", {
        method: params.method,
        durationMs: Math.round(performance.now() - startedAt)
      });
      return response;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      this.logger?.warn("harness api call failed", {
        method: params.method,
        durationMs,
        timedOut: signal.aborted,
        code: safeErrorCode(error)
      });
      throw error;
    }
  }
  async callDirectoryFallback(params, signal) {
    const payload = directoryListSchema.parse(params.payload);
    const value = await listRemoteDirectory(payload.path, signal);
    return { rpcId: params.rpcId, result: { ok: true, value } };
  }
  describeFallback(rpcId) {
    return {
      rpcId,
      result: {
        ok: true,
        value: {
          version: this.harnessVersion ?? "0.0.1",
          cwd: "",
          home: "",
          attachedSessions: 0,
          canOpenPath: true
        }
      }
    };
  }
  openTransfer(input2) {
    this.pruneTransfers();
    const params = transferOpenSchema.parse(input2);
    if (params.totalChunks !== Math.ceil(params.totalBytes / HARNESS_API_TRANSFER_CHUNK_BYTES)) {
      throw new RpcError("INVALID_MESSAGE", "The Harness API transfer chunk count is invalid.");
    }
    if (this.incomingTransfers.has(params.transferId) || this.outgoingTransfers.has(params.transferId)) {
      throw new RpcError("REQUEST_CONFLICT", "The Harness API transfer id is already active.");
    }
    if (this.incomingTransfers.size >= MAX_ACTIVE_API_TRANSFERS) {
      throw new RpcError("RATE_LIMITED", "Too many Harness API transfers are active.", void 0, true);
    }
    this.incomingTransfers.set(params.transferId, {
      totalBytes: params.totalBytes,
      totalChunks: params.totalChunks,
      chunks: [],
      receivedBytes: 0,
      touchedAt: Date.now()
    });
    return { opened: true, transferId: params.transferId };
  }
  appendTransfer(input2) {
    this.pruneTransfers();
    const params = transferChunkSchema.parse(input2);
    const transfer = this.incomingTransfers.get(params.transferId);
    if (transfer === void 0) throw new RpcError("TRANSFER_NOT_FOUND", "The Harness API transfer is not active.");
    if (params.index !== transfer.chunks.length || params.index >= transfer.totalChunks) {
      this.incomingTransfers.delete(params.transferId);
      throw new RpcError("INVALID_MESSAGE", "Harness API transfer chunks must arrive exactly once and in order.");
    }
    let chunk;
    try {
      chunk = decodeCanonicalBase64(params.data);
    } catch (error) {
      this.incomingTransfers.delete(params.transferId);
      throw error;
    }
    const expectedBytes = Math.min(
      HARNESS_API_TRANSFER_CHUNK_BYTES,
      transfer.totalBytes - params.index * HARNESS_API_TRANSFER_CHUNK_BYTES
    );
    if (chunk.byteLength !== expectedBytes) {
      this.incomingTransfers.delete(params.transferId);
      throw new RpcError("INVALID_MESSAGE", "The Harness API transfer chunk size is invalid.");
    }
    transfer.chunks.push(chunk);
    transfer.receivedBytes += chunk.byteLength;
    transfer.touchedAt = Date.now();
    return { accepted: true, transferId: params.transferId, index: params.index };
  }
  async commitTransfer(input2) {
    this.pruneTransfers();
    const params = transferCommitSchema.parse(input2);
    const transfer = this.incomingTransfers.get(params.transferId);
    if (transfer === void 0) throw new RpcError("TRANSFER_NOT_FOUND", "The Harness API transfer is not active.");
    this.incomingTransfers.delete(params.transferId);
    if (transfer.chunks.length !== transfer.totalChunks || transfer.receivedBytes !== transfer.totalBytes) {
      throw new RpcError("INVALID_MESSAGE", "The Harness API transfer is incomplete.");
    }
    let request;
    try {
      const bytes = concatChunks(transfer.chunks, transfer.totalBytes);
      request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new RpcError("INVALID_MESSAGE", "The Harness API transfer does not contain a valid request.");
    }
    const nativeRequest = callSchema2.parse(request);
    const response = await this.call(nativeRequest);
    const responseBytes = new TextEncoder().encode(JSON.stringify(response));
    if (responseBytes.byteLength <= INLINE_TRANSFER_RESPONSE_BYTES) {
      return { kind: "inline", response };
    }
    if (responseBytes.byteLength > MAX_HARNESS_API_TRANSFER_BYTES) {
      throw new RpcError("RESPONSE_TOO_LARGE", "The Harness API response exceeds the bounded transfer limit.");
    }
    this.pruneTransfers();
    if (this.outgoingTransfers.size >= MAX_ACTIVE_API_TRANSFERS) {
      throw new RpcError("RATE_LIMITED", "Too many Harness API response transfers are active.", void 0, true);
    }
    const totalChunks = Math.ceil(responseBytes.byteLength / HARNESS_API_TRANSFER_CHUNK_BYTES);
    this.outgoingTransfers.set(params.transferId, {
      bytes: responseBytes,
      totalChunks,
      nextIndex: 0,
      touchedAt: Date.now()
    });
    return { kind: "chunked", transferId: params.transferId, totalBytes: responseBytes.byteLength, totalChunks };
  }
  readTransfer(input2) {
    this.pruneTransfers();
    const params = transferReadSchema.parse(input2);
    const transfer = this.outgoingTransfers.get(params.transferId);
    if (transfer === void 0) throw new RpcError("TRANSFER_NOT_FOUND", "The Harness API response transfer is not active.");
    if (params.index !== transfer.nextIndex || params.index >= transfer.totalChunks) {
      this.outgoingTransfers.delete(params.transferId);
      throw new RpcError("INVALID_MESSAGE", "Harness API response chunks must be read exactly once and in order.");
    }
    const start = params.index * HARNESS_API_TRANSFER_CHUNK_BYTES;
    const end = Math.min(start + HARNESS_API_TRANSFER_CHUNK_BYTES, transfer.bytes.byteLength);
    transfer.nextIndex += 1;
    transfer.touchedAt = Date.now();
    return {
      transferId: params.transferId,
      index: params.index,
      data: Buffer.from(transfer.bytes.subarray(start, end)).toString("base64")
    };
  }
  closeTransfer(input2) {
    const params = transferCloseSchema.parse(input2);
    const incoming = this.incomingTransfers.delete(params.transferId);
    const outgoing = this.outgoingTransfers.delete(params.transferId);
    return { closed: incoming || outgoing, transferId: params.transferId };
  }
  async respond(input2) {
    const params = respondSchema.parse(input2);
    this.logger?.debug("harness api respond", { rpcId: shortId4(params.message.rpcId) });
    if (!this.respondable.has(params.message.rpcId)) {
      throw new RpcError("PERMISSION_NOT_PENDING", "The response id was not emitted on this peer connection.");
    }
    const receipt = await this.answer(params.message);
    if (receipt.accepted || receipt.reason === "not-pending") this.respondable.delete(params.message.rpcId);
    return receipt;
  }
  openStream(input2) {
    const params = streamOpenSchema.parse(input2);
    if (this.streams.has(params.streamId)) throw new RpcError("REQUEST_CONFLICT", "The Harness event stream is already open.");
    if (this.streams.size >= this.maxStreams) throw new RpcError("RATE_LIMITED", "Too many Harness event streams are open.", void 0, true);
    const controller = new AbortController();
    const request = { rpcId: params.rpcId, payload: params.payload };
    const stream = params.stream === "mux" ? this.mux(request, controller.signal) : this.host(request, controller.signal);
    const focusSessionId = params.stream === "mux" ? params.payload.sessionId : void 0;
    const task = this.pump(params.streamId, stream, controller.signal, focusSessionId);
    this.streams.set(params.streamId, { controller, task, ...focusSessionId === void 0 ? {} : { focusSessionId } });
    this.logger?.debug("harness api stream open", {
      stream: params.stream,
      streamId: shortId4(params.streamId),
      ...focusSessionId === void 0 ? {} : { focusSessionId: shortId4(focusSessionId) }
    });
    return { opened: true, streamId: params.streamId };
  }
  closeStream(input2) {
    const params = streamCloseSchema.parse(input2);
    const active = this.streams.get(params.streamId);
    if (active !== void 0) {
      this.streams.delete(params.streamId);
      active.controller.abort();
    }
    this.logger?.debug("harness api stream close", { streamId: shortId4(params.streamId), closed: active !== void 0 });
    return { closed: active !== void 0, streamId: params.streamId };
  }
  async closeAll(reason = "peer-disconnected") {
    const streams = [...this.streams.values()];
    this.streams.clear();
    this.respondable.clear();
    this.incomingTransfers.clear();
    this.outgoingTransfers.clear();
    for (const stream of streams) stream.controller.abort(reason);
  }
  pruneTransfers() {
    const cutoff = Date.now() - API_TRANSFER_IDLE_MS;
    for (const [transferId, transfer] of this.incomingTransfers) {
      if (transfer.touchedAt < cutoff) this.incomingTransfers.delete(transferId);
    }
    for (const [transferId, transfer] of this.outgoingTransfers) {
      if (transfer.touchedAt < cutoff) this.outgoingTransfers.delete(transferId);
    }
  }
  async pump(streamId, stream, signal, focusSessionId) {
    let reason = "completed";
    try {
      for await (const frame of stream) {
        if (signal.aborted) break;
        if (focusSessionId !== void 0 && frameSessionId(frame) !== void 0 && frameSessionId(frame) !== focusSessionId) {
          continue;
        }
        this.trackRespondable(frame);
        await this.publish("harness.api.frame", { streamId, frame });
      }
      if (signal.aborted) reason = "cancelled";
    } catch {
      reason = signal.aborted ? "cancelled" : "failed";
    } finally {
      this.streams.delete(streamId);
      await this.publish("harness.api.stream.closed", { streamId, reason }).catch(() => void 0);
    }
  }
  trackRespondable(frame) {
    const payload = frame.payload;
    if (payload.type === "approval/requested") {
      this.respondable.set(String(frame.rpcId), `approval:${String(payload.approvalId)}`);
      return;
    }
    if (payload.type === "question/requested") {
      this.respondable.set(String(frame.rpcId), `question:${String(frame.rpcId)}`);
      return;
    }
    if (payload.type === "approval/resolved") {
      this.deleteRespondable(`approval:${String(payload.approvalId)}`);
      return;
    }
    if (payload.type === "question/resolved") {
      this.respondable.delete(String(payload.questionRpcId));
    }
  }
  deleteRespondable(value) {
    for (const [rpcId, correlation] of this.respondable) {
      if (correlation === value) this.respondable.delete(rpcId);
    }
  }
};
function needsRemoteDirectoryFallback(response) {
  const result = response.result;
  return typeof result === "object" && result !== null && "ok" in result && result.ok === false && "error" in result && typeof result.error === "object" && result.error !== null && "code" in result.error && result.error.code === "directory-picker-unavailable";
}
function normalizeHostDescribe(response, harnessVersion, canListDirectory) {
  if (!response.result.ok) return response;
  const value = response.result.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return response;
  const description = value;
  const selectedVersion = selectHarnessVersion(
    normalizeHarnessVersion(description.version),
    harnessVersion
  );
  const versionChanged = selectedVersion !== void 0 && description.version !== selectedVersion;
  const canOpenPathChanged = canListDirectory && description.canOpenPath !== true;
  if (!versionChanged && !canOpenPathChanged) return response;
  const normalized = {
    ...description,
    ...versionChanged ? { version: selectedVersion } : {},
    ...canOpenPathChanged ? { canOpenPath: true } : {}
  };
  return {
    ...response,
    result: {
      ...response.result,
      value: normalized
    }
  };
}
function createMethodMap(api, typertGateway) {
  const domains = api;
  const methods = /* @__PURE__ */ new Map();
  for (const method of HARNESS_API_ALLOWLIST) {
    if (method === "commands.execute" || method === "commands.list") {
      if (typertGateway === void 0) continue;
      const [namespace, commandMethod] = method.split(".");
      const implementation2 = async (request, signal) => {
        if (commandMethod === "execute") {
          const payload = commandExecuteSchema.parse(request.payload);
          const args2 = { ...payload, images: payload.images ?? [] };
          const value2 = await typertGateway.invoke({
            namespace,
            method: "execute",
            args: args2,
            ...signal === void 0 ? {} : { signal }
          });
          return { rpcId: request.rpcId, result: { ok: true, value: value2 } };
        }
        const args = commandListSchema.parse(request.payload);
        const value = await typertGateway.invoke({
          namespace,
          method: "list",
          args,
          ...signal === void 0 ? {} : { signal }
        });
        return { rpcId: request.rpcId, result: { ok: true, value } };
      };
      methods.set(method, implementation2);
      continue;
    }
    const [wireDomain, action] = method.split(".");
    const domain = domainProperty(wireDomain);
    const implementation = domains[domain]?.[action];
    if (typeof implementation !== "function") continue;
    const scoped = CONFIG_PLANE_METHODS.includes(method) ? scopeConfigPlaneMethod(api, method, implementation) : void 0;
    methods.set(method, scoped ?? implementation.bind(domains[domain]));
  }
  return methods;
}
function domainProperty(wireDomain) {
  if (wireDomain === "session") return "sessions";
  if (wireDomain === "subagent") return "subagents";
  if (wireDomain === "skill") return "skills";
  if (wireDomain === "agentPreset") return "agentPresets";
  if (wireDomain === "goal") return "goals";
  return wireDomain;
}
var CONFIG_PLANE_METHODS = [
  "llm.discoverModels",
  "settings.describe",
  "settings.update",
  "settings.replace",
  "settings.mutate",
  "credentials.describe",
  "credentials.set",
  "credentials.unset"
];
function scopeConfigPlaneMethod(api, method, native) {
  switch (method) {
    case "llm.discoverModels":
      return async (request, signal) => {
        const payload = parseConfigPlane(discoverModelsSchema, request.payload, "llm.discoverModels");
        if (payload.baseURL !== void 0) validateDiscoverBaseUrl(payload.baseURL);
        try {
          const response = await native({ rpcId: request.rpcId, payload }, signal);
          return sanitizeModelDiscoveryResponse(response, payload.settingsNs);
        } catch {
          return modelDiscoveryFailure(request.rpcId, payload.settingsNs);
        }
      };
    case "settings.describe":
      return async (request, signal) => {
        parseConfigPlane(settingsDescribeSchema, request.payload, "settings.describe");
        const response = await native({ rpcId: request.rpcId, payload: {} }, signal);
        return disableRemoteSettingsDocument(response);
      };
    case "settings.update":
      return async (request, signal) => {
        const payload = parseConfigPlane(settingsUpdateSchema, request.payload, "settings.update");
        await assertRegisteredSettingsNamespace(api, payload.ns);
        assertSerializedBytes(payload.patch, CONFIG_PLANE_SETTINGS_BYTES, "settings.update patch");
        return native({ rpcId: request.rpcId, payload }, signal);
      };
    case "settings.replace":
      return async (request, signal) => {
        const payload = parseConfigPlane(settingsReplaceSchema, request.payload, "settings.replace");
        await assertRegisteredSettingsNamespace(api, payload.ns);
        assertSerializedBytes(payload.section, CONFIG_PLANE_SETTINGS_BYTES, "settings.replace section");
        return native({ rpcId: request.rpcId, payload }, signal);
      };
    case "settings.mutate":
      return async (request, signal) => {
        const payload = parseConfigPlane(settingsMutateSchema, request.payload, "settings.mutate");
        await assertRegisteredSettingsNamespace(api, payload.ns);
        assertSerializedBytes(payload.ops, CONFIG_PLANE_SETTINGS_BYTES, "settings.mutate ops");
        return native({ rpcId: request.rpcId, payload }, signal);
      };
    case "credentials.describe":
      return async (request, signal) => {
        const payload = parseConfigPlane(credentialsDescribeSchema, request.payload, "credentials.describe");
        return native({ rpcId: request.rpcId, payload }, signal);
      };
    case "credentials.set":
      return async (request, signal) => {
        const payload = parseConfigPlane(credentialsSetSchema, request.payload, "credentials.set");
        return native({ rpcId: request.rpcId, payload }, signal);
      };
    case "credentials.unset":
      return async (request, signal) => {
        const payload = parseConfigPlane(credentialsUnsetSchema, request.payload, "credentials.unset");
        return native({ rpcId: request.rpcId, payload }, signal);
      };
  }
}
function parseConfigPlane(schema, payload, label) {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof external_exports.ZodError) {
      throw new RpcError("INVALID_MESSAGE", `The ${label} payload is invalid for the remote channel.`);
    }
    throw error;
  }
}
function validateDiscoverBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new RpcError("INVALID_MESSAGE", "The model discovery baseURL is invalid.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new RpcError("INVALID_MESSAGE", "The model discovery baseURL must use HTTPS (HTTP is allowed only for localhost).");
  }
  if (url.username !== "" || url.password !== "") {
    throw new RpcError("INVALID_MESSAGE", "The model discovery baseURL must not contain credentials.");
  }
  if (url.hash !== "") {
    throw new RpcError("INVALID_MESSAGE", "The model discovery baseURL must not contain a fragment.");
  }
}
function assertSerializedBytes(value, maxBytes, label) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > maxBytes) {
    throw new RpcError("INVALID_MESSAGE", `The ${label} exceeds the ${maxBytes}-byte remote limit.`);
  }
}
function sanitizeModelDiscoveryResponse(response, settingsNs) {
  const result = response.result;
  if (typeof result === "object" && result !== null && "ok" in result && result.ok === true) return response;
  return modelDiscoveryFailure(response.rpcId, settingsNs);
}
function modelDiscoveryFailure(rpcId, settingsNs) {
  return {
    rpcId,
    result: {
      ok: false,
      error: {
        code: "model-discovery-failed",
        message: "Model discovery failed.",
        details: { settingsNs }
      }
    }
  };
}
function disableRemoteSettingsDocument(response) {
  const result = response.result;
  if (typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true) return response;
  const value = result.value;
  if (typeof value !== "object" || value === null) return response;
  return { ...response, result: { ...result, value: { ...value, hasDocument: false } } };
}
var EMPTY_SETTINGS_NAMESPACES = /* @__PURE__ */ new Set();
async function assertRegisteredSettingsNamespace(api, ns) {
  const allowed = await registeredSettingsNamespaces(api);
  if (!allowed.has(ns)) throw deniedSettingsNamespace(ns);
}
async function registeredSettingsNamespaces(api) {
  const settings = api.settings;
  const describe = settings?.describe;
  if (typeof describe !== "function") return EMPTY_SETTINGS_NAMESPACES;
  const response = await withTimeout(
    describe.call(settings, { rpcId: "bridge-settings-scope", payload: {} }, AbortSignal.timeout(NATIVE_CALL_TIMEOUT_MS)),
    NATIVE_CALL_TIMEOUT_MS,
    "The Host settings.describe call timed out."
  );
  const value = unwrapNativeValue(response, "settings.describe");
  const list = typeof value === "object" && value !== null ? value.namespaces : void 0;
  if (!Array.isArray(list)) return EMPTY_SETTINGS_NAMESPACES;
  const namespaces = /* @__PURE__ */ new Set();
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const ns = item.ns;
    if (typeof ns === "string" && ns.length > 0) namespaces.add(ns);
  }
  return namespaces;
}
function unwrapNativeValue(response, method) {
  const result = response.result;
  if (typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true || !("value" in result)) {
    throw new RpcError("INTERNAL_ERROR", `The Host ${method} call did not succeed.`);
  }
  return result.value;
}
function deniedSettingsNamespace(ns) {
  return new RpcError("METHOD_NOT_ALLOWED", `Harness settings namespace ${JSON.stringify(ns)} is not registered on the Host.`);
}
function deniedMethod(method) {
  return new RpcError("METHOD_NOT_ALLOWED", `Harness API method ${JSON.stringify(method)} is not available in remote mode.`);
}
function frameSessionId(frame) {
  const payload = frame.payload;
  return typeof payload.sessionId === "string" && payload.sessionId.length > 0 ? payload.sessionId : void 0;
}
function callSessionHistory(callWithTimeout, payload, rpcId) {
  const fallbackPageSizes = sessionHistoryFallbackPageSizes(payloadMaxMessages(payload));
  return callHistoryWithRetry(callWithTimeout, payload, rpcId, fallbackPageSizes);
}
async function callHistoryWithRetry(callWithTimeout, payload, rpcId, pageSizes) {
  for (const maxMessages of pageSizes) {
    const requestPayload = historyRequestPayload(payload, maxMessages);
    const response = await callWithTimeout(requestPayload);
    const request = createRpcResponse(rpcId, response.result);
    if (encodeMessage(request).byteLength <= MAX_SECURE_MESSAGE_BYTES) return response;
    if (maxMessages === pageSizes[pageSizes.length - 1]) {
      throw new RpcError(
        "RESPONSE_TOO_LARGE",
        "The Host response is too large for the remote channel. Request a smaller page.",
        { maxBytes: MAX_SECURE_MESSAGE_BYTES },
        true
      );
    }
  }
  throw new RpcError("INTERNAL_ERROR", "Failed to load session history with a fallback page size.");
}
function sessionHistoryFallbackPageSizes(requestedMaxMessages) {
  const requested = normalizeSessionHistoryPageSize(requestedMaxMessages);
  const sizes = [];
  if (requested === void 0) {
    sizes.push(...SESSION_HISTORY_PAGE_SIZES);
    return sizes;
  }
  sizes.push(requested);
  for (const value of SESSION_HISTORY_PAGE_SIZES) {
    if (value < requested && !sizes.includes(value)) sizes.push(value);
  }
  return sizes;
}
function normalizeSessionHistoryPageSize(value) {
  if (value === void 0) return void 0;
  if (!Number.isInteger(value)) return void 0;
  if (value <= 0) return void 0;
  return Math.max(1, value);
}
function payloadMaxMessages(payload) {
  if (payload === null || typeof payload !== "object") return void 0;
  const value = payload.maxMessages;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : void 0;
}
function historyRequestPayload(payload, maxMessages) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return { maxMessages };
  return { ...payload, maxMessages };
}
function withTimeout(promise, ms, message) {
  return new Promise((resolve3, reject) => {
    const timer = setTimeout(() => {
      reject(new RpcError("TIMEOUT", message, void 0, true));
    }, ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve3(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
function shortId4(value) {
  return value.length <= 12 ? value : `${value.slice(0, 8)}\u2026${value.slice(-4)}`;
}
function decodeCanonicalBase64(value) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new RpcError("INVALID_MESSAGE", "The Harness API transfer chunk is not canonical base64.");
  }
  return bytes;
}
function concatChunks(chunks, totalBytes) {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

// src/harness-remote-bridge.ts
var endpointSchema = external_exports.string().min(1).max(128).regex(/^(?:\$events(?:\/result)?|[A-Za-z0-9_$.-]+\/[A-Za-z0-9_$.-]+)$/);
var callSchema3 = external_exports.object({ endpoint: endpointSchema, payload: external_exports.unknown() }).strict();
var streamOpenSchema2 = external_exports.object({
  streamId: external_exports.string().min(1).max(128),
  endpoint: endpointSchema,
  payload: external_exports.unknown()
}).strict();
var streamCloseSchema2 = external_exports.object({ streamId: external_exports.string().min(1).max(128) }).strict();
var transferOpenSchema2 = external_exports.object({
  transferId: external_exports.string().uuid(),
  totalBytes: external_exports.number().int().positive().max(MAX_HARNESS_API_TRANSFER_BYTES),
  totalChunks: external_exports.number().int().positive()
}).strict();
var transferChunkSchema2 = external_exports.object({
  transferId: external_exports.string().uuid(),
  index: external_exports.number().int().nonnegative(),
  data: external_exports.string().min(1)
}).strict();
var transferIdSchema2 = external_exports.object({ transferId: external_exports.string().uuid() }).strict();
var transferReadSchema2 = external_exports.object({
  transferId: external_exports.string().uuid(),
  index: external_exports.number().int().nonnegative()
}).strict();
var directoryListSchema2 = external_exports.object({
  path: external_exports.string().min(1).max(4096).optional()
}).strict();
var MAX_ACTIVE_STREAMS = MAX_ALPHA_STREAMS_PER_CONNECTION;
var MAX_ACTIVE_TRANSFERS = MAX_ACTIVE_TRANSFERS_PER_DIRECTION;
var INLINE_TRANSFER_RESPONSE_BYTES2 = 2 * 1024 * 1024;
var HARNESS_REMOTE_ALLOWLIST = [
  "$events",
  "$events/result",
  "agentPresets/list",
  "agentPresets/read",
  "agentPresets/select",
  "commands/execute",
  "commands/list",
  "credentials/describe",
  "credentials/set",
  "credentials/unset",
  "directoryPicker/list",
  "fileReferences/list",
  "goals/clear",
  "goals/complete",
  "goals/create",
  "goals/edit",
  "goals/pause",
  "goals/resume",
  "llm/discoverModels",
  "llm/listConfigurableProviders",
  "llm/listProviders",
  "messageFeedback/delete",
  "messageFeedback/list",
  "messageFeedback/put",
  "pluginInventory/list",
  "session/attachment",
  "session/cancel",
  "session/canOpenWorkspacePath",
  "session/control",
  "session/create",
  "session/follow",
  "session/fork",
  "session/list",
  "session/modelCatalog",
  "session/page",
  "session/prompt",
  "session/rename",
  "session/search",
  "session/selectModel",
  "session/updateQueue",
  "sessionReferenceResolver/candidates",
  "settings/describe",
  "settings/mutate",
  "settings/replace",
  "settings/update",
  "skills/list",
  "subagents/interruptByParent",
  "subagents/list",
  "subagents/prompt",
  "workspace/archiveSession",
  "workspace/create",
  "workspace/delete",
  "workspace/follow",
  "workspace/insertBefore",
  "workspace/insertSessionBefore",
  "workspace/rename"
];
var allowedEndpoints = new Set(HARNESS_REMOTE_ALLOWLIST);
var HarnessRemoteBridge = class {
  constructor(gateway, publish, logger) {
    this.gateway = gateway;
    this.publish = publish;
    this.logger = logger;
  }
  streams = /* @__PURE__ */ new Map();
  incomingTransfers = /* @__PURE__ */ new Map();
  outgoingTransfers = /* @__PURE__ */ new Map();
  async call(input2) {
    const params = callSchema3.parse(input2);
    this.assertAllowed(params.endpoint);
    if (params.endpoint === "session/canOpenWorkspacePath") {
      return { ok: true, value: true };
    }
    const startedAt = performance.now();
    const signal = AbortSignal.timeout(6e4);
    try {
      const nativeResult = await this.gateway.dispatch(params.endpoint, params.payload, signal);
      const result = params.endpoint === "directoryPicker/list" && needsDirectoryFallback(nativeResult) ? await this.directoryList(params.payload, signal) : nativeResult;
      this.logger?.debug("harness remote call ok", {
        endpoint: params.endpoint,
        durationMs: Math.round(performance.now() - startedAt)
      });
      return result;
    } catch (error) {
      if (params.endpoint === "directoryPicker/list") {
        const result = await this.directoryList(params.payload, signal);
        this.logger?.debug("harness remote call ok", {
          endpoint: params.endpoint,
          durationMs: Math.round(performance.now() - startedAt),
          fallback: "directory-browser"
        });
        return result;
      }
      this.logger?.warn("harness remote call failed", {
        endpoint: params.endpoint,
        durationMs: Math.round(performance.now() - startedAt),
        code: this.gateway.failure(error).code
      });
      throw error;
    }
  }
  async directoryList(payload, signal) {
    const args = requestArgs(payload);
    const params = directoryListSchema2.parse(args);
    return { ok: true, value: await listRemoteDirectory(params.path, signal) };
  }
  openTransfer(input2) {
    this.pruneTransfers();
    const params = transferOpenSchema2.parse(input2);
    if (params.totalChunks !== Math.ceil(params.totalBytes / HARNESS_API_TRANSFER_CHUNK_BYTES)) {
      throw new RpcError("INVALID_MESSAGE", "The Harness Remote transfer chunk count is invalid.");
    }
    if (this.incomingTransfers.has(params.transferId) || this.outgoingTransfers.has(params.transferId)) {
      throw new RpcError("REQUEST_CONFLICT", "The Harness Remote transfer id is already active.");
    }
    if (this.incomingTransfers.size >= MAX_ACTIVE_TRANSFERS) {
      throw new RpcError("RATE_LIMITED", "Too many Harness Remote transfers are active.", void 0, true);
    }
    this.incomingTransfers.set(params.transferId, {
      totalBytes: params.totalBytes,
      totalChunks: params.totalChunks,
      chunks: [],
      receivedBytes: 0,
      touchedAt: Date.now()
    });
    return { opened: true, transferId: params.transferId };
  }
  appendTransfer(input2) {
    this.pruneTransfers();
    const params = transferChunkSchema2.parse(input2);
    const transfer = this.incomingTransfers.get(params.transferId);
    if (transfer === void 0) throw new RpcError("TRANSFER_NOT_FOUND", "The Harness Remote transfer is not active.");
    if (params.index !== transfer.chunks.length || params.index >= transfer.totalChunks) {
      this.incomingTransfers.delete(params.transferId);
      throw new RpcError("INVALID_MESSAGE", "Harness Remote transfer chunks must arrive exactly once and in order.");
    }
    const chunk = decodeCanonicalBase642(params.data);
    const expectedBytes = Math.min(
      HARNESS_API_TRANSFER_CHUNK_BYTES,
      transfer.totalBytes - params.index * HARNESS_API_TRANSFER_CHUNK_BYTES
    );
    if (chunk.byteLength !== expectedBytes) {
      this.incomingTransfers.delete(params.transferId);
      throw new RpcError("INVALID_MESSAGE", "The Harness Remote transfer chunk size is invalid.");
    }
    transfer.chunks.push(chunk);
    transfer.receivedBytes += chunk.byteLength;
    transfer.touchedAt = Date.now();
    return { accepted: true, transferId: params.transferId, index: params.index };
  }
  async commitTransfer(input2) {
    this.pruneTransfers();
    const params = transferIdSchema2.parse(input2);
    const transfer = this.incomingTransfers.get(params.transferId);
    if (transfer === void 0) throw new RpcError("TRANSFER_NOT_FOUND", "The Harness Remote transfer is not active.");
    this.incomingTransfers.delete(params.transferId);
    if (transfer.chunks.length !== transfer.totalChunks || transfer.receivedBytes !== transfer.totalBytes) {
      throw new RpcError("INVALID_MESSAGE", "The Harness Remote transfer is incomplete.");
    }
    let request;
    try {
      request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(concatChunks2(transfer.chunks, transfer.totalBytes)));
    } catch {
      throw new RpcError("INVALID_MESSAGE", "The Harness Remote transfer does not contain a valid request.");
    }
    const response = await this.call(callSchema3.parse(request));
    const responseBytes = new TextEncoder().encode(JSON.stringify(response));
    if (responseBytes.byteLength <= INLINE_TRANSFER_RESPONSE_BYTES2) return { kind: "inline", response };
    if (responseBytes.byteLength > MAX_HARNESS_API_TRANSFER_BYTES) {
      throw new RpcError("RESPONSE_TOO_LARGE", "The Harness Remote response exceeds the bounded transfer limit.");
    }
    if (this.outgoingTransfers.size >= MAX_ACTIVE_TRANSFERS) {
      throw new RpcError("RATE_LIMITED", "Too many Harness Remote response transfers are active.", void 0, true);
    }
    const totalChunks = Math.ceil(responseBytes.byteLength / HARNESS_API_TRANSFER_CHUNK_BYTES);
    this.outgoingTransfers.set(params.transferId, {
      bytes: responseBytes,
      totalChunks,
      nextIndex: 0,
      touchedAt: Date.now()
    });
    return { kind: "chunked", transferId: params.transferId, totalBytes: responseBytes.byteLength, totalChunks };
  }
  readTransfer(input2) {
    this.pruneTransfers();
    const params = transferReadSchema2.parse(input2);
    const transfer = this.outgoingTransfers.get(params.transferId);
    if (transfer === void 0) throw new RpcError("TRANSFER_NOT_FOUND", "The Harness Remote response transfer is not active.");
    if (params.index !== transfer.nextIndex || params.index >= transfer.totalChunks) {
      this.outgoingTransfers.delete(params.transferId);
      throw new RpcError("INVALID_MESSAGE", "Harness Remote response chunks must be read exactly once and in order.");
    }
    const start = params.index * HARNESS_API_TRANSFER_CHUNK_BYTES;
    const end = Math.min(start + HARNESS_API_TRANSFER_CHUNK_BYTES, transfer.bytes.byteLength);
    transfer.nextIndex += 1;
    transfer.touchedAt = Date.now();
    return {
      transferId: params.transferId,
      index: params.index,
      data: Buffer.from(transfer.bytes.subarray(start, end)).toString("base64")
    };
  }
  closeTransfer(input2) {
    const params = transferIdSchema2.parse(input2);
    const closed = this.incomingTransfers.delete(params.transferId) || this.outgoingTransfers.delete(params.transferId);
    return { closed, transferId: params.transferId };
  }
  async openStream(input2) {
    const params = streamOpenSchema2.parse(input2);
    this.assertAllowed(params.endpoint);
    if (this.streams.has(params.streamId)) throw new RpcError("REQUEST_CONFLICT", "The Harness Remote stream is already open.");
    if (this.streams.size >= MAX_ACTIVE_STREAMS) {
      throw new RpcError("RATE_LIMITED", "Too many Harness Remote streams are open.", void 0, true);
    }
    const controller = new AbortController();
    const source = await this.gateway.open(params.endpoint, params.payload, controller.signal);
    this.streams.set(params.streamId, { controller });
    void this.pump(params.streamId, source, controller.signal);
    return { opened: true, streamId: params.streamId };
  }
  closeStream(input2) {
    const params = streamCloseSchema2.parse(input2);
    const active = this.streams.get(params.streamId);
    if (active !== void 0) {
      this.streams.delete(params.streamId);
      active.controller.abort("client-closed");
    }
    return { closed: active !== void 0, streamId: params.streamId };
  }
  async closeAll(reason = "peer-disconnected") {
    const streams = [...this.streams.entries()];
    this.streams.clear();
    this.incomingTransfers.clear();
    this.outgoingTransfers.clear();
    for (const [, stream] of streams) stream.controller.abort(reason);
  }
  assertAllowed(endpoint) {
    if (!allowedEndpoints.has(endpoint)) {
      throw new RpcError("METHOD_NOT_ALLOWED", "The requested Harness Remote endpoint is not allowed.");
    }
    if (endpoint === "$events" && !this.gateway.supportsCarrier) {
      throw new RpcError("FEATURE_NOT_SUPPORTED", "This Harness version does not support Remote event transport.");
    }
  }
  async pump(streamId, source, signal) {
    let reason = "completed";
    let failure2;
    try {
      for await (const value of source) {
        if (signal.aborted) break;
        await this.publish("harness.remote.frame", {
          streamId,
          hasValue: true,
          ...value === void 0 ? {} : { value }
        });
      }
      if (signal.aborted) reason = "cancelled";
    } catch (error) {
      reason = signal.aborted ? "cancelled" : "failed";
      if (!signal.aborted) failure2 = this.gateway.failure(error);
    } finally {
      this.streams.delete(streamId);
      await this.publish("harness.remote.stream.closed", {
        streamId,
        reason,
        ...failure2 === void 0 ? {} : { failure: failure2 }
      }).catch(() => void 0);
    }
  }
  pruneTransfers() {
    const cutoff = Date.now() - TRANSFER_IDLE_MS;
    for (const [id2, transfer] of this.incomingTransfers) if (transfer.touchedAt < cutoff) this.incomingTransfers.delete(id2);
    for (const [id2, transfer] of this.outgoingTransfers) if (transfer.touchedAt < cutoff) this.outgoingTransfers.delete(id2);
  }
};
function decodeCanonicalBase642(value) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new RpcError("INVALID_MESSAGE", "The Harness Remote transfer chunk is invalid.");
  return bytes;
}
function concatChunks2(chunks, totalBytes) {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
function needsDirectoryFallback(result) {
  if (result.ok) return false;
  const code = result.error.code.toLocaleLowerCase();
  const message = result.error.message.toLocaleLowerCase();
  return code.includes("capability") || code === "directory-picker/unavailable" || code === "directory-picker-unavailable" || message.includes("browse capability") || message.includes("browser capability") || message.includes("brower capability") || message.includes("directory-picker-unavailable");
}
function requestArgs(payload) {
  const root = record5(payload);
  const args = isRecord8(root.args) ? root.args : root;
  return record5(args.request ?? args._request ?? args);
}
function record5(value) {
  return isRecord8(value) ? value : {};
}
function isRecord8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/codex/domain.ts
import { randomUUID } from "node:crypto";
import { readdir as readdir2, realpath, stat as stat4 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { basename as basename3, isAbsolute as isAbsolute3, join as join5, relative, resolve as resolve2 } from "node:path";

// src/codex/app-server.ts
import { spawn as spawn2 } from "node:child_process";
import { Buffer as Buffer2 } from "node:buffer";
var APP_SERVER_REQUEST_TIMEOUT_MS = 6e4;
var APP_SERVER_START_TIMEOUT_MS = 15e3;
var MAX_APP_SERVER_LINE_BYTES = 288 * 1024 * 1024;
var MAX_STDERR_CAPTURE_BYTES = 4 * 1024;
var CodexAppServerError = class extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
    this.name = "CodexAppServerError";
  }
};
var CodexAppServerClient = class {
  constructor(binary, logger, spawnAppServer = (binary2) => spawn2(binary2, ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  })) {
    this.binary = binary;
    this.logger = logger;
    this.spawnAppServer = spawnAppServer;
  }
  process;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  inboundHandlers = /* @__PURE__ */ new Set();
  unavailableHandlers = /* @__PURE__ */ new Set();
  stdoutBuffer = Buffer2.alloc(0);
  stderrBytes = 0;
  ready = false;
  closed = false;
  failureNotified = false;
  startPromise;
  start() {
    if (this.closed) return Promise.reject(new CodexAppServerError("CODEX_CLOSED", "The Codex domain is closed."));
    if (this.ready) return Promise.resolve();
    this.startPromise ??= this.startOnce().finally(() => {
      this.startPromise = void 0;
    });
    return this.startPromise;
  }
  isReady() {
    return this.ready;
  }
  async call(method, params, timeoutMs = APP_SERVER_REQUEST_TIMEOUT_MS) {
    if (!this.ready) throw new CodexAppServerError("CODEX_UNAVAILABLE", "Codex App Server is not ready.");
    return this.request(method, params, timeoutMs);
  }
  async respond(id2, result) {
    this.write({ id: id2, result });
  }
  async respondError(id2, code, message) {
    this.write({ id: id2, error: { code, message } });
  }
  onInbound(handler) {
    this.inboundHandlers.add(handler);
    return () => this.inboundHandlers.delete(handler);
  }
  onUnavailable(handler) {
    this.unavailableHandlers.add(handler);
    return () => this.unavailableHandlers.delete(handler);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.failPending(new CodexAppServerError("CODEX_CLOSED", "Codex App Server was closed."));
    const child = this.process;
    this.process = void 0;
    if (child === void 0 || child.exitCode !== null || child.killed) return;
    await new Promise((resolve3) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve3();
      }, 2e3);
      timer.unref?.();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve3();
      });
      child.kill("SIGTERM");
    });
  }
  async startOnce() {
    if (this.process !== void 0) {
      throw new CodexAppServerError("CODEX_STARTING", "Codex App Server is already starting.");
    }
    const child = this.spawnAppServer(this.binary);
    this.process = child;
    this.failureNotified = false;
    this.stdoutBuffer = Buffer2.alloc(0);
    this.stderrBytes = 0;
    child.stdout.on("data", (chunk) => this.consumeStdout(Buffer2.from(chunk)));
    child.stderr.on("data", (chunk) => {
      this.stderrBytes = Math.min(MAX_STDERR_CAPTURE_BYTES, this.stderrBytes + Buffer2.byteLength(chunk));
    });
    child.on("error", (error) => this.handleProcessFailure("CODEX_BINARY_UNAVAILABLE", error));
    child.on("exit", (code, signal) => {
      if (this.process !== child) return;
      this.process = void 0;
      this.ready = false;
      this.failPending(new CodexAppServerError("CODEX_APP_SERVER_EXITED", "Codex App Server exited unexpectedly."));
      if (!this.closed) {
        this.logger?.warn("Codex App Server exited", {
          code: code ?? "none",
          signal: signal ?? "none",
          stderrBytes: this.stderrBytes
        });
        this.notifyUnavailable("CODEX_APP_SERVER_EXITED");
      }
    });
    try {
      await this.request("initialize", {
        clientInfo: {
          name: "deepseek_harness_remote",
          title: "DeepSeek Harness Remote",
          version: PLUGIN_VERSION
        },
        capabilities: {
          experimentalApi: true,
          mcpServerOpenaiFormElicitation: false
        }
      }, APP_SERVER_START_TIMEOUT_MS);
      this.write({ method: "initialized", params: {} });
      this.ready = true;
      this.logger?.info("Codex App Server ready");
    } catch (error) {
      child.kill("SIGTERM");
      if (error instanceof CodexAppServerError) throw error;
      throw new CodexAppServerError("CODEX_INITIALIZE_FAILED", "Codex App Server initialization failed.", { cause: error });
    }
  }
  request(method, params, timeoutMs) {
    const id2 = this.nextId++;
    const result = new Promise((resolve3, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id2);
        reject(new CodexAppServerError("CODEX_REQUEST_TIMEOUT", "Codex App Server request timed out."));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id2, { resolve: resolve3, reject, timer });
    });
    try {
      this.write({ id: id2, method, params });
    } catch (error) {
      const pending = this.takePending(id2);
      pending?.reject(error instanceof Error ? error : new Error("Codex App Server write failed."));
    }
    return result;
  }
  write(message) {
    const child = this.process;
    if (child === void 0 || child.stdin.destroyed || !child.stdin.writable) {
      throw new CodexAppServerError("CODEX_UNAVAILABLE", "Codex App Server is not available.");
    }
    child.stdin.write(`${JSON.stringify(message)}
`);
  }
  consumeStdout(chunk) {
    this.stdoutBuffer = this.stdoutBuffer.length === 0 ? chunk : Buffer2.concat([this.stdoutBuffer, chunk]);
    if (this.stdoutBuffer.length > MAX_APP_SERVER_LINE_BYTES) {
      this.handleProcessFailure(
        "CODEX_RESPONSE_TOO_LARGE",
        new Error("Codex App Server emitted an oversized JSONL message.")
      );
      return;
    }
    let newline = this.stdoutBuffer.indexOf(10);
    while (newline >= 0) {
      const line = this.stdoutBuffer.subarray(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (line.length > 0) this.handleLine(line);
      newline = this.stdoutBuffer.indexOf(10);
    }
  }
  handleLine(line) {
    let value;
    try {
      value = JSON.parse(line.toString("utf8"));
    } catch {
      this.handleProcessFailure("CODEX_INVALID_RESPONSE", new Error("Codex App Server emitted invalid JSON."));
      return;
    }
    if (!isRecord9(value)) {
      this.handleProcessFailure("CODEX_INVALID_RESPONSE", new Error("Codex App Server emitted an invalid message."));
      return;
    }
    if ((typeof value.id === "number" || typeof value.id === "string") && ("result" in value || "error" in value)) {
      const pending = this.takePending(value.id);
      if (pending === void 0) return;
      if ("error" in value && value.error !== void 0) {
        pending.reject(new CodexAppServerError("CODEX_UPSTREAM_ERROR", safeUpstreamError(value.error)));
      } else {
        pending.resolve(value.result);
      }
      return;
    }
    if (typeof value.method !== "string" || value.method.length === 0 || value.method.length > 160) return;
    const params = value.params ?? {};
    const inbound = typeof value.id === "string" || typeof value.id === "number" ? { kind: "request", id: value.id, method: value.method, params } : { kind: "notification", method: value.method, params };
    for (const handler of this.inboundHandlers) handler(inbound);
  }
  handleProcessFailure(code, cause) {
    this.ready = false;
    this.failPending(new CodexAppServerError(code, "Codex App Server communication failed.", { cause }));
    const child = this.process;
    this.process = void 0;
    child?.kill("SIGTERM");
    this.logger?.warn("Codex App Server communication failed", { code });
    if (!this.closed) this.notifyUnavailable(code);
  }
  notifyUnavailable(code) {
    if (this.failureNotified) return;
    this.failureNotified = true;
    for (const handler of this.unavailableHandlers) handler(code);
  }
  takePending(id2) {
    const pending = this.pending.get(id2);
    if (pending === void 0) return void 0;
    this.pending.delete(id2);
    clearTimeout(pending.timer);
    return pending;
  }
  failPending(error) {
    for (const id2 of [...this.pending.keys()]) this.takePending(id2)?.reject(error);
  }
};
function safeUpstreamError(value) {
  if (!isRecord9(value) || typeof value.message !== "string") return "Codex App Server rejected the request.";
  const message = value.message.toLowerCase();
  if (message.includes("active writer")) return "Codex thread already has an active writer.";
  return message.includes("not initialized") ? "Codex App Server is not initialized." : "Codex App Server rejected the request.";
}
function isRecord9(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/codex/method-policy.ts
var id = external_exports.string().min(1).max(256);
var cursor = external_exports.string().min(1).max(4096).nullable().optional();
var textInput = external_exports.object({
  type: external_exports.literal("text"),
  text: external_exports.string().min(1).max(256 * 1024)
}).strict();
var imageMediaType = external_exports.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]);
var canonicalBase64 = external_exports.string().min(4).max(288 * 1024 * 1024).refine((value) => value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value), {
  message: "Image data must use canonical base64."
});
var imageInput = external_exports.object({
  type: external_exports.literal("image"),
  mediaType: imageMediaType,
  data: canonicalBase64
}).strict();
var input = external_exports.array(external_exports.union([textInput, imageInput])).min(1).max(16);
var permissionPreset = external_exports.enum(["workspace-write", "danger-full-access"]);
var projectRoot = external_exports.object({
  path: external_exports.string().min(1).max(4096)
}).strict();
var schemas = {
  "account/read": external_exports.object({ refreshToken: external_exports.literal(false).optional() }).strict(),
  "model/list": external_exports.object({
    cursor,
    limit: external_exports.number().int().min(1).max(100).optional(),
    includeHidden: external_exports.boolean().optional()
  }).strict(),
  "project/list": external_exports.object({
    cursor,
    limit: external_exports.number().int().min(1).max(100).optional()
  }).strict(),
  "project/create": external_exports.object({
    name: external_exports.string().trim().min(1).max(256),
    roots: external_exports.array(projectRoot).length(1),
    idempotencyKey: external_exports.string().min(16).max(256)
  }).strict(),
  "thread/list": external_exports.object({
    cursor,
    limit: external_exports.number().int().min(1).max(100).optional(),
    sortKey: external_exports.enum(["created_at", "updated_at", "recency_at"]).optional(),
    sortDirection: external_exports.enum(["asc", "desc"]).optional(),
    modelProviders: external_exports.array(external_exports.string().min(1).max(128)).max(32).nullable().optional(),
    sourceKinds: external_exports.array(external_exports.enum(["cli", "vscode", "exec", "appServer", "unknown"])).max(8).optional(),
    archived: external_exports.boolean().optional(),
    isPinned: external_exports.boolean().optional(),
    cwd: external_exports.union([external_exports.string().min(1).max(4096), external_exports.array(external_exports.string().min(1).max(4096)).min(1).max(32)]).optional(),
    useStateDbOnly: external_exports.boolean().optional(),
    searchTerm: external_exports.string().max(1024).optional()
  }).strict(),
  "thread/read": external_exports.object({ threadId: id, includeTurns: external_exports.boolean().optional() }).strict(),
  "dsh/sessionHistory": external_exports.object({
    threadId: id,
    beforeSeq: external_exports.number().int().nonnegative().optional(),
    throughSeq: external_exports.number().int().min(-1).optional(),
    maxMessages: external_exports.number().int().min(1).max(200).optional()
  }).strict(),
  "dsh/directoryList": external_exports.object({
    path: external_exports.string().min(1).max(4096)
  }).strict(),
  "thread/start": external_exports.object({
    cwd: external_exports.string().min(1).max(4096),
    model: external_exports.string().min(1).max(128).optional(),
    personality: external_exports.string().min(1).max(64).optional(),
    permissionPreset: permissionPreset.optional()
  }).strict(),
  "thread/resume": external_exports.object({
    threadId: id,
    model: external_exports.string().min(1).max(128).optional(),
    permissionPreset: permissionPreset.optional()
  }).strict(),
  "thread/fork": external_exports.object({
    threadId: id,
    lastTurnId: id.optional(),
    permissionPreset: permissionPreset.optional()
  }).strict(),
  "thread/name/set": external_exports.object({ threadId: id, name: external_exports.string().trim().min(1).max(256) }).strict(),
  "thread/archive": external_exports.object({ threadId: id }).strict(),
  "thread/unarchive": external_exports.object({ threadId: id }).strict(),
  "thread/unsubscribe": external_exports.object({ threadId: id }).strict(),
  "turn/start": external_exports.object({
    threadId: id,
    input,
    model: external_exports.string().min(1).max(128).optional(),
    effort: external_exports.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]).optional(),
    summary: external_exports.enum(["auto", "concise", "detailed", "none"]).optional(),
    personality: external_exports.string().min(1).max(64).optional(),
    permissionPreset: permissionPreset.optional()
  }).strict(),
  "turn/steer": external_exports.object({ threadId: id, input, expectedTurnId: id }).strict(),
  "turn/interrupt": external_exports.object({ threadId: id, turnId: id }).strict()
};
var CODEX_APP_ALLOWLIST = Object.freeze(Object.keys(schemas));
function parseCodexCall(method, params) {
  if (!Object.prototype.hasOwnProperty.call(schemas, method)) {
    throw new RpcError("METHOD_NOT_ALLOWED", "The requested Codex method is not available over Remote.");
  }
  const schema = schemas[method];
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new RpcError("INVALID_MESSAGE", "The CodeX call parameters are invalid.");
  return { method, params: parsed.data };
}
function isThreadMutation(method) {
  return method === "turn/start" || method === "turn/steer" || method === "turn/interrupt";
}
function threadIdFromParams(params) {
  return typeof params.threadId === "string" ? params.threadId : void 0;
}

// src/codex/peer-bridge.ts
import { Buffer as Buffer3 } from "node:buffer";
var streamOpenSchema3 = external_exports.object({
  streamId: external_exports.string().min(1).max(128),
  threadId: external_exports.string().min(1).max(256)
}).strict();
var streamCloseSchema3 = external_exports.object({ streamId: external_exports.string().min(1).max(128) }).strict();
var transferOpenSchema3 = external_exports.object({
  transferId: external_exports.string().uuid(),
  totalBytes: external_exports.number().int().positive().max(MAX_CODEX_APP_TRANSFER_BYTES),
  totalChunks: external_exports.number().int().positive()
}).strict();
var transferChunkSchema3 = external_exports.object({
  transferId: external_exports.string().uuid(),
  index: external_exports.number().int().nonnegative(),
  data: external_exports.string().min(1).max(Math.ceil(CODEX_APP_TRANSFER_CHUNK_BYTES / 3) * 4)
}).strict();
var transferIdSchema3 = external_exports.object({ transferId: external_exports.string().uuid() }).strict();
var transferReadSchema3 = external_exports.object({ transferId: external_exports.string().uuid(), index: external_exports.number().int().nonnegative() }).strict();
var MAX_ACTIVE_STREAMS2 = MAX_ALPHA_STREAMS_PER_CONNECTION;
var MAX_ACTIVE_TRANSFERS2 = MAX_ACTIVE_TRANSFERS_PER_DIRECTION;
var INLINE_TRANSFER_RESPONSE_BYTES3 = 2 * 1024 * 1024;
var CodexPeerBridge = class {
  constructor(domain, context, publish, logger) {
    this.domain = domain;
    this.context = context;
    this.publish = publish;
    this.logger = logger;
  }
  streams = /* @__PURE__ */ new Map();
  incomingTransfers = /* @__PURE__ */ new Map();
  outgoingTransfers = /* @__PURE__ */ new Map();
  closed = false;
  async call(input2) {
    return this.callDomain(input2, true);
  }
  async callDomain(input2, logFailure) {
    this.requireOpen();
    try {
      return await this.domain.call(this.context.connectionId, input2);
    } catch (error) {
      if (logFailure) {
        this.logger?.warn("Codex call failed", {
          method: safeMethod(input2),
          code: safeErrorCode2(error)
        });
      }
      throw error;
    }
  }
  respond(input2) {
    this.requireOpen();
    return this.domain.respond(this.context.connectionId, input2);
  }
  async openStream(input2) {
    this.requireOpen();
    const params = streamOpenSchema3.parse(input2);
    if (this.streams.has(params.streamId)) throw new RpcError("REQUEST_CONFLICT", "The Codex stream id is already active.");
    if (this.streams.size >= MAX_ACTIVE_STREAMS2) {
      throw new RpcError("RATE_LIMITED", "Too many Codex streams are active for this connection.", void 0, true);
    }
    await this.domain.call(this.context.connectionId, {
      method: "thread/read",
      params: { threadId: params.threadId, includeTurns: false }
    });
    this.streams.set(params.streamId, params.threadId);
    return { opened: true, streamId: params.streamId, threadId: params.threadId };
  }
  closeStream(input2) {
    const params = streamCloseSchema3.parse(input2);
    this.streams.delete(params.streamId);
    return { closed: true, streamId: params.streamId };
  }
  openTransfer(input2) {
    this.requireOpen();
    this.pruneTransfers();
    const params = transferOpenSchema3.parse(input2);
    if (params.totalChunks !== Math.ceil(params.totalBytes / CODEX_APP_TRANSFER_CHUNK_BYTES)) {
      throw new RpcError("INVALID_MESSAGE", "The Codex transfer chunk count is invalid.");
    }
    if (this.incomingTransfers.has(params.transferId) || this.outgoingTransfers.has(params.transferId)) {
      throw new RpcError("REQUEST_CONFLICT", "The Codex transfer id is already active.");
    }
    if (this.incomingTransfers.size >= MAX_ACTIVE_TRANSFERS2) {
      throw new RpcError("RATE_LIMITED", "Too many Codex transfers are active.", void 0, true);
    }
    this.incomingTransfers.set(params.transferId, {
      totalBytes: params.totalBytes,
      totalChunks: params.totalChunks,
      chunks: [],
      receivedBytes: 0,
      touchedAt: Date.now()
    });
    return { opened: true, transferId: params.transferId };
  }
  appendTransfer(input2) {
    this.requireOpen();
    this.pruneTransfers();
    const params = transferChunkSchema3.parse(input2);
    const transfer = this.incomingTransfers.get(params.transferId);
    if (transfer === void 0) throw new RpcError("TRANSFER_NOT_FOUND", "The Codex transfer is not active.");
    if (params.index !== transfer.chunks.length || params.index >= transfer.totalChunks) {
      this.incomingTransfers.delete(params.transferId);
      throw new RpcError("INVALID_MESSAGE", "Codex transfer chunks must arrive exactly once and in order.");
    }
    const chunk = decodeCanonicalBase643(params.data);
    const expectedBytes = Math.min(
      CODEX_APP_TRANSFER_CHUNK_BYTES,
      transfer.totalBytes - params.index * CODEX_APP_TRANSFER_CHUNK_BYTES
    );
    if (chunk.byteLength !== expectedBytes) {
      this.incomingTransfers.delete(params.transferId);
      throw new RpcError("INVALID_MESSAGE", "The Codex transfer chunk size is invalid.");
    }
    transfer.chunks.push(chunk);
    transfer.receivedBytes += chunk.byteLength;
    transfer.touchedAt = Date.now();
    return { accepted: true, transferId: params.transferId, index: params.index };
  }
  async commitTransfer(input2) {
    this.requireOpen();
    this.pruneTransfers();
    const params = transferIdSchema3.parse(input2);
    const transfer = this.incomingTransfers.get(params.transferId);
    if (transfer === void 0) throw new RpcError("TRANSFER_NOT_FOUND", "The Codex transfer is not active.");
    this.incomingTransfers.delete(params.transferId);
    if (transfer.chunks.length !== transfer.totalChunks || transfer.receivedBytes !== transfer.totalBytes) {
      throw new RpcError("INVALID_MESSAGE", "The Codex transfer is incomplete.");
    }
    let request;
    try {
      request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(concatChunks3(transfer.chunks, transfer.totalBytes)));
    } catch {
      throw new RpcError("INVALID_MESSAGE", "The Codex transfer does not contain a valid request.");
    }
    let response;
    try {
      response = await this.callDomain(request, false);
    } catch (error) {
      this.logger?.warn("Codex transfer call failed", {
        method: safeMethod(request),
        code: safeErrorCode2(error)
      });
      throw error;
    }
    const responseBytes = new TextEncoder().encode(JSON.stringify(response));
    if (responseBytes.byteLength <= INLINE_TRANSFER_RESPONSE_BYTES3) return { kind: "inline", response };
    if (responseBytes.byteLength > MAX_CODEX_APP_TRANSFER_BYTES) {
      throw new RpcError("RESPONSE_TOO_LARGE", "The Codex response exceeds the bounded transfer limit.");
    }
    if (this.outgoingTransfers.size >= MAX_ACTIVE_TRANSFERS2) {
      throw new RpcError("RATE_LIMITED", "Too many Codex response transfers are active.", void 0, true);
    }
    const totalChunks = Math.ceil(responseBytes.byteLength / CODEX_APP_TRANSFER_CHUNK_BYTES);
    this.outgoingTransfers.set(params.transferId, {
      bytes: responseBytes,
      totalChunks,
      nextIndex: 0,
      touchedAt: Date.now()
    });
    return { kind: "chunked", transferId: params.transferId, totalBytes: responseBytes.byteLength, totalChunks };
  }
  readTransfer(input2) {
    this.requireOpen();
    this.pruneTransfers();
    const params = transferReadSchema3.parse(input2);
    const transfer = this.outgoingTransfers.get(params.transferId);
    if (transfer === void 0) throw new RpcError("TRANSFER_NOT_FOUND", "The Codex response transfer is not active.");
    if (params.index !== transfer.nextIndex || params.index >= transfer.totalChunks) {
      this.outgoingTransfers.delete(params.transferId);
      throw new RpcError("INVALID_MESSAGE", "Codex response chunks must be read exactly once and in order.");
    }
    const start = params.index * CODEX_APP_TRANSFER_CHUNK_BYTES;
    const end = Math.min(start + CODEX_APP_TRANSFER_CHUNK_BYTES, transfer.bytes.byteLength);
    transfer.nextIndex += 1;
    transfer.touchedAt = Date.now();
    return {
      transferId: params.transferId,
      index: params.index,
      data: Buffer3.from(transfer.bytes.subarray(start, end)).toString("base64")
    };
  }
  closeTransfer(input2) {
    const params = transferIdSchema3.parse(input2);
    const closed = this.incomingTransfers.delete(params.transferId) || this.outgoingTransfers.delete(params.transferId);
    return { closed, transferId: params.transferId };
  }
  hasThreadSubscription(threadId) {
    return [...this.streams.values()].includes(threadId);
  }
  removeThreadSubscriptions(threadId) {
    for (const [streamId, targetThreadId] of this.streams) {
      if (targetThreadId === threadId) this.streams.delete(streamId);
    }
  }
  async publishInbound(threadId, frame) {
    if (this.closed) return;
    const streamIds = [...this.streams.entries()].filter(([, targetThreadId]) => targetThreadId === threadId).map(([streamId]) => streamId);
    for (const streamId of streamIds) {
      const data = { streamId, frame };
      if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_SECURE_MESSAGE_BYTES) {
        this.streams.delete(streamId);
        await this.publish("codex.app.stream.closed", { streamId, reason: "failed" });
        this.logger?.warn("Codex stream closed after oversized frame", { streamId });
        continue;
      }
      await this.publish("codex.app.frame", data);
    }
  }
  async failStreams(reason = "failed") {
    if (this.closed) return;
    const streamIds = [...this.streams.keys()];
    this.streams.clear();
    this.incomingTransfers.clear();
    this.outgoingTransfers.clear();
    await Promise.all(streamIds.map((streamId) => this.publish("codex.app.stream.closed", {
      streamId,
      reason
    }).catch(() => void 0)));
  }
  async closeAll() {
    if (this.closed) return;
    this.closed = true;
    const streamIds = [...this.streams.keys()];
    this.streams.clear();
    this.incomingTransfers.clear();
    this.outgoingTransfers.clear();
    await Promise.all(streamIds.map((streamId) => this.publish("codex.app.stream.closed", {
      streamId,
      reason: "peer-disconnected"
    }).catch(() => void 0)));
    await this.domain.detachPeer(this.context.connectionId);
  }
  pruneTransfers() {
    const staleBefore = Date.now() - TRANSFER_IDLE_MS;
    for (const [id2, transfer] of this.incomingTransfers) {
      if (transfer.touchedAt < staleBefore) this.incomingTransfers.delete(id2);
    }
    for (const [id2, transfer] of this.outgoingTransfers) {
      if (transfer.touchedAt < staleBefore) this.outgoingTransfers.delete(id2);
    }
  }
  requireOpen() {
    if (this.closed) throw new RpcError("CODEX_CONNECTION_CLOSED", "The Codex connection is closed.");
  }
};
function decodeCanonicalBase643(value) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new RpcError("INVALID_MESSAGE", "The Codex transfer chunk is not canonical base64.");
  }
  const decoded = Buffer3.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new RpcError("INVALID_MESSAGE", "The Codex transfer chunk is not canonical base64.");
  }
  return decoded;
}
function isRecord10(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeErrorCode2(error) {
  if (isRecord10(error) && typeof error.code === "string") return error.code;
  return "UNKNOWN";
}
function safeMethod(input2) {
  return isRecord10(input2) && typeof input2.method === "string" ? input2.method : "invalid";
}
function concatChunks3(chunks, totalBytes) {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

// src/codex/domain.ts
var APPROVAL_TTL_MS = 5 * 6e4;
var DEFAULT_RESTART_DELAYS_MS = [1e3, 2e3, 4e3, 8e3, 15e3];
var CODEX_PAGE_LIMIT2 = 100;
var MAX_CODEX_PAGES2 = 32;
var CODEX_HISTORY_PAGE_LIMIT = 25;
var MAX_CODEX_HISTORY_PAGES = 64;
var CODEX_DIRECTORY_ENTRY_LIMIT = 500;
var CodexRemoteDomain = class {
  constructor(config, logger, createAppServer = (binary, targetLogger) => new CodexAppServerClient(binary, targetLogger), restartDelaysMs = DEFAULT_RESTART_DELAYS_MS) {
    this.config = config;
    this.logger = logger;
    this.createAppServer = createAppServer;
    this.restartDelaysMs = restartDelaysMs;
  }
  appServer;
  unsubscribeInbound;
  unsubscribeUnavailable;
  peers = /* @__PURE__ */ new Map();
  peerDeviceIds = /* @__PURE__ */ new Map();
  turnOwners = /* @__PURE__ */ new Map();
  approvals = /* @__PURE__ */ new Map();
  permissionPresets = /* @__PURE__ */ new Map();
  approvalExpiryTimer;
  restartTimer;
  restartAttempt = 0;
  available = false;
  closed = false;
  state = "disabled";
  unavailableCode;
  async start() {
    if (this.closed) throw new RpcError("CODEX_CLOSED", "The Codex Remote domain is closed.");
    if (!this.config.enabled) return;
    try {
      this.state = "starting";
      await this.launchAppServer();
    } catch (error) {
      this.available = false;
      this.state = "unavailable";
      this.unavailableCode = errorCode3(error);
      await this.disposeAppServer(this.appServer);
      this.logger.warn("Codex Remote domain unavailable", { code: this.unavailableCode });
    }
  }
  isAvailable() {
    return this.available && this.appServer?.isReady() === true;
  }
  status() {
    return {
      enabled: this.config.enabled,
      available: this.isAvailable(),
      state: this.state,
      restartAttempt: this.restartAttempt,
      ...this.unavailableCode === void 0 ? {} : { error: this.unavailableCode }
    };
  }
  createPeer(context, publish) {
    if (!this.config.enabled) return void 0;
    const bridge = new CodexPeerBridge(this, context, publish, this.logger);
    this.peers.set(context.connectionId, bridge);
    this.peerDeviceIds.set(context.connectionId, context.peerDeviceId);
    return bridge;
  }
  async call(connectionId, input2) {
    const envelope = parseCallEnvelope(input2);
    const call = parseCodexCall(envelope.method, envelope.params);
    this.requireAppServer();
    if (call.method === "account/read") {
      return sanitizeAccount(await this.callUpstream(call.method, call.params));
    }
    if (call.method === "project/list") {
      return sanitizeProjectList(await this.callUpstream(call.method, call.params));
    }
    if (call.method === "project/create") {
      const roots = call.params.roots;
      const path = await this.requireNewCodexProjectPath(roots[0].path);
      return sanitizeProjectCreate(await this.callUpstream(call.method, {
        name: call.params.name,
        roots: [{ path }],
        idempotencyKey: call.params.idempotencyKey
      }));
    }
    if (call.method === "thread/list") {
      const result = sanitizeThreadList(await this.callUpstream(call.method, call.params));
      return filterThreadListByWorkspaceAuthority(
        result,
        await this.readWorkspaceAuthority(result.data)
      );
    }
    if (call.method === "thread/start") {
      const cwd = await this.requireCodexWorkspacePath(call.params.cwd);
      const permission = codexPermission(call.params, "workspace-write");
      const result = await this.callUpstream(call.method, {
        ...permission.params,
        cwd,
        ...codexThreadPermissionParams(permission),
        serviceName: "deepseek_harness_remote"
      });
      if (extractThread(result)?.id === void 0) {
        throw new RpcError("CODEX_INVALID_RESPONSE", "Codex App Server returned an invalid thread.");
      }
      this.rememberPermission(extractThread(result).id, result);
      return result;
    }
    const threadId = threadIdFromParams(call.params);
    if (call.method === "dsh/sessionHistory") {
      const thread = await this.readThreadForHistory(connectionId, threadId);
      const page = paginateCodexNativeHistory(
        projectCodexNativeHistory(thread, `codex:${threadId}`),
        {
          beforeSeq: optionalInteger2(call.params.beforeSeq),
          throughSeq: optionalInteger2(call.params.throughSeq),
          maxMessages: optionalInteger2(call.params.maxMessages)
        }
      );
      const activeTurnId2 = typeof page.activeTurnId === "string" ? page.activeTurnId : this.turnOwners.get(threadId)?.turnId;
      return {
        ...page,
        ...activeTurnId2 === void 0 ? {} : { activeTurnId: activeTurnId2 },
        permissionPreset: this.permissionPresets.get(threadId) ?? null
      };
    }
    if (call.method === "dsh/directoryList") {
      return this.listCodexDirectory(call.params.path);
    }
    const allowedThread = threadId === void 0 ? void 0 : await this.readKnownThread(threadId);
    if (call.method === "thread/resume" && call.params.permissionPreset !== void 0) {
      const owner = this.turnOwners.get(threadId);
      if (owner !== void 0 && owner.connectionId !== connectionId) {
        throw new RpcError("CODEX_THREAD_BUSY", "Another Remote client is writing to this CodeX thread.");
      }
      return this.changeThreadPermission(threadId, call.params, allowedThread);
    }
    if (call.method === "thread/read") {
      return this.callUpstream(call.method, call.params);
    }
    if (call.method === "thread/unsubscribe") {
      const bridge = this.peers.get(connectionId);
      bridge?.removeThreadSubscriptions(threadId);
      if (this.hasSubscriber(threadId)) return { status: "unsubscribed" };
      return this.callUpstream(call.method, call.params);
    }
    let claimed = false;
    let previousOwner;
    if (isThreadMutation(call.method) && threadId !== void 0) {
      const claim = this.claimTurn(
        threadId,
        connectionId,
        call.method,
        typeof call.params.turnId === "string" ? call.params.turnId : void 0
      );
      claimed = claim.claimed;
      previousOwner = claim.previous;
    }
    try {
      const permission = codexPermission(call.params);
      const upstreamParams = call.method === "thread/resume" && allowedThread !== void 0 ? {
        ...permission.params,
        ...allowedThread.cwd === void 0 ? {} : { cwd: allowedThread.cwd },
        ...codexThreadPermissionParams(permission),
        excludeTurns: true
      } : call.method === "thread/fork" && allowedThread !== void 0 ? {
        ...permission.params,
        ...allowedThread.cwd === void 0 ? {} : { cwd: allowedThread.cwd },
        ...codexThreadPermissionParams(permission)
      } : call.method === "turn/start" ? {
        ...permission.params,
        ...allowedThread?.cwd === void 0 ? {} : { cwd: allowedThread.cwd },
        ...codexTurnPermissionParams(permission, allowedThread?.cwd)
      } : permission.params;
      let result;
      try {
        result = await this.callUpstream(call.method, upstreamParams);
      } catch (error) {
        if (call.method === "thread/resume" && allowedThread !== void 0 && error instanceof RpcError && error.code === "CODEX_UPSTREAM_ERROR" && call.params.permissionPreset === void 0) {
          return { thread: allowedThread.thread };
        }
        throw error;
      }
      if (call.method === "thread/resume" || call.method === "thread/fork" || call.method === "thread/unarchive") {
        await this.assertResultThreadAllowed(result);
      }
      if (call.method === "thread/resume" || call.method === "thread/fork") {
        const resultId = extractThread(result)?.id;
        if (typeof resultId === "string") {
          this.rememberPermission(resultId, result);
          if (call.params.permissionPreset !== void 0) await this.publishPermission(resultId, result);
        }
      }
      if (call.method === "turn/start" && threadId !== void 0) {
        this.rememberTurnId(threadId, connectionId, extractTurnId(result));
        if (call.params.permissionPreset !== void 0) {
          await this.publishPermission(threadId, codexTurnPermissionParams(permission, allowedThread?.cwd));
        }
      }
      return result;
    } catch (error) {
      if (claimed && threadId !== void 0) {
        if (previousOwner === void 0) this.turnOwners.delete(threadId);
        else this.turnOwners.set(threadId, previousOwner);
      }
      throw mapAppServerError(error);
    }
  }
  async respond(connectionId, input2) {
    await this.expireApprovals();
    const params = parseRespond(input2);
    const approval = this.approvals.get(params.requestHandle);
    if (approval === void 0 || approval.connectionId !== connectionId) {
      throw new RpcError("CODEX_APPROVAL_NOT_FOUND", "The Codex approval is missing, expired, or belongs to another connection.");
    }
    this.approvals.delete(params.requestHandle);
    this.scheduleApprovalExpiry();
    await this.requireAppServer().respond(approval.upstreamId, { decision: params.decision });
    return { resolved: true };
  }
  async detachPeer(connectionId) {
    const bridge = this.peers.get(connectionId);
    if (bridge !== void 0) this.peers.delete(connectionId);
    this.peerDeviceIds.delete(connectionId);
    for (const [threadId, owner] of this.turnOwners) {
      if (owner.connectionId === connectionId) this.turnOwners.delete(threadId);
    }
    const appServer = this.appServer;
    const pending = [...this.approvals.entries()].filter(([, approval]) => approval.connectionId === connectionId);
    for (const [handle, approval] of pending) {
      this.approvals.delete(handle);
      await appServer?.respond(approval.upstreamId, { decision: "decline" }).catch(() => void 0);
    }
    this.scheduleApprovalExpiry();
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.available = false;
    this.state = this.config.enabled ? "unavailable" : "disabled";
    if (this.restartTimer !== void 0) clearTimeout(this.restartTimer);
    this.restartTimer = void 0;
    for (const bridge of [...this.peers.values()]) await bridge.closeAll();
    this.peers.clear();
    this.peerDeviceIds.clear();
    this.turnOwners.clear();
    this.permissionPresets.clear();
    if (this.approvalExpiryTimer !== void 0) clearTimeout(this.approvalExpiryTimer);
    this.approvalExpiryTimer = void 0;
    this.approvals.clear();
    this.unsubscribeInbound?.();
    this.unsubscribeInbound = void 0;
    this.unsubscribeUnavailable?.();
    this.unsubscribeUnavailable = void 0;
    await this.appServer?.close();
    this.appServer = void 0;
  }
  async launchAppServer() {
    let lastError;
    for (const binary of codexBinaryCandidates(this.config.binary)) {
      try {
        await this.launchAppServerCandidate(binary);
        return;
      } catch (error) {
        lastError = error;
        if (!canTryNextBinary(error)) throw error;
      }
    }
    throw lastError ?? new RpcError("CODEX_START_FAILED", "Codex App Server could not be started.");
  }
  async launchAppServerCandidate(binary) {
    const appServer = this.createAppServer(binary, this.logger);
    this.appServer = appServer;
    this.unsubscribeInbound = appServer.onInbound((message) => {
      void this.handleInbound(message).catch((error) => {
        this.logger.warn("Codex inbound handling failed", { code: errorCode3(error) });
      });
    });
    this.unsubscribeUnavailable = appServer.onUnavailable((code) => {
      if (this.available && this.appServer === appServer) {
        void this.handleAppServerUnavailable(appServer, code);
      }
    });
    try {
      await appServer.start();
      const account = await appServer.call("account/read", { refreshToken: false }, 15e3);
      if (!accountCanRun(account)) {
        throw new RpcError("CODEX_AUTH_REQUIRED", "Codex is not signed in on this Host.");
      }
      if (this.closed || this.appServer !== appServer) {
        await appServer.close().catch(() => void 0);
        return;
      }
      this.available = true;
      this.state = "ready";
      this.restartAttempt = 0;
      this.unavailableCode = void 0;
      this.logger.info("Codex Remote domain ready");
    } catch (error) {
      await this.disposeAppServer(appServer);
      throw error;
    }
  }
  async handleAppServerUnavailable(appServer, code) {
    if (this.closed || this.appServer !== appServer) return;
    this.available = false;
    this.state = "restarting";
    this.unavailableCode = code;
    this.turnOwners.clear();
    this.permissionPresets.clear();
    this.approvals.clear();
    if (this.approvalExpiryTimer !== void 0) clearTimeout(this.approvalExpiryTimer);
    this.approvalExpiryTimer = void 0;
    await Promise.all([...this.peers.values()].map((peer) => peer.failStreams("failed")));
    await this.disposeAppServer(appServer);
    this.scheduleRestart();
  }
  scheduleRestart() {
    if (this.closed || this.restartTimer !== void 0) return;
    if (this.restartAttempt >= this.restartDelaysMs.length) {
      this.state = "unavailable";
      this.logger.warn("Codex App Server restart attempts exhausted", { attempts: this.restartAttempt });
      return;
    }
    const delayMs = Math.max(0, this.restartDelaysMs[this.restartAttempt] ?? 0);
    this.restartAttempt += 1;
    this.state = "restarting";
    this.restartTimer = setTimeout(() => {
      this.restartTimer = void 0;
      void this.restartAfterFailure();
    }, delayMs);
    this.restartTimer.unref?.();
    this.logger.warn("Codex App Server restart scheduled", { attempt: this.restartAttempt, delayMs });
  }
  async restartAfterFailure() {
    if (this.closed) return;
    try {
      await this.launchAppServer();
    } catch (error) {
      this.available = false;
      this.state = "restarting";
      this.unavailableCode = errorCode3(error);
      this.logger.warn("Codex App Server restart failed", {
        attempt: this.restartAttempt,
        code: this.unavailableCode
      });
      this.scheduleRestart();
    }
  }
  async disposeAppServer(appServer) {
    if (appServer === void 0 || this.appServer !== appServer) return;
    this.unsubscribeInbound?.();
    this.unsubscribeInbound = void 0;
    this.unsubscribeUnavailable?.();
    this.unsubscribeUnavailable = void 0;
    this.appServer = void 0;
    await appServer.close().catch(() => void 0);
  }
  async handleInbound(message) {
    if (!this.available) return;
    if (message.kind === "request") {
      await this.handleServerRequest(message);
      return;
    }
    const threadId = extractThreadId(message.params);
    if (message.method === "thread/settings/updated" && threadId !== void 0) {
      this.rememberPermission(threadId, message.params);
    }
    if (message.method === "thread/closed" && threadId !== void 0) this.permissionPresets.delete(threadId);
    if (message.method === "turn/completed" && threadId !== void 0) this.turnOwners.delete(threadId);
    if (message.method === "turn/started" && threadId !== void 0) {
      const owner = this.turnOwners.get(threadId);
      const turnId = extractTurnId(message.params);
      if (owner !== void 0) {
        this.turnOwners.set(threadId, { ...owner, ...turnId === void 0 ? {} : { turnId } });
      }
    }
    if (message.method === "serverRequest/resolved") this.resolveUpstreamApproval(message.params);
    if (threadId === void 0) return;
    await Promise.all([...this.peers.values()].map((peer) => peer.publishInbound(threadId, {
      method: message.method,
      params: message.params
    })));
  }
  rememberPermission(threadId, value) {
    const preset = codexPermissionPresetFromResponse(value);
    if (preset === void 0) this.permissionPresets.delete(threadId);
    else this.permissionPresets.set(threadId, preset);
  }
  async changeThreadPermission(threadId, params, allowed) {
    const permission = codexPermission(params);
    const settings = {
      ...codexTurnPermissionParams(permission, allowed.cwd),
      ...params.model === void 0 ? {} : { model: params.model }
    };
    let result;
    try {
      await this.callUpstream("thread/settings/update", { threadId, ...settings });
      result = { thread: allowed.thread, ...settings, sandbox: settings.sandboxPolicy };
    } catch {
      result = await this.callUpstream("thread/resume", {
        ...permission.params,
        ...allowed.cwd === void 0 ? {} : { cwd: allowed.cwd },
        ...codexThreadPermissionParams(permission),
        excludeTurns: true
      });
      await this.assertResultThreadAllowed(result);
      if (codexPermissionPresetFromResponse(result) !== params.permissionPreset) {
        await this.callUpstream("thread/settings/update", { threadId, ...settings });
        result = { ...isRecord11(result) ? result : {}, ...settings, sandbox: settings.sandboxPolicy };
      }
    }
    await this.publishPermission(threadId, result);
    return result;
  }
  async publishPermission(threadId, value) {
    const source = isRecord11(value) ? value : {};
    const threadSettings = { approvalPolicy: source.approvalPolicy, sandboxPolicy: source.sandboxPolicy ?? source.sandbox };
    await this.handleInbound({ kind: "notification", method: "thread/settings/updated", params: { threadId, threadSettings } });
  }
  async handleServerRequest(message) {
    const appServer = this.requireAppServer();
    await this.expireApprovals();
    if (message.method !== "item/commandExecution/requestApproval" && message.method !== "item/fileChange/requestApproval") {
      await appServer.respondError(message.id, -32601, "This Remote client does not support the server request.");
      return;
    }
    const threadId = extractThreadId(message.params);
    const owner = threadId === void 0 ? void 0 : this.turnOwners.get(threadId);
    const peer = owner === void 0 ? void 0 : this.peers.get(owner.connectionId);
    if (threadId === void 0 || owner === void 0 || peer === void 0 || !peer.hasThreadSubscription(threadId)) {
      await appServer.respond(message.id, { decision: "decline" });
      return;
    }
    const requestHandle = randomUUID();
    this.approvals.set(requestHandle, {
      upstreamId: message.id,
      connectionId: owner.connectionId,
      threadId,
      method: message.method,
      expiresAt: Date.now() + APPROVAL_TTL_MS
    });
    this.scheduleApprovalExpiry();
    try {
      await peer.publishInbound(threadId, {
        method: message.method,
        params: sanitizeApprovalParams(message.params, requestHandle)
      });
    } catch (error) {
      this.approvals.delete(requestHandle);
      this.scheduleApprovalExpiry();
      await appServer.respond(message.id, { decision: "decline" }).catch(() => void 0);
      throw error;
    }
  }
  async readKnownThread(threadId) {
    const authority = await this.readWorkspaceAuthority();
    let result;
    try {
      result = await this.callUpstream("thread/read", { threadId, includeTurns: false });
    } catch (error) {
      if (!isHistoryReadRecoverable(error)) throw error;
      const listed = await this.findKnownThreadInList(threadId, authority);
      if (listed === void 0) {
        throw new RpcError("CODEX_THREAD_NOT_ALLOWED", "The Codex thread is not available through this Remote Host.");
      }
      return { thread: listed, ...typeof listed.cwd === "string" && listed.cwd.length > 0 ? { cwd: listed.cwd } : {} };
    }
    const thread = extractThread(result);
    if (thread === void 0 || thread.id !== threadId || !isThreadAllowedByWorkspaceAuthority(thread, authority)) {
      throw new RpcError("CODEX_THREAD_NOT_ALLOWED", "The Codex thread is not available through this Remote Host.");
    }
    return { thread, ...typeof thread.cwd === "string" && thread.cwd.length > 0 ? { cwd: thread.cwd } : {} };
  }
  async readThreadForHistory(connectionId, threadId) {
    const { thread: metadata } = await this.readKnownThread(threadId);
    try {
      return { ...metadata, turns: await this.readThreadTurns(connectionId, threadId, "full") };
    } catch (fullError) {
      if (!isHistoryReadRecoverable(fullError)) throw fullError;
      this.logHistoryFallback(connectionId, "turns-full", fullError);
    }
    try {
      return { ...metadata, turns: await this.readThreadTurns(connectionId, threadId, "summary") };
    } catch (summaryError) {
      if (!isHistoryReadRecoverable(summaryError)) throw summaryError;
      this.logHistoryFallback(connectionId, "turns-summary", summaryError);
    }
    try {
      const legacyResult = await this.callUpstream("thread/read", { threadId, includeTurns: true });
      const legacyThread = extractThread(legacyResult);
      if (legacyThread === void 0 || legacyThread.id !== threadId) {
        throw new RpcError("CODEX_INVALID_RESPONSE", "Codex App Server returned an invalid Thread history.");
      }
      return legacyThread;
    } catch (legacyError) {
      if (!isHistoryReadRecoverable(legacyError)) throw legacyError;
      this.logHistoryFallback(connectionId, "thread-read-full", legacyError);
      return { ...metadata, turns: [] };
    }
  }
  async readThreadTurns(connectionId, threadId, itemsView) {
    const turns = [];
    let cursor2;
    for (let page = 0; page < MAX_CODEX_HISTORY_PAGES; page += 1) {
      const result = await this.callUpstream("thread/turns/list", {
        threadId,
        limit: CODEX_HISTORY_PAGE_LIMIT,
        sortDirection: "asc",
        itemsView,
        ...cursor2 === void 0 ? {} : { cursor: cursor2 }
      });
      const pageResult = isRecord11(result) ? result : {};
      for (const rawTurn of array2(pageResult.data)) {
        if (!isRecord11(rawTurn)) continue;
        const turnId = typeof rawTurn.id === "string" ? rawTurn.id : void 0;
        const items = rawTurn.itemsView === "full" || turnId === void 0 ? array2(rawTurn.items) : await this.readThreadItems(connectionId, threadId, turnId, array2(rawTurn.items));
        turns.push({ ...rawTurn, items });
      }
      cursor2 = typeof pageResult.nextCursor === "string" && pageResult.nextCursor.length > 0 ? pageResult.nextCursor : void 0;
      if (cursor2 === void 0) break;
    }
    return turns;
  }
  async readThreadItems(connectionId, threadId, turnId, fallbackItems) {
    const items = [];
    let cursor2;
    try {
      for (let page = 0; page < MAX_CODEX_HISTORY_PAGES; page += 1) {
        const result = await this.callUpstream("thread/items/list", {
          threadId,
          turnId,
          limit: CODEX_HISTORY_PAGE_LIMIT,
          sortDirection: "asc",
          ...cursor2 === void 0 ? {} : { cursor: cursor2 }
        });
        const pageResult = isRecord11(result) ? result : {};
        for (const entry of array2(pageResult.data)) {
          if (isRecord11(entry) && entry.item !== void 0) items.push(entry.item);
        }
        cursor2 = typeof pageResult.nextCursor === "string" && pageResult.nextCursor.length > 0 ? pageResult.nextCursor : void 0;
        if (cursor2 === void 0) break;
      }
    } catch (error) {
      if (!isHistoryReadRecoverable(error)) throw error;
      this.logHistoryFallback(connectionId, "items", error);
      return fallbackItems;
    }
    return items;
  }
  logHistoryFallback(connectionId, stage, error) {
    this.logger.warn("Codex history read fallback", {
      connectionId: maskId(connectionId),
      stage,
      code: errorCode3(error)
    });
  }
  async assertResultThreadAllowed(result) {
    const thread = extractThread(result);
    if (thread === void 0 || typeof thread.id !== "string") {
      throw new RpcError("CODEX_INVALID_RESPONSE", "Codex App Server returned an invalid thread.");
    }
    if (!isThreadAllowedByWorkspaceAuthority(thread, await this.readWorkspaceAuthority())) {
      throw new RpcError("CODEX_THREAD_NOT_ALLOWED", "The Codex thread is not available through this Remote Host.");
    }
  }
  claimTurn(threadId, connectionId, method, turnId) {
    const owner = this.turnOwners.get(threadId);
    const peerDeviceId = this.peerDeviceIds.get(connectionId) ?? connectionId;
    const nextOwner = { connectionId, peerDeviceId, ...turnId === void 0 ? {} : { turnId } };
    if (method === "turn/interrupt") {
      if (owner === void 0) {
        this.turnOwners.set(threadId, nextOwner);
        return { claimed: true };
      }
      if (owner.connectionId !== connectionId && owner.peerDeviceId !== peerDeviceId) {
        throw new RpcError("CODEX_TURN_OWNED", "Only the connection that started this Codex turn can interrupt it.");
      }
      if (owner.connectionId !== connectionId) {
        this.turnOwners.set(threadId, { ...owner, connectionId, peerDeviceId, ...turnId === void 0 ? {} : { turnId } });
        return { claimed: true, previous: owner };
      }
      if (turnId !== void 0 && owner.turnId === void 0) this.turnOwners.set(threadId, { ...owner, turnId });
      return { claimed: false };
    }
    if (owner !== void 0 && owner.connectionId !== connectionId && owner.peerDeviceId !== peerDeviceId) {
      throw new RpcError("CODEX_TURN_OWNED", "Another Remote connection owns the active Codex turn.");
    }
    if (owner?.connectionId === connectionId) return { claimed: false };
    this.turnOwners.set(threadId, owner === void 0 ? nextOwner : { ...owner, connectionId, peerDeviceId });
    return { claimed: true, previous: owner };
  }
  rememberTurnId(threadId, connectionId, turnId) {
    if (turnId === void 0) return;
    const owner = this.turnOwners.get(threadId);
    if (owner === void 0 || owner.connectionId !== connectionId) return;
    this.turnOwners.set(threadId, { ...owner, turnId });
  }
  hasSubscriber(threadId) {
    return [...this.peers.values()].some((peer) => peer.hasThreadSubscription(threadId));
  }
  resolveUpstreamApproval(params) {
    if (!isRecord11(params) || typeof params.requestId !== "string" && typeof params.requestId !== "number") return;
    for (const [handle, approval] of this.approvals) {
      if (approval.upstreamId === params.requestId) this.approvals.delete(handle);
    }
  }
  async expireApprovals() {
    const now = Date.now();
    const appServer = this.appServer;
    for (const [handle, approval] of this.approvals) {
      if (approval.expiresAt > now) continue;
      this.approvals.delete(handle);
      await appServer?.respond(approval.upstreamId, { decision: "decline" }).catch(() => void 0);
    }
    this.scheduleApprovalExpiry();
  }
  scheduleApprovalExpiry() {
    if (this.approvalExpiryTimer !== void 0) clearTimeout(this.approvalExpiryTimer);
    this.approvalExpiryTimer = void 0;
    const nextExpiry = Math.min(...[...this.approvals.values()].map((approval) => approval.expiresAt));
    if (!Number.isFinite(nextExpiry)) return;
    this.approvalExpiryTimer = setTimeout(() => {
      this.approvalExpiryTimer = void 0;
      void this.expireApprovals().catch((error) => {
        this.logger.warn("Codex approval expiry failed", { code: errorCode3(error) });
      });
    }, Math.max(0, nextExpiry - Date.now()));
    this.approvalExpiryTimer.unref?.();
  }
  requireAppServer() {
    if (!this.isAvailable() || this.appServer === void 0) {
      throw new RpcError("CODEX_UNAVAILABLE", "Codex Remote is disabled or unavailable on this Host.");
    }
    return this.appServer;
  }
  async callUpstream(method, params) {
    try {
      return await this.requireAppServer().call(method, params);
    } catch (error) {
      throw mapAppServerError(error);
    }
  }
  async readWorkspaceAuthority(listedThreads) {
    const projectIds = /* @__PURE__ */ new Set();
    const roots = [];
    let cursor2;
    try {
      for (let page = 0; page < MAX_CODEX_PAGES2; page += 1) {
        const result = sanitizeProjectList(await this.callUpstream("project/list", {
          limit: CODEX_PAGE_LIMIT2,
          ...cursor2 === void 0 ? {} : { cursor: cursor2 }
        }));
        for (const project of result.data) {
          const projectRoots = project.roots.map((root) => root.path).filter((path) => isAbsolute3(path));
          if (projectRoots.length === 0) continue;
          projectIds.add(project.id);
          roots.push(...projectRoots);
        }
        cursor2 = typeof result.nextCursor === "string" && result.nextCursor.length > 0 ? result.nextCursor : void 0;
        if (cursor2 === void 0) break;
      }
    } catch (error) {
      if (!isProjectListFallbackError(error)) throw error;
    }
    if (roots.length > 0) return { projectIds, roots };
    const threads = listedThreads === void 0 ? [] : [...listedThreads];
    if (listedThreads === void 0) {
      cursor2 = void 0;
      for (let page = 0; page < MAX_CODEX_PAGES2; page += 1) {
        const result = sanitizeThreadList(await this.callUpstream("thread/list", {
          limit: CODEX_PAGE_LIMIT2,
          sortKey: "updated_at",
          sortDirection: "desc",
          archived: false,
          ...cursor2 === void 0 ? {} : { cursor: cursor2 }
        }));
        threads.push(...result.data);
        cursor2 = typeof result.nextCursor === "string" && result.nextCursor.length > 0 ? result.nextCursor : void 0;
        if (cursor2 === void 0) break;
      }
    }
    for (const workspace of deriveCodexCwdWorkspaces(threads)) {
      if (isAbsolute3(workspace.path)) roots.push(workspace.path);
    }
    return { projectIds, roots };
  }
  async findKnownThreadInList(threadId, authority) {
    let cursor2;
    for (let page = 0; page < MAX_CODEX_PAGES2; page += 1) {
      const result = sanitizeThreadList(await this.callUpstream("thread/list", {
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
        ...cursor2 === void 0 ? {} : { cursor: cursor2 }
      }));
      const thread = result.data.find((item) => item.id === threadId);
      if (thread !== void 0) {
        return isThreadAllowedByWorkspaceAuthority(thread, authority) ? thread : void 0;
      }
      cursor2 = typeof result.nextCursor === "string" && result.nextCursor.length > 0 ? result.nextCursor : void 0;
      if (cursor2 === void 0) break;
    }
    return void 0;
  }
  async requireCodexWorkspacePath(path) {
    if (!isAbsolute3(path)) {
      throw new RpcError("CODEX_PATH_NOT_ALLOWED", "The CodeX working directory is not available as a Workspace.");
    }
    const paths = await this.listCodexWorkspacePaths();
    const lexicalCandidate = resolve2(path);
    let candidate;
    try {
      candidate = await realpath(path);
      if (!(await stat4(candidate)).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new RpcError("CODEX_PATH_NOT_ALLOWED", "The CodeX working directory is not available as a Workspace.");
    }
    for (const root of paths.values()) {
      try {
        if (!containsCodexPath(resolve2(root), lexicalCandidate)) continue;
        const canonicalRoot = await realpath(root);
        if (containsCodexPath(canonicalRoot, candidate)) return lexicalCandidate;
      } catch {
      }
    }
    throw new RpcError("CODEX_PATH_NOT_ALLOWED", "The CodeX working directory is not available as a Workspace.");
  }
  async requireNewCodexProjectPath(path) {
    if (!isAbsolute3(path)) {
      throw new RpcError("CODEX_PATH_NOT_ALLOWED", "The CodeX project directory must be an existing absolute directory.");
    }
    try {
      const canonical = await realpath(resolve2(path));
      if (!(await stat4(canonical)).isDirectory()) throw new Error("not a directory");
      return canonical;
    } catch {
      throw new RpcError("CODEX_PATH_NOT_ALLOWED", "The CodeX project directory must be an existing absolute directory.");
    }
  }
  async listCodexDirectory(path) {
    const target = await this.resolveCodexDirectory(path);
    const rows = await readdir2(target.path, { withFileTypes: true }).catch(() => void 0);
    if (rows === void 0) {
      throw new RpcError("CODEX_PATH_NOT_ALLOWED", "The CodeX working directory is not available as a Workspace.");
    }
    const entries = [];
    for (const row of rows) {
      const child = resolve2(target.path, row.name);
      let directory = row.isDirectory();
      if (!directory && row.isSymbolicLink()) {
        directory = await stat4(child).then((value) => value.isDirectory()).catch(() => false);
      }
      if (!directory) continue;
      try {
        const canonicalChild = await realpath(child);
        if (!(await stat4(canonicalChild)).isDirectory()) continue;
        if (!containsCodexPath(target.canonicalRoot, canonicalChild)) continue;
      } catch {
        continue;
      }
      entries.push({
        name: row.name,
        path: child,
        hidden: process.platform !== "win32" && row.name.startsWith(".")
      });
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, void 0, { sensitivity: "base" }));
    return {
      path: target.path,
      home: target.root,
      crumbs: codexDirectoryCrumbs(target.root, target.path),
      entries: entries.slice(0, CODEX_DIRECTORY_ENTRY_LIMIT),
      truncated: entries.length > CODEX_DIRECTORY_ENTRY_LIMIT
    };
  }
  async resolveCodexDirectory(path) {
    if (!isAbsolute3(path)) {
      throw new RpcError("CODEX_PATH_NOT_ALLOWED", "The CodeX working directory is not available as a Workspace.");
    }
    const authority = await this.readWorkspaceAuthority();
    const lexicalCandidate = resolve2(path);
    let canonicalCandidate;
    try {
      canonicalCandidate = await realpath(path);
      if (!(await stat4(canonicalCandidate)).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new RpcError("CODEX_PATH_NOT_ALLOWED", "The CodeX working directory is not available as a Workspace.");
    }
    for (const root of authority.roots) {
      try {
        const lexicalRoot = resolve2(root);
        if (!containsCodexPath(lexicalRoot, lexicalCandidate)) continue;
        const canonicalRoot = await realpath(root);
        if (containsCodexPath(canonicalRoot, canonicalCandidate)) {
          return { path: lexicalCandidate, root: lexicalRoot, canonicalRoot };
        }
      } catch {
      }
    }
    throw new RpcError("CODEX_PATH_NOT_ALLOWED", "The CodeX working directory is not available as a Workspace.");
  }
  async listCodexWorkspacePaths() {
    const paths = /* @__PURE__ */ new Map();
    const authority = await this.readWorkspaceAuthority();
    for (const root of authority.roots) paths.set(normalizeCodexPathForCompare(root), root);
    return paths;
  }
};
function codexBinaryCandidates(configured, hostPlatform = process.platform, userHome = homedir3()) {
  if (configured !== "codex" || hostPlatform !== "darwin") return [configured];
  return [.../* @__PURE__ */ new Set([
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    join5(userHome, "Applications", "ChatGPT.app", "Contents", "Resources", "codex"),
    configured
  ])];
}
function parseCallEnvelope(input2) {
  if (!isRecord11(input2) || typeof input2.method !== "string" || !("params" in input2) || Object.keys(input2).some((key) => key !== "method" && key !== "params")) {
    throw new RpcError("INVALID_MESSAGE", "The Codex call envelope is invalid.");
  }
  return { method: input2.method, params: input2.params };
}
function parseRespond(input2) {
  if (!isRecord11(input2) || typeof input2.requestHandle !== "string" || !["accept", "decline", "cancel"].includes(String(input2.decision)) || Object.keys(input2).some((key) => key !== "requestHandle" && key !== "decision")) {
    throw new RpcError("INVALID_MESSAGE", "The Codex approval response is invalid.");
  }
  return input2;
}
function accountCanRun(result) {
  if (!isRecord11(result) || typeof result.requiresOpenaiAuth !== "boolean") return false;
  return result.requiresOpenaiAuth === false || isRecord11(result.account);
}
function sanitizeAccount(result) {
  if (!isRecord11(result)) throw new RpcError("CODEX_INVALID_RESPONSE", "Codex App Server returned invalid account state.");
  const account = isRecord11(result.account) ? result.account : void 0;
  return {
    authenticated: account !== void 0 || result.requiresOpenaiAuth === false,
    requiresOpenaiAuth: result.requiresOpenaiAuth === true,
    ...account === void 0 ? {} : {
      account: {
        ...typeof account.type === "string" ? { type: account.type } : {},
        ...typeof account.planType === "string" ? { planType: account.planType } : {}
      }
    }
  };
}
function sanitizeThreadList(result) {
  if (!isRecord11(result) || !Array.isArray(result.data)) {
    throw new RpcError("CODEX_INVALID_RESPONSE", "Codex App Server returned an invalid thread list.");
  }
  const data = result.data.flatMap((value) => {
    if (!isRecord11(value) || typeof value.id !== "string") return [];
    return [{
      id: value.id,
      ...typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {},
      ...typeof value.projectId === "string" ? { projectId: value.projectId } : {},
      ...typeof value.name === "string" ? { name: value.name } : {},
      ...typeof value.preview === "string" ? { preview: value.preview } : {},
      ...typeof value.cwd === "string" ? { cwd: value.cwd } : {},
      ...typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? { createdAt: value.createdAt } : {},
      ...typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? { updatedAt: value.updatedAt } : {},
      ...typeof value.archived === "boolean" ? { archived: value.archived } : {},
      ...typeof value.isPinned === "boolean" ? { isPinned: value.isPinned } : {},
      ...isRecord11(value.status) ? { status: value.status } : {}
    }];
  });
  return {
    data,
    ...typeof result.nextCursor === "string" && result.nextCursor.length > 0 ? { nextCursor: result.nextCursor } : { nextCursor: null },
    ...typeof result.backwardsCursor === "string" && result.backwardsCursor.length > 0 ? { backwardsCursor: result.backwardsCursor } : {}
  };
}
function filterThreadListByWorkspaceAuthority(result, authority) {
  if (!isRecord11(result) || !Array.isArray(result.data)) {
    throw new RpcError("CODEX_INVALID_RESPONSE", "Codex App Server returned an invalid thread list.");
  }
  return {
    ...result,
    data: result.data.map((record6) => isRecord11(record6) ? record6 : void 0).filter((thread) => thread !== void 0 && isThreadAllowedByWorkspaceAuthority(thread, authority))
  };
}
function sanitizeProject(value) {
  if (!isRecord11(value) || typeof value.id !== "string" || typeof value.name !== "string") return void 0;
  const roots = Array.isArray(value.roots) ? value.roots.flatMap((root) => {
    const path = isRecord11(root) && typeof root.path === "string" && root.path.length > 0 ? root.path : void 0;
    return path === void 0 || !isAbsolute3(path) ? [] : [{ path }];
  }) : [];
  if (roots.length === 0) return void 0;
  return {
    id: value.id,
    name: value.name,
    roots,
    ...typeof value.position === "number" && Number.isFinite(value.position) ? { position: value.position } : {},
    ...typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? { createdAt: value.createdAt } : {},
    ...typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? { updatedAt: value.updatedAt } : {}
  };
}
function sanitizeProjectList(result) {
  if (!isRecord11(result) || !Array.isArray(result.data)) {
    throw new RpcError("CODEX_INVALID_RESPONSE", "Codex App Server returned an invalid project list.");
  }
  const data = result.data.flatMap((value) => sanitizeProject(value) ?? []);
  return {
    data,
    ...typeof result.nextCursor === "string" && result.nextCursor.length > 0 ? { nextCursor: result.nextCursor } : { nextCursor: null }
  };
}
function sanitizeProjectCreate(result) {
  const project = isRecord11(result) ? sanitizeProject(result.project) : void 0;
  if (project === void 0) {
    throw new RpcError("CODEX_INVALID_RESPONSE", "Codex App Server returned an invalid created project.");
  }
  return { project };
}
function isThreadAllowedByWorkspaceAuthority(thread, authority) {
  const projectId = typeof thread.projectId === "string" ? thread.projectId : void 0;
  if (projectId !== void 0 && authority.projectIds.has(projectId)) return true;
  const cwd = typeof thread.cwd === "string" ? thread.cwd : void 0;
  return cwd !== void 0 && authority.roots.some((root) => containsCodexPath(root, cwd));
}
function containsCodexPath(root, candidate) {
  const normalizedRoot = normalizeCodexPathForCompare(root);
  const normalizedCandidate = normalizeCodexPathForCompare(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`) || normalizedCandidate.startsWith(`${normalizedRoot}\\`);
}
function normalizeCodexPathForCompare(path) {
  return path.replace(/[\\/]+$/u, "") || path;
}
function codexDirectoryCrumbs(root, path) {
  const crumbs2 = [{ name: basename3(root) || root, path: root, hidden: false }];
  const remainder = relative(root, path);
  if (remainder === "") return crumbs2;
  let current = root;
  for (const segment of remainder.split(/[\\/]+/u).filter(Boolean)) {
    current = resolve2(current, segment);
    crumbs2.push({ name: segment, path: current, hidden: false });
  }
  return crumbs2;
}
function extractThread(result) {
  return isRecord11(result) && isRecord11(result.thread) ? result.thread : void 0;
}
function extractTurnId(result) {
  if (!isRecord11(result)) return void 0;
  if (typeof result.turnId === "string" && result.turnId.length > 0) return result.turnId;
  if (isRecord11(result.turn) && typeof result.turn.id === "string" && result.turn.id.length > 0) return result.turn.id;
  return void 0;
}
function extractThreadId(params) {
  if (!isRecord11(params)) return void 0;
  if (typeof params.threadId === "string") return params.threadId;
  if (isRecord11(params.thread) && typeof params.thread.id === "string") return params.thread.id;
  if (isRecord11(params.turn) && typeof params.turn.threadId === "string") return params.turn.threadId;
  return void 0;
}
function optionalInteger2(value) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : void 0;
}
function codexPermission(params, fallbackPreset) {
  const { permissionPreset: permissionPreset2, ...rest } = params;
  const preset = permissionPreset2 === "workspace-write" || permissionPreset2 === "danger-full-access" ? permissionPreset2 : fallbackPreset;
  if (preset === void 0) return { params: mapCodexImageInputs(rest) };
  const fullAccess = preset === "danger-full-access";
  return {
    params: mapCodexImageInputs(rest),
    approvalPolicy: fullAccess ? "never" : "on-request",
    sandbox: fullAccess ? "danger-full-access" : "workspace-write"
  };
}
function codexThreadPermissionParams(permission) {
  if (permission.approvalPolicy === void 0 || permission.sandbox === void 0) return {};
  return {
    approvalPolicy: permission.approvalPolicy,
    sandbox: permission.sandbox
  };
}
function codexTurnPermissionParams(permission, cwd) {
  if (permission.approvalPolicy === void 0 || permission.sandbox === void 0) return {};
  return {
    approvalPolicy: permission.approvalPolicy,
    sandboxPolicy: permission.sandbox === "danger-full-access" ? { type: "dangerFullAccess" } : {
      type: "workspaceWrite",
      writableRoots: cwd === void 0 ? [] : [cwd],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    }
  };
}
function mapCodexImageInputs(params) {
  if (!Array.isArray(params.input)) return params;
  return {
    ...params,
    input: params.input.map((value) => {
      if (!isRecord11(value) || value.type !== "image" || typeof value.mediaType !== "string" || typeof value.data !== "string") return value;
      return { type: "image", url: `data:${value.mediaType};base64,${value.data}` };
    })
  };
}
function sanitizeApprovalParams(params, requestHandle) {
  if (!isRecord11(params)) return { requestHandle };
  const safe = { ...params };
  delete safe.proposedExecpolicyAmendment;
  delete safe.additionalPermissions;
  safe.availableDecisions = ["accept", "decline", "cancel"];
  safe.requestHandle = requestHandle;
  return safe;
}
function mapAppServerError(error) {
  if (error instanceof RpcError) return error;
  if (error instanceof CodexAppServerError) {
    if (error.code === "CODEX_UPSTREAM_ERROR" && isActiveWriterMessage(error.message)) {
      return new RpcError("CODEX_THREAD_BUSY", "The selected CodeX thread is already active in another CodeX client.");
    }
    return new RpcError(error.code, error.message, void 0, error.code === "CODEX_REQUEST_TIMEOUT");
  }
  return new RpcError("CODEX_UPSTREAM_ERROR", "Codex App Server could not complete the request.");
}
function errorCode3(error) {
  if (error instanceof RpcError || error instanceof CodexAppServerError) return error.code;
  return "CODEX_START_FAILED";
}
function isHistoryReadRecoverable(error) {
  return error instanceof RpcError && ["METHOD_NOT_ALLOWED", "METHOD_NOT_FOUND", "CODEX_UPSTREAM_ERROR", "CODEX_REQUEST_TIMEOUT", "CODEX_THREAD_BUSY"].includes(error.code);
}
function isProjectListFallbackError(error) {
  return error instanceof RpcError && ["METHOD_NOT_ALLOWED", "METHOD_NOT_FOUND", "CODEX_UPSTREAM_ERROR"].includes(error.code);
}
function canTryNextBinary(error) {
  return !(error instanceof RpcError) || !["CODEX_AUTH_REQUIRED", "CODEX_CLOSED"].includes(error.code);
}
function isRecord11(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function array2(value) {
  return Array.isArray(value) ? value : [];
}
function maskId(value) {
  return value.length <= 12 ? value : `${value.slice(0, 8)}\u2026${value.slice(-4)}`;
}
function isActiveWriterMessage(message) {
  return message.toLowerCase().includes("active writer");
}

// src/service.ts
var HostPluginRuntime = class {
  constructor(config, identities, apiProxy, logger, localGateway, fileViewerHost) {
    this.config = config;
    this.identities = identities;
    this.apiProxy = apiProxy;
    this.logger = logger;
    this.localGateway = localGateway;
    this.fileViewerHost = fileViewerHost;
    this.codex = new CodexRemoteDomain(config.codex, logger);
    this.connections = new ConnectionController(this.identities, (context, send) => {
      const harnessApi = this.apiProxy === void 0 ? void 0 : new HarnessApiBridge(
        this.apiProxy,
        (event, data) => send(createEvent(event, data)),
        void 0,
        this.logger,
        this.localGateway,
        this.harnessVersion
      );
      const harnessRemote = this.localGateway?.supportsCarrier === true ? new HarnessRemoteBridge(
        this.localGateway,
        (event, data) => send(createEvent(event, data)),
        this.logger
      ) : void 0;
      const fileViewer = new RemoteFileViewerBridge(
        () => this.fileViewerHost?.(),
        this.logger
      );
      const codex = this.codex.createPeer(
        context,
        (event, data) => send(createEvent(event, data))
      );
      return new RpcRouter(
        harnessApi,
        void 0,
        this.logger,
        fileViewer,
        harnessRemote,
        () => this.hostCapabilities(),
        codex
      );
    }, this.logger);
    if (config.serverUrl !== void 0) {
      this.serverApi = new HostServerApi(config.serverUrl, new ServerCredentialStore(identities.directory));
    }
  }
  connections;
  identity;
  serverApi;
  serverConnection;
  harnessVersion;
  closed = false;
  codex;
  localCodexPeer;
  localCodexPublish = async () => void 0;
  async start() {
    if (this.closed) throw new Error("remote runtime is closed");
    this.identity = await this.identities.loadOrCreate(this.config.deviceName);
    this.logger.info("host identity ready", {
      deviceId: shortId5(this.identity.deviceId),
      fingerprint: this.identity.fingerprint,
      server: this.config.serverUrl ?? "not configured"
    });
    await this.codex.start();
    if (this.serverApi !== void 0) {
      this.harnessVersion = await this.readHarnessVersion();
      this.serverApi.setHarnessVersion(this.harnessVersion);
      this.serverApi.bindIdentity(this.identity);
      this.serverConnection = this.createServerConnection(this.identity);
      this.serverConnection.start();
    }
  }
  currentIdentity() {
    if (this.identity === void 0) throw new Error("remote runtime has not started");
    return this.identity;
  }
  acceptAuthenticatedPeer(channel) {
    this.currentIdentity();
    return this.connections.accept(channel);
  }
  hostStatus() {
    const error = this.serverConnection?.lastError();
    const authorization = this.serverApi?.currentAuthorization();
    return {
      ...this.identity === void 0 ? {} : { deviceId: this.identity.deviceId },
      configured: this.serverApi !== void 0,
      online: this.serverConnection?.isOnline() ?? false,
      reconnecting: this.serverConnection?.isReconnecting() ?? false,
      ...this.serverConnection?.lastActivity() === void 0 ? {} : { lastActiveAt: this.serverConnection.lastActivity() },
      ...error === void 0 ? {} : { error },
      ...authorization?.account === void 0 ? {} : { account: authorization.account },
      authorized: authorization !== void 0,
      accountRequired: error === "ACCOUNT_AUTH_REQUIRED" || error === "AUTH_INVALID" || error === "TOKEN_EXPIRED"
    };
  }
  localHarnessVersion() {
    return this.harnessVersion;
  }
  reconnectHost() {
    if (this.closed) throw new Error("remote runtime is closed");
    if (this.serverConnection === void 0) {
      throw new ServerApiError("SERVER_NOT_CONFIGURED", "Configure serverUrl before reconnecting.", false);
    }
    this.serverConnection.reconnect();
  }
  async startHostOAuthQrLogin(provider) {
    if (this.serverApi === void 0) {
      throw new ServerApiError("SERVER_NOT_CONFIGURED", "Remote Host Server is unavailable.", false);
    }
    return this.serverApi.startOAuthQrLogin(provider);
  }
  async pollHostOAuthQrLogin(qrId) {
    if (this.serverApi === void 0) {
      throw new ServerApiError("SERVER_NOT_CONFIGURED", "Remote Host Server is unavailable.", false);
    }
    const result = await this.serverApi.pollOAuthQrLogin(this.currentIdentity(), qrId, async () => {
      await this.serverConnection?.stop();
      this.identity = await this.identities.reset(this.config.deviceName);
      this.serverApi.bindIdentity(this.identity);
      this.serverConnection = this.createServerConnection(this.identity);
      return this.identity;
    });
    if (result.status === "complete") {
      this.serverConnection?.reconnect();
      this.logger.info("Host account authorized through OAuth QR login");
    }
    return result;
  }
  async clearHostAuthorization() {
    await this.serverConnection?.stop();
    let revokeFailure;
    try {
      await this.serverApi?.revokeCurrentDevice();
    } catch (error) {
      revokeFailure = error;
    }
    this.identity = await this.identities.reset(this.config.deviceName);
    this.serverApi?.bindIdentity(this.identity);
    if (this.serverApi !== void 0) this.serverConnection = this.createServerConnection(this.identity);
    this.logger.info("Host authorization cleared");
    if (revokeFailure !== void 0) throw revokeFailure;
  }
  async authorizeHostAsOwned(accessToken, account) {
    if (this.serverApi === void 0) {
      throw new ServerApiError("SERVER_NOT_CONFIGURED", "Configure serverUrl before enabling Host access.", false);
    }
    let result;
    try {
      result = await this.serverApi.authorizeOwnedRole(this.currentIdentity(), accessToken, account);
    } catch (error) {
      if (!(error instanceof ServerApiError) || error.code !== "DEVICE_REVOKED") throw error;
      await this.serverConnection?.stop();
      this.identity = await this.identities.reset(this.config.deviceName);
      this.serverApi.bindIdentity(this.identity);
      this.serverConnection = this.createServerConnection(this.identity);
      result = await this.serverApi.authorizeOwnedRole(this.identity, accessToken, account);
      this.logger.info("Rotated revoked Host identity before owned-device authorization");
    }
    this.serverConnection?.resume();
    this.logger.info("Host authorized as an owned device");
    return result;
  }
  async authorizeHostWithAccount(email, password) {
    if (this.serverApi === void 0) {
      throw new ServerApiError("SERVER_NOT_CONFIGURED", "Configure serverUrl before signing in.", false);
    }
    const result = await this.serverApi.authorizeWithAccount(this.currentIdentity(), email, password);
    this.serverConnection?.resume();
    this.logger.info("Host account authorized");
    return result;
  }
  async authorizeHostWithCode(code) {
    if (this.serverApi === void 0) {
      throw new ServerApiError("SERVER_NOT_CONFIGURED", "Configure serverUrl before entering a Host registration code.", false);
    }
    const result = await this.serverApi.authorizeHostWithCode(this.currentIdentity(), code);
    this.serverConnection?.resume();
    this.logger.info("Host registration code authorized");
    return result;
  }
  async revokePeer(deviceId) {
    const revoked = await this.identities.revokePeer(deviceId);
    if (revoked) await this.connections.revoke(deviceId);
    return revoked;
  }
  codexStatus() {
    return this.codex.status();
  }
  codexCall(input2) {
    return this.requireLocalCodexPeer().call(input2);
  }
  codexRespond(input2) {
    return this.requireLocalCodexPeer().respond(input2);
  }
  codexOpenStream(input2, publish) {
    this.localCodexPublish = publish;
    return this.requireLocalCodexPeer().openStream(input2);
  }
  async codexCloseStream(input2) {
    const peer = this.localCodexPeer;
    if (peer !== void 0) return peer.closeStream(input2);
    const streamId = isPlainRecord(input2) && typeof input2.streamId === "string" ? input2.streamId : void 0;
    if (streamId === void 0) throw new RpcError("INVALID_MESSAGE", "A Codex stream is required.");
    return { closed: false, streamId };
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.serverConnection?.stop();
    await this.connections.close();
    await this.localCodexPeer?.closeAll();
    this.localCodexPeer = void 0;
    await this.codex.close();
    this.logger.info("host runtime stopped");
  }
  diagnostics() {
    return {
      loaded: this.identity !== void 0,
      deviceId: this.identity === void 0 ? void 0 : shortId5(this.identity.deviceId),
      identityValid: this.identity !== void 0,
      serverConfigured: this.config.serverUrl !== void 0,
      serverOnline: this.serverConnection?.isOnline() ?? false,
      serverError: this.serverConnection?.lastError(),
      online: this.connections.isOnline(),
      activeConnections: this.connections.connectionCount(),
      peerDeviceId: this.connections.peerDeviceId() === void 0 ? void 0 : shortId5(this.connections.peerDeviceId()),
      peerDeviceIds: this.connections.peerDeviceIds().map(shortId5),
      trustedPeers: this.identities.listTrustedPeers().length,
      capabilities: this.hostCapabilities(),
      codex: this.codex.status()
    };
  }
  createServerConnection(identity) {
    return new HostServerConnection(
      this.config,
      identity,
      this.identities,
      this.serverApi,
      this.connections,
      this.logger,
      void 0,
      this.config.forceRelay ? void 0 : () => loadNodeRtcFactory({ routeTargets: this.config.serverUrl === void 0 ? [] : [this.config.serverUrl] }),
      () => this.hostCapabilities(),
      this.harnessVersion
    );
  }
  async readHarnessVersion() {
    let reportedVersion;
    let errorCode5;
    try {
      const response = await this.apiProxy?.host.describe({ rpcId: randomUUID2(), payload: {} });
      if (response === void 0) throw new Error("ApiProxy is unavailable");
      if (!response.result.ok) {
        errorCode5 = response.result.error.code;
      } else {
        reportedVersion = normalizeHarnessVersion(response.result.value.version);
      }
    } catch {
    }
    const distributionVersion = reportedVersion === void 0 || reportedVersion === "0.0.1" ? await readHarnessDistributionVersion() : void 0;
    const version = selectHarnessVersion(reportedVersion, distributionVersion);
    if (version !== void 0) return version;
    this.logger.warn("Harness version is unavailable", errorCode5 === void 0 ? void 0 : { code: errorCode5 });
    return void 0;
  }
  hostCapabilities() {
    const capabilities = [];
    if (this.localGateway?.supportsCarrier === true) {
      capabilities.push(
        harnessSessionGeneration(this.harnessVersion) === "v3" ? "harness.remote.v3" : "harness.remote.v1",
        "harness.remote.transfer.v1"
      );
    } else if (this.apiProxy !== void 0) {
      capabilities.push("harness.api.v1", "harness.api.transfer.v1");
    }
    if (this.fileViewerHost?.() !== void 0) capabilities.push("fileviewer.read.v1");
    if (this.codex.isAvailable()) capabilities.push("codex.appserver.v1", "codex.appserver.transfer.v1");
    return capabilities;
  }
  requireLocalCodexPeer() {
    if (!this.codex.isAvailable()) {
      throw new RpcError("CODEX_UNAVAILABLE", "Local CodeX is disabled or unavailable on this Host.");
    }
    if (this.localCodexPeer !== void 0) return this.localCodexPeer;
    const identity = this.currentIdentity();
    const peer = this.codex.createPeer({
      connectionId: `loopback:${identity.deviceId}`,
      peerDeviceId: identity.deviceId
    }, (event, data) => this.localCodexPublish(event, data));
    if (peer === void 0) {
      throw new RpcError("CODEX_UNAVAILABLE", "Local CodeX is disabled or unavailable on this Host.");
    }
    this.localCodexPeer = peer;
    return peer;
  }
};
function shortId5(value) {
  return value.length <= 12 ? value : `${value.slice(0, 8)}\u2026${value.slice(-4)}`;
}
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/cli.ts
import { stat as stat5 } from "node:fs/promises";
import { hostname as hostname3 } from "node:os";
import { join as join6 } from "node:path";
var QR_POLL_INTERVAL_MS = 2e3;
var TERMINAL_QR_MARGIN = 4;
async function runCli(args = process.argv.slice(2), dependencies = {}) {
  const runtime = resolveDependencies(dependencies);
  const [command, ...rest] = args;
  try {
    if (command === "login") return await login(rest, runtime);
    if (command === "status") return await status(rest, runtime);
    if (command === "logout") return await logout(rest, runtime);
    if (command === "help" || command === "--help" || command === "-h" || command === void 0) {
      write(runtime.stdout, helpText());
      return 0;
    }
    throw new CliUsageError(`Unknown command: ${command}`);
  } catch (error) {
    write(runtime.stderr, `${cliErrorMessage(error)}
`);
    if (error instanceof CliUsageError) write(runtime.stderr, `
${helpText()}`);
    return error instanceof CliUsageError ? 2 : 1;
  }
}
async function login(args, runtime) {
  if (args.length > 1) throw new CliUsageError("Usage: ds-harness-remote login [github|zhihu]");
  const provider = args[0] ?? "zhihu";
  if (provider !== "github" && provider !== "zhihu") {
    throw new CliUsageError("Login provider must be github or zhihu.");
  }
  const context = await hostContext(runtime);
  const session = await context.api.startOAuthQrLogin(provider);
  const qr = await runtime.renderQr(session.scanUrl);
  const providerName = provider === "github" ? "GitHub" : "Zhihu";
  write(runtime.stdout, `Using ${providerName} QR login. ${alternativeProviderHint(provider)}
`);
  write(runtime.stdout, "Scan this QR code to authorize this Host:\n\n");
  write(runtime.stdout, `${qr.trimEnd()}
`);
  write(runtime.stdout, `Authorization URL: ${terminalLink(session.scanUrl, runtime.stdout)}

Waiting for authorization...
`);
  const deadline = runtime.now() + session.expiresIn * 1e3;
  let identity = context.identity;
  while (runtime.now() < deadline) {
    let result;
    try {
      result = await context.api.pollOAuthQrLogin(identity, session.qrId, async () => {
        identity = await context.identities.reset(context.deviceName);
        return identity;
      });
    } catch (error) {
      if (!(error instanceof ServerApiError) || !error.retryable) throw error;
      await runtime.wait(Math.min(QR_POLL_INTERVAL_MS, Math.max(1, deadline - runtime.now())));
      continue;
    }
    if (result.status === "complete") {
      write(runtime.stdout, `${authorizedMessage(result.authorization)} Restart dsh-tui to bring the Remote Host online.
`);
      return 0;
    }
    if (result.status === "expired") break;
    await runtime.wait(Math.min(QR_POLL_INTERVAL_MS, Math.max(1, deadline - runtime.now())));
  }
  write(runtime.stderr, "The QR login expired. Run the login command again to generate a new code.\n");
  return 1;
}
async function status(args, runtime) {
  if (args.length !== 0) throw new CliUsageError("Usage: ds-harness-remote status");
  const serverUrl = selectedServer();
  const root = new IdentityStore({ env: runtime.env }).directory;
  const directory = serverStorageDirectory(root, serverUrl, "host");
  const lines = [
    "Remote Host status",
    `Server: ${serverUrl}`,
    "Host control: enabled (dsh-TUI default)"
  ];
  if (!await exists3(join6(directory, "device.json"))) {
    lines.push("Device: not initialized", "Authorization: logged out", "Credential: unavailable");
    write(runtime.stdout, `${lines.join("\n")}

Run "ds-harness-remote login" or use "/remote login" in dsh-TUI.
`);
    return 0;
  }
  const identities = runtime.createIdentityStore({ directory, env: runtime.env });
  const identity = await identities.loadOrCreate(hostname3());
  const store = new ServerCredentialStore(directory);
  const stored = await store.load(serverUrl, identity.deviceId);
  lines.push(`Device: ${identity.name} (${identity.deviceId})`);
  if (stored === void 0) {
    lines.push("Authorization: logged out", "Credential: unavailable");
    write(runtime.stdout, `${lines.join("\n")}

Run "ds-harness-remote login" or use "/remote login" in dsh-TUI.
`);
    return 0;
  }
  lines.push(`Authorization: logged in (${authorizationLabel(stored.authorizationMethod)})`);
  if (stored.account !== void 0) lines.push(`Account: ${stored.account}`);
  const api = runtime.createHostApi(serverUrl, store);
  api.bindIdentity(identity);
  try {
    await api.authenticate(identity);
    lines.push("Credential: ready");
    lines.push("Presence: published while dsh-tui is running");
    write(runtime.stdout, `${lines.join("\n")}
`);
    return 0;
  } catch (error) {
    lines.push(`Credential: unavailable (${statusErrorCode(error)})`);
    write(runtime.stdout, `${lines.join("\n")}
`);
    return 1;
  }
}
async function logout(args, runtime) {
  if (args.length !== 0) throw new CliUsageError("Usage: ds-harness-remote logout");
  const serverUrl = selectedServer();
  const root = new IdentityStore({ env: runtime.env }).directory;
  const directory = serverStorageDirectory(root, serverUrl, "host");
  if (!await exists3(join6(directory, "device.json"))) {
    await new ServerCredentialStore(directory).clear();
    write(runtime.stdout, "This Host is already logged out.\n");
    return 0;
  }
  const deviceName = hostname3();
  const identities = runtime.createIdentityStore({ directory, env: runtime.env });
  const identity = await identities.loadOrCreate(deviceName);
  const api = runtime.createHostApi(serverUrl, new ServerCredentialStore(directory));
  api.bindIdentity(identity);
  let revokeFailure;
  try {
    await api.revokeCurrentDevice();
  } catch (error) {
    revokeFailure = error;
  }
  await identities.reset(deviceName);
  if (revokeFailure !== void 0) {
    throw new Error(`Local Host credentials were cleared, but Server revocation failed: ${cliErrorMessage(revokeFailure)}`);
  }
  write(runtime.stdout, "Remote Host logged out and its local device identity was rotated. Restart dsh-tui.\n");
  return 0;
}
async function hostContext(runtime) {
  const serverUrl = selectedServer();
  const root = new IdentityStore({ env: runtime.env }).directory;
  const directory = serverStorageDirectory(root, serverUrl, "host");
  const deviceName = hostname3();
  const identities = runtime.createIdentityStore({ directory, env: runtime.env });
  const identity = await identities.loadOrCreate(deviceName);
  const api = runtime.createHostApi(serverUrl, new ServerCredentialStore(directory));
  return { api, identities, identity, deviceName };
}
function selectedServer() {
  return normalizeServerUrl(DEFAULT_REMOTE_SERVER_URL);
}
function resolveDependencies(input2) {
  return {
    env: input2.env ?? process.env,
    stdout: input2.stdout ?? process.stdout,
    stderr: input2.stderr ?? process.stderr,
    now: input2.now ?? Date.now,
    wait: input2.wait ?? ((milliseconds) => new Promise((resolve3) => setTimeout(resolve3, milliseconds))),
    renderQr: input2.renderQr ?? renderTerminalQr,
    createIdentityStore: input2.createIdentityStore ?? ((options) => new IdentityStore(options)),
    createHostApi: input2.createHostApi ?? ((serverUrl, store) => new HostServerApi(serverUrl, store))
  };
}
async function renderTerminalQr(url) {
  const { default: QRCode } = await import("qrcode");
  const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
  const width = modules.size + TERMINAL_QR_MARGIN * 2;
  const quietLine = `\x1B[47m${" ".repeat(width * 2)}\x1B[0m`;
  const lines = Array.from({ length: TERMINAL_QR_MARGIN }, () => quietLine);
  for (let row = 0; row < modules.size; row += 1) {
    let line = `\x1B[47m${" ".repeat(TERMINAL_QR_MARGIN * 2)}`;
    for (let column = 0; column < modules.size; column += 1) {
      line += modules.get(row, column) === 1 ? "\x1B[40m  " : "\x1B[47m  ";
    }
    line += `\x1B[47m${" ".repeat(TERMINAL_QR_MARGIN * 2)}\x1B[0m`;
    lines.push(line);
  }
  lines.push(...Array.from({ length: TERMINAL_QR_MARGIN }, () => quietLine));
  return lines.join("\n");
}
async function renderCompactTerminalQr(url) {
  const { default: QRCode } = await import("qrcode");
  const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
  const size = modules.size + TERMINAL_QR_MARGIN * 2;
  const lines = [];
  const isBlack = (row, column) => {
    const qrRow = row - TERMINAL_QR_MARGIN;
    const qrColumn = column - TERMINAL_QR_MARGIN;
    return qrRow >= 0 && qrRow < modules.size && qrColumn >= 0 && qrColumn < modules.size && modules.get(qrRow, qrColumn) === 1;
  };
  for (let row = 0; row < size; row += 2) {
    let line = "\x1B[30;47m";
    for (let column = 0; column < size; column += 1) {
      const top = isBlack(row, column);
      const bottom = isBlack(row + 1, column);
      line += top ? bottom ? "\u2588" : "\u2580" : bottom ? "\u2584" : " ";
    }
    lines.push(`${line}\x1B[0m`);
  }
  return lines.join("\n");
}
function authorizedMessage(authorization) {
  return authorization.account === void 0 ? "Remote Host login complete." : `Remote Host login complete for ${authorization.account}.`;
}
function alternativeProviderHint(provider) {
  return provider === "zhihu" ? "GitHub is also supported: ds-harness-remote login github" : "Zhihu is also supported: ds-harness-remote login zhihu";
}
function authorizationLabel(method) {
  if (method === "host_registration_code") return "Host registration code";
  if (method === "owned_device") return "owned device";
  return "account";
}
function statusErrorCode(error) {
  return error instanceof ServerApiError ? error.code : "CONNECTION_FAILED";
}
function cliErrorMessage(error) {
  const message = error instanceof Error ? error.message : "The Remote command failed.";
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : void 0;
  return code === void 0 ? message : `${message} (${code})`;
}
function helpText() {
  return [
    "Usage:",
    "  ds-harness-remote login [github|zhihu]",
    "  ds-harness-remote status",
    "  ds-harness-remote logout",
    "",
    "Inside dsh-TUI, use /remote login, /remote status, or /remote logout.",
    "login defaults to Zhihu and authorizes this computer as a Remote Host with a terminal QR code.",
    `The Server is ${DEFAULT_REMOTE_SERVER_URL}.`,
    "Host configuration is not exposed by this CLI yet. Restart dsh-tui after login or logout.",
    ""
  ].join("\n");
}
function write(target, value) {
  target.write(value);
}
function terminalLink(url, target) {
  if (target.isTTY !== true) return url;
  return `\x1B]8;;${url}\x07${url}\x1B]8;;\x07`;
}
async function exists3(path) {
  try {
    await stat5(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
var CliUsageError = class extends Error {
};

// src/tui-command.ts
var QR_POLL_INTERVAL_MS2 = 2e3;
var REMOTE_LOGIN_SCENE_ID = "remote-login";
var REMOTE_STATUS_SCENE_ID = "remote-status";
function installTuiRemoteCommand(ctx, resolveTarget) {
  const tuiContext = ctx;
  const commands = tuiContext.get("commands", false);
  if (commands === void 0) return;
  const pluginHost = tuiContext.get("tuiPluginHost", false);
  const trees = tuiContext.get("tuiCommandTrees", false);
  const scenes = tuiContext.get("tuiScenes", false);
  const login2 = new RemoteLoginController(resolveTarget);
  const LoginScene = createRemoteLoginScene(login2);
  const StatusScene = createRemoteStatusScene(resolveTarget);
  tuiContext.effect(() => {
    const definition = {
      name: "remote",
      description: "Manage Remote Host login and connection status",
      input: { hint: "[status | login [github|zhihu] | logout]" },
      recordInput: false,
      handler: async ({ rawInput }) => {
        const args = rawInput.trim().split(/\s+/u).filter(Boolean);
        const command = args[0] ?? "status";
        if (command === "status" && args.length <= 1) {
          if (scenes?.open(REMOTE_STATUS_SCENE_ID) === true) return { kind: "success" };
          return { kind: "success", text: formatRemoteStatusInline(resolveTarget()) };
        }
        if (command === "login" && args.length <= 2) {
          const provider = args[1] ?? "zhihu";
          if (provider !== "github" && provider !== "zhihu") {
            return { kind: "error", text: "Usage: /remote login [github|zhihu]" };
          }
          if (scenes === void 0) {
            return {
              kind: "error",
              text: `The Remote login screen is unavailable. Run "ds-harness-remote login ${provider}" outside dsh-TUI, then restart it.`
            };
          }
          login2.start(provider);
          if (!scenes.open(REMOTE_LOGIN_SCENE_ID)) {
            login2.cancel();
            return { kind: "error", text: "The Remote login screen is unavailable." };
          }
          return { kind: "success" };
        }
        if (command === "logout" && args.length === 1) {
          const target = resolveTarget();
          if (target === void 0) return remoteNotReady();
          try {
            await target.runtime.clearHostAuthorization();
            return {
              kind: "success",
              text: "Remote Host logged out and its local device identity was rotated."
            };
          } catch (error) {
            return {
              kind: "error",
              text: `Local Remote Host credentials were cleared, but Server revocation failed (${errorCode4(error)}).`
            };
          }
        }
        if (command === "config") {
          return { kind: "error", text: "Host configuration is not supported yet." };
        }
        return { kind: "error", text: remoteCommandUsage() };
      }
    };
    const disposeCommand = registerRemoteCommand(tuiContext, commands, pluginHost, definition);
    const disposeTree = registerOptional(tuiContext, "command completion", () => trees?.register({
      root: "remote",
      descriptions: {
        en: "Manage Remote Host login and connection status",
        zh: "\u7BA1\u7406 Remote Host \u767B\u5F55\u548C\u8FDE\u63A5\u72B6\u6001"
      },
      children: remoteCommandChildren
    }));
    const disposeScene = registerOptional(tuiContext, "login scene", () => scenes?.register({
      id: REMOTE_LOGIN_SCENE_ID,
      title: "Remote Host login",
      component: LoginScene
    }, tuiContext));
    const disposeStatusScene = registerOptional(tuiContext, "status scene", () => scenes?.register({
      id: REMOTE_STATUS_SCENE_ID,
      title: "Remote Host status",
      component: StatusScene
    }, tuiContext));
    return () => {
      login2.cancel();
      disposeCommand();
      disposeTree();
      disposeScene();
      disposeStatusScene();
    };
  }, "ds-harness-remote: dsh-tui /remote command");
}
function registerRemoteCommand(ctx, commands, pluginHost, definition) {
  if (pluginHost === void 0) return commands.register(definition);
  try {
    return pluginHost.registerCommand(ctx, definition);
  } catch (error) {
    if (!hasErrorCode2(error, "COMPONENT_NOT_ADMITTED")) throw error;
    ctx.logger.debug("dsh-TUI Remote command is using the legacy command registry because Component admission is unavailable");
    return commands.register(definition);
  }
}
function hasErrorCode2(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function registerOptional(ctx, feature, register) {
  try {
    return register() ?? (() => {
    });
  } catch (error) {
    ctx.logger.warn(`dsh-TUI Remote ${feature} is unavailable`, { code: errorCode4(error) });
    return () => {
    };
  }
}
function remoteCommandChildren(canonicalPath) {
  if (canonicalPath.length === 1 && canonicalPath[0] === "remote") {
    return [
      {
        name: "status",
        description: "Show Remote Host authorization and connection status",
        descriptions: { zh: "\u67E5\u770B Remote Host \u6388\u6743\u548C\u8FDE\u63A5\u72B6\u6001" }
      },
      {
        name: "login",
        description: "Authorize this Host with a GitHub or Zhihu QR code",
        descriptions: { zh: "\u4F7F\u7528 GitHub \u6216\u77E5\u4E4E\u4E8C\u7EF4\u7801\u6388\u6743\u5F53\u524D Host" }
      },
      {
        name: "logout",
        description: "Revoke this Host and rotate its local identity",
        descriptions: { zh: "\u64A4\u9500\u5F53\u524D Host \u5E76\u8F6E\u6362\u672C\u5730\u8EAB\u4EFD" }
      }
    ];
  }
  if (canonicalPath.length === 2 && canonicalPath[0] === "remote" && canonicalPath[1] === "login") {
    return [
      { name: "zhihu", description: "Sign in with Zhihu (default)", descriptions: { zh: "\u4F7F\u7528\u77E5\u4E4E\u767B\u5F55\uFF08\u9ED8\u8BA4\uFF09" } },
      { name: "github", description: "Sign in with GitHub", descriptions: { zh: "\u4F7F\u7528 GitHub \u767B\u5F55" } }
    ];
  }
  return [];
}
function remoteStatusLines(target) {
  if (target === void 0) {
    return ["Remote Host is disabled or still starting. Check the ds-harness-remote settings and retry."];
  }
  const { runtime, config } = target;
  const status2 = runtime.hostStatus();
  const diagnostics = runtime.diagnostics();
  const codex = runtime.codexStatus();
  const capabilities = new Set(diagnostics.capabilities);
  const connection = status2.online ? "online" : status2.reconnecting ? "reconnecting" : status2.accountRequired ? "authorization required" : "offline";
  return [
    `Server: ${config.serverUrl ?? "not configured"}`,
    "Host control: enabled",
    `Device: ${status2.deviceId ?? "not initialized"}`,
    `Authorization: ${status2.authorized ? status2.account === void 0 ? "logged in" : `logged in (${status2.account})` : "logged out"}`,
    `Server connection: ${connection}`,
    `Harness Remote API: ${capabilities.has("harness.api.v1") ? "available (ApiProxy)" : capabilities.has("harness.remote.v1") ? "available (Typert Remote)" : "unavailable"}`,
    `Remote clients: ${diagnostics.activeConnections}`,
    `Codex Remote: ${codex.enabled ? codex.state : "disabled"}`,
    "",
    "Commands: /remote login [github|zhihu] \xB7 /remote status \xB7 /remote logout"
  ];
}
function formatRemoteStatusInline(target) {
  return remoteStatusLines(target).filter(Boolean).join(" \xB7 ");
}
function remoteCommandUsage() {
  return [
    "Usage:",
    "  /remote",
    "  /remote status",
    "  /remote login [github|zhihu]",
    "  /remote logout"
  ].join("\n");
}
function remoteNotReady() {
  return {
    kind: "error",
    text: "Remote Host is disabled or still starting. Check the ds-harness-remote settings and retry."
  };
}
var RemoteLoginController = class {
  constructor(resolveTarget) {
    this.resolveTarget = resolveTarget;
  }
  current = { phase: "idle", provider: "zhihu" };
  listeners = /* @__PURE__ */ new Set();
  attempt = 0;
  snapshot = () => this.current;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  start(provider) {
    const attempt = ++this.attempt;
    this.update({ phase: "loading", provider });
    void this.run(attempt, provider);
  }
  cancel() {
    this.attempt += 1;
  }
  async run(attempt, provider) {
    try {
      const target = this.resolveTarget();
      if (target === void 0) throw new Error("REMOTE_NOT_READY");
      const session = await target.runtime.startHostOAuthQrLogin(provider);
      const [qr, compactQr] = await Promise.all([
        renderTerminalQr(session.scanUrl),
        renderCompactTerminalQr(session.scanUrl)
      ]);
      if (attempt !== this.attempt) return;
      this.update({ phase: "waiting", provider, qr, compactQr, scanUrl: session.scanUrl });
      await this.poll(attempt, provider, session, target.runtime);
    } catch (error) {
      if (attempt !== this.attempt) return;
      this.update({ phase: "error", provider, error: errorCode4(error) });
    }
  }
  async poll(attempt, provider, session, runtime) {
    const deadline = Date.now() + session.expiresIn * 1e3;
    while (attempt === this.attempt && Date.now() < deadline) {
      try {
        const result = await runtime.pollHostOAuthQrLogin(session.qrId);
        if (attempt !== this.attempt) return;
        if (result.status === "complete") {
          this.update({ phase: "complete", provider, account: result.authorization.account });
          return;
        }
        if (result.status === "expired") break;
      } catch (error) {
        if (!(error instanceof ServerApiError) || !error.retryable) throw error;
      }
      await wait(Math.min(QR_POLL_INTERVAL_MS2, Math.max(1, deadline - Date.now())));
    }
    if (attempt === this.attempt) this.update({ phase: "expired", provider });
  }
  update(snapshot) {
    this.current = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
};
function createRemoteLoginScene(controller) {
  return function RemoteLoginScene({ React, ui, close }) {
    const [snapshot, setSnapshot] = React.useState(controller.snapshot());
    const terminal = ui.useTerminalSize();
    React.useEffect(() => {
      const unsubscribe = controller.subscribe(setSnapshot);
      return () => {
        unsubscribe();
        controller.cancel();
      };
    }, []);
    ui.useInput((input2, key) => {
      if (key.escape === true || input2.toLowerCase() === "q") {
        controller.cancel();
        close();
      }
    });
    const provider = snapshot.provider === "github" ? "GitHub" : "Zhihu";
    const other = snapshot.provider === "github" ? "/remote login zhihu" : "/remote login github";
    const children = [
      React.createElement(ui.Text, { key: "title", bold: true, color: "accent" }, "Remote Host login"),
      React.createElement(ui.Text, { key: "provider" }, `Provider: ${provider} \xB7 You can also use ${other}`)
    ];
    if (snapshot.phase === "loading") {
      children.push(React.createElement(ui.Text, { key: "loading", color: "subtle" }, "Creating authorization QR code\u2026"));
    } else if (snapshot.phase === "waiting" && snapshot.qr !== void 0 && snapshot.scanUrl !== void 0) {
      const fullRows = snapshot.qr.split("\n").length;
      const fullColumns = printableWidth(snapshot.qr.split("\n")[0] ?? "");
      const useFullQr = terminal.rows >= fullRows + 7 && terminal.columns >= fullColumns + 4;
      const qr = useFullQr || snapshot.compactQr === void 0 ? snapshot.qr : snapshot.compactQr;
      const qrRows = qr.split("\n").length;
      const qrColumns = printableWidth(qr.split("\n")[0] ?? "");
      if (terminal.rows < qrRows + 7 || terminal.columns < qrColumns + 4) {
        children.push(React.createElement(
          ui.Text,
          { key: "size-warning", color: "warning" },
          `Resize the terminal to at least ${qrColumns + 4} \xD7 ${qrRows + 7} if the QR code is clipped.`
        ));
      }
      children.push(
        React.createElement(ui.Text, { key: "scan" }, "Scan this QR code to authorize this Host:"),
        React.createElement(ui.Text, { key: "qr", wrap: "truncate" }, qr),
        React.createElement(ui.Text, { key: "url", color: "link", underline: true }, terminalLink2(snapshot.scanUrl)),
        React.createElement(ui.Text, { key: "waiting", color: "subtle" }, "Waiting for authorization\u2026")
      );
    } else if (snapshot.phase === "complete") {
      children.push(React.createElement(
        ui.Text,
        { key: "complete", color: "success" },
        snapshot.account === void 0 ? "Remote Host login complete. The Host is reconnecting now." : `Remote Host login complete for ${snapshot.account}. The Host is reconnecting now.`
      ));
    } else if (snapshot.phase === "expired") {
      children.push(React.createElement(ui.Text, { key: "expired", color: "warning" }, "The QR code expired. Close this screen and run /remote login again."));
    } else if (snapshot.phase === "error") {
      children.push(React.createElement(ui.Text, { key: "error", color: "error" }, `Remote Host login failed (${snapshot.error ?? "UNKNOWN"}).`));
    }
    children.push(React.createElement(ui.Text, { key: "close", color: "subtle" }, "Press Esc or q to return."));
    return React.createElement(ui.Box, {
      flexDirection: "column",
      gap: 1,
      paddingX: Math.max(0, Math.min(2, Math.floor((terminal.columns - 1) / 2)))
    }, ...children);
  };
}
function createRemoteStatusScene(resolveTarget) {
  return function RemoteStatusScene({ React, ui, close }) {
    const terminal = ui.useTerminalSize();
    ui.useInput((input2, key) => {
      if (key.escape === true || input2.toLowerCase() === "q") close();
    });
    const children = [
      React.createElement(ui.Text, { key: "title", bold: true, color: "accent" }, "Remote Host status"),
      ...remoteStatusLines(resolveTarget()).map((line, index) => React.createElement(
        ui.Text,
        { key: `status-${index}`, color: line === "" ? "subtle" : void 0 },
        line === "" ? " " : line
      )),
      React.createElement(ui.Text, { key: "close", color: "subtle" }, "Press Esc or q to return.")
    ];
    return React.createElement(ui.Box, {
      flexDirection: "column",
      gap: 1,
      paddingX: Math.max(0, Math.min(2, Math.floor((terminal.columns - 1) / 2)))
    }, ...children);
  };
}
function terminalLink2(url) {
  return `\x1B]8;;${url}\x07${url}\x1B]8;;\x07`;
}
function printableWidth(value) {
  return value.replace(/\u001B\[[0-9;]*m/gu, "").length;
}
function errorCode4(error) {
  if (error instanceof ServerApiError) return error.code;
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  return "CONNECTION_FAILED";
}
function wait(milliseconds) {
  return new Promise((resolve3) => setTimeout(resolve3, milliseconds));
}

// src/remote-file-content-provider.ts
var REMOTE_FILE_SAVE_AS_MAX_BYTES = 100 * 1024 * 1024;
var REMOTE_FILE_FAST_SAVE_AS_MAX_BYTES = 1024 * 1024 * 1024;
function createRemoteFileContentProvider(call, options = {}) {
  return {
    id: "dsh-remote-files",
    priority: 1e4,
    supports: () => true,
    saveAsAllowed: () => ({
      allowed: currentSaveAsAllowed(options.saveAsAllowed),
      maxBytes: currentSaveAsMaxBytes(options.saveAsMaxBytes)
    }),
    async stat(locator, signal) {
      const value = await call("fileviewer.stat", { path: locator }, signal);
      if (!value.exists) return void 0;
      return {
        name: value.name,
        size: value.isDirectory ? 0 : value.size,
        mime: value.mime,
        mtimeMs: value.mtimeMs,
        isDirectory: value.isDirectory
      };
    },
    async read(locator, request) {
      if (!Number.isInteger(request.offset) || request.offset < 0) throw new Error("A non-negative integer offset is required.");
      if (!Number.isInteger(request.length) || request.length <= 0) throw new Error("A positive integer length is required.");
      const chunks = [];
      let received = 0;
      while (received < request.length) {
        request.signal.throwIfAborted();
        const length = Math.min(REMOTE_FILE_CHUNK_BYTES, request.length - received);
        const offset = request.offset + received;
        const range = await call("fileviewer.readRange", { path: locator, offset, length }, request.signal);
        if (range.offset !== offset) throw new Error("The Remote Host returned a mismatched file range.");
        const bytes = decodeBase64(range.data);
        if (bytes.byteLength > length) throw new Error("The Remote Host returned more file bytes than requested.");
        chunks.push(bytes);
        received += bytes.byteLength;
        if (range.eof || bytes.byteLength === 0) break;
      }
      const merged = new Uint8Array(received);
      let cursor2 = 0;
      for (const chunk of chunks) {
        merged.set(chunk, cursor2);
        cursor2 += chunk.byteLength;
      }
      return merged;
    },
    async list(locator, signal) {
      const value = await call("fileviewer.list", { path: locator }, signal);
      return value.entries.map((entry) => ({
        locator: entry.path,
        name: entry.name,
        size: entry.isDirectory ? 0 : entry.size ?? 0,
        mtimeMs: entry.mtimeMs,
        isDirectory: entry.isDirectory
      }));
    }
  };
}
function currentSaveAsAllowed(value) {
  return typeof value === "function" ? value() : value === true;
}
function currentSaveAsMaxBytes(value) {
  return typeof value === "function" ? value() : value ?? REMOTE_FILE_SAVE_AS_MAX_BYTES;
}
function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// src/index.ts
var name = "ds-harness-remote";
var legacyLoaderModuleNames = /* @__PURE__ */ new Set(["dsh-remote", "@dsh-remote/plugin"]);
var pluginSettingsNamespace = "ds-harness-remote";
var legacySettingsNamespace = "dsh-remote";
function apply(ctx, input2 = {}) {
  const tuiCommandsAvailable = ctx.get("commands", false) !== void 0 && ctx.get("tuiScenes", false) !== void 0;
  const tuiBinding = tuiCommandsAvailable ? {} : void 0;
  if (tuiBinding !== void 0) installTuiRemoteCommand(ctx, () => tuiBinding.target);
  const activateWhenCarrierReady = (runtimeContext) => {
    const gateway = runtimeContext.get("typertGateway");
    const connection = runtimeContext.get("connection");
    let disposePendingControl;
    const installPendingControl = () => {
      if (connection === void 0 || disposePendingControl !== void 0) return;
      disposePendingControl = runtimeContext.effect(() => {
        const control = new PluginControlRuntime(
          resolveConfig(input2),
          new IdentityStore().directory,
          void 0,
          void 0,
          void 0
        );
        return control.register(connection);
      }, "dsh-remote pending control");
    };
    const startActiveRuntime = async (activeContext) => {
      await disposePendingControl?.();
      disposePendingControl = void 0;
      await activate(activeContext, input2, tuiBinding);
    };
    if (tuiCommandsAvailable || runtimeContext.get("apiProxy") !== void 0 || new TypertGatewaySwitch(gateway).supportsCarrier()) {
      return startActiveRuntime(runtimeContext);
    }
    installPendingControl();
    runtimeContext.inject(["apiProxy"], (legacyContext) => startActiveRuntime(legacyContext));
  };
  if (tuiCommandsAvailable) {
    ctx.inject(["settings", "typertGateway"], activateWhenCarrierReady);
  } else {
    ctx.inject(["settings", "connection", "typertGateway"], activateWhenCarrierReady);
  }
}
async function activate(ctx, input2, tuiBinding) {
  const settings = ctx.get("settings");
  const settingsScope = settings?.register(pluginSettingsNamespace, Config, {
    base: input2,
    applies: "restart",
    validate: (value) => {
      resolveConfig(value);
    }
  });
  if (settings !== void 0 && settingsScope !== void 0) {
    const migration = migrateLegacySettings(settings, settingsScope);
    reportSettingsMigration(ctx, await migration);
  }
  const connection = ctx.get("connection");
  const resolvedConfig = resolveConfig(settingsScope?.get() ?? input2);
  const config = connection === void 0 && resolvedConfig.serverUrl === void 0 ? { ...resolvedConfig, serverUrl: DEFAULT_REMOTE_SERVER_URL } : resolvedConfig;
  const defaultIdentityDirectory = new IdentityStore().directory;
  if (!config.enabled) {
    if (connection !== void 0) {
      const controlRuntime2 = new PluginControlRuntime(config, defaultIdentityDirectory, settingsScope, void 0, void 0);
      ctx.effect(() => controlRuntime2.register(connection), "dsh-remote disabled control");
    }
    return;
  }
  const logger = new SafeLogger({
    debug: (message) => {
      ctx.logger.debug(message);
      console.debug(message);
    },
    info: (message) => {
      ctx.logger.info(message);
      console.info(message);
    },
    warn: (message) => {
      ctx.logger.warn(message);
      console.warn(message);
    },
    error: (message) => {
      ctx.logger.error(message);
      console.error(message);
    }
  }, config.logLevel);
  const hostIdentities = new IdentityStore({
    directory: config.serverUrl === void 0 ? defaultIdentityDirectory : serverStorageDirectory(defaultIdentityDirectory, config.serverUrl, "host")
  });
  const apiProxy = ctx.get("apiProxy");
  const nativeTypertGateway = ctx.get("typertGateway");
  const localTypertGateway = new TypertGatewaySwitch(nativeTypertGateway).local();
  const runtime = new HostPluginRuntime(
    config,
    hostIdentities,
    apiProxy,
    logger,
    localTypertGateway,
    () => ctx.get("fileViewerHost")
  );
  let clientRuntime;
  const hostControl = runtime;
  if (config.serverUrl !== void 0 && connection !== void 0) {
    const clientIdentities = new IdentityStore({
      directory: serverStorageDirectory(defaultIdentityDirectory, config.serverUrl, "client")
    });
    clientRuntime = new ClientModeRuntime(
      config,
      clientIdentities,
      new ClientServerApi(config.serverUrl, new ServerCredentialStore(clientIdentities.directory)),
      apiProxy,
      nativeTypertGateway,
      logger,
      hostControl
    );
  }
  const controlRuntime = connection === void 0 ? void 0 : new PluginControlRuntime(config, defaultIdentityDirectory, settingsScope, clientRuntime, hostControl);
  ctx.provide("dshRemote", runtime);
  if (clientRuntime !== void 0) ctx.provide("dshRemoteClient", clientRuntime);
  const tuiTarget = { runtime, config };
  if (tuiBinding !== void 0) tuiBinding.target = tuiTarget;
  await disableLegacyLoaderEntries(ctx, logger);
  await ctx.effect(async () => {
    const disposeControl = controlRuntime?.register(connection);
    try {
      await runtime.start();
      if (clientRuntime !== void 0) {
        await clientRuntime.start();
      } else {
        logger.warn("client remote mode is unavailable", {
          serverConfigured: config.serverUrl !== void 0,
          apiProxyAvailable: apiProxy !== void 0,
          remoteGatewayAvailable: localTypertGateway.supportsCarrier,
          connectionAvailable: connection !== void 0
        });
      }
    } catch (error) {
      if (tuiBinding?.target === tuiTarget) tuiBinding.target = void 0;
      await disposeControl?.();
      await clientRuntime?.close();
      await runtime.close();
      throw error;
    }
    return async () => {
      if (tuiBinding?.target === tuiTarget) tuiBinding.target = void 0;
      await disposeControl?.();
      await clientRuntime?.close();
      await runtime.close();
    };
  }, "dsh-remote lifecycle");
}
function reportSettingsMigration(ctx, migration) {
  if (migration === "migrated") ctx.logger.info("migrated legacy Remote settings namespace");
  if (migration === "failed") ctx.logger.warn("failed to migrate legacy Remote settings namespace");
}
async function migrateLegacySettings(settings, currentScope) {
  if (typeof settings.describe !== "function") return "skipped";
  try {
    let descriptors = settings.describe();
    const current = descriptors.find((descriptor) => descriptor.ns === pluginSettingsNamespace);
    if (isPlainRecord2(current?.user)) return "skipped";
    let legacy = descriptors.find((descriptor) => descriptor.ns === legacySettingsNamespace);
    if (legacy === void 0) {
      settings.register(legacySettingsNamespace, Config, {
        applies: "restart",
        validate: (value) => {
          resolveConfig(value);
        }
      });
      descriptors = settings.describe();
      legacy = descriptors.find((descriptor) => descriptor.ns === legacySettingsNamespace);
    }
    if (!isPlainRecord2(legacy?.user) || Object.keys(legacy.user).length === 0) return "skipped";
    await currentScope.replace(legacy.user);
    return "migrated";
  } catch {
    return "failed";
  }
}
async function disableLegacyLoaderEntries(ctx, logger) {
  const loader = ctx.get("loader");
  if (!isLoaderLike(loader)) return;
  const currentEntryId = loader.locate?.(ctx.fiber);
  for (const entry of loader.entries()) {
    const moduleName = entry.options.name;
    if (moduleName === void 0 || !legacyLoaderModuleNames.has(moduleName)) continue;
    if (entry.id === currentEntryId || entry.options.disabled === true) continue;
    try {
      await loader.update(entry.id, { disabled: true });
      logger.warn("disabled legacy loader entry", { entryId: entry.id, moduleName });
    } catch {
      logger.warn("failed to disable legacy loader entry", {
        entryId: entry.id,
        moduleName,
        code: "LOADER_UPDATE_FAILED"
      });
    }
  }
}
function isLoaderLike(value) {
  return typeof value === "object" && value !== null && typeof value.entries === "function" && typeof value.update === "function";
}
function isPlainRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export {
  ApiProxySwitch,
  CODEX_APP_ALLOWLIST,
  ClientModeError,
  ClientModeRuntime,
  ClientSecureTransport,
  ClientServerApi,
  CodexAppServerClient,
  CodexAppServerError,
  CodexPeerBridge,
  CodexRemoteDomain,
  Config,
  ConnectionController,
  ConnectionRejectedError,
  HARNESS_API_ALLOWLIST,
  HARNESS_REMOTE_ALLOWLIST,
  HOST_CAPABILITIES,
  HarnessApiBridge,
  HarnessRemoteBridge,
  HostPluginRuntime,
  HostServerApi,
  HostServerConnection,
  IdentityInvalidError,
  IdentityStore,
  PluginControlRuntime,
  RemoteFileViewerBridge,
  RemoteHarnessApiProxy,
  RemoteTypertGateway2 as RemoteTypertGateway,
  RpcError,
  RpcRouter,
  ServerApiError,
  ServerCredentialStore,
  ServerCredentialsInvalidError,
  TypertGatewaySwitch,
  apply,
  createRemoteFileContentProvider,
  fingerprint,
  migrateLegacySettings,
  name,
  resolveConfig,
  runCli,
  serverStorageDirectory
};
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/utils.js:
@noble/curves/esm/abstract/modular.js:
@noble/curves/esm/abstract/curve.js:
@noble/curves/esm/abstract/edwards.js:
@noble/curves/esm/abstract/montgomery.js:
@noble/curves/esm/ed25519.js:
@noble/curves/utils.js:
@noble/curves/abstract/modular.js:
@noble/curves/abstract/curve.js:
@noble/curves/abstract/edwards.js:
@noble/curves/abstract/montgomery.js:
@noble/curves/ed25519.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/ciphers/utils.js:
  (*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) *)
*/
//# sourceMappingURL=index.js.map
