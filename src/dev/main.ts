import '@/bridge/alpha-entry';

const status = document.querySelector('#caelian-demo-status');

if (status && window.Caelian) {
  const info = window.Caelian.getRuntimeInfo();
  status.textContent = `状态：${info.status} · ${info.databaseName} · ${info.version}`;
}
