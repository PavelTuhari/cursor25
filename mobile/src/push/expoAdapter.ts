/** expo-notifications implementation of the push adapter. */
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { PermissionStatus, PushAdapter } from './pushService';

function toStatus(status: Notifications.PermissionStatus): PermissionStatus {
  if (status === 'granted') return 'granted';
  return status === 'undetermined' ? 'undetermined' : 'denied';
}

export class ExpoPushAdapter implements PushAdapter {
  readonly platform = Platform.OS;

  constructor(private readonly projectId?: string) {}

  get isDevice(): boolean {
    return Device.isDevice;
  }

  async getPermissionStatus(): Promise<PermissionStatus> {
    const permissions = await Notifications.getPermissionsAsync();
    return toStatus(permissions.status);
  }

  async requestPermission(): Promise<PermissionStatus> {
    const permissions = await Notifications.requestPermissionsAsync();
    return toStatus(permissions.status);
  }

  async getToken(): Promise<string | null> {
    try {
      const token = await Notifications.getExpoPushTokenAsync(
        this.projectId ? { projectId: this.projectId } : undefined,
      );
      return token.data;
    } catch {
      // No credentials configured for this build: push simply stays off.
      return null;
    }
  }
}
