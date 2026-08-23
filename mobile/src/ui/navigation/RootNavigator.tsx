/**
 * Navigation is assembled from `navigation.config.json`: tabs, their order,
 * icons, titles and visibility rules all come from the config bundle, and the
 * stack screens above them are the fixed set of detail screens.
 */
import React from 'react';
import { NavigationContainer, useNavigation, type NavigationProp } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useApp, useT, useTheme } from '../../state/AppContext';
import { useShoppingList } from '../../state/ShoppingListContext';
import { Icon } from '../components/Icon';
import { BlocksScreen } from '../screens/BlocksScreen';
import { CategoryScreen } from '../screens/CategoryScreen';
import { FavoritesScreen } from '../screens/FavoritesScreen';
import { ProductScreen } from '../screens/ProductScreen';
import { PromoScreen } from '../screens/PromoScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StoreScreen } from '../screens/StoreScreen';
import { isVisible } from '../visibility';
import type { RootStackParamList } from './types';

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
  const { config, session, locale } = useApp();
  const list = useShoppingList();
  const navigate = useNavigate();

  const tabs = config.navigation.tabs.filter((tab) =>
    isVisible(tab.visibleIf, {
      features: config.app.features,
      isAuthenticated: Boolean(session.userId),
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
            tabBarBadge: tab.badge === 'shoppingListCount' && list.count > 0 ? list.count : undefined,
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

export function RootNavigator(): React.ReactElement {
  const theme = useTheme();
  const t = useT();

  return (
    <NavigationContainer
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
