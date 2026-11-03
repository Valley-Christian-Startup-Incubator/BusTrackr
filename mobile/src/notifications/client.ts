export type Registration = {id: string; secret: string; endpoint: string; desired: boolean};
export type NotificationState = {
  kind: 'disabled' | 'enabled' | 'unavailable' | 'blocked' | 'error';
  message: string;
  canDisable: boolean;
};
export type DeviceNotifications = {
  unavailable: () => Promise<string | null>;
  permission: (request: boolean) => Promise<boolean>;
  token: () => Promise<string>;
  uuid: () => string;
};
type Dependencies = {
  read: () => Promise<Registration | null>;
  write: (value: Registration) => Promise<void>;
  fetch: typeof fetch;
  device: DeviceNotifications;
};
const disabled: NotificationState = {kind: 'disabled', message: 'Get an alert when a new bus is detected.', canDisable: false};
const unavailable = (message: string, canDisable = false): NotificationState => ({kind: 'unavailable', message, canDisable});
export function notificationUrl(endpoint: string, path: 'config' | 'subscriptions') {
  return new URL(`./notifications/${path}`, endpoint).toString();
}
export function createNotificationClient(deps: Dependencies) {
  let queue: Promise<unknown> = Promise.resolve();
  function serialized(operation: () => Promise<NotificationState>) {
    const task = queue.then(operation).catch(async () => {
      let canDisable = false;
      try {canDisable = (await deps.read())?.desired === true;} catch {}
      return {kind: 'error' as const, message: 'Could not update notifications. Try again.', canDisable};
    });
    queue = task;
    return task;
  }
  async function request(endpoint: string, path: 'config' | 'subscriptions', method = 'GET', body?: object) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await deps.fetch(notificationUrl(endpoint, path), {
        method, headers: body ? {'Content-Type': 'application/json'} : undefined,
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
      });
      if (!response.ok) throw new Error('Notification service unavailable');
      return method === 'GET' ? await response.json() : null;
    } finally {clearTimeout(timeout);}
  }
  async function stop(record: Registration) {
    await request(record.endpoint, 'subscriptions', 'DELETE', {id: record.id, secret: record.secret});
    await deps.write({...record, desired: false});
  }
  async function supported(endpoint: string) {
    const reason = await deps.device.unavailable();
    if (reason) return reason;
    const config: unknown = await request(endpoint, 'config');
    if (!config || typeof config !== 'object' || !('expo' in config) || config.expo !== true) return 'Notifications are not configured for this feed yet.';
    return null;
  }
  async function register(record: Registration) {
    const token = await deps.device.token();
    await request(record.endpoint, 'subscriptions', 'POST', {id: record.id, secret: record.secret, target: {kind: 'expo', token}});
    return {kind: 'enabled' as const, message: 'New bus detections will notify this device.', canDisable: true};
  }
  return {
    inspect: (endpoint: string | null, sample: boolean) => serialized(async () => {
      const record = await deps.read();
      if (record?.desired && (sample || endpoint !== record.endpoint)) await stop(record);
      if (sample || !endpoint) return unavailable('Connect to the live feed to enable notifications.');
      const reason = await supported(endpoint);
      if (reason) return unavailable(reason, record?.desired === true && endpoint === record.endpoint);
      if (!record?.desired || endpoint !== record.endpoint) return disabled;
      if (!await deps.device.permission(false)) {
        await stop(record);
        return {kind: 'blocked', message: 'Notifications are blocked in device settings.', canDisable: false};
      }
      return register(record);
    }),
    enable: (endpoint: string) => serialized(async () => {
      let record = await deps.read();
      if (record?.desired && record.endpoint !== endpoint) await stop(record);
      const reason = await supported(endpoint);
      if (reason) return unavailable(reason);
      if (!await deps.device.permission(true)) return {kind: 'blocked', message: 'Allow notifications in device settings to receive bus alerts.', canDisable: false};
      if (!record || record.endpoint !== endpoint) record = {id: deps.device.uuid(), secret: deps.device.uuid(), endpoint, desired: true};
      else record = {...record, desired: true};
      await deps.write(record);
      return register(record);
    }),
    disable: () => serialized(async () => {
      const record = await deps.read();
      if (record) await stop(record);
      return disabled;
    }),
  };
}
