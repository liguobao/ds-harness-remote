import { asArray, asRecord, jsonStr } from '../protocol/Types';

export class BotCatalogRow {
  id: string = '';
  name: string = '';
  role: string = '';
  model: string = '';
  memberIds: string[] = [];
  room: boolean = false;
  pinned: boolean = false;
}

export function parseBotCatalog(response: Object): BotCatalogRow[] {
  const raw = asRecord(response);
  if (raw?.['status'] === 404) {
    throw new Error('BOT_NOT_INSTALLED');
  }
  if (raw?.['status'] === 503) {
    throw new Error('BOT_UNSUPPORTED');
  }
  const envelope = asRecord(raw?.['json']);
  const state = asRecord(envelope?.['value']);
  if (raw?.['status'] !== 200 || envelope?.['ok'] !== true || state === undefined) {
    throw new Error('BOT_UNAVAILABLE');
  }
  const bots = asArray(state['bots']);
  const rooms = asArray(state['rooms']);
  if (bots === undefined || rooms === undefined) {
    throw new Error('BOT_UNAVAILABLE');
  }
  return readRows(bots, false).concat(readRows(rooms, true));
}

function readRows(items: Object[], room: boolean): BotCatalogRow[] {
  const rows: BotCatalogRow[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (record === undefined || record['hidden'] === true || record['private'] === true) {
      continue;
    }
    const id = jsonStr(record, 'id', '');
    if (id.length === 0) {
      continue;
    }
    const row = new BotCatalogRow();
    row.id = id;
    row.name = jsonStr(record, 'name', '') || id;
    row.role = jsonStr(record, 'role', '');
    row.model = jsonStr(record, 'appliedModel', '') || jsonStr(record, 'model', '');
    row.room = room;
    row.pinned = record['pinned'] === true;
    if (room) {
      for (const member of asArray(record['members']) ?? []) {
        if (typeof member === 'string') {
          row.memberIds.push(member);
        }
      }
    }
    rows.push(row);
  }
  return rows.sort((a: BotCatalogRow, b: BotCatalogRow) => Number(b.pinned) - Number(a.pinned)
    || a.name.localeCompare(b.name));
}
