/** Renders any screen declared in `config/screens/*.json`. */
import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { useApp, useTheme } from '../../state/AppContext';
import { EmptyState } from '../components/base';
import { renderBlocks } from '../blocks';
import type { BlockProps } from '../blocks/types';

export function BlocksScreen({
  screenId,
  navigate,
}: {
  screenId: string;
  navigate: BlockProps['navigate'];
}): React.ReactElement {
  const theme = useTheme();
  const { config, runSync } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const screen = config.screens[screenId];

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await runSync();
    setRefreshing(false);
  }, [runSync]);

  if (!screen) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <EmptyState message={`Screen "${screenId}" is not configured`} icon="warning" />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
      refreshControl={
        screen.refreshable ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
        ) : undefined
      }
    >
      {renderBlocks(screen.blocks, navigate)}
    </ScrollView>
  );
}
