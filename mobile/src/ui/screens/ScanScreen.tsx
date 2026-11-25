/**
 * Barcode scanner: check a price in the aisle, or drop the product straight
 * into the shopping list. The lookup goes through the offline catalogue, so it
 * works in a store with no signal.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';

import { translate } from '../../db/records';
import { looksLikeProductCode, normalizeScannedCode, scanCandidates } from '../../domain/scan';
import { useApp, useT, useTheme } from '../../state/AppContext';
import { useShoppingList } from '../../state/ShoppingListContext';
import { Button, Card } from '../components/base';
import { Icon } from '../components/Icon';
import type { BlockProps } from '../blocks/types';

export function ScanScreen({ navigate }: { navigate: BlockProps['navigate'] }): React.ReactElement {
  const theme = useTheme();
  const t = useT();
  const { db, config, locale } = useApp();
  const list = useShoppingList();
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  // The camera fires repeatedly for the same barcode; one lookup is enough.
  const lastCode = useRef<string | null>(null);

  const handleScan = useCallback(
    (result: BarcodeScanningResult) => {
      const code = normalizeScannedCode(result.data ?? '');
      if (!scanning || code.length === 0 || code === lastCode.current) return;
      lastCode.current = code;
      setScanning(false);

      void (async () => {
        if (!looksLikeProductCode(code)) {
          setMessage(t('scan.not_found', { code }));
          return;
        }
        const products = await db.repository('products').query(
          { entity: 'products', where: [{ field: 'barcode', op: 'in', value: scanCandidates(code) }], limit: 1 },
          { locale },
        );
        const product = products[0];
        if (!product) {
          setMessage(t('scan.not_found', { code }));
          return;
        }

        if (config.app.scanner.addToListOnScan) {
          await list.addProduct({ id: String(product.id), name: product.name, unit: product.unit as string });
          setMessage(t('list.added'));
          return;
        }
        navigate('product', { productId: String(product.id) });
      })();
    },
    [scanning, db, locale, t, config.app.scanner.addToListOnScan, list, navigate],
  );

  const resume = (): void => {
    lastCode.current = null;
    setMessage(null);
    setScanning(true);
  };

  if (!permission) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.lg }}>
        <Card>
          <View style={{ gap: theme.spacing.md, alignItems: 'center' }}>
            <Icon name="camera" size={28} color={theme.colors.primary} />
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.md, textAlign: 'center' }}>
              {t('scan.permission')}
            </Text>
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm, textAlign: 'center' }}>
              {permission.canAskAgain ? t('scan.permission_text') : t('scan.denied')}
            </Text>
            {permission.canAskAgain ? (
              <Button label={t('scan.grant')} onPress={() => void requestPermission()} />
            ) : null}
          </View>
        </Card>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: config.app.scanner.formats as never }}
        onBarcodeScanned={scanning ? handleScan : undefined}
      />
      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md, backgroundColor: theme.colors.background }}>
        <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.sm, textAlign: 'center' }}>
          {message ?? t('scan.hint')}
        </Text>
        {!scanning ? <Button label={t('scan.scan_again')} variant="secondary" onPress={resume} /> : null}
      </View>
    </View>
  );
}

/** Exported for the product screen's "scanned it in the aisle" shortcut. */
export function scannedProductTitle(product: { name?: unknown; id: string }, locale: string, fallback: string): string {
  return translate(product.name, locale, fallback, product.id);
}
