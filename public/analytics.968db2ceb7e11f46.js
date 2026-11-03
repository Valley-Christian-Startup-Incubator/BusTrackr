(() => {
  'use strict';
  const domains = new Set(['bustrackr.valleychristianai.com', 'bustracker.valleychristianai.com', 'thatxliner.github.io', 'valley-christian-startup-incubator.github.io']);
  if (!domains.has(location.hostname) || window.BusTrackrAnalytics) return;
  const controls = new Set('mode_simple mode_map home feed_refresh alerts_toggle about_open view_route view_campus view_buildings view_conservatory view_quad view_sports view_fehren orbit_toggle overhead zoom_in zoom_out fit_route tracking_camera tracking_demo details_toggle direction_campus direction_fehren follow_toggle inspect_bus fleet_toggle trip_seek shuttle_1 shuttle_2 shuttle_3 simulation_toggle simulation_speed view_reset reconnect about_close source_osm source_shuttle about_back credits_osm estimate_locate notifications_toggle notifications_cancel skip_main nav_sightings nav_route nav_support open_map feed_help footer_privacy footer_support footer_github report_problem open_issues open_map_inline native_setup footer_home policy_google policy_cloudflare policy_resend privacy_questions'.split(' '));
  const outcomes = {
    app_view: new Set(['simple', 'map']),
    notification_permission: new Set(['granted', 'denied', 'default']),
    notification_enabled: new Set(),
    notification_disabled: new Set(),
    notification_failure: new Set(['enable', 'disable']),
    notification_open: new Set(),
  };
  const campaignKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  function cleanURL(value, campaign) {
    if (!value) return '';
    try {
      const url = new URL(value, location.origin);
      const search = new URLSearchParams();
      if (campaign) for (const key of campaignKeys) {
        const value = url.searchParams.get(key);
        if (value) search.set(key, value.slice(0, 120));
      }
      url.username = ''; url.password = ''; url.hash = ''; url.search = search.toString();
      return url.href.slice(0, 2000);
    } catch {return '';}
  }
  window.busTrackrBeforeSend = (_type, payload) => ({...payload, url: cleanURL(payload.url, true), referrer: cleanURL(payload.referrer, false)});
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://analytics.valleychristianai.com/script.js';
  script.setAttribute('data-website-id', '5eaf2f91-0cd8-48ce-84b1-1cc3244cf436');
  script.setAttribute('data-domains', [...domains].join(','));
  script.setAttribute('data-exclude-hash', 'true');
  script.setAttribute('data-before-send', 'busTrackrBeforeSend');
  try {if (localStorage.getItem('umami.disabled')) return;} catch {}
  const key = 'bustrackr.analytics.browser.v1';
  function randomID() {
    try {return crypto.randomUUID();} catch {}
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    } catch {return null;}
  }
  let id;
  try {
    id = localStorage.getItem(key);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id || '')) {
      id = randomID(); if (id) localStorage.setItem(key, id);
    }
  } catch {id = randomID();}
  if (id) script.setAttribute('data-distinct-id', id);
  let status = 'loading';
  const pending = [];
  const expires = Date.now() + 30_000;
  function surface() {
    const mode = document.querySelector('.app-shell')?.getAttribute('data-mode');
    if (mode === 'simple' || mode === 'map') return mode;
    if (/\/privacy(?:\.html)?\/?$/.test(location.pathname)) return 'privacy';
    if (/\/support(?:\.html)?\/?$/.test(location.pathname)) return 'support';
    return 'landing';
  }
  function send(event) {
    try {Promise.resolve(window.umami?.track(event.name, event.data)).catch(() => {});} catch {}
  }
  function enqueue(event) {
    if (status === 'ready') send(event);
    else if (status === 'loading' && Date.now() < expires) {
      if (pending.length === 50) pending.shift();
      pending.push(event);
    }
  }
  const timeout = setTimeout(() => {pending.length = 0;}, 30_000);
  script.addEventListener('load', () => {
    clearTimeout(timeout);
    if (status !== 'loading') return;
    status = window.umami?.track ? 'ready' : 'failed';
    if (status === 'ready' && Date.now() < expires) for (const event of pending) send(event);
    pending.length = 0;
  }, {once: true});
  script.addEventListener('error', () => {clearTimeout(timeout); status = 'failed'; pending.length = 0;}, {once: true});
  window.BusTrackrAnalytics = Object.freeze({track(name, value) {
    if (!Object.hasOwn(outcomes, name)) return;
    const allowed = outcomes[name];
    if (allowed.size && !allowed.has(value)) return;
    enqueue({name, data: {surface: surface(), ...(allowed.size ? {value} : {})}});
  }});
  function interaction(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-analytics]') : null;
    if (!target || target.matches(':disabled')) return;
    const control = target.getAttribute('data-analytics');
    if (!controls.has(control)) return;
    if (event.type === 'click' ? !target.matches('button,a') : !target.matches('input[type="range"],select')) return;
    enqueue({name: event.type === 'click' ? 'ui_click' : 'ui_change', data: {control, surface: surface()}});
  }
  document.addEventListener('click', interaction, true);
  document.addEventListener('change', interaction, true);
  const marker = new URL(location.href);
  if (marker.searchParams.get('notification_open') === '1') {
    marker.searchParams.delete('notification_open');
    history.replaceState(history.state, '', marker);
    window.BusTrackrAnalytics.track('notification_open');
  }
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.origin === location.origin && typeof ServiceWorker !== 'undefined' && event.source instanceof ServiceWorker && new URL(event.source.scriptURL).origin === location.origin && event.data?.type === 'bustrackr_notification_open' && Object.keys(event.data).length === 1) window.BusTrackrAnalytics.track('notification_open');
  });
  document.head.append(script);
})();
