/** Promotion blocks: flyers, loyalty card and informational banners. */
import React from 'react';
import { Dimensions, Image, Pressable, ScrollView, Text, View } from 'react-native';

import { translate } from '../../db/records';
import { formatDate } from '../../domain/dates';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useEntityQuery } from '../../state/useEntityQuery';
import { asAction, runAction } from '../actions';
import { Barcode } from '../components/Barcode';
import { Card, EmptyState, LoadingBlock, Section } from '../components/base';
import { Icon } from '../components/Icon';
import { blockBoolean, blockNumber, blockQuery, blockString, type BlockProps } from './types';

export function PromoFlyersBlock({ block, navigate }: BlockProps): React.ReactElement | null {
  const theme = useTheme();
  const t = useT();
  const { locale, config } = useApp();
  const { data, loading } = useEntityQuery(blockQuery(block));
  const layout = blockString(block, 'layout') ?? 'carousel';
  const columns = blockNumber(block, 'columns', 2);
  const screenWidth = Dimensions.get('window').width;
  const cardWidth =
    layout === 'grid'
      ? (screenWidth - theme.spacing.lg * 2 - theme.spacing.md * (columns - 1)) / columns
      : screenWidth * 0.55;

  if (loading) return <LoadingBlock />;
  if (data.length === 0) return layout === 'grid' ? <EmptyState message={t('common.empty')} /> : null;

  const cards = data.map((flyer) => (
    <Pressable
      key={String(flyer.id)}
      accessibilityRole="button"
      onPress={() => navigate('promo', { promoId: String(flyer.id) })}
      style={{ width: cardWidth, gap: theme.spacing.xs }}
    >
      <Image
        source={{ uri: (flyer.cover_url as string) ?? theme.images.placeholder }}
        style={{
          width: '100%',
          aspectRatio: 0.72,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surfaceAlt,
        }}
        resizeMode="cover"
      />
      <Text numberOfLines={2} style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm }}>
        {translate(flyer.title, locale, config.app.app.defaultLocale, String(flyer.id))}
      </Text>
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>
        {formatDate(flyer.starts_at as string, locale)} — {formatDate(flyer.ends_at as string, locale)}
      </Text>
    </Pressable>
  ));

  const title = block.titleKey ? t(block.titleKey) : undefined;

  if (layout === 'grid') {
    return (
      <Section title={title}>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
          }}
        >
          {cards}
        </View>
      </Section>
    );
  }

  return (
    <Section title={title}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}
      >
        {cards}
      </ScrollView>
    </Section>
  );
}

export function LoyaltyCardBlock({ block, navigate }: BlockProps): React.ReactElement | null {
  const theme = useTheme();
  const t = useT();
  const { config, session, locale } = useApp();
  const compact = blockBoolean(block, 'compact', false);
  const { data, loading } = useEntityQuery({ entity: 'loyalty_account', limit: 1 });
  const account = data[0];
  const action = asAction(block.props?.action);

  if (!config.app.features.loyalty) return null;
  if (loading) return <LoadingBlock />;

  if (!account) {
    return (
      <Section>
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <Card>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>
              {session.userId ? t('common.empty') : t('loyalty.no_card')}
            </Text>
          </Card>
        </View>
      </Section>
    );
  }

  const barcodeValue = String(account.barcode ?? account.card_number ?? '');
  const points = Number(account.points ?? 0);

  return (
    <Section>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <Pressable
          accessibilityRole={action ? 'button' : undefined}
          onPress={action ? () => runAction(action, { navigate }) : undefined}
          style={{
            backgroundColor: theme.colors.primary,
            borderRadius: theme.radius.lg,
            padding: theme.spacing.lg,
            gap: theme.spacing.md,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text
              style={{
                color: theme.colors.onPrimary,
                fontSize: theme.typography.sizes.md,
                fontWeight: theme.typography.weights.bold as never,
              }}
            >
              {t(config.app.loyalty.cardTitleKey)}
            </Text>
            {config.app.loyalty.showPoints ? (
              <Text style={{ color: theme.colors.onPrimary, fontSize: theme.typography.sizes.md }}>
                {t('loyalty.points', { points })}
              </Text>
            ) : null}
          </View>

          {compact ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: theme.colors.onPrimary, letterSpacing: 2 }}>{barcodeValue}</Text>
              <Icon name="chevron" size={20} color={theme.colors.onPrimary} />
            </View>
          ) : (
            <>
              <Barcode value={barcodeValue} format={config.app.loyalty.barcodeFormat} />
              {config.app.loyalty.showTierProgress && account.tier ? (
                <View style={{ gap: theme.spacing.xs }}>
                  <Text style={{ color: theme.colors.onPrimary, fontSize: theme.typography.sizes.sm }}>
                    {t('loyalty.tier', { tier: String(account.tier) })}
                  </Text>
                  <View
                    style={{
                      height: 6,
                      borderRadius: theme.radius.pill,
                      backgroundColor: theme.colors.primaryMuted,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.min(100, Math.max(0, Number(account.tier_progress ?? 0) * 100))}%`,
                        height: '100%',
                        backgroundColor: theme.colors.accent,
                      }}
                    />
                  </View>
                </View>
              ) : null}
              {account.valid_until ? (
                <Text style={{ color: theme.colors.onPrimary, fontSize: theme.typography.sizes.xs }}>
                  {t('product.promo_until', { date: formatDate(account.valid_until as string, locale) })}
                </Text>
              ) : null}
            </>
          )}
        </Pressable>
      </View>
    </Section>
  );
}

export function InfoBannerBlock({ block, navigate }: BlockProps): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const titleKey = blockString(block, 'titleKey');
  const textKey = blockString(block, 'textKey');
  const icon = blockString(block, 'icon') ?? 'info';
  const action = asAction(block.props?.action);

  return (
    <Section>
      <View style={{ paddingHorizontal: theme.spacing.lg }}>
        <Card onPress={action ? () => runAction(action, { navigate }) : undefined}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' }}>
            <Icon name={icon} size={22} color={theme.colors.primary} />
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              {titleKey ? (
                <Text
                  style={{
                    color: theme.colors.text,
                    fontSize: theme.typography.sizes.md,
                    fontWeight: theme.typography.weights.medium as never,
                  }}
                >
                  {t(titleKey)}
                </Text>
              ) : null}
              {textKey ? (
                <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm }}>{t(textKey)}</Text>
              ) : null}
            </View>
          </View>
        </Card>
      </View>
    </Section>
  );
}
