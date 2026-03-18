// In dev, Angular CLI proxies /ws → ws://localhost:8080/ws
// and /api → http://localhost:8080/api via proxy.conf.json.
// Use relative URLs so the proxy intercepts them correctly.
export const environment = {
  production: false,
  wsUrl: `ws://${window.location.host}/ws`,
  apiUrl: '',
};
