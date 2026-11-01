import AsyncStorage from '@react-native-async-storage/async-storage';
import {parseEndpoint} from './feed';
import {sourceSchema, type Source} from './samples';

const key = 'bustrackr.source.v1';
export const defaultSource: Source = {kind: 'sample', scenario: 'estimated'};
export async function loadSource(): Promise<Source> {
  const stored = await AsyncStorage.getItem(key);
  if (stored) {
    const raw: unknown = JSON.parse(stored);
    const source = sourceSchema.parse(raw);
    return source.kind === 'api' ? {...source, endpoint: parseEndpoint(source.endpoint, __DEV__)} : source;
  }
  const endpoint = process.env.EXPO_PUBLIC_SHUTTLE_API_URL || 'https://bustrackr.valleychristianai.com/api/shuttle';
  return endpoint ? {kind: 'api', endpoint: parseEndpoint(endpoint, __DEV__)} : defaultSource;
}
export function saveSource(source: Source) {
  return AsyncStorage.setItem(key, JSON.stringify(source));
}
