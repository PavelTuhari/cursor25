/**
 * Navigation is assembled from `navigation.config.json`: tabs, their order,
 * icons, titles and visibility rules all come from the config bundle, and the
 * stack screens above them are the fixed set of detail screens.
 */
import React, { useCallback, useState } from 'react';
import {
  NavigationContainer,
  createNavigationContainerRef,
  useNavigation,
  type NavigationProp,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useApp, useT, useTheme } from '../../state/AppContext';
import { useNotificationRouting } from '../../push/useNotificationRouting';
import { useCart } from '../../state/CartContext';
import { useShoppingList } from '../../state/ShoppingListContext';
import { Icon } from '../components/Icon';
import { AccountScreen } from '../screens/AccountScreen';
import { BlocksScreen } from '../screens/BlocksScreen';
import { CategoryScreen } from '../screens/CategoryScreen';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { OrderScreen } from '../screens/OrderScreen';
import { ScanScreen } from '../screens/ScanScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { ReceiptScreen } from '../screens/ReceiptScreen';
import { FavoritesScreen } from '../screens/FavoritesScreen';
import { ProductScreen } from '../screens/ProductScreen';
import { PromoScreen } from '../screens/PromoScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StoreScreen } from '../screens/StoreScreen';
import { isVisible } from '../visibility';
import type { RootStackParamList } from './types';

const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

type Navigate = (screen: string, params?: Record<string, unknown>) => void;

function useNavigate(): Navigate {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  return (screen, params) => {
    // Config may reference any route name, so the typed signature is widened here.
    const navigate = navigation.navigate as (name: string, params?: Record<string, unknown>) => void;
    navigate(screen, params);
  };
}

function TabsNavigator(): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { config, isAuthenticated, locale } = useApp();
  const list = useShoppingList();
  const cart = useCart();
  const navigate = useNavigate();

  const badgeCount = (badge: string | undefined): number | undefined => {
    if (badge === 'shoppingListCount' && list.count > 0) return list.count;
    if (badge === 'cartCount' && cart.count > 0) return cart.count;
    return undefined;
  };

  const tabs = config.navigation.tabs.filter((tab) =>
    isVisible(tab.visibleIf, {
      features: config.app.features,
      isAuthenticated,
      locale,
    }),
  );

  return (
    <Tab.Navigator
      initialRouteName={tabs.some((tab) => tab.id === config.navigation.initialTab) ? config.navigation.initialTab : tabs[0]?.id}
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTitleStyle: { color: theme.colors.text },
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
      }}
    >
      {tabs.map((tab) => (
        <Tab.Screen
          key={tab.id}
          name={tab.id}
          options={{
            title: t(tab.titleKey),
            tabBarIcon: ({ color }) => <Icon name={tab.icon} size={22} color={color} />,
            tabBarBadge: badgeCount(tab.badge),
          }}
        >
          {() => <BlocksScreen screenId={tab.screen} navigate={navigate} />}
        </Tab.Screen>
      ))}
    </Tab.Navigator>
  );
}

function CategoryRoute({ route }: { route: { params?: RootStackParamList['category'] } }): React.ReactElement {
  const navigate = useNavigate();
  return <CategoryScreen categoryId={route.params?.categoryId} preset={route.params?.preset} navigate={navigate} />;
}

function ProductRoute({ route }: { route: { params: RootStackParamList['product'] } }): React.ReactElement {
  const navigate = useNavigate();
  return <ProductScreen productId={route.params.productId} navigate={navigate} />;
}

function SearchRoute({ route }: { route: { params?: RootStackParamList['search'] } }): React.ReactElement {
  const navigate = useNavigate();
  return <SearchScreen initialQuery={route.params?.query} navigate={navigate} />;
}

function PromoRoute({ route }: { route: { params: RootStackParamList['promo'] } }): React.ReactElement {
  const navigate = useNavigate();
  return <PromoScreen promoId={route.params.promoId} navigate={navigate} />;
}

function StoreRoute({ route }: { route: { params: RootStackParamList['store'] } }): React.ReactElement {
  return <StoreScreen storeId={route.params.storeId} />;
}

function StoresRoute(): React.ReactElement {
  const navigate = useNavigate();
  return <BlocksScreen screenId="stores" navigate={navigate} />;
}

function FavoritesRoute(): React.ReactElement {
  const navigate = useNavigate();
  return <FavoritesScreen navigate={navigate} />;
}

function ReceiptsRoute(): React.ReactElement {
  const navigate = useNavigate();
  return <BlocksScreen screenId="receipts" navigate={navigate} />;
}

function ReceiptRoute({ route }: { route: { params: RootStackParamList['receipt'] } }): React.ReactElement {
  return <ReceiptScreen receiptId={route.params.receiptId} />;
}

function OrdersRoute(): React.ReactElement {
  const navigate = useNavigate();
  return <BlocksScreen screenId="orders" navigate={navigate} />;
}

function OrderRoute({ route }: { route: { params: RootStackParamList['order'] } }): React.ReactElement {
  const navigate = useNavigate();
  return <OrderScreen orderId={route.params.orderId} navigate={navigate} />;
}

function CouponsRoute(): React.ReactElement {
  const navigate = useNavigate();
  return <BlocksScreen screenId="coupons" navigate={navigate} />;
}

function CheckoutRoute(): React.ReactElement {
  const navigate = useNavigate();
  return <CheckoutScreen navigate={navigate} />;
}

function ScanRoute(): React.ReactElement {
  const navigate = useNavigate();
  return <ScanScreen navigate={navigate} />;
}

function ListRoute(): React.ReactElement {
  const navigate = useNavigate();
  return <BlocksScreen screenId="list" navigate={navigate} />;
}

function PromosRoute(): React.ReactElement {
  const navigate = useNavigate();
  return <BlocksScreen screenId="promos" navigate={navigate} />;
}

function LoginRoute(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  return <LoginScreen onSignedIn={() => navigation.goBack()} />;
}

export function RootNavigator(): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const [ready, setReady] = useState(false);

  // Notifications may arrive before the navigator exists, so routing waits for it.
  const navigateFromNotification = useCallback((screen: string, params?: Record<string, unknown>) => {
    if (!navigationRef.isReady()) return;
    const navigate = navigationRef.navigate as (name: string, params?: Record<string, unknown>) => void;
    navigate(screen, params);
  }, []);
  useNotificationRouting(navigateFromNotification, ready);

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => setReady(true)}
      theme={{
        dark: theme.mode === 'dark',
        colors: {
          primary: theme.colors.primary,
          background: theme.colors.background,
          card: theme.colors.surface,
          text: theme.colors.text,
          border: theme.colors.border,
          notification: theme.colors.badge,
        },
        fonts: {
          regular: { fontFamily: 'System', fontWeight: '400' },
          medium: { fontFamily: 'System', fontWeight: '600' },
          bold: { fontFamily: 'System', fontWeight: '700' },
          heavy: { fontFamily: 'System', fontWeight: '800' },
        },
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTintColor: theme.colors.text,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="tabs" component={TabsNavigator} options={{ headerShown: false }} />
        <Stack.Screen name="category" component={CategoryRoute} options={{ title: t('screen.catalog') }} />
        <Stack.Screen name="product" component={ProductRoute} options={{ title: '' }} />
        <Stack.Screen name="search" component={SearchRoute} options={{ title: t('screen.search') }} />
        <Stack.Screen name="promo" component={PromoRoute} options={{ title: t('screen.promos') }} />
        <Stack.Screen name="stores" component={StoresRoute} options={{ title: t('screen.stores') }} />
        <Stack.Screen name="store" component={StoreRoute} options={{ title: t('screen.stores') }} />
        <Stack.Screen name="favorites" component={FavoritesRoute} options={{ title: t('screen.favorites') }} />
        <Stack.Screen name="settings" component={SettingsScreen} options={{ title: t('screen.settings') }} />
        <Stack.Screen name="login" component={LoginRoute} options={{ title: t('screen.login'), presentation: 'modal' }} />
        <Stack.Screen name="account" component={AccountScreen} options={{ title: t('screen.account') }} />
        <Stack.Screen name="receipts" component={ReceiptsRoute} options={{ title: t('screen.receipts') }} />
        <Stack.Screen name="receipt" component={ReceiptRoute} options={{ title: t('screen.receipts') }} />
        <Stack.Screen name="checkout" component={CheckoutRoute} options={{ title: t('screen.checkout') }} />
        <Stack.Screen name="orders" component={OrdersRoute} options={{ title: t('screen.orders') }} />
        <Stack.Screen name="order" component={OrderRoute} options={{ title: t('screen.order') }} />
        <Stack.Screen name="coupons" component={CouponsRoute} options={{ title: t('screen.coupons') }} />
        <Stack.Screen name="scan" component={ScanRoute} options={{ title: t('screen.scan') }} />
        <Stack.Screen name="list" component={ListRoute} options={{ title: t('screen.list') }} />
        <Stack.Screen name="promos" component={PromosRoute} options={{ title: t('screen.promos') }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
