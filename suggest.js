"use strict";
(function() {

Error.stackTraceLimit = Infinity;

var $global, $module;
if (typeof window !== "undefined") { /* web page */
  $global = window;
} else if (typeof self !== "undefined") { /* web worker */
  $global = self;
} else if (typeof global !== "undefined") { /* Node.js */
  $global = global;
  $global.require = require;
} else {
  console.log("warning: no global object found");
}
if (typeof module !== "undefined") {
  $module = module;
}

var $packages = {}, $reflect, $idCounter = 0;
var $keys = function(m) { return m ? Object.keys(m) : []; };
var $min = Math.min;
var $mod = function(x, y) { return x % y; };
var $parseInt = parseInt;
var $parseFloat = function(f) {
  if (f.constructor === Number) {
    return f;
  }
  return parseFloat(f);
};

var $mapArray = function(array, f) {
  var newArray = new array.constructor(array.length), i;
  for (i = 0; i < array.length; i++) {
    newArray[i] = f(array[i]);
  }
  return newArray;
};

var $methodVal = function(recv, name) {
  var vals = recv.$methodVals || {};
  recv.$methodVals = vals; /* noop for primitives */
  var f = vals[name];
  if (f !== undefined) {
    return f;
  }
  var method = recv[name];
  f = function() {
    $stackDepthOffset--;
    try {
      return method.apply(recv, arguments);
    } finally {
      $stackDepthOffset++;
    }
  };
  vals[name] = f;
  return f;
};

var $methodExpr = function(method) {
  if (method.$expr === undefined) {
    method.$expr = function() {
      $stackDepthOffset--;
      try {
        return Function.call.apply(method, arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return method.$expr;
};

var $subslice = function(slice, low, high, max) {
  if (low < 0 || high < low || max < high || high > slice.$capacity || max > slice.$capacity) {
    $throwRuntimeError("slice bounds out of range");
  }
  var s = new slice.constructor(slice.$array);
  s.$offset = slice.$offset + low;
  s.$length = slice.$length - low;
  s.$capacity = slice.$capacity - low;
  if (high !== undefined) {
    s.$length = high - low;
  }
  if (max !== undefined) {
    s.$capacity = max - low;
  }
  return s;
};

var $sliceToArray = function(slice) {
  if (slice.$length === 0) {
    return [];
  }
  if (slice.$array.constructor !== Array) {
    return slice.$array.subarray(slice.$offset, slice.$offset + slice.$length);
  }
  return slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
};

var $decodeRune = function(str, pos) {
  var c0 = str.charCodeAt(pos);

  if (c0 < 0x80) {
    return [c0, 1];
  }

  if (c0 !== c0 || c0 < 0xC0) {
    return [0xFFFD, 1];
  }

  var c1 = str.charCodeAt(pos + 1);
  if (c1 !== c1 || c1 < 0x80 || 0xC0 <= c1) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xE0) {
    var r = (c0 & 0x1F) << 6 | (c1 & 0x3F);
    if (r <= 0x7F) {
      return [0xFFFD, 1];
    }
    return [r, 2];
  }

  var c2 = str.charCodeAt(pos + 2);
  if (c2 !== c2 || c2 < 0x80 || 0xC0 <= c2) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF0) {
    var r = (c0 & 0x0F) << 12 | (c1 & 0x3F) << 6 | (c2 & 0x3F);
    if (r <= 0x7FF) {
      return [0xFFFD, 1];
    }
    if (0xD800 <= r && r <= 0xDFFF) {
      return [0xFFFD, 1];
    }
    return [r, 3];
  }

  var c3 = str.charCodeAt(pos + 3);
  if (c3 !== c3 || c3 < 0x80 || 0xC0 <= c3) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF8) {
    var r = (c0 & 0x07) << 18 | (c1 & 0x3F) << 12 | (c2 & 0x3F) << 6 | (c3 & 0x3F);
    if (r <= 0xFFFF || 0x10FFFF < r) {
      return [0xFFFD, 1];
    }
    return [r, 4];
  }

  return [0xFFFD, 1];
};

var $encodeRune = function(r) {
  if (r < 0 || r > 0x10FFFF || (0xD800 <= r && r <= 0xDFFF)) {
    r = 0xFFFD;
  }
  if (r <= 0x7F) {
    return String.fromCharCode(r);
  }
  if (r <= 0x7FF) {
    return String.fromCharCode(0xC0 | r >> 6, 0x80 | (r & 0x3F));
  }
  if (r <= 0xFFFF) {
    return String.fromCharCode(0xE0 | r >> 12, 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
  }
  return String.fromCharCode(0xF0 | r >> 18, 0x80 | (r >> 12 & 0x3F), 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
};

var $stringToBytes = function(str) {
  var array = new Uint8Array(str.length), i;
  for (i = 0; i < str.length; i++) {
    array[i] = str.charCodeAt(i);
  }
  return array;
};

var $bytesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "", i;
  for (i = 0; i < slice.$length; i += 10000) {
    str += String.fromCharCode.apply(null, slice.$array.subarray(slice.$offset + i, slice.$offset + Math.min(slice.$length, i + 10000)));
  }
  return str;
};

var $stringToRunes = function(str) {
  var array = new Int32Array(str.length);
  var rune, i, j = 0;
  for (i = 0; i < str.length; i += rune[1], j++) {
    rune = $decodeRune(str, i);
    array[j] = rune[0];
  }
  return array.subarray(0, j);
};

var $runesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "", i;
  for (i = 0; i < slice.$length; i++) {
    str += $encodeRune(slice.$array[slice.$offset + i]);
  }
  return str;
};

var $copyString = function(dst, src) {
  var n = Math.min(src.length, dst.$length), i;
  for (i = 0; i < n; i++) {
    dst.$array[dst.$offset + i] = src.charCodeAt(i);
  }
  return n;
};

var $copySlice = function(dst, src) {
  var n = Math.min(src.$length, dst.$length), i;
  $internalCopy(dst.$array, src.$array, dst.$offset, src.$offset, n, dst.constructor.elem);
  return n;
};

var $copy = function(dst, src, type) {
  var i;
  switch (type.kind) {
  case "Array":
    $internalCopy(dst, src, 0, 0, src.length, type.elem);
    return true;
  case "Struct":
    for (i = 0; i < type.fields.length; i++) {
      var field = type.fields[i];
      var name = field[0];
      if (!$copy(dst[name], src[name], field[3])) {
        dst[name] = src[name];
      }
    }
    return true;
  default:
    return false;
  }
};

var $internalCopy = function(dst, src, dstOffset, srcOffset, n, elem) {
  var i;
  if (n === 0) {
    return;
  }

  if (src.subarray) {
    dst.set(src.subarray(srcOffset, srcOffset + n), dstOffset);
    return;
  }

  switch (elem.kind) {
  case "Array":
  case "Struct":
    for (i = 0; i < n; i++) {
      $copy(dst[dstOffset + i], src[srcOffset + i], elem);
    }
    return;
  }

  for (i = 0; i < n; i++) {
    dst[dstOffset + i] = src[srcOffset + i];
  }
};

var $clone = function(src, type) {
  var clone = type.zero();
  $copy(clone, src, type);
  return clone;
};

var $append = function(slice) {
  return $internalAppend(slice, arguments, 1, arguments.length - 1);
};

var $appendSlice = function(slice, toAppend) {
  return $internalAppend(slice, toAppend.$array, toAppend.$offset, toAppend.$length);
};

var $internalAppend = function(slice, array, offset, length) {
  if (length === 0) {
    return slice;
  }

  var newArray = slice.$array;
  var newOffset = slice.$offset;
  var newLength = slice.$length + length;
  var newCapacity = slice.$capacity;

  if (newLength > newCapacity) {
    newOffset = 0;
    newCapacity = Math.max(newLength, slice.$capacity < 1024 ? slice.$capacity * 2 : Math.floor(slice.$capacity * 5 / 4));

    if (slice.$array.constructor === Array) {
      newArray = slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
      newArray.length = newCapacity;
      var zero = slice.constructor.elem.zero, i;
      for (i = slice.$length; i < newCapacity; i++) {
        newArray[i] = zero();
      }
    } else {
      newArray = new slice.$array.constructor(newCapacity);
      newArray.set(slice.$array.subarray(slice.$offset, slice.$offset + slice.$length));
    }
  }

  $internalCopy(newArray, array, newOffset + slice.$length, offset, length, slice.constructor.elem);

  var newSlice = new slice.constructor(newArray);
  newSlice.$offset = newOffset;
  newSlice.$length = newLength;
  newSlice.$capacity = newCapacity;
  return newSlice;
};

var $equal = function(a, b, type) {
  if (a === b) {
    return true;
  }
  var i;
  switch (type.kind) {
  case "Float32":
    return $float32IsEqual(a, b);
  case "Complex64":
    return $float32IsEqual(a.$real, b.$real) && $float32IsEqual(a.$imag, b.$imag);
  case "Complex128":
    return a.$real === b.$real && a.$imag === b.$imag;
  case "Int64":
  case "Uint64":
    return a.$high === b.$high && a.$low === b.$low;
  case "Ptr":
    if (a.constructor.Struct) {
      return false;
    }
    return $pointerIsEqual(a, b);
  case "Array":
    if (a.length != b.length) {
      return false;
    }
    var i;
    for (i = 0; i < a.length; i++) {
      if (!$equal(a[i], b[i], type.elem)) {
        return false;
      }
    }
    return true;
  case "Struct":
    for (i = 0; i < type.fields.length; i++) {
      var field = type.fields[i];
      var name = field[0];
      if (!$equal(a[name], b[name], field[3])) {
        return false;
      }
    }
    return true;
  default:
    return false;
  }
};

var $interfaceIsEqual = function(a, b) {
  if (a === null || b === null || a === undefined || b === undefined || a.constructor !== b.constructor) {
    return a === b;
  }
  switch (a.constructor.kind) {
  case "Func":
  case "Map":
  case "Slice":
  case "Struct":
    $throwRuntimeError("comparing uncomparable type " + a.constructor.string);
  case undefined: /* js.Object */
    return a === b;
  default:
    return $equal(a.$val, b.$val, a.constructor);
  }
};

var $float32IsEqual = function(a, b) {
  if (a === b) {
    return true;
  }
  if (a === 0 || b === 0 || a === 1/0 || b === 1/0 || a === -1/0 || b === -1/0 || a !== a || b !== b) {
    return false;
  }
  var math = $packages["math"];
  return math !== undefined && math.Float32bits(a) === math.Float32bits(b);
};

var $pointerIsEqual = function(a, b) {
  if (a === b) {
    return true;
  }
  if (a.$get === $throwNilPointerError || b.$get === $throwNilPointerError) {
    return a.$get === $throwNilPointerError && b.$get === $throwNilPointerError;
  }
  var va = a.$get();
  var vb = b.$get();
  if (va !== vb) {
    return false;
  }
  var dummy = va + 1;
  a.$set(dummy);
  var equal = b.$get() === dummy;
  a.$set(va);
  return equal;
};

var $newType = function(size, kind, string, name, pkgPath, constructor) {
  var typ;
  switch(kind) {
  case "Bool":
  case "Int":
  case "Int8":
  case "Int16":
  case "Int32":
  case "Uint":
  case "Uint8" :
  case "Uint16":
  case "Uint32":
  case "Uintptr":
  case "String":
  case "UnsafePointer":
    typ = function(v) { this.$val = v; };
    typ.prototype.$key = function() { return string + "$" + this.$val; };
    break;

  case "Float32":
  case "Float64":
    typ = function(v) { this.$val = v; };
    typ.prototype.$key = function() { return string + "$" + $floatKey(this.$val); };
    break;

  case "Int64":
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.prototype.$key = function() { return string + "$" + this.$high + "$" + this.$low; };
    break;

  case "Uint64":
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >>> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.prototype.$key = function() { return string + "$" + this.$high + "$" + this.$low; };
    break;

  case "Complex64":
  case "Complex128":
    typ = function(real, imag) {
      this.$real = real;
      this.$imag = imag;
      this.$val = this;
    };
    typ.prototype.$key = function() { return string + "$" + this.$real + "$" + this.$imag; };
    break;

  case "Array":
    typ = function(v) { this.$val = v; };
    typ.Ptr = $newType(4, "Ptr", "*" + string, "", "", function(array) {
      this.$get = function() { return array; };
      this.$val = array;
    });
    typ.init = function(elem, len) {
      typ.elem = elem;
      typ.len = len;
      typ.prototype.$key = function() {
        return string + "$" + Array.prototype.join.call($mapArray(this.$val, function(e) {
          var key = e.$key ? e.$key() : String(e);
          return key.replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }), "$");
      };
      typ.extendReflectType = function(rt) {
        rt.arrayType = new $reflect.arrayType.Ptr(rt, elem.reflectType(), undefined, len);
      };
      typ.Ptr.init(typ);
      Object.defineProperty(typ.Ptr.nil, "nilCheck", { get: $throwNilPointerError });
    };
    break;

  case "Chan":
    typ = function(capacity) {
      this.$val = this;
      this.$capacity = capacity;
      this.$buffer = [];
      this.$sendQueue = [];
      this.$recvQueue = [];
      this.$closed = false;
    };
    typ.prototype.$key = function() {
      if (this.$id === undefined) {
        $idCounter++;
        this.$id = $idCounter;
      }
      return String(this.$id);
    };
    typ.init = function(elem, sendOnly, recvOnly) {
      typ.elem = elem;
      typ.sendOnly = sendOnly;
      typ.recvOnly = recvOnly;
      typ.nil = new typ(0);
      typ.nil.$sendQueue = typ.nil.$recvQueue = { length: 0, push: function() {}, shift: function() { return undefined; }, indexOf: function() { return -1; } };
      typ.extendReflectType = function(rt) {
        rt.chanType = new $reflect.chanType.Ptr(rt, elem.reflectType(), sendOnly ? $reflect.SendDir : (recvOnly ? $reflect.RecvDir : $reflect.BothDir));
      };
    };
    break;

  case "Func":
    typ = function(v) { this.$val = v; };
    typ.init = function(params, results, variadic) {
      typ.params = params;
      typ.results = results;
      typ.variadic = variadic;
      typ.extendReflectType = function(rt) {
        var typeSlice = ($sliceType($ptrType($reflect.rtype.Ptr)));
        rt.funcType = new $reflect.funcType.Ptr(rt, variadic, new typeSlice($mapArray(params, function(p) { return p.reflectType(); })), new typeSlice($mapArray(results, function(p) { return p.reflectType(); })));
      };
    };
    break;

  case "Interface":
    typ = { implementedBy: {}, missingMethodFor: {} };
    typ.init = function(methods) {
      typ.methods = methods;
      typ.extendReflectType = function(rt) {
        var imethods = $mapArray(methods, function(m) {
          return new $reflect.imethod.Ptr($newStringPtr(m[1]), $newStringPtr(m[2]), m[3].reflectType());
        });
        var methodSlice = ($sliceType($ptrType($reflect.imethod.Ptr)));
        rt.interfaceType = new $reflect.interfaceType.Ptr(rt, new methodSlice(imethods));
      };
    };
    break;

  case "Map":
    typ = function(v) { this.$val = v; };
    typ.init = function(key, elem) {
      typ.key = key;
      typ.elem = elem;
      typ.extendReflectType = function(rt) {
        rt.mapType = new $reflect.mapType.Ptr(rt, key.reflectType(), elem.reflectType(), undefined, undefined);
      };
    };
    break;

  case "Ptr":
    typ = constructor || function(getter, setter, target) {
      this.$get = getter;
      this.$set = setter;
      this.$target = target;
      this.$val = this;
    };
    typ.prototype.$key = function() {
      if (this.$id === undefined) {
        $idCounter++;
        this.$id = $idCounter;
      }
      return String(this.$id);
    };
    typ.init = function(elem) {
      typ.nil = new typ($throwNilPointerError, $throwNilPointerError);
      typ.extendReflectType = function(rt) {
        rt.ptrType = new $reflect.ptrType.Ptr(rt, elem.reflectType());
      };
    };
    break;

  case "Slice":
    var nativeArray;
    typ = function(array) {
      if (array.constructor !== nativeArray) {
        array = new nativeArray(array);
      }
      this.$array = array;
      this.$offset = 0;
      this.$length = array.length;
      this.$capacity = array.length;
      this.$val = this;
    };
    typ.make = function(length, capacity) {
      capacity = capacity || length;
      var array = new nativeArray(capacity), i;
      if (nativeArray === Array) {
        for (i = 0; i < capacity; i++) {
          array[i] = typ.elem.zero();
        }
      }
      var slice = new typ(array);
      slice.$length = length;
      return slice;
    };
    typ.init = function(elem) {
      typ.elem = elem;
      nativeArray = $nativeArray(elem.kind);
      typ.nil = new typ([]);
      typ.extendReflectType = function(rt) {
        rt.sliceType = new $reflect.sliceType.Ptr(rt, elem.reflectType());
      };
    };
    break;

  case "Struct":
    typ = function(v) { this.$val = v; };
    typ.Ptr = $newType(4, "Ptr", "*" + string, "", "", constructor);
    typ.Ptr.Struct = typ;
    typ.Ptr.prototype.$get = function() { return this; };
    typ.init = function(fields) {
      var i;
      typ.fields = fields;
      typ.prototype.$key = function() {
        var val = this.$val;
        return string + "$" + $mapArray(fields, function(field) {
          var e = val[field[0]];
          var key = e.$key ? e.$key() : String(e);
          return key.replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }).join("$");
      };
      typ.Ptr.extendReflectType = function(rt) {
        rt.ptrType = new $reflect.ptrType.Ptr(rt, typ.reflectType());
      };
      /* nil value */
      typ.Ptr.nil = Object.create(constructor.prototype);
      typ.Ptr.nil.$val = typ.Ptr.nil;
      for (i = 0; i < fields.length; i++) {
        var field = fields[i];
        Object.defineProperty(typ.Ptr.nil, field[0], { get: $throwNilPointerError, set: $throwNilPointerError });
      }
      /* methods for embedded fields */
      for (i = 0; i < typ.methods.length; i++) {
        var m = typ.methods[i];
        if (m[4] != -1) {
          (function(field, methodName) {
            typ.prototype[methodName] = function() {
              var v = this.$val[field[0]];
              return v[methodName].apply(v, arguments);
            };
          })(fields[m[4]], m[0]);
        }
      }
      for (i = 0; i < typ.Ptr.methods.length; i++) {
        var m = typ.Ptr.methods[i];
        if (m[4] != -1) {
          (function(field, methodName) {
            typ.Ptr.prototype[methodName] = function() {
              var v = this[field[0]];
              if (v.$val === undefined) {
                v = new field[3](v);
              }
              return v[methodName].apply(v, arguments);
            };
          })(fields[m[4]], m[0]);
        }
      }
      /* reflect type */
      typ.extendReflectType = function(rt) {
        var reflectFields = new Array(fields.length), i;
        for (i = 0; i < fields.length; i++) {
          var field = fields[i];
          reflectFields[i] = new $reflect.structField.Ptr($newStringPtr(field[1]), $newStringPtr(field[2]), field[3].reflectType(), $newStringPtr(field[4]), i);
        }
        rt.structType = new $reflect.structType.Ptr(rt, new ($sliceType($reflect.structField.Ptr))(reflectFields));
      };
    };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  switch(kind) {
  case "Bool":
  case "Map":
    typ.zero = function() { return false; };
    break;

  case "Int":
  case "Int8":
  case "Int16":
  case "Int32":
  case "Uint":
  case "Uint8" :
  case "Uint16":
  case "Uint32":
  case "Uintptr":
  case "UnsafePointer":
  case "Float32":
  case "Float64":
    typ.zero = function() { return 0; };
    break;

  case "String":
    typ.zero = function() { return ""; };
    break;

  case "Int64":
  case "Uint64":
  case "Complex64":
  case "Complex128":
    var zero = new typ(0, 0);
    typ.zero = function() { return zero; };
    break;

  case "Chan":
  case "Ptr":
  case "Slice":
    typ.zero = function() { return typ.nil; };
    break;

  case "Func":
    typ.zero = function() { return $throwNilPointerError; };
    break;

  case "Interface":
    typ.zero = function() { return $ifaceNil; };
    break;

  case "Array":
    typ.zero = function() {
      var arrayClass = $nativeArray(typ.elem.kind);
      if (arrayClass !== Array) {
        return new arrayClass(typ.len);
      }
      var array = new Array(typ.len), i;
      for (i = 0; i < typ.len; i++) {
        array[i] = typ.elem.zero();
      }
      return array;
    };
    break;

  case "Struct":
    typ.zero = function() { return new typ.Ptr(); };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  typ.kind = kind;
  typ.string = string;
  typ.typeName = name;
  typ.pkgPath = pkgPath;
  typ.methods = [];
  var rt = null;
  typ.reflectType = function() {
    if (rt === null) {
      rt = new $reflect.rtype.Ptr(size, 0, 0, 0, 0, $reflect.kinds[kind], undefined, undefined, $newStringPtr(string), undefined, undefined);
      rt.jsType = typ;

      var methods = [];
      if (typ.methods !== undefined) {
        var i;
        for (i = 0; i < typ.methods.length; i++) {
          var m = typ.methods[i];
          var t = m[3];
          methods.push(new $reflect.method.Ptr($newStringPtr(m[1]), $newStringPtr(m[2]), t.reflectType(), $funcType([typ].concat(t.params), t.results, t.variadic).reflectType(), undefined, undefined));
        }
      }
      if (name !== "" || methods.length !== 0) {
        var methodSlice = ($sliceType($ptrType($reflect.method.Ptr)));
        rt.uncommonType = new $reflect.uncommonType.Ptr($newStringPtr(name), $newStringPtr(pkgPath), new methodSlice(methods));
        rt.uncommonType.jsType = typ;
      }

      if (typ.extendReflectType !== undefined) {
        typ.extendReflectType(rt);
      }
    }
    return rt;
  };
  return typ;
};

var $Bool          = $newType( 1, "Bool",          "bool",           "bool",       "", null);
var $Int           = $newType( 4, "Int",           "int",            "int",        "", null);
var $Int8          = $newType( 1, "Int8",          "int8",           "int8",       "", null);
var $Int16         = $newType( 2, "Int16",         "int16",          "int16",      "", null);
var $Int32         = $newType( 4, "Int32",         "int32",          "int32",      "", null);
var $Int64         = $newType( 8, "Int64",         "int64",          "int64",      "", null);
var $Uint          = $newType( 4, "Uint",          "uint",           "uint",       "", null);
var $Uint8         = $newType( 1, "Uint8",         "uint8",          "uint8",      "", null);
var $Uint16        = $newType( 2, "Uint16",        "uint16",         "uint16",     "", null);
var $Uint32        = $newType( 4, "Uint32",        "uint32",         "uint32",     "", null);
var $Uint64        = $newType( 8, "Uint64",        "uint64",         "uint64",     "", null);
var $Uintptr       = $newType( 4, "Uintptr",       "uintptr",        "uintptr",    "", null);
var $Float32       = $newType( 4, "Float32",       "float32",        "float32",    "", null);
var $Float64       = $newType( 8, "Float64",       "float64",        "float64",    "", null);
var $Complex64     = $newType( 8, "Complex64",     "complex64",      "complex64",  "", null);
var $Complex128    = $newType(16, "Complex128",    "complex128",     "complex128", "", null);
var $String        = $newType( 8, "String",        "string",         "string",     "", null);
var $UnsafePointer = $newType( 4, "UnsafePointer", "unsafe.Pointer", "Pointer",    "", null);

var $nativeArray = function(elemKind) {
  return ({ Int: Int32Array, Int8: Int8Array, Int16: Int16Array, Int32: Int32Array, Uint: Uint32Array, Uint8: Uint8Array, Uint16: Uint16Array, Uint32: Uint32Array, Uintptr: Uint32Array, Float32: Float32Array, Float64: Float64Array })[elemKind] || Array;
};
var $toNativeArray = function(elemKind, array) {
  var nativeArray = $nativeArray(elemKind);
  if (nativeArray === Array) {
    return array;
  }
  return new nativeArray(array);
};
var $arrayTypes = {};
var $arrayType = function(elem, len) {
  var string = "[" + len + "]" + elem.string;
  var typ = $arrayTypes[string];
  if (typ === undefined) {
    typ = $newType(12, "Array", string, "", "", null);
    typ.init(elem, len);
    $arrayTypes[string] = typ;
  }
  return typ;
};

var $chanType = function(elem, sendOnly, recvOnly) {
  var string = (recvOnly ? "<-" : "") + "chan" + (sendOnly ? "<- " : " ") + elem.string;
  var field = sendOnly ? "SendChan" : (recvOnly ? "RecvChan" : "Chan");
  var typ = elem[field];
  if (typ === undefined) {
    typ = $newType(4, "Chan", string, "", "", null);
    typ.init(elem, sendOnly, recvOnly);
    elem[field] = typ;
  }
  return typ;
};

var $funcTypes = {};
var $funcType = function(params, results, variadic) {
  var paramTypes = $mapArray(params, function(p) { return p.string; });
  if (variadic) {
    paramTypes[paramTypes.length - 1] = "..." + paramTypes[paramTypes.length - 1].substr(2);
  }
  var string = "func(" + paramTypes.join(", ") + ")";
  if (results.length === 1) {
    string += " " + results[0].string;
  } else if (results.length > 1) {
    string += " (" + $mapArray(results, function(r) { return r.string; }).join(", ") + ")";
  }
  var typ = $funcTypes[string];
  if (typ === undefined) {
    typ = $newType(4, "Func", string, "", "", null);
    typ.init(params, results, variadic);
    $funcTypes[string] = typ;
  }
  return typ;
};

var $interfaceTypes = {};
var $interfaceType = function(methods) {
  var string = "interface {}";
  if (methods.length !== 0) {
    string = "interface { " + $mapArray(methods, function(m) {
      return (m[2] !== "" ? m[2] + "." : "") + m[1] + m[3].string.substr(4);
    }).join("; ") + " }";
  }
  var typ = $interfaceTypes[string];
  if (typ === undefined) {
    typ = $newType(8, "Interface", string, "", "", null);
    typ.init(methods);
    $interfaceTypes[string] = typ;
  }
  return typ;
};
var $emptyInterface = $interfaceType([]);
var $ifaceNil = { $key: function() { return "nil"; } };
var $error = $newType(8, "Interface", "error", "error", "", null);
$error.init([["Error", "Error", "", $funcType([], [$String], false)]]);

var $Map = function() {};
(function() {
  var names = Object.getOwnPropertyNames(Object.prototype), i;
  for (i = 0; i < names.length; i++) {
    $Map.prototype[names[i]] = undefined;
  }
})();
var $mapTypes = {};
var $mapType = function(key, elem) {
  var string = "map[" + key.string + "]" + elem.string;
  var typ = $mapTypes[string];
  if (typ === undefined) {
    typ = $newType(4, "Map", string, "", "", null);
    typ.init(key, elem);
    $mapTypes[string] = typ;
  }
  return typ;
};


var $throwNilPointerError = function() { $throwRuntimeError("invalid memory address or nil pointer dereference"); };
var $ptrType = function(elem) {
  var typ = elem.Ptr;
  if (typ === undefined) {
    typ = $newType(4, "Ptr", "*" + elem.string, "", "", null);
    typ.init(elem);
    elem.Ptr = typ;
  }
  return typ;
};

var $stringPtrMap = new $Map();
var $newStringPtr = function(str) {
  if (str === undefined || str === "") {
    return $ptrType($String).nil;
  }
  var ptr = $stringPtrMap[str];
  if (ptr === undefined) {
    ptr = new ($ptrType($String))(function() { return str; }, function(v) { str = v; });
    $stringPtrMap[str] = ptr;
  }
  return ptr;
};

var $newDataPointer = function(data, constructor) {
  if (constructor.Struct) {
    return data;
  }
  return new constructor(function() { return data; }, function(v) { data = v; });
};

var $sliceType = function(elem) {
  var typ = elem.Slice;
  if (typ === undefined) {
    typ = $newType(12, "Slice", "[]" + elem.string, "", "", null);
    typ.init(elem);
    elem.Slice = typ;
  }
  return typ;
};

var $structTypes = {};
var $structType = function(fields) {
  var string = "struct { " + $mapArray(fields, function(f) {
    return f[1] + " " + f[3].string + (f[4] !== "" ? (" \"" + f[4].replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"") : "");
  }).join("; ") + " }";
  if (fields.length === 0) {
    string = "struct {}";
  }
  var typ = $structTypes[string];
  if (typ === undefined) {
    typ = $newType(0, "Struct", string, "", "", function() {
      this.$val = this;
      var i;
      for (i = 0; i < fields.length; i++) {
        var field = fields[i];
        var arg = arguments[i];
        this[field[0]] = arg !== undefined ? arg : field[3].zero();
      }
    });
    /* collect methods for anonymous fields */
    var i, j;
    for (i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (field[1] === "") {
        var methods = field[3].methods;
        for (j = 0; j < methods.length; j++) {
          var m = methods[j].slice(0, 6).concat([i]);
          typ.methods.push(m);
          typ.Ptr.methods.push(m);
        }
        if (field[3].kind === "Struct") {
          var methods = field[3].Ptr.methods;
          for (j = 0; j < methods.length; j++) {
            typ.Ptr.methods.push(methods[j].slice(0, 6).concat([i]));
          }
        }
      }
    }
    typ.init(fields);
    $structTypes[string] = typ;
  }
  return typ;
};

var $assertType = function(value, type, returnTuple) {
  var isInterface = (type.kind === "Interface"), ok, missingMethod = "";
  if (value === $ifaceNil) {
    ok = false;
  } else if (!isInterface) {
    ok = value.constructor === type;
  } else if (type.string === "js.Object") {
    ok = true;
  } else {
    var valueTypeString = value.constructor.string;
    ok = type.implementedBy[valueTypeString];
    if (ok === undefined) {
      ok = true;
      var valueMethods = value.constructor.methods;
      var typeMethods = type.methods;
      for (var i = 0; i < typeMethods.length; i++) {
        var tm = typeMethods[i];
        var found = false;
        for (var j = 0; j < valueMethods.length; j++) {
          var vm = valueMethods[j];
          if (vm[1] === tm[1] && vm[2] === tm[2] && vm[3] === tm[3]) {
            found = true;
            break;
          }
        }
        if (!found) {
          ok = false;
          type.missingMethodFor[valueTypeString] = tm[1];
          break;
        }
      }
      type.implementedBy[valueTypeString] = ok;
    }
    if (!ok) {
      missingMethod = type.missingMethodFor[valueTypeString];
    }
  }

  if (!ok) {
    if (returnTuple) {
      return [type.zero(), false];
    }
    $panic(new $packages["runtime"].TypeAssertionError.Ptr("", (value === $ifaceNil ? "" : value.constructor.string), type.string, missingMethod));
  }

  if (!isInterface) {
    value = value.$val;
  }
  return returnTuple ? [value, true] : value;
};

var $coerceFloat32 = function(f) {
  var math = $packages["math"];
  if (math === undefined) {
    return f;
  }
  return math.Float32frombits(math.Float32bits(f));
};

var $floatKey = function(f) {
  if (f !== f) {
    $idCounter++;
    return "NaN$" + $idCounter;
  }
  return String(f);
};

var $flatten64 = function(x) {
  return x.$high * 4294967296 + x.$low;
};

var $shiftLeft64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high << y | x.$low >>> (32 - y), (x.$low << y) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$low << (y - 32), 0);
  }
  return new x.constructor(0, 0);
};

var $shiftRightInt64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$high >> 31, (x.$high >> (y - 32)) >>> 0);
  }
  if (x.$high < 0) {
    return new x.constructor(-1, 4294967295);
  }
  return new x.constructor(0, 0);
};

var $shiftRightUint64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >>> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(0, x.$high >>> (y - 32));
  }
  return new x.constructor(0, 0);
};

var $mul64 = function(x, y) {
  var high = 0, low = 0, i;
  if ((y.$low & 1) !== 0) {
    high = x.$high;
    low = x.$low;
  }
  for (i = 1; i < 32; i++) {
    if ((y.$low & 1<<i) !== 0) {
      high += x.$high << i | x.$low >>> (32 - i);
      low += (x.$low << i) >>> 0;
    }
  }
  for (i = 0; i < 32; i++) {
    if ((y.$high & 1<<i) !== 0) {
      high += x.$low << i;
    }
  }
  return new x.constructor(high, low);
};

var $div64 = function(x, y, returnRemainder) {
  if (y.$high === 0 && y.$low === 0) {
    $throwRuntimeError("integer divide by zero");
  }

  var s = 1;
  var rs = 1;

  var xHigh = x.$high;
  var xLow = x.$low;
  if (xHigh < 0) {
    s = -1;
    rs = -1;
    xHigh = -xHigh;
    if (xLow !== 0) {
      xHigh--;
      xLow = 4294967296 - xLow;
    }
  }

  var yHigh = y.$high;
  var yLow = y.$low;
  if (y.$high < 0) {
    s *= -1;
    yHigh = -yHigh;
    if (yLow !== 0) {
      yHigh--;
      yLow = 4294967296 - yLow;
    }
  }

  var high = 0, low = 0, n = 0, i;
  while (yHigh < 2147483648 && ((xHigh > yHigh) || (xHigh === yHigh && xLow > yLow))) {
    yHigh = (yHigh << 1 | yLow >>> 31) >>> 0;
    yLow = (yLow << 1) >>> 0;
    n++;
  }
  for (i = 0; i <= n; i++) {
    high = high << 1 | low >>> 31;
    low = (low << 1) >>> 0;
    if ((xHigh > yHigh) || (xHigh === yHigh && xLow >= yLow)) {
      xHigh = xHigh - yHigh;
      xLow = xLow - yLow;
      if (xLow < 0) {
        xHigh--;
        xLow += 4294967296;
      }
      low++;
      if (low === 4294967296) {
        high++;
        low = 0;
      }
    }
    yLow = (yLow >>> 1 | yHigh << (32 - 1)) >>> 0;
    yHigh = yHigh >>> 1;
  }

  if (returnRemainder) {
    return new x.constructor(xHigh * rs, xLow * rs);
  }
  return new x.constructor(high * s, low * s);
};

var $divComplex = function(n, d) {
  var ninf = n.$real === 1/0 || n.$real === -1/0 || n.$imag === 1/0 || n.$imag === -1/0;
  var dinf = d.$real === 1/0 || d.$real === -1/0 || d.$imag === 1/0 || d.$imag === -1/0;
  var nnan = !ninf && (n.$real !== n.$real || n.$imag !== n.$imag);
  var dnan = !dinf && (d.$real !== d.$real || d.$imag !== d.$imag);
  if(nnan || dnan) {
    return new n.constructor(0/0, 0/0);
  }
  if (ninf && !dinf) {
    return new n.constructor(1/0, 1/0);
  }
  if (!ninf && dinf) {
    return new n.constructor(0, 0);
  }
  if (d.$real === 0 && d.$imag === 0) {
    if (n.$real === 0 && n.$imag === 0) {
      return new n.constructor(0/0, 0/0);
    }
    return new n.constructor(1/0, 1/0);
  }
  var a = Math.abs(d.$real);
  var b = Math.abs(d.$imag);
  if (a <= b) {
    var ratio = d.$real / d.$imag;
    var denom = d.$real * ratio + d.$imag;
    return new n.constructor((n.$real * ratio + n.$imag) / denom, (n.$imag * ratio - n.$real) / denom);
  }
  var ratio = d.$imag / d.$real;
  var denom = d.$imag * ratio + d.$real;
  return new n.constructor((n.$imag * ratio + n.$real) / denom, (n.$imag - n.$real * ratio) / denom);
};

var $stackDepthOffset = 0;
var $getStackDepth = function() {
  var err = new Error();
  if (err.stack === undefined) {
    return undefined;
  }
  return $stackDepthOffset + err.stack.split("\n").length;
};

var $deferFrames = [], $skippedDeferFrames = 0, $jumpToDefer = false, $panicStackDepth = null, $panicValue;
var $callDeferred = function(deferred, jsErr) {
  if ($skippedDeferFrames !== 0) {
    $skippedDeferFrames--;
    throw jsErr;
  }
  if ($jumpToDefer) {
    $jumpToDefer = false;
    throw jsErr;
  }
  if (jsErr) {
    var newErr = null;
    try {
      $deferFrames.push(deferred);
      $panic(new $packages["github.com/gopherjs/gopherjs/js"].Error.Ptr(jsErr));
    } catch (err) {
      newErr = err;
    }
    $deferFrames.pop();
    $callDeferred(deferred, newErr);
    return;
  }

  $stackDepthOffset--;
  var outerPanicStackDepth = $panicStackDepth;
  var outerPanicValue = $panicValue;

  var localPanicValue = $curGoroutine.panicStack.pop();
  if (localPanicValue !== undefined) {
    $panicStackDepth = $getStackDepth();
    $panicValue = localPanicValue;
  }

  var call;
  try {
    while (true) {
      if (deferred === null) {
        deferred = $deferFrames[$deferFrames.length - 1 - $skippedDeferFrames];
        if (deferred === undefined) {
          if (localPanicValue.constructor === $String) {
            throw new Error(localPanicValue.$val);
          } else if (localPanicValue.Error !== undefined) {
            throw new Error(localPanicValue.Error());
          } else if (localPanicValue.String !== undefined) {
            throw new Error(localPanicValue.String());
          } else {
            throw new Error(localPanicValue);
          }
        }
      }
      var call = deferred.pop();
      if (call === undefined) {
        if (localPanicValue !== undefined) {
          $skippedDeferFrames++;
          deferred = null;
          continue;
        }
        return;
      }
      var r = call[0].apply(undefined, call[1]);
      if (r && r.$blocking) {
        deferred.push([r, []]);
      }

      if (localPanicValue !== undefined && $panicStackDepth === null) {
        throw null; /* error was recovered */
      }
    }
  } finally {
    if ($curGoroutine.asleep) {
      deferred.push(call);
      $jumpToDefer = true;
    }
    if (localPanicValue !== undefined) {
      if ($panicStackDepth !== null) {
        $curGoroutine.panicStack.push(localPanicValue);
      }
      $panicStackDepth = outerPanicStackDepth;
      $panicValue = outerPanicValue;
    }
    $stackDepthOffset++;
  }
};

var $panic = function(value) {
  $curGoroutine.panicStack.push(value);
  $callDeferred(null, null);
};
var $recover = function() {
  if ($panicStackDepth === null || ($panicStackDepth !== undefined && $panicStackDepth !== $getStackDepth() - 2)) {
    return $ifaceNil;
  }
  $panicStackDepth = null;
  return $panicValue;
};
var $nonblockingCall = function() {
  $panic(new $packages["runtime"].NotSupportedError.Ptr("non-blocking call to blocking function (mark call with \"//gopherjs:blocking\" to fix)"));
};
var $throw = function(err) { throw err; };
var $throwRuntimeError; /* set by package "runtime" */

var $dummyGoroutine = { asleep: false, exit: false, panicStack: [] };
var $curGoroutine = $dummyGoroutine, $totalGoroutines = 0, $awakeGoroutines = 0, $checkForDeadlock = true;
var $go = function(fun, args, direct) {
  $totalGoroutines++;
  $awakeGoroutines++;
  args.push(true);
  var goroutine = function() {
    var rescheduled = false;
    try {
      $curGoroutine = goroutine;
      $skippedDeferFrames = 0;
      $jumpToDefer = false;
      var r = fun.apply(undefined, args);
      if (r && r.$blocking) {
        fun = r;
        args = [];
        $schedule(goroutine, direct);
        rescheduled = true;
        return;
      }
      goroutine.exit = true;
    } catch (err) {
      if (!$curGoroutine.asleep) {
        goroutine.exit = true;
        throw err;
      }
    } finally {
      $curGoroutine = $dummyGoroutine;
      if (goroutine.exit && !rescheduled) { /* also set by runtime.Goexit() */
        $totalGoroutines--;
        goroutine.asleep = true;
      }
      if (goroutine.asleep && !rescheduled) {
        $awakeGoroutines--;
        if ($awakeGoroutines === 0 && $totalGoroutines !== 0 && $checkForDeadlock) {
          console.error("fatal error: all goroutines are asleep - deadlock!");
        }
      }
    }
  };
  goroutine.asleep = false;
  goroutine.exit = false;
  goroutine.panicStack = [];
  $schedule(goroutine, direct);
};

var $scheduled = [], $schedulerLoopActive = false;
var $schedule = function(goroutine, direct) {
  if (goroutine.asleep) {
    goroutine.asleep = false;
    $awakeGoroutines++;
  }

  if (direct) {
    goroutine();
    return;
  }

  $scheduled.push(goroutine);
  if (!$schedulerLoopActive) {
    $schedulerLoopActive = true;
    setTimeout(function() {
      while (true) {
        var r = $scheduled.shift();
        if (r === undefined) {
          $schedulerLoopActive = false;
          break;
        }
        r();
      };
    }, 0);
  }
};

var $send = function(chan, value) {
  if (chan.$closed) {
    $throwRuntimeError("send on closed channel");
  }
  var queuedRecv = chan.$recvQueue.shift();
  if (queuedRecv !== undefined) {
    queuedRecv([value, true]);
    return;
  }
  if (chan.$buffer.length < chan.$capacity) {
    chan.$buffer.push(value);
    return;
  }

  var thisGoroutine = $curGoroutine;
  chan.$sendQueue.push(function() {
    $schedule(thisGoroutine);
    return value;
  });
  var blocked = false;
  var f = function() {
    if (blocked) {
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      return;
    };
    blocked = true;
    $curGoroutine.asleep = true;
    throw null;
  };
  f.$blocking = true;
  return f;
};
var $recv = function(chan) {
  var queuedSend = chan.$sendQueue.shift();
  if (queuedSend !== undefined) {
    chan.$buffer.push(queuedSend());
  }
  var bufferedValue = chan.$buffer.shift();
  if (bufferedValue !== undefined) {
    return [bufferedValue, true];
  }
  if (chan.$closed) {
    return [chan.constructor.elem.zero(), false];
  }

  var thisGoroutine = $curGoroutine, value;
  var queueEntry = function(v) {
    value = v;
    $schedule(thisGoroutine);
  };
  chan.$recvQueue.push(queueEntry);
  var blocked = false;
  var f = function() {
    if (blocked) {
      return value;
    };
    blocked = true;
    $curGoroutine.asleep = true;
    throw null;
  };
  f.$blocking = true;
  return f;
};
var $close = function(chan) {
  if (chan.$closed) {
    $throwRuntimeError("close of closed channel");
  }
  chan.$closed = true;
  while (true) {
    var queuedSend = chan.$sendQueue.shift();
    if (queuedSend === undefined) {
      break;
    }
    queuedSend(); /* will panic because of closed channel */
  }
  while (true) {
    var queuedRecv = chan.$recvQueue.shift();
    if (queuedRecv === undefined) {
      break;
    }
    queuedRecv([chan.constructor.elem.zero(), false]);
  }
};
var $select = function(comms) {
  var ready = [], i;
  var selection = -1;
  for (i = 0; i < comms.length; i++) {
    var comm = comms[i];
    var chan = comm[0];
    switch (comm.length) {
    case 0: /* default */
      selection = i;
      break;
    case 1: /* recv */
      if (chan.$sendQueue.length !== 0 || chan.$buffer.length !== 0 || chan.$closed) {
        ready.push(i);
      }
      break;
    case 2: /* send */
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      if (chan.$recvQueue.length !== 0 || chan.$buffer.length < chan.$capacity) {
        ready.push(i);
      }
      break;
    }
  }

  if (ready.length !== 0) {
    selection = ready[Math.floor(Math.random() * ready.length)];
  }
  if (selection !== -1) {
    var comm = comms[selection];
    switch (comm.length) {
    case 0: /* default */
      return [selection];
    case 1: /* recv */
      return [selection, $recv(comm[0])];
    case 2: /* send */
      $send(comm[0], comm[1]);
      return [selection];
    }
  }

  var entries = [];
  var thisGoroutine = $curGoroutine;
  var removeFromQueues = function() {
    for (i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var queue = entry[0];
      var index = queue.indexOf(entry[1]);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  };
  for (i = 0; i < comms.length; i++) {
    (function(i) {
      var comm = comms[i];
      switch (comm.length) {
      case 1: /* recv */
        var queueEntry = function(value) {
          selection = [i, value];
          removeFromQueues();
          $schedule(thisGoroutine);
        };
        entries.push([comm[0].$recvQueue, queueEntry]);
        comm[0].$recvQueue.push(queueEntry);
        break;
      case 2: /* send */
        var queueEntry = function() {
          if (comm[0].$closed) {
            $throwRuntimeError("send on closed channel");
          }
          selection = [i];
          removeFromQueues();
          $schedule(thisGoroutine);
          return comm[1];
        };
        entries.push([comm[0].$sendQueue, queueEntry]);
        comm[0].$sendQueue.push(queueEntry);
        break;
      }
    })(i);
  }
  var blocked = false;
  var f = function() {
    if (blocked) {
      return selection;
    };
    blocked = true;
    $curGoroutine.asleep = true;
    throw null;
  };
  f.$blocking = true;
  return f;
};

var $needsExternalization = function(t) {
  switch (t.kind) {
    case "Bool":
    case "Int":
    case "Int8":
    case "Int16":
    case "Int32":
    case "Uint":
    case "Uint8":
    case "Uint16":
    case "Uint32":
    case "Uintptr":
    case "Float32":
    case "Float64":
      return false;
    case "Interface":
      return t !== $packages["github.com/gopherjs/gopherjs/js"].Object;
    default:
      return true;
  }
};

var $externalize = function(v, t) {
  switch (t.kind) {
  case "Bool":
  case "Int":
  case "Int8":
  case "Int16":
  case "Int32":
  case "Uint":
  case "Uint8":
  case "Uint16":
  case "Uint32":
  case "Uintptr":
  case "Float32":
  case "Float64":
    return v;
  case "Int64":
  case "Uint64":
    return $flatten64(v);
  case "Array":
    if ($needsExternalization(t.elem)) {
      return $mapArray(v, function(e) { return $externalize(e, t.elem); });
    }
    return v;
  case "Func":
    if (v === $throwNilPointerError) {
      return null;
    }
    if (v.$externalizeWrapper === undefined) {
      $checkForDeadlock = false;
      var convert = false;
      var i;
      for (i = 0; i < t.params.length; i++) {
        convert = convert || (t.params[i] !== $packages["github.com/gopherjs/gopherjs/js"].Object);
      }
      for (i = 0; i < t.results.length; i++) {
        convert = convert || $needsExternalization(t.results[i]);
      }
      if (!convert) {
        return v;
      }
      v.$externalizeWrapper = function() {
        var args = [], i;
        for (i = 0; i < t.params.length; i++) {
          if (t.variadic && i === t.params.length - 1) {
            var vt = t.params[i].elem, varargs = [], j;
            for (j = i; j < arguments.length; j++) {
              varargs.push($internalize(arguments[j], vt));
            }
            args.push(new (t.params[i])(varargs));
            break;
          }
          args.push($internalize(arguments[i], t.params[i]));
        }
        var result = v.apply(this, args);
        switch (t.results.length) {
        case 0:
          return;
        case 1:
          return $externalize(result, t.results[0]);
        default:
          for (i = 0; i < t.results.length; i++) {
            result[i] = $externalize(result[i], t.results[i]);
          }
          return result;
        }
      };
    }
    return v.$externalizeWrapper;
  case "Interface":
    if (v === $ifaceNil) {
      return null;
    }
    if (t === $packages["github.com/gopherjs/gopherjs/js"].Object || v.constructor.kind === undefined) {
      return v;
    }
    return $externalize(v.$val, v.constructor);
  case "Map":
    var m = {};
    var keys = $keys(v), i;
    for (i = 0; i < keys.length; i++) {
      var entry = v[keys[i]];
      m[$externalize(entry.k, t.key)] = $externalize(entry.v, t.elem);
    }
    return m;
  case "Ptr":
    var o = {}, i;
    for (i = 0; i < t.methods.length; i++) {
      var m = t.methods[i];
      if (m[2] !== "") { /* not exported */
        continue;
      }
      (function(m) {
        o[m[1]] = $externalize(function() {
          return v[m[0]].apply(v, arguments);
        }, m[3]);
      })(m);
    }
    return o;
  case "Slice":
    if ($needsExternalization(t.elem)) {
      return $mapArray($sliceToArray(v), function(e) { return $externalize(e, t.elem); });
    }
    return $sliceToArray(v);
  case "String":
    var s = "", r, i, j = 0;
    for (i = 0; i < v.length; i += r[1], j++) {
      r = $decodeRune(v, i);
      s += String.fromCharCode(r[0]);
    }
    return s;
  case "Struct":
    var timePkg = $packages["time"];
    if (timePkg && v.constructor === timePkg.Time.Ptr) {
      var milli = $div64(v.UnixNano(), new $Int64(0, 1000000));
      return new Date($flatten64(milli));
    }
    var o = {}, i;
    for (i = 0; i < t.fields.length; i++) {
      var f = t.fields[i];
      if (f[2] !== "") { /* not exported */
        continue;
      }
      o[f[1]] = $externalize(v[f[0]], f[3]);
    }
    return o;
  }
  $panic(new $String("cannot externalize " + t.string));
};

var $internalize = function(v, t, recv) {
  switch (t.kind) {
  case "Bool":
    return !!v;
  case "Int":
    return parseInt(v);
  case "Int8":
    return parseInt(v) << 24 >> 24;
  case "Int16":
    return parseInt(v) << 16 >> 16;
  case "Int32":
    return parseInt(v) >> 0;
  case "Uint":
    return parseInt(v);
  case "Uint8":
    return parseInt(v) << 24 >>> 24;
  case "Uint16":
    return parseInt(v) << 16 >>> 16;
  case "Uint32":
  case "Uintptr":
    return parseInt(v) >>> 0;
  case "Int64":
  case "Uint64":
    return new t(0, v);
  case "Float32":
  case "Float64":
    return parseFloat(v);
  case "Array":
    if (v.length !== t.len) {
      $throwRuntimeError("got array with wrong size from JavaScript native");
    }
    return $mapArray(v, function(e) { return $internalize(e, t.elem); });
  case "Func":
    return function() {
      var args = [], i;
      for (i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = arguments[i], j;
          for (j = 0; j < varargs.$length; j++) {
            args.push($externalize(varargs.$array[varargs.$offset + j], vt));
          }
          break;
        }
        args.push($externalize(arguments[i], t.params[i]));
      }
      var result = v.apply(recv, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $internalize(result, t.results[0]);
      default:
        for (i = 0; i < t.results.length; i++) {
          result[i] = $internalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  case "Interface":
    if (t === $packages["github.com/gopherjs/gopherjs/js"].Object) {
      return v;
    }
    if (v === null) {
      return $ifaceNil;
    }
    switch (v.constructor) {
    case Int8Array:
      return new ($sliceType($Int8))(v);
    case Int16Array:
      return new ($sliceType($Int16))(v);
    case Int32Array:
      return new ($sliceType($Int))(v);
    case Uint8Array:
      return new ($sliceType($Uint8))(v);
    case Uint16Array:
      return new ($sliceType($Uint16))(v);
    case Uint32Array:
      return new ($sliceType($Uint))(v);
    case Float32Array:
      return new ($sliceType($Float32))(v);
    case Float64Array:
      return new ($sliceType($Float64))(v);
    case Array:
      return $internalize(v, $sliceType($emptyInterface));
    case Boolean:
      return new $Bool(!!v);
    case Date:
      var timePkg = $packages["time"];
      if (timePkg) {
        return new timePkg.Time(timePkg.Unix(new $Int64(0, 0), new $Int64(0, v.getTime() * 1000000)));
      }
    case Function:
      var funcType = $funcType([$sliceType($emptyInterface)], [$packages["github.com/gopherjs/gopherjs/js"].Object], true);
      return new funcType($internalize(v, funcType));
    case Number:
      return new $Float64(parseFloat(v));
    case String:
      return new $String($internalize(v, $String));
    default:
      if ($global.Node && v instanceof $global.Node) {
        return v;
      }
      var mapType = $mapType($String, $emptyInterface);
      return new mapType($internalize(v, mapType));
    }
  case "Map":
    var m = new $Map();
    var keys = $keys(v), i;
    for (i = 0; i < keys.length; i++) {
      var key = $internalize(keys[i], t.key);
      m[key.$key ? key.$key() : key] = { k: key, v: $internalize(v[keys[i]], t.elem) };
    }
    return m;
  case "Slice":
    return new t($mapArray(v, function(e) { return $internalize(e, t.elem); }));
  case "String":
    v = String(v);
    var s = "", i;
    for (i = 0; i < v.length; i++) {
      s += $encodeRune(v.charCodeAt(i));
    }
    return s;
  default:
    $panic(new $String("cannot internalize " + t.string));
  }
};

$packages["github.com/gopherjs/gopherjs/js"] = (function() {
	var $pkg = {}, Object, Error, init;
	Object = $pkg.Object = $newType(8, "Interface", "js.Object", "Object", "github.com/gopherjs/gopherjs/js", null);
	Error = $pkg.Error = $newType(0, "Struct", "js.Error", "Error", "github.com/gopherjs/gopherjs/js", function(Object_) {
		this.$val = this;
		this.Object = Object_ !== undefined ? Object_ : $ifaceNil;
	});
	Error.Ptr.prototype.Error = function() {
		var err;
		err = this;
		return "JavaScript error: " + $internalize(err.Object.message, $String);
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	init = function() {
		var e;
		e = new Error.Ptr($ifaceNil);
	};
	$pkg.$init = function() {
		Object.init([["Bool", "Bool", "", $funcType([], [$Bool], false)], ["Call", "Call", "", $funcType([$String, ($sliceType($emptyInterface))], [Object], true)], ["Delete", "Delete", "", $funcType([$String], [], false)], ["Float", "Float", "", $funcType([], [$Float64], false)], ["Get", "Get", "", $funcType([$String], [Object], false)], ["Index", "Index", "", $funcType([$Int], [Object], false)], ["Int", "Int", "", $funcType([], [$Int], false)], ["Int64", "Int64", "", $funcType([], [$Int64], false)], ["Interface", "Interface", "", $funcType([], [$emptyInterface], false)], ["Invoke", "Invoke", "", $funcType([($sliceType($emptyInterface))], [Object], true)], ["IsNull", "IsNull", "", $funcType([], [$Bool], false)], ["IsUndefined", "IsUndefined", "", $funcType([], [$Bool], false)], ["Length", "Length", "", $funcType([], [$Int], false)], ["New", "New", "", $funcType([($sliceType($emptyInterface))], [Object], true)], ["Set", "Set", "", $funcType([$String, $emptyInterface], [], false)], ["SetIndex", "SetIndex", "", $funcType([$Int, $emptyInterface], [], false)], ["Str", "Str", "", $funcType([], [$String], false)], ["Uint64", "Uint64", "", $funcType([], [$Uint64], false)], ["Unsafe", "Unsafe", "", $funcType([], [$Uintptr], false)]]);
		Error.methods = [["Bool", "Bool", "", $funcType([], [$Bool], false), 0], ["Call", "Call", "", $funcType([$String, ($sliceType($emptyInterface))], [Object], true), 0], ["Delete", "Delete", "", $funcType([$String], [], false), 0], ["Float", "Float", "", $funcType([], [$Float64], false), 0], ["Get", "Get", "", $funcType([$String], [Object], false), 0], ["Index", "Index", "", $funcType([$Int], [Object], false), 0], ["Int", "Int", "", $funcType([], [$Int], false), 0], ["Int64", "Int64", "", $funcType([], [$Int64], false), 0], ["Interface", "Interface", "", $funcType([], [$emptyInterface], false), 0], ["Invoke", "Invoke", "", $funcType([($sliceType($emptyInterface))], [Object], true), 0], ["IsNull", "IsNull", "", $funcType([], [$Bool], false), 0], ["IsUndefined", "IsUndefined", "", $funcType([], [$Bool], false), 0], ["Length", "Length", "", $funcType([], [$Int], false), 0], ["New", "New", "", $funcType([($sliceType($emptyInterface))], [Object], true), 0], ["Set", "Set", "", $funcType([$String, $emptyInterface], [], false), 0], ["SetIndex", "SetIndex", "", $funcType([$Int, $emptyInterface], [], false), 0], ["Str", "Str", "", $funcType([], [$String], false), 0], ["Uint64", "Uint64", "", $funcType([], [$Uint64], false), 0], ["Unsafe", "Unsafe", "", $funcType([], [$Uintptr], false), 0]];
		($ptrType(Error)).methods = [["Bool", "Bool", "", $funcType([], [$Bool], false), 0], ["Call", "Call", "", $funcType([$String, ($sliceType($emptyInterface))], [Object], true), 0], ["Delete", "Delete", "", $funcType([$String], [], false), 0], ["Error", "Error", "", $funcType([], [$String], false), -1], ["Float", "Float", "", $funcType([], [$Float64], false), 0], ["Get", "Get", "", $funcType([$String], [Object], false), 0], ["Index", "Index", "", $funcType([$Int], [Object], false), 0], ["Int", "Int", "", $funcType([], [$Int], false), 0], ["Int64", "Int64", "", $funcType([], [$Int64], false), 0], ["Interface", "Interface", "", $funcType([], [$emptyInterface], false), 0], ["Invoke", "Invoke", "", $funcType([($sliceType($emptyInterface))], [Object], true), 0], ["IsNull", "IsNull", "", $funcType([], [$Bool], false), 0], ["IsUndefined", "IsUndefined", "", $funcType([], [$Bool], false), 0], ["Length", "Length", "", $funcType([], [$Int], false), 0], ["New", "New", "", $funcType([($sliceType($emptyInterface))], [Object], true), 0], ["Set", "Set", "", $funcType([$String, $emptyInterface], [], false), 0], ["SetIndex", "SetIndex", "", $funcType([$Int, $emptyInterface], [], false), 0], ["Str", "Str", "", $funcType([], [$String], false), 0], ["Uint64", "Uint64", "", $funcType([], [$Uint64], false), 0], ["Unsafe", "Unsafe", "", $funcType([], [$Uintptr], false), 0]];
		Error.init([["Object", "", "", Object, ""]]);
		init();
	};
	return $pkg;
})();
$packages["runtime"] = (function() {
	var $pkg = {}, js = $packages["github.com/gopherjs/gopherjs/js"], NotSupportedError, TypeAssertionError, errorString, MemStats, sizeof_C_MStats, init, init$1;
	NotSupportedError = $pkg.NotSupportedError = $newType(0, "Struct", "runtime.NotSupportedError", "NotSupportedError", "runtime", function(Feature_) {
		this.$val = this;
		this.Feature = Feature_ !== undefined ? Feature_ : "";
	});
	TypeAssertionError = $pkg.TypeAssertionError = $newType(0, "Struct", "runtime.TypeAssertionError", "TypeAssertionError", "runtime", function(interfaceString_, concreteString_, assertedString_, missingMethod_) {
		this.$val = this;
		this.interfaceString = interfaceString_ !== undefined ? interfaceString_ : "";
		this.concreteString = concreteString_ !== undefined ? concreteString_ : "";
		this.assertedString = assertedString_ !== undefined ? assertedString_ : "";
		this.missingMethod = missingMethod_ !== undefined ? missingMethod_ : "";
	});
	errorString = $pkg.errorString = $newType(8, "String", "runtime.errorString", "errorString", "runtime", null);
	MemStats = $pkg.MemStats = $newType(0, "Struct", "runtime.MemStats", "MemStats", "runtime", function(Alloc_, TotalAlloc_, Sys_, Lookups_, Mallocs_, Frees_, HeapAlloc_, HeapSys_, HeapIdle_, HeapInuse_, HeapReleased_, HeapObjects_, StackInuse_, StackSys_, MSpanInuse_, MSpanSys_, MCacheInuse_, MCacheSys_, BuckHashSys_, GCSys_, OtherSys_, NextGC_, LastGC_, PauseTotalNs_, PauseNs_, NumGC_, EnableGC_, DebugGC_, BySize_) {
		this.$val = this;
		this.Alloc = Alloc_ !== undefined ? Alloc_ : new $Uint64(0, 0);
		this.TotalAlloc = TotalAlloc_ !== undefined ? TotalAlloc_ : new $Uint64(0, 0);
		this.Sys = Sys_ !== undefined ? Sys_ : new $Uint64(0, 0);
		this.Lookups = Lookups_ !== undefined ? Lookups_ : new $Uint64(0, 0);
		this.Mallocs = Mallocs_ !== undefined ? Mallocs_ : new $Uint64(0, 0);
		this.Frees = Frees_ !== undefined ? Frees_ : new $Uint64(0, 0);
		this.HeapAlloc = HeapAlloc_ !== undefined ? HeapAlloc_ : new $Uint64(0, 0);
		this.HeapSys = HeapSys_ !== undefined ? HeapSys_ : new $Uint64(0, 0);
		this.HeapIdle = HeapIdle_ !== undefined ? HeapIdle_ : new $Uint64(0, 0);
		this.HeapInuse = HeapInuse_ !== undefined ? HeapInuse_ : new $Uint64(0, 0);
		this.HeapReleased = HeapReleased_ !== undefined ? HeapReleased_ : new $Uint64(0, 0);
		this.HeapObjects = HeapObjects_ !== undefined ? HeapObjects_ : new $Uint64(0, 0);
		this.StackInuse = StackInuse_ !== undefined ? StackInuse_ : new $Uint64(0, 0);
		this.StackSys = StackSys_ !== undefined ? StackSys_ : new $Uint64(0, 0);
		this.MSpanInuse = MSpanInuse_ !== undefined ? MSpanInuse_ : new $Uint64(0, 0);
		this.MSpanSys = MSpanSys_ !== undefined ? MSpanSys_ : new $Uint64(0, 0);
		this.MCacheInuse = MCacheInuse_ !== undefined ? MCacheInuse_ : new $Uint64(0, 0);
		this.MCacheSys = MCacheSys_ !== undefined ? MCacheSys_ : new $Uint64(0, 0);
		this.BuckHashSys = BuckHashSys_ !== undefined ? BuckHashSys_ : new $Uint64(0, 0);
		this.GCSys = GCSys_ !== undefined ? GCSys_ : new $Uint64(0, 0);
		this.OtherSys = OtherSys_ !== undefined ? OtherSys_ : new $Uint64(0, 0);
		this.NextGC = NextGC_ !== undefined ? NextGC_ : new $Uint64(0, 0);
		this.LastGC = LastGC_ !== undefined ? LastGC_ : new $Uint64(0, 0);
		this.PauseTotalNs = PauseTotalNs_ !== undefined ? PauseTotalNs_ : new $Uint64(0, 0);
		this.PauseNs = PauseNs_ !== undefined ? PauseNs_ : ($arrayType($Uint64, 256)).zero();
		this.NumGC = NumGC_ !== undefined ? NumGC_ : 0;
		this.EnableGC = EnableGC_ !== undefined ? EnableGC_ : false;
		this.DebugGC = DebugGC_ !== undefined ? DebugGC_ : false;
		this.BySize = BySize_ !== undefined ? BySize_ : ($arrayType(($structType([["Size", "Size", "", $Uint32, ""], ["Mallocs", "Mallocs", "", $Uint64, ""], ["Frees", "Frees", "", $Uint64, ""]])), 61)).zero();
	});
	NotSupportedError.Ptr.prototype.Error = function() {
		var err;
		err = this;
		return "not supported by GopherJS: " + err.Feature;
	};
	NotSupportedError.prototype.Error = function() { return this.$val.Error(); };
	init = function() {
		var e;
		$throwRuntimeError = (function(msg) {
			$panic(new errorString(msg));
		});
		e = $ifaceNil;
		e = new TypeAssertionError.Ptr("", "", "", "");
		e = new NotSupportedError.Ptr("");
	};
	TypeAssertionError.Ptr.prototype.RuntimeError = function() {
	};
	TypeAssertionError.prototype.RuntimeError = function() { return this.$val.RuntimeError(); };
	TypeAssertionError.Ptr.prototype.Error = function() {
		var e, inter;
		e = this;
		inter = e.interfaceString;
		if (inter === "") {
			inter = "interface";
		}
		if (e.concreteString === "") {
			return "interface conversion: " + inter + " is nil, not " + e.assertedString;
		}
		if (e.missingMethod === "") {
			return "interface conversion: " + inter + " is " + e.concreteString + ", not " + e.assertedString;
		}
		return "interface conversion: " + e.concreteString + " is not " + e.assertedString + ": missing method " + e.missingMethod;
	};
	TypeAssertionError.prototype.Error = function() { return this.$val.Error(); };
	errorString.prototype.RuntimeError = function() {
		var e;
		e = this.$val !== undefined ? this.$val : this;
	};
	$ptrType(errorString).prototype.RuntimeError = function() { return new errorString(this.$get()).RuntimeError(); };
	errorString.prototype.Error = function() {
		var e;
		e = this.$val !== undefined ? this.$val : this;
		return "runtime error: " + e;
	};
	$ptrType(errorString).prototype.Error = function() { return new errorString(this.$get()).Error(); };
	init$1 = function() {
		var memStats;
		memStats = new MemStats.Ptr(); $copy(memStats, new MemStats.Ptr(), MemStats);
		if (!((sizeof_C_MStats === 3712))) {
			console.log(sizeof_C_MStats, 3712);
			$panic(new $String("MStats vs MemStatsType size mismatch"));
		}
	};
	$pkg.$init = function() {
		($ptrType(NotSupportedError)).methods = [["Error", "Error", "", $funcType([], [$String], false), -1]];
		NotSupportedError.init([["Feature", "Feature", "", $String, ""]]);
		($ptrType(TypeAssertionError)).methods = [["Error", "Error", "", $funcType([], [$String], false), -1], ["RuntimeError", "RuntimeError", "", $funcType([], [], false), -1]];
		TypeAssertionError.init([["interfaceString", "interfaceString", "runtime", $String, ""], ["concreteString", "concreteString", "runtime", $String, ""], ["assertedString", "assertedString", "runtime", $String, ""], ["missingMethod", "missingMethod", "runtime", $String, ""]]);
		errorString.methods = [["Error", "Error", "", $funcType([], [$String], false), -1], ["RuntimeError", "RuntimeError", "", $funcType([], [], false), -1]];
		($ptrType(errorString)).methods = [["Error", "Error", "", $funcType([], [$String], false), -1], ["RuntimeError", "RuntimeError", "", $funcType([], [], false), -1]];
		MemStats.init([["Alloc", "Alloc", "", $Uint64, ""], ["TotalAlloc", "TotalAlloc", "", $Uint64, ""], ["Sys", "Sys", "", $Uint64, ""], ["Lookups", "Lookups", "", $Uint64, ""], ["Mallocs", "Mallocs", "", $Uint64, ""], ["Frees", "Frees", "", $Uint64, ""], ["HeapAlloc", "HeapAlloc", "", $Uint64, ""], ["HeapSys", "HeapSys", "", $Uint64, ""], ["HeapIdle", "HeapIdle", "", $Uint64, ""], ["HeapInuse", "HeapInuse", "", $Uint64, ""], ["HeapReleased", "HeapReleased", "", $Uint64, ""], ["HeapObjects", "HeapObjects", "", $Uint64, ""], ["StackInuse", "StackInuse", "", $Uint64, ""], ["StackSys", "StackSys", "", $Uint64, ""], ["MSpanInuse", "MSpanInuse", "", $Uint64, ""], ["MSpanSys", "MSpanSys", "", $Uint64, ""], ["MCacheInuse", "MCacheInuse", "", $Uint64, ""], ["MCacheSys", "MCacheSys", "", $Uint64, ""], ["BuckHashSys", "BuckHashSys", "", $Uint64, ""], ["GCSys", "GCSys", "", $Uint64, ""], ["OtherSys", "OtherSys", "", $Uint64, ""], ["NextGC", "NextGC", "", $Uint64, ""], ["LastGC", "LastGC", "", $Uint64, ""], ["PauseTotalNs", "PauseTotalNs", "", $Uint64, ""], ["PauseNs", "PauseNs", "", ($arrayType($Uint64, 256)), ""], ["NumGC", "NumGC", "", $Uint32, ""], ["EnableGC", "EnableGC", "", $Bool, ""], ["DebugGC", "DebugGC", "", $Bool, ""], ["BySize", "BySize", "", ($arrayType(($structType([["Size", "Size", "", $Uint32, ""], ["Mallocs", "Mallocs", "", $Uint64, ""], ["Frees", "Frees", "", $Uint64, ""]])), 61)), ""]]);
		sizeof_C_MStats = 3712;
		init();
		init$1();
	};
	return $pkg;
})();
$packages["errors"] = (function() {
	var $pkg = {}, errorString, New;
	errorString = $pkg.errorString = $newType(0, "Struct", "errors.errorString", "errorString", "errors", function(s_) {
		this.$val = this;
		this.s = s_ !== undefined ? s_ : "";
	});
	New = $pkg.New = function(text) {
		return new errorString.Ptr(text);
	};
	errorString.Ptr.prototype.Error = function() {
		var e;
		e = this;
		return e.s;
	};
	errorString.prototype.Error = function() { return this.$val.Error(); };
	$pkg.$init = function() {
		($ptrType(errorString)).methods = [["Error", "Error", "", $funcType([], [$String], false), -1]];
		errorString.init([["s", "s", "errors", $String, ""]]);
	};
	return $pkg;
})();
$packages["github.com/tchap/go-patricia/patricia"] = (function() {
	var $pkg = {}, errors = $packages["errors"], childList, sparseChildList, denseChildList, Prefix, Item, VisitorFunc, Trie, newSparseChildList, newDenseChildList, NewTrie;
	childList = $pkg.childList = $newType(8, "Interface", "patricia.childList", "childList", "github.com/tchap/go-patricia/patricia", null);
	sparseChildList = $pkg.sparseChildList = $newType(0, "Struct", "patricia.sparseChildList", "sparseChildList", "github.com/tchap/go-patricia/patricia", function(children_) {
		this.$val = this;
		this.children = children_ !== undefined ? children_ : ($sliceType(($ptrType(Trie)))).nil;
	});
	denseChildList = $pkg.denseChildList = $newType(0, "Struct", "patricia.denseChildList", "denseChildList", "github.com/tchap/go-patricia/patricia", function(min_, max_, children_) {
		this.$val = this;
		this.min = min_ !== undefined ? min_ : 0;
		this.max = max_ !== undefined ? max_ : 0;
		this.children = children_ !== undefined ? children_ : ($sliceType(($ptrType(Trie)))).nil;
	});
	Prefix = $pkg.Prefix = $newType(12, "Slice", "patricia.Prefix", "Prefix", "github.com/tchap/go-patricia/patricia", null);
	Item = $pkg.Item = $newType(8, "Interface", "patricia.Item", "Item", "github.com/tchap/go-patricia/patricia", null);
	VisitorFunc = $pkg.VisitorFunc = $newType(4, "Func", "patricia.VisitorFunc", "VisitorFunc", "github.com/tchap/go-patricia/patricia", null);
	Trie = $pkg.Trie = $newType(0, "Struct", "patricia.Trie", "Trie", "github.com/tchap/go-patricia/patricia", function(prefix_, item_, children_) {
		this.$val = this;
		this.prefix = prefix_ !== undefined ? prefix_ : Prefix.nil;
		this.item = item_ !== undefined ? item_ : $ifaceNil;
		this.children = children_ !== undefined ? children_ : $ifaceNil;
	});
	newSparseChildList = function() {
		return new sparseChildList.Ptr(($sliceType(($ptrType(Trie)))).make(0, 8));
	};
	sparseChildList.Ptr.prototype.length = function() {
		var list;
		list = this;
		return list.children.$length;
	};
	sparseChildList.prototype.length = function() { return this.$val.length(); };
	sparseChildList.Ptr.prototype.head = function() {
		var list, x;
		list = this;
		return (x = list.children, ((0 < 0 || 0 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
	};
	sparseChildList.prototype.head = function() { return this.$val.head(); };
	sparseChildList.Ptr.prototype.add = function(child) {
		var list;
		list = this;
		if (!((list.children.$length === list.children.$capacity))) {
			list.children = $append(list.children, child);
			return list;
		}
		return newDenseChildList(list, child);
	};
	sparseChildList.prototype.add = function(child) { return this.$val.add(child); };
	sparseChildList.Ptr.prototype.replace = function(b, child) {
		var list, _ref, _i, i, node, x, x$1;
		list = this;
		_ref = list.children;
		_i = 0;
		while (_i < _ref.$length) {
			i = _i;
			node = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if ((x = node.prefix, ((0 < 0 || 0 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])) === b) {
				(x$1 = list.children, (i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i] = child);
				return;
			}
			_i++;
		}
	};
	sparseChildList.prototype.replace = function(b, child) { return this.$val.replace(b, child); };
	sparseChildList.Ptr.prototype.remove = function(child) {
		var list, _ref, _i, i, node, x, x$1;
		list = this;
		_ref = list.children;
		_i = 0;
		while (_i < _ref.$length) {
			i = _i;
			node = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if ((x = node.prefix, ((0 < 0 || 0 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])) === (x$1 = child.prefix, ((0 < 0 || 0 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 0]))) {
				list.children = $appendSlice($subslice(list.children, 0, i), $subslice(list.children, (i + 1 >> 0)));
				return;
			}
			_i++;
		}
		$panic(new $String("removing non-existent child"));
	};
	sparseChildList.prototype.remove = function(child) { return this.$val.remove(child); };
	sparseChildList.Ptr.prototype.next = function(b) {
		var list, _ref, _i, child, x;
		list = this;
		_ref = list.children;
		_i = 0;
		while (_i < _ref.$length) {
			child = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if ((x = child.prefix, ((0 < 0 || 0 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])) === b) {
				return child;
			}
			_i++;
		}
		return ($ptrType(Trie)).nil;
	};
	sparseChildList.prototype.next = function(b) { return this.$val.next(b); };
	sparseChildList.Ptr.prototype.walk = function(prefix, visitor) {
		var list, _ref, _i, child, err, err$1;
		list = this;
		_ref = list.children;
		_i = 0;
		while (_i < _ref.$length) {
			child = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			prefix.$set($appendSlice(prefix.$get(), child.prefix));
			if (!($interfaceIsEqual(child.item, $ifaceNil))) {
				err = visitor(prefix.$get(), child.item);
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					if ($interfaceIsEqual(err, $pkg.SkipSubtree)) {
						prefix.$set($subslice((prefix.$get()), 0, (prefix.$get().$length - child.prefix.$length >> 0)));
						_i++;
						continue;
					}
					prefix.$set($subslice((prefix.$get()), 0, (prefix.$get().$length - child.prefix.$length >> 0)));
					return err;
				}
			}
			err$1 = child.children.walk(prefix, visitor);
			prefix.$set($subslice((prefix.$get()), 0, (prefix.$get().$length - child.prefix.$length >> 0)));
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				return err$1;
			}
			_i++;
		}
		return $ifaceNil;
	};
	sparseChildList.prototype.walk = function(prefix, visitor) { return this.$val.walk(prefix, visitor); };
	newDenseChildList = function(list, child) {
		var min, max, _ref, _i, child$1, x, b, x$1, b$1, children, _ref$1, _i$1, child$2, x$2, x$3, x$4, x$5;
		min = 255;
		max = 0;
		_ref = list.children;
		_i = 0;
		while (_i < _ref.$length) {
			child$1 = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			b = ((x = child$1.prefix, ((0 < 0 || 0 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])) >> 0);
			if (b < min) {
				min = b;
			}
			if (b > max) {
				max = b;
			}
			_i++;
		}
		b$1 = ((x$1 = child.prefix, ((0 < 0 || 0 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 0])) >> 0);
		if (b$1 < min) {
			min = b$1;
		}
		if (b$1 > max) {
			max = b$1;
		}
		children = ($sliceType(($ptrType(Trie)))).make(((max - min >> 0) + 1 >> 0));
		_ref$1 = list.children;
		_i$1 = 0;
		while (_i$1 < _ref$1.$length) {
			child$2 = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
			(x$2 = ((x$3 = child$2.prefix, ((0 < 0 || 0 >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0])) >> 0) - min >> 0, (x$2 < 0 || x$2 >= children.$length) ? $throwRuntimeError("index out of range") : children.$array[children.$offset + x$2] = child$2);
			_i$1++;
		}
		(x$4 = ((x$5 = child.prefix, ((0 < 0 || 0 >= x$5.$length) ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + 0])) >> 0) - min >> 0, (x$4 < 0 || x$4 >= children.$length) ? $throwRuntimeError("index out of range") : children.$array[children.$offset + x$4] = child);
		return new denseChildList.Ptr(min, max, children);
	};
	denseChildList.Ptr.prototype.length = function() {
		var list;
		list = this;
		return (list.max - list.min >> 0) + 1 >> 0;
	};
	denseChildList.prototype.length = function() { return this.$val.length(); };
	denseChildList.Ptr.prototype.head = function() {
		var list, x;
		list = this;
		return (x = list.children, ((0 < 0 || 0 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
	};
	denseChildList.prototype.head = function() { return this.$val.head(); };
	denseChildList.Ptr.prototype.add = function(child) {
		var list, x, b, x$1, x$2, x$3, x$4, children, children$1, x$5;
		list = this;
		b = ((x = child.prefix, ((0 < 0 || 0 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])) >> 0);
		if (list.min <= b && b <= list.max) {
			if (!((x$1 = list.children, x$2 = b - list.min >> 0, ((x$2 < 0 || x$2 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + x$2])) === ($ptrType(Trie)).nil)) {
				$panic(new $String("dense child list collision detected"));
			}
			(x$3 = list.children, x$4 = b - list.min >> 0, (x$4 < 0 || x$4 >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + x$4] = child);
		} else if (b < list.min) {
			children = ($sliceType(($ptrType(Trie)))).make(((list.max - b >> 0) + 1 >> 0));
			(0 < 0 || 0 >= children.$length) ? $throwRuntimeError("index out of range") : children.$array[children.$offset + 0] = child;
			$copySlice($subslice(children, (list.min - b >> 0)), list.children);
			list.children = children;
			list.min = b;
		} else {
			children$1 = ($sliceType(($ptrType(Trie)))).make(((b - list.min >> 0) + 1 >> 0));
			(x$5 = b - list.min >> 0, (x$5 < 0 || x$5 >= children$1.$length) ? $throwRuntimeError("index out of range") : children$1.$array[children$1.$offset + x$5] = child);
			$copySlice(children$1, list.children);
			list.children = children$1;
			list.max = b;
		}
		return list;
	};
	denseChildList.prototype.add = function(child) { return this.$val.add(child); };
	denseChildList.Ptr.prototype.replace = function(b, child) {
		var list, x, x$1, x$2, x$3, x$4;
		list = this;
		(x = list.children, x$1 = (b >> 0) - list.min >> 0, (x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1] = ($ptrType(Trie)).nil);
		(x$2 = list.children, x$3 = ((x$4 = child.prefix, ((0 < 0 || 0 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + 0])) >> 0) - list.min >> 0, (x$3 < 0 || x$3 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + x$3] = child);
	};
	denseChildList.prototype.replace = function(b, child) { return this.$val.replace(b, child); };
	denseChildList.Ptr.prototype.remove = function(child) {
		var list, x, i, x$1, x$2;
		list = this;
		i = ((x = child.prefix, ((0 < 0 || 0 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])) >> 0) - list.min >> 0;
		if ((x$1 = list.children, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i])) === ($ptrType(Trie)).nil) {
			$panic(new $String("removing non-existent child"));
		}
		(x$2 = list.children, (i < 0 || i >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + i] = ($ptrType(Trie)).nil);
	};
	denseChildList.prototype.remove = function(child) { return this.$val.remove(child); };
	denseChildList.Ptr.prototype.next = function(b) {
		var list, i, x, x$1;
		list = this;
		i = (b >> 0);
		if (i < list.min || list.max < i) {
			return ($ptrType(Trie)).nil;
		}
		return (x = list.children, x$1 = i - list.min >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
	};
	denseChildList.prototype.next = function(b) { return this.$val.next(b); };
	denseChildList.Ptr.prototype.walk = function(prefix, visitor) {
		var list, _ref, _i, child, err, err$1;
		list = this;
		_ref = list.children;
		_i = 0;
		while (_i < _ref.$length) {
			child = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (child === ($ptrType(Trie)).nil) {
				_i++;
				continue;
			}
			prefix.$set($appendSlice(prefix.$get(), child.prefix));
			if (!($interfaceIsEqual(child.item, $ifaceNil))) {
				err = visitor(prefix.$get(), child.item);
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					if ($interfaceIsEqual(err, $pkg.SkipSubtree)) {
						prefix.$set($subslice((prefix.$get()), 0, (prefix.$get().$length - child.prefix.$length >> 0)));
						_i++;
						continue;
					}
					prefix.$set($subslice((prefix.$get()), 0, (prefix.$get().$length - child.prefix.$length >> 0)));
					return err;
				}
			}
			err$1 = child.children.walk(prefix, visitor);
			prefix.$set($subslice((prefix.$get()), 0, (prefix.$get().$length - child.prefix.$length >> 0)));
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				return err$1;
			}
			_i++;
		}
		return $ifaceNil;
	};
	denseChildList.prototype.walk = function(prefix, visitor) { return this.$val.walk(prefix, visitor); };
	NewTrie = $pkg.NewTrie = function() {
		return new Trie.Ptr(Prefix.nil, $ifaceNil, newSparseChildList());
	};
	Trie.Ptr.prototype.Item = function() {
		var trie;
		trie = this;
		return trie.item;
	};
	Trie.prototype.Item = function() { return this.$val.Item(); };
	Trie.Ptr.prototype.Insert = function(key, item) {
		var inserted = false, trie;
		trie = this;
		inserted = trie.put(key, item, false);
		return inserted;
	};
	Trie.prototype.Insert = function(key, item) { return this.$val.Insert(key, item); };
	Trie.Ptr.prototype.Set = function(key, item) {
		var trie;
		trie = this;
		trie.put(key, item, true);
	};
	Trie.prototype.Set = function(key, item) { return this.$val.Set(key, item); };
	Trie.Ptr.prototype.Get = function(key) {
		var item = $ifaceNil, trie, _tuple, node, found, leftover;
		trie = this;
		_tuple = trie.findSubtree(key); node = _tuple[1]; found = _tuple[2]; leftover = _tuple[3];
		if (!found || !((leftover.$length === 0))) {
			item = $ifaceNil;
			return item;
		}
		item = node.item;
		return item;
	};
	Trie.prototype.Get = function(key) { return this.$val.Get(key); };
	Trie.Ptr.prototype.Match = function(prefix) {
		var matchedExactly = false, trie;
		trie = this;
		matchedExactly = !($interfaceIsEqual(trie.Get(prefix), $ifaceNil));
		return matchedExactly;
	};
	Trie.prototype.Match = function(prefix) { return this.$val.Match(prefix); };
	Trie.Ptr.prototype.MatchSubtree = function(key) {
		var matched = false, trie, _tuple;
		trie = this;
		_tuple = trie.findSubtree(key); matched = _tuple[2];
		return matched;
	};
	Trie.prototype.MatchSubtree = function(key) { return this.$val.MatchSubtree(key); };
	Trie.Ptr.prototype.Visit = function(visitor) {
		var trie;
		trie = this;
		return trie.walk(Prefix.nil, visitor);
	};
	Trie.prototype.Visit = function(visitor) { return this.$val.Visit(visitor); };
	Trie.Ptr.prototype.VisitSubtree = function(prefix, visitor) {
		var trie, _tuple, root, found, leftover;
		trie = this;
		if (prefix === Prefix.nil) {
			$panic($pkg.ErrNilPrefix);
		}
		if (trie.prefix === Prefix.nil) {
			return $ifaceNil;
		}
		_tuple = trie.findSubtree(prefix); root = _tuple[1]; found = _tuple[2]; leftover = _tuple[3];
		if (!found) {
			return $ifaceNil;
		}
		prefix = $appendSlice(prefix, leftover);
		return root.walk(prefix, visitor);
	};
	Trie.prototype.VisitSubtree = function(prefix, visitor) { return this.$val.VisitSubtree(prefix, visitor); };
	Trie.Ptr.prototype.VisitPrefixes = function(key, visitor) {
		var trie, node, prefix, offset, common, item, err, child;
		trie = this;
		if (key === Prefix.nil) {
			$panic($pkg.ErrNilPrefix);
		}
		if (trie.prefix === Prefix.nil) {
			return $ifaceNil;
		}
		node = trie;
		prefix = key;
		offset = 0;
		while (true) {
			common = node.longestCommonPrefixLength(key);
			key = $subslice(key, common);
			offset = offset + (common) >> 0;
			if (common < node.prefix.$length) {
				return $ifaceNil;
			}
			item = node.item;
			if (!($interfaceIsEqual(item, $ifaceNil))) {
				err = visitor($subslice(prefix, 0, offset), item);
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					return err;
				}
			}
			if (key.$length === 0) {
				return $ifaceNil;
			}
			child = node.children.next(((0 < 0 || 0 >= key.$length) ? $throwRuntimeError("index out of range") : key.$array[key.$offset + 0]));
			if (child === ($ptrType(Trie)).nil) {
				return $ifaceNil;
			}
			node = child;
		}
	};
	Trie.prototype.VisitPrefixes = function(key, visitor) { return this.$val.VisitPrefixes(key, visitor); };
	Trie.Ptr.prototype.Delete = function(key) {
		var deleted = false, trie, _tuple, parent, node, leftover, compacted, x;
		trie = this;
		if (key === Prefix.nil) {
			$panic($pkg.ErrNilPrefix);
		}
		if (trie.prefix === Prefix.nil) {
			deleted = false;
			return deleted;
		}
		_tuple = trie.findSubtree(key); parent = _tuple[0]; node = _tuple[1]; leftover = _tuple[3];
		if (!((leftover.$length === 0))) {
			deleted = false;
			return deleted;
		}
		if ($interfaceIsEqual(node.item, $ifaceNil)) {
			deleted = false;
			return deleted;
		}
		node.item = $ifaceNil;
		compacted = node.compact();
		if (!(compacted === node)) {
			if (parent === ($ptrType(Trie)).nil) {
				$copy(node, compacted, Trie);
			} else {
				parent.children.replace((x = node.prefix, ((0 < 0 || 0 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0])), compacted);
				$copy(parent, parent.compact(), Trie);
			}
		}
		deleted = true;
		return deleted;
	};
	Trie.prototype.Delete = function(key) { return this.$val.Delete(key); };
	Trie.Ptr.prototype.DeleteSubtree = function(prefix) {
		var deleted = false, trie, _tuple, parent, root, found;
		trie = this;
		if (prefix === Prefix.nil) {
			$panic($pkg.ErrNilPrefix);
		}
		if (trie.prefix === Prefix.nil) {
			deleted = false;
			return deleted;
		}
		_tuple = trie.findSubtree(prefix); parent = _tuple[0]; root = _tuple[1]; found = _tuple[2];
		if (!found) {
			deleted = false;
			return deleted;
		}
		if (parent === ($ptrType(Trie)).nil) {
			root.prefix = Prefix.nil;
			root.children = newSparseChildList();
			deleted = true;
			return deleted;
		}
		parent.children.remove(root);
		deleted = true;
		return deleted;
	};
	Trie.prototype.DeleteSubtree = function(prefix) { return this.$val.DeleteSubtree(prefix); };
	Trie.Ptr.prototype.put = function(key, item, replace) {
		var $this = this, $args = arguments, inserted = false, $s = 0, trie, common, node, child, child$1;
		/* */ while (true) { switch ($s) { case 0:
		trie = $this;
		if (key === Prefix.nil) {
			$panic($pkg.ErrNilPrefix);
		}
		common = 0;
		node = trie;
		child = ($ptrType(Trie)).nil;
		/* if (node.prefix === Prefix.nil) { */ if (node.prefix === Prefix.nil) {} else { $s = 4; continue; }
			/* if (key.$length <= $pkg.MaxPrefixPerNode) { */ if (key.$length <= $pkg.MaxPrefixPerNode) {} else { $s = 5; continue; }
				node.prefix = key;
				/* goto InsertItem */ $s = 1; continue;
			/* } */ case 5:
			node.prefix = $subslice(key, 0, $pkg.MaxPrefixPerNode);
			key = $subslice(key, $pkg.MaxPrefixPerNode);
			/* goto AppendChild */ $s = 2; continue;
		/* } */ case 4:
		/* while (true) { */ case 6: if(!(true)) { $s = 7; continue; }
			common = node.longestCommonPrefixLength(key);
			key = $subslice(key, common);
			/* if (common < node.prefix.$length) { */ if (common < node.prefix.$length) {} else { $s = 8; continue; }
				/* goto SplitPrefix */ $s = 3; continue;
			/* } */ case 8:
			/* if (key.$length === 0) { */ if (key.$length === 0) {} else { $s = 9; continue; }
				/* goto InsertItem */ $s = 1; continue;
			/* } */ case 9:
			child = node.children.next(((0 < 0 || 0 >= key.$length) ? $throwRuntimeError("index out of range") : key.$array[key.$offset + 0]));
			/* if (child === ($ptrType(Trie)).nil) { */ if (child === ($ptrType(Trie)).nil) {} else { $s = 10; continue; }
				/* goto AppendChild */ $s = 2; continue;
			/* } */ case 10:
			node = child;
		/* } */ $s = 6; continue; case 7:
		/* SplitPrefix: */ case 3:
		child = new Trie.Ptr();
		$copy(child, node, Trie);
		$copy(node, NewTrie(), Trie);
		node.prefix = $subslice(child.prefix, 0, common);
		child.prefix = $subslice(child.prefix, common);
		child = child.compact();
		node.children = node.children.add(child);
		/* AppendChild: */ case 2:
		/* while (!((key.$length === 0))) { */ case 11: if(!(!((key.$length === 0)))) { $s = 12; continue; }
			child$1 = NewTrie();
			/* if (key.$length <= $pkg.MaxPrefixPerNode) { */ if (key.$length <= $pkg.MaxPrefixPerNode) {} else { $s = 13; continue; }
				child$1.prefix = key;
				node.children = node.children.add(child$1);
				node = child$1;
				/* goto InsertItem */ $s = 1; continue;
			/* } else { */ $s = 14; continue; case 13: 
				child$1.prefix = $subslice(key, 0, $pkg.MaxPrefixPerNode);
				key = $subslice(key, $pkg.MaxPrefixPerNode);
				node.children = node.children.add(child$1);
				node = child$1;
			/* } */ case 14:
		/* } */ $s = 11; continue; case 12:
		/* InsertItem: */ case 1:
		if (replace || $interfaceIsEqual(node.item, $ifaceNil)) {
			node.item = item;
			inserted = true;
			return inserted;
		}
		inserted = false;
		return inserted;
		/* */ case -1: } return; }
	};
	Trie.prototype.put = function(key, item, replace) { return this.$val.put(key, item, replace); };
	Trie.Ptr.prototype.compact = function() {
		var trie, child;
		trie = this;
		if (!((trie.children.length() === 1))) {
			return trie;
		}
		child = trie.children.head();
		if (!($interfaceIsEqual(trie.item, $ifaceNil)) || !($interfaceIsEqual(child.item, $ifaceNil))) {
			return trie;
		}
		if ((trie.prefix.$length + child.prefix.$length >> 0) > $pkg.MaxPrefixPerNode) {
			return trie;
		}
		child.prefix = $appendSlice(trie.prefix, child.prefix);
		if (!($interfaceIsEqual(trie.item, $ifaceNil))) {
			child.item = trie.item;
		}
		return child;
	};
	Trie.prototype.compact = function() { return this.$val.compact(); };
	Trie.Ptr.prototype.findSubtree = function(prefix) {
		var parent = ($ptrType(Trie)).nil, root = ($ptrType(Trie)).nil, found = false, leftover = Prefix.nil, trie, common, child;
		trie = this;
		root = trie;
		while (true) {
			common = root.longestCommonPrefixLength(prefix);
			prefix = $subslice(prefix, common);
			if (prefix.$length === 0) {
				found = true;
				leftover = $subslice(root.prefix, common);
				return [parent, root, found, leftover];
			}
			if (common < root.prefix.$length) {
				leftover = $subslice(root.prefix, common);
				return [parent, root, found, leftover];
			}
			child = root.children.next(((0 < 0 || 0 >= prefix.$length) ? $throwRuntimeError("index out of range") : prefix.$array[prefix.$offset + 0]));
			if (child === ($ptrType(Trie)).nil) {
				return [parent, root, found, leftover];
			}
			parent = root;
			root = child;
		}
	};
	Trie.prototype.findSubtree = function(prefix) { return this.$val.findSubtree(prefix); };
	Trie.Ptr.prototype.walk = function(actualRootPrefix, visitor) {
		var trie, prefix, err;
		trie = this;
		prefix = Prefix.nil;
		if (actualRootPrefix === Prefix.nil) {
			prefix = Prefix.make((32 + trie.prefix.$length >> 0));
			$copySlice(prefix, trie.prefix);
			prefix = $subslice(prefix, 0, trie.prefix.$length);
		} else {
			prefix = Prefix.make((32 + actualRootPrefix.$length >> 0));
			$copySlice(prefix, actualRootPrefix);
			prefix = $subslice(prefix, 0, actualRootPrefix.$length);
		}
		if (!($interfaceIsEqual(trie.item, $ifaceNil))) {
			err = visitor(prefix, trie.item);
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				if ($interfaceIsEqual(err, $pkg.SkipSubtree)) {
					return $ifaceNil;
				}
				return err;
			}
		}
		return trie.children.walk(new ($ptrType(Prefix))(function() { return prefix; }, function($v) { prefix = $v; }), visitor);
	};
	Trie.prototype.walk = function(actualRootPrefix, visitor) { return this.$val.walk(actualRootPrefix, visitor); };
	Trie.Ptr.prototype.longestCommonPrefixLength = function(prefix) {
		var i = 0, trie, x;
		trie = this;
		while (i < prefix.$length && i < trie.prefix.$length && (((i < 0 || i >= prefix.$length) ? $throwRuntimeError("index out of range") : prefix.$array[prefix.$offset + i]) === (x = trie.prefix, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])))) {
			i = i + (1) >> 0;
		}
		return i;
	};
	Trie.prototype.longestCommonPrefixLength = function(prefix) { return this.$val.longestCommonPrefixLength(prefix); };
	$pkg.$init = function() {
		childList.init([["add", "add", "github.com/tchap/go-patricia/patricia", $funcType([($ptrType(Trie))], [childList], false)], ["head", "head", "github.com/tchap/go-patricia/patricia", $funcType([], [($ptrType(Trie))], false)], ["length", "length", "github.com/tchap/go-patricia/patricia", $funcType([], [$Int], false)], ["next", "next", "github.com/tchap/go-patricia/patricia", $funcType([$Uint8], [($ptrType(Trie))], false)], ["remove", "remove", "github.com/tchap/go-patricia/patricia", $funcType([($ptrType(Trie))], [], false)], ["replace", "replace", "github.com/tchap/go-patricia/patricia", $funcType([$Uint8, ($ptrType(Trie))], [], false)], ["walk", "walk", "github.com/tchap/go-patricia/patricia", $funcType([($ptrType(Prefix)), VisitorFunc], [$error], false)]]);
		($ptrType(sparseChildList)).methods = [["add", "add", "github.com/tchap/go-patricia/patricia", $funcType([($ptrType(Trie))], [childList], false), -1], ["head", "head", "github.com/tchap/go-patricia/patricia", $funcType([], [($ptrType(Trie))], false), -1], ["length", "length", "github.com/tchap/go-patricia/patricia", $funcType([], [$Int], false), -1], ["next", "next", "github.com/tchap/go-patricia/patricia", $funcType([$Uint8], [($ptrType(Trie))], false), -1], ["remove", "remove", "github.com/tchap/go-patricia/patricia", $funcType([($ptrType(Trie))], [], false), -1], ["replace", "replace", "github.com/tchap/go-patricia/patricia", $funcType([$Uint8, ($ptrType(Trie))], [], false), -1], ["walk", "walk", "github.com/tchap/go-patricia/patricia", $funcType([($ptrType(Prefix)), VisitorFunc], [$error], false), -1]];
		sparseChildList.init([["children", "children", "github.com/tchap/go-patricia/patricia", ($sliceType(($ptrType(Trie)))), ""]]);
		($ptrType(denseChildList)).methods = [["add", "add", "github.com/tchap/go-patricia/patricia", $funcType([($ptrType(Trie))], [childList], false), -1], ["head", "head", "github.com/tchap/go-patricia/patricia", $funcType([], [($ptrType(Trie))], false), -1], ["length", "length", "github.com/tchap/go-patricia/patricia", $funcType([], [$Int], false), -1], ["next", "next", "github.com/tchap/go-patricia/patricia", $funcType([$Uint8], [($ptrType(Trie))], false), -1], ["remove", "remove", "github.com/tchap/go-patricia/patricia", $funcType([($ptrType(Trie))], [], false), -1], ["replace", "replace", "github.com/tchap/go-patricia/patricia", $funcType([$Uint8, ($ptrType(Trie))], [], false), -1], ["walk", "walk", "github.com/tchap/go-patricia/patricia", $funcType([($ptrType(Prefix)), VisitorFunc], [$error], false), -1]];
		denseChildList.init([["min", "min", "github.com/tchap/go-patricia/patricia", $Int, ""], ["max", "max", "github.com/tchap/go-patricia/patricia", $Int, ""], ["children", "children", "github.com/tchap/go-patricia/patricia", ($sliceType(($ptrType(Trie)))), ""]]);
		Prefix.init($Uint8);
		Item.init([]);
		VisitorFunc.init([Prefix, Item], [$error], false);
		($ptrType(Trie)).methods = [["Delete", "Delete", "", $funcType([Prefix], [$Bool], false), -1], ["DeleteSubtree", "DeleteSubtree", "", $funcType([Prefix], [$Bool], false), -1], ["Get", "Get", "", $funcType([Prefix], [Item], false), -1], ["Insert", "Insert", "", $funcType([Prefix, Item], [$Bool], false), -1], ["Item", "Item", "", $funcType([], [Item], false), -1], ["Match", "Match", "", $funcType([Prefix], [$Bool], false), -1], ["MatchSubtree", "MatchSubtree", "", $funcType([Prefix], [$Bool], false), -1], ["Set", "Set", "", $funcType([Prefix, Item], [], false), -1], ["Visit", "Visit", "", $funcType([VisitorFunc], [$error], false), -1], ["VisitPrefixes", "VisitPrefixes", "", $funcType([Prefix, VisitorFunc], [$error], false), -1], ["VisitSubtree", "VisitSubtree", "", $funcType([Prefix, VisitorFunc], [$error], false), -1], ["compact", "compact", "github.com/tchap/go-patricia/patricia", $funcType([], [($ptrType(Trie))], false), -1], ["findSubtree", "findSubtree", "github.com/tchap/go-patricia/patricia", $funcType([Prefix], [($ptrType(Trie)), ($ptrType(Trie)), $Bool, Prefix], false), -1], ["longestCommonPrefixLength", "longestCommonPrefixLength", "github.com/tchap/go-patricia/patricia", $funcType([Prefix], [$Int], false), -1], ["put", "put", "github.com/tchap/go-patricia/patricia", $funcType([Prefix, Item, $Bool], [$Bool], false), -1], ["walk", "walk", "github.com/tchap/go-patricia/patricia", $funcType([Prefix, VisitorFunc], [$error], false), -1]];
		Trie.init([["prefix", "prefix", "github.com/tchap/go-patricia/patricia", Prefix, ""], ["item", "item", "github.com/tchap/go-patricia/patricia", Item, ""], ["children", "children", "github.com/tchap/go-patricia/patricia", childList, ""]]);
		$pkg.MaxPrefixPerNode = 10;
		$pkg.SkipSubtree = errors.New("Skip this subtree");
		$pkg.ErrNilPrefix = errors.New("Nil prefix passed into a method call");
	};
	return $pkg;
})();
$packages["sync/atomic"] = (function() {
	var $pkg = {}, CompareAndSwapInt32, AddInt32;
	CompareAndSwapInt32 = $pkg.CompareAndSwapInt32 = function(addr, old, new$1) {
		if (addr.$get() === old) {
			addr.$set(new$1);
			return true;
		}
		return false;
	};
	AddInt32 = $pkg.AddInt32 = function(addr, delta) {
		var new$1;
		new$1 = addr.$get() + delta >> 0;
		addr.$set(new$1);
		return new$1;
	};
	$pkg.$init = function() {
	};
	return $pkg;
})();
$packages["sync"] = (function() {
	var $pkg = {}, atomic = $packages["sync/atomic"], runtime = $packages["runtime"], Pool, Mutex, poolLocal, syncSema, allPools, runtime_registerPoolCleanup, runtime_Syncsemcheck, poolCleanup, init, indexLocal, runtime_Semacquire, runtime_Semrelease, init$1;
	Pool = $pkg.Pool = $newType(0, "Struct", "sync.Pool", "Pool", "sync", function(local_, localSize_, store_, New_) {
		this.$val = this;
		this.local = local_ !== undefined ? local_ : 0;
		this.localSize = localSize_ !== undefined ? localSize_ : 0;
		this.store = store_ !== undefined ? store_ : ($sliceType($emptyInterface)).nil;
		this.New = New_ !== undefined ? New_ : $throwNilPointerError;
	});
	Mutex = $pkg.Mutex = $newType(0, "Struct", "sync.Mutex", "Mutex", "sync", function(state_, sema_) {
		this.$val = this;
		this.state = state_ !== undefined ? state_ : 0;
		this.sema = sema_ !== undefined ? sema_ : 0;
	});
	poolLocal = $pkg.poolLocal = $newType(0, "Struct", "sync.poolLocal", "poolLocal", "sync", function(private$0_, shared_, Mutex_, pad_) {
		this.$val = this;
		this.private$0 = private$0_ !== undefined ? private$0_ : $ifaceNil;
		this.shared = shared_ !== undefined ? shared_ : ($sliceType($emptyInterface)).nil;
		this.Mutex = Mutex_ !== undefined ? Mutex_ : new Mutex.Ptr();
		this.pad = pad_ !== undefined ? pad_ : ($arrayType($Uint8, 128)).zero();
	});
	syncSema = $pkg.syncSema = $newType(12, "Array", "sync.syncSema", "syncSema", "sync", null);
	Pool.Ptr.prototype.Get = function() {
		var p, x, x$1, x$2;
		p = this;
		if (p.store.$length === 0) {
			if (!(p.New === $throwNilPointerError)) {
				return p.New();
			}
			return $ifaceNil;
		}
		x$2 = (x = p.store, x$1 = p.store.$length - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		p.store = $subslice(p.store, 0, (p.store.$length - 1 >> 0));
		return x$2;
	};
	Pool.prototype.Get = function() { return this.$val.Get(); };
	Pool.Ptr.prototype.Put = function(x) {
		var p;
		p = this;
		if ($interfaceIsEqual(x, $ifaceNil)) {
			return;
		}
		p.store = $append(p.store, x);
	};
	Pool.prototype.Put = function(x) { return this.$val.Put(x); };
	runtime_registerPoolCleanup = function(cleanup) {
	};
	runtime_Syncsemcheck = function(size) {
	};
	Mutex.Ptr.prototype.Lock = function() {
		var m, awoke, old, new$1;
		m = this;
		if (atomic.CompareAndSwapInt32(new ($ptrType($Int32))(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m), 0, 1)) {
			return;
		}
		awoke = false;
		while (true) {
			old = m.state;
			new$1 = old | 1;
			if (!(((old & 1) === 0))) {
				new$1 = old + 4 >> 0;
			}
			if (awoke) {
				new$1 = new$1 & ~(2);
			}
			if (atomic.CompareAndSwapInt32(new ($ptrType($Int32))(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m), old, new$1)) {
				if ((old & 1) === 0) {
					break;
				}
				runtime_Semacquire(new ($ptrType($Uint32))(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m));
				awoke = true;
			}
		}
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.Ptr.prototype.Unlock = function() {
		var m, new$1, old;
		m = this;
		new$1 = atomic.AddInt32(new ($ptrType($Int32))(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m), -1);
		if ((((new$1 + 1 >> 0)) & 1) === 0) {
			$panic(new $String("sync: unlock of unlocked mutex"));
		}
		old = new$1;
		while (true) {
			if (((old >> 2 >> 0) === 0) || !(((old & 3) === 0))) {
				return;
			}
			new$1 = ((old - 4 >> 0)) | 2;
			if (atomic.CompareAndSwapInt32(new ($ptrType($Int32))(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m), old, new$1)) {
				runtime_Semrelease(new ($ptrType($Uint32))(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m));
				return;
			}
			old = m.state;
		}
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	poolCleanup = function() {
		var _ref, _i, i, p, i$1, l, _ref$1, _i$1, j, x;
		_ref = allPools;
		_i = 0;
		while (_i < _ref.$length) {
			i = _i;
			p = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			(i < 0 || i >= allPools.$length) ? $throwRuntimeError("index out of range") : allPools.$array[allPools.$offset + i] = ($ptrType(Pool)).nil;
			i$1 = 0;
			while (i$1 < (p.localSize >> 0)) {
				l = indexLocal(p.local, i$1);
				l.private$0 = $ifaceNil;
				_ref$1 = l.shared;
				_i$1 = 0;
				while (_i$1 < _ref$1.$length) {
					j = _i$1;
					(x = l.shared, (j < 0 || j >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + j] = $ifaceNil);
					_i$1++;
				}
				l.shared = ($sliceType($emptyInterface)).nil;
				i$1 = i$1 + (1) >> 0;
			}
			_i++;
		}
		allPools = new ($sliceType(($ptrType(Pool))))([]);
	};
	init = function() {
		runtime_registerPoolCleanup(poolCleanup);
	};
	indexLocal = function(l, i) {
		var x;
		return (x = l, (x.nilCheck, ((i < 0 || i >= x.length) ? $throwRuntimeError("index out of range") : x[i])));
	};
	runtime_Semacquire = function() {
		$panic("Native function not implemented: sync.runtime_Semacquire");
	};
	runtime_Semrelease = function() {
		$panic("Native function not implemented: sync.runtime_Semrelease");
	};
	init$1 = function() {
		var s;
		s = syncSema.zero(); $copy(s, syncSema.zero(), syncSema);
		runtime_Syncsemcheck(12);
	};
	$pkg.$init = function() {
		($ptrType(Pool)).methods = [["Get", "Get", "", $funcType([], [$emptyInterface], false), -1], ["Put", "Put", "", $funcType([$emptyInterface], [], false), -1], ["getSlow", "getSlow", "sync", $funcType([], [$emptyInterface], false), -1], ["pin", "pin", "sync", $funcType([], [($ptrType(poolLocal))], false), -1], ["pinSlow", "pinSlow", "sync", $funcType([], [($ptrType(poolLocal))], false), -1]];
		Pool.init([["local", "local", "sync", $UnsafePointer, ""], ["localSize", "localSize", "sync", $Uintptr, ""], ["store", "store", "sync", ($sliceType($emptyInterface)), ""], ["New", "New", "", ($funcType([], [$emptyInterface], false)), ""]]);
		($ptrType(Mutex)).methods = [["Lock", "Lock", "", $funcType([], [], false), -1], ["Unlock", "Unlock", "", $funcType([], [], false), -1]];
		Mutex.init([["state", "state", "sync", $Int32, ""], ["sema", "sema", "sync", $Uint32, ""]]);
		($ptrType(poolLocal)).methods = [["Lock", "Lock", "", $funcType([], [], false), 2], ["Unlock", "Unlock", "", $funcType([], [], false), 2]];
		poolLocal.init([["private$0", "private", "sync", $emptyInterface, ""], ["shared", "shared", "sync", ($sliceType($emptyInterface)), ""], ["Mutex", "", "", Mutex, ""], ["pad", "pad", "sync", ($arrayType($Uint8, 128)), ""]]);
		syncSema.init($Uintptr, 3);
		allPools = ($sliceType(($ptrType(Pool)))).nil;
		init();
		init$1();
	};
	return $pkg;
})();
$packages["io"] = (function() {
	var $pkg = {}, runtime = $packages["runtime"], errors = $packages["errors"], sync = $packages["sync"], errWhence, errOffset;
	$pkg.$init = function() {
		$pkg.ErrShortWrite = errors.New("short write");
		$pkg.ErrShortBuffer = errors.New("short buffer");
		$pkg.EOF = errors.New("EOF");
		$pkg.ErrUnexpectedEOF = errors.New("unexpected EOF");
		$pkg.ErrNoProgress = errors.New("multiple Read calls return no data or error");
		errWhence = errors.New("Seek: invalid whence");
		errOffset = errors.New("Seek: invalid offset");
		$pkg.ErrClosedPipe = errors.New("io: read/write on closed pipe");
	};
	return $pkg;
})();
$packages["unicode"] = (function() {
	var $pkg = {}, RangeTable, Range16, Range32, CaseRange, d, _White_Space, _CaseRanges, to, IsSpace, is16, is32, isExcludingLatin, To, ToLower;
	RangeTable = $pkg.RangeTable = $newType(0, "Struct", "unicode.RangeTable", "RangeTable", "unicode", function(R16_, R32_, LatinOffset_) {
		this.$val = this;
		this.R16 = R16_ !== undefined ? R16_ : ($sliceType(Range16)).nil;
		this.R32 = R32_ !== undefined ? R32_ : ($sliceType(Range32)).nil;
		this.LatinOffset = LatinOffset_ !== undefined ? LatinOffset_ : 0;
	});
	Range16 = $pkg.Range16 = $newType(0, "Struct", "unicode.Range16", "Range16", "unicode", function(Lo_, Hi_, Stride_) {
		this.$val = this;
		this.Lo = Lo_ !== undefined ? Lo_ : 0;
		this.Hi = Hi_ !== undefined ? Hi_ : 0;
		this.Stride = Stride_ !== undefined ? Stride_ : 0;
	});
	Range32 = $pkg.Range32 = $newType(0, "Struct", "unicode.Range32", "Range32", "unicode", function(Lo_, Hi_, Stride_) {
		this.$val = this;
		this.Lo = Lo_ !== undefined ? Lo_ : 0;
		this.Hi = Hi_ !== undefined ? Hi_ : 0;
		this.Stride = Stride_ !== undefined ? Stride_ : 0;
	});
	CaseRange = $pkg.CaseRange = $newType(0, "Struct", "unicode.CaseRange", "CaseRange", "unicode", function(Lo_, Hi_, Delta_) {
		this.$val = this;
		this.Lo = Lo_ !== undefined ? Lo_ : 0;
		this.Hi = Hi_ !== undefined ? Hi_ : 0;
		this.Delta = Delta_ !== undefined ? Delta_ : d.zero();
	});
	d = $pkg.d = $newType(12, "Array", "unicode.d", "d", "unicode", null);
	to = function(_case, r, caseRange) {
		var lo, hi, _q, m, cr, x, delta;
		if (_case < 0 || 3 <= _case) {
			return 65533;
		}
		lo = 0;
		hi = caseRange.$length;
		while (lo < hi) {
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			cr = ((m < 0 || m >= caseRange.$length) ? $throwRuntimeError("index out of range") : caseRange.$array[caseRange.$offset + m]);
			if ((cr.Lo >> 0) <= r && r <= (cr.Hi >> 0)) {
				delta = (x = cr.Delta, ((_case < 0 || _case >= x.length) ? $throwRuntimeError("index out of range") : x[_case]));
				if (delta > 1114111) {
					return (cr.Lo >> 0) + (((((r - (cr.Lo >> 0) >> 0)) & ~1) | ((_case & 1) >> 0))) >> 0;
				}
				return r + delta >> 0;
			}
			if (r < (cr.Lo >> 0)) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return r;
	};
	IsSpace = $pkg.IsSpace = function(r) {
		var _ref;
		if ((r >>> 0) <= 255) {
			_ref = r;
			if (_ref === 9 || _ref === 10 || _ref === 11 || _ref === 12 || _ref === 13 || _ref === 32 || _ref === 133 || _ref === 160) {
				return true;
			}
			return false;
		}
		return isExcludingLatin($pkg.White_Space, r);
	};
	is16 = function(ranges, r) {
		var _ref, _i, i, range_, _r, lo, hi, _q, m, range_$1, _r$1;
		if (ranges.$length <= 18 || r <= 255) {
			_ref = ranges;
			_i = 0;
			while (_i < _ref.$length) {
				i = _i;
				range_ = ((i < 0 || i >= ranges.$length) ? $throwRuntimeError("index out of range") : ranges.$array[ranges.$offset + i]);
				if (r < range_.Lo) {
					return false;
				}
				if (r <= range_.Hi) {
					return (_r = ((r - range_.Lo << 16 >>> 16)) % range_.Stride, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0;
				}
				_i++;
			}
			return false;
		}
		lo = 0;
		hi = ranges.$length;
		while (lo < hi) {
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			range_$1 = ((m < 0 || m >= ranges.$length) ? $throwRuntimeError("index out of range") : ranges.$array[ranges.$offset + m]);
			if (range_$1.Lo <= r && r <= range_$1.Hi) {
				return (_r$1 = ((r - range_$1.Lo << 16 >>> 16)) % range_$1.Stride, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0;
			}
			if (r < range_$1.Lo) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return false;
	};
	is32 = function(ranges, r) {
		var _ref, _i, i, range_, _r, lo, hi, _q, m, range_$1, _r$1;
		if (ranges.$length <= 18) {
			_ref = ranges;
			_i = 0;
			while (_i < _ref.$length) {
				i = _i;
				range_ = ((i < 0 || i >= ranges.$length) ? $throwRuntimeError("index out of range") : ranges.$array[ranges.$offset + i]);
				if (r < range_.Lo) {
					return false;
				}
				if (r <= range_.Hi) {
					return (_r = ((r - range_.Lo >>> 0)) % range_.Stride, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) === 0;
				}
				_i++;
			}
			return false;
		}
		lo = 0;
		hi = ranges.$length;
		while (lo < hi) {
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			range_$1 = new Range32.Ptr(); $copy(range_$1, ((m < 0 || m >= ranges.$length) ? $throwRuntimeError("index out of range") : ranges.$array[ranges.$offset + m]), Range32);
			if (range_$1.Lo <= r && r <= range_$1.Hi) {
				return (_r$1 = ((r - range_$1.Lo >>> 0)) % range_$1.Stride, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0;
			}
			if (r < range_$1.Lo) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return false;
	};
	isExcludingLatin = function(rangeTab, r) {
		var r16, off, x, r32;
		r16 = rangeTab.R16;
		off = rangeTab.LatinOffset;
		if (r16.$length > off && r <= ((x = r16.$length - 1 >> 0, ((x < 0 || x >= r16.$length) ? $throwRuntimeError("index out of range") : r16.$array[r16.$offset + x])).Hi >> 0)) {
			return is16($subslice(r16, off), (r << 16 >>> 16));
		}
		r32 = rangeTab.R32;
		if (r32.$length > 0 && r >= (((0 < 0 || 0 >= r32.$length) ? $throwRuntimeError("index out of range") : r32.$array[r32.$offset + 0]).Lo >> 0)) {
			return is32(r32, (r >>> 0));
		}
		return false;
	};
	To = $pkg.To = function(_case, r) {
		return to(_case, r, $pkg.CaseRanges);
	};
	ToLower = $pkg.ToLower = function(r) {
		if (r <= 127) {
			if (65 <= r && r <= 90) {
				r = r + (32) >> 0;
			}
			return r;
		}
		return To(1, r);
	};
	$pkg.$init = function() {
		RangeTable.init([["R16", "R16", "", ($sliceType(Range16)), ""], ["R32", "R32", "", ($sliceType(Range32)), ""], ["LatinOffset", "LatinOffset", "", $Int, ""]]);
		Range16.init([["Lo", "Lo", "", $Uint16, ""], ["Hi", "Hi", "", $Uint16, ""], ["Stride", "Stride", "", $Uint16, ""]]);
		Range32.init([["Lo", "Lo", "", $Uint32, ""], ["Hi", "Hi", "", $Uint32, ""], ["Stride", "Stride", "", $Uint32, ""]]);
		CaseRange.init([["Lo", "Lo", "", $Uint32, ""], ["Hi", "Hi", "", $Uint32, ""], ["Delta", "Delta", "", d, ""]]);
		d.init($Int32, 3);
		_White_Space = new RangeTable.Ptr(new ($sliceType(Range16))([new Range16.Ptr(9, 13, 1), new Range16.Ptr(32, 32, 1), new Range16.Ptr(133, 133, 1), new Range16.Ptr(160, 160, 1), new Range16.Ptr(5760, 5760, 1), new Range16.Ptr(8192, 8202, 1), new Range16.Ptr(8232, 8233, 1), new Range16.Ptr(8239, 8239, 1), new Range16.Ptr(8287, 8287, 1), new Range16.Ptr(12288, 12288, 1)]), ($sliceType(Range32)).nil, 4);
		$pkg.White_Space = _White_Space;
		_CaseRanges = new ($sliceType(CaseRange))([new CaseRange.Ptr(65, 90, $toNativeArray("Int32", [0, 32, 0])), new CaseRange.Ptr(97, 122, $toNativeArray("Int32", [-32, 0, -32])), new CaseRange.Ptr(181, 181, $toNativeArray("Int32", [743, 0, 743])), new CaseRange.Ptr(192, 214, $toNativeArray("Int32", [0, 32, 0])), new CaseRange.Ptr(216, 222, $toNativeArray("Int32", [0, 32, 0])), new CaseRange.Ptr(224, 246, $toNativeArray("Int32", [-32, 0, -32])), new CaseRange.Ptr(248, 254, $toNativeArray("Int32", [-32, 0, -32])), new CaseRange.Ptr(255, 255, $toNativeArray("Int32", [121, 0, 121])), new CaseRange.Ptr(256, 303, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(304, 304, $toNativeArray("Int32", [0, -199, 0])), new CaseRange.Ptr(305, 305, $toNativeArray("Int32", [-232, 0, -232])), new CaseRange.Ptr(306, 311, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(313, 328, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(330, 375, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(376, 376, $toNativeArray("Int32", [0, -121, 0])), new CaseRange.Ptr(377, 382, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(383, 383, $toNativeArray("Int32", [-300, 0, -300])), new CaseRange.Ptr(384, 384, $toNativeArray("Int32", [195, 0, 195])), new CaseRange.Ptr(385, 385, $toNativeArray("Int32", [0, 210, 0])), new CaseRange.Ptr(386, 389, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(390, 390, $toNativeArray("Int32", [0, 206, 0])), new CaseRange.Ptr(391, 392, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(393, 394, $toNativeArray("Int32", [0, 205, 0])), new CaseRange.Ptr(395, 396, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(398, 398, $toNativeArray("Int32", [0, 79, 0])), new CaseRange.Ptr(399, 399, $toNativeArray("Int32", [0, 202, 0])), new CaseRange.Ptr(400, 400, $toNativeArray("Int32", [0, 203, 0])), new CaseRange.Ptr(401, 402, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(403, 403, $toNativeArray("Int32", [0, 205, 0])), new CaseRange.Ptr(404, 404, $toNativeArray("Int32", [0, 207, 0])), new CaseRange.Ptr(405, 405, $toNativeArray("Int32", [97, 0, 97])), new CaseRange.Ptr(406, 406, $toNativeArray("Int32", [0, 211, 0])), new CaseRange.Ptr(407, 407, $toNativeArray("Int32", [0, 209, 0])), new CaseRange.Ptr(408, 409, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(410, 410, $toNativeArray("Int32", [163, 0, 163])), new CaseRange.Ptr(412, 412, $toNativeArray("Int32", [0, 211, 0])), new CaseRange.Ptr(413, 413, $toNativeArray("Int32", [0, 213, 0])), new CaseRange.Ptr(414, 414, $toNativeArray("Int32", [130, 0, 130])), new CaseRange.Ptr(415, 415, $toNativeArray("Int32", [0, 214, 0])), new CaseRange.Ptr(416, 421, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(422, 422, $toNativeArray("Int32", [0, 218, 0])), new CaseRange.Ptr(423, 424, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(425, 425, $toNativeArray("Int32", [0, 218, 0])), new CaseRange.Ptr(428, 429, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(430, 430, $toNativeArray("Int32", [0, 218, 0])), new CaseRange.Ptr(431, 432, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(433, 434, $toNativeArray("Int32", [0, 217, 0])), new CaseRange.Ptr(435, 438, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(439, 439, $toNativeArray("Int32", [0, 219, 0])), new CaseRange.Ptr(440, 441, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(444, 445, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(447, 447, $toNativeArray("Int32", [56, 0, 56])), new CaseRange.Ptr(452, 452, $toNativeArray("Int32", [0, 2, 1])), new CaseRange.Ptr(453, 453, $toNativeArray("Int32", [-1, 1, 0])), new CaseRange.Ptr(454, 454, $toNativeArray("Int32", [-2, 0, -1])), new CaseRange.Ptr(455, 455, $toNativeArray("Int32", [0, 2, 1])), new CaseRange.Ptr(456, 456, $toNativeArray("Int32", [-1, 1, 0])), new CaseRange.Ptr(457, 457, $toNativeArray("Int32", [-2, 0, -1])), new CaseRange.Ptr(458, 458, $toNativeArray("Int32", [0, 2, 1])), new CaseRange.Ptr(459, 459, $toNativeArray("Int32", [-1, 1, 0])), new CaseRange.Ptr(460, 460, $toNativeArray("Int32", [-2, 0, -1])), new CaseRange.Ptr(461, 476, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(477, 477, $toNativeArray("Int32", [-79, 0, -79])), new CaseRange.Ptr(478, 495, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(497, 497, $toNativeArray("Int32", [0, 2, 1])), new CaseRange.Ptr(498, 498, $toNativeArray("Int32", [-1, 1, 0])), new CaseRange.Ptr(499, 499, $toNativeArray("Int32", [-2, 0, -1])), new CaseRange.Ptr(500, 501, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(502, 502, $toNativeArray("Int32", [0, -97, 0])), new CaseRange.Ptr(503, 503, $toNativeArray("Int32", [0, -56, 0])), new CaseRange.Ptr(504, 543, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(544, 544, $toNativeArray("Int32", [0, -130, 0])), new CaseRange.Ptr(546, 563, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(570, 570, $toNativeArray("Int32", [0, 10795, 0])), new CaseRange.Ptr(571, 572, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(573, 573, $toNativeArray("Int32", [0, -163, 0])), new CaseRange.Ptr(574, 574, $toNativeArray("Int32", [0, 10792, 0])), new CaseRange.Ptr(575, 576, $toNativeArray("Int32", [10815, 0, 10815])), new CaseRange.Ptr(577, 578, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(579, 579, $toNativeArray("Int32", [0, -195, 0])), new CaseRange.Ptr(580, 580, $toNativeArray("Int32", [0, 69, 0])), new CaseRange.Ptr(581, 581, $toNativeArray("Int32", [0, 71, 0])), new CaseRange.Ptr(582, 591, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(592, 592, $toNativeArray("Int32", [10783, 0, 10783])), new CaseRange.Ptr(593, 593, $toNativeArray("Int32", [10780, 0, 10780])), new CaseRange.Ptr(594, 594, $toNativeArray("Int32", [10782, 0, 10782])), new CaseRange.Ptr(595, 595, $toNativeArray("Int32", [-210, 0, -210])), new CaseRange.Ptr(596, 596, $toNativeArray("Int32", [-206, 0, -206])), new CaseRange.Ptr(598, 599, $toNativeArray("Int32", [-205, 0, -205])), new CaseRange.Ptr(601, 601, $toNativeArray("Int32", [-202, 0, -202])), new CaseRange.Ptr(603, 603, $toNativeArray("Int32", [-203, 0, -203])), new CaseRange.Ptr(608, 608, $toNativeArray("Int32", [-205, 0, -205])), new CaseRange.Ptr(611, 611, $toNativeArray("Int32", [-207, 0, -207])), new CaseRange.Ptr(613, 613, $toNativeArray("Int32", [42280, 0, 42280])), new CaseRange.Ptr(614, 614, $toNativeArray("Int32", [42308, 0, 42308])), new CaseRange.Ptr(616, 616, $toNativeArray("Int32", [-209, 0, -209])), new CaseRange.Ptr(617, 617, $toNativeArray("Int32", [-211, 0, -211])), new CaseRange.Ptr(619, 619, $toNativeArray("Int32", [10743, 0, 10743])), new CaseRange.Ptr(623, 623, $toNativeArray("Int32", [-211, 0, -211])), new CaseRange.Ptr(625, 625, $toNativeArray("Int32", [10749, 0, 10749])), new CaseRange.Ptr(626, 626, $toNativeArray("Int32", [-213, 0, -213])), new CaseRange.Ptr(629, 629, $toNativeArray("Int32", [-214, 0, -214])), new CaseRange.Ptr(637, 637, $toNativeArray("Int32", [10727, 0, 10727])), new CaseRange.Ptr(640, 640, $toNativeArray("Int32", [-218, 0, -218])), new CaseRange.Ptr(643, 643, $toNativeArray("Int32", [-218, 0, -218])), new CaseRange.Ptr(648, 648, $toNativeArray("Int32", [-218, 0, -218])), new CaseRange.Ptr(649, 649, $toNativeArray("Int32", [-69, 0, -69])), new CaseRange.Ptr(650, 651, $toNativeArray("Int32", [-217, 0, -217])), new CaseRange.Ptr(652, 652, $toNativeArray("Int32", [-71, 0, -71])), new CaseRange.Ptr(658, 658, $toNativeArray("Int32", [-219, 0, -219])), new CaseRange.Ptr(837, 837, $toNativeArray("Int32", [84, 0, 84])), new CaseRange.Ptr(880, 883, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(886, 887, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(891, 893, $toNativeArray("Int32", [130, 0, 130])), new CaseRange.Ptr(902, 902, $toNativeArray("Int32", [0, 38, 0])), new CaseRange.Ptr(904, 906, $toNativeArray("Int32", [0, 37, 0])), new CaseRange.Ptr(908, 908, $toNativeArray("Int32", [0, 64, 0])), new CaseRange.Ptr(910, 911, $toNativeArray("Int32", [0, 63, 0])), new CaseRange.Ptr(913, 929, $toNativeArray("Int32", [0, 32, 0])), new CaseRange.Ptr(931, 939, $toNativeArray("Int32", [0, 32, 0])), new CaseRange.Ptr(940, 940, $toNativeArray("Int32", [-38, 0, -38])), new CaseRange.Ptr(941, 943, $toNativeArray("Int32", [-37, 0, -37])), new CaseRange.Ptr(945, 961, $toNativeArray("Int32", [-32, 0, -32])), new CaseRange.Ptr(962, 962, $toNativeArray("Int32", [-31, 0, -31])), new CaseRange.Ptr(963, 971, $toNativeArray("Int32", [-32, 0, -32])), new CaseRange.Ptr(972, 972, $toNativeArray("Int32", [-64, 0, -64])), new CaseRange.Ptr(973, 974, $toNativeArray("Int32", [-63, 0, -63])), new CaseRange.Ptr(975, 975, $toNativeArray("Int32", [0, 8, 0])), new CaseRange.Ptr(976, 976, $toNativeArray("Int32", [-62, 0, -62])), new CaseRange.Ptr(977, 977, $toNativeArray("Int32", [-57, 0, -57])), new CaseRange.Ptr(981, 981, $toNativeArray("Int32", [-47, 0, -47])), new CaseRange.Ptr(982, 982, $toNativeArray("Int32", [-54, 0, -54])), new CaseRange.Ptr(983, 983, $toNativeArray("Int32", [-8, 0, -8])), new CaseRange.Ptr(984, 1007, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(1008, 1008, $toNativeArray("Int32", [-86, 0, -86])), new CaseRange.Ptr(1009, 1009, $toNativeArray("Int32", [-80, 0, -80])), new CaseRange.Ptr(1010, 1010, $toNativeArray("Int32", [7, 0, 7])), new CaseRange.Ptr(1012, 1012, $toNativeArray("Int32", [0, -60, 0])), new CaseRange.Ptr(1013, 1013, $toNativeArray("Int32", [-96, 0, -96])), new CaseRange.Ptr(1015, 1016, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(1017, 1017, $toNativeArray("Int32", [0, -7, 0])), new CaseRange.Ptr(1018, 1019, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(1021, 1023, $toNativeArray("Int32", [0, -130, 0])), new CaseRange.Ptr(1024, 1039, $toNativeArray("Int32", [0, 80, 0])), new CaseRange.Ptr(1040, 1071, $toNativeArray("Int32", [0, 32, 0])), new CaseRange.Ptr(1072, 1103, $toNativeArray("Int32", [-32, 0, -32])), new CaseRange.Ptr(1104, 1119, $toNativeArray("Int32", [-80, 0, -80])), new CaseRange.Ptr(1120, 1153, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(1162, 1215, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(1216, 1216, $toNativeArray("Int32", [0, 15, 0])), new CaseRange.Ptr(1217, 1230, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(1231, 1231, $toNativeArray("Int32", [-15, 0, -15])), new CaseRange.Ptr(1232, 1319, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(1329, 1366, $toNativeArray("Int32", [0, 48, 0])), new CaseRange.Ptr(1377, 1414, $toNativeArray("Int32", [-48, 0, -48])), new CaseRange.Ptr(4256, 4293, $toNativeArray("Int32", [0, 7264, 0])), new CaseRange.Ptr(4295, 4295, $toNativeArray("Int32", [0, 7264, 0])), new CaseRange.Ptr(4301, 4301, $toNativeArray("Int32", [0, 7264, 0])), new CaseRange.Ptr(7545, 7545, $toNativeArray("Int32", [35332, 0, 35332])), new CaseRange.Ptr(7549, 7549, $toNativeArray("Int32", [3814, 0, 3814])), new CaseRange.Ptr(7680, 7829, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(7835, 7835, $toNativeArray("Int32", [-59, 0, -59])), new CaseRange.Ptr(7838, 7838, $toNativeArray("Int32", [0, -7615, 0])), new CaseRange.Ptr(7840, 7935, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(7936, 7943, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(7944, 7951, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(7952, 7957, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(7960, 7965, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(7968, 7975, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(7976, 7983, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(7984, 7991, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(7992, 7999, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8000, 8005, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(8008, 8013, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8017, 8017, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(8019, 8019, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(8021, 8021, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(8023, 8023, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(8025, 8025, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8027, 8027, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8029, 8029, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8031, 8031, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8032, 8039, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(8040, 8047, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8048, 8049, $toNativeArray("Int32", [74, 0, 74])), new CaseRange.Ptr(8050, 8053, $toNativeArray("Int32", [86, 0, 86])), new CaseRange.Ptr(8054, 8055, $toNativeArray("Int32", [100, 0, 100])), new CaseRange.Ptr(8056, 8057, $toNativeArray("Int32", [128, 0, 128])), new CaseRange.Ptr(8058, 8059, $toNativeArray("Int32", [112, 0, 112])), new CaseRange.Ptr(8060, 8061, $toNativeArray("Int32", [126, 0, 126])), new CaseRange.Ptr(8064, 8071, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(8072, 8079, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8080, 8087, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(8088, 8095, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8096, 8103, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(8104, 8111, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8112, 8113, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(8115, 8115, $toNativeArray("Int32", [9, 0, 9])), new CaseRange.Ptr(8120, 8121, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8122, 8123, $toNativeArray("Int32", [0, -74, 0])), new CaseRange.Ptr(8124, 8124, $toNativeArray("Int32", [0, -9, 0])), new CaseRange.Ptr(8126, 8126, $toNativeArray("Int32", [-7205, 0, -7205])), new CaseRange.Ptr(8131, 8131, $toNativeArray("Int32", [9, 0, 9])), new CaseRange.Ptr(8136, 8139, $toNativeArray("Int32", [0, -86, 0])), new CaseRange.Ptr(8140, 8140, $toNativeArray("Int32", [0, -9, 0])), new CaseRange.Ptr(8144, 8145, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(8152, 8153, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8154, 8155, $toNativeArray("Int32", [0, -100, 0])), new CaseRange.Ptr(8160, 8161, $toNativeArray("Int32", [8, 0, 8])), new CaseRange.Ptr(8165, 8165, $toNativeArray("Int32", [7, 0, 7])), new CaseRange.Ptr(8168, 8169, $toNativeArray("Int32", [0, -8, 0])), new CaseRange.Ptr(8170, 8171, $toNativeArray("Int32", [0, -112, 0])), new CaseRange.Ptr(8172, 8172, $toNativeArray("Int32", [0, -7, 0])), new CaseRange.Ptr(8179, 8179, $toNativeArray("Int32", [9, 0, 9])), new CaseRange.Ptr(8184, 8185, $toNativeArray("Int32", [0, -128, 0])), new CaseRange.Ptr(8186, 8187, $toNativeArray("Int32", [0, -126, 0])), new CaseRange.Ptr(8188, 8188, $toNativeArray("Int32", [0, -9, 0])), new CaseRange.Ptr(8486, 8486, $toNativeArray("Int32", [0, -7517, 0])), new CaseRange.Ptr(8490, 8490, $toNativeArray("Int32", [0, -8383, 0])), new CaseRange.Ptr(8491, 8491, $toNativeArray("Int32", [0, -8262, 0])), new CaseRange.Ptr(8498, 8498, $toNativeArray("Int32", [0, 28, 0])), new CaseRange.Ptr(8526, 8526, $toNativeArray("Int32", [-28, 0, -28])), new CaseRange.Ptr(8544, 8559, $toNativeArray("Int32", [0, 16, 0])), new CaseRange.Ptr(8560, 8575, $toNativeArray("Int32", [-16, 0, -16])), new CaseRange.Ptr(8579, 8580, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(9398, 9423, $toNativeArray("Int32", [0, 26, 0])), new CaseRange.Ptr(9424, 9449, $toNativeArray("Int32", [-26, 0, -26])), new CaseRange.Ptr(11264, 11310, $toNativeArray("Int32", [0, 48, 0])), new CaseRange.Ptr(11312, 11358, $toNativeArray("Int32", [-48, 0, -48])), new CaseRange.Ptr(11360, 11361, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(11362, 11362, $toNativeArray("Int32", [0, -10743, 0])), new CaseRange.Ptr(11363, 11363, $toNativeArray("Int32", [0, -3814, 0])), new CaseRange.Ptr(11364, 11364, $toNativeArray("Int32", [0, -10727, 0])), new CaseRange.Ptr(11365, 11365, $toNativeArray("Int32", [-10795, 0, -10795])), new CaseRange.Ptr(11366, 11366, $toNativeArray("Int32", [-10792, 0, -10792])), new CaseRange.Ptr(11367, 11372, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(11373, 11373, $toNativeArray("Int32", [0, -10780, 0])), new CaseRange.Ptr(11374, 11374, $toNativeArray("Int32", [0, -10749, 0])), new CaseRange.Ptr(11375, 11375, $toNativeArray("Int32", [0, -10783, 0])), new CaseRange.Ptr(11376, 11376, $toNativeArray("Int32", [0, -10782, 0])), new CaseRange.Ptr(11378, 11379, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(11381, 11382, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(11390, 11391, $toNativeArray("Int32", [0, -10815, 0])), new CaseRange.Ptr(11392, 11491, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(11499, 11502, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(11506, 11507, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(11520, 11557, $toNativeArray("Int32", [-7264, 0, -7264])), new CaseRange.Ptr(11559, 11559, $toNativeArray("Int32", [-7264, 0, -7264])), new CaseRange.Ptr(11565, 11565, $toNativeArray("Int32", [-7264, 0, -7264])), new CaseRange.Ptr(42560, 42605, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(42624, 42647, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(42786, 42799, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(42802, 42863, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(42873, 42876, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(42877, 42877, $toNativeArray("Int32", [0, -35332, 0])), new CaseRange.Ptr(42878, 42887, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(42891, 42892, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(42893, 42893, $toNativeArray("Int32", [0, -42280, 0])), new CaseRange.Ptr(42896, 42899, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(42912, 42921, $toNativeArray("Int32", [1114112, 1114112, 1114112])), new CaseRange.Ptr(42922, 42922, $toNativeArray("Int32", [0, -42308, 0])), new CaseRange.Ptr(65313, 65338, $toNativeArray("Int32", [0, 32, 0])), new CaseRange.Ptr(65345, 65370, $toNativeArray("Int32", [-32, 0, -32])), new CaseRange.Ptr(66560, 66599, $toNativeArray("Int32", [0, 40, 0])), new CaseRange.Ptr(66600, 66639, $toNativeArray("Int32", [-40, 0, -40]))]);
		$pkg.CaseRanges = _CaseRanges;
	};
	return $pkg;
})();
$packages["unicode/utf8"] = (function() {
	var $pkg = {}, RuneLen, EncodeRune;
	RuneLen = $pkg.RuneLen = function(r) {
		if (r < 0) {
			return -1;
		} else if (r <= 127) {
			return 1;
		} else if (r <= 2047) {
			return 2;
		} else if (55296 <= r && r <= 57343) {
			return -1;
		} else if (r <= 65535) {
			return 3;
		} else if (r <= 1114111) {
			return 4;
		}
		return -1;
	};
	EncodeRune = $pkg.EncodeRune = function(p, r) {
		var i;
		i = (r >>> 0);
		if (i <= 127) {
			(0 < 0 || 0 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = (r << 24 >>> 24);
			return 1;
		} else if (i <= 2047) {
			(0 < 0 || 0 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = (192 | ((r >> 6 >> 0) << 24 >>> 24)) >>> 0;
			(1 < 0 || 1 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = (128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0;
			return 2;
		} else if (i > 1114111 || 55296 <= i && i <= 57343) {
			r = 65533;
			(0 < 0 || 0 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = (224 | ((r >> 12 >> 0) << 24 >>> 24)) >>> 0;
			(1 < 0 || 1 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = (128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0;
			(2 < 0 || 2 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = (128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0;
			return 3;
		} else if (i <= 65535) {
			(0 < 0 || 0 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = (224 | ((r >> 12 >> 0) << 24 >>> 24)) >>> 0;
			(1 < 0 || 1 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = (128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0;
			(2 < 0 || 2 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = (128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0;
			return 3;
		} else {
			(0 < 0 || 0 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = (240 | ((r >> 18 >> 0) << 24 >>> 24)) >>> 0;
			(1 < 0 || 1 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = (128 | ((((r >> 12 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0;
			(2 < 0 || 2 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = (128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0;
			(3 < 0 || 3 >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 3] = (128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0;
			return 4;
		}
	};
	$pkg.$init = function() {
	};
	return $pkg;
})();
$packages["strings"] = (function() {
	var $pkg = {}, js = $packages["github.com/gopherjs/gopherjs/js"], errors = $packages["errors"], io = $packages["io"], utf8 = $packages["unicode/utf8"], unicode = $packages["unicode"], Fields, FieldsFunc, Join, Map, ToLower;
	Fields = $pkg.Fields = function(s) {
		return FieldsFunc(s, unicode.IsSpace);
	};
	FieldsFunc = $pkg.FieldsFunc = function(s, f) {
		var n, inField, _ref, _i, _rune, rune, wasInField, a, na, fieldStart, _ref$1, _i$1, _rune$1, i, rune$1;
		n = 0;
		inField = false;
		_ref = s;
		_i = 0;
		while (_i < _ref.length) {
			_rune = $decodeRune(_ref, _i);
			rune = _rune[0];
			wasInField = inField;
			inField = !f(rune);
			if (inField && !wasInField) {
				n = n + (1) >> 0;
			}
			_i += _rune[1];
		}
		a = ($sliceType($String)).make(n);
		na = 0;
		fieldStart = -1;
		_ref$1 = s;
		_i$1 = 0;
		while (_i$1 < _ref$1.length) {
			_rune$1 = $decodeRune(_ref$1, _i$1);
			i = _i$1;
			rune$1 = _rune$1[0];
			if (f(rune$1)) {
				if (fieldStart >= 0) {
					(na < 0 || na >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + na] = s.substring(fieldStart, i);
					na = na + (1) >> 0;
					fieldStart = -1;
				}
			} else if (fieldStart === -1) {
				fieldStart = i;
			}
			_i$1 += _rune$1[1];
		}
		if (fieldStart >= 0) {
			(na < 0 || na >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + na] = s.substring(fieldStart);
		}
		return a;
	};
	Join = $pkg.Join = function(a, sep) {
		var x, x$1, n, i, b, bp, _ref, _i, s;
		if (a.$length === 0) {
			return "";
		}
		if (a.$length === 1) {
			return ((0 < 0 || 0 >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 0]);
		}
		n = (x = sep.length, x$1 = (a.$length - 1 >> 0), (((x >>> 16 << 16) * x$1 >> 0) + (x << 16 >>> 16) * x$1) >> 0);
		i = 0;
		while (i < a.$length) {
			n = n + (((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i]).length) >> 0;
			i = i + (1) >> 0;
		}
		b = ($sliceType($Uint8)).make(n);
		bp = $copyString(b, ((0 < 0 || 0 >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 0]));
		_ref = $subslice(a, 1);
		_i = 0;
		while (_i < _ref.$length) {
			s = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			bp = bp + ($copyString($subslice(b, bp), sep)) >> 0;
			bp = bp + ($copyString($subslice(b, bp), s)) >> 0;
			_i++;
		}
		return $bytesToString(b);
	};
	Map = $pkg.Map = function(mapping, s) {
		var maxbytes, nbytes, b, _ref, _i, _rune, i, c, r, wid, nb;
		maxbytes = s.length;
		nbytes = 0;
		b = ($sliceType($Uint8)).nil;
		_ref = s;
		_i = 0;
		while (_i < _ref.length) {
			_rune = $decodeRune(_ref, _i);
			i = _i;
			c = _rune[0];
			r = mapping(c);
			if (b === ($sliceType($Uint8)).nil) {
				if (r === c) {
					_i += _rune[1];
					continue;
				}
				b = ($sliceType($Uint8)).make(maxbytes);
				nbytes = $copyString(b, s.substring(0, i));
			}
			if (r >= 0) {
				wid = 1;
				if (r >= 128) {
					wid = utf8.RuneLen(r);
				}
				if ((nbytes + wid >> 0) > maxbytes) {
					maxbytes = ((((maxbytes >>> 16 << 16) * 2 >> 0) + (maxbytes << 16 >>> 16) * 2) >> 0) + 4 >> 0;
					nb = ($sliceType($Uint8)).make(maxbytes);
					$copySlice(nb, $subslice(b, 0, nbytes));
					b = nb;
				}
				nbytes = nbytes + (utf8.EncodeRune($subslice(b, nbytes, maxbytes), r)) >> 0;
			}
			_i += _rune[1];
		}
		if (b === ($sliceType($Uint8)).nil) {
			return s;
		}
		return $bytesToString($subslice(b, 0, nbytes));
	};
	ToLower = $pkg.ToLower = function(s) {
		return Map(unicode.ToLower, s);
	};
	$pkg.$init = function() {
	};
	return $pkg;
})();
$packages["main"] = (function() {
	var $pkg = {}, strings = $packages["strings"], patricia = $packages["github.com/tchap/go-patricia/patricia"], js = $packages["github.com/gopherjs/gopherjs/js"], model, populate, suggestion, main;
	populate = function(cards) {
		var prefixes, _ref, _i, cn, fields, _ref$1, _i$1, i, prefix, _entry, results, _key;
		prefixes = new $Map();
		_ref = cards;
		_i = 0;
		while (_i < _ref.$length) {
			cn = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			fields = strings.Fields(cn);
			_ref$1 = fields;
			_i$1 = 0;
			while (_i$1 < _ref$1.$length) {
				i = _i$1;
				prefix = strings.ToLower(strings.Join($subslice(fields, i, fields.$length), " "));
				results = (_entry = prefixes[prefix], _entry !== undefined ? _entry.v : ($sliceType($String)).nil);
				if (results === ($sliceType($String)).nil) {
					results = ($sliceType($String)).make(0);
				} else {
					model.Delete(new patricia.Prefix($stringToBytes(prefix)));
				}
				results = $append(results, cn);
				_key = prefix; (prefixes || $throwRuntimeError("assignment to entry in nil map"))[_key] = { k: _key, v: results };
				model.Insert(new patricia.Prefix($stringToBytes(prefix)), results);
				_i$1++;
			}
			_i++;
		}
	};
	suggestion = function(s) {
		var suggestions;
		suggestions = ($sliceType($String)).make(0);
		model.VisitSubtree(new patricia.Prefix($stringToBytes(strings.ToLower(s))), (function(prefix, item) {
			var results, _ref, _i, result;
			results = $assertType(item, ($sliceType($String)));
			_ref = results;
			_i = 0;
			while (_i < _ref.$length) {
				result = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				suggestions = $append(suggestions, result);
				_i++;
			}
			return $ifaceNil;
		}));
		return suggestions;
	};
	main = function() {
		var _map, _key;
		$global.suggest = $externalize((_map = new $Map(), _key = "populate", _map[_key] = { k: _key, v: new ($funcType([($sliceType($String))], [], false))(populate) }, _key = "suggest", _map[_key] = { k: _key, v: new ($funcType([$String], [($sliceType($String))], false))(suggestion) }, _map), ($mapType($String, $emptyInterface)));
	};
	$pkg.$run = function($b) {
		$packages["github.com/gopherjs/gopherjs/js"].$init();
		$packages["runtime"].$init();
		$packages["errors"].$init();
		$packages["github.com/tchap/go-patricia/patricia"].$init();
		$packages["sync/atomic"].$init();
		$packages["sync"].$init();
		$packages["io"].$init();
		$packages["unicode"].$init();
		$packages["unicode/utf8"].$init();
		$packages["strings"].$init();
		$pkg.$init();
		main();
	};
	$pkg.$init = function() {
		model = patricia.NewTrie();
	};
	return $pkg;
})();
$go($packages["main"].$run, [], true);

})();
//# sourceMappingURL=suggest.js.map
