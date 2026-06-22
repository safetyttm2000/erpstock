// api.js
// Thin wrapper around fetch() for talking to the Apps Script Web App.
// Uses text/plain as the request content type on purpose -- this keeps the
// request a CORS "simple request" so the browser skips the OPTIONS
// preflight that Apps Script can't answer.

window.Api = (function () {
  function getToken() {
    return localStorage.getItem('erp_token') || '';
  }

  function call(action, payload) {
    payload = payload || {};
    payload.action = action;
    payload.token = getToken();

    return fetch(window.APP_CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json(); })
      .catch(function () {
        return { success: false, message: 'Network error: could not reach the server. Check API_URL in config.js.' };
      })
      .then(function (result) {
        if (!result.success && /session/i.test(result.message || '')) {
          window.handleSessionExpired && window.handleSessionExpired();
        }
        return result;
      });
  }

  return { call: call, getToken: getToken };
})();
