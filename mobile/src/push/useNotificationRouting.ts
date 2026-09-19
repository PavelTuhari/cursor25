/**
 * Opens the screen a tapped notification points at — including the case where
 * the tap is what started the app.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { resolveNotificationRoute } from './routing';

/**
 * The notification module has no web implementation: touching it there throws
 * from inside the native bridge, which React surfaces as an unhandled error.
 * The web build simply has no notifications.
 */
const SUPPORTED = Platform.OS === 'ios' || Platform.OS === 'android';

// Notifications that arrive while the app is open are worth showing: a "your
// order is ready" banner is the point of the feature.
if (SUPPORTED) {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // A build without the module: nothing to configure.
  }
}

export type NavigateFn = (screen: string, params?: Record<string, unknown>) => void;

export function useNotificationRouting(navigate: NavigateFn, ready: boolean): void {
  useEffect(() => {
    if (!ready || !SUPPORTED) return;

    const open = (response: Notifications.NotificationResponse | null): void => {
      const route = resolveNotificationRoute(response?.notification.request.content.data);
      if (route) navigate(route.screen, route.params);
    };

    try {
      // A cold start through a notification has no live event to listen for.
      void Notifications.getLastNotificationResponseAsync().then(open, () => undefined);
      const subscription = Notifications.addNotificationResponseReceivedListener(open);
      return () => subscription.remove();
    } catch {
      // Push is unavailable here; the rest of the app is unaffected.
      return undefined;
    }
  }, [navigate, ready]);
}
