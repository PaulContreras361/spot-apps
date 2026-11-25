/* Backyard Birding — Group First Finds board
   © 2026 Paul Contreras Jr. All rights reserved.
   Paste this whole file into Extensions > Apps Script in the "Backyard Birding First Finds" Google Sheet.
   1) Run "setup" once (it makes the tabs and the photo folder, and asks for permission).
   2) Type your group code in Settings!B1.
   3) Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone. Copy the web app URL.
   To hide a fake or wrong find, type Hidden in its Status column (or delete the row). */

const FOLDER_NAME = 'Backyard Birding First Finds';
const HEAD = ['Posted (server time)', 'Finder', 'Bird', 'Scientific name', 'Date seen', 'Town', 'Notes', 'Proof type', 'Proof link', 'Proof file id', 'Status'];

function setup() {
  sheets_();
  folder_();
  SpreadsheetApp.getActiveSpreadsheet().toast('Ready. Type your group code in Settings, cell B1, then deploy as a web app.');
}

function sheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let f = ss.getSheetByName('Finds');
  if (!f) { f = ss.insertSheet('Finds'); f.appendRow(HEAD); f.setFrozenRows(1); f.getRange(1, 1, 1, HEAD.length).setFontWeight('bold'); }
  let st = ss.getSheetByName('Settings');
  if (!st) {
    st = ss.insertSheet('Settings');
    st.getRange('A1').setValue('Group code');
    st.getRange('A3').setValue('Type the group code in cell B1. To hide a find, type Hidden in its Status column on the Finds tab.');
  }
  return { f: f, st: st };
}

function folder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return out_({ ok: true, app: 'Backyard Birding First Finds' }); }

function doPost(e) {
  try {
    const q = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const s = sheets_();
    const code = String(s.st.getRange('B1').getValue() || '').trim();
    if (!code) return out_({ ok: false, why: 'notready' });
    if (String(q.code || '').trim().toLowerCase() !== code.toLowerCase()) return out_({ ok: false, why: 'code' });
    if (q.action === 'list') return out_({ ok: true, finds: list_(s.f) });
    if (q.action === 'add') return add_(s.f, q);
    return out_({ ok: false, why: 'action' });
  } catch (err) {
    return out_({ ok: false, why: 'error', msg: String(err) });
  }
}

function list_(f) {
  const v = f.getDataRange().getValues().slice(1);
  return v.map(function (r) {
    return {
      posted: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      finder: String(r[1]), bird: String(r[2]), sci: String(r[3]),
      seen: r[4] instanceof Date ? Utilities.formatDate(r[4], 'America/Chicago', 'MMM d, yyyy') : String(r[4]),
      town: String(r[5]), notes: String(r[6]), type: String(r[7]), link: String(r[8]), fileId: String(r[9]), status: String(r[10])
    };
  }).filter(function (x) { return x.bird && x.status.toLowerCase() !== 'hidden'; });
}

function add_(f, q) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const need = ['finder', 'bird', 'sci', 'seen', 'proof', 'proofType'];
    for (let i = 0; i < need.length; i++) if (!q[need[i]]) return out_({ ok: false, why: 'missing', field: need[i] });
    if (String(q.proof).length > 14000000) return out_({ ok: false, why: 'toobig' });
    const sci = String(q.sci).toLowerCase(), who = String(q.finder).trim().toLowerCase();
    if (list_(f).some(function (r) { return r.sci.toLowerCase() === sci && r.finder.trim().toLowerCase() === who; })) return out_({ ok: false, why: 'dup' });
    const isPhoto = q.proofType === 'photo';
    const blob = Utilities.newBlob(Utilities.base64Decode(String(q.proof)), isPhoto ? 'image/jpeg' : 'audio/wav',
      (String(q.bird) + ' - ' + String(q.finder)).slice(0, 100) + (isPhoto ? '.jpg' : '.wav'));
    const file = folder_().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    f.appendRow([new Date(), cell_(q.finder, 40), cell_(q.bird, 80), cell_(q.sci, 80), cell_(q.seen, 30), cell_(q.town || '', 40),
      cell_(q.notes || '', 300), isPhoto ? 'Photo' : 'Recording', file.getUrl(), file.getId(), '']);
    return out_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// Keeps typed text as plain text in the sheet (no formulas).
function cell_(s, n) {
  s = String(s).slice(0, n);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
