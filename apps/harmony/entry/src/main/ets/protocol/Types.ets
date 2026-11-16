export class ParsedFrame {
  v: number = 0;
  id: string = '';
  type: string = '';
  timestamp: number = 0;
  payload: Record<string, Object> = {};
}

export function jsonStr(obj: Record<string, Object>, key: string, fallback: string): string {
  const v = obj[key];
  if (typeof v === 'string') {
    return v;
  }
  return fallback;
}

export function jsonNum(obj: Record<string, Object>, key: string, fallback: number): number {
  const v = obj[key];
  if (typeof v === 'number') {
    return v;
  }
  return fallback;
}

export function jsonBool(obj: Record<string, Object>, key: string, fallback: boolean): boolean {
  const v = obj[key];
  if (typeof v === 'boolean') {
    return v;
  }
  return fallback;
}

export function jsonObj(obj: Record<string, Object>, key: string): Record<string, Object> | undefined {
  const v = obj[key];
  if (typeof v === 'object' && v !== null) {
    return v as Record<string, Object>;
  }
  return undefined;
}

export function jsonArr(obj: Record<string, Object>, key: string): Object[] {
  const v = obj[key];
  if (Array.isArray(v)) {
    return v as Object[];
  }
  return [];
}

export function jsonStrArr(obj: Record<string, Object>, key: string): string[] {
  const v = obj[key];
  const out: string[] = [];
  if (Array.isArray(v)) {
    const arr = v as Object[];
    for (const item of arr) {
      if (typeof item === 'string') {
        out.push(item);
      }
    }
  }
  return out;
}

export function jsonValue(obj: Record<string, Object>, key: string): Object | undefined {
  return obj[key];
}

export function asRecord(value: Object | undefined): Record<string, Object> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, Object>;
  }
  return undefined;
}

export function asArray(value: Object | undefined): Object[] | undefined {
  if (Array.isArray(value)) {
    return value as Object[];
  }
  return undefined;
}

export function asBool(value: Object | undefined): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

export function asNum(value: Object | undefined): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  return undefined;
}

export function asStr(value: Object | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

export function parseFrame(text: string): ParsedFrame {
  const root = JSON.parse(text) as Record<string, Object>;
  const frame = new ParsedFrame();
  frame.v = jsonNum(root, 'v', 0);
  frame.id = jsonStr(root, 'id', '');
  frame.type = jsonStr(root, 'type', '');
  frame.timestamp = jsonNum(root, 'timestamp', 0);
  const p = root['payload'];
  if (typeof p === 'object' && p !== null) {
    frame.payload = p as Record<string, Object>;
  }
  return frame;
}
