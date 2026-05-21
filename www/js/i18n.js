(function (global) {
  'use strict';
  const TERMS = {
    adapter:'Modul', instance:'Service', object:'Datenpunkt', state:'Wert', host:'System', script:'Automation', enum:'Bereich',
    adapters:'Module', instances:'Services', objects:'Datenpunkte', states:'Werte', hosts:'Systeme', scripts:'Automationen', enums:'Bereiche',
    'product.name':'Fiducerion Bridge', 'product.parent':'Fiducerion Core', 'product.short':'FIDUCERION',
    'tab.dashboard':'Übersicht','tab.services':'Services','tab.modules':'Module','tab.repo':'Repository',
    'tab.objects':'Datenpunkte','tab.logs':'Protokoll','tab.settings':'Einstellungen',
    'action.install':'Installieren','action.upgrade':'Aktualisieren','action.uninstall':'Entfernen','action.addInstance':'Service hinzufügen'
  };
  function t(k){ return TERMS[k] || k; }
  global.MA = global.MA || {};
  global.MA.i18n = { t, TERMS };
  global.t = t;
})(window);
