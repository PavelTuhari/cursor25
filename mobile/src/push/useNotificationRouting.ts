/**
 * Opens the screen a tapped notification points at — including the case where
 * the tap is what started the app.
 */
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';

import { resolveNotificationRoute } from './routing';

// Notifications that arrive while the app is open are worth showing: a "your
// order is ready" banner is the point of the feature. Platforms without push
// (web, a build without the module) throw here, and that must not take the
// whole app down.
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
  // No notification support on this platform.
}

export type NavigateFn = (screen: string, params?: Record<string, unknown>) => void;

export function useNotificationRouting(navigate: NavigateFn, ready: boolean): void {
  useEffect(() => {
    if (!ready) return;

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
