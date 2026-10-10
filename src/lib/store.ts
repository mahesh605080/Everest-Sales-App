import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Small JSON store on the phone. Used for cached lists and the outbox. */
export const kv = {
  async get<T>(key: string): Promise<T | null> { try { const v = await AsyncStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; } },
  async set(key: string, value: unknown) { try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or unavailable: the app still works online */ } },
  async del(key: string) { try { await AsyncStorage.removeItem(key); } catch { /* nothing to remove */ } },
  async clearPrefix(prefix: string) { try { const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(prefix)); if (keys.length) await AsyncStorage.multiRemove(keys); } catch { /* ignore */ } },
};

/** The login token goes in the phone's encrypted keystore. A browser preview has no keystore, so it falls back to ordinary storage. */
const native = Platform.OS !== 'web';
export const secret = {
  async get(key: string) { try { return native ? await SecureStore.getItemAsync(key) : await AsyncStorage.getItem(key); } catch { return null; } },
  async set(key: string, value: string) { try { if (native) await SecureStore.setItemAsync(key, value); else await AsyncStorage.setItem(key, value); } catch { /* ignore */ } },
  async del(key: string) { try { if (native) await SecureStore.deleteItemAsync(key); else await AsyncStorage.removeItem(key); } catch { /* ignore */ } },
};
