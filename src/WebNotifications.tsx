import {useEffect, useRef, useState} from 'react';
import {feedEndpoint} from './useCameraFeed';

type Registration = {id: string; secret: string; enabled: boolean};
type NoticeState = 'checking' | 'off' | 'on' | 'busy' | 'cleanup' | 'unavailable' | 'denied' | 'retry' | 'unconfirmed';
const storageKey = 'bustrackr.web-notifications.v1';
const api = new URL('./notifications/', new URL(feedEndpoint, window.location.href)).href;
function readRegistration(): Registration | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !('id' in parsed) || !('secret' in parsed) || typeof parsed.id !== 'string' || typeof parsed.secret !== 'string') return null;
  return {id: parsed.id, secret: parsed.secret, enabled: 'enabled' in parsed && parsed.enabled === true};
}
function saveRegistration(registration: Registration) {
  localStorage.setItem(storageKey, JSON.stringify(registration));
}
function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
}
function friendlyError(error: unknown, fallback: string) {
  return error instanceof Error && /^(Could not|Notifications are not set up)/.test(error.message) ? error.message : fallback;
}
async function updateSubscription(method: 'POST' | 'DELETE', body: object) {
  const response = await fetch(api + 'subscriptions', {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000)});
  if (!response.ok) throw new Error('Could not save notification preferences. Please try again.');
}

export function WebNotifications({sample = false}: {sample?: boolean}) {
  const [state, setState] = useState<NoticeState>('checking');
  const [message, setMessage] = useState('Checking notification availability.');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    const checkPermission = () => {
      if ('Notification' in window && Notification.permission !== 'granted' && !busy.current) {
        setState(previous => previous === 'on' ? (Notification.permission === 'denied' ? 'denied' : 'off') : previous);
        if (Notification.permission === 'denied') setMessage('Notifications are blocked. Allow them in your browser settings.');
      }
    };
    window.addEventListener('focus', checkPermission);
    return () => window.removeEventListener('focus', checkPermission);
  }, []);
  useEffect(() => {
    let disposed = false;
    async function load() {
      if (sample) {
        let saved = null;
        try {saved = readRegistration();} catch {}
        setState(saved ? 'cleanup' : 'unavailable');
        setMessage(saved ? 'Sample data cannot send alerts. You can turn off the saved subscription.' : 'Notifications are off for sample data.');
        return;
      }
      if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState('unavailable'); setMessage('Notifications are unavailable in this browser. On iPhone, add BusTrackr to your Home Screen and open it there.'); return;
      }
      let registration: Registration | null = null;
      let hasSubscription = false;
      try {
        registration = readRegistration();
        await navigator.serviceWorker.register(import.meta.env.BASE_URL + 'notifications-sw.js', {scope: import.meta.env.BASE_URL});
        const worker = await navigator.serviceWorker.ready;
        const subscription = await worker.pushManager.getSubscription();
        hasSubscription = !!subscription;
        const response = await fetch(api + 'config', {signal: AbortSignal.timeout(10_000)});
        if (!response.ok) throw new Error('Could not check notification availability. Please try again.');
        const config: unknown = await response.json();
        const key = config && typeof config === 'object' && 'webPushPublicKey' in config && typeof config.webPushPublicKey === 'string' ? config.webPushPublicKey : null;
        if (disposed) return;
        setPublicKey(key);
        if (registration && !registration.enabled) {setState('cleanup'); setMessage('Finish turning off notifications to clear this browser subscription.');}
        else if (Notification.permission === 'denied') {setState('denied'); setMessage('Notifications are blocked. Allow them in your browser settings.');}
        else if (subscription && registration?.enabled && Notification.permission === 'granted') {setState('on'); setMessage(key ? 'You will be notified when a new bus sighting arrives.' : 'Saved alerts are on, but this feed cannot send notifications right now.');}
        else if (!key) {setState('retry'); setMessage('Notifications are not set up on this feed yet.');}
        else {setState('off'); setMessage('Get an alert when a new bus is detected, even with this page closed.');}
      } catch (error) {
        if (!disposed) {
          setState(registration && !registration.enabled ? 'cleanup' : Notification.permission === 'denied' ? 'denied' : registration?.enabled && hasSubscription && Notification.permission === 'granted' ? 'on' : 'retry');
          setMessage(friendlyError(error, 'Could not check notifications. Please try again.'));
        }
      }
    }
    void load();
    return () => {disposed = true;};
  }, [sample, revision]);
  async function toggle(forceDisable = false) {
    if (busy.current) return;
    if (state === 'retry') {setState('checking'); setRevision(value => value + 1); return;}
    const disabling = forceDisable || state === 'on' || state === 'cleanup';
    let registrationAttempted = false;
    busy.current = true;
    setState('busy');
    try {
      const registration = readRegistration() || {id: crypto.randomUUID(), secret: crypto.randomUUID(), enabled: false};
      if (disabling) {
        saveRegistration({...registration, enabled: false});
        const results = await Promise.allSettled([
          updateSubscription('DELETE', {id: registration.id, secret: registration.secret}),
          (async () => {
            const worker = await navigator.serviceWorker.ready;
            await (await worker.pushManager.getSubscription())?.unsubscribe();
          })(),
        ]);
        if (results.some(result => result.status === 'rejected')) throw new Error('Could not finish turning off notifications. Please try again.');
        localStorage.removeItem(storageKey);
        setState('off'); setMessage('Notifications are off.');
        return;
      }
      if (!publicKey) throw new Error('Notifications are not set up on this feed yet.');
      const permissionRequest = Notification.requestPermission();
      const permission = await permissionRequest;
      if (permission !== 'granted') {setState(permission === 'denied' ? 'denied' : 'off'); setMessage(permission === 'denied' ? 'Notifications are blocked. Allow them in your browser settings.' : 'Notifications are off.'); return;}
      saveRegistration(registration);
      await navigator.serviceWorker.register(import.meta.env.BASE_URL + 'notifications-sw.js', {scope: import.meta.env.BASE_URL});
      const worker = await navigator.serviceWorker.ready;
      const subscription = await worker.pushManager.getSubscription() || await worker.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: applicationKey(publicKey)});
      registrationAttempted = true;
      await updateSubscription('POST', {id: registration.id, secret: registration.secret, target: {kind: 'web', ...subscription.toJSON()}});
      saveRegistration({...registration, enabled: true});
      setState('on'); setMessage('You will be notified when a new bus sighting arrives.');
    } catch (error) {
      setState(disabling ? 'cleanup' : registrationAttempted ? 'unconfirmed' : 'off');
      setMessage(friendlyError(error, 'Could not change notifications. Please try again.'));
    } finally {
      busy.current = false;
    }
  }
  const label = state === 'unconfirmed' ? 'Retry enabling' : state === 'on' ? 'Notifications on' : state === 'busy' ? 'Saving notifications…' : state === 'cleanup' ? 'Finish turning off' : state === 'retry' ? 'Check notifications' : state === 'unavailable' || state === 'denied' ? 'Notifications unavailable' : 'Notify me';
  return <div className="notification-control">
    <button type="button" onClick={() => void toggle()} disabled={['checking', 'busy', 'unavailable', 'denied'].includes(state)} aria-pressed={state === 'on'}>{label}</button>
    {state === 'unconfirmed' && <button type="button" onClick={() => void toggle(true)}>Cancel notification setup</button>}
    <p role="status">{message}</p>
  </div>;
}
