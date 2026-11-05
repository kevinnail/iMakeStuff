import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Chevron } from '@/components/Chevron';
import { colors } from '@/theme';

interface DropdownOption {
  key: string | number;
  label: string;
  detail?: string;
}

interface DropdownProps<Option extends DropdownOption> {
  options: Option[];
  selectedKey: Option['key'] | null;
  placeholder: string;
  onSelect: (option: Option) => void;
}

export function Dropdown<Option extends DropdownOption>({
  options,
  selectedKey,
  placeholder,
  onSelect,
}: DropdownProps<Option>) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.key === selectedKey);

  function choose(option: Option) {
    onSelect(option);
    setOpen(false);
  }

  return (
    <View style={styles.dropdown}>
      <Pressable style={styles.field} onPress={() => setOpen(!open)}>
        <Text style={[styles.label, !selectedOption && styles.placeholder]}>
          {selectedOption?.label ?? placeholder}
        </Text>
        {selectedOption?.detail ? <Text style={styles.detail}>{selectedOption.detail}</Text> : null}
        <View style={open ? styles.arrowOpen : styles.arrowClosed}>
          <Chevron />
        </View>
      </Pressable>
      {open && (
        <ScrollView style={styles.list}>
          {options.map((option, index) => (
            <Pressable
              key={option.key}
              style={({ pressed }) => [
                styles.option,
                index > 0 && styles.optionSeparator,
                pressed && styles.optionPressed,
              ]}
              onPress={() => choose(option)}
            >
              <Text style={styles.check}>{option.key === selectedKey ? '✓' : ''}</Text>
              <Text style={styles.label}>{option.label}</Text>
              {option.detail ? <Text style={styles.detail}>{option.detail}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dropdown: {
    gap: 4,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  arrowClosed: {
    transform: [{ rotate: '90deg' }],
  },
  arrowOpen: {
    transform: [{ rotate: '-90deg' }],
  },
  // About five options tall, then it scrolls.
  list: {
    maxHeight: 240,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  optionSeparator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  optionPressed: {
    opacity: 0.6,
  },
  check: {
    width: 18,
    fontSize: 18,
    color: colors.primary,
  },
  label: {
    flex: 1,
    fontSize: 18,
    color: colors.text,
  },
  placeholder: {
    color: colors.secondaryText,
  },
  detail: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    color: colors.secondaryText,
  },
});
