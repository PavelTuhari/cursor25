/** Store detail with opening hours, services and "make this my store". */
import React from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import { translate } from '../../db/records';
import { isOpenAt, type WorkingHours } from '../../domain/stores';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityRecord } from '../../state/useEntityQuery';
import { Button, Card, EmptyState, LoadingBlock } from '../components/base';
import { Icon } from '../components/Icon';

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function StoreScreen({ storeId }: { storeId: string }): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { locale, config, storeId: selectedStore, setStoreId } = useApp();
  const { data, loading } = useEntityRecord('stores', storeId);
  const store = data[0];

  if (loading) return <LoadingBlock />;
  if (!store) return <EmptyState message={t('common.empty')} />;

  const hours = (store.working_hours ?? null) as WorkingHours | null;
  const openState = isOpenAt(hours, new Date());
  const services = Array.isArray(store.services) ? (store.services as string[]) : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
      <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xl, fontWeight: theme.typography.weights.bold as never }}>
        {translate(store.name, locale, config.app.app.defaultLocale, '')}
      </Text>
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
        {translate(store.city, locale, config.app.app.defaultLocale, '')} ·{' '}
        {translate(store.address, locale, config.app.app.defaultLocale, '')}
      </Text>
      <Text style={{ color: openState.open ? theme.colors.success : theme.colors.danger, fontSize: theme.typography.sizes.sm }}>
        {openState.open ? t('stores.open_now') : t('stores.closed')}
        {openState.until ? ` · ${t('stores.until', { time: openState.until })}` : ''}
      </Text>

      {hours ? (
        <Card>
          <View style={{ gap: theme.spacing.xs }}>
            {DAY_ORDER.map((day) => (
              <View key={day} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>{day}</Text>
                <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
                  {hours[day] ?? t('stores.closed')}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {services.length > 0 ? (
        <Card>
          <View style={{ gap: theme.spacing.xs }}>
            {services.map((service) => (
              <View key={service} style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
                <Icon name="check" size={16} color={theme.colors.success} />
                <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>{service}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {typeof store.phone === 'string' && store.phone.length > 0 ? (
        <Button
          label={store.phone}
          icon="phone"
          variant="secondary"
          onPress={() => void Linking.openURL(`tel:${String(store.phone).replace(/\s/g, '')}`)}
        />
      ) : null}

      <Button
        label={selectedStore === storeId ? t('stores.selected') : t('stores.select')}
        icon="pin"
        disabled={selectedStore === storeId}
        onPress={() => setStoreId(storeId)}
      />
    </ScrollView>
  );
}
