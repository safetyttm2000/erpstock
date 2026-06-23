// api.js — GAS API wrapper
// Uses Content-Type: text/plain to avoid CORS preflight (OPTIONS)
// that Google Apps Script Web Apps cannot answer.

window.Api = (function () {

  function getToken() {
    return localStorage.getItem('erp_token') || '';
  }

  function call(action, payload) {
    payload = Object.assign({}, payload || {});
    payload.action = action;
    payload.token  = getToken();

    return fetch(window.APP_CONFIG.API_URL, {
      method:   'POST',
      redirect: 'follow',
      headers:  { 'Content-Type': 'text/plain;charset=utf-8' },
      body:     JSON.stringify(payload)
    })
    .then(function (res) {
      // GAS always returns 200; non-JSON means something went wrong at the hosting layer
      var ct = res.headers.get('content-type') || '';
      if (!ct.includes('json') && !ct.includes('text')) {
        throw new Error('Unexpected content-type: ' + ct);
      }
      return res.text();
    })
    .then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        // GAS returned HTML (e.g. auth error page) — treat as server error
        console.error('GAS non-JSON response:', text.slice(0, 300));
        return { success: false, message: 'Server returned an unexpected response. Check your Apps Script deployment settings.' };
      }
    })
    .catch(function (err) {
      return { success: false, message: 'Network error: ' + (err.message || 'Could not reach the server. Check API_URL in config.js.') };
    })
    .then(function (result) {
      if (result && !result.success && /session/i.test(result.message || '')) {
        window.handleSessionExpired && window.handleSessionExpired();
      }
      return result;
    });
  }

  return { call: call, getToken: getToken };
})();
