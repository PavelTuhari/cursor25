/**
 * Renders a barcode from the module widths produced by `domain/barcode`.
 * Plain views only — no native dependency, works offline at the checkout.
 */
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';

import { encodeBarcode } from '../../domain/barcode';
import { useTheme } from '../../state/AppContext';

export interface BarcodeProps {
  value: string;
  format: 'ean13' | 'code128';
  height?: number;
  showText?: boolean;
}

export function Barcode({ value, format, height = 96, showText = true }: BarcodeProps): React.ReactElement {
  const theme = useTheme();
  const pattern = useMemo(() => {
    try {
      return encodeBarcode(value, format);
    } catch {
      return null;
    }
  }, [value, format]);

  if (!pattern) {
    return (
      <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.sm }}>
        {value}
      </Text>
    );
  }

  const totalModules = pattern.bars.reduce((sum, width) => sum + width, 0);

  return (
    <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
      <View
        accessibilityRole="image"
        accessibilityLabel={pattern.text}
        style={{
          flexDirection: 'row',
          height,
          width: '100%',
          backgroundColor: '#FFFFFF',
          borderRadius: theme.radius.sm,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          alignItems: 'stretch',
        }}
      >
        {pattern.bars.map((width, index) => (
          <View
            key={`${index}-${width}`}
            style={{
              flexGrow: width / totalModules,
              flexBasis: 0,
              backgroundColor: index % 2 === 0 ? '#000000' : '#FFFFFF',
            }}
          />
        ))}
      </View>
      {showText ? (
        <Text style={{ color: theme.colors.text, letterSpacing: 3, fontSize: theme.typography.sizes.md }}>
          {pattern.text}
        </Text>
      ) : null}
    </View>
  );
}
