import AsyncStorage from '@react-native-async-storage/async-storage';
import {useEffect, useRef, useState} from 'react';
import {AppState, Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {z} from 'zod';
import {colors} from '../styles';
import {createNotificationClient, type NotificationState} from './client';

const storageKey = 'bustrackr.notifications.v1';
const registration = z.object({id: z.uuid(), secret: z.uuid(), endpoint: z.url(), desired: z.boolean()});
let client: Promise<ReturnType<typeof createNotificationClient>> | null = null;
function getClient() {
  client ??= import('./device').then(async ({deviceNotifications}) => createNotificationClient({
    read: async () => {
      const stored = await AsyncStorage.getItem(storageKey);
      return stored ? registration.parse(JSON.parse(stored)) : null;
    },
    write: value => AsyncStorage.setItem(storageKey, JSON.stringify(value)),
    fetch,
    device: await deviceNotifications(),
  })).catch(error => {client = null; throw error;});
  return client;
}
const initial: NotificationState = {kind: 'disabled', message: 'Get an alert when a new bus is detected.', canDisable: false};
export function NotificationControl({endpoint, sample}: {endpoint: string | null; sample: boolean}) {
  const [state, setState] = useState<NotificationState>(initial);
  const [busy, setBusy] = useState(true);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    async function inspect() {
      const revision = ++generation.current;
      setBusy(true);
      try {
        const next = Platform.OS === 'web'
          ? {kind: 'unavailable' as const, message: 'Use the BusTrackr website to enable browser notifications.', canDisable: false}
          : await (await getClient()).inspect(endpoint, sample);
        if (active && generation.current === revision) setState(next);
      } catch {
        if (active && generation.current === revision) setState({kind: 'error', message: 'Notifications need a compatible installed app build. Try again after rebuilding.', canDisable: false});
      } finally {
        if (active && generation.current === revision) setBusy(false);
      }
    }
    void inspect();
    const listener = AppState.addEventListener('change', next => {if (next === 'active') void inspect();});
    return () => {active = false; listener.remove();};
  }, [endpoint, sample]);
  async function toggle() {
    if (busy || Platform.OS === 'web') return;
    const revision = ++generation.current;
    setBusy(true);
    try {
      const current = await getClient();
      const next = state.canDisable ? await current.disable() : endpoint && !sample ? await current.enable(endpoint) : initial;
      if (generation.current === revision) setState(next);
    } catch {
      if (generation.current === revision) setState({kind: 'error', message: 'Could not update notifications. Try again.', canDisable: state.canDisable});
    } finally {
      if (generation.current === revision) setBusy(false);
    }
  }
  const canAct = state.canDisable || (endpoint !== null && !sample && state.kind !== 'unavailable');
  return <View style={styles.control}>
    <View style={styles.row}>
      <Text style={styles.title}>Bus notifications</Text>
      {canAct && <Pressable accessibilityRole="button" accessibilityState={{disabled: busy}} disabled={busy} onPress={() => void toggle()} style={({pressed}) => [styles.button, pressed && {opacity: 0.6}]}>
        <Text style={styles.action}>{busy ? 'Checking…' : state.canDisable ? 'Turn off alerts' : 'Notify me'}</Text>
      </Pressable>}
    </View>
    <Text accessibilityLiveRegion="polite" style={styles.message}>{busy ? 'Checking notification settings.' : state.message}</Text>
  </View>;
}
const styles = StyleSheet.create({
  control: {alignSelf: 'stretch', gap: 2},
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12},
  title: {fontSize: 14, lineHeight: 20, color: colors.ink, fontWeight: '600'},
  button: {minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 6},
  action: {fontSize: 14, lineHeight: 20, color: colors.ink, fontWeight: '600'},
  message: {fontSize: 13, lineHeight: 19, color: colors.muted},
});
