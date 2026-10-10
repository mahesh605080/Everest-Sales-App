import NetInfo from '@react-native-community/netinfo';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { sendRoute } from '@/lib/location';
import { sync } from '@/lib/outbox';
import { realtime } from '@/lib/realtime';
import { SessionProvider, useSession } from '@/lib/session';
import { C } from '@/theme';

function Gate() {
  const { ready, user } = useSession(); const seg = useSegments(); const router = useRouter();
  useEffect(() => {
    if (!ready) return; const at = seg[0] as string | undefined;
    if (!user && at !== 'login') router.replace('/login');
    else if (user?.must_change_password && at !== 'password') router.replace('/password');
    else if (user && !user.must_change_password && at === 'login') router.replace('/');
  }, [ready, user, seg, router]);
  // Whatever was done without a connection is sent as soon as the phone is online again, or the app is opened.
  useEffect(() => {
    if (!user) { realtime.stop(); return; } const go = () => { sync().catch(() => {}); sendRoute().catch(() => {}); realtime.wake(); };
    if (!user.must_change_password) realtime.start();
    const net = NetInfo.addEventListener(s => { if (s.isConnected) go(); });
    const app = AppState.addEventListener('change', s => { if (s === 'active') go(); });
    go(); return () => { net(); app.remove(); };
  }, [user]);
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}><ActivityIndicator color={C.accent} size="large" /></View>;
  return <Stack screenOptions={{ headerStyle: { backgroundColor: C.card }, headerTintColor: C.ink, headerTitleStyle: { fontWeight: '700' }, headerShadowVisible: false, contentStyle: { backgroundColor: C.bg }, headerBackButtonDisplayMode: 'minimal' }}>
    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    <Stack.Screen name="login" options={{ headerShown: false }} />
    <Stack.Screen name="password" options={{ title: 'Change password' }} />
    <Stack.Screen name="customer/[id]" options={{ title: 'Customer' }} />
    <Stack.Screen name="order/new" options={{ title: 'New order' }} />
    <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
    <Stack.Screen name="visit" options={{ title: 'Customer visit' }} />
    <Stack.Screen name="collection" options={{ title: 'Record collection' }} />
    <Stack.Screen name="stock" options={{ title: 'Distributor stock' }} />
    <Stack.Screen name="offers" options={{ title: 'Near-expiry offers' }} />
    <Stack.Screen name="outbox" options={{ title: 'Waiting to send' }} />
    <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
    <Stack.Screen name="chat/index" options={{ title: 'Chat' }} />
    <Stack.Screen name="chat/[id]" options={{ title: 'Conversation' }} />
  </Stack>;
}
export default function Root() {
  return <SafeAreaProvider><SessionProvider><StatusBar style="dark" /><Gate /></SessionProvider></SafeAreaProvider>;
}
