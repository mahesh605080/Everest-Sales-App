import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useData } from '@/lib/data';
import { useOutbox } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { C } from '@/theme';

export default function TabsLayout() {
  const { can } = useSession(); const out = useOutbox();
  const approver = can('booklets.approve') || can('credit.manage') || can('claims.approve') || can('collections.verify') || can('claims.settle');
  const inbox = useData<{ items: any[] }>(approver ? '/api/approvals' : null);
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: any; size: number }) => <Ionicons name={name} color={color} size={size} />;
  return <Tabs screenOptions={{ tabBarActiveTintColor: C.accent, tabBarInactiveTintColor: C.faint, tabBarStyle: { backgroundColor: C.card, borderTopColor: C.line }, tabBarLabelStyle: { fontWeight: '600' },
    headerStyle: { backgroundColor: C.card }, headerTitleStyle: { fontWeight: '800', fontSize: 20, color: C.ink }, headerShadowVisible: false, headerTitleAlign: 'left', sceneStyle: { backgroundColor: C.bg } }}>
    <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('today-outline') }} />
    <Tabs.Screen name="customers" options={{ title: 'Customers', tabBarIcon: icon('people-outline'), href: can('customers.view') ? undefined : null }} />
    <Tabs.Screen name="orders" options={{ title: 'Orders', tabBarIcon: icon('receipt-outline'), href: can('orders.create') || can('sales.view') || can('credit.manage') ? undefined : null }} />
    <Tabs.Screen name="approvals" options={{ title: 'Approvals', tabBarIcon: icon('checkmark-done-outline'), href: approver ? undefined : null, tabBarBadge: inbox.data?.items?.length || undefined }} />
    <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('menu-outline'), tabBarBadge: out.length || undefined }} />
  </Tabs>;
}
