/**
 * Opens the screen a tapped notification points at — including the case where
 * the tap is what started the app.
 */
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';

import { resolveNotificationRoute } from './routing';

// Notifications that arrive while the app is open are worth showing: a "your
// order is ready" banner is the point of the feature.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type NavigateFn = (screen: string, params?: Record<string, unknown>) => void;

export function useNotificationRouting(navigate: NavigateFn, ready: boolean): void {
  useEffect(() => {
    if (!ready) return;

    const open = (response: Notifications.NotificationResponse | null): void => {
      const route = resolveNotificationRoute(response?.notification.request.content.data);
      if (route) navigate(route.screen, route.params);
    };

    // A cold start through a notification has no live event to listen for.
    void Notifications.getLastNotificationResponseAsync().then(open);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [navigate, ready]);
}
