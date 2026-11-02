import Constants from 'expo-constants';
import {Platform} from 'react-native';
import type {DeviceNotifications} from './client';

export async function deviceNotifications(): Promise<DeviceNotifications> {
  const [Notifications, Device, Crypto] = await Promise.all([
    import('expo-notifications'), import('expo-device'), import('expo-crypto'),
  ]);
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  Notifications.setNotificationHandler({handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
  })});
  return {
    unavailable: async () => {
      if (!Device.isDevice) return 'Use a physical device to receive bus notifications.';
      if (Constants.executionEnvironment === 'storeClient') return 'Notifications need a development or installed app build.';
      if (typeof projectId !== 'string' || !projectId) return 'Notifications need an EAS project and a rebuilt app with push credentials.';
      return null;
    },
    permission: async request => {
      if (request && Platform.OS === 'android') await Notifications.setNotificationChannelAsync('bus-detections', {
        name: 'Bus detections', importance: Notifications.AndroidImportance.DEFAULT,
      });
      let permission = await Notifications.getPermissionsAsync();
      if (request && !permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
        permission = await Notifications.requestPermissionsAsync({ios: {allowAlert: true, allowSound: false, allowBadge: false}});
      }
      return permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    },
    token: async () => (await Notifications.getExpoPushTokenAsync({projectId})).data,
    uuid: Crypto.randomUUID,
  };
}
