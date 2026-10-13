// SPDX-License-Identifier: MIT
// Runs inside the LibreOffice (ZetaOffice) pthread via Module.uno_scripts.
// Talks to app.js over zetajs.mainPort with {cmd, id, ...} messages and
// replies {cmd: 'reply', id, ok, result|error}.
'use strict';

let zetajs, css, context, desktop, xModel = null;

const FILTERS = {
  writer: {odt: 'writer8', docx: 'MS Word 2007 XML', doc: 'MS Word 97', rtf: 'Rich Text Format',
           txt: 'Text', html: 'HTML (StarWriter)', pdf: 'writer_pdf_Export'},
  calc: {ods: 'calc8', xlsx: 'Calc MS Excel 2007 XML', xls: 'MS Excel 97',
         csv: 'Text - txt - csv (StarCalc)', pdf: 'calc_pdf_Export'},
  impress: {odp: 'impress8', pptx: 'Impress MS PowerPoint 2007 XML', ppt: 'MS PowerPoint 97',
            pdf: 'impress_pdf_Export'},
  draw: {odg: 'draw8', pdf: 'draw_pdf_Export'},
};

function prop(name, value) {
  return new css.beans.PropertyValue({Name: name, Value: value});
}

function kindOf(model) {
  if (!model) return null;
  if (model.supportsService('com.sun.star.text.TextDocument')) return 'writer';
  if (model.supportsService('com.sun.star.sheet.SpreadsheetDocument')) return 'calc';
  if (model.supportsService('com.sun.star.presentation.PresentationDocument')) return 'impress';
  if (model.supportsService('com.sun.star.drawing.DrawingDocument')) return 'draw';
  return 'other';
}

function load(url) {
  // Replace the document shown in the single (full-canvas) frame. The page
  // asks the user about unsaved changes before it gets here.
  if (xModel) {
    try { xModel.setModified(false); } catch (e) {}
  }
  const frame = desktop.getCurrentFrame();
  const args = [prop('Hidden', false)];
  const model = frame ? frame.loadComponentFromURL(url, '_self', 0, args)
                      : desktop.loadComponentFromURL(url, '_default', 0, args);
  if (!model) throw new Error('could not load ' + url);
  xModel = model;
  const ctrl = xModel.getCurrentController();
  const f = ctrl.getFrame();
  f.getContainerWindow().FullScreen = true;
  intercept(f);
  return {kind: kindOf(xModel)};
}

function store(url, ext) {
  if (!xModel) throw new Error('no document open');
  const kind = kindOf(xModel);
  const filter = (FILTERS[kind] || {})[ext];
  if (!filter) throw new Error(`cannot save a ${kind} document as .${ext}`);
  xModel.storeToURL(url, [prop('FilterName', filter), prop('Overwrite', true)]);
  if (ext !== 'pdf') xModel.setModified(false);
  return {kind};
}

function text() {
  if (!xModel) return '';
  const kind = kindOf(xModel);
  if (kind === 'writer') return xModel.getText().getString();
  if (kind === 'calc') {
    const sheet = xModel.getSheets().getByIndex(0);
    const out = [];
    for (let r = 0; r < 20; r++) out.push(sheet.getCellByPosition(0, r).getString());
    return out.join('\n').trim();
  }
  return '';
}

const handlers = {
  open: (m) => load('file://' + m.path),
  new: (m) => load('private:factory/' + ({writer: 'swriter', calc: 'scalc', impress: 'simpress', draw: 'sdraw'}[m.kind] || 'swriter')),
  store: (m) => store('file://' + m.path, m.ext),
  modified: () => !!(xModel && xModel.isModified()),
  // the page re-marks a document as modified when its upload failed or hit a conflict
  setModified: (m) => { if (xModel) xModel.setModified(!!m.value); return true; },
  info: () => ({kind: kindOf(xModel), modified: !!(xModel && xModel.isModified())}),
  text: () => text(),
  filters: () => Object.fromEntries(Object.entries(FILTERS).map(([k, v]) => [k, Object.keys(v)])),
};

// LibreOffice's own file commands (Ctrl+S, File menu, toolbar) would open
// Qt file dialogs on the in-memory file system, which don't work here (they
// crash the wasm thread). Route them to the page, which saves to the ship.
const ACTIONS = {
  '.uno:Save': 'save', '.uno:SaveAs': 'saveas', '.uno:SaveACopy': 'saveas', '.uno:SaveAll': 'save',
  '.uno:ExportTo': 'saveas', '.uno:ExportToPDF': 'pdf', '.uno:ExportDirectToPDF': 'pdf',
  '.uno:Print': 'pdf', '.uno:PrintDefault': 'pdf', '.uno:PrintPreview': 'pdf',
  '.uno:Open': 'home', '.uno:OpenRemote': 'home', '.uno:CloseDoc': 'home', '.uno:CloseWin': 'home',
  '.uno:Quit': 'home', '.uno:RecentFileList': 'home', '.uno:OpenTemplate': 'home',
};
function actionOf(url) {
  if (ACTIONS[url]) return {action: ACTIONS[url]};
  const m = /^private:factory\/s(writer|calc|impress|draw)/.exec(url);
  if (m) return {action: 'new', kind: m[1]};
  return null;
}
let intercepted = null;
function intercept(frame) {
  if (intercepted && zetajs.sameUnoObject(intercepted, frame)) return;
  let slave = null, master = null;
  const dispatcher = zetajs.unoObject([css.frame.XDispatch], {
    dispatch(url, args) {
      zetajs.mainPort.postMessage({cmd: 'lo_cmd', url: url.Complete, ...actionOf(url.Complete)});
    },
    addStatusListener(listener, url) {
      try {
        listener.statusChanged(new css.frame.FeatureStateEvent({FeatureURL: url, IsEnabled: true, Requery: false}));
      } catch (e) { console.warn('office: status', e); }
    },
    removeStatusListener() {},
  });
  const interceptor = zetajs.unoObject([css.frame.XDispatchProviderInterceptor], {
    getSlaveDispatchProvider() { return slave; },
    setSlaveDispatchProvider(p) { slave = p; },
    getMasterDispatchProvider() { return master; },
    setMasterDispatchProvider(p) { master = p; },
    queryDispatch(url, target, flags) {
      if (actionOf(url.Complete)) return dispatcher;
      return slave ? slave.queryDispatch(url, target, flags) : null;
    },
    queryDispatches(reqs) {
      return Array.from(reqs, (r) => this.queryDispatch(r.FeatureURL, r.FrameName, r.SearchFlags));
    },
  });
  try {
    frame.registerDispatchProviderInterceptor(interceptor);
    intercepted = frame;
  } catch (e) { console.warn('office: interceptor', e); }
}

function start() {
  context = zetajs.getUnoComponentContext();
  desktop = css.frame.Desktop.create(context);

  zetajs.mainPort.onmessage = (e) => {
    const m = e.data;
    const h = handlers[m.cmd];
    let reply;
    try {
      if (!h) throw new Error('unknown command ' + m.cmd);
      reply = {cmd: 'reply', id: m.id, ok: true, result: h(m)};
    } catch (err) {
      reply = {cmd: 'reply', id: m.id, ok: false, error: String((err && err.message) || err)};
    }
    zetajs.mainPort.postMessage(reply);
  };
  zetajs.mainPort.postMessage({cmd: 'ready', kind: kindOf(desktop.getCurrentComponent ? desktop.getCurrentComponent() : null)});
}

Module.zetajs.then((z) => {
  zetajs = z;
  css = zetajs.uno.com.sun.star;
  start();
});
