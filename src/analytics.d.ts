interface Window {
  BusTrackrAnalytics?: {
    track(name: 'app_view', value: 'simple' | 'map'): void;
    track(name: 'notification_permission', value: NotificationPermission): void;
    track(name: 'notification_enabled' | 'notification_disabled' | 'notification_open'): void;
    track(name: 'notification_failure', value: 'enable' | 'disable'): void;
  };
}
