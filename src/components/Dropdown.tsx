import { useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type HostInstance,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Chevron } from '@/components/Chevron';
import { SwipeRow, type SwipeAction } from '@/components/SwipeRow';
import { colors } from '@/theme';
import { getPhotoUri } from '@/utils/photoStorage';

interface DropdownOption {
  key: string | number;
  label: string;
  detail?: string;

  photoFileName?: string | null;
}

function Thumbnail({ option }: { option: DropdownOption }) {
  if (option.photoFileName === undefined) return null;
  return option.photoFileName ? (
    <Image source={{ uri: getPhotoUri(option.photoFileName) }} style={styles.thumbnail} />
  ) : (
    <View style={styles.thumbnail} />
  );
}

interface DropdownProps<Option extends DropdownOption> {
  options: Option[];
  selectedKey: Option['key'] | null;
  placeholder: string;
  onSelect: (option: Option) => void;
  // Buttons shown by swiping an option left, like Remove on a template.
  getSwipeActions?: (option: Option) => SwipeAction[];
  floating?: boolean;
}

interface Anchor {
  x: number;
  y: number;
  width: number;
}

export function Dropdown<Option extends DropdownOption>({
  options,
  selectedKey,
  placeholder,
  onSelect,
  getSwipeActions,
  floating = false,
}: DropdownProps<Option>) {
  const fieldRef = useRef<HostInstance>(null);
  const { height: windowHeight } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const selectedOption = options.find((option) => option.key === selectedKey);

  function toggle() {
    if (!floating || open) {
      setOpen(!open);
      return;
    }
    fieldRef.current?.measureInWindow((x, y, width) => {
      setAnchor({ x, y, width });
      setOpen(true);
    });
  }

  function choose(option: Option) {
    onSelect(option);
    setOpen(false);
  }

  const field = (
    <>
      {selectedOption && <Thumbnail option={selectedOption} />}
      <Text style={[styles.label, !selectedOption && styles.placeholder]}>
        {selectedOption?.label ?? placeholder}
      </Text>
      {selectedOption?.detail ? <Text style={styles.detail}>{selectedOption.detail}</Text> : null}
      <View style={open ? styles.arrowOpen : styles.arrowClosed}>
        <Chevron />
      </View>
    </>
  );

  const optionRows = options.map((option, index) => {
    const row = (
      <Pressable
        key={option.key}
        style={({ pressed }) => [
          styles.option,
          option.photoFileName !== undefined && styles.photoRow,
          getSwipeActions && styles.swipeOption,
          index > 0 && styles.optionSeparator,
          pressed && styles.optionPressed,
        ]}
        onPress={() => choose(option)}
      >
        <Text style={styles.check}>{option.key === selectedKey ? '✓' : ''}</Text>
        <Thumbnail option={option} />
        <Text style={styles.label}>{option.label}</Text>
        {option.detail ? <Text style={styles.detail}>{option.detail}</Text> : null}
      </Pressable>
    );
    if (!getSwipeActions) return row;
    return (
      <SwipeRow
        key={option.key}
        actions={getSwipeActions(option)}
        backgroundColor={floating ? colors.surface : colors.background}
      >
        {row}
      </SwipeRow>
    );
  });

  const photoRow = selectedOption?.photoFileName !== undefined && styles.photoRow;

  return (
    <View>
      {open && !floating ? (
        <View style={styles.openBox}>
          <Pressable style={[styles.field, styles.openField, photoRow]} onPress={toggle}>
            {field}
          </Pressable>
          <ScrollView style={styles.list} contentContainerStyle={styles.boxList}>
            {optionRows}
          </ScrollView>
        </View>
      ) : (
        <Pressable ref={fieldRef} style={[styles.field, photoRow]} onPress={toggle}>
          {field}
        </Pressable>
      )}
      {floating && (
        <Modal visible={open} transparent animationType="fade" onRequestClose={toggle}>
          {/* A modal is outside the app's gesture root, so swipeable options need their own. */}
          <GestureHandlerRootView style={styles.gestureRoot}>
            <Pressable style={styles.backdrop} onPress={toggle} />
            {anchor && (
              <View style={[styles.box, { top: anchor.y, left: anchor.x, width: anchor.width }]}>
                <Pressable style={[styles.field, styles.boxField]} onPress={toggle}>
                  {field}
                </Pressable>
                <ScrollView
                  style={{ maxHeight: Math.min(360, windowHeight - anchor.y - 120) }}
                  contentContainerStyle={styles.boxList}
                >
                  {optionRows}
                </ScrollView>
              </View>
            )}
          </GestureHandlerRootView>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
  openBox: {
    overflow: 'hidden',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
  },
  openField: {
    borderWidth: 0,
    borderBottomWidth: 1,
    borderRadius: 0,
  },
  list: {
    maxHeight: 240,
  },
  gestureRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  box: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.secondaryText,
    borderRadius: 8,
  },
  boxField: {
    backgroundColor: colors.surface,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderRadius: 0,
  },
  boxList: {
    paddingVertical: 4,
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
  photoRow: {
    paddingVertical: 4,
  },
  // Tall enough for a swipe button's circle and the label under it.
  swipeOption: {
    paddingVertical: 12,
  },
  thumbnail: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: colors.background,
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
